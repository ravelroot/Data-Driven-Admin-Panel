import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { dispararIntegracoes, processarEntregasPendentes } from '../src/integracoes.js';
import { detectarDelimitador, lerCsv } from '../src/util/csv-leitura.js';
import { cabecalhos, criarAmbiente, entrar, type Ambiente } from './auxiliar.js';

process.env.BENTO_INTEGRACOES_REDE_INTERNA = '1';

describe('leitura de CSV', () => {
  it('detecta o delimitador e respeita aspas, quebras de linha e BOM', () => {
    assert.equal(detectarDelimitador('nome;email\nA;b@c.d'), ';');
    assert.equal(detectarDelimitador('nome,email'), ',');
    assert.equal(detectarDelimitador('nome\temail'), '\t');
    const linhas = lerCsv('﻿nome;obs\r\n"Silva; Ana";"linha 1\nlinha 2"\r\n"Dias ""Zé""";x\r\n\r\n');
    assert.deepEqual(linhas, [
      ['nome', 'obs'],
      ['Silva; Ana', 'linha 1\nlinha 2'],
      ['Dias "Zé"', 'x'],
    ]);
  });
});

describe('importação de usuários', () => {
  let ambiente: Ambiente;
  let admin: string;
  let gerente: string;
  let suporte: string;

  before(async () => {
    ambiente = await criarAmbiente();
    admin = await entrar(ambiente.app);
    gerente = await entrar(ambiente.app, 'gerente@bento.local');
    suporte = await entrar(ambiente.app, 'suporte@bento.local');
  });

  after(async () => {
    await ambiente.fechar();
  });

  const importar = (cookie: string, payload: unknown) =>
    ambiente.app.inject({ method: 'POST', url: '/api/v1/usuarios/importar', headers: cabecalhos(cookie), payload });

  const PLANILHA = [
    'Nome;E-mail;Função;Situação;Cargo;Cidade;Canal;Observação',
    'Lia Ramos;lia@importada.com;Analista;ativo;Analista de dados;Recife;Indicação;veio do evento',
    'Téo Brandão;TEO@importada.com;;pendente;;;;',
    'Repetida;lia@importada.com;cliente;;;;;',
    'Admin Antigo;admin@bento.local;cliente;;;;;',
    'Sem Email;nao-e-email;cliente;;;;;',
    'Papel Errado;papel@importada.com;astronauta;;;;;',
    'Chefe;chefe@importada.com;admin;;;;;',
    'X;x@importada.com;;;;;;',
    'Canal Ruim;canal@importada.com;;;;;Rádio;',
  ].join('\n');

  it('simula sem gravar e explica cada linha', async () => {
    const resposta = await importar(gerente, { csv: PLANILHA, simular: true, papelPadrao: 'cliente' });
    assert.equal(resposta.statusCode, 200, resposta.body);
    const corpo = resposta.json();
    assert.equal(corpo.simulacao, true);
    assert.equal(corpo.total, 9);
    assert.equal(corpo.criar, 2);
    assert.equal(corpo.ignorar, 2);
    assert.equal(corpo.erros, 5);
    assert.equal(corpo.criados, 0);
    assert.deepEqual(corpo.colunas.ignoradas, ['Observação']);
    const porLinha = new Map(corpo.linhas.map((linha: { linha: number }) => [linha.linha, linha]));
    assert.match((porLinha.get(8) as { mensagem: string }).mensagem, /permissões/);
    assert.match((porLinha.get(7) as { mensagem: string }).mensagem, /astronauta/);
    assert.equal(corpo.linhas[0].situacao, 'erro');
    const { linhas } = await ambiente.banco.consultar(`select 1 from usuarios where email = 'lia@importada.com'`);
    assert.equal(linhas.length, 0);
  });

  it('importa de verdade, sem senha, com auditoria e notificação', async () => {
    const resposta = await importar(admin, { csv: PLANILHA, simular: false, papelPadrao: 'cliente' });
    assert.equal(resposta.statusCode, 200, resposta.body);
    assert.equal(resposta.json().criados, 3);
    const { linhas } = await ambiente.banco.consultar<{ email: string; papel: string; status: string; senha_hash: string | null; canal: string | null }>(
      `select email, papel, status, senha_hash, canal from usuarios where email like '%@importada.com' order by email`,
    );
    assert.deepEqual(
      linhas.map((linha) => [linha.email, linha.papel, linha.status, linha.senha_hash, linha.canal]),
      [
        ['chefe@importada.com', 'admin', 'ativo', null, null],
        ['lia@importada.com', 'analista', 'ativo', null, 'Indicação'],
        ['teo@importada.com', 'cliente', 'pendente', null, null],
      ],
    );
    const auditoria = await ambiente.banco.consultar<{ detalhes: { criados: number } }>(`select detalhes from auditoria where acao = 'usuario.importados'`);
    assert.equal(auditoria.linhas[0]?.detalhes.criados, 3);
    const repetir = await importar(admin, { csv: PLANILHA, simular: true });
    assert.equal(repetir.json().criar, 0);
  });

  it('exige a permissão de importar e um cabeçalho com nome e e-mail', async () => {
    assert.equal((await importar(suporte, { csv: PLANILHA })).statusCode, 403);
    const semColunas = await importar(admin, { csv: 'pessoa;contato\nAna;ana@x.com' });
    assert.equal(semColunas.statusCode, 422);
    assert.match(semColunas.json().erro.mensagem, /nome.*email/);
    assert.equal((await importar(gerente, { csv: PLANILHA, papelPadrao: 'admin' })).statusCode, 403);
    const modelo = await ambiente.app.inject({ method: 'GET', url: '/api/v1/usuarios/importar/modelo', headers: { cookie: admin } });
    assert.equal(modelo.statusCode, 200);
    assert.match(modelo.body, /^﻿nome;email;papel/);
    const simulado = await importar(admin, { csv: modelo.body, simular: true });
    assert.equal(simulado.json().criar, 2);
  });
});

describe('entregas das integrações', () => {
  let ambiente: Ambiente;
  let admin: string;
  let servidor: Server;
  let url = '';
  let integracao = '';
  const recebidos: { corpo: string; cabecalhos: IncomingHttpHeaders }[] = [];
  let respostas: number[] = [];

  before(async () => {
    ambiente = await criarAmbiente();
    admin = await entrar(ambiente.app);
    servidor = createServer((requisicao, resposta) => {
      let corpo = '';
      requisicao.on('data', (pedaco) => {
        corpo += pedaco;
      });
      requisicao.on('end', () => {
        recebidos.push({ corpo, cabecalhos: requisicao.headers });
        resposta.statusCode = respostas.shift() ?? 200;
        resposta.end('ok');
      });
    });
    await new Promise<void>((resolver) => servidor.listen(0, '127.0.0.1', resolver));
    url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/gancho`;
    const { linhas } = await ambiente.banco.consultar<{ id: string }>(`select id from integracoes where provedor = 'webhook'`);
    integracao = linhas[0].id;
    const configurada = await ambiente.app.inject({
      method: 'PATCH',
      url: `/api/v1/integracoes/${integracao}`,
      headers: cabecalhos(admin),
      payload: { ativo: true, config: { url, segredo: 'segredo-de-assinatura-123' } },
    });
    assert.equal(configurada.statusCode, 200, configurada.body);
  });

  after(async () => {
    await ambiente.fechar();
    await new Promise((resolver) => servidor.close(resolver));
  });

  const listar = async (consulta = '') => {
    const resposta = await ambiente.app.inject({ method: 'GET', url: `/api/v1/integracoes/${integracao}/entregas${consulta}`, headers: { cookie: admin } });
    assert.equal(resposta.statusCode, 200, resposta.body);
    return resposta.json();
  };

  it('registra a entrega assinada e agenda nova tentativa quando o destino falha', async () => {
    respostas = [500];
    await dispararIntegracoes(ambiente.banco, ambiente.config.segredoJwt, ambiente.app.log, 'transacao.paga', 'Pagamento de teste', { valor: 100 });
    const pendentes = await listar('?status=pendente');
    assert.equal(pendentes.total, 1);
    const entrega = pendentes.itens[0];
    assert.equal(entrega.tentativas, 1);
    assert.equal(entrega.codigoHttp, 500);
    assert.match(entrega.erro, /500/);
    assert.ok(new Date(entrega.proximaTentativa).getTime() > Date.now());
    const primeiro = recebidos.at(-1);
    assert.equal(primeiro?.cabecalhos['x-bento-entrega'], entrega.id);
    assert.equal(primeiro?.cabecalhos['x-bento-tentativa'], '1');
    const assinatura = createHmac('sha256', 'segredo-de-assinatura-123').update(primeiro?.corpo ?? '').digest('hex');
    assert.equal(primeiro?.cabecalhos['x-bento-assinatura'], `sha256=${assinatura}`);
    assert.equal(JSON.parse(primeiro?.corpo ?? '{}').entrega, entrega.id);

    await ambiente.banco.consultar(`update entregas_integracao set proxima_tentativa = now() - interval '1 second' where id = $1`, [entrega.id]);
    respostas = [204];
    assert.equal(await processarEntregasPendentes(ambiente.banco, ambiente.config.segredoJwt, ambiente.app.log), 1);
    const entregues = await listar('?status=entregue');
    assert.equal(entregues.itens[0].id, entrega.id);
    assert.equal(entregues.itens[0].tentativas, 2);
    assert.equal(entregues.itens[0].codigoHttp, 204);
    assert.equal(recebidos.at(-1)?.cabecalhos['x-bento-tentativa'], '2');
    assert.equal(JSON.parse(recebidos.at(-1)?.corpo ?? '{}').criadoEm, JSON.parse(primeiro?.corpo ?? '{}').criadoEm);
  });

  it('desiste depois do limite de tentativas e permite reenviar na hora', async () => {
    respostas = [503, 503, 503, 503];
    await dispararIntegracoes(ambiente.banco, ambiente.config.segredoJwt, ambiente.app.log, 'usuario.criado', 'Cadastro de teste', { id: 'x' });
    const { linhas } = await ambiente.banco.consultar<{ id: string }>(`select id from entregas_integracao where evento = 'usuario.criado' order by criado_em desc limit 1`);
    const id = linhas[0].id;
    for (let tentativa = 0; tentativa < 3; tentativa += 1) {
      await ambiente.banco.consultar(`update entregas_integracao set proxima_tentativa = now() - interval '1 second' where id = $1`, [id]);
      await processarEntregasPendentes(ambiente.banco, ambiente.config.segredoJwt, ambiente.app.log);
    }
    const falhas = await listar('?status=falhou');
    assert.equal(falhas.itens[0].id, id);
    assert.equal(falhas.itens[0].tentativas, 4);
    assert.equal(falhas.resumo.falhou >= 1, true);

    respostas = [200];
    const reenvio = await ambiente.app.inject({
      method: 'POST',
      url: `/api/v1/integracoes/${integracao}/entregas/${id}/reenviar`,
      headers: cabecalhos(admin),
    });
    assert.equal(reenvio.statusCode, 200, reenvio.body);
    assert.equal(reenvio.json().status, 'entregue');
    const outra = await ambiente.app.inject({
      method: 'POST',
      url: `/api/v1/integracoes/${integracao}/entregas/00000000-0000-4000-8000-000000000000/reenviar`,
      headers: cabecalhos(admin),
    });
    assert.equal(outra.statusCode, 404);
  });

  it('o teste da integração também entra no histórico', async () => {
    respostas = [200];
    const teste = await ambiente.app.inject({ method: 'POST', url: `/api/v1/integracoes/${integracao}/testar`, headers: cabecalhos(admin) });
    assert.equal(teste.json().ok, true);
    const lista = await listar();
    assert.equal(lista.itens[0].teste, true);
    assert.equal(lista.itens[0].evento, 'integracao.teste');
    const analista = await entrar(ambiente.app, 'analista@bento.local');
    const proibido = await ambiente.app.inject({ method: 'GET', url: `/api/v1/integracoes/${integracao}/entregas`, headers: { cookie: analista } });
    assert.equal(proibido.statusCode, 403);
  });
});

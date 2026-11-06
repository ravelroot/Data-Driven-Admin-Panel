import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { cabecalhos, criarAmbiente, entrar, type Ambiente } from './auxiliar.js';

const TOKEN = 'token-do-motor-com-mais-de-24-caracteres';

interface Recebido {
  caminho: string;
  token: string | undefined;
  corpo: Record<string, unknown>;
}

function lerCorpo(requisicao: IncomingMessage): Promise<string> {
  return new Promise((resolver) => {
    const partes: Buffer[] = [];
    requisicao.on('data', (parte: Buffer) => partes.push(parte));
    requisicao.on('end', () => resolver(Buffer.concat(partes).toString('utf8')));
  });
}

function criarMotorFalso(recebidos: Recebido[]): Server {
  return createServer(async (requisicao, resposta) => {
    const texto = await lerCorpo(requisicao);
    const corpo = texto ? (JSON.parse(texto) as Record<string, unknown>) : {};
    const token = requisicao.headers['x-bento-token'] as string | undefined;
    recebidos.push({ caminho: requisicao.url ?? '', token, corpo });
    const enviar = (status: number, dados: unknown, tipo = 'application/json') => {
      resposta.writeHead(status, { 'content-type': tipo });
      resposta.end(typeof dados === 'string' || Buffer.isBuffer(dados) ? dados : JSON.stringify(dados));
    };
    if (token !== TOKEN) return enviar(401, { erro: 'HTTP_401', mensagem: 'Token inválido.' });
    if (requisicao.url === '/saude') return enviar(200, { status: 'ok', versao: '1.6.0', bibliotecas: { numpy: '2' } });
    if (requisicao.url === '/v1/analise') {
      const assinaturas = corpo.assinaturas as { id: string }[];
      const primeiro = assinaturas[0].id;
      return enviar(200, {
        previsoes: { series: [], mrr: null },
        risco: { clientes: [{ id: primeiro, probabilidade: 0.4 }] },
        segmentos: { segmentos: [{ exemplos: [assinaturas[1].id] }] },
        coortes: null,
        ltv: [],
        simulador: { ativos: 100, arpu: 10_000, churn: 0.03, novos: 8, mrr: 1_000_000 },
        qualidade: { verificacoes: [{ codigo: 'sem_canal', exemplos: [assinaturas[2].id] }, { codigo: 'dias_vazios', exemplos: ['2026-01-01'] }] },
        avisos: [],
        tempos: {},
        referencia: corpo.referencia,
        gerado_em: new Date().toISOString(),
        duracao_ms: 5,
        versao: '1.6.0',
      });
    }
    if (requisicao.url === '/v1/simulador') return enviar(200, { resumo: { recebido: corpo } });
    if (requisicao.url === '/v1/relatorio') return enviar(200, Buffer.from('PK-planilha'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    if (requisicao.url === '/v1/planilha') return enviar(422, { erro: 'DADOS_INVALIDOS', mensagem: 'Envie um arquivo .xlsx ou .csv.' });
    return enviar(404, { erro: 'HTTP_404' });
  });
}

describe('inteligência sem motor configurado', () => {
  let ambiente: Ambiente;
  let cookie: string;

  before(async () => {
    ambiente = await criarAmbiente();
    cookie = await entrar(ambiente.app);
  });
  after(async () => ambiente.fechar());

  it('informa que o motor está desligado e responde 503 nas análises', async () => {
    const estado = await ambiente.app.inject({ method: 'GET', url: '/api/v1/ciencia/estado', headers: cabecalhos(cookie) });
    assert.equal(estado.statusCode, 200);
    assert.equal(estado.json().configurado, false);
    const analise = await ambiente.app.inject({ method: 'GET', url: '/api/v1/ciencia/analise', headers: cabecalhos(cookie) });
    assert.equal(analise.statusCode, 503);
    assert.equal(analise.json().erro.codigo, 'INDISPONIVEL');
  });

  it('exige permissão de analytics', async () => {
    const suporte = await entrar(ambiente.app, 'suporte@bento.local');
    const resposta = await ambiente.app.inject({ method: 'GET', url: '/api/v1/ciencia/analise', headers: cabecalhos(suporte) });
    assert.equal(resposta.statusCode, 403);
  });
});

describe('inteligência com motor analítico', () => {
  let ambiente: Ambiente;
  let cookie: string;
  let servidor: Server;
  const recebidos: Recebido[] = [];

  before(async () => {
    servidor = criarMotorFalso(recebidos);
    await new Promise<void>((resolver) => servidor.listen(0, '127.0.0.1', resolver));
    const { port } = servidor.address() as AddressInfo;
    ambiente = await criarAmbiente({ analise: { url: `http://127.0.0.1:${port}`, token: TOKEN, timeoutMs: 10_000, cacheMinutos: 10 } });
    cookie = await entrar(ambiente.app);
  });
  after(async () => {
    await ambiente.fechar();
    await new Promise((resolver) => servidor.close(resolver));
  });

  it('envia os dados minimizados, enriquece com nomes e usa o cache', async () => {
    const resposta = await ambiente.app.inject({ method: 'GET', url: '/api/v1/ciencia/analise', headers: cabecalhos(cookie) });
    assert.equal(resposta.statusCode, 200, resposta.body);
    const corpo = resposta.json();
    assert.equal(corpo.emCache, false);
    const pedido = recebidos.find((item) => item.caminho === '/v1/analise')!;
    assert.equal(pedido.token, TOKEN);
    const texto = JSON.stringify(pedido.corpo);
    assert.doesNotMatch(texto, /@/);
    assert.doesNotMatch(texto, /usuario/);
    const { linhas } = await ambiente.banco.consultar<{ total: number }>('select count(*)::int as total from assinaturas');
    const assinaturas = pedido.corpo.assinaturas as { id: string }[];
    assert.equal(assinaturas.length, linhas[0].total);
    const eventos = pedido.corpo.eventos as [number, string, string, number, string][];
    assert.ok(eventos.length > 0);
    assert.ok(eventos.every(([indice, dia]) => indice >= 0 && indice < assinaturas.length && /^\d{4}-\d{2}-\d{2}$/.test(dia)));
    assert.ok((pedido.corpo.diario as unknown[]).length > 300);
    const ids = Object.keys(corpo.clientes);
    assert.equal(ids.length, 3);
    assert.ok(ids.includes(assinaturas[0].id));
    assert.ok(corpo.clientes[assinaturas[0].id].nome);
    assert.equal(corpo.volumes.assinaturas, assinaturas.length);
    const segunda = await ambiente.app.inject({ method: 'GET', url: '/api/v1/ciencia/analise', headers: cabecalhos(cookie) });
    assert.equal(segunda.json().emCache, true);
    assert.equal(recebidos.filter((item) => item.caminho === '/v1/analise').length, 1);
    const forcada = await ambiente.app.inject({ method: 'GET', url: '/api/v1/ciencia/analise?atualizar=1', headers: cabecalhos(cookie) });
    assert.equal(forcada.json().emCache, true);
    assert.equal(recebidos.filter((item) => item.caminho === '/v1/analise').length, 1);
    assert.equal(corpo.clientes[assinaturas[0].id].email, undefined);
  });

  it('esconde os nomes de quem não pode ver usuários', async () => {
    const { linhas } = await ambiente.banco.consultar<{ id: string }>(`select id::text as id from usuarios where email = 'analista@bento.local'`);
    await ambiente.banco.consultar(`insert into usuario_permissoes (usuario_id, permissao, concedida) values ($1, 'usuarios.ver', false)`, [linhas[0].id]);
    const analista = await entrar(ambiente.app, 'analista@bento.local');
    const resposta = await ambiente.app.inject({ method: 'GET', url: '/api/v1/ciencia/analise', headers: cabecalhos(analista) });
    assert.equal(resposta.statusCode, 200);
    assert.deepEqual(resposta.json().clientes, {});
  });

  it('mostra o estado do motor', async () => {
    const resposta = await ambiente.app.inject({ method: 'GET', url: '/api/v1/ciencia/estado', headers: cabecalhos(cookie) });
    const corpo = resposta.json();
    assert.equal(corpo.configurado, true);
    assert.equal(corpo.disponivel, true);
    assert.equal(corpo.versao, '1.6.0');
  });

  it('simula cenários a partir da base calculada e valida limites', async () => {
    const resposta = await ambiente.app.inject({ method: 'POST', url: '/api/v1/ciencia/simulador', headers: cabecalhos(cookie), payload: { preco: 10, churnPp: -0.5 } });
    assert.equal(resposta.statusCode, 200, resposta.body);
    const enviado = resposta.json().resumo.recebido;
    assert.equal(enviado.ativos, 100);
    assert.equal(enviado.preco, 10);
    assert.equal(enviado.churn_pp, -0.5);
    assert.equal(enviado.meses, 12);
    const invalido = await ambiente.app.inject({ method: 'POST', url: '/api/v1/ciencia/simulador', headers: cabecalhos(cookie), payload: { preco: 900 } });
    assert.equal(invalido.statusCode, 422);
  });

  it('exporta o relatório em Excel e registra na auditoria', async () => {
    const resposta = await ambiente.app.inject({ method: 'GET', url: '/api/v1/ciencia/relatorio', headers: cabecalhos(cookie) });
    assert.equal(resposta.statusCode, 200);
    assert.match(String(resposta.headers['content-type']), /spreadsheetml/);
    assert.match(String(resposta.headers['content-disposition']), /bento-inteligencia-\d{4}-\d{2}-\d{2}\.xlsx/);
    const pedido = recebidos.find((item) => item.caminho === '/v1/relatorio')!;
    assert.equal((pedido.corpo.analise as Record<string, unknown>).clientes, undefined);
    assert.ok(Object.values(pedido.corpo.nomes as Record<string, string>).length >= 1);
    const { linhas } = await ambiente.banco.consultar<{ total: number }>(`select count(*)::int as total from auditoria where acao = 'inteligencia.exportada'`);
    assert.equal(linhas[0].total, 1);
  });

  it('valida a planilha antes de enviar e repassa a recusa do motor', async () => {
    const extensao = await ambiente.app.inject({ method: 'POST', url: '/api/v1/ciencia/planilha', headers: cabecalhos(cookie), payload: { nome: 'virus.exe', conteudo: 'QUJD' } });
    assert.equal(extensao.statusCode, 422);
    const base64 = await ambiente.app.inject({ method: 'POST', url: '/api/v1/ciencia/planilha', headers: cabecalhos(cookie), payload: { nome: 'lista.csv', conteudo: 'não é base64' } });
    assert.equal(base64.statusCode, 422);
    const repassada = await ambiente.app.inject({ method: 'POST', url: '/api/v1/ciencia/planilha', headers: cabecalhos(cookie), payload: { nome: 'lista.csv', conteudo: 'QUJD' } });
    assert.equal(repassada.statusCode, 422);
    assert.equal(repassada.json().erro.mensagem, 'Envie um arquivo .xlsx ou .csv.');
  });

  it('trata token recusado como motor indisponível', async () => {
    const outro = await criarAmbiente({ analise: { ...ambiente.config.analise, token: 'outro-token-com-mais-de-24-caracteres' } });
    try {
      const login = await entrar(outro.app);
      const antes = recebidos.length;
      const resposta = await outro.app.inject({ method: 'GET', url: '/api/v1/ciencia/analise', headers: cabecalhos(login) });
      assert.equal(resposta.statusCode, 503);
      assert.match(resposta.json().erro.mensagem, /token/);
      const repetida = await outro.app.inject({ method: 'GET', url: '/api/v1/ciencia/analise', headers: cabecalhos(login) });
      assert.equal(repetida.statusCode, 503);
      assert.equal(recebidos.length, antes + 1);
    } finally {
      await outro.fechar();
    }
  });
});

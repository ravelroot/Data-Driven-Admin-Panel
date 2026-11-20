import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { lerConfig, sugerirVariavel, variaveisDesconhecidas } from '../src/config.js';
import { dispararIntegracoes, montarEnvio } from '../src/integracoes.js';
import { simuladorDeveRodar } from '../src/operacao/ajustes.js';
import { cabecalhos, criarAmbiente, entrar, type Ambiente } from './auxiliar.js';

process.env.BENTO_INTEGRACOES_REDE_INTERNA = '1';

describe('variáveis do .env com nome errado', () => {
  it('sugere o nome certo para erros de digitação', () => {
    assert.equal(sugerirVariavel('BENTO_PORTAA'), 'BENTO_PORTA');
    assert.equal(sugerirVariavel('BENTO_BACKUP_AUTOMATCO'), 'BENTO_BACKUP_AUTOMATICO');
    assert.equal(sugerirVariavel('bento_simulador'), 'BENTO_SIMULADOR');
    assert.equal(sugerirVariavel('BENTO_ALGO_QUE_NAO_EXISTE_AQUI'), null);
  });

  it('avisa só sobre variáveis BENTO_ desconhecidas', () => {
    const avisos = variaveisDesconhecidas({ BENTO_SIMULADO: 'true', BENTO_PORTA: '8080', PATH: '/bin', BENTO_XYZ_QUALQUER_NOME: '1' });
    assert.equal(avisos.length, 2);
    assert.match(avisos[0], /BENTO_SIMULADO .*BENTO_SIMULADOR\?/);
    assert.match(avisos[1], /BENTO_XYZ_QUALQUER_NOME .*\.env\.example/);
  });

  it('o aviso chega à configuração lida', () => {
    const antes = process.env.BENTO_RETENCAO_NOTIFICACAO;
    process.env.BENTO_RETENCAO_NOTIFICACAO = '10';
    try {
      const config = lerConfig({ dirDados: 'memoria', segredoJwt: 'segredo-de-teste-com-tamanho-suficiente-para-jwt' });
      assert.ok(config.avisos.some((aviso) => aviso.includes('BENTO_RETENCAO_NOTIFICACOES')));
      assert.equal(config.retencao.notificacoesDias, 180);
    } finally {
      if (antes === undefined) delete process.env.BENTO_RETENCAO_NOTIFICACAO;
      else process.env.BENTO_RETENCAO_NOTIFICACAO = antes;
    }
  });
});

describe('simulador automático', () => {
  it('roda sozinho só com os dados de demonstração e respeita o .env', () => {
    const permitido = { simulador: true } as Parameters<typeof simuladorDeveRodar>[0];
    const proibido = { simulador: false } as Parameters<typeof simuladorDeveRodar>[0];
    assert.equal(simuladorDeveRodar(permitido, 'auto', true), true);
    assert.equal(simuladorDeveRodar(permitido, 'auto', false), false);
    assert.equal(simuladorDeveRodar(permitido, 'ligado', false), true);
    assert.equal(simuladorDeveRodar(permitido, 'desligado', true), false);
    assert.equal(simuladorDeveRodar(proibido, 'ligado', true), false);
  });
});

describe('operação ajustada pelo painel', () => {
  let ambiente: Ambiente;
  let admin: string;
  let gerente: string;
  let pasta: string;

  before(async () => {
    pasta = mkdtempSync(path.join(tmpdir(), 'bento-operacao-'));
    ambiente = await criarAmbiente({
      backup: { automatico: 'diario', manter: 7, pasta },
      retencao: { notificacoesDias: 180, relatoriosDias: 90, auditoriaDias: 0, sessoesDias: 30, entregasDias: 30, alertasDias: 180 },
    });
    admin = await entrar(ambiente.app);
    gerente = await entrar(ambiente.app, 'gerente@bento.local');
  });

  after(async () => {
    await ambiente.fechar();
    rmSync(pasta, { recursive: true, force: true });
  });

  const operacao = (metodo: 'GET' | 'PUT' | 'DELETE', cookie: string, payload?: unknown) =>
    ambiente.app.inject({ method: metodo, url: '/api/v1/sistema/operacao', headers: cabecalhos(cookie), payload: payload as never });

  it('mostra os valores em vigor e os padrões do .env', async () => {
    const resposta = await operacao('GET', admin);
    assert.equal(resposta.statusCode, 200, resposta.body);
    const corpo = resposta.json();
    assert.equal(corpo.ajustes.simulador, 'auto');
    assert.equal(corpo.ajustes.backupAutomatico, 'diario');
    assert.equal(corpo.padroes.backupManter, 7);
    assert.deepEqual(corpo.alterados, []);
    assert.equal(corpo.demonstracao, true);
    assert.equal(corpo.simulador.permitido, false);
    assert.equal((await operacao('GET', gerente)).statusCode, 403);
  });

  it('salva, aplica na hora e registra na auditoria', async () => {
    const resposta = await operacao('PUT', admin, { backupAutomatico: 'semanal', backupManter: 4, retencao: { notificacoesDias: 30 } });
    assert.equal(resposta.statusCode, 200, resposta.body);
    const corpo = resposta.json();
    assert.equal(corpo.ajustes.backupAutomatico, 'semanal');
    assert.equal(corpo.ajustes.retencao.notificacoesDias, 30);
    assert.equal(corpo.ajustes.retencao.relatoriosDias, 90);
    assert.deepEqual([...corpo.alterados].sort(), ['backupAutomatico', 'backupManter', 'retencao.notificacoesDias']);
    assert.equal(ambiente.app.config.backup.automatico, 'semanal');
    assert.equal(ambiente.app.config.backup.manter, 4);
    assert.equal(ambiente.app.config.retencao.notificacoesDias, 30);

    const limpeza = await ambiente.app.inject({ method: 'GET', url: '/api/v1/sistema/limpeza', headers: cabecalhos(admin) });
    const notificacoes = limpeza.json().itens.find((item: { categoria: string }) => item.categoria === 'notificacoes');
    assert.equal(notificacoes.dias, 30);

    const segunda = await operacao('PUT', admin, { retencao: { auditoriaDias: 365 } });
    assert.equal(segunda.json().ajustes.retencao.notificacoesDias, 30);
    assert.equal(segunda.json().ajustes.retencao.auditoriaDias, 365);

    const { linhas } = await ambiente.banco.consultar(`select 1 from auditoria where acao = 'sistema.operacao_ajustada'`);
    assert.equal(linhas.length, 2);
  });

  it('recusa valores fora dos limites e campos desconhecidos', async () => {
    assert.equal((await operacao('PUT', admin, { retencao: { sessoesDias: 0 } })).statusCode, 422);
    assert.equal((await operacao('PUT', admin, { backupManter: 1000 })).statusCode, 422);
    assert.equal((await operacao('PUT', admin, { simulador: 'talvez' })).statusCode, 422);
    assert.equal((await operacao('PUT', admin, { pasta: '/etc' })).statusCode, 422);
    assert.equal((await operacao('PUT', gerente, { simulador: 'desligado' })).statusCode, 403);
  });

  it('desliga o simulador e volta tudo para o .env', async () => {
    const desligado = await operacao('PUT', admin, { simulador: 'desligado' });
    assert.equal(desligado.json().simulador.modo, 'desligado');
    assert.equal(ambiente.app.estado.operacao.simulador, 'desligado');
    const restaurado = await operacao('DELETE', admin);
    assert.equal(restaurado.statusCode, 200, restaurado.body);
    assert.deepEqual(restaurado.json().alterados, []);
    assert.equal(ambiente.app.config.backup.automatico, 'diario');
    assert.equal(ambiente.app.config.backup.manter, 7);
    assert.equal(ambiente.app.config.retencao.notificacoesDias, 180);
    assert.equal(ambiente.app.estado.operacao.simulador, 'auto');
  });
});

describe('começar com os dados reais', () => {
  let ambiente: Ambiente;
  let admin: string;
  let pasta: string;

  before(async () => {
    pasta = mkdtempSync(path.join(tmpdir(), 'bento-dados-reais-'));
    ambiente = await criarAmbiente({ backup: { automatico: 'desligado', manter: 3, pasta } });
    admin = await entrar(ambiente.app);
  });

  after(async () => {
    await ambiente.fechar();
    rmSync(pasta, { recursive: true, force: true });
  });

  let ip = 10;
  const encerrar = (cookie: string, payload: Record<string, unknown>) =>
    ambiente.app.inject({ method: 'POST', url: '/api/v1/sistema/demonstracao/encerrar', headers: cabecalhos(cookie), payload, remoteAddress: `10.0.0.${(ip += 1)}` });

  const valido = { nome: 'Marina Prado', email: 'Marina@MinhaEmpresa.com', senha: 'senha-real-forte-2026', senhaAtual: 'bento123', nomeEmpresa: 'Minha Empresa' };

  it('mostra o que é demonstração e põe o passo no topo dos primeiros passos', async () => {
    const resumo = await ambiente.app.inject({ method: 'GET', url: '/api/v1/sistema/demonstracao', headers: cabecalhos(admin) });
    assert.equal(resumo.statusCode, 200, resumo.body);
    assert.equal(resumo.json().ativa, true);
    assert.ok(resumo.json().clientes > 0);
    assert.ok(resumo.json().transacoes > 0);
    const passos = await ambiente.app.inject({ method: 'GET', url: '/api/v1/sistema/primeiros-passos', headers: cabecalhos(admin) });
    assert.equal(passos.json().passos[0].id, 'dados-reais');
    const saude = await ambiente.app.inject({ method: 'GET', url: '/api/v1/saude' });
    assert.equal(saude.json().demonstracao, true);
  });

  it('exige a senha atual, um e-mail real e a permissão de sistema', async () => {
    assert.equal((await encerrar(admin, { ...valido, senhaAtual: 'errada' })).statusCode, 401);
    assert.equal((await encerrar(admin, { ...valido, email: 'eu@bento.local' })).statusCode, 422);
    assert.equal((await encerrar(admin, { ...valido, senha: 'curta' })).statusCode, 422);
    const gerente = await entrar(ambiente.app, 'gerente@bento.local');
    assert.equal((await encerrar(gerente, valido)).statusCode, 403);
    const { linhas } = await ambiente.banco.consultar<{ total: number }>('select count(*)::int as total from transacoes');
    assert.ok(linhas[0].total > 0);
  });

  it('faz backup, apaga os exemplos, troca a conta e encerra as sessões', async () => {
    const resposta = await encerrar(admin, valido);
    assert.equal(resposta.statusCode, 200, resposta.body);
    const corpo = resposta.json();
    assert.match(corpo.backup, /^bento-backup-\d{8}-\d{6}-demonstracao\.ndjson\.gz$/);
    assert.ok(readdirSync(pasta).includes(corpo.backup));
    assert.equal(corpo.email, 'marina@minhaempresa.com');
    assert.ok(corpo.removidos.transacoes > 0);
    assert.ok(resposta.cookies.some((cookie) => cookie.name === 'bento_sessao' && !cookie.value));

    const contagens = await ambiente.banco.consultar<{ usuarios: number; transacoes: number; assinaturas: number; auditoria: number }>(
      `select (select count(*) from usuarios)::int as usuarios, (select count(*) from transacoes)::int as transacoes,
              (select count(*) from assinaturas)::int as assinaturas, (select count(*) from auditoria)::int as auditoria`,
    );
    assert.deepEqual(contagens.linhas[0], { usuarios: 1, transacoes: 0, assinaturas: 0, auditoria: 1 });
    assert.equal(ambiente.app.estado.demonstracao, false);

    const antiga = await ambiente.app.inject({ method: 'GET', url: '/api/v1/auth/eu', headers: cabecalhos(admin) });
    assert.equal(antiga.statusCode, 401);
    const recusada = await ambiente.app.inject({ method: 'POST', url: '/api/v1/auth/entrar', payload: { email: 'admin@bento.local', senha: 'bento123' } });
    assert.equal(recusada.statusCode, 401);

    const nova = await entrar(ambiente.app, 'marina@minhaempresa.com', valido.senha);
    const eu = await ambiente.app.inject({ method: 'GET', url: '/api/v1/auth/eu', headers: cabecalhos(nova) });
    assert.equal(eu.json().usuario.nome, 'Marina Prado');
    assert.equal(eu.json().usuario.papel.codigo, 'admin');
    const sistema = await ambiente.app.inject({ method: 'GET', url: '/api/v1/configuracoes/sistema', headers: cabecalhos(nova) });
    assert.equal(sistema.json().nomeEmpresa, 'Minha Empresa');

    const passos = await ambiente.app.inject({ method: 'GET', url: '/api/v1/sistema/primeiros-passos', headers: cabecalhos(nova) });
    assert.ok(!passos.json().passos.some((passo: { id: string }) => passo.id === 'dados-reais'));
    const saude = await ambiente.app.inject({ method: 'GET', url: '/api/v1/saude' });
    assert.equal(saude.json().demonstracao, false);
    const operacao = await ambiente.app.inject({ method: 'GET', url: '/api/v1/sistema/operacao', headers: cabecalhos(nova) });
    assert.equal(operacao.json().demonstracao, false);

    const repetida = await encerrar(nova, { ...valido, senhaAtual: valido.senha });
    assert.equal(repetida.statusCode, 409);
  });
});

describe('integrações fáceis', () => {
  let ambiente: Ambiente;
  let admin: string;
  let servidor: Server;
  let endereco: string;
  const recebidos: { cabecalhos: IncomingHttpHeaders; corpo: string }[] = [];

  before(async () => {
    servidor = createServer((requisicao, resposta) => {
      let corpo = '';
      requisicao.on('data', (pedaco) => {
        corpo += pedaco;
      });
      requisicao.on('end', () => {
        recebidos.push({ cabecalhos: requisicao.headers, corpo });
        resposta.writeHead(200).end('ok');
      });
    });
    await new Promise<void>((pronto) => servidor.listen(0, '127.0.0.1', pronto));
    endereco = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/gancho`;
    ambiente = await criarAmbiente();
    admin = await entrar(ambiente.app);
  });

  after(async () => {
    await ambiente.fechar();
    await new Promise<void>((pronto) => servidor.close(() => pronto()));
  });

  const listar = async () => (await ambiente.app.inject({ method: 'GET', url: '/api/v1/integracoes', headers: cabecalhos(admin) })).json();
  const atualizar = (id: string, payload: unknown) =>
    ambiente.app.inject({ method: 'PATCH', url: `/api/v1/integracoes/${id}`, headers: cabecalhos(admin), payload: payload as never });

  it('traz Teams, Google Chat e Telegram com passo a passo', async () => {
    const lista = await listar();
    for (const provedor of ['teams', 'google-chat', 'telegram']) {
      const integracao = lista.find((item: { provedor: string }) => item.provedor === provedor);
      assert.ok(integracao, provedor);
      assert.equal(integracao.enviaEventos, true);
      assert.ok(integracao.guia.passos.length >= 3);
      assert.match(integracao.guia.documentacao, /^https:\/\//);
      assert.equal(integracao.eventos.length, 5);
    }
    const webhook = lista.find((item: { provedor: string }) => item.provedor === 'webhook');
    assert.equal(webhook.exemplo.evento, 'transacao.paga');
    const stripe = lista.find((item: { provedor: string }) => item.provedor === 'stripe');
    assert.equal(stripe.enviaEventos, false);
    assert.ok(stripe.campos.every((campo: { obrigatorio: boolean }) => typeof campo.obrigatorio === 'boolean'));
  });

  it('valida o token e o chat do Telegram e guarda o token cifrado', async () => {
    const telegram = (await listar()).find((item: { provedor: string }) => item.provedor === 'telegram');
    const ruim = await atualizar(telegram.id, { config: { tokenBot: 'abc', chatId: '-1001234567890' } });
    assert.equal(ruim.statusCode, 422);
    const token = `123456789:${'A'.repeat(35)}`;
    const bom = await atualizar(telegram.id, { config: { tokenBot: token, chatId: '-1001234567890' } });
    assert.equal(bom.statusCode, 200, bom.body);
    assert.ok(bom.json().campos.find((campo: { nome: string }) => campo.nome === 'tokenBot').valor.startsWith('••••'));
    const { linhas } = await ambiente.banco.consultar<{ config: Record<string, string> }>(`select config from integracoes where provedor = 'telegram'`);
    assert.notEqual(linhas[0].config.tokenBot, token);
  });

  it('monta a mensagem certa para cada serviço', () => {
    const teams = montarEnvio('teams', { webhookUrl: 'https://exemplo.webhook.office.com/x' }, 'transacao.paga', 'Ana pagou R$ 10,00', {});
    const cartao = JSON.parse(teams?.corpo ?? '{}');
    assert.equal(cartao.attachments[0].contentType, 'application/vnd.microsoft.card.adaptive');
    assert.equal(cartao.attachments[0].content.body[1].text, 'Ana pagou R$ 10,00');
    const chat = montarEnvio('google-chat', { webhookUrl: 'https://chat.googleapis.com/v1/spaces/x' }, 'usuario.criado', 'Novo cadastro: Ana', {});
    assert.match(JSON.parse(chat?.corpo ?? '{}').text, /Novo cadastro/);
    const telegram = montarEnvio('telegram', { tokenBot: '123:abc', chatId: '-100' }, 'alerta.disparado', 'Receita caiu', {});
    assert.equal(telegram?.url, 'https://api.telegram.org/bot123:abc/sendMessage');
    assert.equal(JSON.parse(telegram?.corpo ?? '{}').chat_id, '-100');
    const webhook = montarEnvio('webhook', { url: 'https://exemplo.com', segredo: 'segredo-bem-longo' }, 'transacao.paga', 'x', { a: 1 });
    const assinatura = createHmac('sha256', 'segredo-bem-longo').update(webhook?.corpo ?? '').digest('hex');
    assert.equal(webhook?.cabecalhos['x-bento-assinatura'], `sha256=${assinatura}`);
    assert.equal(montarEnvio('stripe', {}, 'transacao.paga', 'x', {}), null);
  });

  it('envia só os eventos escolhidos', async () => {
    const webhook = (await listar()).find((item: { provedor: string }) => item.provedor === 'webhook');
    assert.equal((await atualizar(webhook.id, { eventos: [] })).statusCode, 422);
    const resposta = await atualizar(webhook.id, { ativo: true, config: { url: endereco, segredo: 'segredo-do-teste-123' }, eventos: ['usuario.criado'] });
    assert.equal(resposta.statusCode, 200, resposta.body);
    assert.deepEqual(resposta.json().eventos, ['usuario.criado']);

    recebidos.length = 0;
    await dispararIntegracoes(ambiente.banco, ambiente.config.segredoJwt, ambiente.app.log, 'transacao.paga', 'Não deve chegar', {});
    assert.equal(recebidos.length, 0);
    await dispararIntegracoes(ambiente.banco, ambiente.config.segredoJwt, ambiente.app.log, 'usuario.criado', 'Novo cadastro: Ana', { id: 1 });
    assert.equal(recebidos.length, 1);
    assert.equal(recebidos[0].cabecalhos['x-bento-evento'], 'usuario.criado');

    const todos = await atualizar(webhook.id, { eventos: ['transacao.paga', 'usuario.criado', 'usuario.bloqueado', 'relatorio.gerado', 'alerta.disparado'] });
    assert.equal(todos.json().eventos.length, 5);
    const { linhas } = await ambiente.banco.consultar<{ eventos: string[] }>(`select eventos from integracoes where provedor = 'webhook'`);
    assert.deepEqual(linhas[0].eventos, []);
  });
});

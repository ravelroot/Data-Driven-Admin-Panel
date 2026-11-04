import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { reservarTarefa } from '../src/agendador.js';
import { lerConfig } from '../src/config.js';
import { cabecalhos, criarAmbiente, entrar, type Ambiente } from './auxiliar.js';

const TOKEN_METRICAS = 'token-de-metricas-para-os-testes-123';

describe('operação: saúde, métricas, diagnóstico, manutenção, retenção e preferências', () => {
  let ambiente: Ambiente;
  let admin: string;
  let suporte: string;
  let analista: string;
  let pastaBackups: string;

  before(async () => {
    pastaBackups = mkdtempSync(path.join(tmpdir(), 'bento-operacao-'));
    ambiente = await criarAmbiente({
      metricasToken: TOKEN_METRICAS,
      backup: { automatico: 'desligado', manter: 3, pasta: pastaBackups },
    });
    admin = await entrar(ambiente.app);
    suporte = await entrar(ambiente.app, 'suporte@bento.local');
    analista = await entrar(ambiente.app, 'analista@bento.local');
  });

  after(async () => {
    await ambiente.fechar();
    rmSync(pastaBackups, { recursive: true, force: true });
  });

  const pedir = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, cookie: string, payload?: unknown) =>
    ambiente.app.inject({
      method,
      url: `/api/v1${url}`,
      headers: method === 'GET' ? { cookie } : cabecalhos(cookie),
      ...(payload === undefined ? {} : { payload }),
    });

  it('responde às sondas de vida e prontidão sem sessão', async () => {
    const vivo = await ambiente.app.inject({ method: 'GET', url: '/api/v1/saude/vivo' });
    assert.equal(vivo.statusCode, 200);
    assert.deepEqual(vivo.json(), { status: 'ok' });
    const pronto = await ambiente.app.inject({ method: 'GET', url: '/api/v1/saude/pronto' });
    assert.equal(pronto.statusCode, 200, pronto.body);
    assert.equal(pronto.json().status, 'pronto');
    ambiente.app.estado.encerrando = true;
    const encerrando = await ambiente.app.inject({ method: 'GET', url: '/api/v1/saude/pronto' });
    ambiente.app.estado.encerrando = false;
    assert.equal(encerrando.statusCode, 503);
    assert.match(encerrando.json().motivos[0], /encerrando/);
  });

  it('devolve o X-Request-Id recebido ou gera um novo', async () => {
    const recebido = await ambiente.app.inject({ method: 'GET', url: '/api/v1/saude/vivo', headers: { 'x-request-id': 'pedido-de-teste-123' } });
    assert.equal(recebido.headers['x-request-id'], 'pedido-de-teste-123');
    const invalido = await ambiente.app.inject({ method: 'GET', url: '/api/v1/saude/vivo', headers: { 'x-request-id': 'x' } });
    assert.match(String(invalido.headers['x-request-id']), /^[0-9a-f-]{36}$/);
  });

  it('expõe métricas do Prometheus só com o token certo', async () => {
    assert.equal((await ambiente.app.inject({ method: 'GET', url: '/api/v1/metricas' })).statusCode, 401);
    const errado = await ambiente.app.inject({ method: 'GET', url: '/api/v1/metricas', headers: { authorization: 'Bearer outro-token-qualquer-123456' } });
    assert.equal(errado.statusCode, 401);
    const certo = await ambiente.app.inject({ method: 'GET', url: '/api/v1/metricas', headers: { authorization: `Bearer ${TOKEN_METRICAS}` } });
    assert.equal(certo.statusCode, 200);
    assert.match(String(certo.headers['content-type']), /^text\/plain/);
    assert.match(certo.body, /bento_requisicoes_total\{metodo="GET",rota="\/api\/v1\/saude\/vivo",status="200"\} \d+/);
    assert.match(certo.body, /bento_requisicao_duracao_segundos_bucket\{rota="[^"]+",le="\+Inf"\}/);
    assert.match(certo.body, /bento_info\{versao="\d+\.\d+\.\d+",banco="pglite"/);
    assert.match(certo.body, /bento_usuarios\{status="ativo"\} \d+/);
  });

  it('diagnóstico aponta as senhas de demonstração e só abre para quem configura o sistema', async () => {
    assert.equal((await pedir('GET', '/sistema/diagnostico', analista)).statusCode, 403);
    const resposta = await pedir('GET', '/sistema/diagnostico', admin);
    assert.equal(resposta.statusCode, 200);
    const corpo = resposta.json();
    const porId = new Map(corpo.verificacoes.map((item: { id: string }) => [item.id, item]));
    assert.equal((porId.get('senha-demonstracao') as { status: string }).status, 'aviso');
    assert.equal((porId.get('migracoes') as { status: string }).status, 'ok');
    assert.equal((porId.get('administradores') as { status: string }).status, 'ok');
    assert.equal(corpo.resumo.erro, 0);
  });

  it('modo de manutenção bloqueia alterações de quem não administra e libera ao encerrar', async () => {
    const usuarios = await pedir('GET', '/usuarios?papel=cliente&porPagina=1', admin);
    const alvo = usuarios.json().itens[0].id;
    assert.equal((await pedir('PUT', '/sistema/manutencao', suporte, { ativo: true })).statusCode, 403);
    const ligado = await pedir('PUT', '/sistema/manutencao', admin, { ativo: true, mensagem: 'Atualizando o banco.' });
    assert.equal(ligado.statusCode, 200, ligado.body);
    assert.equal(ligado.json().ativo, true);
    assert.equal(ligado.json().porNome.length > 0, true);

    const bloqueado = await pedir('PATCH', `/usuarios/${alvo}`, suporte, { cargo: 'Cliente VIP' });
    assert.equal(bloqueado.statusCode, 503);
    assert.equal(bloqueado.json().erro.codigo, 'MANUTENCAO');
    assert.match(bloqueado.json().erro.mensagem, /Atualizando o banco/);
    assert.equal((await pedir('GET', `/usuarios/${alvo}`, suporte)).statusCode, 200);
    assert.equal((await pedir('PUT', '/configuracoes/preferencias', suporte, { densidade: 'compacta' })).statusCode, 200);
    assert.equal((await pedir('PATCH', `/usuarios/${alvo}`, admin, { cargo: 'Cliente VIP' })).statusCode, 200);
    const eu = await pedir('GET', '/auth/eu', suporte);
    assert.equal(eu.json().sistema.manutencao.ativo, true);
    assert.equal((await entrar(ambiente.app, 'gerente@bento.local')).length > 0, true);

    const desligado = await pedir('PUT', '/sistema/manutencao', admin, { ativo: false });
    assert.equal(desligado.json().ativo, false);
    assert.equal((await pedir('PATCH', `/usuarios/${alvo}`, suporte, { cargo: 'Cliente' })).statusCode, 200);
    const auditoria = await pedir('GET', '/atividades?acao=sistema.manutencao_ativada', admin);
    assert.equal(auditoria.json().itens.length >= 1, true);
  });

  it('retenção mostra a prévia e remove notificações antigas', async () => {
    await ambiente.banco.consultar(
      `insert into notificacoes (tipo, categoria, titulo, mensagem, criado_em) values ('info', 'sistema', 'Antiga', 'Aviso muito antigo', now() - interval '400 days')`,
    );
    const previa = await pedir('GET', '/sistema/limpeza', admin);
    assert.equal(previa.statusCode, 200);
    const notificacoes = previa.json().itens.find((item: { categoria: string }) => item.categoria === 'notificacoes');
    assert.equal(notificacoes.registros >= 1, true);
    assert.equal(previa.json().itens.find((item: { categoria: string }) => item.categoria === 'auditoria').dias, 0);
    const limpeza = await pedir('POST', '/sistema/limpeza', admin);
    assert.equal(limpeza.statusCode, 200);
    assert.equal(limpeza.json().total >= 1, true);
    const { linhas } = await ambiente.banco.consultar<{ total: number }>(`select count(*)::int as total from notificacoes where titulo = 'Antiga'`);
    assert.equal(linhas[0].total, 0);
    const depois = await pedir('GET', '/sistema/limpeza', admin);
    assert.equal(depois.json().itens.find((item: { categoria: string }) => item.categoria === 'notificacoes').registros, 0);
  });

  it('primeiros passos listam o que falta para deixar o painel pronto', async () => {
    const resposta = await pedir('GET', '/sistema/primeiros-passos', admin);
    assert.equal(resposta.statusCode, 200);
    const { passos, feitos, total } = resposta.json();
    assert.equal(total, passos.length);
    assert.equal(passos.find((passo: { id: string }) => passo.id === 'senhas').feito, false);
    assert.equal(passos.find((passo: { id: string }) => passo.id === 'equipe').feito, true);
    assert.equal(feitos < total, true);
    assert.equal((await pedir('GET', '/sistema/primeiros-passos', suporte)).statusCode, 403);
  });

  it('salva as preferências de uso e as devolve na sessão', async () => {
    const salvo = await pedir('PUT', '/configuracoes/preferencias', analista, {
      paginaInicial: 'analytics',
      itensPorPagina: 50,
      movimento: 'reduzido',
      atalhosTeclado: false,
      primeirosPassosOcultos: true,
    });
    assert.equal(salvo.statusCode, 200, salvo.body);
    assert.equal(salvo.json().paginaInicial, 'analytics');
    const eu = await pedir('GET', '/auth/eu', analista);
    assert.equal(eu.json().preferencias.itensPorPagina, 50);
    assert.equal(eu.json().preferencias.atalhosTeclado, false);
    assert.equal(eu.json().preferencias.tema, 'sistema');
    assert.equal(eu.json().sistema.versao.length > 0, true);
    assert.equal((await pedir('PUT', '/configuracoes/preferencias', analista, { itensPorPagina: 30 })).statusCode, 422);
    assert.equal((await pedir('PUT', '/configuracoes/preferencias', analista, { paginaInicial: 'componentes' })).statusCode, 422);
    assert.equal((await pedir('PUT', '/configuracoes/aparencia', analista, { paleta: 'oceano' })).json().itensPorPagina, 50);
  });

  it('status do sistema traz manutenção, retenção, backups e as tabelas novas', async () => {
    const resposta = await pedir('GET', '/sistema/status', admin);
    assert.equal(resposta.statusCode, 200);
    const corpo = resposta.json();
    assert.equal(corpo.manutencao.ativo, false);
    assert.equal(corpo.retencao.notificacoesDias, 180);
    assert.equal(corpo.metricas, true);
    assert.ok(corpo.tabelas.some((tabela: { nome: string }) => tabela.nome === 'entregas_integracao'));
    assert.ok(corpo.migracoes.some((migracao: { nome: string }) => migracao.nome === '006_operacao_preferencias.sql'));
  });

  it('tarefas periódicas só rodam uma vez por intervalo', async () => {
    assert.equal(await reservarTarefa(ambiente.banco, 'tarefa:teste', 24), true);
    assert.equal(await reservarTarefa(ambiente.banco, 'tarefa:teste', 24), false);
  });
});

describe('configuração', () => {
  const guardar = (nomes: string[]) => Object.fromEntries(nomes.map((nome) => [nome, process.env[nome]]));
  const restaurar = (valores: Record<string, string | undefined>) => {
    for (const [nome, valor] of Object.entries(valores)) {
      if (valor === undefined) delete process.env[nome];
      else process.env[nome] = valor;
    }
  };

  it('valores inválidos viram avisos com o padrão no lugar', () => {
    const antes = guardar(['BENTO_PORTA', 'BENTO_SIMULADOR', 'BENTO_RETENCAO_NOTIFICACOES', 'BENTO_BACKUP_AUTOMATICO']);
    process.env.BENTO_PORTA = 'abc';
    process.env.BENTO_SIMULADOR = 'talvez';
    process.env.BENTO_RETENCAO_NOTIFICACOES = '45';
    process.env.BENTO_BACKUP_AUTOMATICO = 'diario';
    try {
      const config = lerConfig({ dirDados: 'memoria', segredoJwt: 'segredo-de-teste-com-tamanho-suficiente-para-jwt' });
      assert.equal(config.porta, 8080);
      assert.equal(config.simulador, true);
      assert.equal(config.retencao.notificacoesDias, 45);
      assert.equal(config.backup.automatico, 'diario');
      assert.ok(config.avisos.some((aviso) => aviso.startsWith('BENTO_PORTA')));
      assert.ok(config.avisos.some((aviso) => aviso.startsWith('BENTO_SIMULADOR')));
    } finally {
      restaurar(antes);
    }
  });

  it('recusa o segredo de exemplo em produção', () => {
    const antes = guardar(['BENTO_SEGREDO_JWT']);
    process.env.BENTO_SEGREDO_JWT = 'troque-esta-chave';
    try {
      assert.throws(() => lerConfig({ dirDados: 'memoria', producao: true }), /BENTO_SEGREDO_JWT/);
      const desenvolvimento = lerConfig({ dirDados: 'memoria', producao: false });
      assert.ok(desenvolvimento.avisos.some((aviso) => aviso.includes('BENTO_SEGREDO_JWT')));
    } finally {
      restaurar(antes);
    }
  });
});

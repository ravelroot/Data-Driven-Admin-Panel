import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { construirApp } from '../src/app.js';
import { enderecoInterno } from '../src/integracoes.js';
import { gerarCsv, neutralizarFormula } from '../src/relatorios/csv.js';
import { cabecalhos, criarAmbiente, entrar, type Ambiente } from './auxiliar.js';

const base64url = (valor: unknown) => Buffer.from(JSON.stringify(valor)).toString('base64url');

describe('segurança: autenticação, autorização e entradas maliciosas', () => {
  let ambiente: Ambiente;
  let admin: string;
  let gerente: string;
  let suporte: string;
  let analista: string;
  const ids: Record<string, string> = {};

  const pedir = (metodo: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, opcoes: { headers?: Record<string, string>; payload?: unknown; remoteAddress?: string } = {}) =>
    ambiente.app.inject({ method: metodo, url, headers: opcoes.headers, payload: opcoes.payload as never, remoteAddress: opcoes.remoteAddress });

  before(async () => {
    ambiente = await criarAmbiente();
    admin = await entrar(ambiente.app);
    gerente = await entrar(ambiente.app, 'gerente@bento.local');
    suporte = await entrar(ambiente.app, 'suporte@bento.local');
    analista = await entrar(ambiente.app, 'analista@bento.local');
    const { linhas } = await ambiente.banco.consultar<{ id: string; email: string }>(
      `select id, email from usuarios where email in ('admin@bento.local', 'gerente@bento.local', 'suporte@bento.local', 'analista@bento.local')`,
    );
    for (const linha of linhas) ids[linha.email.split('@')[0]] = linha.id;
    const { linhas: clientes } = await ambiente.banco.consultar<{ id: string }>(
      `select id from usuarios where papel = 'cliente' and status = 'ativo' order by criado_em limit 1`,
    );
    ids.cliente = clientes[0].id;
  });

  after(async () => {
    await ambiente.fechar();
  });

  it('rotas protegidas exigem sessão (401) e recusam credenciais inválidas', async () => {
    const rotas = [
      '/api/v1/auth/eu',
      '/api/v1/visao-geral',
      '/api/v1/analytics',
      '/api/v1/usuarios',
      '/api/v1/usuarios/exportar',
      '/api/v1/transacoes',
      '/api/v1/relatorios',
      '/api/v1/notificacoes',
      '/api/v1/configuracoes/perfil',
      '/api/v1/configuracoes/chaves-api',
      '/api/v1/configuracoes/seguranca/sessoes',
      '/api/v1/integracoes',
      '/api/v1/atividades',
      '/api/v1/busca?q=ana',
    ];
    for (const url of rotas) {
      const resposta = await pedir('GET', url);
      assert.equal(resposta.statusCode, 401, `${url} deveria exigir sessão`);
      assert.equal(resposta.json().erro.codigo, 'NAO_AUTENTICADO');
    }
    const escrita = await pedir('POST', '/api/v1/usuarios', { payload: { nome: 'Sem Sessão', email: 'sem@exemplo.com', papel: 'cliente' } });
    assert.equal(escrita.statusCode, 401);
    const cookieFalso = await pedir('GET', '/api/v1/auth/eu', { headers: { cookie: 'bento_sessao=abc.def.ghi' } });
    assert.equal(cookieFalso.statusCode, 401);
    const chaveFalsa = await pedir('GET', '/api/v1/auth/eu', { headers: { authorization: 'Bearer bnt_naoexiste0000000000000000000000000000000' } });
    assert.equal(chaveFalsa.statusCode, 401);
    const esquemaErrado = await pedir('GET', '/api/v1/auth/eu', { headers: { authorization: 'Basic YWRtaW46YmVudG8xMjM=' } });
    assert.equal(esquemaErrado.statusCode, 401);
  });

  it('recusa JWT forjado com outro segredo ou com alg "none"', async () => {
    const { linhas } = await ambiente.banco.consultar<{ id: string }>(
      'select id from sessoes where usuario_id = $1 and revogada_em is null limit 1',
      [ids.admin],
    );
    const carga = base64url({ sub: ids.admin, sid: linhas[0].id, exp: Math.floor(Date.now() / 1000) + 600 });
    const cabecalhoHs = base64url({ alg: 'HS256', typ: 'JWT' });
    const assinatura = createHmac('sha256', 'outro-segredo-qualquer').update(`${cabecalhoHs}.${carga}`).digest('base64url');
    const forjado = await pedir('GET', '/api/v1/auth/eu', { headers: { cookie: `bento_sessao=${cabecalhoHs}.${carga}.${assinatura}` } });
    assert.equal(forjado.statusCode, 401);
    const semAssinatura = `${base64url({ alg: 'none', typ: 'JWT' })}.${carga}.`;
    const nenhum = await pedir('GET', '/api/v1/auth/eu', { headers: { authorization: `Bearer ${semAssinatura}` } });
    assert.equal(nenhum.statusCode, 401);
  });

  it('papel sem a permissão recebe 403', async () => {
    const casos: [string, 'GET' | 'POST' | 'PUT' | 'DELETE', string, unknown?][] = [
      [analista, 'GET', '/api/v1/atividades'],
      [analista, 'GET', '/api/v1/integracoes'],
      [analista, 'PUT', '/api/v1/configuracoes/sistema', { nomeEmpresa: 'Invasora' }],
      [analista, 'POST', '/api/v1/notificacoes', { titulo: 'Oi', mensagem: 'Aviso indevido' }],
      [suporte, 'GET', '/api/v1/relatorios'],
      [suporte, 'GET', '/api/v1/analytics'],
      [gerente, 'PUT', '/api/v1/configuracoes/sistema', { nomeEmpresa: 'Invasora' }],
      [gerente, 'DELETE', `/api/v1/usuarios/${ids.cliente}`],
    ];
    for (const [cookie, metodo, url, payload] of casos) {
      const resposta = await pedir(metodo, url, { headers: cabecalhos(cookie), payload });
      assert.equal(resposta.statusCode, 403, `${metodo} ${url}: ${resposta.body}`);
      assert.equal(resposta.json().erro.codigo, 'SEM_PERMISSAO');
    }
  });

  it('CSRF: POST/PATCH/DELETE por cookie sem X-Bento são recusados; com chave de API passam', async () => {
    const tentativas: ['POST' | 'PATCH' | 'DELETE' | 'PUT', string, unknown?][] = [
      ['POST', '/api/v1/notificacoes/ler-todas'],
      ['PATCH', '/api/v1/configuracoes/perfil', { cidade: 'Niterói' }],
      ['PUT', '/api/v1/configuracoes/aparencia', { tema: 'escuro' }],
      ['DELETE', '/api/v1/configuracoes/seguranca/sessoes'],
    ];
    for (const [metodo, url, payload] of tentativas) {
      const sem = await pedir(metodo, url, { headers: { cookie: admin }, payload });
      assert.equal(sem.statusCode, 403, `${metodo} ${url}`);
      assert.equal(sem.json().erro.codigo, 'CSRF');
      const valorErrado = await pedir(metodo, url, { headers: { cookie: admin, 'x-bento': '0' }, payload });
      assert.equal(valorErrado.json().erro?.codigo, 'CSRF');
    }
    const criada = await pedir('POST', '/api/v1/configuracoes/chaves-api', {
      headers: cabecalhos(admin),
      payload: { nome: 'Escrita CSRF', escopos: ['leitura', 'escrita'] },
    });
    assert.equal(criada.statusCode, 201);
    const comChave = await pedir('POST', '/api/v1/notificacoes/ler-todas', { headers: { authorization: `Bearer ${criada.json().segredo}` } });
    assert.equal(comChave.statusCode, 200);
  });

  it('chave de API só leitura não escreve, fica guardada só como hash e para de valer ao ser revogada', async () => {
    const criada = await pedir('POST', '/api/v1/configuracoes/chaves-api', {
      headers: cabecalhos(admin),
      payload: { nome: 'Só leitura', escopos: ['leitura'] },
    });
    const { chave: { id }, segredo } = criada.json();
    const auth = { authorization: `Bearer ${segredo}` };
    assert.equal((await pedir('GET', '/api/v1/usuarios?porPagina=1', { headers: auth })).statusCode, 200);
    const escritas: ['POST' | 'PATCH' | 'DELETE', string, unknown?][] = [
      ['POST', '/api/v1/configuracoes/chaves-api', { nome: 'Outra', escopos: ['escrita'] }],
      ['PATCH', `/api/v1/usuarios/${ids.cliente}`, { cidade: 'Rio' }],
      ['DELETE', `/api/v1/configuracoes/chaves-api/${id}`],
      ['POST', `/api/v1/usuarios/${ids.cliente}/redefinir-senha`],
    ];
    for (const [metodo, url, payload] of escritas) {
      const resposta = await pedir(metodo, url, { headers: auth, payload });
      assert.equal(resposta.statusCode, 403, `${metodo} ${url}`);
    }
    const { linhas } = await ambiente.banco.consultar<{ segredo_hash: string }>('select segredo_hash from chaves_api where id = $1', [id]);
    assert.notEqual(linhas[0].segredo_hash, segredo);
    assert.equal(linhas[0].segredo_hash, createHash('sha256').update(segredo).digest('hex'));
    const lista = await pedir('GET', '/api/v1/configuracoes/chaves-api', { headers: { cookie: admin } });
    assert.ok(!lista.body.includes(segredo));
    assert.equal((await pedir('DELETE', `/api/v1/configuracoes/chaves-api/${id}`, { headers: cabecalhos(admin) })).statusCode, 204);
    assert.equal((await pedir('GET', '/api/v1/usuarios?porPagina=1', { headers: auth })).statusCode, 401);
  });

  it('ordenação e filtros com injeção SQL são rejeitados (422) ou inofensivos', async () => {
    const maliciosas = [
      '/api/v1/usuarios?ordenar=nome;drop%20table%20usuarios--',
      '/api/v1/usuarios?ordenar=(select%20senha_hash%20from%20usuarios%20limit%201)',
      '/api/v1/usuarios?direcao=asc;delete%20from%20sessoes',
      "/api/v1/usuarios?status=ativo'%20or%20'1'='1",
      '/api/v1/usuarios?pagina=1;drop%20table%20usuarios',
      '/api/v1/usuarios?porPagina=100000',
      '/api/v1/transacoes?ordenar=valor%20desc,(select%201)',
      "/api/v1/transacoes?inicio=2026-01-01'%20or%201=1--",
      "/api/v1/transacoes?metodo=pix'--",
      '/api/v1/atividades?usuario=1%20or%201=1',
      "/api/v1/notificacoes?categoria=sistema'%20or%201=1--",
    ];
    for (const url of maliciosas) {
      const resposta = await pedir('GET', url, { headers: { cookie: admin } });
      assert.equal(resposta.statusCode, 422, `${url}: ${resposta.statusCode}`);
      assert.equal(resposta.json().erro.codigo, 'VALIDACAO');
    }
    const busca = await pedir('GET', "/api/v1/usuarios?q=%27%20or%201%3D1%20--", { headers: { cookie: admin } });
    assert.equal(busca.statusCode, 200);
    assert.equal(busca.json().total, 0);
    const global = await pedir('GET', "/api/v1/busca?q=%25'%20or%20'1'%3D'1", { headers: { cookie: admin } });
    assert.equal(global.statusCode, 200);
    assert.deepEqual(global.json().usuarios, []);
    const { linhas } = await ambiente.banco.consultar<{ total: number }>('select count(*)::int as total from usuarios');
    assert.ok(linhas[0].total > 10);
  });

  it('cookies de sessão são httpOnly, SameSite=Lax e o de renovação fica restrito a /api/v1/auth', async () => {
    const resposta = await pedir('POST', '/api/v1/auth/entrar', {
      payload: { email: 'admin@bento.local', senha: 'bento123' },
      remoteAddress: '10.9.0.1',
    });
    assert.equal(resposta.statusCode, 200);
    const sessao = resposta.cookies.find((cookie) => cookie.name === 'bento_sessao');
    const renovacao = resposta.cookies.find((cookie) => cookie.name === 'bento_renovacao');
    for (const cookie of [sessao, renovacao]) {
      assert.ok(cookie);
      assert.equal(cookie.httpOnly, true);
      assert.equal(String(cookie.sameSite).toLowerCase(), 'lax');
    }
    assert.equal(sessao?.path, '/');
    assert.equal(renovacao?.path, '/api/v1/auth');
    assert.ok(!resposta.body.includes(String(sessao?.value)), 'o token não pode aparecer no corpo');
  });

  it('cabeçalhos de segurança estão presentes', async () => {
    const resposta = await pedir('GET', '/api/v1/auth/eu', { headers: { cookie: admin } });
    const csp = String(resposta.headers['content-security-policy']);
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /object-src 'none'/);
    assert.equal(resposta.headers['x-content-type-options'], 'nosniff');
    assert.equal(resposta.headers['x-frame-options'], 'SAMEORIGIN');
    assert.equal(resposta.headers['referrer-policy'], 'no-referrer');
    assert.equal(resposta.headers['x-powered-by'], undefined);
  });

  it('limita as tentativas de login por IP (429)', async () => {
    const estados: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const resposta = await pedir('POST', '/api/v1/auth/entrar', {
        payload: { email: `ninguem${i}@exemplo.com`, senha: 'qualquer' },
        remoteAddress: '10.9.0.2',
      });
      estados.push(resposta.statusCode);
    }
    assert.deepEqual(estados.slice(0, 10), Array(10).fill(401));
    assert.equal(estados[10], 429);
    assert.equal(estados[11], 429);
  });

  it('login não revela se o e-mail existe, nem pela mensagem nem pelo bloqueio temporário', async () => {
    const { linhas } = await ambiente.banco.consultar<{ email: string }>(
      `select email from usuarios where papel = 'cliente' and status = 'ativo' order by criado_em desc limit 1`,
    );
    const existente = linhas[0].email;
    const tentar = (email: string, ip: string) =>
      pedir('POST', '/api/v1/auth/entrar', { payload: { email, senha: 'senha-errada-123' }, remoteAddress: ip });
    const real = await tentar(existente, '10.9.1.1');
    const inventado = await tentar('nao.existe.mesmo@exemplo.com', '10.9.1.2');
    assert.equal(real.statusCode, inventado.statusCode);
    assert.deepEqual(real.json(), inventado.json());
    assert.equal(real.json().erro.mensagem, 'E-mail ou senha incorretos.');
    for (let i = 0; i < 5; i += 1) {
      await tentar(existente, '10.9.1.1');
      await tentar('nao.existe.mesmo@exemplo.com', '10.9.1.2');
    }
    const realBloqueado = await tentar(existente, '10.9.1.1');
    const inventadoBloqueado = await tentar('nao.existe.mesmo@exemplo.com', '10.9.1.2');
    assert.equal(realBloqueado.statusCode, 429);
    assert.equal(inventadoBloqueado.statusCode, 429);
    assert.deepEqual(realBloqueado.json(), inventadoBloqueado.json());
  });

  it('não-admin não consegue se promover a administrador', async () => {
    const tentativas: ['PATCH' | 'PUT' | 'POST', string, unknown, number][] = [
      ['PATCH', `/api/v1/usuarios/${ids.gerente}`, { papel: 'admin' }, 403],
      ['PUT', `/api/v1/usuarios/${ids.gerente}/permissoes`, { papel: 'admin', concedidas: ['usuarios.permissoes'], negadas: [] }, 403],
      ['PUT', `/api/v1/usuarios/${ids.suporte}/permissoes`, { papel: 'admin', concedidas: [], negadas: [] }, 403],
      ['PATCH', `/api/v1/usuarios/${ids.suporte}`, { papel: 'admin' }, 403],
      ['POST', '/api/v1/usuarios', { nome: 'Admin Fantasma', email: 'fantasma@exemplo.com', papel: 'admin', senha: 'senha-forte-123' }, 403],
      ['PATCH', '/api/v1/configuracoes/perfil', { papel: 'admin' }, 422],
    ];
    for (const [metodo, url, payload, esperado] of tentativas) {
      const resposta = await pedir(metodo, url, { headers: cabecalhos(gerente), payload });
      assert.equal(resposta.statusCode, esperado, `${metodo} ${url}: ${resposta.body}`);
    }
    const { linhas } = await ambiente.banco.consultar<{ papel: string }>('select papel from usuarios where id = $1', [ids.gerente]);
    assert.equal(linhas[0].papel, 'gerente');
    const { linhas: fantasmas } = await ambiente.banco.consultar(`select 1 from usuarios where email = 'fantasma@exemplo.com'`);
    assert.equal(fantasmas.length, 0);
  });

  it('suporte não assume nem altera contas de nível superior (senha, e-mail, bloqueio)', async () => {
    const tentativas: ['PATCH' | 'POST', string, unknown?][] = [
      ['POST', `/api/v1/usuarios/${ids.admin}/redefinir-senha`],
      ['PATCH', `/api/v1/usuarios/${ids.admin}`, { email: 'suporte.invasor@exemplo.com' }],
      ['POST', `/api/v1/usuarios/${ids.admin}/bloquear`, { motivo: 'tomada de conta' }],
      ['POST', `/api/v1/usuarios/${ids.gerente}/redefinir-senha`],
      ['POST', `/api/v1/usuarios/${ids.analista}/redefinir-senha`],
    ];
    for (const [metodo, url, payload] of tentativas) {
      const resposta = await pedir(metodo, url, { headers: cabecalhos(suporte), payload });
      assert.equal(resposta.statusCode, 403, `${metodo} ${url}: ${resposta.body}`);
      assert.ok(!('senhaTemporaria' in resposta.json()));
    }
    const massa = await pedir('POST', '/api/v1/usuarios/acoes-em-massa', {
      headers: cabecalhos(suporte),
      payload: { ids: [ids.admin, ids.gerente], acao: 'bloquear', motivo: 'em massa' },
    });
    assert.equal(massa.statusCode, 200);
    assert.equal(massa.json().afetados, 0);
    const { linhas } = await ambiente.banco.consultar<{ email: string; status: string }>('select email, status from usuarios where id = $1', [
      ids.admin,
    ]);
    assert.equal(linhas[0].email, 'admin@bento.local');
    assert.equal(linhas[0].status, 'ativo');
    const cliente = await pedir('POST', `/api/v1/usuarios/${ids.cliente}/redefinir-senha`, { headers: cabecalhos(suporte) });
    assert.equal(cliente.statusCode, 200);
    assert.match(cliente.json().senhaTemporaria, /^\S{12}$/);
  });

  it('quem só edita cadastros não desbloqueia conta pelo PATCH de status', async () => {
    const criado = await pedir('POST', '/api/v1/usuarios', {
      headers: cabecalhos(admin),
      payload: { nome: 'Editora Teste', email: 'editora.teste@exemplo.com', papel: 'analista', senha: 'senha-forte-123' },
    });
    assert.equal(criado.statusCode, 201, criado.body);
    const idEditora = criado.json().usuario.id;
    const permissoes = await pedir('PUT', `/api/v1/usuarios/${idEditora}/permissoes`, {
      headers: cabecalhos(admin),
      payload: { papel: 'analista', concedidas: ['usuarios.editar'], negadas: [] },
    });
    assert.equal(permissoes.statusCode, 200, permissoes.body);
    const editora = await entrar(ambiente.app, 'editora.teste@exemplo.com', 'senha-forte-123');
    const { linhas } = await ambiente.banco.consultar<{ id: string }>(
      `select id from usuarios where papel = 'cliente' and status = 'ativo' order by criado_em offset 3 limit 1`,
    );
    const alvo = linhas[0].id;
    const bloqueio = await pedir('POST', `/api/v1/usuarios/${alvo}/bloquear`, { headers: cabecalhos(admin), payload: { motivo: 'fraude' } });
    assert.equal(bloqueio.statusCode, 200);
    const desbloqueio = await pedir('PATCH', `/api/v1/usuarios/${alvo}`, { headers: cabecalhos(editora), payload: { status: 'ativo' } });
    assert.equal(desbloqueio.statusCode, 403, desbloqueio.body);
    const { linhas: depois } = await ambiente.banco.consultar<{ status: string }>('select status from usuarios where id = $1', [alvo]);
    assert.equal(depois[0].status, 'bloqueado');
    const edicaoCliente = await pedir('PATCH', `/api/v1/usuarios/${alvo}`, { headers: cabecalhos(editora), payload: { cidade: 'Niterói' } });
    assert.equal(edicaoCliente.statusCode, 200);
    const edicaoGerente = await pedir('PATCH', `/api/v1/usuarios/${ids.gerente}`, { headers: cabecalhos(editora), payload: { cidade: 'Niterói' } });
    assert.equal(edicaoGerente.statusCode, 403);
  });

  it('mass assignment: campos internos não são aceitos nas edições', async () => {
    const usuario = await pedir('PATCH', `/api/v1/usuarios/${ids.cliente}`, {
      headers: cabecalhos(admin),
      payload: { cidade: 'Rio', senha_hash: 'x', tentativas_falhas: 0 },
    });
    assert.equal(usuario.statusCode, 422);
    const perfil = await pedir('PATCH', '/api/v1/configuracoes/perfil', {
      headers: cabecalhos(analista),
      payload: { status: 'ativo', permissoes: ['usuarios.permissoes'] },
    });
    assert.equal(perfil.statusCode, 422);
    const status = await pedir('PATCH', `/api/v1/usuarios/${ids.cliente}`, { headers: cabecalhos(admin), payload: { status: 'bloqueado' } });
    assert.equal(status.statusCode, 422, 'bloquear exige a rota própria (com motivo e permissão)');
  });

  it('IDOR: não encerra sessão nem revoga chave de outra pessoa', async () => {
    const sessoesAdmin = await pedir('GET', '/api/v1/configuracoes/seguranca/sessoes', { headers: { cookie: admin } });
    const alvo = sessoesAdmin.json()[0].id;
    const tentativa = await pedir('DELETE', `/api/v1/configuracoes/seguranca/sessoes/${alvo}`, { headers: cabecalhos(gerente) });
    assert.equal(tentativa.statusCode, 404);
    const chave = await pedir('POST', '/api/v1/configuracoes/chaves-api', {
      headers: cabecalhos(admin),
      payload: { nome: 'Chave do admin', escopos: ['leitura'] },
    });
    const revogar = await pedir('DELETE', `/api/v1/configuracoes/chaves-api/${chave.json().chave.id}`, { headers: cabecalhos(gerente) });
    assert.equal(revogar.statusCode, 404);
    const listaGerente = await pedir('GET', '/api/v1/configuracoes/chaves-api', { headers: { cookie: gerente } });
    assert.ok(!listaGerente.body.includes(chave.json().chave.id));
    const aindaValida = await pedir('GET', '/api/v1/auth/eu', { headers: { cookie: admin } });
    assert.equal(aindaValida.statusCode, 200);
  });

  it('IDOR: relatório e agendamento de outra pessoa não podem ser apagados ou pausados', async () => {
    const hoje = new Date().toISOString().slice(0, 10);
    const relatorio = await pedir('POST', '/api/v1/relatorios', {
      headers: cabecalhos(admin),
      payload: { tipo: 'receita', formato: 'csv', inicio: hoje, fim: hoje },
    });
    assert.equal(relatorio.statusCode, 201);
    const idRelatorio = relatorio.json().id;
    assert.equal((await pedir('DELETE', `/api/v1/relatorios/${idRelatorio}`, { headers: cabecalhos(analista) })).statusCode, 403);
    const agendamento = await pedir('POST', '/api/v1/relatorios/agendados', {
      headers: cabecalhos(admin),
      payload: { nome: 'Receita semanal', tipo: 'receita', formato: 'csv', frequencia: 'semanal', periodo: '7d' },
    });
    const idAgendamento = agendamento.json().id;
    const pausar = await pedir('PATCH', `/api/v1/relatorios/agendados/${idAgendamento}`, { headers: cabecalhos(analista), payload: { ativo: false } });
    assert.equal(pausar.statusCode, 403);
    assert.equal((await pedir('DELETE', `/api/v1/relatorios/agendados/${idAgendamento}`, { headers: cabecalhos(analista) })).statusCode, 403);
    const proprio = await pedir('POST', '/api/v1/relatorios', {
      headers: cabecalhos(analista),
      payload: { tipo: 'receita', formato: 'csv', inicio: hoje, fim: hoje },
    });
    assert.equal((await pedir('DELETE', `/api/v1/relatorios/${proprio.json().id}`, { headers: cabecalhos(analista) })).statusCode, 204);
    assert.equal((await pedir('DELETE', `/api/v1/relatorios/${idRelatorio}`, { headers: cabecalhos(admin) })).statusCode, 204);
    assert.equal((await pedir('DELETE', `/api/v1/relatorios/agendados/${idAgendamento}`, { headers: cabecalhos(admin) })).statusCode, 204);
  });

  it('SSRF: webhook não pode apontar para localhost, metadados de nuvem ou rede interna', async () => {
    const { linhas } = await ambiente.banco.consultar<{ id: string }>(`select id from integracoes where provedor = 'webhook'`);
    const id = linhas[0].id;
    const internas = [
      'http://127.0.0.1:8080/api/v1/saude',
      'http://localhost:8080/',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.5/hook',
      'http://192.168.0.1/',
      'http://[::1]:8080/',
      'http://[::ffff:127.0.0.1]/',
      'http://2130706433/',
      'http://0x7f.0.0.1/',
      'http://usuario:senha@exemplo.com/',
    ];
    for (const url of internas) {
      const resposta = await pedir('PATCH', `/api/v1/integracoes/${id}`, {
        headers: cabecalhos(admin),
        payload: { config: { url, segredo: 'segredo-de-assinatura-123' } },
      });
      assert.equal(resposta.statusCode, 422, `${url}: ${resposta.body}`);
    }
    await ambiente.banco.consultar(`update integracoes set config = $2::jsonb where id = $1`, [
      id,
      JSON.stringify({ url: 'http://169.254.169.254/latest/meta-data/', segredo: 'segredo-de-assinatura-123' }),
    ]);
    const teste = await pedir('POST', `/api/v1/integracoes/${id}/testar`, { headers: cabecalhos(admin) });
    assert.equal(teste.statusCode, 200);
    assert.equal(teste.json().ok, false);
    assert.match(teste.json().mensagem, /bloqueado/i);
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1']) {
      assert.equal(enderecoInterno(ip), true, ip);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '2001:4860:4860::8888']) assert.equal(enderecoInterno(ip), false, ip);
  });

  it('CSV neutraliza fórmulas (=, +, -, @) sem estragar valores numéricos', async () => {
    const criado = await pedir('POST', '/api/v1/usuarios', {
      headers: cabecalhos(admin),
      payload: {
        nome: '=HYPERLINK("http://mal.exemplo","clique")',
        email: 'formula.csv@exemplo.com',
        papel: 'cliente',
        empresa: '@SUM(1+1)',
        cargo: '+cmd|calc',
        cidade: '-2+3',
      },
    });
    assert.equal(criado.statusCode, 201, criado.body);
    const exportado = await pedir('GET', '/api/v1/usuarios/exportar?q=formula.csv', { headers: { cookie: admin } });
    assert.equal(exportado.statusCode, 200);
    const linha = exportado.body.split('\r\n').find((texto) => texto.includes('formula.csv@exemplo.com'));
    assert.ok(linha);
    assert.ok(linha.startsWith(`"'=HYPERLINK(`), linha);
    assert.ok(linha.includes(";'@SUM(1+1);"), linha);
    assert.ok(linha.includes(";'+cmd|calc;"), linha);
    assert.ok(linha.includes(";'-2+3"), linha);
    for (const celula of linha.split(';')) assert.doesNotMatch(celula.replace(/^"/, ''), /^[=+\-@]/);
    assert.equal(neutralizarFormula('\t=1'), "'\t=1");
    const csv = gerarCsv([{ campo: 'valor', titulo: 'Valor', formato: 'moeda' }], [{ valor: -1250 }], 'America/Sao_Paulo').toString('utf8');
    assert.ok(csv.includes('-12,50'));
  });

  it('avisos não aceitam links para outro domínio disfarçados de caminho interno', async () => {
    for (const link of ['//mal.exemplo/login', '/\\mal.exemplo', 'javascript:alert(1)', 'data:text/html,<script>']) {
      const resposta = await pedir('POST', '/api/v1/notificacoes', {
        headers: cabecalhos(admin),
        payload: { titulo: 'Aviso', mensagem: 'Clique aqui', link },
      });
      assert.equal(resposta.statusCode, 422, link);
    }
    const valido = await pedir('POST', '/api/v1/notificacoes', {
      headers: cabecalhos(admin),
      payload: { titulo: 'Aviso', mensagem: 'Veja os usuários', link: '/usuarios' },
    });
    assert.equal(valido.statusCode, 201);
  });
});

describe('segurança: servidor de arquivos estáticos', () => {
  let ambiente: Ambiente;
  let app: FastifyInstance;
  let pasta: string;

  before(async () => {
    ambiente = await criarAmbiente();
    pasta = mkdtempSync(path.join(tmpdir(), 'bento-estatico-'));
    const raiz = path.join(pasta, 'web');
    mkdirSync(path.join(raiz, 'assets'), { recursive: true });
    writeFileSync(path.join(raiz, 'index.html'), '<!doctype html><title>Bento</title>');
    writeFileSync(path.join(raiz, 'assets', 'app.js'), 'console.log(1)');
    writeFileSync(path.join(pasta, 'segredo.txt'), 'CONTEUDO-SECRETO');
    app = await construirApp({ config: { ...ambiente.config, dirWeb: raiz }, banco: ambiente.banco, registrarLogs: false });
    await app.ready();
  });

  after(async () => {
    await app.close();
    await ambiente.fechar();
    rmSync(pasta, { recursive: true, force: true });
  });

  it('path traversal não sai da pasta web e devolve 404', async () => {
    assert.equal((await app.inject({ method: 'GET', url: '/assets/app.js' })).statusCode, 200);
    const pagina = await app.inject({ method: 'GET', url: '/' });
    assert.equal(pagina.statusCode, 200);
    assert.match(String(pagina.headers['content-security-policy']), /frame-ancestors 'none'/);
    for (const url of ['/..%2fsegredo.txt', '/assets/..%2f..%2fsegredo.txt', '/..%5csegredo.txt', '/assets/%2e%2e%2f%2e%2e%2fsegredo.txt', '/%00']) {
      const resposta = await app.inject({ method: 'GET', url });
      assert.equal(resposta.statusCode, 404, `${url}: ${resposta.statusCode}`);
      assert.ok(!resposta.body.includes('CONTEUDO-SECRETO'));
    }
    for (const url of ['/../segredo.txt', '/%2e%2e/segredo.txt', '/assets/../../segredo.txt', '/assets/%E0%A4%A']) {
      const resposta = await app.inject({ method: 'GET', url });
      assert.notEqual(resposta.statusCode, 200, url);
      assert.ok(!resposta.body.includes('CONTEUDO-SECRETO'), url);
    }
  });
});

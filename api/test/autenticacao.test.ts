import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { cabecalhos, cookiesDe, criarAmbiente, entrar, type Ambiente } from './auxiliar.js';

describe('autenticação, permissões e CSRF', () => {
  let ambiente: Ambiente;

  before(async () => {
    ambiente = await criarAmbiente();
  });

  after(async () => {
    await ambiente.fechar();
  });

  it('entra com a conta de administrador e devolve usuário, permissões e preferências', async () => {
    const resposta = await ambiente.app.inject({
      method: 'POST',
      url: '/api/v1/auth/entrar',
      payload: { email: 'ADMIN@bento.local', senha: 'bento123', lembrar: true },
    });
    assert.equal(resposta.statusCode, 200);
    const corpo = resposta.json();
    assert.equal(corpo.usuario.email, 'admin@bento.local');
    assert.equal(corpo.usuario.papel.codigo, 'admin');
    assert.ok(corpo.permissoes.includes('configuracoes.sistema'));
    assert.deepEqual(Object.keys(corpo.preferencias).sort(), ['densidade', 'paleta', 'sidebarRecolhida', 'tema']);
    const nomes = resposta.cookies.map((cookie) => cookie.name).sort();
    assert.deepEqual(nomes, ['bento_renovacao', 'bento_sessao']);
    assert.ok(resposta.cookies.every((cookie) => cookie.httpOnly));
  });

  it('recusa senha errada e conta de cliente', async () => {
    const errada = await ambiente.app.inject({
      method: 'POST',
      url: '/api/v1/auth/entrar',
      payload: { email: 'gerente@bento.local', senha: 'nao-e-essa' },
    });
    assert.equal(errada.statusCode, 401);
    assert.equal(errada.json().erro.codigo, 'CREDENCIAIS');

    const { linhas } = await ambiente.banco.consultar<{ email: string }>(
      `select email from usuarios where papel = 'cliente' and status = 'ativo' limit 1`,
    );
    await ambiente.banco.consultar(`update usuarios set senha_hash = (select senha_hash from usuarios where email = 'admin@bento.local') where email = $1`, [
      linhas[0].email,
    ]);
    const cliente = await ambiente.app.inject({
      method: 'POST',
      url: '/api/v1/auth/entrar',
      payload: { email: linhas[0].email, senha: 'bento123' },
    });
    assert.equal(cliente.statusCode, 403);
    assert.equal(cliente.json().erro.codigo, 'SEM_ACESSO_PAINEL');
  });

  it('exige sessão nas rotas protegidas', async () => {
    const resposta = await ambiente.app.inject({ method: 'GET', url: '/api/v1/auth/eu' });
    assert.equal(resposta.statusCode, 401);
    assert.equal(resposta.json().erro.codigo, 'NAO_AUTENTICADO');
  });

  it('bloqueia alterações por cookie sem o cabeçalho X-Bento', async () => {
    const cookie = await entrar(ambiente.app);
    const sem = await ambiente.app.inject({ method: 'POST', url: '/api/v1/notificacoes/ler-todas', headers: { cookie } });
    assert.equal(sem.statusCode, 403);
    assert.equal(sem.json().erro.codigo, 'CSRF');
    const com = await ambiente.app.inject({ method: 'POST', url: '/api/v1/notificacoes/ler-todas', headers: cabecalhos(cookie) });
    assert.equal(com.statusCode, 200);
  });

  it('aplica as permissões do papel', async () => {
    const cookie = await entrar(ambiente.app, 'analista@bento.local');
    const criar = await ambiente.app.inject({
      method: 'POST',
      url: '/api/v1/usuarios',
      headers: cabecalhos(cookie),
      payload: { nome: 'Pessoa Teste', email: 'pessoa.teste@exemplo.com', papel: 'cliente' },
    });
    assert.equal(criar.statusCode, 403);
    assert.equal(criar.json().erro.codigo, 'SEM_PERMISSAO');
    const integracoes = await ambiente.app.inject({ method: 'GET', url: '/api/v1/integracoes', headers: { cookie } });
    assert.equal(integracoes.statusCode, 403);
    const analytics = await ambiente.app.inject({ method: 'GET', url: '/api/v1/analytics', headers: { cookie } });
    assert.equal(analytics.statusCode, 200);
  });

  it('renova a sessão girando o token e encerra com sair', async () => {
    const cookie = await entrar(ambiente.app, 'gerente@bento.local');
    const renovada = await ambiente.app.inject({ method: 'POST', url: '/api/v1/auth/renovar', headers: cabecalhos(cookie) });
    assert.equal(renovada.statusCode, 200);
    const novoCookie = cookiesDe(renovada);
    assert.notEqual(novoCookie, cookie);
    const reuso = await ambiente.app.inject({ method: 'POST', url: '/api/v1/auth/renovar', headers: cabecalhos(cookie) });
    assert.equal(reuso.statusCode, 401);
    const sair = await ambiente.app.inject({ method: 'POST', url: '/api/v1/auth/sair', headers: cabecalhos(novoCookie) });
    assert.equal(sair.statusCode, 204);
    const depois = await ambiente.app.inject({ method: 'GET', url: '/api/v1/auth/eu', headers: { cookie: novoCookie } });
    assert.equal(depois.statusCode, 401);
  });

  it('aceita chave de API somente leitura', async () => {
    const cookie = await entrar(ambiente.app);
    const criada = await ambiente.app.inject({
      method: 'POST',
      url: '/api/v1/configuracoes/chaves-api',
      headers: cabecalhos(cookie),
      payload: { nome: 'Leitura de teste', escopos: ['leitura'] },
    });
    assert.equal(criada.statusCode, 201);
    const { segredo } = criada.json();
    assert.match(segredo, /^bnt_[A-Za-z0-9]{40}$/);
    const leitura = await ambiente.app.inject({
      method: 'GET',
      url: '/api/v1/transacoes?porPagina=1',
      headers: { authorization: `Bearer ${segredo}` },
    });
    assert.equal(leitura.statusCode, 200);
    const escrita = await ambiente.app.inject({
      method: 'POST',
      url: '/api/v1/notificacoes/ler-todas',
      headers: { authorization: `Bearer ${segredo}` },
    });
    assert.equal(escrita.statusCode, 403);
  });
});

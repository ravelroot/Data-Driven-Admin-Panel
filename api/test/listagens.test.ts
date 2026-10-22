import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { cabecalhos, criarAmbiente, entrar, type Ambiente } from './auxiliar.js';

describe('listagens paginadas, ordenação e bloqueio', () => {
  let ambiente: Ambiente;
  let cookie: string;

  before(async () => {
    ambiente = await criarAmbiente();
    cookie = await entrar(ambiente.app);
  });

  after(async () => {
    await ambiente.fechar();
  });

  const obter = async (url: string) => {
    const resposta = await ambiente.app.inject({ method: 'GET', url, headers: { cookie } });
    assert.equal(resposta.statusCode, 200, resposta.body);
    return resposta.json();
  };

  it('pagina usuários e devolve contagens por status', async () => {
    const primeira = await obter('/api/v1/usuarios?porPagina=5&pagina=1&ordenar=criadoEm&direcao=desc');
    const segunda = await obter('/api/v1/usuarios?porPagina=5&pagina=2&ordenar=criadoEm&direcao=desc');
    assert.equal(primeira.itens.length, 5);
    assert.equal(primeira.porPagina, 5);
    assert.equal(primeira.paginas, Math.ceil(primeira.total / 5));
    assert.notEqual(primeira.itens[0].id, segunda.itens[0].id);
    const datas = [...primeira.itens, ...segunda.itens].map((usuario: { criadoEm: string }) => Date.parse(usuario.criadoEm));
    assert.deepEqual(datas, [...datas].sort((a, b) => b - a));
    const { todos, ativo, bloqueado, pendente, inativo } = primeira.contagens;
    assert.equal(todos, ativo + bloqueado + pendente + inativo);
    assert.equal(todos, primeira.total);
  });

  it('ordena por nome e filtra por status e busca', async () => {
    const lista = await obter('/api/v1/usuarios?porPagina=20&ordenar=nome&direcao=asc');
    const nomes = lista.itens.map((usuario: { nome: string }) => usuario.nome.toLowerCase());
    assert.deepEqual(nomes, [...nomes].sort((a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)));
    const bloqueados = await obter('/api/v1/usuarios?status=bloqueado&porPagina=100');
    assert.ok(bloqueados.itens.every((usuario: { status: string }) => usuario.status === 'bloqueado'));
    const busca = await obter('/api/v1/usuarios?q=bento.local');
    assert.equal(busca.total, 4);
  });

  it('ordena e filtra transações', async () => {
    const lista = await obter('/api/v1/transacoes?porPagina=25&ordenar=valor&direcao=desc&status=paga');
    const valores = lista.itens.map((transacao: { valor: number }) => transacao.valor);
    assert.deepEqual(valores, [...valores].sort((a: number, b: number) => b - a));
    assert.ok(lista.itens.every((transacao: { status: string }) => transacao.status === 'paga'));
    const alvo = lista.itens[0];
    const porCodigo = await obter(`/api/v1/transacoes?q=${alvo.codigo}`);
    assert.equal(porCodigo.itens[0].codigo, alvo.codigo);
    const detalhe = await obter(`/api/v1/transacoes/${alvo.id}`);
    assert.equal(detalhe.id, alvo.id);
    assert.ok('assinatura' in detalhe);
  });

  it('valida parâmetros inválidos', async () => {
    const resposta = await ambiente.app.inject({ method: 'GET', url: '/api/v1/usuarios?ordenar=senha', headers: { cookie } });
    assert.equal(resposta.statusCode, 422);
    assert.equal(resposta.json().erro.codigo, 'VALIDACAO');
  });

  it('bloqueia e desbloqueia uma conta, encerrando as sessões dela', async () => {
    const cookieSuporte = await entrar(ambiente.app, 'suporte@bento.local');
    const { itens } = await obter('/api/v1/usuarios?q=suporte@bento.local');
    const alvo = itens[0];
    const bloqueio = await ambiente.app.inject({
      method: 'POST',
      url: `/api/v1/usuarios/${alvo.id}/bloquear`,
      headers: cabecalhos(cookie),
      payload: { motivo: 'Teste automatizado' },
    });
    assert.equal(bloqueio.statusCode, 200);
    assert.equal(bloqueio.json().usuario.status, 'bloqueado');
    assert.equal(bloqueio.json().usuario.motivoBloqueio, 'Teste automatizado');
    const tentativa = await ambiente.app.inject({ method: 'GET', url: '/api/v1/auth/eu', headers: { cookie: cookieSuporte } });
    assert.equal(tentativa.statusCode, 401);
    const login = await ambiente.app.inject({
      method: 'POST',
      url: '/api/v1/auth/entrar',
      payload: { email: 'suporte@bento.local', senha: 'bento123' },
    });
    assert.equal(login.statusCode, 423);
    const desbloqueio = await ambiente.app.inject({
      method: 'POST',
      url: `/api/v1/usuarios/${alvo.id}/desbloquear`,
      headers: cabecalhos(cookie),
    });
    assert.equal(desbloqueio.json().usuario.status, 'ativo');
    await entrar(ambiente.app, 'suporte@bento.local');
  });

  it('não deixa a pessoa bloquear a si mesma', async () => {
    const eu = (await obter('/api/v1/auth/eu')).usuario;
    const resposta = await ambiente.app.inject({
      method: 'POST',
      url: `/api/v1/usuarios/${eu.id}/bloquear`,
      headers: cabecalhos(cookie),
      payload: { motivo: 'Não deveria' },
    });
    assert.equal(resposta.statusCode, 409);
  });

  it('salva permissões individuais e calcula as efetivas', async () => {
    const { itens } = await obter('/api/v1/usuarios?q=analista@bento.local');
    const resposta = await ambiente.app.inject({
      method: 'PUT',
      url: `/api/v1/usuarios/${itens[0].id}/permissoes`,
      headers: cabecalhos(cookie),
      payload: { papel: 'analista', concedidas: ['usuarios.editar'], negadas: ['relatorios.agendar'] },
    });
    assert.equal(resposta.statusCode, 200, resposta.body);
    const corpo = resposta.json();
    assert.ok(corpo.efetivas.includes('usuarios.editar'));
    assert.ok(!corpo.efetivas.includes('relatorios.agendar'));
  });
});

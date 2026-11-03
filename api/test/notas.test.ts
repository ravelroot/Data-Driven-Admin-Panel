import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { cabecalhos, criarAmbiente, entrar, type Ambiente } from './auxiliar.js';

describe('notas internas dos usuários', () => {
  let ambiente: Ambiente;
  let cookieAdmin: string;
  let cookieSuporte: string;
  let cookieAnalista: string;
  let alvo = '';
  let notaSuporte = '';

  before(async () => {
    ambiente = await criarAmbiente();
    cookieAdmin = await entrar(ambiente.app);
    cookieSuporte = await entrar(ambiente.app, 'suporte@bento.local');
    cookieAnalista = await entrar(ambiente.app, 'analista@bento.local');
    const lista = await ambiente.app.inject({ method: 'GET', url: '/api/v1/usuarios?papel=cliente&porPagina=1', headers: { cookie: cookieAdmin } });
    alvo = lista.json().itens[0].id;
  });

  after(async () => {
    await ambiente.fechar();
  });

  const pedir = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, cookie: string, payload?: unknown) =>
    ambiente.app.inject({ method, url: `/api/v1${url}`, headers: method === 'GET' ? { cookie } : cabecalhos(cookie), ...(payload === undefined ? {} : { payload }) });

  it('suporte adiciona uma nota e ela aparece na lista e no detalhe', async () => {
    const criada = await pedir('POST', `/usuarios/${alvo}/notas`, cookieSuporte, { texto: '  Cliente pediu retorno por telefone.  ' });
    assert.equal(criada.statusCode, 201, criada.body);
    const nota = criada.json();
    notaSuporte = nota.id;
    assert.equal(nota.texto, 'Cliente pediu retorno por telefone.');
    assert.equal(nota.fixada, false);
    assert.equal(nota.autor.nome.length > 0, true);
    assert.equal(nota.podeAlterar, true);

    const lista = await pedir('GET', `/usuarios/${alvo}/notas`, cookieAnalista);
    assert.equal(lista.statusCode, 200);
    assert.equal(lista.json().length, 1);
    assert.equal(lista.json()[0].podeAlterar, false);

    const detalhe = await pedir('GET', `/usuarios/${alvo}`, cookieAdmin);
    assert.deepEqual(detalhe.json().notas, { total: 1, fixadas: 0 });
  });

  it('valida o texto e recusa quem não tem a permissão de anotar', async () => {
    const curta = await pedir('POST', `/usuarios/${alvo}/notas`, cookieSuporte, { texto: ' a ' });
    assert.equal(curta.statusCode, 422);
    const longa = await pedir('POST', `/usuarios/${alvo}/notas`, cookieSuporte, { texto: 'x'.repeat(2001) });
    assert.equal(longa.statusCode, 422);
    const analista = await pedir('POST', `/usuarios/${alvo}/notas`, cookieAnalista, { texto: 'Tentativa sem permissão' });
    assert.equal(analista.statusCode, 403);
    const inexistente = await pedir('POST', '/usuarios/00000000-0000-4000-8000-000000000000/notas', cookieSuporte, { texto: 'Conta fantasma' });
    assert.equal(inexistente.statusCode, 404);
  });

  it('fixa notas, que passam a vir primeiro', async () => {
    const outra = await pedir('POST', `/usuarios/${alvo}/notas`, cookieAdmin, { texto: 'Contrato renovado até dezembro.', fixada: true });
    assert.equal(outra.statusCode, 201);
    const lista = (await pedir('GET', `/usuarios/${alvo}/notas`, cookieAdmin)).json();
    assert.equal(lista[0].fixada, true);
    assert.equal(lista[0].texto, 'Contrato renovado até dezembro.');
    assert.equal(lista.every((nota: { podeAlterar: boolean }) => nota.podeAlterar), true);
  });

  it('só o autor ou quem controla permissões altera e remove', async () => {
    const lista = (await pedir('GET', `/usuarios/${alvo}/notas`, cookieAdmin)).json();
    const doAdmin = lista.find((nota: { fixada: boolean }) => nota.fixada).id;
    const alheia = await pedir('PATCH', `/usuarios/${alvo}/notas/${doAdmin}`, cookieSuporte, { fixada: false });
    assert.equal(alheia.statusCode, 403);
    const removerAlheia = await pedir('DELETE', `/usuarios/${alvo}/notas/${doAdmin}`, cookieSuporte);
    assert.equal(removerAlheia.statusCode, 403);

    const editada = await pedir('PATCH', `/usuarios/${alvo}/notas/${notaSuporte}`, cookieSuporte, { texto: 'Retorno feito por telefone.', fixada: true });
    assert.equal(editada.statusCode, 200, editada.body);
    assert.equal(editada.json().texto, 'Retorno feito por telefone.');
    assert.equal(editada.json().fixada, true);

    const vazia = await pedir('PATCH', `/usuarios/${alvo}/notas/${notaSuporte}`, cookieSuporte, {});
    assert.equal(vazia.statusCode, 422);

    const outraConta = (await pedir('GET', '/usuarios?papel=cliente&porPagina=2', cookieAdmin)).json().itens[1].id;
    const cruzada = await pedir('DELETE', `/usuarios/${outraConta}/notas/${notaSuporte}`, cookieAdmin);
    assert.equal(cruzada.statusCode, 404);

    const removida = await pedir('DELETE', `/usuarios/${alvo}/notas/${notaSuporte}`, cookieAdmin);
    assert.equal(removida.statusCode, 204);
    const restantes = (await pedir('GET', `/usuarios/${alvo}/notas`, cookieAdmin)).json();
    assert.equal(restantes.length, 1);
  });

  it('registra as notas na trilha de auditoria', async () => {
    const auditoria = await pedir('GET', '/atividades?acao=usuario.nota_adicionada,usuario.nota_removida&porPagina=10', cookieAdmin);
    assert.equal(auditoria.statusCode, 200, auditoria.body);
    const acoes = auditoria.json().itens.map((item: { acao: string }) => item.acao);
    assert.equal(acoes.filter((acao: string) => acao === 'usuario.nota_adicionada').length, 2);
    assert.equal(acoes.filter((acao: string) => acao === 'usuario.nota_removida').length, 1);
  });

  it('remove as notas junto com a conta', async () => {
    const criado = await pedir('POST', '/usuarios', cookieAdmin, { nome: 'Conta Temporaria', email: 'temporaria.notas@bento.local', papel: 'cliente' });
    assert.equal(criado.statusCode, 201, criado.body);
    const novo = criado.json().usuario.id;
    await pedir('POST', `/usuarios/${novo}/notas`, cookieAdmin, { texto: 'Nota que some com a conta.' });
    const excluido = await pedir('DELETE', `/usuarios/${novo}`, cookieAdmin);
    assert.equal(excluido.statusCode, 204);
    const { linhas } = await ambiente.banco.consultar<{ total: number }>('select count(*)::int as total from notas_usuario where usuario_id = $1', [novo]);
    assert.equal(linhas[0]?.total, 0);
  });
});

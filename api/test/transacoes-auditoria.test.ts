import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { cabecalhos, criarAmbiente, entrar, type Ambiente } from './auxiliar.js';

describe('reembolso de transações e filtros da auditoria', () => {
  let ambiente: Ambiente;
  let cookie: string;
  let cookieAnalista: string;
  let codigoReembolsado = '';

  before(async () => {
    ambiente = await criarAmbiente();
    cookie = await entrar(ambiente.app);
    cookieAnalista = await entrar(ambiente.app, 'analista@bento.local');
  });

  after(async () => {
    await ambiente.fechar();
  });

  const obter = async (url: string, comCookie = cookie) => {
    const resposta = await ambiente.app.inject({ method: 'GET', url, headers: { cookie: comCookie } });
    assert.equal(resposta.statusCode, 200, resposta.body);
    return resposta.json();
  };

  const reembolsar = (id: string, motivo: string, comCookie = cookie) =>
    ambiente.app.inject({
      method: 'POST',
      url: `/api/v1/transacoes/${id}/reembolsar`,
      headers: cabecalhos(comCookie),
      payload: { motivo },
    });

  const primeiraCom = async (status: string) => {
    const { itens } = await obter(`/api/v1/transacoes?status=${status}&porPagina=5`);
    assert.ok(itens.length > 0, `precisa de ao menos uma transação ${status} na semente`);
    return itens[0] as { id: string; codigo: string; valor: number };
  };

  it('lista transações com resumo do filtro e contagens por status', async () => {
    const lista = await obter('/api/v1/transacoes?porPagina=5');
    const { resumo, contagens } = lista;
    assert.equal(resumo.quantidade, lista.total);
    assert.equal(contagens.todas, contagens.paga + contagens.pendente + contagens.falhou + contagens.reembolsada);
    assert.ok(resumo.taxaFalha >= 0 && resumo.taxaFalha <= 100);
    const pagas = await obter('/api/v1/transacoes?status=paga&porPagina=5');
    assert.equal(pagas.resumo.quantidade, contagens.paga);
    assert.equal(pagas.resumo.valorReembolsado, 0);
    assert.equal(pagas.contagens.todas, contagens.todas);
    const separado = await obter('/api/v1/transacoes/resumo?status=paga');
    assert.deepEqual(separado.resumo, pagas.resumo);
  });

  it('reembolsa uma transação paga e registra a auditoria', async () => {
    const alvo = await primeiraCom('paga');
    codigoReembolsado = alvo.codigo;
    const resposta = await reembolsar(alvo.id, '  Cliente pediu cancelamento dentro do prazo  ');
    assert.equal(resposta.statusCode, 200, resposta.body);
    const { transacao } = resposta.json();
    assert.equal(transacao.status, 'reembolsada');
    assert.equal(transacao.reembolsoMotivo, 'Cliente pediu cancelamento dentro do prazo');
    assert.ok(transacao.reembolsadoEm);
    assert.equal(transacao.reembolsadoPor.nome, 'Ana Martins');

    const detalhe = await obter(`/api/v1/transacoes/${alvo.id}`);
    assert.equal(detalhe.status, 'reembolsada');
    assert.equal(detalhe.reembolsadoPor.nome, 'Ana Martins');

    const { itens } = await obter('/api/v1/atividades?acao=transacao.reembolsar&porPagina=10');
    const registro = itens.find((item: { entidadeId: string }) => item.entidadeId === alvo.id);
    assert.ok(registro, 'auditoria do reembolso não encontrada');
    assert.equal(registro.acao, 'transacao.reembolsar');
    assert.equal(registro.detalhes.motivo, 'Cliente pediu cancelamento dentro do prazo');
    assert.equal(registro.usuario.nome, 'Ana Martins');

    const notificacoes = await obter('/api/v1/notificacoes?categoria=transacao&porPagina=5');
    assert.ok(notificacoes.itens.some((item: { link: string }) => item.link === `/transacoes?transacao=${alvo.id}`));
  });

  it('recusa reembolsar transação que não está paga', async () => {
    for (const status of ['falhou', 'reembolsada']) {
      const alvo = await primeiraCom(status);
      const resposta = await reembolsar(alvo.id, 'Tentativa indevida');
      assert.equal(resposta.statusCode, 409, status);
      assert.equal(resposta.json().erro.codigo, 'CONFLITO');
      assert.match(resposta.json().erro.mensagem, /Só transações pagas/);
      const detalhe = await obter(`/api/v1/transacoes/${alvo.id}`);
      assert.equal(detalhe.status, status);
    }
  });

  it('valida o motivo do reembolso', async () => {
    const alvo = await primeiraCom('paga');
    const curto = await reembolsar(alvo.id, '  ok ');
    assert.equal(curto.statusCode, 422);
    assert.equal(curto.json().erro.codigo, 'VALIDACAO');
    const longo = await reembolsar(alvo.id, 'x'.repeat(301));
    assert.equal(longo.statusCode, 422);
    const detalhe = await obter(`/api/v1/transacoes/${alvo.id}`);
    assert.equal(detalhe.status, 'paga');
  });

  it('exige transacoes.reembolsar (analista recebe 403)', async () => {
    const alvo = await primeiraCom('paga');
    const resposta = await reembolsar(alvo.id, 'Analista tentando reembolsar', cookieAnalista);
    assert.equal(resposta.statusCode, 403);
    assert.equal(resposta.json().erro.codigo, 'SEM_PERMISSAO');
    const detalhe = await obter(`/api/v1/transacoes/${alvo.id}`);
    assert.equal(detalhe.status, 'paga');
  });

  it('filtra a auditoria por prefixo de ação, busca, pessoa e período', async () => {
    const usuarios = await obter('/api/v1/atividades?acao=usuario&porPagina=50');
    assert.ok(usuarios.total > 0);
    assert.ok(usuarios.itens.every((item: { acao: string }) => item.acao.startsWith('usuario.')));

    const varias = await obter('/api/v1/atividades?acao=usuario,transacao&porPagina=100');
    assert.ok(varias.total >= usuarios.total);
    assert.ok(varias.itens.every((item: { acao: string }) => /^(usuario|transacao)\./.test(item.acao)));

    const busca = await obter(`/api/v1/atividades?q=${encodeURIComponent(codigoReembolsado)}`);
    assert.equal(busca.total, 1);
    assert.match(busca.itens[0].descricao, /^reembolsou /);

    const injecao = await obter(`/api/v1/atividades?q=${encodeURIComponent("' or 1=1 --")}`);
    assert.equal(injecao.total, 0);

    const pessoas = await obter('/api/v1/atividades/pessoas');
    const ana = pessoas.find((pessoa: { nome: string }) => pessoa.nome === 'Ana Martins');
    assert.ok(ana);
    assert.ok(pessoas.every((pessoa: { papel: { codigo: string } }) => pessoa.papel.codigo !== 'cliente'));
    const daAna = await obter(`/api/v1/atividades?usuario=${ana.id}&acao=transacao&porPagina=20`);
    assert.ok(daAna.itens.every((item: { usuario: { id: string } }) => item.usuario.id === ana.id));

    const futuro = await obter('/api/v1/atividades?inicio=2999-01-01&fim=2999-01-31');
    assert.equal(futuro.total, 0);

    const invalido = await ambiente.app.inject({ method: 'GET', url: '/api/v1/atividades?acao=usuario;drop', headers: { cookie } });
    assert.equal(invalido.statusCode, 422);
    const periodo = await ambiente.app.inject({ method: 'GET', url: '/api/v1/atividades?inicio=2026-02-10&fim=2026-02-01', headers: { cookie } });
    assert.equal(periodo.statusCode, 422);
  });

  it('exporta a auditoria filtrada em CSV com o cabeçalho correto', async () => {
    const resposta = await ambiente.app.inject({
      method: 'GET',
      url: '/api/v1/atividades/exportar?acao=transacao.reembolsar',
      headers: { cookie },
    });
    assert.equal(resposta.statusCode, 200, resposta.body);
    assert.match(String(resposta.headers['content-type']), /text\/csv/);
    assert.match(String(resposta.headers['content-disposition']), /bento-auditoria-\d{4}-\d{2}-\d{2}\.csv/);
    const linhas = resposta.body.replace(/^﻿/, '').trim().split('\r\n');
    assert.equal(linhas[0], 'Data;Pessoa;Ação;Descrição;Entidade;ID da entidade;IP;Detalhes');
    assert.ok(linhas.length >= 2);
    assert.ok(linhas.slice(1).every((linha) => linha.includes('transacao.reembolsar')));
  });

  it('exige auditoria.ver (analista recebe 403)', async () => {
    for (const url of ['/api/v1/atividades', '/api/v1/atividades/exportar', '/api/v1/atividades/pessoas']) {
      const resposta = await ambiente.app.inject({ method: 'GET', url, headers: { cookie: cookieAnalista } });
      assert.equal(resposta.statusCode, 403, url);
    }
  });
});

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { construirApp } from '../src/app.js';
import { garantirAdministrador } from '../src/banco/administrador.js';
import { criarBanco, type Banco } from '../src/banco/conexao.js';
import { aplicarMigracoes, bancoVazio } from '../src/banco/migrar.js';
import { lerConfig } from '../src/config.js';
import { entrar } from './auxiliar.js';

describe('banco sem dados de demonstração', () => {
  let banco: Banco;
  let app: FastifyInstance;
  let cookie: string;
  const admin = { email: 'Dona@Empresa.exemplo.com', senha: 'senha-forte-123', nome: 'Dona da Empresa' };

  before(async () => {
    const config = lerConfig({
      dirDados: 'memoria',
      urlBanco: null,
      segredoJwt: 'segredo-de-teste-com-tamanho-suficiente-para-jwt',
      simulador: false,
      semear: false,
      log: 'silent',
      dirWeb: '/caminho/que/nao/existe',
    });
    banco = await criarBanco(config);
    await aplicarMigracoes(banco);
    app = await construirApp({ config, banco, registrarLogs: false });
    await app.ready();
  });

  after(async () => {
    await app.close();
    await banco.fechar();
  });

  it('cria o primeiro administrador uma única vez', async () => {
    assert.equal(await bancoVazio(banco), true);
    assert.equal(await garantirAdministrador(banco, admin), 'criado');
    assert.equal(await garantirAdministrador(banco, { ...admin, senha: 'outra-senha-123' }), 'existente');
    const { linhas } = await banco.consultar<{ papel: string; status: string; email: string }>('select papel, status, email from usuarios');
    assert.deepEqual(linhas, [{ papel: 'admin', status: 'ativo', email: 'dona@empresa.exemplo.com' }]);
    cookie = await entrar(app, 'dona@empresa.exemplo.com', admin.senha);
  });

  it('mostra o painel zerado sem erros', async () => {
    for (const url of ['/api/v1/visao-geral?periodo=30d', '/api/v1/analytics', '/api/v1/usuarios', '/api/v1/transacoes', '/api/v1/notificacoes', '/api/v1/relatorios/previa?tipo=crescimento&inicio=2026-01-01&fim=2026-06-30', '/api/v1/atividades']) {
      const resposta = await app.inject({ method: 'GET', url, headers: { cookie } });
      assert.equal(resposta.statusCode, 200, `${url}: ${resposta.body}`);
    }
    const visao = (await app.inject({ method: 'GET', url: '/api/v1/visao-geral?periodo=30d', headers: { cookie } })).json();
    assert.equal(visao.kpis.receita.valor, 0);
    assert.equal(visao.kpis.receita.variacao, null);
  });
});

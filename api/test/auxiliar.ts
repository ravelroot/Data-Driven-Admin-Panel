import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { construirApp } from '../src/app.js';
import { criarBanco, type Banco } from '../src/banco/conexao.js';
import { aplicarMigracoes } from '../src/banco/migrar.js';
import { semear } from '../src/banco/semente.js';
import { lerConfig, type Config } from '../src/config.js';

export interface Ambiente {
  app: FastifyInstance;
  banco: Banco;
  config: Config;
  fechar(): Promise<void>;
}

export async function criarAmbiente(): Promise<Ambiente> {
  const config = lerConfig({
    dirDados: 'memoria',
    urlBanco: null,
    segredoJwt: 'segredo-de-teste-com-tamanho-suficiente-para-jwt',
    simulador: false,
    log: 'silent',
    dirWeb: '/caminho/que/nao/existe',
  });
  const banco = await criarBanco(config);
  await aplicarMigracoes(banco);
  await semear(banco, config.fuso, { escala: 0.15 });
  const app = await construirApp({ config, banco, registrarLogs: false });
  await app.ready();
  return {
    app,
    banco,
    config,
    async fechar() {
      await app.close();
      await banco.fechar();
    },
  };
}

export function cookiesDe(resposta: LightMyRequestResponse): string {
  return resposta.cookies
    .filter((cookie) => cookie.value)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

export async function entrar(app: FastifyInstance, email = 'admin@bento.local', senha = 'bento123'): Promise<string> {
  const resposta = await app.inject({ method: 'POST', url: '/api/v1/auth/entrar', payload: { email, senha } });
  if (resposta.statusCode !== 200) throw new Error(`Login falhou para ${email}: ${resposta.body}`);
  return cookiesDe(resposta);
}

export function cabecalhos(cookie: string, extras: Record<string, string> = {}): Record<string, string> {
  return { cookie, 'x-bento': '1', ...extras };
}

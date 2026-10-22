import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Config } from '../../config.js';
import {
  CAMINHO_RENOVACAO,
  COOKIE_RENOVACAO,
  COOKIE_SESSAO,
  DIAS_LEMBRAR,
  limparCookies,
  opcoesCookie,
} from '../../plugins/autenticacao.js';
import { usuarioAtual } from '../../tipos.js';
import { entrar, montarContexto, renovar, sair, type ResultadoSessao } from './servico.js';

const corpoEntrar = z.object({
  email: z.string().trim().min(3).max(254),
  senha: z.string().min(1).max(200),
  lembrar: z.boolean().default(false),
});

function gravarCookies(config: Config, resposta: FastifyReply, sessao: ResultadoSessao): void {
  const segundos = sessao.lembrar ? DIAS_LEMBRAR * 86_400 : null;
  resposta.setCookie(COOKIE_SESSAO, sessao.tokenAcesso, opcoesCookie(config, '/', segundos));
  resposta.setCookie(COOKIE_RENOVACAO, sessao.tokenRenovacao, opcoesCookie(config, CAMINHO_RENOVACAO, segundos));
}

export async function rotasAuth(app: FastifyInstance): Promise<void> {
  app.post(
    '/auth/entrar',
    {
      schema: { tags: ['Autenticação'], summary: 'Entra no painel', body: corpoEntrar },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (requisicao, resposta) => {
      const corpo = requisicao.body as z.infer<typeof corpoEntrar>;
      const resultado = await entrar(app, corpo, requisicao.ip, requisicao.headers['user-agent'] ?? null);
      gravarCookies(app.config, resposta, resultado);
      const { tokenAcesso: _acesso, tokenRenovacao: _renovacao, lembrar: _lembrar, ...contexto } = resultado;
      return contexto;
    },
  );

  app.post(
    '/auth/renovar',
    {
      schema: { tags: ['Autenticação'], summary: 'Renova a sessão e gira o token de renovação' },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (requisicao, resposta) => {
      try {
        const sessao = await renovar(app, requisicao.cookies[COOKIE_RENOVACAO]);
        gravarCookies(app.config, resposta, sessao);
        return { ok: true };
      } catch (erro) {
        limparCookies(app.config, resposta);
        throw erro;
      }
    },
  );

  app.post('/auth/sair', { schema: { tags: ['Autenticação'], summary: 'Encerra a sessão atual' } }, async (requisicao, resposta) => {
    await sair(app, requisicao.cookies[COOKIE_SESSAO], requisicao.cookies[COOKIE_RENOVACAO]);
    limparCookies(app.config, resposta);
    return resposta.status(204).send();
  });

  app.get(
    '/auth/eu',
    { schema: { tags: ['Autenticação'], summary: 'Usuário, permissões e preferências da sessão' }, preHandler: [app.autenticar] },
    async (requisicao) => montarContexto(app.banco, usuarioAtual(requisicao).id),
  );
}

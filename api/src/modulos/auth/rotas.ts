import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Config } from '../../config.js';
import {
  CAMINHO_RENOVACAO,
  COOKIE_DESAFIO,
  COOKIE_RENOVACAO,
  COOKIE_SESSAO,
  DIAS_LEMBRAR,
  limparCookies,
  opcoesCookie,
} from '../../plugins/autenticacao.js';
import { usuarioAtual } from '../../tipos.js';
import { concluirDoisFatores, entrar, montarContexto, renovar, sair, type ResultadoSessao } from './servico.js';

const corpoEntrar = z.object({
  email: z.string().trim().min(3).max(254),
  senha: z.string().min(1).max(200),
  lembrar: z.boolean().default(false),
});

const corpoDoisFatores = z.object({
  codigo: z.string().trim().min(6, 'Digite o código de 6 dígitos ou um código de recuperação.').max(20),
});

const SEGUNDOS_DESAFIO = 300;

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
      if (resultado.etapa === 'dois-fatores') {
        resposta.setCookie(COOKIE_DESAFIO, resultado.desafio, opcoesCookie(app.config, CAMINHO_RENOVACAO, SEGUNDOS_DESAFIO));
        return { doisFatores: true, expiraEm: new Date(Date.now() + SEGUNDOS_DESAFIO * 1000).toISOString() };
      }
      gravarCookies(app.config, resposta, resultado);
      const { tokenAcesso: _acesso, tokenRenovacao: _renovacao, lembrar: _lembrar, etapa: _etapa, ...contexto } = resultado;
      return contexto;
    },
  );

  app.post(
    '/auth/dois-fatores',
    {
      schema: { tags: ['Autenticação'], summary: 'Conclui a entrada com o código do aplicativo ou um código de recuperação', body: corpoDoisFatores },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (requisicao, resposta) => {
      const { codigo } = requisicao.body as z.infer<typeof corpoDoisFatores>;
      const resultado = await concluirDoisFatores(app, requisicao.cookies[COOKIE_DESAFIO], codigo, requisicao.ip, requisicao.headers['user-agent'] ?? null);
      resposta.clearCookie(COOKIE_DESAFIO, opcoesCookie(app.config, CAMINHO_RENOVACAO, null));
      gravarCookies(app.config, resposta, resultado);
      const { tokenAcesso: _acesso, tokenRenovacao: _renovacao, lembrar: _lembrar, etapa: _etapa, ...contexto } = resultado;
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

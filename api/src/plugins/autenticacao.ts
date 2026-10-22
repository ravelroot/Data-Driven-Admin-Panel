import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { Config } from '../config.js';
import { permissoesEfetivas } from '../modulos/comum/consultas.js';
import { ErroApi, naoAutenticado, semPermissao } from '../util/erros.js';
import { hashSha256 } from '../util/seguranca.js';
import type { Gancho, UsuarioSessao } from '../tipos.js';

export const COOKIE_SESSAO = 'bento_sessao';
export const COOKIE_RENOVACAO = 'bento_renovacao';
export const CAMINHO_RENOVACAO = '/api/v1/auth';
export const DURACAO_ACESSO = '15m';
export const DIAS_LEMBRAR = 30;
export const HORAS_SEM_LEMBRAR = 12;

export interface CargaJwt {
  sub: string;
  sid: string;
}

const METODOS_LEITURA = new Set(['GET', 'HEAD', 'OPTIONS']);

export function opcoesCookie(config: Config, caminho: string, segundos: number | null): CookieSerializeOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.https,
    path: caminho,
    ...(segundos ? { maxAge: segundos } : {}),
  };
}

export function limparCookies(config: Config, resposta: FastifyReply): void {
  resposta.clearCookie(COOKIE_SESSAO, opcoesCookie(config, '/', null));
  resposta.clearCookie(COOKIE_RENOVACAO, opcoesCookie(config, CAMINHO_RENOVACAO, null));
}

function ehExpirado(erro: unknown): boolean {
  const codigo = String((erro as { code?: unknown }).code ?? '');
  return codigo.includes('EXPIRED');
}

async function autenticarChaveApi(app: FastifyInstance, requisicao: FastifyRequest, segredo: string): Promise<UsuarioSessao> {
  const { linhas } = await app.banco.consultar<{
    id: string;
    usuario_id: string;
    escopos: string[];
    nome: string;
    email: string;
    papel: string;
    status: string;
  }>(
    `select c.id, c.usuario_id, c.escopos, u.nome, u.email, u.papel, u.status
       from chaves_api c
       join usuarios u on u.id = c.usuario_id
      where c.segredo_hash = $1 and c.revogada_em is null`,
    [hashSha256(segredo)],
  );
  const chave = linhas[0];
  if (!chave) throw naoAutenticado('Chave de API inválida ou revogada.');
  if (chave.status === 'bloqueado') throw new ErroApi('BLOQUEADO', 'A conta dona desta chave está bloqueada.');
  if (chave.status !== 'ativo') throw new ErroApi('SEM_ACESSO_PAINEL', 'A conta dona desta chave não está ativa.');
  if (!METODOS_LEITURA.has(requisicao.method) && !chave.escopos.includes('escrita')) {
    throw semPermissao('Esta chave de API só permite leitura.');
  }
  const permissoes = new Set(await permissoesEfetivas(app.banco, chave.usuario_id));
  if (!permissoes.has('painel.ver')) throw new ErroApi('SEM_ACESSO_PAINEL', 'Esta conta não tem acesso ao painel.');
  void app.banco
    .consultar('update chaves_api set ultimo_uso = now() where id = $1', [chave.id])
    .catch(() => undefined);
  return {
    id: chave.usuario_id,
    nome: chave.nome,
    email: chave.email,
    papel: chave.papel,
    permissoes,
    sessaoId: null,
    viaCookie: false,
    escopos: chave.escopos,
  };
}

async function autenticarJwt(
  app: FastifyInstance,
  token: string,
  viaCookie: boolean,
): Promise<UsuarioSessao> {
  let carga: CargaJwt;
  try {
    carga = app.jwt.verify<CargaJwt>(token);
  } catch (erro) {
    throw naoAutenticado(ehExpirado(erro) ? 'Sua sessão expirou.' : 'Sessão inválida. Entre novamente.');
  }
  const { linhas } = await app.banco.consultar<{
    id: string;
    nome: string;
    email: string;
    papel: string;
    status: string;
    revogada_em: Date | null;
    expira_em: Date;
    ultimo_uso: Date;
  }>(
    `select u.id, u.nome, u.email, u.papel, u.status, s.revogada_em, s.expira_em, s.ultimo_uso
       from sessoes s
       join usuarios u on u.id = s.usuario_id
      where s.id = $1 and u.id = $2`,
    [carga.sid, carga.sub],
  );
  const linha = linhas[0];
  if (!linha || linha.revogada_em || new Date(linha.expira_em).getTime() < Date.now()) {
    throw naoAutenticado('Sua sessão foi encerrada. Entre novamente.');
  }
  if (linha.status === 'bloqueado') throw new ErroApi('BLOQUEADO', 'Esta conta está bloqueada.');
  if (linha.status !== 'ativo') throw new ErroApi('SEM_ACESSO_PAINEL', 'Esta conta não está ativa.');
  const permissoes = new Set(await permissoesEfetivas(app.banco, linha.id));
  if (!permissoes.has('painel.ver')) throw new ErroApi('SEM_ACESSO_PAINEL', 'Esta conta não tem acesso ao painel.');
  if (Date.now() - new Date(linha.ultimo_uso).getTime() > 60_000) {
    void app.banco.consultar('update sessoes set ultimo_uso = now() where id = $1', [carga.sid]).catch(() => undefined);
  }
  return {
    id: linha.id,
    nome: linha.nome,
    email: linha.email,
    papel: linha.papel,
    permissoes,
    sessaoId: carga.sid,
    viaCookie,
    escopos: null,
  };
}

export function registrarAutenticacao(app: FastifyInstance): void {
  app.decorateRequest('usuario', null);

  app.addHook('preHandler', async (requisicao) => {
    if (METODOS_LEITURA.has(requisicao.method)) return;
    if (!requisicao.url.startsWith('/api/')) return;
    if (requisicao.headers.authorization) return;
    const temCookie = Boolean(requisicao.cookies?.[COOKIE_SESSAO] || requisicao.cookies?.[COOKIE_RENOVACAO]);
    if (temCookie && requisicao.headers['x-bento'] !== '1') {
      throw new ErroApi('CSRF', 'Cabeçalho X-Bento ausente. Recarregue a página e tente de novo.');
    }
  });

  const autenticar: Gancho = async (requisicao) => {
    if (requisicao.usuario) return;
    const cabecalho = requisicao.headers.authorization;
    if (cabecalho) {
      const [esquema, valor] = cabecalho.split(' ');
      if (esquema?.toLowerCase() !== 'bearer' || !valor) throw naoAutenticado('Cabeçalho Authorization inválido.');
      requisicao.usuario = valor.startsWith('bnt_')
        ? await autenticarChaveApi(app, requisicao, valor)
        : await autenticarJwt(app, valor, false);
      return;
    }
    const token = requisicao.cookies?.[COOKIE_SESSAO];
    if (!token) throw naoAutenticado();
    requisicao.usuario = await autenticarJwt(app, token, true);
  };

  app.decorate('autenticar', autenticar);
}

export function exigir(...permissoes: string[]): Gancho {
  return async (requisicao) => {
    const usuario = requisicao.usuario;
    if (!usuario) throw naoAutenticado();
    const faltando = permissoes.filter((permissao) => !usuario.permissoes.has(permissao));
    if (faltando.length > 0) {
      throw semPermissao(`Você precisa da permissão ${faltando.join(', ')} para esta ação.`);
    }
  };
}

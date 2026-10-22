import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Banco } from './banco/conexao.js';
import type { Config } from './config.js';
import type { Barramento } from './tempo-real/barramento.js';

export interface UsuarioSessao {
  id: string;
  nome: string;
  email: string;
  papel: string;
  permissoes: Set<string>;
  sessaoId: string | null;
  viaCookie: boolean;
  escopos: string[] | null;
}

export type Gancho = (requisicao: FastifyRequest, resposta: FastifyReply) => Promise<void>;

declare module 'fastify' {
  interface FastifyInstance {
    banco: Banco;
    config: Config;
    barramento: Barramento;
    autenticar: Gancho;
  }

  interface FastifyRequest {
    usuario: UsuarioSessao | null;
  }
}

export function usuarioAtual(requisicao: FastifyRequest): UsuarioSessao {
  if (!requisicao.usuario) throw new Error('Rota sem autenticação');
  return requisicao.usuario;
}

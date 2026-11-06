import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { usuarioAtual } from '../../tipos.js';
import {
  ativarDoisFatores,
  desativarDoisFatores,
  estadoDoisFatores,
  iniciarConfiguracao,
  regenerarCodigos,
  type UsuarioSeguranca,
} from './dois-fatores.js';

const senha = z.string().min(1, 'Informe a senha atual.').max(200);
const codigo = z.string().trim().min(6, 'Digite o código de 6 dígitos.').max(20);

const corpoSenha = z.object({ senhaAtual: senha });
const corpoAtivar = z.object({ codigo });
const corpoDesativar = z.object({ senhaAtual: senha, codigo });
const corpoCodigos = z.object({ senhaAtual: senha, codigo });

const limite = { rateLimit: { max: 10, timeWindow: '1 minute' } };

function pessoa(requisicao: FastifyRequest): UsuarioSeguranca {
  const usuario = usuarioAtual(requisicao);
  return { id: usuario.id, nome: usuario.nome, email: usuario.email, papel: usuario.papel, sessaoId: usuario.sessaoId };
}

export async function rotasSeguranca(app: FastifyInstance): Promise<void> {
  const tags = ['Configurações'];
  const autenticado = [app.autenticar];
  const base = '/configuracoes/seguranca/dois-fatores';

  app.get(base, { schema: { tags, summary: 'Estado da verificação em duas etapas da pessoa logada' }, preHandler: autenticado }, async (requisicao) =>
    estadoDoisFatores(app.banco, usuarioAtual(requisicao).id),
  );

  app.post(
    `${base}/iniciar`,
    { schema: { tags, summary: 'Gera o segredo do aplicativo autenticador (vale 15 minutos)', body: corpoSenha }, preHandler: autenticado, config: limite },
    async (requisicao) => iniciarConfiguracao(app, pessoa(requisicao), (requisicao.body as z.infer<typeof corpoSenha>).senhaAtual),
  );

  app.post(
    `${base}/ativar`,
    { schema: { tags, summary: 'Confirma o primeiro código e devolve os códigos de recuperação', body: corpoAtivar }, preHandler: autenticado, config: limite },
    async (requisicao) => ativarDoisFatores(app, pessoa(requisicao), (requisicao.body as z.infer<typeof corpoAtivar>).codigo, requisicao.ip),
  );

  app.post(
    `${base}/desativar`,
    { schema: { tags, summary: 'Desliga a verificação em duas etapas com a senha e um código', body: corpoDesativar }, preHandler: autenticado, config: limite },
    async (requisicao) => {
      const corpo = requisicao.body as z.infer<typeof corpoDesativar>;
      return desativarDoisFatores(app, pessoa(requisicao), corpo.senhaAtual, corpo.codigo, requisicao.ip);
    },
  );

  app.post(
    `${base}/codigos`,
    { schema: { tags, summary: 'Troca os códigos de recuperação por dez novos (senha e código)', body: corpoCodigos }, preHandler: autenticado, config: limite },
    async (requisicao) => {
      const corpo = requisicao.body as z.infer<typeof corpoCodigos>;
      return regenerarCodigos(app, pessoa(requisicao), corpo.senhaAtual, corpo.codigo, requisicao.ip);
    },
  );
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { exigir } from '../../plugins/autenticacao.js';
import { usuarioAtual } from '../../tipos.js';
import { paramId } from '../../util/validacao.js';
import { atualizarIntegracao, listarIntegracoes, testarIntegracao } from './servico.js';

const corpoAtualizar = z
  .object({
    ativo: z.boolean().optional(),
    config: z.record(z.string().regex(/^[a-zA-Z]{2,40}$/), z.string().max(500)).optional(),
  })
  .strict();

export async function rotasIntegracoes(app: FastifyInstance): Promise<void> {
  const tags = ['Integrações'];
  const protecao = [app.autenticar, exigir('configuracoes.integracoes')];

  app.get('/integracoes', { schema: { tags, summary: 'Integrações disponíveis e seu estado' }, preHandler: protecao }, async () =>
    listarIntegracoes(app.banco, app.config.segredoJwt),
  );

  app.patch(
    '/integracoes/:id',
    { schema: { tags, summary: 'Ativa, desativa ou configura uma integração', params: paramId, body: corpoAtualizar }, preHandler: protecao },
    async (requisicao) =>
      atualizarIntegracao(
        app.banco,
        app.config.segredoJwt,
        (requisicao.params as z.infer<typeof paramId>).id,
        requisicao.body as z.infer<typeof corpoAtualizar>,
        usuarioAtual(requisicao),
        requisicao.ip,
      ),
  );

  app.post(
    '/integracoes/:id/testar',
    {
      schema: { tags, summary: 'Testa a integração com os dados salvos', params: paramId },
      preHandler: protecao,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (requisicao) => testarIntegracao(app.banco, app.config.segredoJwt, (requisicao.params as z.infer<typeof paramId>).id),
  );
}

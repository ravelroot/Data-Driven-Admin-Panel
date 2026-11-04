import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { exigir } from '../../plugins/autenticacao.js';
import { usuarioAtual } from '../../tipos.js';
import { esquemaUuid, opcional, paginacaoSimples, paramId } from '../../util/validacao.js';
import { atualizarIntegracao, listarEntregas, listarIntegracoes, reenviarEntrega, testarIntegracao } from './servico.js';

const consultaEntregas = paginacaoSimples.extend({ status: opcional(z.enum(['pendente', 'entregue', 'falhou'])) });
const paramEntrega = z.object({ id: esquemaUuid, entrega: esquemaUuid });

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
    async (requisicao) => testarIntegracao(app.banco, app.config.segredoJwt, requisicao.log, (requisicao.params as z.infer<typeof paramId>).id),
  );

  app.get(
    '/integracoes/:id/entregas',
    {
      schema: { tags, summary: 'Histórico de entregas de eventos, com status, código HTTP e tentativas', params: paramId, querystring: consultaEntregas },
      preHandler: protecao,
    },
    async (requisicao) =>
      listarEntregas(app.banco, (requisicao.params as z.infer<typeof paramId>).id, requisicao.query as z.infer<typeof consultaEntregas>),
  );

  app.post(
    '/integracoes/:id/entregas/:entrega/reenviar',
    {
      schema: { tags, summary: 'Reenvia agora um evento já entregue ou que falhou', params: paramEntrega },
      preHandler: protecao,
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (requisicao) => {
      const { id, entrega } = requisicao.params as z.infer<typeof paramEntrega>;
      return reenviarEntrega(app.banco, app.config.segredoJwt, requisicao.log, id, entrega, usuarioAtual(requisicao), requisicao.ip);
    },
  );
}

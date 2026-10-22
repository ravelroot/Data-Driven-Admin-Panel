import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { exigir } from '../../plugins/autenticacao.js';
import { esquemaDia, opcional } from '../../util/validacao.js';
import { calcularAnalytics } from './servico.js';

const consulta = z.object({
  inicio: opcional(esquemaDia),
  fim: opcional(esquemaDia),
  agrupar: z.enum(['dia', 'semana', 'mes']).default('dia'),
});

export async function rotasAnalytics(app: FastifyInstance): Promise<void> {
  app.get(
    '/analytics',
    {
      schema: {
        tags: ['Analytics'],
        summary: 'Séries, canais, dispositivos, países, funil, coortes e mapa de calor por período',
        querystring: consulta,
      },
      preHandler: [app.autenticar, exigir('analytics.ver')],
    },
    async (requisicao) => {
      const filtro = requisicao.query as z.infer<typeof consulta>;
      return calcularAnalytics(app.banco, app.config.fuso, filtro);
    },
  );
}

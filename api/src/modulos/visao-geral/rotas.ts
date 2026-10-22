import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { exigir } from '../../plugins/autenticacao.js';
import { calcularVisaoGeral } from './servico.js';

const consulta = z.object({ periodo: z.enum(['7d', '30d', '90d', '12m']).default('30d') });

export async function rotasVisaoGeral(app: FastifyInstance): Promise<void> {
  app.get(
    '/visao-geral',
    {
      schema: { tags: ['Visão geral'], summary: 'KPIs, receita mensal, planos, canais e atividade recente', querystring: consulta },
      preHandler: [app.autenticar, exigir('painel.ver')],
    },
    async (requisicao) => {
      const { periodo } = requisicao.query as z.infer<typeof consulta>;
      return calcularVisaoGeral(app.banco, app.config.fuso, periodo);
    },
  );
}

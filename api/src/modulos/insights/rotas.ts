import type { FastifyInstance } from 'fastify';
import { exigir } from '../../plugins/autenticacao.js';
import { calcularInsights } from './servico.js';

export async function rotasInsights(app: FastifyInstance): Promise<void> {
  app.get(
    '/insights',
    {
      schema: { tags: ['Visão geral'], summary: 'Previsão da receita do mês, tendência do MRR, anomalias e destaques' },
      preHandler: [app.autenticar, exigir('painel.ver')],
    },
    async () => calcularInsights(app.banco, app.config.fuso),
  );
}

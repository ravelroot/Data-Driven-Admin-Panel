import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { exigir } from '../../plugins/autenticacao.js';
import { usuarioAtual } from '../../tipos.js';
import { registrarAtividade } from '../comum/auditoria.js';
import { hojeLocal } from '../metricas/base.js';
import { analisarPlanilha, estadoMotor, gerarPlanilhaAnalise, obterAnalise, semClientes, simularCenario } from './servico.js';

const tags = ['Inteligência'];
const LIMITE_PLANILHA = 7_000_000;

const consultaAnalise = z.object({ atualizar: z.enum(['0', '1', 'true', 'false']).optional() }).strict();

const corpoCenario = z
  .object({
    preco: z.number().finite().min(-50).max(200).default(0),
    churnPp: z.number().finite().min(-20).max(20).default(0),
    aquisicao: z.number().finite().min(-100).max(300).default(0),
    elasticidade: z.number().finite().min(0).max(3).default(0),
    meses: z.number().int().min(3).max(36).default(12),
  })
  .strict();

const corpoPlanilha = z
  .object({
    nome: z
      .string()
      .trim()
      .min(5)
      .max(200)
      .regex(/\.(xlsx|csv|txt)$/i, 'Envie um arquivo .xlsx ou .csv.'),
    conteudo: z
      .string()
      .min(4)
      .max(LIMITE_PLANILHA, 'A planilha passa de 5 MB.')
      .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'O arquivo precisa estar em base64.'),
  })
  .strict();

export async function rotasCiencia(app: FastifyInstance): Promise<void> {
  const ver = [app.autenticar, exigir('analytics.ver')];

  app.get('/ciencia/estado', { schema: { tags, summary: 'Situação do motor analítico em Python' }, preHandler: ver }, async () => estadoMotor(app));

  app.get(
    '/ciencia/analise',
    {
      schema: { tags, summary: 'Previsões, risco de cancelamento, segmentos RFM, coortes, LTV e qualidade dos dados', querystring: consultaAnalise },
      preHandler: ver,
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (requisicao) => {
      const { atualizar } = requisicao.query as z.infer<typeof consultaAnalise>;
      const analise = await obterAnalise(app, atualizar === '1' || atualizar === 'true');
      return usuarioAtual(requisicao).permissoes.has('usuarios.ver') ? analise : semClientes(analise);
    },
  );

  app.post(
    '/ciencia/simulador',
    { schema: { tags, summary: 'Simula preço, churn e aquisição nos próximos meses', body: corpoCenario }, preHandler: ver, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (requisicao) => simularCenario(app, requisicao.body as z.infer<typeof corpoCenario>),
  );

  app.get(
    '/ciencia/relatorio',
    {
      schema: { tags, summary: 'Relatório em Excel (.xlsx) com gráficos nativos' },
      preHandler: [app.autenticar, exigir('analytics.ver', 'relatorios.gerar')],
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (requisicao, resposta) => {
      const usuario = usuarioAtual(requisicao);
      const conteudo = await gerarPlanilhaAnalise(app, usuario.permissoes.has('usuarios.ver'));
      await registrarAtividade(app.banco, {
        usuarioId: usuario.id,
        acao: 'inteligencia.exportada',
        descricao: `${usuario.nome} exportou o relatório de inteligência em Excel`,
        entidade: 'relatorio',
        ip: requisicao.ip,
      });
      return resposta
        .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('content-disposition', `attachment; filename="bento-inteligencia-${hojeLocal(app.config.fuso)}.xlsx"`)
        .header('cache-control', 'no-store')
        .send(conteudo);
    },
  );

  app.post(
    '/ciencia/planilha',
    {
      schema: { tags, summary: 'Analisa uma planilha .xlsx ou .csv e sugere o mapeamento para a importação', body: corpoPlanilha },
      preHandler: [app.autenticar, exigir('usuarios.importar')],
      bodyLimit: LIMITE_PLANILHA + 2_048,
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (requisicao) => {
      const { nome, conteudo } = requisicao.body as z.infer<typeof corpoPlanilha>;
      return analisarPlanilha(app, nome, conteudo);
    },
  );
}

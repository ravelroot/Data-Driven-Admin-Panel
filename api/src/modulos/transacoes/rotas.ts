import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { exigir } from '../../plugins/autenticacao.js';
import { gerarCsv, type Coluna } from '../../relatorios/csv.js';
import { usuarioAtual } from '../../tipos.js';
import { hojeLocal } from '../metricas/base.js';
import { esquemaDia, esquemaPaginacao, opcional, paramId } from '../../util/validacao.js';
import {
  detalharTransacao,
  linhasExportacaoTransacoes,
  listarTransacoes,
  reembolsarTransacao,
  resumirTransacoes,
} from './servico.js';

const filtros = {
  status: opcional(z.enum(['paga', 'pendente', 'falhou', 'reembolsada'])),
  metodo: opcional(z.enum(['cartao', 'pix', 'boleto'])),
  tipo: opcional(z.enum(['assinatura', 'upgrade', 'avulsa', 'reembolso'])),
  inicio: opcional(esquemaDia),
  fim: opcional(esquemaDia),
};

const consultaLista = esquemaPaginacao(['criadoEm', 'valor', 'codigo', 'status', 'usuario', 'metodo'] as const, 'criadoEm').extend(filtros);

const consultaResumo = z.object({
  q: opcional(z.string().trim().max(120)),
  ...filtros,
});

const corpoReembolsar = z.object({
  motivo: z
    .string()
    .trim()
    .min(3, 'Explique o motivo do reembolso (mínimo de 3 caracteres).')
    .max(300, 'O motivo pode ter no máximo 300 caracteres.'),
});

const consultaExportar = z.object({
  formato: z.enum(['csv']).default('csv'),
  q: opcional(z.string().trim().max(120)),
  ...filtros,
});

export const COLUNAS_TRANSACOES: Coluna[] = [
  { campo: 'codigo', titulo: 'Código', formato: 'texto' },
  { campo: 'data', titulo: 'Data', formato: 'data' },
  { campo: 'cliente', titulo: 'Cliente', formato: 'texto' },
  { campo: 'email', titulo: 'E-mail', formato: 'texto' },
  { campo: 'plano', titulo: 'Plano', formato: 'texto' },
  { campo: 'tipo', titulo: 'Tipo', formato: 'texto' },
  { campo: 'metodo', titulo: 'Método', formato: 'texto' },
  { campo: 'status', titulo: 'Status', formato: 'texto' },
  { campo: 'valor', titulo: 'Valor (R$)', formato: 'moeda' },
];

export async function rotasTransacoes(app: FastifyInstance): Promise<void> {
  const protecao = [app.autenticar, exigir('transacoes.ver')];
  const tags = ['Transações'];

  app.get(
    '/transacoes',
    { schema: { tags: ['Transações'], summary: 'Lista paginada com busca, filtros e ordenação', querystring: consultaLista }, preHandler: protecao },
    async (requisicao) => listarTransacoes(app.banco, app.config.fuso, requisicao.query as z.infer<typeof consultaLista>),
  );

  app.get(
    '/transacoes/resumo',
    {
      schema: { tags, summary: 'Resumo do filtro: quantidade, valor pago, valor reembolsado, taxa de falha e contagens por status', querystring: consultaResumo },
      preHandler: protecao,
    },
    async (requisicao) => resumirTransacoes(app.banco, app.config.fuso, requisicao.query as z.infer<typeof consultaResumo>),
  );

  app.get(
    '/transacoes/exportar',
    { schema: { tags: ['Transações'], summary: 'Exporta as transações filtradas em CSV', querystring: consultaExportar }, preHandler: protecao },
    async (requisicao, resposta) => {
      const filtro = requisicao.query as z.infer<typeof consultaExportar>;
      const linhas = await linhasExportacaoTransacoes(app.banco, app.config.fuso, filtro);
      const arquivo = gerarCsv(COLUNAS_TRANSACOES, linhas, app.config.fuso);
      return resposta
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="bento-transacoes-${hojeLocal(app.config.fuso)}.csv"`)
        .send(arquivo);
    },
  );

  app.get(
    '/transacoes/:id',
    { schema: { tags: ['Transações'], summary: 'Detalhe de uma transação', params: paramId }, preHandler: protecao },
    async (requisicao) => detalharTransacao(app.banco, (requisicao.params as z.infer<typeof paramId>).id),
  );

  app.post(
    '/transacoes/:id/reembolsar',
    {
      schema: {
        tags,
        summary: 'Reembolsa uma transação paga e registra o motivo na auditoria',
        description: 'Só aceita transações com status "paga"; nos outros casos responde 409.',
        params: paramId,
        body: corpoReembolsar,
      },
      preHandler: [app.autenticar, exigir('transacoes.reembolsar')],
    },
    async (requisicao) =>
      reembolsarTransacao(
        app,
        { usuario: usuarioAtual(requisicao), ip: requisicao.ip },
        (requisicao.params as z.infer<typeof paramId>).id,
        (requisicao.body as z.infer<typeof corpoReembolsar>).motivo,
      ),
  );
}

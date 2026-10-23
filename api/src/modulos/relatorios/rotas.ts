import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { exigir } from '../../plugins/autenticacao.js';
import { usuarioAtual } from '../../tipos.js';
import { esquemaDia, opcional, paginacaoSimples, paramId } from '../../util/validacao.js';
import { TIPOS_RELATORIO } from './dados.js';
import {
  alterarAgendamento,
  criarAgendamento,
  excluirAgendamento,
  excluirRelatorio,
  gerarRelatorio,
  listarAgendamentos,
  listarRelatorios,
  obterArquivo,
  previa,
} from './servico.js';

const tipo = z.enum(['receita', 'transacoes', 'usuarios', 'assinaturas', 'crescimento']);
const formato = z.enum(['csv', 'pdf']);

const consultaPrevia = z.object({ tipo, inicio: esquemaDia, fim: esquemaDia });

const corpoGerar = z.object({
  tipo,
  formato,
  inicio: esquemaDia,
  fim: esquemaDia,
  nome: opcional(z.string().trim().min(2).max(160)),
});

const corpoAgendar = z.object({
  nome: z.string().trim().min(2).max(120),
  tipo,
  formato,
  frequencia: z.enum(['diaria', 'semanal', 'mensal']),
  periodo: z.enum(['7d', '30d', 'mes-anterior']),
});

const corpoAlterarAgendamento = z.object({ ativo: z.boolean() });

export async function rotasRelatorios(app: FastifyInstance): Promise<void> {
  const tags = ['Relatórios'];
  const pode = (...permissoes: string[]) => [app.autenticar, exigir(...permissoes)];

  app.get('/relatorios/tipos', { schema: { tags, summary: 'Tipos de relatório e colunas' }, preHandler: pode('relatorios.ver') }, async () =>
    TIPOS_RELATORIO,
  );

  app.get(
    '/relatorios/previa',
    { schema: { tags, summary: 'Prévia das primeiras linhas e resumo', querystring: consultaPrevia }, preHandler: pode('relatorios.ver') },
    async (requisicao) => {
      const consulta = requisicao.query as z.infer<typeof consultaPrevia>;
      return previa(app.banco, app.config.fuso, consulta.tipo, consulta.inicio, consulta.fim);
    },
  );

  app.get(
    '/relatorios',
    { schema: { tags, summary: 'Histórico de relatórios gerados', querystring: paginacaoSimples }, preHandler: pode('relatorios.ver') },
    async (requisicao) => {
      const consulta = requisicao.query as z.infer<typeof paginacaoSimples>;
      return listarRelatorios(app.banco, consulta.pagina, consulta.porPagina);
    },
  );

  app.post(
    '/relatorios',
    {
      schema: { tags, summary: 'Gera um relatório em CSV ou PDF', body: corpoGerar },
      preHandler: pode('relatorios.gerar'),
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (requisicao, resposta) => {
      const autor = usuarioAtual(requisicao);
      const relatorio = await gerarRelatorio(app, requisicao.body as z.infer<typeof corpoGerar>, autor, { ip: requisicao.ip });
      return resposta.status(201).send(relatorio);
    },
  );

  app.get(
    '/relatorios/agendados',
    { schema: { tags, summary: 'Relatórios recorrentes' }, preHandler: pode('relatorios.ver') },
    async () => listarAgendamentos(app.banco),
  );

  app.post(
    '/relatorios/agendados',
    { schema: { tags, summary: 'Agenda um relatório recorrente', body: corpoAgendar }, preHandler: pode('relatorios.agendar') },
    async (requisicao, resposta) => {
      const agendamento = await criarAgendamento(
        app.banco,
        app.config.fuso,
        requisicao.body as z.infer<typeof corpoAgendar>,
        usuarioAtual(requisicao),
        requisicao.ip,
      );
      return resposta.status(201).send(agendamento);
    },
  );

  app.patch(
    '/relatorios/agendados/:id',
    {
      schema: { tags, summary: 'Ativa ou pausa um agendamento', params: paramId, body: corpoAlterarAgendamento },
      preHandler: pode('relatorios.agendar'),
    },
    async (requisicao) =>
      alterarAgendamento(
        app.banco,
        app.config.fuso,
        (requisicao.params as z.infer<typeof paramId>).id,
        (requisicao.body as z.infer<typeof corpoAlterarAgendamento>).ativo,
        usuarioAtual(requisicao),
      ),
  );

  app.delete(
    '/relatorios/agendados/:id',
    { schema: { tags, summary: 'Remove um agendamento', params: paramId }, preHandler: pode('relatorios.agendar') },
    async (requisicao, resposta) => {
      await excluirAgendamento(app.banco, (requisicao.params as z.infer<typeof paramId>).id, usuarioAtual(requisicao));
      return resposta.status(204).send();
    },
  );

  app.get(
    '/relatorios/:id/baixar',
    { schema: { tags, summary: 'Baixa o arquivo do relatório', params: paramId }, preHandler: pode('relatorios.ver') },
    async (requisicao, resposta) => {
      const arquivo = await obterArquivo(app.banco, (requisicao.params as z.infer<typeof paramId>).id);
      return resposta
        .header('content-type', arquivo.mime)
        .header('content-disposition', `attachment; filename="${arquivo.nome}"`)
        .header('content-length', arquivo.conteudo.length)
        .send(arquivo.conteudo);
    },
  );

  app.delete(
    '/relatorios/:id',
    { schema: { tags, summary: 'Exclui um relatório do histórico', params: paramId }, preHandler: pode('relatorios.gerar') },
    async (requisicao, resposta) => {
      await excluirRelatorio(app.banco, (requisicao.params as z.infer<typeof paramId>).id, usuarioAtual(requisicao), requisicao.ip);
      return resposta.status(204).send();
    },
  );
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { exigir } from '../../plugins/autenticacao.js';
import { usuarioAtual } from '../../tipos.js';
import { conflito } from '../../util/erros.js';
import { esquemaUuid, opcional, paginacaoSimples, paramId } from '../../util/validacao.js';
import { CATALOGO_METRICAS, JANELAS_ALERTA, METRICAS_ALERTA, ROTULOS_JANELA } from './metricas.js';
import {
  atualizarAlerta,
  avaliarAlertas,
  buscarAlerta,
  criarAlerta,
  excluirAlerta,
  listarAlertas,
  listarDisparos,
  MAX_ALERTAS,
  MINUTOS_ENTRE_AVALIACOES,
  simularRegra,
  type DadosAlerta,
} from './servico.js';

const regra = {
  metrica: z.enum(METRICAS_ALERTA),
  janela: z.enum(JANELAS_ALERTA),
  modo: z.enum(['valor', 'variacao']),
  operador: z.enum(['maior', 'menor']),
  limite: z.number().finite().gt(-1_000_000_000_000).lt(1_000_000_000_000),
};

const corpoRegra = z.object(regra).strict();

const campos = {
  nome: z.string().trim().min(2, 'Dê um nome com pelo menos 2 letras.').max(80),
  ...regra,
  severidade: z.enum(['info', 'alerta', 'erro']).default('alerta'),
  notificarIntegracoes: z.boolean().default(false),
  silencioMinutos: z.number().int().min(5).max(10_080).default(60),
  ativo: z.boolean().default(true),
};

const corpoCriar = z.object(campos).strict();

const corpoAtualizar = z
  .object({
    nome: campos.nome.optional(),
    metrica: regra.metrica.optional(),
    janela: regra.janela.optional(),
    modo: regra.modo.optional(),
    operador: regra.operador.optional(),
    limite: regra.limite.optional(),
    severidade: z.enum(['info', 'alerta', 'erro']).optional(),
    notificarIntegracoes: z.boolean().optional(),
    silencioMinutos: z.number().int().min(5).max(10_080).optional(),
    ativo: z.boolean().optional(),
  })
  .strict();

const consultaDisparos = paginacaoSimples.extend({ alerta: opcional(esquemaUuid) });

export async function rotasAlertas(app: FastifyInstance): Promise<void> {
  const tags = ['Alertas'];
  const ver = [app.autenticar, exigir('alertas.ver')];
  const gerenciar = [app.autenticar, exigir('alertas.gerenciar')];
  const id = (requisicao: { params: unknown }) => (requisicao.params as z.infer<typeof paramId>).id;

  app.get('/alertas/catalogo', { schema: { tags, summary: 'Métricas e janelas disponíveis para os alertas' }, preHandler: ver }, async () => ({
    metricas: METRICAS_ALERTA.map((codigo) => CATALOGO_METRICAS[codigo]),
    janelas: JANELAS_ALERTA.map((codigo) => ({ codigo, nome: ROTULOS_JANELA[codigo] })),
    minutosEntreAvaliacoes: MINUTOS_ENTRE_AVALIACOES,
    limite: MAX_ALERTAS,
  }));

  app.get('/alertas', { schema: { tags, summary: 'Regras de alerta com o estado atual e o resumo' }, preHandler: ver }, async () => listarAlertas(app.banco));

  app.get('/alertas/disparos', { schema: { tags, summary: 'Histórico de disparos', querystring: consultaDisparos }, preHandler: ver }, async (requisicao) => {
    const consulta = requisicao.query as z.infer<typeof consultaDisparos>;
    return listarDisparos(app.banco, { alertaId: consulta.alerta, pagina: consulta.pagina, porPagina: consulta.porPagina });
  });

  app.post(
    '/alertas/simular',
    { schema: { tags, summary: 'Mede a métrica agora e diz se a regra dispararia', body: corpoRegra }, preHandler: ver, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (requisicao) => simularRegra(app.banco, app.config.fuso, requisicao.body as z.infer<typeof corpoRegra>),
  );

  app.get('/alertas/:id', { schema: { tags, summary: 'Detalhe de um alerta', params: paramId }, preHandler: ver }, async (requisicao) =>
    buscarAlerta(app.banco, id(requisicao)),
  );

  app.post('/alertas', { schema: { tags, summary: 'Cria uma regra de alerta', body: corpoCriar }, preHandler: gerenciar }, async (requisicao, resposta) => {
    const criado = await criarAlerta(app.banco, usuarioAtual(requisicao).id, requisicao.body as DadosAlerta, requisicao.ip);
    return resposta.status(201).send(criado);
  });

  app.patch(
    '/alertas/:id',
    { schema: { tags, summary: 'Altera, pausa ou retoma uma regra', params: paramId, body: corpoAtualizar }, preHandler: gerenciar },
    async (requisicao) =>
      atualizarAlerta(app.banco, usuarioAtual(requisicao).id, id(requisicao), requisicao.body as Partial<DadosAlerta>, requisicao.ip),
  );

  app.delete('/alertas/:id', { schema: { tags, summary: 'Exclui uma regra e o histórico dela', params: paramId }, preHandler: gerenciar }, async (requisicao, resposta) => {
    await excluirAlerta(app.banco, usuarioAtual(requisicao).id, id(requisicao), requisicao.ip);
    return resposta.status(204).send();
  });

  app.post(
    '/alertas/:id/avaliar',
    { schema: { tags, summary: 'Avalia a regra agora, com notificação se disparar', params: paramId }, preHandler: gerenciar, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (requisicao) => {
      const alerta = await buscarAlerta(app.banco, id(requisicao));
      if (!alerta.ativo) throw conflito('Retome o alerta para avaliar agora.');
      const resultado = await avaliarAlertas(app, { id: alerta.id, limite: 1 });
      return { ...resultado, alerta: await buscarAlerta(app.banco, alerta.id) };
    },
  );
}

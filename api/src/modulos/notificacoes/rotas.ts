import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { exigir } from '../../plugins/autenticacao.js';
import type { EventoTempoReal } from '../../tempo-real/barramento.js';
import { usuarioAtual } from '../../tipos.js';
import { naoEncontrado } from '../../util/erros.js';
import { esquemaUuid, opcional, paginacaoSimples, paramId } from '../../util/validacao.js';
import { registrarAtividade } from '../comum/auditoria.js';
import {
  categoriaVisivelPara,
  contarNaoLidas,
  criarNotificacao,
  dispensar,
  listarNotificacoes,
  marcarComoLida,
  marcarTodasComoLidas,
  obterPreferenciasNotificacao,
  salvarPreferenciasNotificacao,
} from './servico.js';

const categoria = z.enum(['transacao', 'usuario', 'sistema', 'seguranca', 'relatorio']);

const consultaLista = paginacaoSimples.extend({
  filtro: z.enum(['todas', 'nao-lidas']).default('todas'),
  categoria: opcional(categoria),
});

const corpoEnviar = z.object({
  titulo: z.string().trim().min(2).max(120),
  mensagem: z.string().trim().min(2).max(1000),
  tipo: z.enum(['info', 'sucesso', 'alerta', 'erro']).default('info'),
  destinatario: z.union([z.literal('todos'), esquemaUuid]).default('todos'),
  // "//site" e "/\site" são URLs relativas ao protocolo: levariam a outro domínio (redirecionamento aberto).
  link: opcional(z.string().trim().max(300).regex(/^(\/(?![/\\])|https?:\/\/)/, 'Use um caminho interno (/...) ou uma URL.')),
});

const corpoPreferencias = z
  .array(z.object({ categoria, app: z.boolean(), email: z.boolean() }))
  .min(1)
  .max(5);

const INTERVALO_PING = 25_000;

export async function rotasNotificacoes(app: FastifyInstance): Promise<void> {
  const tags = ['Notificações'];
  const autenticado = [app.autenticar];
  const usuario = (requisicao: FastifyRequest) => usuarioAtual(requisicao);
  const conexoes = new Set<() => void>();
  app.addHook('onClose', async () => {
    for (const encerrar of [...conexoes]) encerrar();
  });

  app.get(
    '/notificacoes',
    { schema: { tags, summary: 'Notificações da pessoa logada e avisos gerais', querystring: consultaLista }, preHandler: autenticado },
    async (requisicao) => listarNotificacoes(app.banco, usuario(requisicao).id, requisicao.query as z.infer<typeof consultaLista>),
  );

  app.get(
    '/notificacoes/contagem',
    { schema: { tags, summary: 'Quantidade de não lidas' }, preHandler: autenticado },
    async (requisicao) => ({ naoLidas: await contarNaoLidas(app.banco, usuario(requisicao).id) }),
  );

  app.get(
    '/notificacoes/preferencias',
    { schema: { tags, summary: 'Canais por categoria' }, preHandler: autenticado },
    async (requisicao) => obterPreferenciasNotificacao(app.banco, usuario(requisicao).id),
  );

  app.put(
    '/notificacoes/preferencias',
    { schema: { tags, summary: 'Salva os canais por categoria', body: corpoPreferencias }, preHandler: autenticado },
    async (requisicao) => {
      const id = usuario(requisicao).id;
      await salvarPreferenciasNotificacao(app.banco, id, requisicao.body as z.infer<typeof corpoPreferencias>);
      return obterPreferenciasNotificacao(app.banco, id);
    },
  );

  app.post(
    '/notificacoes/ler-todas',
    { schema: { tags, summary: 'Marca todas como lidas' }, preHandler: autenticado },
    async (requisicao) => ({ afetadas: await marcarTodasComoLidas(app.banco, usuario(requisicao).id) }),
  );

  app.post(
    '/notificacoes/:id/ler',
    { schema: { tags, summary: 'Marca uma notificação como lida', params: paramId }, preHandler: autenticado },
    async (requisicao) => {
      await marcarComoLida(app.banco, usuario(requisicao).id, (requisicao.params as z.infer<typeof paramId>).id);
      return { ok: true };
    },
  );

  app.delete(
    '/notificacoes/:id',
    { schema: { tags, summary: 'Dispensa a notificação para quem pediu', params: paramId }, preHandler: autenticado },
    async (requisicao, resposta) => {
      await dispensar(app.banco, usuario(requisicao).id, (requisicao.params as z.infer<typeof paramId>).id);
      return resposta.status(204).send();
    },
  );

  app.post(
    '/notificacoes',
    {
      schema: { tags, summary: 'Publica um aviso para a equipe ou para uma pessoa', body: corpoEnviar },
      preHandler: [app.autenticar, exigir('notificacoes.enviar')],
    },
    async (requisicao, resposta) => {
      const corpo = requisicao.body as z.infer<typeof corpoEnviar>;
      const autor = usuario(requisicao);
      const destinatarioId = corpo.destinatario === 'todos' ? null : corpo.destinatario;
      if (destinatarioId) {
        const { linhas } = await app.banco.consultar('select 1 from usuarios where id = $1', [destinatarioId]);
        if (!linhas[0]) throw naoEncontrado('Destinatário');
      }
      const notificacao = await criarNotificacao(app.banco, app.barramento, {
        destinatarioId,
        tipo: corpo.tipo,
        categoria: 'sistema',
        titulo: corpo.titulo,
        mensagem: corpo.mensagem,
        link: corpo.link ?? null,
        criadoPor: autor.id,
      });
      await registrarAtividade(app.banco, {
        usuarioId: autor.id,
        acao: 'notificacao.enviada',
        entidade: 'notificacao',
        entidadeId: notificacao.id,
        descricao: `publicou o aviso "${corpo.titulo}"`,
        ip: requisicao.ip,
      });
      return resposta.status(201).send(notificacao);
    },
  );

  app.get(
    '/notificacoes/fluxo',
    { schema: { tags, summary: 'Fluxo SSE com notificações, contagem, transações e cadastros em tempo real' }, preHandler: autenticado },
    async (requisicao, resposta) => {
      const pessoa = usuario(requisicao);
      resposta.hijack();
      const saida = resposta.raw;
      saida.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      let aberto = true;
      const escrever = (texto: string) => {
        if (aberto && !saida.writableEnded) saida.write(texto);
      };
      const enviar = (evento: string, dados: unknown) => escrever(`event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`);
      escrever('retry: 5000\n\n');
      enviar('contagem', { naoLidas: await contarNaoLidas(app.banco, pessoa.id) });

      const aoEvento = (evento: EventoTempoReal) => {
        void (async () => {
          if (evento.tipo === 'notificacao') {
            if (evento.destinatarioId && evento.destinatarioId !== pessoa.id) return;
            const categoriaEvento = (evento.dados as { categoria?: string }).categoria ?? 'sistema';
            if (!(await categoriaVisivelPara(app.banco, pessoa.id, categoriaEvento))) return;
            enviar('notificacao', evento.dados);
            enviar('contagem', { naoLidas: await contarNaoLidas(app.banco, pessoa.id) });
            return;
          }
          if (evento.tipo === 'transacao' && !pessoa.permissoes.has('transacoes.ver') && !pessoa.permissoes.has('painel.ver')) return;
          if (evento.tipo === 'usuario' && !pessoa.permissoes.has('usuarios.ver')) return;
          enviar(evento.tipo, evento.dados);
        })().catch((erro) => requisicao.log.warn({ erro }, 'Falha ao entregar evento SSE'));
      };
      const cancelar = app.barramento.assinar(aoEvento);
      const ping = setInterval(() => escrever(': ping\n\n'), INTERVALO_PING);
      const encerrar = () => {
        if (!aberto) return;
        aberto = false;
        clearInterval(ping);
        cancelar();
        conexoes.delete(encerrar);
        if (!saida.writableEnded) saida.end();
      };
      conexoes.add(encerrar);
      requisicao.raw.on('close', encerrar);
    },
  );
}

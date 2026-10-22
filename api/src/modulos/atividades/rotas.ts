import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { exigir } from '../../plugins/autenticacao.js';
import { esquemaUuid, montarPagina, opcional, paginacaoSimples } from '../../util/validacao.js';
import { mapearAtividade, SELECAO_ATIVIDADE } from '../comum/mapeadores.js';

const consulta = paginacaoSimples.extend({ usuario: opcional(esquemaUuid) });

export async function rotasAtividades(app: FastifyInstance): Promise<void> {
  app.get(
    '/atividades',
    {
      schema: { tags: ['Auditoria'], summary: 'Registro de atividades da plataforma', querystring: consulta },
      preHandler: [app.autenticar, exigir('auditoria.ver')],
    },
    async (requisicao) => {
      const filtro = requisicao.query as z.infer<typeof consulta>;
      const onde = filtro.usuario ? 'where a.usuario_id = $1' : '';
      const parametros = filtro.usuario ? [filtro.usuario] : [];
      const [total, itens] = await Promise.all([
        app.banco.consultar<{ total: number }>(`select count(*)::int as total from auditoria a ${onde}`, parametros),
        app.banco.consultar(
          `${SELECAO_ATIVIDADE} ${onde} order by a.criado_em desc, a.id desc
           limit ${filtro.porPagina} offset ${(filtro.pagina - 1) * filtro.porPagina}`,
          parametros,
        ),
      ]);
      return montarPagina(itens.linhas.map(mapearAtividade), total.linhas[0]?.total ?? 0, filtro.pagina, filtro.porPagina);
    },
  );
}

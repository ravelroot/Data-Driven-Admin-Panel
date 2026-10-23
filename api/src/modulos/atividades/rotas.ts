import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { exigir } from '../../plugins/autenticacao.js';
import { gerarCsv, type Coluna } from '../../relatorios/csv.js';
import { fimDoDia, inicioDoDia } from '../../util/datas.js';
import { esquemaDia, esquemaUuid, filtroBusca, montarPagina, opcional, paginacaoSimples } from '../../util/validacao.js';
import { mapearAtividade } from '../comum/mapeadores.js';
import { hojeLocal } from '../metricas/base.js';

const LIMITE_EXPORTACAO = 10_000;

const esquemaAcao = z
  .string()
  .trim()
  .max(200)
  .transform((valor) => [...new Set(valor.split(',').map((parte) => parte.trim().toLowerCase()).filter(Boolean))])
  .pipe(
    z
      .array(z.string().regex(/^[a-z_]{2,40}(\.[a-z_]{2,40})?$/, 'Use o prefixo da ação (ex.: usuario) ou a ação completa (ex.: usuario.bloqueado).'))
      .max(10, 'Informe no máximo 10 ações.'),
  );

const filtros = {
  usuario: opcional(esquemaUuid),
  acao: opcional(esquemaAcao),
  q: opcional(z.string().trim().max(120)),
  inicio: opcional(esquemaDia),
  fim: opcional(esquemaDia),
};

const periodoValido = (filtro: { inicio?: string; fim?: string }) => !filtro.inicio || !filtro.fim || filtro.inicio <= filtro.fim;
const mensagemPeriodo = { message: 'A data inicial precisa ser anterior ou igual à final.', path: ['inicio'] };

const consulta = paginacaoSimples.extend(filtros).refine(periodoValido, mensagemPeriodo);
const consultaExportar = z.object({ formato: z.enum(['csv']).default('csv'), ...filtros }).refine(periodoValido, mensagemPeriodo);

type FiltroAtividades = Omit<z.infer<typeof consultaExportar>, 'formato'>;

const COLUNAS_AUDITORIA: Coluna[] = [
  { campo: 'data', titulo: 'Data', formato: 'data' },
  { campo: 'pessoa', titulo: 'Pessoa', formato: 'texto' },
  { campo: 'acao', titulo: 'Ação', formato: 'texto' },
  { campo: 'descricao', titulo: 'Descrição', formato: 'texto' },
  { campo: 'entidade', titulo: 'Entidade', formato: 'texto' },
  { campo: 'entidadeId', titulo: 'ID da entidade', formato: 'texto' },
  { campo: 'ip', titulo: 'IP', formato: 'texto' },
  { campo: 'detalhes', titulo: 'Detalhes', formato: 'texto' },
];

const SELECAO_COMPLETA = `
  select a.id::text as id, a.usuario_id, u.nome as usuario_nome, a.acao, a.descricao, a.entidade, a.entidade_id,
         a.criado_em, a.ip, a.detalhes
  from auditoria a
  left join usuarios u on u.id = a.usuario_id
`;

function montarFiltro(filtro: FiltroAtividades, fuso: string): { onde: string; parametros: unknown[] } {
  const condicoes: string[] = [];
  const parametros: unknown[] = [];
  const adicionar = (sql: (indice: number) => string, valor: unknown) => {
    parametros.push(valor);
    condicoes.push(sql(parametros.length));
  };
  if (filtro.usuario) adicionar((i) => `a.usuario_id = $${i}`, filtro.usuario);
  if (filtro.acao?.length) {
    adicionar((i) => `(a.acao = any($${i}::text[]) or split_part(a.acao, '.', 1) = any($${i}::text[]))`, filtro.acao);
  }
  if (filtro.q) adicionar((i) => `(a.descricao ilike $${i} or u.nome ilike $${i})`, filtroBusca(filtro.q));
  if (filtro.inicio) adicionar((i) => `a.criado_em >= $${i}`, inicioDoDia(filtro.inicio, fuso));
  if (filtro.fim) adicionar((i) => `a.criado_em <= $${i}`, fimDoDia(filtro.fim, fuso));
  return { onde: condicoes.length ? `where ${condicoes.join(' and ')}` : '', parametros };
}

function mapearCompleta(linha: Record<string, unknown>) {
  return {
    ...mapearAtividade(linha),
    ip: linha.ip === null || linha.ip === undefined ? null : String(linha.ip),
    detalhes: (linha.detalhes as Record<string, unknown> | null) ?? {},
  };
}

export async function rotasAtividades(app: FastifyInstance): Promise<void> {
  const tags = ['Auditoria'];
  const protecao = [app.autenticar, exigir('auditoria.ver')];

  app.get(
    '/atividades',
    {
      schema: {
        tags,
        summary: 'Registro de atividades da plataforma',
        description:
          'Filtros opcionais: usuario (id), acao (prefixos ou ações completas separados por vírgula, ex.: usuario,transacao.reembolsar), q (busca na descrição e no nome da pessoa), inicio e fim (AAAA-MM-DD, no fuso do sistema).',
        querystring: consulta,
      },
      preHandler: protecao,
    },
    async (requisicao) => {
      const filtro = requisicao.query as z.infer<typeof consulta>;
      const { onde, parametros } = montarFiltro(filtro, app.config.fuso);
      const [total, itens] = await Promise.all([
        app.banco.consultar<{ total: number }>(
          `select count(*)::int as total from auditoria a left join usuarios u on u.id = a.usuario_id ${onde}`,
          parametros,
        ),
        app.banco.consultar(
          `${SELECAO_COMPLETA} ${onde} order by a.criado_em desc, a.id desc
           limit ${filtro.porPagina} offset ${(filtro.pagina - 1) * filtro.porPagina}`,
          parametros,
        ),
      ]);
      return montarPagina(itens.linhas.map(mapearCompleta), total.linhas[0]?.total ?? 0, filtro.pagina, filtro.porPagina);
    },
  );

  app.get(
    '/atividades/exportar',
    {
      schema: {
        tags,
        summary: `Exporta as atividades filtradas em CSV (até ${LIMITE_EXPORTACAO.toLocaleString('pt-BR')} linhas)`,
        querystring: consultaExportar,
      },
      preHandler: protecao,
    },
    async (requisicao, resposta) => {
      const filtro = requisicao.query as z.infer<typeof consultaExportar>;
      const { onde, parametros } = montarFiltro(filtro, app.config.fuso);
      const { linhas } = await app.banco.consultar(
        `${SELECAO_COMPLETA} ${onde} order by a.criado_em desc, a.id desc limit ${LIMITE_EXPORTACAO}`,
        parametros,
      );
      const registros = linhas.map((linha) => {
        const atividade = mapearCompleta(linha);
        return {
          data: atividade.criadoEm,
          pessoa: atividade.usuario?.nome ?? 'Sistema',
          acao: atividade.acao,
          descricao: atividade.descricao,
          entidade: atividade.entidade ?? '',
          entidadeId: atividade.entidadeId ?? '',
          ip: atividade.ip ?? '',
          detalhes: Object.keys(atividade.detalhes).length ? JSON.stringify(atividade.detalhes) : '',
        };
      });
      return resposta
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="bento-auditoria-${hojeLocal(app.config.fuso)}.csv"`)
        .send(gerarCsv(COLUNAS_AUDITORIA, registros, app.config.fuso));
    },
  );

  app.get(
    '/atividades/pessoas',
    { schema: { tags, summary: 'Pessoas da equipe (com acesso ao painel) para filtrar o registro' }, preHandler: protecao },
    async () => {
      const { linhas } = await app.banco.consultar<{ id: string; nome: string; papel: string; papel_nome: string }>(
        `select u.id, u.nome, u.papel, p.nome as papel_nome
           from usuarios u
           join papeis p on p.codigo = u.papel
          where p.acesso_painel
          order by lower(u.nome)
          limit 500`,
      );
      return linhas.map((linha) => ({ id: String(linha.id), nome: linha.nome, papel: { codigo: linha.papel, nome: linha.papel_nome } }));
    },
  );
}

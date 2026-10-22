import type { Banco } from '../../banco/conexao.js';
import type { Barramento } from '../../tempo-real/barramento.js';
import { naoEncontrado } from '../../util/erros.js';
import { montarPagina, type Pagina } from '../../util/validacao.js';
import { mapearNotificacao, type Notificacao } from '../comum/mapeadores.js';

export type TipoNotificacao = 'info' | 'sucesso' | 'alerta' | 'erro';
export type CategoriaNotificacao = 'transacao' | 'usuario' | 'sistema' | 'seguranca' | 'relatorio';

export const CATEGORIAS: { categoria: CategoriaNotificacao; nome: string }[] = [
  { categoria: 'transacao', nome: 'Transações' },
  { categoria: 'usuario', nome: 'Usuários' },
  { categoria: 'sistema', nome: 'Sistema' },
  { categoria: 'seguranca', nome: 'Segurança' },
  { categoria: 'relatorio', nome: 'Relatórios' },
];

export interface NovaNotificacao {
  destinatarioId: string | null;
  tipo: TipoNotificacao;
  categoria: CategoriaNotificacao;
  titulo: string;
  mensagem: string;
  link?: string | null;
  dados?: Record<string, unknown>;
  criadoPor?: string | null;
}

export async function criarNotificacao(
  banco: Banco,
  barramento: Barramento | null,
  nova: NovaNotificacao,
): Promise<Notificacao> {
  const { linhas } = await banco.consultar(
    `insert into notificacoes (destinatario_id, tipo, categoria, titulo, mensagem, link, dados, criado_por)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
     returning id, tipo, categoria, titulo, mensagem, link, criado_em, null::timestamptz as lida_em`,
    [
      nova.destinatarioId,
      nova.tipo,
      nova.categoria,
      nova.titulo.slice(0, 120),
      nova.mensagem.slice(0, 1000),
      nova.link ?? null,
      JSON.stringify(nova.dados ?? {}),
      nova.criadoPor ?? null,
    ],
  );
  const notificacao = mapearNotificacao(linhas[0]);
  if (barramento) {
    await barramento.publicar({ tipo: 'notificacao', destinatarioId: nova.destinatarioId, dados: notificacao });
  }
  return notificacao;
}

const FILTRO_VISIVEIS = `
  (n.destinatario_id = $1 or n.destinatario_id is null)
  and e.dispensada_em is null
  and n.categoria not in (select pn.categoria from preferencias_notificacao pn where pn.usuario_id = $1 and not pn.app)
`;

export async function contarNaoLidas(banco: Banco, usuarioId: string): Promise<number> {
  const { linhas } = await banco.consultar<{ total: number }>(
    `select count(*)::int as total
       from notificacoes n
       left join notificacao_estados e on e.notificacao_id = n.id and e.usuario_id = $1
      where ${FILTRO_VISIVEIS} and e.lida_em is null`,
    [usuarioId],
  );
  return linhas[0]?.total ?? 0;
}

export async function listarNotificacoes(
  banco: Banco,
  usuarioId: string,
  filtros: { filtro: 'todas' | 'nao-lidas'; categoria?: CategoriaNotificacao; pagina: number; porPagina: number },
): Promise<Pagina<Notificacao> & { naoLidas: number }> {
  const condicoes = [FILTRO_VISIVEIS];
  const parametros: unknown[] = [usuarioId];
  if (filtros.filtro === 'nao-lidas') condicoes.push('e.lida_em is null');
  if (filtros.categoria) {
    parametros.push(filtros.categoria);
    condicoes.push(`n.categoria = $${parametros.length}`);
  }
  const onde = condicoes.join(' and ');
  const base = `from notificacoes n left join notificacao_estados e on e.notificacao_id = n.id and e.usuario_id = $1 where ${onde}`;
  const total = await banco.consultar<{ total: number }>(`select count(*)::int as total ${base}`, parametros);
  const deslocamento = (filtros.pagina - 1) * filtros.porPagina;
  const { linhas } = await banco.consultar(
    `select n.id, n.tipo, n.categoria, n.titulo, n.mensagem, n.link, n.criado_em, e.lida_em ${base}
     order by n.criado_em desc, n.id desc
     limit ${filtros.porPagina} offset ${deslocamento}`,
    parametros,
  );
  const pagina = montarPagina(
    linhas.map(mapearNotificacao),
    total.linhas[0]?.total ?? 0,
    filtros.pagina,
    filtros.porPagina,
  );
  return { ...pagina, naoLidas: await contarNaoLidas(banco, usuarioId) };
}

async function garantirVisivel(banco: Banco, usuarioId: string, id: string): Promise<void> {
  const { linhas } = await banco.consultar(
    'select 1 from notificacoes where id = $1 and (destinatario_id = $2 or destinatario_id is null)',
    [id, usuarioId],
  );
  if (!linhas[0]) throw naoEncontrado('Notificação');
}

export async function marcarComoLida(banco: Banco, usuarioId: string, id: string): Promise<void> {
  await garantirVisivel(banco, usuarioId, id);
  await banco.consultar(
    `insert into notificacao_estados (notificacao_id, usuario_id, lida_em) values ($1, $2, now())
     on conflict (notificacao_id, usuario_id) do update set lida_em = coalesce(notificacao_estados.lida_em, now())`,
    [id, usuarioId],
  );
}

export async function marcarTodasComoLidas(banco: Banco, usuarioId: string): Promise<number> {
  const { linhas } = await banco.consultar<{ total: number }>(
    `with alvo as (
       select n.id
         from notificacoes n
         left join notificacao_estados e on e.notificacao_id = n.id and e.usuario_id = $1
        where ${FILTRO_VISIVEIS} and e.lida_em is null
     ), gravadas as (
       insert into notificacao_estados (notificacao_id, usuario_id, lida_em)
       select id, $1, now() from alvo
       on conflict (notificacao_id, usuario_id) do update set lida_em = now()
       returning 1
     )
     select count(*)::int as total from gravadas`,
    [usuarioId],
  );
  return linhas[0]?.total ?? 0;
}

export async function dispensar(banco: Banco, usuarioId: string, id: string): Promise<void> {
  await garantirVisivel(banco, usuarioId, id);
  await banco.consultar(
    `insert into notificacao_estados (notificacao_id, usuario_id, dispensada_em, lida_em) values ($1, $2, now(), now())
     on conflict (notificacao_id, usuario_id)
     do update set dispensada_em = now(), lida_em = coalesce(notificacao_estados.lida_em, now())`,
    [id, usuarioId],
  );
}

export async function categoriaVisivelPara(banco: Banco, usuarioId: string, categoria: string): Promise<boolean> {
  const { linhas } = await banco.consultar(
    'select 1 from preferencias_notificacao where usuario_id = $1 and categoria = $2 and not app',
    [usuarioId, categoria],
  );
  return linhas.length === 0;
}

export async function obterPreferenciasNotificacao(
  banco: Banco,
  usuarioId: string,
): Promise<{ categoria: CategoriaNotificacao; nome: string; app: boolean; email: boolean }[]> {
  const { linhas } = await banco.consultar<{ categoria: string; app: boolean; email: boolean }>(
    'select categoria, app, email from preferencias_notificacao where usuario_id = $1',
    [usuarioId],
  );
  const salvas = new Map(linhas.map((linha) => [linha.categoria, linha]));
  return CATEGORIAS.map(({ categoria, nome }) => ({
    categoria,
    nome,
    app: salvas.get(categoria)?.app ?? true,
    email: salvas.get(categoria)?.email ?? false,
  }));
}

export async function salvarPreferenciasNotificacao(
  banco: Banco,
  usuarioId: string,
  preferencias: { categoria: CategoriaNotificacao; app: boolean; email: boolean }[],
): Promise<void> {
  await banco.transacao(async (tx) => {
    for (const preferencia of preferencias) {
      await tx.consultar(
        `insert into preferencias_notificacao (usuario_id, categoria, app, email) values ($1, $2, $3, $4)
         on conflict (usuario_id, categoria) do update set app = excluded.app, email = excluded.email`,
        [usuarioId, preferencia.categoria, preferencia.app, preferencia.email],
      );
    }
  });
}

import type { FastifyInstance } from 'fastify';
import type { Banco } from '../../banco/conexao.js';
import type { UsuarioSessao } from '../../tipos.js';
import { fimDoDia, inicioDoDia, paraIso } from '../../util/datas.js';
import { conflito, naoEncontrado } from '../../util/erros.js';
import { arredondar, formatarMoeda } from '../../util/formato.js';
import { filtroBusca, montarPagina, type Pagina } from '../../util/validacao.js';
import { registrarAtividade } from '../comum/auditoria.js';
import { buscarTransacao } from '../comum/consultas.js';
import { mapearTransacao, SELECAO_TRANSACAO, type Transacao } from '../comum/mapeadores.js';
import { criarNotificacao } from '../notificacoes/servico.js';

export interface FiltroTransacoes {
  q?: string;
  status?: string;
  metodo?: string;
  tipo?: string;
  inicio?: string;
  fim?: string;
}

export const ORDENACAO_TRANSACOES = {
  criadoEm: 't.criado_em',
  valor: 't.valor',
  codigo: 't.codigo',
  status: 't.status',
  usuario: 'lower(coalesce(u.nome, t.cliente_nome))',
  metodo: 't.metodo',
} as const;

export type CampoOrdenacaoTransacao = keyof typeof ORDENACAO_TRANSACOES;

export interface ResumoTransacoes {
  quantidade: number;
  valorPago: number;
  valorReembolsado: number;
  taxaFalha: number;
}

export interface ContagensTransacoes {
  todas: number;
  paga: number;
  pendente: number;
  falhou: number;
  reembolsada: number;
}

export interface Ator {
  usuario: UsuarioSessao;
  ip: string;
}

function montarFiltro(
  filtro: FiltroTransacoes,
  fuso: string,
  { ignorarStatus = false }: { ignorarStatus?: boolean } = {},
): { onde: string; parametros: unknown[] } {
  const condicoes: string[] = [];
  const parametros: unknown[] = [];
  const adicionar = (sql: (indice: number) => string, valor: unknown) => {
    parametros.push(valor);
    condicoes.push(sql(parametros.length));
  };
  if (filtro.q) {
    adicionar(
      (i) => `(t.codigo ilike $${i} or coalesce(u.nome, t.cliente_nome) ilike $${i} or coalesce(u.email, t.cliente_email) ilike $${i})`,
      filtroBusca(filtro.q),
    );
  }
  if (filtro.status && !ignorarStatus) adicionar((i) => `t.status = $${i}`, filtro.status);
  if (filtro.metodo) adicionar((i) => `t.metodo = $${i}`, filtro.metodo);
  if (filtro.tipo) adicionar((i) => `t.tipo = $${i}`, filtro.tipo);
  if (filtro.inicio) adicionar((i) => `t.criado_em >= $${i}`, inicioDoDia(filtro.inicio, fuso));
  if (filtro.fim) adicionar((i) => `t.criado_em <= $${i}`, fimDoDia(filtro.fim, fuso));
  return { onde: condicoes.length ? `where ${condicoes.join(' and ')}` : '', parametros };
}

export async function listarTransacoes(
  banco: Banco,
  fuso: string,
  filtro: FiltroTransacoes & {
    ordenar: CampoOrdenacaoTransacao;
    direcao: 'asc' | 'desc';
    pagina: number;
    porPagina: number;
  },
): Promise<Pagina<Transacao> & { resumo: ResumoTransacoes; contagens: ContagensTransacoes }> {
  const { onde, parametros } = montarFiltro(filtro, fuso);
  const direcao = filtro.direcao === 'asc' ? 'asc' : 'desc';
  const deslocamento = (filtro.pagina - 1) * filtro.porPagina;
  const [{ resumo, contagens }, { linhas }] = await Promise.all([
    resumirTransacoes(banco, fuso, filtro),
    banco.consultar(
      `${SELECAO_TRANSACAO} ${onde}
       order by ${ORDENACAO_TRANSACOES[filtro.ordenar]} ${direcao}, t.codigo ${direcao}
       limit ${filtro.porPagina} offset ${deslocamento}`,
      parametros,
    ),
  ]);
  const pagina = montarPagina(linhas.map(mapearTransacao), resumo.quantidade, filtro.pagina, filtro.porPagina);
  return { ...pagina, resumo, contagens };
}

export async function resumirTransacoes(
  banco: Banco,
  fuso: string,
  filtro: FiltroTransacoes,
): Promise<{ resumo: ResumoTransacoes; contagens: ContagensTransacoes }> {
  const { onde, parametros } = montarFiltro(filtro, fuso, { ignorarStatus: true });
  parametros.push(filtro.status ?? null);
  const status = `$${parametros.length}::text`;
  const { linhas } = await banco.consultar<Record<string, unknown>>(
    `select count(*) filter (where ${status} is null or t.status = ${status})::int as quantidade,
            coalesce(sum(t.valor) filter (where t.status = 'paga' and (${status} is null or t.status = ${status})), 0)::bigint as valor_pago,
            coalesce(sum(t.valor) filter (where t.status = 'reembolsada' and (${status} is null or t.status = ${status})), 0)::bigint as valor_reembolsado,
            count(*) filter (where t.status = 'falhou' and (${status} is null or t.status = ${status}))::int as falhas,
            count(*)::int as todas,
            count(*) filter (where t.status = 'paga')::int as paga,
            count(*) filter (where t.status = 'pendente')::int as pendente,
            count(*) filter (where t.status = 'falhou')::int as falhou,
            count(*) filter (where t.status = 'reembolsada')::int as reembolsada
       from transacoes t
       left join usuarios u on u.id = t.usuario_id
       ${onde}`,
    parametros,
  );
  const linha = linhas[0] ?? {};
  const quantidade = Number(linha.quantidade ?? 0);
  const falhas = Number(linha.falhas ?? 0);
  return {
    resumo: {
      quantidade,
      valorPago: Number(linha.valor_pago ?? 0),
      valorReembolsado: Number(linha.valor_reembolsado ?? 0),
      taxaFalha: quantidade ? arredondar((falhas / quantidade) * 100, 1) : 0,
    },
    contagens: {
      todas: Number(linha.todas ?? 0),
      paga: Number(linha.paga ?? 0),
      pendente: Number(linha.pendente ?? 0),
      falhou: Number(linha.falhou ?? 0),
      reembolsada: Number(linha.reembolsada ?? 0),
    },
  };
}

export async function detalharTransacao(banco: Banco, id: string) {
  const { linhas } = await banco.consultar(`${SELECAO_TRANSACAO} where t.id = $1`, [id]);
  if (!linhas[0]) throw naoEncontrado('Transação');
  const transacao = mapearTransacao(linhas[0]);
  const { linhas: assinaturas } = await banco.consultar<Record<string, unknown>>(
    `select a.id, a.plano, p.nome as plano_nome, a.status, a.ciclo, a.valor, a.iniciada_em, a.renovacao_em
       from transacoes t
       join assinaturas a on a.id = t.assinatura_id
       join planos p on p.codigo = a.plano
      where t.id = $1`,
    [id],
  );
  const assinatura = assinaturas[0];
  const { linhas: reembolsos } = await banco.consultar<Record<string, unknown>>(
    `select t.pago_em, t.reembolsado_em, t.reembolso_motivo, t.reembolsado_por, r.nome as reembolsado_por_nome
       from transacoes t
       left join usuarios r on r.id = t.reembolsado_por
      where t.id = $1`,
    [id],
  );
  const reembolso = reembolsos[0] ?? {};
  return {
    ...transacao,
    pagoEm: paraIso(reembolso.pago_em),
    reembolsadoEm: paraIso(reembolso.reembolsado_em),
    reembolsoMotivo: reembolso.reembolso_motivo ? String(reembolso.reembolso_motivo) : null,
    reembolsadoPor:
      reembolso.reembolsado_por && reembolso.reembolsado_por_nome
        ? { id: String(reembolso.reembolsado_por), nome: String(reembolso.reembolsado_por_nome) }
        : null,
    assinatura: assinatura
      ? {
          id: String(assinatura.id),
          plano: { codigo: String(assinatura.plano), nome: String(assinatura.plano_nome) },
          status: String(assinatura.status),
          ciclo: String(assinatura.ciclo),
          valor: Number(assinatura.valor),
          iniciadaEm: paraIso(assinatura.iniciada_em),
          renovacaoEm: paraIso(assinatura.renovacao_em),
        }
      : null,
  };
}

export async function reembolsarTransacao(app: FastifyInstance, ator: Ator, id: string, motivo: string) {
  const { banco } = app;
  const atual = await buscarTransacao(banco, id);
  if (atual.status !== 'paga') {
    const situacao = (ROTULOS_STATUS[atual.status] ?? atual.status).toLowerCase();
    throw conflito(`Só transações pagas podem ser reembolsadas. A ${atual.codigo} está ${situacao}.`);
  }
  const valor = formatarMoeda(atual.valor);
  await banco.transacao(async (tx) => {
    const { linhas } = await tx.consultar<{ id: string }>(
      `update transacoes
          set status = 'reembolsada', reembolsado_em = now(), reembolso_motivo = $2, reembolsado_por = $3
        where id = $1 and status = 'paga'
        returning id`,
      [id, motivo, ator.usuario.id],
    );
    if (!linhas[0]) throw conflito(`A ${atual.codigo} mudou de status enquanto você confirmava. Atualize e tente de novo.`);
    await registrarAtividade(tx, {
      usuarioId: ator.usuario.id,
      acao: 'transacao.reembolsar',
      entidade: 'transacao',
      entidadeId: id,
      descricao: `reembolsou ${valor} da transação ${atual.codigo} de ${atual.usuario.nome}`,
      detalhes: { codigo: atual.codigo, valor: atual.valor, cliente: atual.usuario.nome, motivo },
      ip: ator.ip,
    });
  });
  const transacao = await detalharTransacao(banco, id);
  await app.barramento.publicar({ tipo: 'transacao', destinatarioId: null, dados: await buscarTransacao(banco, id) });
  await criarNotificacao(banco, app.barramento, {
    destinatarioId: null,
    tipo: 'alerta',
    categoria: 'transacao',
    titulo: `Reembolso de ${valor}`,
    mensagem: `${ator.usuario.nome} reembolsou ${valor} de ${atual.usuario.nome} (${atual.codigo}). Motivo: ${motivo}`,
    link: `/transacoes?transacao=${id}`,
    dados: { transacaoId: id },
    criadoPor: ator.usuario.id,
  });
  return { transacao };
}

export async function linhasExportacaoTransacoes(
  banco: Banco,
  fuso: string,
  filtro: FiltroTransacoes,
  limite = 50_000,
): Promise<Record<string, unknown>[]> {
  const { onde, parametros } = montarFiltro(filtro, fuso);
  const { linhas } = await banco.consultar(`${SELECAO_TRANSACAO} ${onde} order by t.criado_em desc limit ${limite}`, parametros);
  return linhas.map((linha) => {
    const transacao = mapearTransacao(linha);
    return {
      codigo: transacao.codigo,
      data: transacao.criadoEm,
      cliente: transacao.usuario.nome,
      email: transacao.usuario.email,
      plano: transacao.plano?.nome ?? '',
      tipo: ROTULOS_TIPO[transacao.tipo] ?? transacao.tipo,
      metodo: ROTULOS_METODO[transacao.metodo] ?? transacao.metodo,
      status: ROTULOS_STATUS[transacao.status] ?? transacao.status,
      valor: transacao.valor,
    };
  });
}

export const ROTULOS_TIPO: Record<string, string> = {
  assinatura: 'Assinatura',
  upgrade: 'Upgrade',
  avulsa: 'Avulsa',
  reembolso: 'Reembolso',
};

export const ROTULOS_METODO: Record<string, string> = { cartao: 'Cartão', pix: 'Pix', boleto: 'Boleto' };

export const ROTULOS_STATUS: Record<string, string> = {
  paga: 'Paga',
  pendente: 'Pendente',
  falhou: 'Falhou',
  reembolsada: 'Reembolsada',
};

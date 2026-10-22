import type { Banco } from '../../banco/conexao.js';
import { fimDoDia, inicioDoDia, paraIso } from '../../util/datas.js';
import { naoEncontrado } from '../../util/erros.js';
import { filtroBusca, montarPagina, type Pagina } from '../../util/validacao.js';
import { mapearTransacao, SELECAO_TRANSACAO, type Transacao } from '../comum/mapeadores.js';

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

function montarFiltro(filtro: FiltroTransacoes, fuso: string): { onde: string; parametros: unknown[] } {
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
  if (filtro.status) adicionar((i) => `t.status = $${i}`, filtro.status);
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
): Promise<Pagina<Transacao>> {
  const { onde, parametros } = montarFiltro(filtro, fuso);
  const base = `from transacoes t left join usuarios u on u.id = t.usuario_id ${onde}`;
  const total = await banco.consultar<{ total: number }>(`select count(*)::int as total ${base}`, parametros);
  const direcao = filtro.direcao === 'asc' ? 'asc' : 'desc';
  const deslocamento = (filtro.pagina - 1) * filtro.porPagina;
  const { linhas } = await banco.consultar(
    `${SELECAO_TRANSACAO} ${onde}
     order by ${ORDENACAO_TRANSACOES[filtro.ordenar]} ${direcao}, t.codigo ${direcao}
     limit ${filtro.porPagina} offset ${deslocamento}`,
    parametros,
  );
  return montarPagina(linhas.map(mapearTransacao), total.linhas[0]?.total ?? 0, filtro.pagina, filtro.porPagina);
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
  return {
    ...transacao,
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

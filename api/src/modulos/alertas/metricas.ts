import type { Banco } from '../../banco/conexao.js';
import { diaLocal, somarDias } from '../../util/datas.js';
import { arredondar, percentual, variacaoPercentual } from '../../util/formato.js';
import { carregarAssinaturas, mrrEm } from '../metricas/base.js';

export const METRICAS_ALERTA = [
  'receita',
  'transacoes_pagas',
  'taxa_falha',
  'reembolsos',
  'novos_usuarios',
  'cancelamentos',
  'mrr',
  'ticket_medio',
  'conversao',
] as const;

export const JANELAS_ALERTA = ['1h', '24h', '7d', '30d'] as const;

export type MetricaAlerta = (typeof METRICAS_ALERTA)[number];
export type JanelaAlerta = (typeof JANELAS_ALERTA)[number];
export type UnidadeMetrica = 'moeda' | 'numero' | 'percentual';

export interface DefinicaoMetrica {
  codigo: MetricaAlerta;
  nome: string;
  unidade: UnidadeMetrica;
  descricao: string;
}

export const CATALOGO_METRICAS: Record<MetricaAlerta, DefinicaoMetrica> = {
  receita: { codigo: 'receita', nome: 'Receita paga', unidade: 'moeda', descricao: 'Soma das transações pagas na janela.' },
  transacoes_pagas: { codigo: 'transacoes_pagas', nome: 'Transações pagas', unidade: 'numero', descricao: 'Quantidade de cobranças pagas na janela.' },
  taxa_falha: { codigo: 'taxa_falha', nome: 'Taxa de falha dos pagamentos', unidade: 'percentual', descricao: 'Cobranças que falharam sobre pagas e falhas.' },
  reembolsos: { codigo: 'reembolsos', nome: 'Reembolsos', unidade: 'moeda', descricao: 'Valor devolvido a clientes na janela.' },
  novos_usuarios: { codigo: 'novos_usuarios', nome: 'Novos usuários', unidade: 'numero', descricao: 'Contas de clientes criadas na janela.' },
  cancelamentos: { codigo: 'cancelamentos', nome: 'Cancelamentos', unidade: 'numero', descricao: 'Assinaturas pagas canceladas na janela.' },
  mrr: { codigo: 'mrr', nome: 'Receita recorrente (MRR)', unidade: 'moeda', descricao: 'MRR agora; a variação compara com o início da janela.' },
  ticket_medio: { codigo: 'ticket_medio', nome: 'Ticket médio', unidade: 'moeda', descricao: 'Receita paga dividida pelas transações pagas.' },
  conversao: { codigo: 'conversao', nome: 'Conversão de visitantes', unidade: 'percentual', descricao: 'Novos usuários sobre visitantes, por dia completo.' },
};

export const ROTULOS_JANELA: Record<JanelaAlerta, string> = {
  '1h': 'na última hora',
  '24h': 'nas últimas 24 horas',
  '7d': 'nos últimos 7 dias',
  '30d': 'nos últimos 30 dias',
};

const DURACOES: Record<JanelaAlerta, number> = {
  '1h': 3_600_000,
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
};

export interface Medicao {
  atual: number;
  anterior: number;
  variacao: number | null;
}

interface TotaisTransacoes {
  receita_atual: number;
  receita_anterior: number;
  pagas_atual: number;
  pagas_anterior: number;
  falhas_atual: number;
  falhas_anterior: number;
  reembolsos_atual: number;
  reembolsos_anterior: number;
}

const medicao = (atual: number, anterior: number): Medicao => ({
  atual: arredondar(atual, 2),
  anterior: arredondar(anterior, 2),
  variacao: variacaoPercentual(atual, anterior),
});

async function totaisTransacoes(banco: Banco, de: Date, meio: Date, ate: Date): Promise<TotaisTransacoes> {
  const { linhas } = await banco.consultar<TotaisTransacoes>(
    `select
       coalesce(sum(valor) filter (where status = 'paga' and criado_em >= $2), 0)::float8 as receita_atual,
       coalesce(sum(valor) filter (where status = 'paga' and criado_em < $2), 0)::float8 as receita_anterior,
       count(*) filter (where status = 'paga' and criado_em >= $2)::int as pagas_atual,
       count(*) filter (where status = 'paga' and criado_em < $2)::int as pagas_anterior,
       count(*) filter (where status = 'falhou' and criado_em >= $2)::int as falhas_atual,
       count(*) filter (where status = 'falhou' and criado_em < $2)::int as falhas_anterior,
       0::float8 as reembolsos_atual,
       0::float8 as reembolsos_anterior
     from transacoes
    where criado_em >= $1 and criado_em < $3`,
    [de, meio, ate],
  );
  const { linhas: devolvidos } = await banco.consultar<{ atual: number; anterior: number }>(
    `select coalesce(sum(valor) filter (where coalesce(reembolsado_em, criado_em) >= $2), 0)::float8 as atual,
            coalesce(sum(valor) filter (where coalesce(reembolsado_em, criado_em) < $2), 0)::float8 as anterior
       from transacoes
      where status = 'reembolsada' and coalesce(reembolsado_em, criado_em) >= $1 and coalesce(reembolsado_em, criado_em) < $3`,
    [de, meio, ate],
  );
  const base = linhas[0];
  return {
    ...base,
    reembolsos_atual: devolvidos[0]?.atual ?? 0,
    reembolsos_anterior: devolvidos[0]?.anterior ?? 0,
  };
}

export async function medirMetrica(banco: Banco, fuso: string, metrica: MetricaAlerta, janela: JanelaAlerta, agora = Date.now()): Promise<Medicao> {
  const duracao = DURACOES[janela];
  const ate = new Date(agora);
  const meio = new Date(agora - duracao);
  const de = new Date(agora - 2 * duracao);

  if (['receita', 'transacoes_pagas', 'taxa_falha', 'reembolsos', 'ticket_medio'].includes(metrica)) {
    const totais = await totaisTransacoes(banco, de, meio, ate);
    if (metrica === 'receita') return medicao(totais.receita_atual, totais.receita_anterior);
    if (metrica === 'transacoes_pagas') return medicao(totais.pagas_atual, totais.pagas_anterior);
    if (metrica === 'reembolsos') return medicao(totais.reembolsos_atual, totais.reembolsos_anterior);
    if (metrica === 'taxa_falha') {
      return medicao(
        percentual(totais.falhas_atual, totais.falhas_atual + totais.pagas_atual),
        percentual(totais.falhas_anterior, totais.falhas_anterior + totais.pagas_anterior),
      );
    }
    return medicao(
      totais.pagas_atual ? Math.round(totais.receita_atual / totais.pagas_atual) : 0,
      totais.pagas_anterior ? Math.round(totais.receita_anterior / totais.pagas_anterior) : 0,
    );
  }

  if (metrica === 'novos_usuarios') {
    const { linhas } = await banco.consultar<{ atual: number; anterior: number }>(
      `select count(*) filter (where criado_em >= $2)::int as atual, count(*) filter (where criado_em < $2)::int as anterior
         from usuarios where papel = 'cliente' and criado_em >= $1 and criado_em < $3`,
      [de, meio, ate],
    );
    return medicao(linhas[0]?.atual ?? 0, linhas[0]?.anterior ?? 0);
  }

  if (metrica === 'cancelamentos') {
    const { linhas } = await banco.consultar<{ atual: number; anterior: number }>(
      `select count(*) filter (where cancelada_em >= $2)::int as atual, count(*) filter (where cancelada_em < $2)::int as anterior
         from assinaturas where convertida_em is not null and cancelada_em >= $1 and cancelada_em < $3`,
      [de, meio, ate],
    );
    return medicao(linhas[0]?.atual ?? 0, linhas[0]?.anterior ?? 0);
  }

  if (metrica === 'mrr') {
    const assinaturas = await carregarAssinaturas(banco);
    return medicao(mrrEm(assinaturas, agora), mrrEm(assinaturas, agora - duracao));
  }

  const dias = Math.max(1, Math.ceil(duracao / 86_400_000));
  const hoje = diaLocal(ate, fuso);
  const inicioAtual = somarDias(hoje, -(dias - 1));
  const inicioAnterior = somarDias(inicioAtual, -dias);
  const { linhas } = await banco.consultar<{ visitantes_atual: number; visitantes_anterior: number }>(
    `select coalesce(sum(visitantes) filter (where dia >= $2::date), 0)::int as visitantes_atual,
            coalesce(sum(visitantes) filter (where dia < $2::date), 0)::int as visitantes_anterior
       from trafego_diario where dia >= $1::date and dia <= $3::date`,
    [inicioAnterior, inicioAtual, hoje],
  );
  const { linhas: novos } = await banco.consultar<{ atual: number; anterior: number }>(
    `select count(*) filter (where (criado_em at time zone $4)::date >= $2::date)::int as atual,
            count(*) filter (where (criado_em at time zone $4)::date < $2::date)::int as anterior
       from usuarios
      where papel = 'cliente' and (criado_em at time zone $4)::date >= $1::date and (criado_em at time zone $4)::date <= $3::date`,
    [inicioAnterior, inicioAtual, hoje, fuso],
  );
  return medicao(
    percentual(novos[0]?.atual ?? 0, linhas[0]?.visitantes_atual ?? 0),
    percentual(novos[0]?.anterior ?? 0, linhas[0]?.visitantes_anterior ?? 0),
  );
}

export function formatarValorMetrica(valor: number, unidade: UnidadeMetrica, moeda: string): string {
  if (unidade === 'moeda') {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: moeda, maximumFractionDigits: Math.abs(valor) >= 100_000 ? 0 : 2 })
      .format(valor / 100)
      .replace(/ /g, ' ');
  }
  if (unidade === 'percentual') return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(valor)}%`;
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(valor);
}

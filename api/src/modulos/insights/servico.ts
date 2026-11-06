import type { Banco } from '../../banco/conexao.js';
import { inicioDoDia, primeiroDiaDoMes, somarDias } from '../../util/datas.js';
import { arredondar, percentual, variacaoPercentual } from '../../util/formato.js';
import { obterConfigSistema } from '../comum/consultas.js';
import { carregarAssinaturas, carregarDiario, hojeLocal, mrrEm, somar, type Diario } from '../metricas/base.js';
import {
  detectarAnomalias,
  preverMes,
  regressaoLinear,
  type Anomalia,
  type DefinicaoSerie,
  type PrevisaoMes,
  type SerieDiaria,
} from './calculos.js';

export interface Destaque {
  id: string;
  icone: string;
  titulo: string;
  texto: string;
  tom: 'positivo' | 'negativo' | 'neutro';
  link: string | null;
}

export interface TendenciaMrr {
  atual: number;
  em30: number;
  em90: number;
  variacaoSemanal: number;
  serie: number[];
  rotulos: string[];
}

export interface Insights {
  geradoEm: string;
  previsao: PrevisaoMes;
  mrr: TendenciaMrr;
  anomalias: Anomalia[];
  destaques: Destaque[];
}

const NOMES_DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

const periodo = (dia: string) => `inicio=${dia}&fim=${dia}`;

const SERIES: (DefinicaoSerie & { extrair: (diario: Diario) => number; volume?: (diario: Diario) => number })[] = [
  {
    codigo: 'receita',
    nome: 'Receita paga',
    unidade: 'moeda',
    sazonal: true,
    bomQuandoSobe: true,
    minimoEsperado: 1_000,
    link: (dia) => `/transacoes?status=paga&${periodo(dia)}`,
    extrair: (diario) => diario.receita,
  },
  {
    codigo: 'pagas',
    nome: 'Transações pagas',
    unidade: 'numero',
    sazonal: true,
    bomQuandoSobe: true,
    minimoEsperado: 5,
    link: (dia) => `/transacoes?status=paga&${periodo(dia)}`,
    extrair: (diario) => diario.pagas,
  },
  {
    codigo: 'taxa_falha',
    nome: 'Taxa de falha dos pagamentos',
    unidade: 'percentual',
    sazonal: false,
    bomQuandoSobe: false,
    minimoEsperado: 1,
    volumeMinimo: 20,
    link: (dia) => `/transacoes?status=falhou&${periodo(dia)}`,
    extrair: (diario) => percentual(diario.falhas, diario.falhas + diario.pagas),
    volume: (diario) => diario.falhas + diario.pagas,
  },
  {
    codigo: 'reembolsos',
    nome: 'Reembolsos',
    unidade: 'moeda',
    sazonal: false,
    bomQuandoSobe: false,
    minimoEsperado: 5_000,
    link: (dia) => `/transacoes?status=reembolsada&${periodo(dia)}`,
    extrair: (diario) => diario.reembolsos,
  },
  {
    codigo: 'novos_usuarios',
    nome: 'Novos usuários',
    unidade: 'numero',
    sazonal: true,
    bomQuandoSobe: true,
    minimoEsperado: 5,
    link: () => '/usuarios?papel=cliente',
    extrair: (diario) => diario.novosUsuarios,
  },
  {
    codigo: 'visitantes',
    nome: 'Visitantes',
    unidade: 'numero',
    sazonal: true,
    bomQuandoSobe: true,
    minimoEsperado: 50,
    link: (dia) => `/analytics?${periodo(dia)}`,
    extrair: (diario) => diario.visitantes,
  },
  {
    codigo: 'conversao',
    nome: 'Conversão de visitantes',
    unidade: 'percentual',
    sazonal: false,
    bomQuandoSobe: true,
    minimoEsperado: 0.5,
    volumeMinimo: 200,
    link: (dia) => `/analytics?${periodo(dia)}`,
    extrair: (diario) => percentual(diario.novosUsuarios, diario.visitantes),
    volume: (diario) => diario.visitantes,
  },
];

const ORDEM_GRAVIDADE = { alta: 0, media: 1 } as const;

function serieDe(diario: Map<string, Diario>, extrair: (item: Diario) => number): SerieDiaria {
  const serie: SerieDiaria = new Map();
  for (const [dia, item] of diario) serie.set(dia, extrair(item));
  return serie;
}

function tendenciaMrr(assinaturas: Awaited<ReturnType<typeof carregarAssinaturas>>, agora: number): TendenciaMrr {
  const semanas = 12;
  const serie: number[] = [];
  const rotulos: string[] = [];
  for (let indice = semanas - 1; indice >= 0; indice -= 1) {
    const instante = agora - indice * 7 * 86_400_000;
    serie.push(mrrEm(assinaturas, instante));
    const data = new Date(instante);
    rotulos.push(`${String(data.getUTCDate()).padStart(2, '0')}/${String(data.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  const { inclinacao } = regressaoLinear(serie);
  const atual = serie[serie.length - 1] ?? 0;
  return {
    atual,
    em30: Math.max(0, Math.round(atual + (inclinacao * 30) / 7)),
    em90: Math.max(0, Math.round(atual + (inclinacao * 90) / 7)),
    variacaoSemanal: atual ? arredondar((inclinacao / atual) * 100, 2) : 0,
    serie,
    rotulos,
  };
}

async function montarDestaques(banco: Banco, fuso: string, diario: Map<string, Diario>, ontem: string): Promise<Destaque[]> {
  const destaques: Destaque[] = [];
  const ultimos7 = somar(diario, somarDias(ontem, -6), ontem);
  const anteriores7 = somar(diario, somarDias(ontem, -13), somarDias(ontem, -7));
  const variacao = variacaoPercentual(ultimos7.receita, anteriores7.receita);
  if (variacao !== null) {
    destaques.push({
      id: 'receita-semana',
      icone: variacao >= 0 ? 'tendencia-alta' : 'tendencia-baixa',
      titulo: `Receita da semana ${variacao >= 0 ? 'subiu' : 'caiu'} ${Math.abs(variacao).toLocaleString('pt-BR')}%`,
      texto: 'Últimos 7 dias completos comparados aos 7 anteriores.',
      tom: variacao >= 3 ? 'positivo' : variacao <= -3 ? 'negativo' : 'neutro',
      link: `/analytics?inicio=${somarDias(ontem, -13)}&fim=${ontem}`,
    });
  }

  const porDia = Array.from({ length: 7 }, () => ({ total: 0, dias: 0 }));
  for (let indice = 0; indice < 84; indice += 1) {
    const dia = somarDias(ontem, -indice);
    const [ano, mes, d] = dia.split('-').map(Number);
    const semana = new Date(Date.UTC(ano, mes - 1, d)).getUTCDay();
    porDia[semana].total += diario.get(dia)?.receita ?? 0;
    porDia[semana].dias += 1;
  }
  const medias = porDia.map((item) => (item.dias ? item.total / item.dias : 0));
  const melhor = medias.indexOf(Math.max(...medias));
  const mediaGeral = medias.reduce((total, valor) => total + valor, 0) / 7;
  if (mediaGeral > 0 && medias[melhor] > 0) {
    destaques.push({
      id: 'melhor-dia',
      icone: 'calendario',
      titulo: `${NOMES_DIAS[melhor][0].toUpperCase()}${NOMES_DIAS[melhor].slice(1)} vende mais`,
      texto: `Nas últimas 12 semanas, a receita média desse dia ficou ${Math.round((medias[melhor] / mediaGeral - 1) * 100)}% acima da média.`,
      tom: 'neutro',
      link: '/analytics',
    });
  }

  const inicio30 = somarDias(ontem, -29);
  const [canais, planos] = await Promise.all([
    banco.consultar<{ canal: string; visitantes: number; conversoes: number }>(
      `select canal, sum(visitantes)::int as visitantes, sum(conversoes)::int as conversoes
         from trafego_diario where dia between $1::date and $2::date
        group by canal having sum(visitantes) > 0`,
      [inicio30, ontem],
    ),
    banco.consultar<{ nome: string; atual: number; anterior: number }>(
      `select p.nome,
              coalesce(sum(t.valor) filter (where t.criado_em >= $2), 0)::float8 as atual,
              coalesce(sum(t.valor) filter (where t.criado_em < $2), 0)::float8 as anterior
         from planos p
         left join transacoes t on t.plano = p.codigo and t.status = 'paga' and t.criado_em >= $1 and t.criado_em < $3
        group by p.nome`,
      [inicioDoDia(somarDias(inicio30, -30), fuso), inicioDoDia(inicio30, fuso), inicioDoDia(somarDias(ontem, 1), fuso)],
    ),
  ]);
  const melhorCanal = canais.linhas
    .map((linha) => ({ ...linha, taxa: percentual(linha.conversoes, linha.visitantes) }))
    .sort((a, b) => b.taxa - a.taxa)[0];
  if (melhorCanal) {
    destaques.push({
      id: 'melhor-canal',
      icone: 'funil',
      titulo: `${melhorCanal.canal} converte melhor`,
      texto: `${melhorCanal.taxa.toLocaleString('pt-BR')}% dos visitantes viraram conversão nos últimos 30 dias.`,
      tom: 'positivo',
      link: `/analytics?inicio=${inicio30}&fim=${ontem}`,
    });
  }
  const planoEmAlta = planos.linhas
    .filter((linha) => linha.anterior > 0)
    .map((linha) => ({ ...linha, variacao: variacaoPercentual(linha.atual, linha.anterior) ?? 0 }))
    .sort((a, b) => b.variacao - a.variacao)[0];
  if (planoEmAlta && Math.abs(planoEmAlta.variacao) >= 5) {
    destaques.push({
      id: 'plano-em-alta',
      icone: 'pacote',
      titulo: `Plano ${planoEmAlta.nome} ${planoEmAlta.variacao >= 0 ? 'em alta' : 'em queda'}`,
      texto: `Receita ${planoEmAlta.variacao >= 0 ? '+' : '−'}${Math.abs(planoEmAlta.variacao).toLocaleString('pt-BR')}% nos últimos 30 dias contra os 30 anteriores.`,
      tom: planoEmAlta.variacao >= 0 ? 'positivo' : 'negativo',
      link: '/relatorios?tipo=receita',
    });
  }
  return destaques;
}

export async function calcularInsights(banco: Banco, fuso: string): Promise<Insights> {
  const agora = Date.now();
  const hoje = hojeLocal(fuso);
  const ontem = somarDias(hoje, -1);
  const inicioHistorico = somarDias(ontem, -(84 + 35));
  const mesAtual = primeiroDiaDoMes(hoje);
  const [diario, assinaturas, sistema, metas] = await Promise.all([
    carregarDiario(banco, fuso, inicioHistorico < mesAtual ? inicioHistorico : mesAtual, hoje),
    carregarAssinaturas(banco),
    obterConfigSistema(banco),
    banco.consultar<{ valor: number }>('select valor from metas_mensais where mes = $1::date', [mesAtual]),
  ]);
  const meta = metas.linhas[0]?.valor ?? sistema.metaMensal;
  const inicioHoje = inicioDoDia(hoje, fuso).getTime();
  const fracao = (agora - inicioHoje) / 86_400_000;
  const previsao = preverMes(serieDe(diario, (item) => item.receita), hoje, fracao, meta);

  const anomalias = SERIES.flatMap((definicao) =>
    detectarAnomalias(definicao, serieDe(diario, definicao.extrair), ontem, definicao.volume ? { volumes: serieDe(diario, definicao.volume) } : {}),
  )
    .sort((a, b) => ORDEM_GRAVIDADE[a.gravidade] - ORDEM_GRAVIDADE[b.gravidade] || b.dia.localeCompare(a.dia) || Math.abs(b.pontuacao) - Math.abs(a.pontuacao))
    .slice(0, 8);

  return {
    geradoEm: new Date(agora).toISOString(),
    previsao,
    mrr: tendenciaMrr(assinaturas, agora),
    anomalias,
    destaques: await montarDestaques(banco, fuso, diario, ontem),
  };
}

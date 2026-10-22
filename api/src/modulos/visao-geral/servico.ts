import type { Banco } from '../../banco/conexao.js';
import {
  dataBr,
  fimDoDia,
  inicioDoDia,
  primeiroDiaDoMes,
  rotuloMes,
  somarDias,
  somarMeses,
  ultimoDiaDoMes,
} from '../../util/datas.js';
import { arredondar, percentual } from '../../util/formato.js';
import { atividadesRecentes, obterConfigSistema, transacoesRecentes } from '../comum/consultas.js';
import type { Atividade, Transacao } from '../comum/mapeadores.js';
import {
  baldesBlocos,
  baldesDiarios,
  baldesMensais,
  carregarAssinaturas,
  carregarCriacaoClientes,
  carregarDiario,
  churnEntre,
  comparar,
  contarAte,
  contarAtivas,
  fimDoBalde,
  hojeLocal,
  inicioDoBalde,
  mrrEm,
  somar,
  type Balde,
} from '../metricas/base.js';

export type Periodo = '7d' | '30d' | '90d' | '12m';

export interface Kpi {
  valor: number;
  anterior: number;
  variacao: number | null;
  serie: number[];
  rotulos: string[];
}

interface Janela {
  inicio: string;
  fim: string;
  anteriorInicio: string;
  anteriorFim: string;
  baldes: Balde[];
  rotulo: string;
}

const ROTULOS: Record<Periodo, string> = {
  '7d': 'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
  '90d': 'Últimos 90 dias',
  '12m': 'Últimos 12 meses',
};

export function montarJanela(periodo: Periodo, hoje: string): Janela {
  if (periodo === '12m') {
    const inicio = somarMeses(primeiroDiaDoMes(hoje), -11);
    const anteriorInicio = somarMeses(inicio, -12);
    return {
      inicio,
      fim: hoje,
      anteriorInicio,
      anteriorFim: somarDias(inicio, -1),
      baldes: baldesMensais(inicio, hoje),
      rotulo: ROTULOS[periodo],
    };
  }
  const dias = periodo === '7d' ? 7 : periodo === '30d' ? 30 : 91;
  const inicio = somarDias(hoje, -(dias - 1));
  return {
    inicio,
    fim: hoje,
    anteriorInicio: somarDias(inicio, -dias),
    anteriorFim: somarDias(inicio, -1),
    baldes: periodo === '90d' ? baldesBlocos(inicio, hoje, 7) : baldesDiarios(inicio, hoje),
    rotulo: ROTULOS[periodo],
  };
}

export interface VisaoGeral {
  periodo: { inicio: string; fim: string; rotulo: string };
  kpis: {
    receita: Kpi;
    usuarios: Kpi & { novos: number };
    assinaturas: Kpi;
    crescimento: Kpi;
    mrr: Kpi;
    churn: Kpi;
    ticketMedio: Kpi;
    conversao: Kpi;
  };
  receitaMensal: { rotulos: string[]; receita: number[]; reembolsos: number[]; meta: number[] };
  planos: { codigo: string; nome: string; assinaturas: number; receita: number }[];
  canais: { canal: string; visitantes: number; conversoes: number }[];
  metaMensal: { valor: number; atingido: number; percentual: number };
  transacoesRecentes: Transacao[];
  atividades: Atividade[];
}

export async function calcularVisaoGeral(banco: Banco, fuso: string, periodo: Periodo): Promise<VisaoGeral> {
  const agora = Date.now();
  const hoje = hojeLocal(fuso);
  const janela = montarJanela(periodo, hoje);
  const inicioMeses = somarMeses(primeiroDiaDoMes(hoje), -11);
  const carregarDe = janela.anteriorInicio < inicioMeses ? janela.anteriorInicio : inicioMeses;
  const [diario, assinaturas, clientes, sistema, planos, canais, metas, recentes, atividades] = await Promise.all([
    carregarDiario(banco, fuso, carregarDe, hoje),
    carregarAssinaturas(banco),
    carregarCriacaoClientes(banco),
    obterConfigSistema(banco),
    banco.consultar<{ codigo: string; nome: string; receita: number }>(
      `select p.codigo, p.nome, coalesce(sum(t.valor) filter (where t.status = 'paga'), 0)::float8 as receita
         from planos p
         left join transacoes t on t.plano = p.codigo and t.criado_em >= $1 and t.criado_em <= $2
        group by p.codigo, p.nome, p.ordem
        order by p.ordem`,
      [inicioDoDia(janela.inicio, fuso), new Date(agora)],
    ),
    banco.consultar<{ canal: string; visitantes: number; conversoes: number }>(
      `select canal, sum(visitantes)::int as visitantes, sum(conversoes)::int as conversoes
         from trafego_diario
        where dia between $1::date and $2::date
        group by canal
        order by visitantes desc`,
      [janela.inicio, hoje],
    ),
    banco.consultar<{ mes: string; valor: number }>(
      `select mes, valor from metas_mensais where mes >= $1::date order by mes`,
      [inicioMeses],
    ),
    transacoesRecentes(banco, 6),
    atividadesRecentes(banco, 8),
  ]);

  const inicioAtual = inicioDoDia(janela.inicio, fuso).getTime();
  const fimAnterior = inicioAtual - 1;
  const inicioAnterior = inicioDoDia(janela.anteriorInicio, fuso).getTime();
  const atual = somar(diario, janela.inicio, janela.fim);
  const anterior = somar(diario, janela.anteriorInicio, janela.anteriorFim);
  const rotulos = janela.baldes.map((balde) => balde.rotulo);
  const finsBaldes = janela.baldes.map((balde) => fimDoBalde(balde, fuso, agora));
  const somasBaldes = janela.baldes.map((balde) => somar(diario, balde.inicio, balde.fim));

  const kpi = (valor: number, valorAnterior: number, serie: number[], modo: 'relativa' | 'pontos' = 'relativa'): Kpi => ({
    ...comparar(valor, valorAnterior, modo),
    serie,
    rotulos,
  });

  const mrrAgora = mrrEm(assinaturas, agora);
  const mrrInicio = mrrEm(assinaturas, fimAnterior);
  const mrrInicioAnterior = mrrEm(assinaturas, inicioAnterior - 1);
  const crescimento = mrrInicio ? arredondar(((mrrAgora - mrrInicio) / mrrInicio) * 100) : 0;
  const crescimentoAnterior = mrrInicioAnterior ? arredondar(((mrrInicio - mrrInicioAnterior) / mrrInicioAnterior) * 100) : 0;
  const serieMrr = finsBaldes.map((fim) => mrrEm(assinaturas, fim));
  const usuariosAgora = contarAte(clientes, agora);
  const usuariosAntes = contarAte(clientes, fimAnterior);
  const ticket = atual.pagas ? Math.round(atual.receita / atual.pagas) : 0;
  const ticketAnterior = anterior.pagas ? Math.round(anterior.receita / anterior.pagas) : 0;

  const meses = baldesMensais(inicioMeses, hoje);
  const metasPorMes = new Map(metas.linhas.map((linha) => [linha.mes, linha.valor]));
  const somasMeses = meses.map((balde) => somar(diario, balde.inicio, balde.fim));
  const mesAtual = primeiroDiaDoMes(hoje);
  const metaAtual = metasPorMes.get(mesAtual) ?? sistema.metaMensal;
  const atingido = somasMeses[somasMeses.length - 1]?.receita ?? 0;
  const ativasPorPlano = new Map<string, number>();
  for (const assinatura of assinaturas) {
    if (assinatura.convertidaEm !== null && assinatura.canceladaEm === null && assinatura.convertidaEm <= agora) {
      ativasPorPlano.set(assinatura.plano, (ativasPorPlano.get(assinatura.plano) ?? 0) + 1);
    }
  }

  return {
    periodo: { inicio: janela.inicio, fim: janela.fim, rotulo: janela.rotulo },
    kpis: {
      receita: kpi(atual.receita, anterior.receita, somasBaldes.map((soma) => soma.receita)),
      usuarios: {
        ...kpi(usuariosAgora, usuariosAntes, finsBaldes.map((fim) => contarAte(clientes, fim))),
        novos: usuariosAgora - usuariosAntes,
      },
      assinaturas: kpi(
        contarAtivas(assinaturas, agora),
        contarAtivas(assinaturas, fimAnterior),
        finsBaldes.map((fim) => contarAtivas(assinaturas, fim)),
      ),
      crescimento: kpi(crescimento, crescimentoAnterior, serieMrr, 'pontos'),
      mrr: kpi(mrrAgora, mrrInicio, serieMrr),
      churn: kpi(
        churnEntre(assinaturas, inicioAtual, agora),
        churnEntre(assinaturas, inicioAnterior, fimAnterior),
        janela.baldes.map((balde, indice) => churnEntre(assinaturas, inicioDoBalde(balde, fuso), finsBaldes[indice])),
        'pontos',
      ),
      ticketMedio: kpi(
        ticket,
        ticketAnterior,
        somasBaldes.map((soma) => (soma.pagas ? Math.round(soma.receita / soma.pagas) : 0)),
      ),
      conversao: kpi(
        percentual(atual.novosUsuarios, atual.visitantes),
        percentual(anterior.novosUsuarios, anterior.visitantes),
        somasBaldes.map((soma) => percentual(soma.novosUsuarios, soma.visitantes)),
        'pontos',
      ),
    },
    receitaMensal: {
      rotulos: meses.map((balde) => rotuloMes(balde.inicio)),
      receita: somasMeses.map((soma) => soma.receita),
      reembolsos: somasMeses.map((soma) => soma.reembolsos),
      meta: meses.map((balde) => metasPorMes.get(primeiroDiaDoMes(balde.inicio)) ?? sistema.metaMensal),
    },
    planos: planos.linhas.map((plano) => ({
      codigo: plano.codigo,
      nome: plano.nome,
      assinaturas: ativasPorPlano.get(plano.codigo) ?? 0,
      receita: plano.receita,
    })),
    canais: canais.linhas,
    metaMensal: { valor: metaAtual, atingido, percentual: percentual(atingido, metaAtual) },
    transacoesRecentes: recentes,
    atividades,
  };
}

export function descreverPeriodo(inicio: string, fim: string): string {
  return `${dataBr(inicio)} a ${dataBr(fim)}`;
}

export function limitesDoMes(dia: string, fuso: string): { de: Date; ate: Date } {
  return { de: inicioDoDia(primeiroDiaDoMes(dia), fuso), ate: fimDoDia(ultimoDiaDoMes(dia), fuso) };
}

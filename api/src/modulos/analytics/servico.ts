import type { Banco } from '../../banco/conexao.js';
import {
  diferencaDias,
  fimDoDia,
  inicioDoDia,
  primeiroDiaDoMes,
  rotuloMes,
  somarDias,
  somarMeses,
  ultimoDiaDoMes,
} from '../../util/datas.js';
import { validacao } from '../../util/erros.js';
import { arredondar, CODIGOS_PAISES, NOMES_PAISES, percentual } from '../../util/formato.js';
import {
  ativaEm,
  baldesDiarios,
  baldesMensais,
  baldesSemanais,
  cancelamentosEntre,
  carregarAssinaturas,
  carregarDiario,
  churnEntre,
  comparar,
  contarAtivas,
  conversoesEntre,
  fimDoBalde,
  hojeLocal,
  inicioDoBalde,
  mrrEm,
  somar,
  testesEntre,
  type Comparacao,
} from '../metricas/base.js';

export type Agrupamento = 'dia' | 'semana' | 'mes';

export interface FiltroAnalytics {
  inicio?: string;
  fim?: string;
  agrupar: Agrupamento;
}

const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MAXIMO_DIAS = 1_100;

export function resolverIntervalo(fuso: string, inicio?: string, fim?: string): { inicio: string; fim: string } {
  const hoje = hojeLocal(fuso);
  const fimFinal = fim && fim < hoje ? fim : hoje;
  const inicioFinal = inicio ?? somarDias(fimFinal, -29);
  if (inicioFinal > fimFinal) throw validacao('A data inicial precisa ser anterior à final.');
  if (diferencaDias(inicioFinal, fimFinal) > MAXIMO_DIAS) throw validacao('O intervalo máximo é de 3 anos.');
  return { inicio: inicioFinal, fim: fimFinal };
}

export async function calcularAnalytics(banco: Banco, fuso: string, filtro: FiltroAnalytics) {
  const agora = Date.now();
  const { inicio, fim } = resolverIntervalo(fuso, filtro.inicio, filtro.fim);
  const dias = diferencaDias(inicio, fim) + 1;
  const anteriorFim = somarDias(inicio, -1);
  const anteriorInicio = somarDias(inicio, -dias);
  const de = inicioDoDia(inicio, fuso);
  const ate = new Date(Math.min(fimDoDia(fim, fuso).getTime(), agora));
  const inicioAtual = de.getTime();
  const fimAtual = ate.getTime();
  const inicioAnterior = inicioDoDia(anteriorInicio, fuso).getTime();
  const fimAnterior = inicioAtual - 1;

  const [diario, assinaturas, canais, dispositivos, paisesTrafego, paisesReceita, planos, mapaCalor] = await Promise.all([
    carregarDiario(banco, fuso, anteriorInicio, fim),
    carregarAssinaturas(banco),
    banco.consultar<{ canal: string; visitantes: number; sessoes: number; conversoes: number }>(
      `select canal, sum(visitantes)::int as visitantes, sum(sessoes)::int as sessoes, sum(conversoes)::int as conversoes
         from trafego_diario where dia between $1::date and $2::date
        group by canal order by visitantes desc`,
      [inicio, fim],
    ),
    banco.consultar<{ dispositivo: string; visitantes: number }>(
      `select dispositivo, sum(visitantes)::int as visitantes
         from trafego_diario where dia between $1::date and $2::date
        group by dispositivo order by visitantes desc`,
      [inicio, fim],
    ),
    banco.consultar<{ codigo: string; visitantes: number }>(
      `select pais_codigo as codigo, sum(visitantes)::int as visitantes
         from trafego_paises where dia between $1::date and $2::date
        group by pais_codigo order by visitantes desc`,
      [inicio, fim],
    ),
    banco.consultar<{ pais: string | null; receita: number }>(
      `select u.pais, sum(t.valor)::float8 as receita
         from transacoes t join usuarios u on u.id = t.usuario_id
        where t.status = 'paga' and t.criado_em >= $1 and t.criado_em <= $2
        group by u.pais`,
      [de, ate],
    ),
    banco.consultar<{ codigo: string; nome: string; receita: number }>(
      `select p.codigo, p.nome, coalesce(sum(t.valor) filter (where t.status = 'paga'), 0)::float8 as receita
         from planos p
         left join transacoes t on t.plano = p.codigo and t.criado_em >= $1 and t.criado_em <= $2
        group by p.codigo, p.nome, p.ordem order by p.ordem`,
      [de, ate],
    ),
    banco.consultar<{ dia: number; hora: number; total: number }>(
      `select extract(dow from criado_em at time zone $1)::int as dia,
              extract(hour from criado_em at time zone $1)::int as hora,
              count(*)::int as total
         from transacoes
        where status = 'paga' and criado_em >= $2 and criado_em <= $3
        group by 1, 2`,
      [fuso, de, ate],
    ),
  ]);

  const atual = somar(diario, inicio, fim);
  const anterior = somar(diario, anteriorInicio, anteriorFim);
  const baldes =
    filtro.agrupar === 'mes'
      ? baldesMensais(inicio, fim)
      : filtro.agrupar === 'semana'
        ? baldesSemanais(inicio, fim)
        : baldesDiarios(inicio, fim);
  const somas = baldes.map((balde) => somar(diario, balde.inicio, balde.fim));
  const limites = baldes.map((balde) => ({ de: inicioDoBalde(balde, fuso), ate: fimDoBalde(balde, fuso, agora) }));
  const ticket = (receita: number, pagas: number) => (pagas ? Math.round(receita / pagas) : 0);

  const resumo: Record<string, Comparacao> = {
    receita: comparar(atual.receita, anterior.receita),
    transacoes: comparar(atual.pagas, anterior.pagas),
    novosUsuarios: comparar(atual.novosUsuarios, anterior.novosUsuarios),
    visitantes: comparar(atual.visitantes, anterior.visitantes),
    conversao: comparar(
      percentual(atual.novosUsuarios, atual.visitantes),
      percentual(anterior.novosUsuarios, anterior.visitantes),
      'pontos',
    ),
    ticketMedio: comparar(ticket(atual.receita, atual.pagas), ticket(anterior.receita, anterior.pagas)),
    churn: comparar(
      churnEntre(assinaturas, inicioAtual, fimAtual),
      churnEntre(assinaturas, inicioAnterior, fimAnterior),
      'pontos',
    ),
    mrr: comparar(mrrEm(assinaturas, fimAtual), mrrEm(assinaturas, fimAnterior)),
  };

  const totalDispositivos = dispositivos.linhas.reduce((soma, linha) => soma + linha.visitantes, 0);
  const receitaPorCodigo = new Map<string, number>();
  for (const linha of paisesReceita.linhas) {
    const codigo = (linha.pais && CODIGOS_PAISES[linha.pais]) || 'BR';
    receitaPorCodigo.set(codigo, (receitaPorCodigo.get(codigo) ?? 0) + linha.receita);
  }
  const ativasPorPlano = new Map<string, number>();
  for (const assinatura of assinaturas) {
    if (ativaEm(assinatura, fimAtual)) ativasPorPlano.set(assinatura.plano, (ativasPorPlano.get(assinatura.plano) ?? 0) + 1);
  }

  const valores: number[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  for (const linha of mapaCalor.linhas) valores[linha.dia][linha.hora] = linha.total;

  return {
    inicio,
    fim,
    agrupar: filtro.agrupar,
    resumo,
    serie: {
      rotulos: baldes.map((balde) => balde.rotulo),
      receita: somas.map((soma) => soma.receita),
      reembolsos: somas.map((soma) => soma.reembolsos),
      novosUsuarios: somas.map((soma) => soma.novosUsuarios),
      ativos: limites.map((limite) => contarAtivas(assinaturas, limite.ate)),
      visitantes: somas.map((soma) => soma.visitantes),
      sessoes: somas.map((soma) => soma.sessoes),
      conversoes: somas.map((soma) => soma.conversoes),
      assinaturasNovas: limites.map((limite) => conversoesEntre(assinaturas, limite.de, limite.ate)),
      cancelamentos: limites.map((limite) => cancelamentosEntre(assinaturas, limite.de, limite.ate)),
    },
    canais: canais.linhas.map((linha) => ({ ...linha, taxa: percentual(linha.conversoes, linha.visitantes) })),
    dispositivos: dispositivos.linhas.map((linha) => ({
      dispositivo: linha.dispositivo,
      visitantes: linha.visitantes,
      percentual: percentual(linha.visitantes, totalDispositivos),
    })),
    paises: paisesTrafego.linhas.slice(0, 8).map((linha) => ({
      pais: NOMES_PAISES[linha.codigo] ?? linha.codigo,
      codigo: linha.codigo,
      visitantes: linha.visitantes,
      receita: receitaPorCodigo.get(linha.codigo) ?? 0,
    })),
    planos: planos.linhas.map((plano) => ({ ...plano, assinaturas: ativasPorPlano.get(plano.codigo) ?? 0 })),
    funil: [
      { etapa: 'Visitantes', valor: atual.visitantes },
      { etapa: 'Cadastros', valor: atual.novosUsuarios },
      { etapa: 'Em teste', valor: testesEntre(assinaturas, inicioAtual, fimAtual) },
      { etapa: 'Assinantes', valor: conversoesEntre(assinaturas, inicioAtual, fimAtual) },
    ],
    coortes: calcularCoortes(assinaturas, fuso, agora),
    mapaCalor: { dias: DIAS_SEMANA, horas: Array.from({ length: 24 }, (_, hora) => hora), valores },
  };
}

function calcularCoortes(assinaturas: Awaited<ReturnType<typeof carregarAssinaturas>>, fuso: string, agora: number) {
  const hoje = hojeLocal(fuso);
  const mesAtual = primeiroDiaDoMes(hoje);
  const coortes = [];
  for (let deslocamento = 5; deslocamento >= 0; deslocamento -= 1) {
    const mes = somarMeses(mesAtual, -deslocamento);
    const de = inicioDoDia(mes, fuso).getTime();
    const ate = fimDoDia(ultimoDiaDoMes(mes), fuso).getTime();
    const membros = assinaturas.filter(
      (assinatura) => assinatura.convertidaEm !== null && assinatura.convertidaEm >= de && assinatura.convertidaEm <= ate,
    );
    const retencao: number[] = [100];
    for (let k = 1; k <= deslocamento; k += 1) {
      const fimMes = Math.min(fimDoDia(ultimoDiaDoMes(somarMeses(mes, k)), fuso).getTime(), agora);
      const ativos = membros.filter((assinatura) => ativaEm(assinatura, fimMes)).length;
      retencao.push(membros.length ? arredondar((ativos / membros.length) * 100) : 0);
    }
    coortes.push({ coorte: mes.slice(0, 7), rotulo: rotuloMes(mes), tamanho: membros.length, retencao });
  }
  return coortes;
}

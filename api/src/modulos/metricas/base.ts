import type { Banco } from '../../banco/conexao.js';
import {
  diaLocal,
  fimDoDia,
  inicioDaSemana,
  inicioDoDia,
  paraData,
  primeiroDiaDoMes,
  rotuloDia,
  rotuloMes,
  somarDias,
  somarMeses,
} from '../../util/datas.js';
import { arredondar, percentual, variacaoPercentual } from '../../util/formato.js';

export interface Diario {
  receita: number;
  reembolsos: number;
  pagas: number;
  falhas: number;
  novosUsuarios: number;
  visitantes: number;
  sessoes: number;
  cadastros: number;
  conversoes: number;
}

export interface AssinaturaResumo {
  plano: string;
  ciclo: 'mensal' | 'anual';
  valor: number;
  iniciadaEm: number;
  testeAte: number | null;
  convertidaEm: number | null;
  canceladaEm: number | null;
  status: string;
}

export interface Balde {
  inicio: string;
  fim: string;
  rotulo: string;
}

export interface Comparacao {
  valor: number;
  anterior: number;
  variacao: number | null;
}

export const vazio = (): Diario => ({
  receita: 0,
  reembolsos: 0,
  pagas: 0,
  falhas: 0,
  novosUsuarios: 0,
  visitantes: 0,
  sessoes: 0,
  cadastros: 0,
  conversoes: 0,
});

export async function carregarDiario(banco: Banco, fuso: string, inicio: string, fim: string): Promise<Map<string, Diario>> {
  const de = inicioDoDia(inicio, fuso);
  const ate = inicioDoDia(somarDias(fim, 1), fuso);
  const [transacoes, usuarios, trafego] = await Promise.all([
    banco.consultar<{ dia: string; receita: number; reembolsos: number; pagas: number; falhas: number }>(
      `select (criado_em at time zone $1)::date as dia,
              coalesce(sum(valor) filter (where status = 'paga'), 0)::float8 as receita,
              coalesce(sum(valor) filter (where status = 'reembolsada'), 0)::float8 as reembolsos,
              count(*) filter (where status = 'paga')::int as pagas,
              count(*) filter (where status = 'falhou')::int as falhas
         from transacoes
        where criado_em >= $2 and criado_em < $3
        group by 1`,
      [fuso, de, ate],
    ),
    banco.consultar<{ dia: string; total: number }>(
      `select (criado_em at time zone $1)::date as dia, count(*)::int as total
         from usuarios
        where papel = 'cliente' and criado_em >= $2 and criado_em < $3
        group by 1`,
      [fuso, de, ate],
    ),
    banco.consultar<{ dia: string; visitantes: number; sessoes: number; cadastros: number; conversoes: number }>(
      `select dia, sum(visitantes)::int as visitantes, sum(sessoes)::int as sessoes,
              sum(cadastros)::int as cadastros, sum(conversoes)::int as conversoes
         from trafego_diario
        where dia between $1::date and $2::date
        group by dia`,
      [inicio, fim],
    ),
  ]);
  const mapa = new Map<string, Diario>();
  const pegar = (dia: string) => {
    let item = mapa.get(dia);
    if (!item) {
      item = vazio();
      mapa.set(dia, item);
    }
    return item;
  };
  for (const linha of transacoes.linhas) Object.assign(pegar(linha.dia), {
    receita: linha.receita,
    reembolsos: linha.reembolsos,
    pagas: linha.pagas,
    falhas: linha.falhas,
  });
  for (const linha of usuarios.linhas) pegar(linha.dia).novosUsuarios = linha.total;
  for (const linha of trafego.linhas) Object.assign(pegar(linha.dia), {
    visitantes: linha.visitantes,
    sessoes: linha.sessoes,
    cadastros: linha.cadastros,
    conversoes: linha.conversoes,
  });
  return mapa;
}

export function somar(mapa: Map<string, Diario>, inicio: string, fim: string): Diario {
  const total = vazio();
  for (let dia = inicio; dia <= fim; dia = somarDias(dia, 1)) {
    const item = mapa.get(dia);
    if (!item) continue;
    for (const chave of Object.keys(total) as (keyof Diario)[]) total[chave] += item[chave];
  }
  return total;
}

export async function carregarAssinaturas(banco: Banco): Promise<AssinaturaResumo[]> {
  const { linhas } = await banco.consultar<Record<string, unknown>>(
    `select plano, ciclo, valor, iniciada_em, teste_ate, convertida_em, cancelada_em, status from assinaturas`,
  );
  const tempo = (valor: unknown) => paraData(valor)?.getTime() ?? null;
  return linhas.map((linha) => ({
    plano: String(linha.plano),
    ciclo: linha.ciclo as 'mensal' | 'anual',
    valor: Number(linha.valor),
    iniciadaEm: tempo(linha.iniciada_em) ?? 0,
    testeAte: tempo(linha.teste_ate),
    convertidaEm: tempo(linha.convertida_em),
    canceladaEm: tempo(linha.cancelada_em),
    status: String(linha.status),
  }));
}

export function valorMensal(assinatura: AssinaturaResumo): number {
  return assinatura.ciclo === 'anual' ? assinatura.valor / 12 : assinatura.valor;
}

export function ativaEm(assinatura: AssinaturaResumo, instante: number): boolean {
  return (
    assinatura.convertidaEm !== null &&
    assinatura.convertidaEm <= instante &&
    (assinatura.canceladaEm === null || assinatura.canceladaEm > instante)
  );
}

export function contarAtivas(assinaturas: AssinaturaResumo[], instante: number): number {
  let total = 0;
  for (const assinatura of assinaturas) if (ativaEm(assinatura, instante)) total += 1;
  return total;
}

export function mrrEm(assinaturas: AssinaturaResumo[], instante: number): number {
  let total = 0;
  for (const assinatura of assinaturas) if (ativaEm(assinatura, instante)) total += valorMensal(assinatura);
  return Math.round(total);
}

export function cancelamentosEntre(assinaturas: AssinaturaResumo[], de: number, ate: number): number {
  let total = 0;
  for (const assinatura of assinaturas) {
    if (assinatura.convertidaEm !== null && assinatura.canceladaEm !== null && assinatura.canceladaEm >= de && assinatura.canceladaEm <= ate) {
      total += 1;
    }
  }
  return total;
}

export function conversoesEntre(assinaturas: AssinaturaResumo[], de: number, ate: number): number {
  let total = 0;
  for (const assinatura of assinaturas) {
    if (assinatura.convertidaEm !== null && assinatura.convertidaEm >= de && assinatura.convertidaEm <= ate) total += 1;
  }
  return total;
}

export function testesEntre(assinaturas: AssinaturaResumo[], de: number, ate: number): number {
  let total = 0;
  for (const assinatura of assinaturas) {
    if (assinatura.testeAte !== null && assinatura.iniciadaEm >= de && assinatura.iniciadaEm <= ate) total += 1;
  }
  return total;
}

export function churnEntre(assinaturas: AssinaturaResumo[], de: number, ate: number): number {
  const base = contarAtivas(assinaturas, de - 1);
  return percentual(cancelamentosEntre(assinaturas, de, ate), base);
}

export async function carregarCriacaoClientes(banco: Banco): Promise<number[]> {
  const { linhas } = await banco.consultar<{ criado_em: Date }>(
    `select criado_em from usuarios where papel = 'cliente' order by criado_em`,
  );
  return linhas.map((linha) => new Date(linha.criado_em).getTime());
}

export function contarAte(ordenados: number[], instante: number): number {
  let baixo = 0;
  let alto = ordenados.length;
  while (baixo < alto) {
    const meio = (baixo + alto) >> 1;
    if (ordenados[meio] <= instante) baixo = meio + 1;
    else alto = meio;
  }
  return baixo;
}

export function comparar(valor: number, anterior: number, modo: 'relativa' | 'pontos' = 'relativa'): Comparacao {
  return {
    valor,
    anterior,
    variacao: modo === 'pontos' ? arredondar(valor - anterior) : variacaoPercentual(valor, anterior),
  };
}

export function baldesDiarios(inicio: string, fim: string): Balde[] {
  const baldes: Balde[] = [];
  for (let dia = inicio; dia <= fim; dia = somarDias(dia, 1)) baldes.push({ inicio: dia, fim: dia, rotulo: rotuloDia(dia) });
  return baldes;
}

export function baldesSemanais(inicio: string, fim: string): Balde[] {
  const baldes: Balde[] = [];
  let atual = inicio;
  while (atual <= fim) {
    const proximaSegunda = somarDias(inicioDaSemana(atual), 7);
    const fimBalde = somarDias(proximaSegunda, -1) < fim ? somarDias(proximaSegunda, -1) : fim;
    baldes.push({ inicio: atual, fim: fimBalde, rotulo: rotuloDia(atual) });
    atual = proximaSegunda;
  }
  return baldes;
}

export function baldesBlocos(inicio: string, fim: string, dias: number): Balde[] {
  const baldes: Balde[] = [];
  for (let atual = inicio; atual <= fim; atual = somarDias(atual, dias)) {
    const fimBalde = somarDias(atual, dias - 1) < fim ? somarDias(atual, dias - 1) : fim;
    baldes.push({ inicio: atual, fim: fimBalde, rotulo: rotuloDia(atual) });
  }
  return baldes;
}

export function baldesMensais(inicio: string, fim: string): Balde[] {
  const baldes: Balde[] = [];
  let atual = inicio;
  while (atual <= fim) {
    const proximoMes = somarMeses(primeiroDiaDoMes(atual), 1);
    const fimBalde = somarDias(proximoMes, -1) < fim ? somarDias(proximoMes, -1) : fim;
    baldes.push({ inicio: atual, fim: fimBalde, rotulo: rotuloMes(atual) });
    atual = proximoMes;
  }
  return baldes;
}

export function fimDoBalde(balde: Balde, fuso: string, agora: number): number {
  return Math.min(fimDoDia(balde.fim, fuso).getTime(), agora);
}

export function inicioDoBalde(balde: Balde, fuso: string): number {
  return inicioDoDia(balde.inicio, fuso).getTime();
}

export function hojeLocal(fuso: string): string {
  return diaLocal(new Date(), fuso);
}

import { primeiroDiaDoMes, rotuloDia, somarDias, ultimoDiaDoMes } from '../../util/datas.js';
import { arredondar } from '../../util/formato.js';

export const Z_80 = 1.2816;

export type SerieDiaria = Map<string, number>;

export interface ModeloSemanal {
  nivel: number;
  fatores: number[];
  desvio: number;
  dias: number;
}

export interface PrevisaoMes {
  mes: string;
  inicio: string;
  fim: string;
  hoje: string;
  diasNoMes: number;
  diasRestantes: number;
  realizado: number;
  projetado: number;
  minimo: number;
  maximo: number;
  meta: number;
  percentualProjetado: number;
  probabilidadeMeta: number | null;
  ritmoAtual: number;
  ritmoNecessario: number;
  confiavel: boolean;
  serie: {
    rotulos: string[];
    realizado: (number | null)[];
    projetado: (number | null)[];
    minimo: (number | null)[];
    maximo: (number | null)[];
    meta: number[];
  };
}

export type SentidoAnomalia = 'alta' | 'queda';
export type GravidadeAnomalia = 'media' | 'alta';

export interface DefinicaoSerie {
  codigo: string;
  nome: string;
  unidade: 'moeda' | 'numero' | 'percentual';
  sazonal: boolean;
  bomQuandoSobe: boolean;
  minimoEsperado: number;
  volumeMinimo?: number;
  link: (dia: string) => string;
}

export interface Anomalia {
  id: string;
  metrica: string;
  nome: string;
  unidade: DefinicaoSerie['unidade'];
  dia: string;
  valor: number;
  esperado: number;
  desvioPercentual: number;
  pontuacao: number;
  sentido: SentidoAnomalia;
  gravidade: GravidadeAnomalia;
  positiva: boolean;
  link: string;
}

const diaDaSemana = (dia: string): number => {
  const [ano, mes, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, d)).getUTCDay();
};

export function mediana(valores: number[]): number {
  if (valores.length === 0) return 0;
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 ? ordenados[meio] : (ordenados[meio - 1] + ordenados[meio]) / 2;
}

export function distribuicaoNormal(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const cauda = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - cauda : cauda;
}

const valorDe = (serie: SerieDiaria, dia: string): number => serie.get(dia) ?? 0;

export function ajustarModelo(serie: SerieDiaria, ultimoCompleto: string, semanas = 12, diasNivel = 28): ModeloSemanal {
  const historico: { dia: string; valor: number }[] = [];
  for (let indice = semanas * 7 - 1; indice >= 0; indice -= 1) {
    const dia = somarDias(ultimoCompleto, -indice);
    historico.push({ dia, valor: valorDe(serie, dia) });
  }
  const mediaGeral = historico.reduce((total, item) => total + item.valor, 0) / Math.max(1, historico.length);
  const fatores = Array.from({ length: 7 }, (_, semana) => {
    const doDia = historico.filter((item) => diaDaSemana(item.dia) === semana).map((item) => item.valor);
    const media = doDia.reduce((total, valor) => total + valor, 0) / Math.max(1, doDia.length);
    return mediaGeral > 0 ? Math.min(1.8, Math.max(0.4, media / mediaGeral)) : 1;
  });
  const recentes = historico.slice(-diasNivel);
  const nivel = recentes.reduce((total, item) => total + item.valor / fatores[diaDaSemana(item.dia)], 0) / Math.max(1, recentes.length);
  const residuos = recentes.map((item) => item.valor - nivel * fatores[diaDaSemana(item.dia)]);
  const mediaResiduos = residuos.reduce((total, valor) => total + valor, 0) / Math.max(1, residuos.length);
  const variancia = residuos.reduce((total, valor) => total + (valor - mediaResiduos) ** 2, 0) / Math.max(1, residuos.length - 1);
  const diasComDados = historico.filter((item) => serie.has(item.dia)).length;
  return { nivel, fatores, desvio: Math.sqrt(variancia), dias: diasComDados };
}

export function esperadoNoDia(modelo: ModeloSemanal, dia: string): number {
  return modelo.nivel * modelo.fatores[diaDaSemana(dia)];
}

export function preverMes(serie: SerieDiaria, hoje: string, fracaoDoDia: number, meta: number): PrevisaoMes {
  const inicio = primeiroDiaDoMes(hoje);
  const fim = ultimoDiaDoMes(hoje);
  const ontem = somarDias(hoje, -1);
  const modelo = ajustarModelo(serie, ontem);
  const fracao = Math.min(1, Math.max(0, fracaoDoDia));

  const rotulos: string[] = [];
  const realizado: (number | null)[] = [];
  const projetado: (number | null)[] = [];
  const minimo: (number | null)[] = [];
  const maximo: (number | null)[] = [];
  const linhaMeta: number[] = [];

  let acumulado = 0;
  for (let dia = inicio; dia <= hoje; dia = somarDias(dia, 1)) acumulado += valorDe(serie, dia);
  const totalRealizado = acumulado;

  let diasNoMes = 0;
  for (let dia = inicio; dia <= fim; dia = somarDias(dia, 1)) diasNoMes += 1;

  let soma = 0;
  let projecao = totalRealizado;
  let variancia = 0;
  let indice = 0;
  for (let dia = inicio; dia <= fim; dia = somarDias(dia, 1)) {
    indice += 1;
    rotulos.push(rotuloDia(dia));
    linhaMeta.push(Math.round((meta * indice) / diasNoMes));
    if (dia < hoje) {
      soma += valorDe(serie, dia);
      realizado.push(Math.round(soma));
      projetado.push(null);
      minimo.push(null);
      maximo.push(null);
      continue;
    }
    if (dia === hoje) {
      soma += valorDe(serie, dia);
      realizado.push(Math.round(soma));
      const restanteHoje = Math.max(0, esperadoNoDia(modelo, dia) * (1 - fracao));
      projecao = totalRealizado + restanteHoje;
      variancia = modelo.desvio ** 2 * (1 - fracao);
    } else {
      realizado.push(null);
      projecao += Math.max(0, esperadoNoDia(modelo, dia));
      variancia += modelo.desvio ** 2;
    }
    const margem = Z_80 * Math.sqrt(variancia);
    projetado.push(Math.round(projecao));
    minimo.push(Math.round(Math.max(totalRealizado, projecao - margem)));
    maximo.push(Math.round(projecao + margem));
  }

  const desvioTotal = Math.sqrt(variancia);
  const margemFinal = Z_80 * desvioTotal;
  const diasRestantes = Math.max(0, diasNoMes - indiceDoDia(inicio, hoje));
  const faltam = Math.max(0, meta - totalRealizado);
  const diasParaMeta = diasRestantes + (1 - fracao);
  let probabilidade: number | null = null;
  if (meta > 0) {
    if (desvioTotal > 0) probabilidade = arredondar((1 - distribuicaoNormal((meta - projecao) / desvioTotal)) * 100);
    else probabilidade = projecao >= meta ? 100 : 0;
  }
  return {
    mes: inicio,
    inicio,
    fim,
    hoje,
    diasNoMes,
    diasRestantes,
    realizado: Math.round(totalRealizado),
    projetado: Math.round(projecao),
    minimo: Math.round(Math.max(totalRealizado, projecao - margemFinal)),
    maximo: Math.round(projecao + margemFinal),
    meta,
    percentualProjetado: meta > 0 ? arredondar((projecao / meta) * 100) : 0,
    probabilidadeMeta: probabilidade,
    ritmoAtual: Math.round(modelo.nivel),
    ritmoNecessario: diasParaMeta > 0 ? Math.round(faltam / diasParaMeta) : 0,
    confiavel: modelo.dias >= 21,
    serie: { rotulos, realizado, projetado, minimo, maximo, meta: linhaMeta },
  };
}

function indiceDoDia(inicio: string, dia: string): number {
  let total = 0;
  for (let atual = inicio; atual <= dia; atual = somarDias(atual, 1)) total += 1;
  return total;
}

export function detectarAnomalias(
  definicao: DefinicaoSerie,
  serie: SerieDiaria,
  ultimoCompleto: string,
  opcoes: { diasAvaliados?: number; diasBase?: number; limiarMedio?: number; limiarAlto?: number; desvioMinimo?: number; volumes?: SerieDiaria } = {},
): Anomalia[] {
  const diasAvaliados = opcoes.diasAvaliados ?? 7;
  const diasBase = opcoes.diasBase ?? 28;
  const limiarMedio = opcoes.limiarMedio ?? 3;
  const limiarAlto = opcoes.limiarAlto ?? 4.5;
  const desvioMinimo = opcoes.desvioMinimo ?? 20;
  const modelo = definicao.sazonal ? ajustarModelo(serie, ultimoCompleto) : null;
  const ajustado = (dia: string): number => {
    const valor = valorDe(serie, dia);
    if (!modelo) return valor;
    const fator = modelo.fatores[diaDaSemana(dia)];
    return fator > 0 ? valor / fator : valor;
  };
  const encontradas: Anomalia[] = [];
  for (let deslocamento = 0; deslocamento < diasAvaliados; deslocamento += 1) {
    const dia = somarDias(ultimoCompleto, -deslocamento);
    if (opcoes.volumes && definicao.volumeMinimo && (opcoes.volumes.get(dia) ?? 0) < definicao.volumeMinimo) continue;
    const base: number[] = [];
    for (let anterior = 1; anterior <= diasBase; anterior += 1) base.push(ajustado(somarDias(dia, -anterior)));
    const centro = mediana(base);
    const dispersao = 1.4826 * mediana(base.map((valor) => Math.abs(valor - centro)));
    const escala = dispersao > 0 ? dispersao : base.reduce((total, valor) => total + Math.abs(valor - centro), 0) / Math.max(1, base.length);
    if (escala <= 0) continue;
    const fator = modelo ? modelo.fatores[diaDaSemana(dia)] : 1;
    const esperado = centro * fator;
    const valor = valorDe(serie, dia);
    if (esperado <= 0 || Math.max(esperado, valor) < definicao.minimoEsperado) continue;
    const pontuacao = (ajustado(dia) - centro) / escala;
    const desvio = esperado !== 0 ? ((valor - esperado) / Math.abs(esperado)) * 100 : 100;
    if (Math.abs(pontuacao) < limiarMedio || Math.abs(desvio) < desvioMinimo) continue;
    const sentido: SentidoAnomalia = pontuacao > 0 ? 'alta' : 'queda';
    encontradas.push({
      id: `${definicao.codigo}:${dia}`,
      metrica: definicao.codigo,
      nome: definicao.nome,
      unidade: definicao.unidade,
      dia,
      valor: arredondar(valor, 2),
      esperado: arredondar(esperado, 2),
      desvioPercentual: arredondar(desvio),
      pontuacao: arredondar(pontuacao, 2),
      sentido,
      gravidade: Math.abs(pontuacao) >= limiarAlto ? 'alta' : 'media',
      positiva: sentido === 'alta' ? definicao.bomQuandoSobe : !definicao.bomQuandoSobe,
      link: definicao.link(dia),
    });
  }
  return encontradas;
}

export function regressaoLinear(valores: number[]): { inclinacao: number; intercepto: number } {
  const n = valores.length;
  if (n < 2) return { inclinacao: 0, intercepto: valores[0] ?? 0 };
  const mediaX = (n - 1) / 2;
  const mediaY = valores.reduce((total, valor) => total + valor, 0) / n;
  let numerador = 0;
  let denominador = 0;
  valores.forEach((valor, x) => {
    numerador += (x - mediaX) * (valor - mediaY);
    denominador += (x - mediaX) ** 2;
  });
  const inclinacao = denominador ? numerador / denominador : 0;
  return { inclinacao, intercepto: mediaY - inclinacao * mediaX };
}

const DIA_MS = 86_400_000;
const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const formatadores = new Map<string, Intl.DateTimeFormat>();

function formatador(fuso: string): Intl.DateTimeFormat {
  let existente = formatadores.get(fuso);
  if (!existente) {
    existente = new Intl.DateTimeFormat('en-CA', {
      timeZone: fuso,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatadores.set(fuso, existente);
  }
  return existente;
}

function partes(instante: Date, fuso: string): Record<string, number> {
  const resultado: Record<string, number> = {};
  for (const parte of formatador(fuso).formatToParts(instante)) {
    if (parte.type !== 'literal') resultado[parte.type] = Number(parte.value);
  }
  return resultado;
}

function deslocamentoMs(instante: Date, fuso: string): number {
  const p = partes(instante, fuso);
  const comoUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return comoUtc - Math.floor(instante.getTime() / 1000) * 1000;
}

export function diaLocal(instante: Date, fuso: string): string {
  const p = partes(instante, fuso);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function horaLocal(instante: Date, fuso: string): number {
  return partes(instante, fuso).hour;
}

export function inicioDoDia(dia: string, fuso: string): Date {
  const [ano, mes, d] = dia.split('-').map(Number);
  const palpite = new Date(Date.UTC(ano, mes - 1, d));
  const primeiro = new Date(palpite.getTime() - deslocamentoMs(palpite, fuso));
  return new Date(palpite.getTime() - deslocamentoMs(primeiro, fuso));
}

export function fimDoDia(dia: string, fuso: string): Date {
  return new Date(inicioDoDia(somarDias(dia, 1), fuso).getTime() - 1);
}

export function somarDias(dia: string, dias: number): string {
  const [ano, mes, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, d) + dias * DIA_MS).toISOString().slice(0, 10);
}

export function somarMeses(dia: string, meses: number): string {
  const [ano, mes, d] = dia.split('-').map(Number);
  const alvo = new Date(Date.UTC(ano, mes - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
}

export function diferencaDias(inicio: string, fim: string): number {
  const [a1, m1, d1] = inicio.split('-').map(Number);
  const [a2, m2, d2] = fim.split('-').map(Number);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / DIA_MS);
}

export function primeiroDiaDoMes(dia: string): string {
  return `${dia.slice(0, 7)}-01`;
}

export function ultimoDiaDoMes(dia: string): string {
  return somarDias(somarMeses(primeiroDiaDoMes(dia), 1), -1);
}

export function inicioDaSemana(dia: string): string {
  const [ano, mes, d] = dia.split('-').map(Number);
  const semana = new Date(Date.UTC(ano, mes - 1, d)).getUTCDay();
  return somarDias(dia, -((semana + 6) % 7));
}

export function rotuloMes(dia: string): string {
  const [ano, mes] = dia.split('-').map(Number);
  return `${MESES_CURTOS[mes - 1]}/${String(ano).slice(2)}`;
}

export function rotuloDia(dia: string): string {
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
}

export function dataBr(dia: string): string {
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;
}

export function dataHoraBr(instante: Date, fuso: string): string {
  const p = partes(instante, fuso);
  const dois = (n: number) => String(n).padStart(2, '0');
  return `${dois(p.day)}/${dois(p.month)}/${p.year} ${dois(p.hour)}:${dois(p.minute)}`;
}

export function diaValido(dia: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return false;
  const [ano, mes, d] = dia.split('-').map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, d));
  return data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === d;
}

export function paraIso(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  if (valor instanceof Date) return valor.toISOString();
  const data = new Date(String(valor));
  return Number.isNaN(data.getTime()) ? String(valor) : data.toISOString();
}

export function paraData(valor: unknown): Date | null {
  if (valor === null || valor === undefined) return null;
  const data = valor instanceof Date ? valor : new Date(String(valor));
  return Number.isNaN(data.getTime()) ? null : data;
}

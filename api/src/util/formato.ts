const moedaBr = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const numeroBr = new Intl.NumberFormat('pt-BR');
const decimalBr = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function iniciais(nome: string): string {
  const palavras = nome
    .trim()
    .split(/\s+/)
    .filter((palavra) => palavra.length > 1 || /[A-ZÀ-Ú]/.test(palavra));
  if (palavras.length === 0) return '?';
  const primeira = palavras[0][0] ?? '';
  const ultima = palavras.length > 1 ? (palavras[palavras.length - 1][0] ?? '') : (palavras[0][1] ?? '');
  return `${primeira}${ultima}`.toUpperCase();
}

export function formatarMoeda(centavos: number): string {
  return moedaBr.format(centavos / 100).replace(/ /g, ' ');
}

export function formatarNumero(valor: number): string {
  return numeroBr.format(valor);
}

export function formatarPercentual(valor: number): string {
  return `${decimalBr.format(valor)}%`;
}

export function arredondar(valor: number, casas = 1): number {
  const fator = 10 ** casas;
  return Math.round(valor * fator) / fator;
}

export function variacaoPercentual(valor: number, anterior: number): number | null {
  if (!anterior) return null;
  return arredondar(((valor - anterior) / Math.abs(anterior)) * 100);
}

export function percentual(parte: number, todo: number): number {
  return todo ? arredondar((parte / todo) * 100) : 0;
}

export function slug(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const NOMES_PAISES: Record<string, string> = {
  BR: 'Brasil',
  PT: 'Portugal',
  US: 'Estados Unidos',
  AR: 'Argentina',
  MX: 'México',
  CL: 'Chile',
  CO: 'Colômbia',
  ES: 'Espanha',
  UY: 'Uruguai',
  DE: 'Alemanha',
};

export const CODIGOS_PAISES: Record<string, string> = Object.fromEntries(
  Object.entries(NOMES_PAISES).map(([codigo, nome]) => [nome, codigo]),
);

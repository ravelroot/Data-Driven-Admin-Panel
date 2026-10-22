const PREFIXO = "bento:";

export function ler(chave: string): string | null;
export function ler(chave: string, padrao: string): string;
export function ler(chave: string, padrao: string | null = null): string | null {
  try {
    const valor = localStorage.getItem(PREFIXO + chave);
    return valor === null ? padrao : valor;
  } catch {
    return padrao;
  }
}

export const gravar = (chave: string, valor: string | number | boolean): boolean => {
  try {
    localStorage.setItem(PREFIXO + chave, String(valor));
    return true;
  } catch {
    return false;
  }
};

export const remover = (chave: string): boolean => {
  try {
    localStorage.removeItem(PREFIXO + chave);
  } catch {
    return false;
  }
  return true;
};

export const lerJson = <T>(chave: string, padrao: T): T => {
  const bruto = ler(chave);
  if (bruto === null) return padrao;
  try {
    return JSON.parse(bruto) as T;
  } catch {
    return padrao;
  }
};

export const gravarJson = (chave: string, valor: unknown): boolean => gravar(chave, JSON.stringify(valor));

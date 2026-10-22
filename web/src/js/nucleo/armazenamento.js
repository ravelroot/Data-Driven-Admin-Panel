const PREFIXO = "bento:";

export const ler = (chave, padrao = null) => {
  try {
    const valor = localStorage.getItem(PREFIXO + chave);
    return valor === null ? padrao : valor;
  } catch {
    return padrao;
  }
};

export const gravar = (chave, valor) => {
  try {
    localStorage.setItem(PREFIXO + chave, String(valor));
    return true;
  } catch {
    return false;
  }
};

export const remover = (chave) => {
  try {
    localStorage.removeItem(PREFIXO + chave);
  } catch {
    return false;
  }
  return true;
};

export const lerJson = (chave, padrao = null) => {
  const bruto = ler(chave);
  if (bruto === null) return padrao;
  try {
    return JSON.parse(bruto);
  } catch {
    return padrao;
  }
};

export const gravarJson = (chave, valor) => gravar(chave, JSON.stringify(valor));

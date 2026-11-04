import { gravarJson, lerJson } from "./armazenamento.ts";

export interface ColunaConfiguravel {
  campo: string;
  titulo: string;
  fixa?: boolean;
  oculto?: boolean;
  escondidaPorPadrao?: boolean;
}

const chave = (tabela: string): string => `colunas:${tabela}`;

export const configuraveis = <C extends ColunaConfiguravel>(colunas: C[]): C[] => colunas.filter((coluna) => !coluna.fixa && !coluna.oculto && coluna.titulo.trim() !== "");

export const ocultasPadrao = (colunas: ColunaConfiguravel[]): string[] => configuraveis(colunas).filter((coluna) => coluna.escondidaPorPadrao).map((coluna) => coluna.campo);

export const normalizarOcultas = (colunas: ColunaConfiguravel[], ocultas: unknown): string[] => {
  const permitidas = new Set(configuraveis(colunas).map((coluna) => coluna.campo));
  if (!Array.isArray(ocultas)) return ocultasPadrao(colunas);
  const validas = [...new Set(ocultas.filter((campo): campo is string => typeof campo === "string" && permitidas.has(campo)))];
  return validas.length >= permitidas.size ? validas.slice(0, Math.max(0, permitidas.size - 1)) : validas;
};

export const lerOcultas = (tabela: string, colunas: ColunaConfiguravel[]): string[] => normalizarOcultas(colunas, lerJson<unknown>(chave(tabela), null));

export const gravarOcultas = (tabela: string, colunas: ColunaConfiguravel[], ocultas: string[]): string[] => {
  const normalizadas = normalizarOcultas(colunas, ocultas);
  gravarJson(chave(tabela), normalizadas);
  return normalizadas;
};

export const alternarOculta = (ocultas: string[], campo: string): string[] => (ocultas.includes(campo) ? ocultas.filter((item) => item !== campo) : [...ocultas, campo]);

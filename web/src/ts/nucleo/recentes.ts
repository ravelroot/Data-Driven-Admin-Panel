import { gravarJson, lerJson } from "./armazenamento.ts";

export type TipoRecente = "usuario" | "transacao";

export interface ItemRecente {
  tipo: TipoRecente;
  id: string;
  titulo: string;
  detalhe?: string;
  href: string;
  em: string;
}

export const LIMITE_RECENTES = 8;

const valido = (item: unknown): item is ItemRecente => {
  const registro = item as Partial<ItemRecente> | null;
  return Boolean(
    registro &&
      (registro.tipo === "usuario" || registro.tipo === "transacao") &&
      typeof registro.id === "string" &&
      typeof registro.titulo === "string" &&
      typeof registro.href === "string" &&
      registro.href.startsWith("/") &&
      !registro.href.startsWith("//"),
  );
};

export const mesclarRecente = (lista: ItemRecente[], item: ItemRecente, limite = LIMITE_RECENTES): ItemRecente[] =>
  [item, ...lista.filter((atual) => !(atual.tipo === item.tipo && atual.id === item.id))].slice(0, limite);

const chave = (dono: string | null | undefined): string => `recentes:${dono ?? "anonimo"}`;

export const listarRecentes = (dono: string | null | undefined): ItemRecente[] => {
  const lista = lerJson<unknown>(chave(dono), []);
  return Array.isArray(lista) ? lista.filter(valido).slice(0, LIMITE_RECENTES) : [];
};

export const registrarRecente = (dono: string | null | undefined, item: Omit<ItemRecente, "em">, agora = new Date()): ItemRecente[] => {
  const lista = mesclarRecente(listarRecentes(dono), { ...item, em: agora.toISOString() });
  gravarJson(chave(dono), lista);
  return lista;
};

export const limparRecentes = (dono: string | null | undefined): void => {
  gravarJson(chave(dono), []);
};

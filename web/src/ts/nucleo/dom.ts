export class Seguro {
  readonly texto: string;

  constructor(texto: string) {
    this.texto = texto;
  }

  toString(): string {
    return this.texto;
  }
}

export type Marcacao = Seguro | string;
type Interpolavel = unknown;

const MAPA_ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export const escapar = (valor: unknown): string => String(valor ?? "").replace(/[&<>"']/g, (caractere) => MAPA_ESCAPE[caractere] ?? caractere);

export const seguro = (texto: unknown): Seguro => new Seguro(String(texto ?? ""));

const converter = (valor: Interpolavel): string => {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "boolean") return valor ? "true" : "false";
  if (valor instanceof Seguro) return valor.texto;
  if (Array.isArray(valor)) return valor.map(converter).join("");
  return escapar(valor);
};

export const html = (partes: TemplateStringsArray | readonly string[], ...valores: Interpolavel[]): Seguro =>
  new Seguro(partes.reduce((acumulado: string, parte: string, indice: number) => acumulado + parte + (indice < valores.length ? converter(valores[indice]) : ""), ""));

type Raiz = ParentNode;

export function $<T extends Element = HTMLElement>(seletor: string, raiz: Raiz = document): T | null {
  return raiz.querySelector<T>(seletor);
}

export function $$<T extends Element = HTMLElement>(seletor: string, raiz: Raiz = document): T[] {
  return Array.from(raiz.querySelectorAll<T>(seletor));
}

export function exigir<T extends Element = HTMLElement>(seletor: string, raiz: Raiz = document): T {
  const elemento = raiz.querySelector<T>(seletor);
  if (!elemento) throw new Error(`Elemento não encontrado: ${seletor}`);
  return elemento;
}

export const criar = <T extends Element = HTMLElement>(marcacao: Marcacao): T => {
  const modelo = document.createElement("template");
  modelo.innerHTML = String(marcacao).trim();
  return modelo.content.firstElementChild as T;
};

export const renderizar = <T extends Element>(alvo: T | null | undefined, marcacao: Marcacao): T | null => {
  if (!alvo) return null;
  alvo.innerHTML = String(marcacao);
  return alvo;
};

export const delegar = <E extends Event = Event, T extends HTMLElement = HTMLElement>(
  raiz: Element | Document,
  evento: string,
  seletor: string,
  manipulador: (evento: E, alvo: T) => void,
): (() => void) => {
  const ouvinte = (e: Event) => {
    const origem = e.target as Element | null;
    const alvo = origem?.closest<T>(seletor);
    if (alvo && raiz.contains(alvo)) manipulador(e as E, alvo);
  };
  raiz.addEventListener(evento, ouvinte);
  return () => raiz.removeEventListener(evento, ouvinte);
};

export interface Atrasada<A extends unknown[]> {
  (...argumentos: A): void;
  cancelar: () => void;
}

export const atrasar = <A extends unknown[]>(funcao: (...argumentos: A) => void, espera = 300): Atrasada<A> => {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const executar = ((...argumentos: A) => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => funcao(...argumentos), espera);
  }) as Atrasada<A>;
  executar.cancelar = () => clearTimeout(temporizador);
  return executar;
};

export const carregando = (botao: HTMLButtonElement | HTMLElement | null | undefined, ativo: boolean): void => {
  if (!botao) return;
  botao.dataset.carregando = ativo ? "true" : "false";
  if (botao instanceof HTMLButtonElement) botao.disabled = Boolean(ativo);
  botao.setAttribute("aria-busy", ativo ? "true" : "false");
};

export const esperar = (ms: number): Promise<void> => new Promise((resolver) => setTimeout(resolver, ms));

export const copiar = async (texto: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const campo = document.createElement("textarea");
    campo.value = texto;
    campo.setAttribute("readonly", "");
    campo.style.position = "fixed";
    campo.style.opacity = "0";
    document.body.append(campo);
    campo.select();
    const ok = document.execCommand("copy");
    campo.remove();
    return ok;
  }
};

export const idUnico = (prefixo = "id"): string => `${prefixo}-${Math.random().toString(36).slice(2, 9)}`;

export const parametrosUrl = (): Record<string, string> => Object.fromEntries(new URLSearchParams(location.search));

export const atualizarUrl = (parametros: Record<string, string | number | boolean | null | undefined>): void => {
  const url = new URL(location.href);
  for (const [chave, valor] of Object.entries(parametros)) {
    if (valor === undefined || valor === null || valor === "") url.searchParams.delete(chave);
    else url.searchParams.set(chave, String(valor));
  }
  history.replaceState(null, "", url);
};

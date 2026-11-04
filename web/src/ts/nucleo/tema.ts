import { ler, gravar } from "./armazenamento.ts";
import { emitir } from "./eventos.ts";
import type { Densidade, Movimento, Preferencias, Tema } from "./tipos.ts";

export const TEMAS: readonly Tema[] = ["claro", "escuro", "sistema"];
export const PALETAS: readonly string[] = ["bento", "oliva", "grafite", "oceano", "terracota", "ameixa", "floresta", "ardosia", "vinho", "lavanda", "cobre", "petroleo", "girassol", "menta", "noite", "areia"];
export const DENSIDADES: readonly Densidade[] = ["confortavel", "compacta"];
export const MOVIMENTOS: readonly Movimento[] = ["sistema", "reduzido"];

interface OpcoesAplicar {
  salvar?: boolean;
}

const raiz = document.documentElement;
const consultaEscura = window.matchMedia("(prefers-color-scheme: dark)");

export const temaAtual = (): Tema => ler("tema", "sistema") as Tema;

export const escuroAtivo = (): boolean => raiz.classList.contains("dark");

const resolverEscuro = (tema: Tema): boolean => tema === "escuro" || (tema === "sistema" && consultaEscura.matches);

export const aplicarTema = (tema: string = temaAtual(), { salvar = true }: OpcoesAplicar = {}): Tema => {
  const valor: Tema = (TEMAS as readonly string[]).includes(tema) ? (tema as Tema) : "sistema";
  if (salvar) gravar("tema", valor);
  const escuro = resolverEscuro(valor);
  const mudou = escuro !== escuroAtivo();
  raiz.classList.toggle("dark", escuro);
  raiz.dataset.tema = valor;
  const cor = getComputedStyle(raiz).getPropertyValue(escuro ? "--color-neutra-950" : "--color-neutra-100").trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", cor || (escuro ? "#121111" : "#F5F4F4"));
  if (mudou) emitir("tema:alterado", { escuro, tema: valor });
  return valor;
};

export const alternarTema = (): Tema => aplicarTema(escuroAtivo() ? "claro" : "escuro");

export const paletaAtual = (): string => ler("paleta", "bento");

export const aplicarPaleta = (paleta: string = paletaAtual(), { salvar = true }: OpcoesAplicar = {}): string => {
  const valor = PALETAS.includes(paleta) ? paleta : "bento";
  if (salvar) gravar("paleta", valor);
  raiz.dataset.paleta = valor;
  emitir("tema:alterado", { escuro: escuroAtivo(), paleta: valor });
  return valor;
};

export const densidadeAtual = (): Densidade => ler("densidade", "confortavel") as Densidade;

export const aplicarDensidade = (densidade: string = densidadeAtual(), { salvar = true }: OpcoesAplicar = {}): Densidade => {
  const valor: Densidade = (DENSIDADES as readonly string[]).includes(densidade) ? (densidade as Densidade) : "confortavel";
  if (salvar) gravar("densidade", valor);
  raiz.dataset.densidade = valor;
  emitir("densidade:alterada", valor);
  return valor;
};

export const movimentoAtual = (): Movimento => (ler("movimento", "sistema") === "reduzido" ? "reduzido" : "sistema");

export const movimentoReduzido = (): boolean => raiz.dataset.movimento === "reduzido" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const aplicarMovimento = (movimento: string = movimentoAtual(), { salvar = true }: OpcoesAplicar = {}): Movimento => {
  const valor: Movimento = (MOVIMENTOS as readonly string[]).includes(movimento) ? (movimento as Movimento) : "sistema";
  if (salvar) gravar("movimento", valor);
  raiz.dataset.movimento = valor;
  return valor;
};

export const barraRecolhida = (): boolean => ler("barra", "expandida") === "recolhida";

export const definirBarraRecolhida = (recolhida: boolean): boolean => gravar("barra", recolhida ? "recolhida" : "expandida");

export const sincronizarPreferencias = (preferencias: Partial<Preferencias> | null | undefined): void => {
  if (!preferencias) return;
  if (ler("tema") === null && preferencias.tema) aplicarTema(preferencias.tema);
  if (ler("paleta") === null && preferencias.paleta) aplicarPaleta(preferencias.paleta);
  if (ler("densidade") === null && preferencias.densidade) aplicarDensidade(preferencias.densidade);
  if (ler("barra") === null && typeof preferencias.sidebarRecolhida === "boolean") definirBarraRecolhida(preferencias.sidebarRecolhida);
  if (preferencias.movimento) aplicarMovimento(preferencias.movimento);
};

export const preferenciasLocais = (): Preferencias => ({
  tema: temaAtual(),
  paleta: paletaAtual(),
  densidade: densidadeAtual(),
  sidebarRecolhida: barraRecolhida(),
  movimento: movimentoAtual(),
});

export const iniciarTema = (): void => {
  aplicarTema(temaAtual(), { salvar: false });
  aplicarPaleta(paletaAtual(), { salvar: false });
  aplicarDensidade(densidadeAtual(), { salvar: false });
  aplicarMovimento(movimentoAtual(), { salvar: false });
  consultaEscura.addEventListener("change", () => {
    if (temaAtual() === "sistema") aplicarTema("sistema", { salvar: false });
  });
  window.addEventListener("storage", (evento) => {
    if (evento.key === "bento:tema") aplicarTema(temaAtual(), { salvar: false });
    if (evento.key === "bento:paleta") aplicarPaleta(paletaAtual(), { salvar: false });
    if (evento.key === "bento:densidade") aplicarDensidade(densidadeAtual(), { salvar: false });
    if (evento.key === "bento:movimento") aplicarMovimento(movimentoAtual(), { salvar: false });
  });
};

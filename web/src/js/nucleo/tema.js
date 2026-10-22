import { ler, gravar } from "./armazenamento.js";
import { emitir } from "./eventos.js";

export const TEMAS = ["claro", "escuro", "sistema"];
export const PALETAS = ["bento", "oliva", "grafite", "oceano", "terracota", "ameixa", "floresta", "ardosia", "vinho", "lavanda", "cobre", "petroleo", "girassol", "menta", "noite", "areia"];
export const DENSIDADES = ["confortavel", "compacta"];

const raiz = document.documentElement;
const consultaEscura = window.matchMedia("(prefers-color-scheme: dark)");

export const temaAtual = () => ler("tema", "sistema");

export const escuroAtivo = () => raiz.classList.contains("dark");

const resolverEscuro = (tema) => tema === "escuro" || (tema === "sistema" && consultaEscura.matches);

export const aplicarTema = (tema = temaAtual(), { salvar = true } = {}) => {
  const valor = TEMAS.includes(tema) ? tema : "sistema";
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

export const alternarTema = () => aplicarTema(escuroAtivo() ? "claro" : "escuro");

export const paletaAtual = () => ler("paleta", "bento");

export const aplicarPaleta = (paleta = paletaAtual(), { salvar = true } = {}) => {
  const valor = PALETAS.includes(paleta) ? paleta : "bento";
  if (salvar) gravar("paleta", valor);
  raiz.dataset.paleta = valor;
  emitir("tema:alterado", { escuro: escuroAtivo(), paleta: valor });
  return valor;
};

export const densidadeAtual = () => ler("densidade", "confortavel");

export const aplicarDensidade = (densidade = densidadeAtual(), { salvar = true } = {}) => {
  const valor = DENSIDADES.includes(densidade) ? densidade : "confortavel";
  if (salvar) gravar("densidade", valor);
  raiz.dataset.densidade = valor;
  emitir("densidade:alterada", valor);
  return valor;
};

export const barraRecolhida = () => ler("barra", "expandida") === "recolhida";

export const definirBarraRecolhida = (recolhida) => gravar("barra", recolhida ? "recolhida" : "expandida");

export const sincronizarPreferencias = (preferencias) => {
  if (!preferencias) return;
  if (ler("tema") === null && preferencias.tema) aplicarTema(preferencias.tema);
  if (ler("paleta") === null && preferencias.paleta) aplicarPaleta(preferencias.paleta);
  if (ler("densidade") === null && preferencias.densidade) aplicarDensidade(preferencias.densidade);
  if (ler("barra") === null && typeof preferencias.sidebarRecolhida === "boolean") definirBarraRecolhida(preferencias.sidebarRecolhida);
};

export const preferenciasLocais = () => ({
  tema: temaAtual(),
  paleta: paletaAtual(),
  densidade: densidadeAtual(),
  sidebarRecolhida: barraRecolhida(),
});

export const iniciarTema = () => {
  aplicarTema(temaAtual(), { salvar: false });
  aplicarPaleta(paletaAtual(), { salvar: false });
  aplicarDensidade(densidadeAtual(), { salvar: false });
  consultaEscura.addEventListener("change", () => {
    if (temaAtual() === "sistema") aplicarTema("sistema", { salvar: false });
  });
  window.addEventListener("storage", (evento) => {
    if (evento.key === "bento:tema") aplicarTema(temaAtual(), { salvar: false });
    if (evento.key === "bento:paleta") aplicarPaleta(paletaAtual(), { salvar: false });
    if (evento.key === "bento:densidade") aplicarDensidade(densidadeAtual(), { salvar: false });
  });
};

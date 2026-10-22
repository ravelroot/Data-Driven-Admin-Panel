class Seguro {
  constructor(texto) {
    this.texto = texto;
  }

  toString() {
    return this.texto;
  }
}

const MAPA_ESCAPE = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export const escapar = (valor) => String(valor ?? "").replace(/[&<>"']/g, (caractere) => MAPA_ESCAPE[caractere]);

export const seguro = (texto) => new Seguro(String(texto ?? ""));

const converter = (valor) => {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "boolean") return valor ? "true" : "false";
  if (valor instanceof Seguro) return valor.texto;
  if (Array.isArray(valor)) return valor.map(converter).join("");
  return escapar(valor);
};

export const html = (partes, ...valores) =>
  new Seguro(partes.reduce((acumulado, parte, indice) => acumulado + parte + (indice < valores.length ? converter(valores[indice]) : ""), ""));

export const $ = (seletor, raiz = document) => raiz.querySelector(seletor);

export const $$ = (seletor, raiz = document) => Array.from(raiz.querySelectorAll(seletor));

export const criar = (marcacao) => {
  const modelo = document.createElement("template");
  modelo.innerHTML = String(marcacao).trim();
  return modelo.content.firstElementChild;
};

export const renderizar = (alvo, marcacao) => {
  if (!alvo) return null;
  alvo.innerHTML = String(marcacao);
  return alvo;
};

export const delegar = (raiz, evento, seletor, manipulador) => {
  const ouvinte = (e) => {
    const alvo = e.target.closest(seletor);
    if (alvo && raiz.contains(alvo)) manipulador(e, alvo);
  };
  raiz.addEventListener(evento, ouvinte);
  return () => raiz.removeEventListener(evento, ouvinte);
};

export const atrasar = (funcao, espera = 300) => {
  let temporizador;
  const executar = (...argumentos) => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => funcao(...argumentos), espera);
  };
  executar.cancelar = () => clearTimeout(temporizador);
  return executar;
};

export const carregando = (botao, ativo) => {
  if (!botao) return;
  botao.dataset.carregando = ativo ? "true" : "false";
  botao.disabled = Boolean(ativo);
  botao.setAttribute("aria-busy", ativo ? "true" : "false");
};

export const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

export const copiar = async (texto) => {
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

export const idUnico = (prefixo = "id") => `${prefixo}-${Math.random().toString(36).slice(2, 9)}`;

export const parametrosUrl = () => Object.fromEntries(new URLSearchParams(location.search));

export const atualizarUrl = (parametros) => {
  const url = new URL(location.href);
  for (const [chave, valor] of Object.entries(parametros)) {
    if (valor === undefined || valor === null || valor === "") url.searchParams.delete(chave);
    else url.searchParams.set(chave, valor);
  }
  history.replaceState(null, "", url);
};

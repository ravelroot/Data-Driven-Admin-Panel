import { emitir } from "./eventos.js";

const URL_FLUXO = "/api/v1/notificacoes/fluxo";
const EVENTOS = ["notificacao", "contagem", "transacao", "usuario"];

let fonte = null;
let estado = "desconectado";
let tentativas = 0;
let temporizador = null;

const definirEstado = (novo) => {
  if (estado === novo) return;
  estado = novo;
  emitir("conexao", estado);
};

export const estadoConexao = () => estado;

const agendarReconexao = () => {
  clearTimeout(temporizador);
  const espera = Math.min(30000, 2000 * 2 ** tentativas);
  tentativas += 1;
  temporizador = setTimeout(async () => {
    try {
      await fetch("/api/v1/auth/renovar", { method: "POST", credentials: "same-origin", headers: { "X-Bento": "1" } });
    } catch {
      definirEstado("desconectado");
    }
    conectarTempoReal();
  }, espera);
};

export const conectarTempoReal = () => {
  if (typeof EventSource === "undefined") return;
  if (fonte && fonte.readyState !== EventSource.CLOSED) return;
  definirEstado(tentativas ? "reconectando" : "conectando");
  fonte = new EventSource(URL_FLUXO, { withCredentials: true });

  fonte.addEventListener("open", () => {
    tentativas = 0;
    definirEstado("conectado");
  });

  for (const nome of EVENTOS) {
    fonte.addEventListener(nome, (evento) => {
      try {
        emitir(`tempo-real:${nome}`, JSON.parse(evento.data));
      } catch {
        emitir(`tempo-real:${nome}`, null);
      }
    });
  }

  fonte.addEventListener("error", () => {
    if (fonte.readyState === EventSource.CLOSED) {
      definirEstado("desconectado");
      agendarReconexao();
    } else {
      definirEstado("reconectando");
    }
  });
};

export const desconectarTempoReal = () => {
  clearTimeout(temporizador);
  fonte?.close();
  fonte = null;
  definirEstado("desconectado");
};

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && (!fonte || fonte.readyState === EventSource.CLOSED)) {
    tentativas = 0;
    conectarTempoReal();
  }
});

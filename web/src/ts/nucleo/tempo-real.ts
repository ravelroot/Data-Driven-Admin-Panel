import { emitir } from "./eventos.ts";
import type { EstadoConexao } from "./tipos.ts";

const URL_FLUXO = "/api/v1/notificacoes/fluxo";
const EVENTOS = ["notificacao", "contagem", "transacao", "usuario"] as const;

let fonte: EventSource | null = null;
let estado: EstadoConexao = "desconectado";
let tentativas = 0;
let temporizador: ReturnType<typeof setTimeout> | undefined;

const definirEstado = (novo: EstadoConexao): void => {
  if (estado === novo) return;
  estado = novo;
  emitir("conexao", estado);
};

export const estadoConexao = (): EstadoConexao => estado;

const agendarReconexao = (): void => {
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

export const conectarTempoReal = (): void => {
  if (typeof EventSource === "undefined") return;
  if (fonte && fonte.readyState !== EventSource.CLOSED) return;
  definirEstado(tentativas ? "reconectando" : "conectando");
  const atual = new EventSource(URL_FLUXO, { withCredentials: true });
  fonte = atual;

  atual.addEventListener("open", () => {
    tentativas = 0;
    definirEstado("conectado");
  });

  for (const nome of EVENTOS) {
    atual.addEventListener(nome, (evento: MessageEvent<string>) => {
      try {
        emitir(`tempo-real:${nome}`, JSON.parse(evento.data));
      } catch {
        emitir(`tempo-real:${nome}`, null);
      }
    });
  }

  atual.addEventListener("error", () => {
    if (atual.readyState === EventSource.CLOSED) {
      definirEstado("desconectado");
      agendarReconexao();
    } else {
      definirEstado("reconectando");
    }
  });
};

export const desconectarTempoReal = (): void => {
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

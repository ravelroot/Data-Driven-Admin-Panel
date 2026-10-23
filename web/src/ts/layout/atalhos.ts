import { html } from "../nucleo/dom.ts";
import { pode } from "../nucleo/sessao.ts";
import { IR_PARA, paginaPorId } from "./navegacao.ts";

export { IR_PARA };

interface Atalho {
  teclas: string[];
  descricao: string;
}

interface GrupoAtalhos {
  titulo: string;
  itens: Atalho[];
}

const ESPERA_SEGUNDA_TECLA = 1200;

let dialogo: HTMLDialogElement | null = null;
let aguardandoG = false;
let temporizador: number | undefined;
let indicador: HTMLElement | null = null;

const gruposAtalhos = (): GrupoAtalhos[] => {
  const paginas = Object.entries(IR_PARA)
    .map(([tecla, id]) => ({ tecla, pagina: paginaPorId(id) }))
    .filter(({ pagina }) => pagina && pode(pagina.permissao))
    .map(({ tecla, pagina }) => ({ teclas: ["g", tecla], descricao: pagina?.rotulo ?? "" }));
  return [
    {
      titulo: "Geral",
      itens: [
        { teclas: ["Ctrl", "K"], descricao: "Abrir a paleta de comandos" },
        { teclas: ["/"], descricao: "Buscar no painel" },
        { teclas: ["?"], descricao: "Mostrar esta folha de atalhos" },
        { teclas: ["Esc"], descricao: "Fechar gaveta, diálogo ou menu" },
      ],
    },
    { titulo: "Ir para", itens: paginas },
    {
      titulo: "Na paleta de comandos",
      itens: [
        { teclas: ["↑", "↓"], descricao: "Escolher um resultado" },
        { teclas: ["Enter"], descricao: "Abrir o resultado escolhido" },
      ],
    },
  ];
};

const editando = (alvo: EventTarget | null): boolean =>
  alvo instanceof Element && Boolean(alvo.closest("input, textarea, select, [contenteditable='true'], dialog[open]"));

const mostrarIndicador = (texto: string | null): void => {
  if (!texto) {
    indicador?.remove();
    indicador = null;
    return;
  }
  if (!indicador) {
    indicador = document.createElement("div");
    indicador.className = "atalho-pendente";
    indicador.setAttribute("role", "status");
    document.body.append(indicador);
  }
  indicador.textContent = texto;
};

const cancelarSequencia = (): void => {
  aguardandoG = false;
  window.clearTimeout(temporizador);
  mostrarIndicador(null);
};

export const abrirAtalhos = (): void => {
  if (dialogo?.open) return;
  dialogo?.remove();
  const marcacao = html`
    <dialog class="modal modal-largo" aria-labelledby="atalhos-titulo">
      <div class="modal-conteudo">
        <div class="modal-topo">
          <div class="modal-textos">
            <h2 class="modal-titulo" id="atalhos-titulo">Atalhos de teclado</h2>
            <p class="modal-texto">Funcionam em qualquer página, fora dos campos de texto.</p>
          </div>
        </div>
        <div class="atalhos-grade">
          ${gruposAtalhos().map(
            (grupo) => html`<div>
              <p class="atalhos-grupo-titulo">${grupo.titulo}</p>
              ${grupo.itens.map(
                (item) => html`<div class="atalho-linha">
                  <span>${item.descricao}</span>
                  <span class="atalho-teclas">${item.teclas.map((tecla, indice) => html`${indice ? html`<span>${item.teclas[0] === "g" ? "então" : item.teclas[0] === "↑" ? "ou" : "+"}</span>` : ""}<kbd>${tecla}</kbd>`)}</span>
                </div>`,
              )}
            </div>`,
          )}
        </div>
      </div>
      <div class="modal-acoes">
        <button type="button" class="botao botao-primario" data-fechar-atalhos>Entendi</button>
      </div>
    </dialog>
  `;
  document.body.insertAdjacentHTML("beforeend", String(marcacao));
  dialogo = document.body.lastElementChild as HTMLDialogElement;
  dialogo.querySelector("[data-fechar-atalhos]")?.addEventListener("click", () => dialogo?.close());
  dialogo.addEventListener("click", (evento) => {
    if (evento.target === dialogo) dialogo?.close();
  });
  dialogo.addEventListener("close", () => {
    dialogo?.remove();
    dialogo = null;
  });
  dialogo.showModal();
};

export const iniciarAtalhosTeclado = (): void => {
  document.addEventListener("keydown", (evento) => {
    if (evento.defaultPrevented || evento.ctrlKey || evento.metaKey || evento.altKey || editando(evento.target)) {
      if (aguardandoG) cancelarSequencia();
      return;
    }
    const tecla = evento.key.toLowerCase();

    if (aguardandoG) {
      const id = IR_PARA[tecla];
      cancelarSequencia();
      const pagina = id ? paginaPorId(id) : undefined;
      if (pagina && pode(pagina.permissao)) {
        evento.preventDefault();
        if (location.pathname !== pagina.href) location.href = pagina.href;
      }
      return;
    }

    if (evento.key === "?") {
      evento.preventDefault();
      abrirAtalhos();
    } else if (tecla === "g" && !evento.shiftKey) {
      aguardandoG = true;
      mostrarIndicador("g → v · a · u · t · n · r · d · c");
      temporizador = window.setTimeout(cancelarSequencia, ESPERA_SEGUNDA_TECLA);
    }
  });
};

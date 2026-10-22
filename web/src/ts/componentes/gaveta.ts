import { html, criar, exigir, type Marcacao } from "../nucleo/dom.ts";
import { icone, hidratarIcones } from "../nucleo/icones.ts";

export type LarguraGaveta = "normal" | "larga" | "estreita";

export interface OpcoesGaveta {
  titulo?: string;
  subtitulo?: string;
  largura?: LarguraGaveta;
  aoFechar?: (() => void) | null;
}

export class Gaveta {
  readonly elemento: HTMLDialogElement;
  readonly corpo: HTMLElement;
  readonly rodape: HTMLElement;
  readonly abas: HTMLElement;
  private readonly aoFechar: (() => void) | null;

  constructor({ titulo = "", subtitulo = "", largura = "normal", aoFechar = null }: OpcoesGaveta = {}) {
    this.aoFechar = aoFechar;
    const classeLargura = largura === "larga" ? "gaveta-larga" : largura === "estreita" ? "gaveta-estreita" : "";
    this.elemento = criar<HTMLDialogElement>(html`
      <dialog class="gaveta ${classeLargura}" aria-labelledby="gaveta-titulo">
        <header class="gaveta-cabecalho">
          <div class="gaveta-titulos">
            <h2 class="gaveta-titulo" id="gaveta-titulo">${titulo}</h2>
            <p class="gaveta-subtitulo" ${subtitulo ? "" : "hidden"}>${subtitulo}</p>
          </div>
          <button type="button" class="gaveta-fechar" aria-label="Fechar painel">${html([icone("fechar")])}</button>
        </header>
        <div class="gaveta-abas" hidden></div>
        <div class="gaveta-corpo"><div class="gaveta-carregando"><span class="giro" role="status" aria-label="Carregando"></span></div></div>
        <footer class="gaveta-rodape" hidden></footer>
      </dialog>
    `);
    this.corpo = exigir(".gaveta-corpo", this.elemento);
    this.rodape = exigir(".gaveta-rodape", this.elemento);
    this.abas = exigir(".gaveta-abas", this.elemento);
    exigir(".gaveta-fechar", this.elemento).addEventListener("click", () => this.fechar());
    this.elemento.addEventListener("cancel", (evento) => {
      evento.preventDefault();
      this.fechar();
    });
    this.elemento.addEventListener("click", (evento) => {
      if (evento.target === this.elemento) this.fechar();
    });
    document.body.append(this.elemento);
  }

  abrir(): this {
    if (!this.elemento.open) this.elemento.showModal();
    return this;
  }

  fechar(): void {
    if (!this.elemento.open || this.elemento.dataset.fechando === "true") return;
    this.elemento.dataset.fechando = "true";
    const concluir = () => {
      this.elemento.dataset.fechando = "false";
      this.elemento.close();
      this.aoFechar?.();
      this.elemento.remove();
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) concluir();
    else setTimeout(concluir, 200);
  }

  definirTitulo(titulo: string, subtitulo?: string | null): void {
    exigir(".gaveta-titulo", this.elemento).textContent = titulo;
    const elementoSubtitulo = exigir(".gaveta-subtitulo", this.elemento);
    elementoSubtitulo.textContent = subtitulo ?? "";
    elementoSubtitulo.hidden = !subtitulo;
  }

  definirCorpo(marcacao: Marcacao): HTMLElement {
    this.corpo.innerHTML = String(marcacao);
    hidratarIcones(this.corpo);
    this.corpo.scrollTop = 0;
    return this.corpo;
  }

  definirAbas(marcacao?: Marcacao | null): HTMLElement {
    this.abas.innerHTML = String(marcacao ?? "");
    this.abas.hidden = !marcacao;
    return this.abas;
  }

  definirRodape(marcacao?: Marcacao | null): HTMLElement {
    this.rodape.innerHTML = String(marcacao ?? "");
    this.rodape.hidden = !marcacao;
    hidratarIcones(this.rodape);
    return this.rodape;
  }

  carregando(): void {
    this.corpo.innerHTML = '<div class="gaveta-carregando"><span class="giro" role="status" aria-label="Carregando"></span></div>';
    this.definirRodape("");
  }
}

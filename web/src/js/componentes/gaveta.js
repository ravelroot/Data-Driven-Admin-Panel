import { html, criar } from "../nucleo/dom.js";
import { icone, hidratarIcones } from "../nucleo/icones.js";

export class Gaveta {
  constructor({ titulo = "", subtitulo = "", largura = "normal", aoFechar = null } = {}) {
    this.aoFechar = aoFechar;
    const classeLargura = largura === "larga" ? "gaveta-larga" : largura === "estreita" ? "gaveta-estreita" : "";
    this.elemento = criar(html`
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
    this.corpo = this.elemento.querySelector(".gaveta-corpo");
    this.rodape = this.elemento.querySelector(".gaveta-rodape");
    this.abas = this.elemento.querySelector(".gaveta-abas");
    this.elemento.querySelector(".gaveta-fechar").addEventListener("click", () => this.fechar());
    this.elemento.addEventListener("cancel", (evento) => {
      evento.preventDefault();
      this.fechar();
    });
    this.elemento.addEventListener("click", (evento) => {
      if (evento.target === this.elemento) this.fechar();
    });
    document.body.append(this.elemento);
  }

  abrir() {
    if (!this.elemento.open) this.elemento.showModal();
    return this;
  }

  fechar() {
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

  definirTitulo(titulo, subtitulo) {
    this.elemento.querySelector(".gaveta-titulo").textContent = titulo;
    const elementoSubtitulo = this.elemento.querySelector(".gaveta-subtitulo");
    elementoSubtitulo.textContent = subtitulo ?? "";
    elementoSubtitulo.hidden = !subtitulo;
  }

  definirCorpo(marcacao) {
    this.corpo.innerHTML = String(marcacao);
    hidratarIcones(this.corpo);
    this.corpo.scrollTop = 0;
    return this.corpo;
  }

  definirAbas(marcacao) {
    this.abas.innerHTML = String(marcacao ?? "");
    this.abas.hidden = !marcacao;
    return this.abas;
  }

  definirRodape(marcacao) {
    this.rodape.innerHTML = String(marcacao ?? "");
    this.rodape.hidden = !marcacao;
    hidratarIcones(this.rodape);
    return this.rodape;
  }

  carregando() {
    this.corpo.innerHTML = '<div class="gaveta-carregando"><span class="giro" role="status" aria-label="Carregando"></span></div>';
    this.definirRodape("");
  }
}

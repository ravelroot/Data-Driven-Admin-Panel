import { html, criar } from "../nucleo/dom.js";
import { icone } from "../nucleo/icones.js";

const ICONES = { sucesso: "confirmar", erro: "fechar", alerta: "alerta", info: "info" };

let recipiente = null;

const obterRecipiente = () => {
  if (!recipiente || !recipiente.isConnected) {
    recipiente = criar('<section class="avisos" aria-live="polite" aria-label="Avisos"></section>');
    document.body.append(recipiente);
  }
  return recipiente;
};

const remover = (elemento) => {
  if (!elemento.isConnected || elemento.dataset.saindo === "true") return;
  elemento.dataset.saindo = "true";
  setTimeout(() => elemento.remove(), 180);
};

export const avisar = ({ tipo = "info", titulo, texto = "", duracao = 5000, acao } = {}) => {
  const elemento = criar(html`
    <div class="aviso" data-tipo="${tipo}" role="${tipo === "erro" ? "alert" : "status"}">
      <span class="aviso-icone">${html([icone(ICONES[tipo] ?? "info")])}</span>
      <div class="aviso-textos">
        ${titulo ? html`<p class="aviso-titulo">${titulo}</p>` : ""}
        ${texto ? html`<p class="aviso-texto">${texto}</p>` : ""}
        ${acao ? html`<button type="button" class="aviso-acao" data-acao-aviso>${acao.rotulo}</button>` : ""}
      </div>
      <button type="button" class="aviso-fechar" aria-label="Fechar aviso">${html([icone("fechar")])}</button>
      ${duracao ? html`<span class="aviso-progresso" style="animation-duration:${duracao}ms"></span>` : ""}
    </div>
  `);

  elemento.querySelector(".aviso-fechar").addEventListener("click", () => remover(elemento));
  elemento.querySelector("[data-acao-aviso]")?.addEventListener("click", () => {
    acao.executar?.();
    remover(elemento);
  });

  const progresso = elemento.querySelector(".aviso-progresso");
  progresso?.addEventListener("animationend", () => remover(elemento));

  const lista = obterRecipiente();
  lista.append(elemento);
  while (lista.children.length > 4) remover(lista.firstElementChild);
  return () => remover(elemento);
};

export const avisoSucesso = (titulo, texto) => avisar({ tipo: "sucesso", titulo, texto });

export const avisoErro = (titulo, texto) => avisar({ tipo: "erro", titulo, texto, duracao: 8000 });

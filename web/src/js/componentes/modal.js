import { html, criar, copiar } from "../nucleo/dom.js";
import { icone } from "../nucleo/icones.js";

const ICONES = { perigo: "alerta", alerta: "alerta", sucesso: "sucesso", info: "info" };

const abrirDialogo = (marcacao) => {
  const dialogo = criar(marcacao);
  document.body.append(dialogo);
  dialogo.showModal();
  return dialogo;
};

export const confirmar = ({
  titulo,
  texto = "",
  tipo = "info",
  confirmar: rotuloConfirmar = "Confirmar",
  cancelar: rotuloCancelar = "Cancelar",
  campo = null,
} = {}) =>
  new Promise((resolver) => {
    const classeBotao = tipo === "perigo" ? "botao-perigo" : "botao-primario";
    const dialogo = abrirDialogo(html`
      <dialog class="modal" aria-labelledby="modal-titulo">
        <form method="dialog" class="contents">
          <div class="modal-conteudo">
            <div class="modal-topo">
              <span class="modal-icone" data-tipo="${tipo}">${html([icone(ICONES[tipo] ?? "info")])}</span>
              <div class="modal-textos">
                <h2 class="modal-titulo" id="modal-titulo">${titulo}</h2>
                ${texto ? html`<p class="modal-texto">${texto}</p>` : ""}
              </div>
            </div>
            ${campo
              ? html`<label class="campo">
                  <span class="campo-rotulo ${campo.obrigatorio ? "campo-obrigatorio" : ""}">${campo.rotulo}</span>
                  <textarea class="area-texto" name="valor" rows="3" maxlength="300" placeholder="${campo.placeholder ?? ""}" ${campo.obrigatorio ? "required" : ""}></textarea>
                </label>`
              : ""}
          </div>
          <div class="modal-acoes">
            <button type="button" class="botao botao-secundario" value="cancelar" data-cancelar>${rotuloCancelar}</button>
            <button type="submit" class="botao ${classeBotao}" value="confirmar">${rotuloConfirmar}</button>
          </div>
        </form>
      </dialog>
    `);

    const formulario = dialogo.querySelector("form");
    let resultado = false;

    dialogo.querySelector("[data-cancelar]").addEventListener("click", () => dialogo.close());
    formulario.addEventListener("submit", (evento) => {
      const entrada = formulario.elements.valor;
      if (entrada && campo?.obrigatorio && !entrada.value.trim()) {
        evento.preventDefault();
        entrada.focus();
        return;
      }
      resultado = entrada ? entrada.value.trim() || true : true;
    });
    dialogo.addEventListener("close", () => {
      resolver(resultado);
      dialogo.remove();
    });
    dialogo.addEventListener("click", (evento) => {
      if (evento.target === dialogo) dialogo.close();
    });
    (formulario.elements.valor ?? dialogo.querySelector("[type=submit]")).focus();
  });

export const mostrarSegredo = ({ titulo, texto, segredo, rotulo = "Copiar" }) =>
  new Promise((resolver) => {
    const dialogo = abrirDialogo(html`
      <dialog class="modal" aria-labelledby="segredo-titulo">
        <div class="modal-conteudo">
          <div class="modal-topo">
            <span class="modal-icone" data-tipo="alerta">${html([icone("chave")])}</span>
            <div class="modal-textos">
              <h2 class="modal-titulo" id="segredo-titulo">${titulo}</h2>
              <p class="modal-texto">${texto}</p>
            </div>
          </div>
          <div class="segredo">
            <code>${segredo}</code>
            <button type="button" class="botao botao-secundario botao-pequeno" data-copiar>${html([icone("copiar")])}<span>${rotulo}</span></button>
          </div>
        </div>
        <div class="modal-acoes">
          <button type="button" class="botao botao-primario" data-fechar>Já guardei</button>
        </div>
      </dialog>
    `);
    dialogo.querySelector("[data-copiar]").addEventListener("click", async (evento) => {
      const ok = await copiar(segredo);
      evento.currentTarget.querySelector("span").textContent = ok ? "Copiado" : "Copie manualmente";
    });
    dialogo.querySelector("[data-fechar]").addEventListener("click", () => dialogo.close());
    dialogo.addEventListener("close", () => {
      resolver();
      dialogo.remove();
    });
  });

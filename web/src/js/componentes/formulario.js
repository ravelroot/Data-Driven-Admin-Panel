import { html, criar } from "../nucleo/dom.js";
import { icone } from "../nucleo/icones.js";

export const lerFormulario = (formulario) => {
  const dados = {};
  for (const elemento of formulario.elements) {
    if (!elemento.name || elemento.disabled) continue;
    if (elemento.type === "checkbox") {
      if (elemento.dataset.lista !== undefined) {
        dados[elemento.name] ??= [];
        if (elemento.checked) dados[elemento.name].push(elemento.value);
      } else {
        dados[elemento.name] = elemento.checked;
      }
    } else if (elemento.type === "radio") {
      if (elemento.checked) dados[elemento.name] = elemento.value;
    } else if (elemento.type === "number") {
      dados[elemento.name] = elemento.value === "" ? null : Number(elemento.value);
    } else if (elemento.dataset.moeda !== undefined) {
      const limpo = elemento.value.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
      dados[elemento.name] = limpo === "" ? null : Math.round(Number(limpo) * 100);
    } else {
      dados[elemento.name] = elemento.value.trim();
    }
  }
  return dados;
};

export const semVazios = (objeto) => Object.fromEntries(Object.entries(objeto).filter(([, valor]) => valor !== "" && valor !== null && valor !== undefined));

export const limparErros = (formulario) => {
  for (const campo of formulario.querySelectorAll('.campo[data-invalido="true"]')) campo.dataset.invalido = "false";
  for (const erro of formulario.querySelectorAll(".campo-erro[data-gerado]")) erro.remove();
  for (const entrada of formulario.querySelectorAll('[aria-invalid="true"]')) entrada.removeAttribute("aria-invalid");
};

const normalizarDetalhes = (detalhes) => {
  if (!detalhes) return {};
  if (Array.isArray(detalhes)) {
    return Object.fromEntries(detalhes.map((item) => [Array.isArray(item.caminho ?? item.path) ? (item.caminho ?? item.path).join(".") : (item.campo ?? item.caminho ?? item.path ?? ""), item.mensagem ?? item.message]));
  }
  if (typeof detalhes === "object") {
    if (detalhes.campos && typeof detalhes.campos === "object") return normalizarDetalhes(detalhes.campos);
    return Object.fromEntries(Object.entries(detalhes).map(([chave, valor]) => [chave, Array.isArray(valor) ? valor[0] : String(valor)]));
  }
  return {};
};

export const mostrarErros = (formulario, detalhes) => {
  limparErros(formulario);
  const erros = normalizarDetalhes(detalhes);
  let primeiro = null;
  for (const [nome, mensagem] of Object.entries(erros)) {
    const entrada = formulario.elements[nome];
    const elemento = entrada instanceof RadioNodeList ? entrada[0] : entrada;
    if (!elemento) continue;
    const campo = elemento.closest(".campo");
    elemento.setAttribute("aria-invalid", "true");
    if (campo) {
      campo.dataset.invalido = "true";
      campo.append(criar(html`<p class="campo-erro" data-gerado>${html([icone("alerta")])}<span>${mensagem}</span></p>`));
    }
    primeiro ??= elemento;
  }
  primeiro?.focus();
  return Object.keys(erros).length > 0;
};

export const forcaSenha = (senha = "") => {
  let pontos = 0;
  if (senha.length >= 8) pontos += 1;
  if (senha.length >= 12) pontos += 1;
  if (/[A-Z]/.test(senha) && /[a-z]/.test(senha)) pontos += 1;
  if (/\d/.test(senha) && /[^A-Za-z0-9]/.test(senha)) pontos += 1;
  return senha ? Math.max(1, pontos) : 0;
};

export const ligarForcaSenha = (entrada, medidor) => {
  if (!entrada || !medidor) return;
  entrada.addEventListener("input", () => {
    medidor.dataset.nivel = String(forcaSenha(entrada.value));
  });
};

export const ligarMostrarSenha = (raiz = document) => {
  for (const botao of raiz.querySelectorAll("[data-mostrar-senha]")) {
    botao.addEventListener("click", () => {
      const entrada = botao.closest(".entrada-caixa").querySelector("input");
      const visivel = entrada.type === "text";
      entrada.type = visivel ? "password" : "text";
      botao.setAttribute("aria-label", visivel ? "Mostrar senha" : "Ocultar senha");
      botao.innerHTML = icone(visivel ? "olho" : "olho-fechado");
    });
  }
};

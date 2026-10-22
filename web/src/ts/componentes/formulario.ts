import { html, criar } from "../nucleo/dom.ts";
import { icone } from "../nucleo/icones.ts";

type CampoFormulario = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

export type ValorFormulario = string | number | boolean | string[] | null;

const ehCampo = (elemento: Element): elemento is CampoFormulario =>
  elemento instanceof HTMLInputElement || elemento instanceof HTMLSelectElement || elemento instanceof HTMLTextAreaElement;

export const lerFormulario = <T = Record<string, any>>(formulario: HTMLFormElement): T => {
  const dados: Record<string, ValorFormulario> = {};
  for (const elemento of Array.from(formulario.elements)) {
    if (!ehCampo(elemento) || !elemento.name || elemento.disabled) continue;
    if (elemento instanceof HTMLInputElement && elemento.type === "checkbox") {
      if (elemento.dataset.lista !== undefined) {
        const lista = (dados[elemento.name] ??= []) as string[];
        if (elemento.checked) lista.push(elemento.value);
      } else {
        dados[elemento.name] = elemento.checked;
      }
    } else if (elemento instanceof HTMLInputElement && elemento.type === "radio") {
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
  return dados as T;
};

export const semVazios = <T extends object>(objeto: T): Partial<T> =>
  Object.fromEntries(Object.entries(objeto).filter(([, valor]) => valor !== "" && valor !== null && valor !== undefined)) as Partial<T>;

export const limparErros = (formulario: ParentNode): void => {
  for (const campo of formulario.querySelectorAll<HTMLElement>('.campo[data-invalido="true"]')) campo.dataset.invalido = "false";
  for (const erro of formulario.querySelectorAll(".campo-erro[data-gerado]")) erro.remove();
  for (const entrada of formulario.querySelectorAll('[aria-invalid="true"]')) entrada.removeAttribute("aria-invalid");
};

interface DetalheCampo {
  campo?: string;
  caminho?: string | Array<string | number>;
  path?: string | Array<string | number>;
  mensagem?: string;
  message?: string;
}

const normalizarDetalhes = (detalhes: unknown): Record<string, string> => {
  if (!detalhes) return {};
  if (Array.isArray(detalhes)) {
    return Object.fromEntries(
      (detalhes as DetalheCampo[]).map((item) => {
        const caminho = item.caminho ?? item.path;
        return [Array.isArray(caminho) ? caminho.join(".") : (item.campo ?? caminho ?? ""), item.mensagem ?? item.message ?? ""];
      }),
    );
  }
  if (typeof detalhes === "object") {
    const registro = detalhes as Record<string, unknown>;
    if (registro.campos && typeof registro.campos === "object") return normalizarDetalhes(registro.campos);
    return Object.fromEntries(Object.entries(registro).map(([chave, valor]) => [chave, Array.isArray(valor) ? String(valor[0]) : String(valor)]));
  }
  return {};
};

export const mostrarErros = (formulario: HTMLFormElement, detalhes: unknown): boolean => {
  limparErros(formulario);
  const erros = normalizarDetalhes(detalhes);
  let primeiro: HTMLElement | null = null;
  for (const [nome, mensagem] of Object.entries(erros)) {
    const entrada = formulario.elements.namedItem(nome);
    const elemento = (entrada instanceof RadioNodeList ? entrada[0] : entrada) as HTMLElement | null;
    if (!elemento) continue;
    const campo = elemento.closest<HTMLElement>(".campo");
    elemento.setAttribute("aria-invalid", "true");
    if (campo) {
      campo.dataset.invalido = "true";
      campo.append(criar(html`<p class="campo-erro" data-gerado>${html([icone("alerta")])}<span>${mensagem}</span></p>`));
    }
    primeiro ??= elemento;
  }
  (primeiro as HTMLElement | null)?.focus();
  return Object.keys(erros).length > 0;
};

export const forcaSenha = (senha = ""): number => {
  let pontos = 0;
  if (senha.length >= 8) pontos += 1;
  if (senha.length >= 12) pontos += 1;
  if (/[A-Z]/.test(senha) && /[a-z]/.test(senha)) pontos += 1;
  if (/\d/.test(senha) && /[^A-Za-z0-9]/.test(senha)) pontos += 1;
  return senha ? Math.max(1, pontos) : 0;
};

export const ligarForcaSenha = (entrada: Element | null | undefined, medidor: HTMLElement | null | undefined): void => {
  if (!(entrada instanceof HTMLInputElement) || !medidor) return;
  entrada.addEventListener("input", () => {
    medidor.dataset.nivel = String(forcaSenha(entrada.value));
  });
};

export const ligarMostrarSenha = (raiz: ParentNode = document): void => {
  for (const botao of raiz.querySelectorAll<HTMLElement>("[data-mostrar-senha]")) {
    botao.addEventListener("click", () => {
      const entrada = botao.closest(".entrada-caixa")?.querySelector("input");
      if (!entrada) return;
      const visivel = entrada.type === "text";
      entrada.type = visivel ? "password" : "text";
      botao.setAttribute("aria-label", visivel ? "Mostrar senha" : "Ocultar senha");
      botao.innerHTML = icone(visivel ? "olho" : "olho-fechado");
    });
  }
};

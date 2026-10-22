import { html, criar } from "../nucleo/dom.ts";
import { icone } from "../nucleo/icones.ts";

export type TipoAviso = "sucesso" | "erro" | "alerta" | "info";

export interface AcaoAviso {
  rotulo: string;
  executar?: () => void;
}

export interface OpcoesAviso {
  tipo?: TipoAviso;
  titulo?: string;
  texto?: string;
  duracao?: number;
  acao?: AcaoAviso;
}

const ICONES: Record<TipoAviso, string> = { sucesso: "confirmar", erro: "fechar", alerta: "alerta", info: "info" };

let recipiente: HTMLElement | null = null;

const obterRecipiente = (): HTMLElement => {
  if (!recipiente || !recipiente.isConnected) {
    const novo = criar<HTMLElement>('<section class="avisos" aria-live="polite" aria-label="Avisos"></section>');
    document.body.append(novo);
    recipiente = novo;
    return novo;
  }
  return recipiente;
};

const remover = (elemento: HTMLElement | null): void => {
  if (!elemento || !elemento.isConnected || elemento.dataset.saindo === "true") return;
  elemento.dataset.saindo = "true";
  setTimeout(() => elemento.remove(), 180);
};

export const avisar = ({ tipo = "info", titulo, texto = "", duracao = 5000, acao }: OpcoesAviso = {}): (() => void) => {
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

  elemento.querySelector(".aviso-fechar")?.addEventListener("click", () => remover(elemento));
  elemento.querySelector("[data-acao-aviso]")?.addEventListener("click", () => {
    acao?.executar?.();
    remover(elemento);
  });

  const progresso = elemento.querySelector(".aviso-progresso");
  progresso?.addEventListener("animationend", () => remover(elemento));

  const lista = obterRecipiente();
  lista.append(elemento);
  while (lista.children.length > 4) remover(lista.firstElementChild as HTMLElement | null);
  return () => remover(elemento);
};

export const avisoSucesso = (titulo: string, texto?: string): (() => void) => avisar({ tipo: "sucesso", titulo, texto });

export const avisoErro = (titulo: string, texto?: string): (() => void) => avisar({ tipo: "erro", titulo, texto, duracao: 8000 });

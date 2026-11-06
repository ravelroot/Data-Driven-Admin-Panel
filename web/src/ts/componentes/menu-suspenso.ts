import { html, criar } from "../nucleo/dom.ts";
import { icone } from "../nucleo/icones.ts";

export interface ItemMenu {
  rotulo: string;
  icone?: string;
  perigo?: boolean;
  desativado?: boolean;
  executar?: () => void;
}

export type EntradaMenu = ItemMenu | "separador" | null | undefined | false;

interface MenuFlutuante {
  origem: HTMLElement;
  elemento: HTMLElement;
}

let menuFlutuante: MenuFlutuante | null = null;

const fecharFlutuante = (): void => {
  if (!menuFlutuante) return;
  menuFlutuante.origem.setAttribute("aria-expanded", "false");
  menuFlutuante.elemento.remove();
  menuFlutuante = null;
};

const navegarTeclado = (menu: HTMLElement, evento: KeyboardEvent): void => {
  const itens = Array.from(menu.querySelectorAll<HTMLElement>(".menu-item:not(:disabled)"));
  if (!itens.length) return;
  const atual = itens.indexOf(document.activeElement as HTMLElement);
  if (evento.key === "ArrowDown") {
    evento.preventDefault();
    itens[(atual + 1) % itens.length].focus();
  } else if (evento.key === "ArrowUp") {
    evento.preventDefault();
    itens[(atual - 1 + itens.length) % itens.length].focus();
  } else if (evento.key === "Home") {
    evento.preventDefault();
    itens[0].focus();
  } else if (evento.key === "End") {
    evento.preventDefault();
    itens.at(-1)?.focus();
  }
};

const posicionar = (origem: HTMLElement, elemento: HTMLElement): void => {
  const caixa = origem.getBoundingClientRect();
  const largura = elemento.offsetWidth;
  const altura = elemento.offsetHeight;
  const espacoAbaixo = window.innerHeight - caixa.bottom;
  const topo = espacoAbaixo < altura + 16 ? Math.max(8, caixa.top - altura - 6) : caixa.bottom + 6;
  const esquerda = Math.min(window.innerWidth - largura - 8, Math.max(8, caixa.right - largura));
  elemento.style.top = `${topo}px`;
  elemento.style.left = `${esquerda}px`;
  elemento.style.right = "auto";
};

export interface OpcaoMarcacao {
  valor: string;
  rotulo: string;
  marcado: boolean;
  desativado?: boolean;
}

export interface MenuMarcacao {
  titulo: string;
  opcoes: OpcaoMarcacao[];
  rodape?: { rotulo: string; executar: () => void };
  aoAlterar: (valor: string, marcado: boolean) => OpcaoMarcacao[] | void;
}

export const abrirMenuMarcacao = (origem: HTMLElement, menu: MenuMarcacao): void => {
  if (menuFlutuante?.origem === origem) {
    fecharFlutuante();
    return;
  }
  fecharFlutuante();
  const desenhar = (opcoes: OpcaoMarcacao[]) => html`
    <p class="menu-titulo">${menu.titulo}</p>
    ${opcoes.map(
      (opcao) => html`<button type="button" role="menuitemcheckbox" class="menu-item menu-item-marcacao" aria-checked="${opcao.marcado}" data-valor="${opcao.valor}" ${opcao.desativado ? "disabled" : ""}>
        <span>${opcao.rotulo}</span>
      </button>`,
    )}
    ${menu.rodape ? html`<div class="menu-separador" role="separator"></div><button type="button" role="menuitem" class="menu-item" data-rodape>${html([icone("atualizar")])}<span>${menu.rodape.rotulo}</span></button>` : ""}
  `;
  const elemento = criar<HTMLElement>(html`<div class="menu menu-marcacao" role="menu" aria-label="${menu.titulo}" data-aberto="true" style="position:fixed">${desenhar(menu.opcoes)}</div>`);
  document.body.append(elemento);
  elemento.addEventListener("click", (evento) => {
    evento.stopPropagation();
    const alvo = (evento.target as Element | null)?.closest<HTMLButtonElement>(".menu-item");
    if (!alvo || alvo.disabled) return;
    if (alvo.dataset.rodape !== undefined) {
      fecharFlutuante();
      menu.rodape?.executar();
      return;
    }
    const valor = alvo.dataset.valor ?? "";
    const marcado = alvo.getAttribute("aria-checked") !== "true";
    const novas = menu.aoAlterar(valor, marcado);
    if (novas) {
      elemento.innerHTML = String(desenhar(novas));
      elemento.querySelector<HTMLElement>(`[data-valor="${CSS.escape(valor)}"]`)?.focus();
    } else {
      alvo.setAttribute("aria-checked", String(marcado));
    }
  });
  elemento.addEventListener("keydown", (evento) => navegarTeclado(elemento, evento));
  posicionar(origem, elemento);
  origem.setAttribute("aria-expanded", "true");
  menuFlutuante = { origem, elemento };
  elemento.querySelector<HTMLElement>(".menu-item")?.focus();
};

export const abrirMenuAcoes = (origem: HTMLElement, itens: EntradaMenu[]): void => {
  if (menuFlutuante?.origem === origem) {
    fecharFlutuante();
    return;
  }
  fecharFlutuante();
  const entradas = itens.filter((item): item is ItemMenu | "separador" => Boolean(item));
  const elemento = criar<HTMLElement>(html`
    <div class="menu" role="menu" data-aberto="true" style="position:fixed">
      ${entradas
        .map((item) =>
          item === "separador"
            ? html`<div class="menu-separador" role="separator"></div>`
            : html`<button type="button" role="menuitem" class="menu-item ${item.perigo ? "menu-item-perigo" : ""}" ${item.desativado ? "disabled" : ""}>
                ${item.icone ? html([icone(item.icone)]) : ""}<span>${item.rotulo}</span>
              </button>`,
        )}
    </div>
  `);
  document.body.append(elemento);
  const acoes = entradas.filter((item): item is ItemMenu => item !== "separador");
  elemento.querySelectorAll<HTMLButtonElement>(".menu-item").forEach((botao, indice) => {
    botao.addEventListener("click", () => {
      fecharFlutuante();
      acoes[indice]?.executar?.();
    });
  });
  elemento.addEventListener("keydown", (evento) => navegarTeclado(elemento, evento));

  posicionar(origem, elemento);
  origem.setAttribute("aria-expanded", "true");
  menuFlutuante = { origem, elemento };
  elemento.querySelector<HTMLElement>(".menu-item")?.focus();
};

export const iniciarMenus = (raiz: ParentNode = document): void => {
  for (const gatilho of raiz.querySelectorAll<HTMLElement>("[data-menu]")) {
    if (gatilho.dataset.menuPronto) continue;
    gatilho.dataset.menuPronto = "true";
    const menu = document.getElementById(gatilho.dataset.menu ?? "");
    if (!menu) continue;
    gatilho.setAttribute("aria-haspopup", "true");
    gatilho.setAttribute("aria-expanded", "false");
    gatilho.addEventListener("click", (evento) => {
      evento.stopPropagation();
      const aberto = menu.dataset.aberto === "true";
      fecharTodos();
      if (!aberto) {
        menu.dataset.aberto = "true";
        gatilho.setAttribute("aria-expanded", "true");
        menu.dispatchEvent(new CustomEvent("menu:aberto"));
      }
    });
    menu.addEventListener("keydown", (evento) => navegarTeclado(menu, evento));
    menu.addEventListener("click", (evento) => {
      if ((evento.target as Element | null)?.closest(".menu-item, a")) fecharTodos();
      evento.stopPropagation();
    });
  }
};

export const fecharTodos = (): void => {
  for (const menu of document.querySelectorAll<HTMLElement>('.menu[data-aberto="true"], .central-notificacoes[data-aberto="true"], .popover[data-aberto="true"]')) {
    menu.dataset.aberto = "false";
  }
  for (const gatilho of document.querySelectorAll('[data-menu][aria-expanded="true"]')) gatilho.setAttribute("aria-expanded", "false");
  fecharFlutuante();
};

document.addEventListener("click", (evento) => {
  const alvo = evento.target as Element | null;
  if (menuFlutuante && !menuFlutuante.elemento.contains(alvo) && !menuFlutuante.origem.contains(alvo)) fecharFlutuante();
  if (!alvo?.closest(".menu, .central-notificacoes, .popover, [data-menu]") && !(alvo && menuFlutuante?.origem.contains(alvo))) fecharTodos();
});

document.addEventListener("keydown", (evento) => {
  if (evento.key === "Escape") {
    const origem = menuFlutuante?.origem;
    fecharTodos();
    origem?.focus();
  }
});

window.addEventListener("resize", fecharFlutuante);
window.addEventListener("scroll", fecharFlutuante, true);

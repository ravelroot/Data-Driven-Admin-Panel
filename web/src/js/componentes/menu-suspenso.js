import { html, criar } from "../nucleo/dom.js";
import { icone } from "../nucleo/icones.js";

let menuFlutuante = null;

const fecharFlutuante = () => {
  if (!menuFlutuante) return;
  menuFlutuante.origem?.setAttribute("aria-expanded", "false");
  menuFlutuante.elemento.remove();
  menuFlutuante = null;
};

const navegarTeclado = (menu, evento) => {
  const itens = Array.from(menu.querySelectorAll(".menu-item:not(:disabled)"));
  if (!itens.length) return;
  const atual = itens.indexOf(document.activeElement);
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
    itens.at(-1).focus();
  }
};

export const abrirMenuAcoes = (origem, itens) => {
  if (menuFlutuante?.origem === origem) {
    fecharFlutuante();
    return;
  }
  fecharFlutuante();
  const elemento = criar(html`
    <div class="menu" role="menu" data-aberto="true" style="position:fixed">
      ${itens
        .filter(Boolean)
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
  const acoes = itens.filter((item) => item && item !== "separador");
  elemento.querySelectorAll(".menu-item").forEach((botao, indice) => {
    botao.addEventListener("click", () => {
      fecharFlutuante();
      acoes[indice].executar?.();
    });
  });
  elemento.addEventListener("keydown", (evento) => navegarTeclado(elemento, evento));

  const caixa = origem.getBoundingClientRect();
  const largura = elemento.offsetWidth;
  const altura = elemento.offsetHeight;
  const espacoAbaixo = window.innerHeight - caixa.bottom;
  const topo = espacoAbaixo < altura + 16 ? Math.max(8, caixa.top - altura - 6) : caixa.bottom + 6;
  const esquerda = Math.min(window.innerWidth - largura - 8, Math.max(8, caixa.right - largura));
  elemento.style.top = `${topo}px`;
  elemento.style.left = `${esquerda}px`;
  elemento.style.right = "auto";

  origem.setAttribute("aria-expanded", "true");
  menuFlutuante = { origem, elemento };
  elemento.querySelector(".menu-item")?.focus();
};

export const iniciarMenus = (raiz = document) => {
  for (const gatilho of raiz.querySelectorAll("[data-menu]")) {
    if (gatilho.dataset.menuPronto) continue;
    gatilho.dataset.menuPronto = "true";
    const menu = document.getElementById(gatilho.dataset.menu);
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
      if (evento.target.closest(".menu-item, a")) fecharTodos();
      evento.stopPropagation();
    });
  }
};

export const fecharTodos = () => {
  for (const menu of document.querySelectorAll('.menu[data-aberto="true"], .central-notificacoes[data-aberto="true"], .popover[data-aberto="true"]')) {
    menu.dataset.aberto = "false";
  }
  for (const gatilho of document.querySelectorAll('[data-menu][aria-expanded="true"]')) gatilho.setAttribute("aria-expanded", "false");
  fecharFlutuante();
};

document.addEventListener("click", (evento) => {
  if (menuFlutuante && !menuFlutuante.elemento.contains(evento.target) && !menuFlutuante.origem.contains(evento.target)) fecharFlutuante();
  if (!evento.target.closest(".menu, .central-notificacoes, .popover, [data-menu]")) fecharTodos();
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

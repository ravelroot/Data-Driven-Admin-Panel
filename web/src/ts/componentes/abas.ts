export interface OpcoesAbas {
  aoTrocar?: (nome: string, aba: HTMLElement) => void;
  inicial?: string | null;
}

export interface ControleAbas {
  selecionar: (nome: string) => void;
}

export const iniciarAbas = (lista: Element | null | undefined, { aoTrocar, inicial }: OpcoesAbas = {}): ControleAbas | null => {
  if (!lista) return null;
  const abas = Array.from(lista.querySelectorAll<HTMLElement>('[role="tab"]'));

  const selecionar = (aba: HTMLElement | undefined, focar = false): void => {
    if (!aba) return;
    for (const outra of abas) {
      const ativa = outra === aba;
      outra.setAttribute("aria-selected", ativa ? "true" : "false");
      outra.tabIndex = ativa ? 0 : -1;
      const painel = document.getElementById(outra.getAttribute("aria-controls") ?? "");
      if (painel) painel.hidden = !ativa;
    }
    if (focar) aba.focus();
    aoTrocar?.(aba.dataset.aba ?? aba.id, aba);
  };

  abas.forEach((aba) => {
    aba.addEventListener("click", () => selecionar(aba));
    aba.addEventListener("keydown", (evento) => {
      const indice = abas.indexOf(aba);
      const horizontal = lista.getAttribute("aria-orientation") !== "vertical";
      const proxima = horizontal ? "ArrowRight" : "ArrowDown";
      const anterior = horizontal ? "ArrowLeft" : "ArrowUp";
      if (evento.key === proxima) selecionar(abas[(indice + 1) % abas.length], true);
      else if (evento.key === anterior) selecionar(abas[(indice - 1 + abas.length) % abas.length], true);
      else if (evento.key === "Home") selecionar(abas[0], true);
      else if (evento.key === "End") selecionar(abas.at(-1), true);
      else return;
      evento.preventDefault();
    });
  });

  const primeira = abas.find((aba) => (aba.dataset.aba ?? aba.id) === inicial) ?? abas.find((aba) => aba.getAttribute("aria-selected") === "true") ?? abas[0];
  if (primeira) selecionar(primeira);

  return {
    selecionar: (nome: string) => {
      const aba = abas.find((item) => (item.dataset.aba ?? item.id) === nome);
      if (aba) selecionar(aba);
    },
  };
};

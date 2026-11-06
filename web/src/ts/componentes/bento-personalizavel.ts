import { html, $$, exigir, renderizar, carregando } from "../nucleo/dom.ts";
import { icone, hidratarIcones } from "../nucleo/icones.ts";
import { movimentoReduzido } from "../nucleo/tema.ts";
import {
  aplicarModelo,
  CLASSES_LARGURA,
  COLUNAS_LARGURA,
  iguaisLayouts,
  layoutPadrao,
  moverEntreVisiveis,
  moverItem,
  normalizarLayout,
  ROTULOS_LARGURA,
  type DefinicaoCartao,
  type ModeloLayout,
} from "../nucleo/layout.ts";
import { abrirMenuAcoes, type EntradaMenu } from "./menu-suspenso.ts";
import { avisar } from "./aviso.ts";
import type { ItemLayout } from "../nucleo/tipos.ts";

export interface OpcoesBentoPersonalizavel {
  grade: HTMLElement;
  barra: HTMLElement;
  botao: HTMLButtonElement | null;
  definicoes: DefinicaoCartao[];
  modelos: ModeloLayout[];
  salvo: ItemLayout[] | null | undefined;
  aoSalvar: (layout: ItemLayout[] | null) => Promise<void>;
}

const fracao = (largura: ItemLayout["largura"]): string => {
  const colunas = COLUNAS_LARGURA[largura];
  const mapa: Record<number, string> = { 3: "1/4", 4: "1/3", 5: "5/12", 6: "1/2", 7: "7/12", 8: "2/3", 9: "3/4", 12: "inteiro" };
  return mapa[colunas] ?? `${colunas}/12`;
};

export class BentoPersonalizavel {
  private readonly opcoes: OpcoesBentoPersonalizavel;
  private layout: ItemLayout[];
  private original: ItemLayout[];
  private editando = false;
  private arrastando: string | null = null;
  private readonly definicoes: Map<string, DefinicaoCartao>;

  constructor(opcoes: OpcoesBentoPersonalizavel) {
    this.opcoes = opcoes;
    this.definicoes = new Map(opcoes.definicoes.map((definicao) => [definicao.id, definicao]));
    this.layout = normalizarLayout(opcoes.definicoes, opcoes.salvo);
    this.original = this.layout;
    this.aplicar(false);
    opcoes.botao?.addEventListener("click", () => (this.editando ? this.sair(false) : this.entrar()));
    this.ligarEventos();
  }

  get emEdicao(): boolean {
    return this.editando;
  }

  private cartao(id: string): HTMLElement | null {
    return this.opcoes.grade.querySelector<HTMLElement>(`:scope > [data-cartao="${id}"]`);
  }

  private aplicar(animar: boolean): void {
    const { grade } = this.opcoes;
    const visiveis = $$<HTMLElement>(":scope > [data-cartao]:not([hidden])", grade);
    const antes = animar && !movimentoReduzido() ? new Map(visiveis.map((cartao) => [cartao, cartao.getBoundingClientRect()])) : null;
    for (const item of this.layout) {
      const cartao = this.cartao(item.id);
      if (!cartao) continue;
      if (!cartao.classList.contains("bento-pilha")) {
        cartao.classList.remove(...CLASSES_LARGURA);
        cartao.classList.add(`bento-${item.largura}`);
      }
      cartao.classList.toggle("bento-alto", item.altura === "alto");
      cartao.hidden = item.oculto;
      grade.append(cartao);
    }
    grade.dataset.personalizado = String(!iguaisLayouts(this.layout, layoutPadrao(this.opcoes.definicoes)));
    if (!antes) return;
    for (const [cartao, anterior] of antes) {
      if (cartao.hidden) continue;
      const atual = cartao.getBoundingClientRect();
      const dx = anterior.left - atual.left;
      const dy = anterior.top - atual.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      cartao.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 220, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
    }
  }

  private atualizar(layout: ItemLayout[]): void {
    this.layout = layout;
    this.aplicar(true);
    if (this.editando) {
      this.renderizarFerramentas();
      this.renderizarBarra();
    }
  }

  entrar(): void {
    if (this.editando) return;
    this.editando = true;
    this.original = this.layout;
    const { grade, botao } = this.opcoes;
    grade.dataset.editando = "true";
    botao?.setAttribute("aria-pressed", "true");
    this.renderizarFerramentas();
    this.renderizarBarra();
    this.opcoes.barra.hidden = false;
    exigir<HTMLElement>("[data-barra-titulo]", this.opcoes.barra).focus({ preventScroll: true });
    this.opcoes.barra.scrollIntoView({ block: "start", behavior: movimentoReduzido() ? "auto" : "smooth" });
  }

  async sair(salvar: boolean): Promise<void> {
    if (!this.editando) return;
    if (salvar) {
      const botaoSalvar = this.opcoes.barra.querySelector<HTMLButtonElement>("[data-barra-acao='salvar']");
      carregando(botaoSalvar, true);
      try {
        const padrao = iguaisLayouts(this.layout, layoutPadrao(this.opcoes.definicoes));
        await this.opcoes.aoSalvar(padrao ? null : this.layout);
      } catch {
        carregando(botaoSalvar, false);
        return;
      }
    } else {
      this.layout = this.original;
      this.aplicar(true);
    }
    this.editando = false;
    const { grade, botao, barra } = this.opcoes;
    delete grade.dataset.editando;
    botao?.setAttribute("aria-pressed", "false");
    barra.hidden = true;
    renderizar(barra, "");
    for (const cartao of $$<HTMLElement>(":scope > [data-cartao]", grade)) {
      cartao.querySelector(":scope > .cartao-edicao")?.remove();
      cartao.draggable = false;
      for (const filho of Array.from(cartao.children)) filho.removeAttribute("inert");
    }
    botao?.focus();
  }

  private renderizarFerramentas(): void {
    for (const item of this.layout) {
      const cartao = this.cartao(item.id);
      const definicao = this.definicoes.get(item.id);
      if (!cartao || !definicao) continue;
      cartao.draggable = !item.oculto;
      for (const filho of Array.from(cartao.children)) if (!filho.classList.contains("cartao-edicao")) filho.setAttribute("inert", "");
      let ferramentas = cartao.querySelector<HTMLElement>(":scope > .cartao-edicao");
      if (!ferramentas) {
        ferramentas = document.createElement("div");
        ferramentas.className = "cartao-edicao";
        cartao.prepend(ferramentas);
      }
      const redimensionavel = definicao.larguras.length > 1 || definicao.alturas.length > 1;
      renderizar(
        ferramentas,
        html`<button type="button" class="cartao-edicao-alca" data-edicao="mover" data-id="${item.id}" aria-label="Mover ${definicao.nome}. Use as setas do teclado para mudar a posição." title="Arraste ou use as setas">${html([icone("arrastar")])}</button>
          <span class="cartao-edicao-nome">${definicao.nome}</span>
          <span class="cartao-edicao-acoes">
            ${redimensionavel
              ? html`<button type="button" class="cartao-edicao-botao" data-edicao="tamanho" data-id="${item.id}" aria-haspopup="menu" aria-label="Tamanho de ${definicao.nome}: ${ROTULOS_LARGURA[item.largura]}${item.altura === "alto" ? ", alto" : ""}">${html([icone("largura")])}<span>${fracao(item.largura)}${item.altura === "alto" ? " · alto" : ""}</span></button>`
              : ""}
            <button type="button" class="cartao-edicao-botao" data-edicao="ocultar" data-id="${item.id}" aria-label="Ocultar ${definicao.nome}" title="Ocultar">${html([icone("olho-fechado")])}</button>
          </span>`,
      );
    }
  }

  private renderizarBarra(): void {
    const ocultos = this.layout.filter((item) => item.oculto);
    const mudou = !iguaisLayouts(this.layout, this.original);
    renderizar(
      this.opcoes.barra,
      html`<div class="barra-personalizacao-textos">
          <p class="barra-personalizacao-titulo" data-barra-titulo tabindex="-1">${html([icone("grade")])}Personalizando a visão geral</p>
          <p class="barra-personalizacao-texto">Arraste os cartões pela alça ou use as setas do teclado nela. O layout fica salvo na sua conta e vale em qualquer navegador.</p>
        </div>
        <div class="barra-personalizacao-ocultos" aria-label="Cartões ocultos">
          <span class="barra-personalizacao-rotulo">Ocultos</span>
          ${ocultos.length
            ? ocultos.map((item) => html`<button type="button" class="chip-filtro" data-barra-acao="mostrar" data-id="${item.id}">${html([icone("adicionar")])}${this.definicoes.get(item.id)?.nome ?? item.id}</button>`)
            : html`<span class="barra-personalizacao-vazio">nenhum</span>`}
        </div>
        <div class="barra-personalizacao-acoes">
          <label class="barra-personalizacao-modelo">
            <span class="sr-only">Layout pronto</span>
            <select class="selecao selecao-pequena" data-barra-acao="modelo">
              <option value="">Layouts prontos…</option>
              ${this.opcoes.modelos.map((modelo) => html`<option value="${modelo.id}" title="${modelo.descricao}">${modelo.nome}</option>`)}
            </select>
          </label>
          <button type="button" class="botao botao-fantasma botao-pequeno" data-barra-acao="restaurar">${html([icone("desfazer")])}Padrão</button>
          <button type="button" class="botao botao-secundario botao-pequeno" data-barra-acao="cancelar">Cancelar</button>
          <button type="button" class="botao botao-primario botao-pequeno" data-barra-acao="salvar">${html([icone("salvar")])}${mudou ? "Salvar layout" : "Concluir"}</button>
        </div>`,
    );
    hidratarIcones(this.opcoes.barra);
  }

  private alterarItem(id: string, mudanca: Partial<ItemLayout>): void {
    this.atualizar(this.layout.map((item) => (item.id === id ? { ...item, ...mudanca } : item)));
  }

  private menuTamanho(origem: HTMLElement, id: string): void {
    const item = this.layout.find((atual) => atual.id === id);
    const definicao = this.definicoes.get(id);
    if (!item || !definicao) return;
    const entradas: EntradaMenu[] = definicao.larguras.map((largura) => ({
      rotulo: `${ROTULOS_LARGURA[largura]} (${fracao(largura)})`,
      icone: largura === item.largura ? "confirmar" : "largura",
      executar: () => this.alterarItem(id, { largura }),
    }));
    if (definicao.alturas.length > 1) {
      entradas.push("separador", {
        rotulo: item.altura === "alto" ? "Altura normal" : "Deixar alto (duas linhas)",
        icone: "altura",
        executar: () => this.alterarItem(id, { altura: item.altura === "alto" ? "normal" : "alto" }),
      });
    }
    entradas.push(
      "separador",
      { rotulo: "Mover para o início", icone: "chevrons-esquerda", executar: () => this.atualizar(moverItem(this.layout, id, 0)) },
      { rotulo: "Mover para o fim", icone: "chevrons-direita", executar: () => this.atualizar(moverItem(this.layout, id, this.layout.length)) },
    );
    abrirMenuAcoes(origem, entradas);
  }

  private focarAlca(id: string): void {
    requestAnimationFrame(() => this.cartao(id)?.querySelector<HTMLElement>("[data-edicao='mover']")?.focus());
  }

  private ligarEventos(): void {
    const { grade, barra } = this.opcoes;

    grade.addEventListener("click", (evento) => {
      if (!this.editando) return;
      const botao = (evento.target as Element).closest<HTMLElement>("[data-edicao]");
      if (!botao) return;
      const id = botao.dataset.id ?? "";
      if (botao.dataset.edicao === "ocultar") {
        const visiveis = this.layout.filter((item) => !item.oculto).length;
        if (visiveis <= 1) {
          avisar({ tipo: "info", titulo: "Deixe pelo menos um cartão", texto: "A visão geral precisa de um cartão visível." });
          return;
        }
        this.alterarItem(id, { oculto: true });
        barra.querySelector<HTMLElement>(`[data-barra-acao="mostrar"][data-id="${id}"]`)?.focus();
      } else if (botao.dataset.edicao === "tamanho") {
        this.menuTamanho(botao, id);
      }
    });

    grade.addEventListener("keydown", (evento) => {
      if (!this.editando) return;
      const alca = (evento.target as Element).closest<HTMLElement>("[data-edicao='mover']");
      if (!alca) return;
      const passos: Record<string, number> = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };
      const passo = passos[evento.key];
      const id = alca.dataset.id ?? "";
      if (passo) {
        evento.preventDefault();
        this.atualizar(moverEntreVisiveis(this.layout, id, passo));
        this.focarAlca(id);
      } else if (evento.key === "Home" || evento.key === "End") {
        evento.preventDefault();
        this.atualizar(moverItem(this.layout, id, evento.key === "Home" ? 0 : this.layout.length));
        this.focarAlca(id);
      }
    });

    grade.addEventListener("dragstart", (evento) => {
      if (!this.editando) return;
      const cartao = (evento.target as Element).closest<HTMLElement>("[data-cartao]");
      if (!cartao) return;
      this.arrastando = cartao.dataset.cartao ?? null;
      cartao.dataset.arrastando = "true";
      evento.dataTransfer?.setData("text/plain", this.arrastando ?? "");
      if (evento.dataTransfer) evento.dataTransfer.effectAllowed = "move";
    });

    grade.addEventListener("dragover", (evento) => {
      if (!this.editando || !this.arrastando) return;
      evento.preventDefault();
      if (evento.dataTransfer) evento.dataTransfer.dropEffect = "move";
      const alvo = (evento.target as Element).closest<HTMLElement>("[data-cartao]");
      const idAlvo = alvo?.dataset.cartao;
      if (!alvo || !idAlvo || idAlvo === this.arrastando) return;
      const retangulo = alvo.getBoundingClientRect();
      const depois = evento.clientX > retangulo.left + retangulo.width / 2;
      const semArrastado = this.layout.filter((item) => item.id !== this.arrastando);
      const indiceAlvo = semArrastado.findIndex((item) => item.id === idAlvo) + (depois ? 1 : 0);
      const atual = this.layout.findIndex((item) => item.id === this.arrastando);
      const novo = moverItem(this.layout, this.arrastando, indiceAlvo);
      if (novo.findIndex((item) => item.id === this.arrastando) === atual) return;
      this.atualizar(novo);
    });

    grade.addEventListener("drop", (evento) => {
      if (this.editando) evento.preventDefault();
    });

    grade.addEventListener("dragend", () => {
      if (!this.arrastando) return;
      const cartao = this.cartao(this.arrastando);
      if (cartao) delete cartao.dataset.arrastando;
      this.arrastando = null;
      this.renderizarBarra();
    });

    barra.addEventListener("click", (evento) => {
      const botao = (evento.target as Element).closest<HTMLElement>("[data-barra-acao]");
      if (!botao || botao instanceof HTMLSelectElement) return;
      const acao = botao.dataset.barraAcao;
      if (acao === "mostrar") {
        const id = botao.dataset.id ?? "";
        this.alterarItem(id, { oculto: false });
        this.focarAlca(id);
        requestAnimationFrame(() => this.cartao(id)?.scrollIntoView({ block: "nearest", behavior: movimentoReduzido() ? "auto" : "smooth" }));
      } else if (acao === "restaurar") {
        this.atualizar(layoutPadrao(this.opcoes.definicoes));
      } else if (acao === "cancelar") {
        void this.sair(false);
      } else if (acao === "salvar") {
        void this.sair(true);
      }
    });

    barra.addEventListener("change", (evento) => {
      const seletor = evento.target as HTMLSelectElement;
      if (seletor.dataset.barraAcao !== "modelo" || !seletor.value) return;
      const modelo = this.opcoes.modelos.find((item) => item.id === seletor.value);
      if (modelo) this.atualizar(aplicarModelo(this.opcoes.definicoes, modelo));
    });

    document.addEventListener(
      "keydown",
      (evento) => {
        if (!this.editando || evento.key !== "Escape" || document.querySelector("dialog[open], .menu[data-aberto=\"true\"]")) return;
        void this.sair(false);
      },
      { capture: true },
    );

    window.addEventListener("beforeunload", (evento) => {
      if (this.editando && !iguaisLayouts(this.layout, this.original)) evento.preventDefault();
    });
  }
}

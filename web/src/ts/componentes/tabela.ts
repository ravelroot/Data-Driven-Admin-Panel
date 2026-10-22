import { html, atrasar, type Atrasada, type Marcacao } from "../nucleo/dom.ts";
import { icone } from "../nucleo/icones.ts";
import { numero } from "../nucleo/formato.ts";
import { mensagemDeErro } from "../nucleo/api.ts";
import { abrirMenuAcoes, type EntradaMenu } from "./menu-suspenso.ts";
import type { Pagina } from "../nucleo/tipos.ts";

const TAMANHOS = [10, 25, 50, 100];

export type Direcao = "asc" | "desc";

export interface ColunaTabela<T> {
  campo: string;
  titulo: string;
  ordenavel?: boolean;
  oculto?: boolean;
  classe?: string;
  largura?: string;
  direcaoInicial?: Direcao;
  render?: (item: T) => unknown;
}

export interface VazioTabela {
  icone?: string;
  titulo: string;
  texto: string;
}

export type ValorFiltro = string | number | boolean;

export interface ParametrosTabela {
  pagina: number;
  porPagina: number;
  ordenar: string | null;
  direcao: Direcao;
  q: string;
  [filtro: string]: ValorFiltro | null;
}

export interface OpcoesTabela<T, R extends Pagina<T> = Pagina<T>> {
  colunas: ColunaTabela<T>[];
  buscar: (parametros: ParametrosTabela, sinal: AbortSignal) => Promise<R>;
  chave?: string;
  porPagina?: number;
  selecionavel?: boolean;
  legenda?: string;
  classeTabela?: string;
  vazio?: VazioTabela;
  ordenacao?: { campo: string; direcao?: Direcao };
  filtros?: Record<string, ValorFiltro>;
  acoesLinha?: (item: T) => EntradaMenu[];
  aoClicarLinha?: (item: T) => void;
  aoSelecionar?: (ids: string[]) => void;
  aoCarregar?: (resposta: R) => void;
}

type OpcoesCompletas<T, R extends Pagina<T>> = OpcoesTabela<T, R> & { chave: string; porPagina: number; selecionavel: boolean; vazio: VazioTabela };

export interface EstadoTabela {
  pagina: number;
  porPagina: number;
  ordenar: string | null;
  direcao: Direcao;
  q: string;
  filtros: Record<string, ValorFiltro>;
}

type ItemPagina = number | "…";

const paginasVisiveis = (atual: number, total: number): ItemPagina[] => {
  if (total <= 7) return Array.from({ length: total }, (_, indice) => indice + 1);
  const paginas = new Set([1, total, atual, atual - 1, atual + 1]);
  if (atual <= 3) [2, 3, 4].forEach((pagina) => paginas.add(pagina));
  if (atual >= total - 2) [total - 1, total - 2, total - 3].forEach((pagina) => paginas.add(pagina));
  const ordenadas = [...paginas].filter((pagina) => pagina >= 1 && pagina <= total).sort((a, b) => a - b);
  const resultado: ItemPagina[] = [];
  ordenadas.forEach((pagina, indice) => {
    if (indice && pagina - ordenadas[indice - 1] > 1) resultado.push("…");
    resultado.push(pagina);
  });
  return resultado;
};

export class TabelaDados<T = any, R extends Pagina<T> = Pagina<T>> {
  readonly raiz: HTMLElement;
  readonly opcoes: OpcoesCompletas<T, R>;
  readonly estado: EstadoTabela;
  itens: T[];
  resposta: R | null;
  readonly selecionados: Set<string>;
  private controlador: AbortController | null;
  private readonly buscarAtrasado: Atrasada<[]>;
  private corpo!: HTMLTableSectionElement;
  private moldura!: HTMLElement;
  private rodape!: HTMLElement;
  private barraSelecao: HTMLElement | null = null;

  constructor(raiz: HTMLElement | null, opcoes: OpcoesTabela<T, R>) {
    if (!raiz) throw new Error("Elemento da tabela não encontrado");
    this.raiz = raiz;
    this.opcoes = {
      chave: "id",
      porPagina: 10,
      selecionavel: false,
      vazio: { titulo: "Nada por aqui", texto: "Nenhum registro corresponde aos filtros." },
      ...opcoes,
    };
    this.estado = {
      pagina: 1,
      porPagina: this.opcoes.porPagina,
      ordenar: this.opcoes.ordenacao?.campo ?? null,
      direcao: this.opcoes.ordenacao?.direcao ?? "desc",
      q: "",
      filtros: { ...(this.opcoes.filtros ?? {}) },
    };
    this.itens = [];
    this.resposta = null;
    this.selecionados = new Set();
    this.controlador = null;
    this.buscarAtrasado = atrasar(() => {
      void this.recarregar({ voltarInicio: true });
    }, 320);
    this.montar();
  }

  private chaveDe(item: T): string {
    return String((item as Record<string, unknown>)[this.opcoes.chave]);
  }

  private montar(): void {
    const { colunas, selecionavel } = this.opcoes;
    this.raiz.innerHTML = String(html`
      <div class="tabela-selecao-barra" data-selecao hidden>
        <strong data-selecao-total>0 selecionados</strong>
        <div class="barra-ferramentas" data-selecao-acoes></div>
        <button type="button" class="botao botao-fantasma botao-pequeno ml-auto" data-limpar-selecao>Limpar seleção</button>
      </div>
      <div class="tabela-moldura">
        <table class="tabela ${this.opcoes.classeTabela ?? ""}">
          ${this.opcoes.legenda ? html`<caption class="sr-only">${this.opcoes.legenda}</caption>` : ""}
          <thead>
            <tr>
              ${selecionavel ? html`<th scope="col" class="celula-selecao"><input type="checkbox" class="caixa-marcacao" data-selecionar-todos aria-label="Selecionar todos desta página"></th>` : ""}
              ${colunas.map(
                (coluna) => html`<th scope="col" class="${coluna.classe ?? ""}" ${coluna.largura ? html`style="width:${coluna.largura}"` : ""} data-campo="${coluna.campo}">
                  ${coluna.ordenavel
                    ? html`<button type="button" class="tabela-ordenavel" data-ordenar="${coluna.campo}">${coluna.titulo}${html([icone("seta-cima", "tabela-ordem-icone")])}</button>`
                    : coluna.oculto
                      ? html`<span class="sr-only">${coluna.titulo}</span>`
                      : coluna.titulo}
                </th>`,
              )}
            </tr>
          </thead>
          <tbody data-corpo></tbody>
        </table>
      </div>
      <div class="tabela-rodape" data-rodape></div>
    `);

    this.corpo = this.raiz.querySelector<HTMLTableSectionElement>("[data-corpo]") as HTMLTableSectionElement;
    this.moldura = this.raiz.querySelector<HTMLElement>(".tabela-moldura") as HTMLElement;
    this.rodape = this.raiz.querySelector<HTMLElement>("[data-rodape]") as HTMLElement;
    this.barraSelecao = this.raiz.querySelector<HTMLElement>("[data-selecao]");

    this.raiz.querySelectorAll<HTMLElement>("[data-ordenar]").forEach((botao) => {
      botao.addEventListener("click", () => this.ordenarPor(botao.dataset.ordenar ?? ""));
    });

    this.raiz.querySelector<HTMLInputElement>("[data-selecionar-todos]")?.addEventListener("change", (evento) => {
      const marcado = (evento.target as HTMLInputElement).checked;
      for (const item of this.itens) {
        const chave = this.chaveDe(item);
        if (marcado) this.selecionados.add(chave);
        else this.selecionados.delete(chave);
      }
      this.atualizarSelecao();
    });

    this.raiz.querySelector("[data-limpar-selecao]")?.addEventListener("click", () => this.limparSelecao());

    this.corpo.addEventListener("change", (evento) => {
      const caixa = (evento.target as Element | null)?.closest<HTMLInputElement>("[data-selecionar]");
      if (!caixa) return;
      const id = caixa.dataset.selecionar ?? "";
      if (caixa.checked) this.selecionados.add(id);
      else this.selecionados.delete(id);
      this.atualizarSelecao();
    });

    this.corpo.addEventListener("click", (evento) => {
      const alvo = evento.target as Element | null;
      const botaoAcoes = alvo?.closest<HTMLElement>("[data-acoes-linha]");
      if (botaoAcoes) {
        evento.stopPropagation();
        const item = this.itens.find((registro) => this.chaveDe(registro) === botaoAcoes.dataset.acoesLinha);
        if (item && this.opcoes.acoesLinha) abrirMenuAcoes(botaoAcoes, this.opcoes.acoesLinha(item));
        return;
      }
      if (alvo?.closest("a, button, input, label")) return;
      const linha = alvo?.closest<HTMLElement>("tr[data-chave]");
      if (linha && this.opcoes.aoClicarLinha) {
        const item = this.itens.find((registro) => this.chaveDe(registro) === linha.dataset.chave);
        if (item) this.opcoes.aoClicarLinha(item);
      }
    });

    this.corpo.addEventListener("keydown", (evento) => {
      if (evento.key !== "Enter" || !this.opcoes.aoClicarLinha) return;
      const linha = (evento.target as Element | null)?.closest<HTMLElement>("tr[data-chave]");
      if (!linha || evento.target !== linha) return;
      const item = this.itens.find((registro) => this.chaveDe(registro) === linha.dataset.chave);
      if (item) this.opcoes.aoClicarLinha(item);
    });

    this.rodape.addEventListener("click", (evento) => {
      const botao = (evento.target as Element | null)?.closest<HTMLButtonElement>("[data-pagina]");
      if (!botao || botao.disabled) return;
      this.irParaPagina(Number(botao.dataset.pagina));
    });

    this.rodape.addEventListener("change", (evento) => {
      const alvo = evento.target as HTMLSelectElement;
      if (alvo.matches("[data-por-pagina]")) {
        this.estado.porPagina = Number(alvo.value);
        void this.recarregar({ voltarInicio: true });
      }
    });

    this.renderizarCabecalho();
    this.renderizarEsqueleto();
  }

  private renderizarCabecalho(): void {
    this.raiz.querySelectorAll<HTMLElement>("thead th[data-campo]").forEach((th) => {
      const ativo = th.dataset.campo === this.estado.ordenar;
      if (th.querySelector("[data-ordenar]")) th.setAttribute("aria-sort", ativo ? (this.estado.direcao === "asc" ? "ascending" : "descending") : "none");
    });
  }

  private renderizarEsqueleto(): void {
    const colunas = this.opcoes.colunas.length + (this.opcoes.selecionavel ? 1 : 0);
    const linhas = Math.min(this.estado.porPagina, 8);
    this.corpo.innerHTML = Array.from({ length: linhas }, () => `<tr class="tabela-esqueleto">${"<td></td>".repeat(colunas)}</tr>`).join("");
  }

  private renderizarLinhas(): void {
    const { colunas, selecionavel, chave, aoClicarLinha, vazio } = this.opcoes;
    const totalColunas = colunas.length + (selecionavel ? 1 : 0);
    if (!this.itens.length) {
      this.corpo.innerHTML = String(html`
        <tr class="tabela-vazia">
          <td colspan="${totalColunas}">
            <div class="vazio vazio-compacto">
              <span class="vazio-icone">${html([icone(vazio.icone ?? "caixa")])}</span>
              <p class="vazio-titulo">${vazio.titulo}</p>
              <p class="vazio-texto">${vazio.texto}</p>
            </div>
          </td>
        </tr>
      `);
      return;
    }
    this.corpo.innerHTML = String(
      html`${this.itens.map((item) => {
        const id = String((item as Record<string, unknown>)[chave]);
        const selecionado = this.selecionados.has(id);
        return html`<tr data-chave="${id}" ${aoClicarLinha ? html`data-clicavel="true" tabindex="0"` : ""} data-selecionada="${selecionado}" ${(item as { __nova?: boolean }).__nova ? html`data-nova="true"` : ""}>
          ${selecionavel
            ? html`<td class="celula-selecao"><input type="checkbox" class="caixa-marcacao" data-selecionar="${id}" ${selecionado ? "checked" : ""} aria-label="Selecionar linha"></td>`
            : ""}
          ${colunas.map((coluna) => html`<td class="${coluna.classe ?? ""}">${coluna.render ? coluna.render(item) : (item as Record<string, unknown>)[coluna.campo]}</td>`)}
        </tr>`;
      })}`,
    );
  }

  private renderizarRodape(): void {
    const { total = 0, pagina = 1, paginas = 1, porPagina = this.estado.porPagina } = this.resposta ?? ({} as Partial<Pagina<T>>);
    const inicio = total ? (pagina - 1) * porPagina + 1 : 0;
    const fim = Math.min(total, pagina * porPagina);
    this.rodape.innerHTML = String(html`
      <nav class="paginacao" aria-label="Paginação">
        <p class="paginacao-info"><strong>${numero(inicio)}–${numero(fim)}</strong> de <strong>${numero(total)}</strong></p>
        <div class="paginacao-lado">
          <label class="paginacao-tamanho">Por página
            <select class="selecao" data-por-pagina aria-label="Itens por página">
              ${TAMANHOS.map((tamanho) => html`<option value="${tamanho}" ${tamanho === this.estado.porPagina ? "selected" : ""}>${tamanho}</option>`)}
            </select>
          </label>
          <div class="paginacao-controles">
            <button type="button" class="paginacao-botao" data-pagina="${pagina - 1}" ${pagina <= 1 ? "disabled" : ""} aria-label="Página anterior">${html([icone("chevron-esquerda")])}</button>
            <span class="paginacao-movel">${pagina} / ${Math.max(paginas, 1)}</span>
            <span class="paginacao-numeros">
              ${paginasVisiveis(pagina, Math.max(paginas, 1)).map((item) =>
                item === "…"
                  ? html`<span class="paginacao-reticencias">…</span>`
                  : html`<button type="button" class="paginacao-botao" data-pagina="${item}" ${item === pagina ? html`aria-current="page"` : ""}>${item}</button>`,
              )}
            </span>
            <button type="button" class="paginacao-botao" data-pagina="${pagina + 1}" ${pagina >= paginas ? "disabled" : ""} aria-label="Próxima página">${html([icone("chevron-direita")])}</button>
          </div>
        </div>
      </nav>
    `);
  }

  private atualizarSelecao(): void {
    const total = this.selecionados.size;
    if (this.barraSelecao) {
      this.barraSelecao.hidden = total === 0;
      const rotulo = this.barraSelecao.querySelector("[data-selecao-total]");
      if (rotulo) rotulo.textContent = `${numero(total)} ${total === 1 ? "selecionado" : "selecionados"}`;
    }
    const todos = this.raiz.querySelector<HTMLInputElement>("[data-selecionar-todos]");
    if (todos) {
      const naPagina = this.itens.filter((item) => this.selecionados.has(this.chaveDe(item))).length;
      todos.checked = naPagina > 0 && naPagina === this.itens.length;
      todos.indeterminate = naPagina > 0 && naPagina < this.itens.length;
    }
    for (const linha of this.corpo.querySelectorAll<HTMLElement>("tr[data-chave]")) {
      const marcado = this.selecionados.has(linha.dataset.chave ?? "");
      linha.dataset.selecionada = String(marcado);
      const caixa = linha.querySelector<HTMLInputElement>("[data-selecionar]");
      if (caixa) caixa.checked = marcado;
    }
    this.opcoes.aoSelecionar?.([...this.selecionados]);
  }

  definirAcoesSelecao(marcacao: Marcacao): HTMLElement {
    const alvo = this.raiz.querySelector<HTMLElement>("[data-selecao-acoes]") as HTMLElement;
    alvo.innerHTML = String(marcacao);
    return alvo;
  }

  limparSelecao(): void {
    this.selecionados.clear();
    this.atualizarSelecao();
  }

  ordenarPor(campo: string): void {
    if (this.estado.ordenar === campo) this.estado.direcao = this.estado.direcao === "asc" ? "desc" : "asc";
    else {
      this.estado.ordenar = campo;
      this.estado.direcao = this.opcoes.colunas.find((coluna) => coluna.campo === campo)?.direcaoInicial ?? "asc";
    }
    this.renderizarCabecalho();
    void this.recarregar({ voltarInicio: true });
  }

  irParaPagina(pagina: number): void {
    this.estado.pagina = Math.max(1, pagina);
    void this.recarregar();
    this.raiz.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  buscar(texto: string): void {
    this.estado.q = texto.trim();
    this.buscarAtrasado();
  }

  definirFiltro(nome: string, valor: ValorFiltro | null | undefined): void {
    if (valor === "" || valor === null || valor === undefined) delete this.estado.filtros[nome];
    else this.estado.filtros[nome] = valor;
    void this.recarregar({ voltarInicio: true });
  }

  parametros(): ParametrosTabela {
    const { pagina, porPagina, ordenar, direcao, q, filtros } = this.estado;
    return { pagina, porPagina, ordenar, direcao, q, ...filtros };
  }

  async recarregar({ voltarInicio = false, silencioso = false }: { voltarInicio?: boolean; silencioso?: boolean } = {}): Promise<R | null> {
    if (voltarInicio) this.estado.pagina = 1;
    this.controlador?.abort();
    this.controlador = new AbortController();
    if (!silencioso) {
      if (this.resposta) this.moldura.dataset.carregando = "true";
      else this.renderizarEsqueleto();
    }
    try {
      const resposta = await this.opcoes.buscar(this.parametros(), this.controlador.signal);
      this.resposta = resposta;
      this.itens = resposta.itens ?? [];
      if (this.estado.pagina > 1 && !this.itens.length && resposta.total > 0) {
        this.estado.pagina = Math.max(1, resposta.paginas);
        return this.recarregar();
      }
      this.renderizarLinhas();
      this.renderizarRodape();
      this.atualizarSelecao();
      this.opcoes.aoCarregar?.(resposta);
    } catch (erro) {
      if (erro instanceof DOMException && erro.name === "AbortError") return null;
      const colunas = this.opcoes.colunas.length + (this.opcoes.selecionavel ? 1 : 0);
      this.corpo.innerHTML = String(html`
        <tr class="tabela-vazia"><td colspan="${colunas}">
          <div class="vazio vazio-compacto vazio-erro">
            <span class="vazio-icone">${html([icone("alerta")])}</span>
            <p class="vazio-titulo">Não foi possível carregar</p>
            <p class="vazio-texto">${mensagemDeErro(erro)}</p>
            <div class="vazio-acoes"><button type="button" class="botao botao-secundario botao-pequeno" data-tentar>${html([icone("atualizar")])}Tentar de novo</button></div>
          </div>
        </td></tr>
      `);
      this.corpo.querySelector("[data-tentar]")?.addEventListener("click", () => this.recarregar());
    } finally {
      delete this.moldura.dataset.carregando;
    }
    return this.resposta;
  }

  inserirNoTopo(item: T): void {
    if (this.estado.pagina !== 1) return;
    this.itens = [{ ...item, __nova: true } as T, ...this.itens].slice(0, this.estado.porPagina);
    if (this.resposta) this.resposta.total += 1;
    this.renderizarLinhas();
    this.renderizarRodape();
  }
}

export const botaoAcoesLinha = (id: string | number, rotulo = "Ações") =>
  html`<button type="button" class="botao botao-fantasma botao-icone botao-pequeno" data-acoes-linha="${id}" aria-label="${rotulo}" aria-haspopup="menu">${html([icone("mais")])}</button>`;

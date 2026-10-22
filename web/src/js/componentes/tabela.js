import { html, atrasar } from "../nucleo/dom.js";
import { icone } from "../nucleo/icones.js";
import { numero } from "../nucleo/formato.js";
import { mensagemDeErro } from "../nucleo/api.js";
import { abrirMenuAcoes } from "./menu-suspenso.js";

const TAMANHOS = [10, 25, 50, 100];

const paginasVisiveis = (atual, total) => {
  if (total <= 7) return Array.from({ length: total }, (_, indice) => indice + 1);
  const paginas = new Set([1, total, atual, atual - 1, atual + 1]);
  if (atual <= 3) [2, 3, 4].forEach((pagina) => paginas.add(pagina));
  if (atual >= total - 2) [total - 1, total - 2, total - 3].forEach((pagina) => paginas.add(pagina));
  const ordenadas = [...paginas].filter((pagina) => pagina >= 1 && pagina <= total).sort((a, b) => a - b);
  const resultado = [];
  ordenadas.forEach((pagina, indice) => {
    if (indice && pagina - ordenadas[indice - 1] > 1) resultado.push("…");
    resultado.push(pagina);
  });
  return resultado;
};

export class TabelaDados {
  constructor(raiz, opcoes) {
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
    this.buscarAtrasado = atrasar(() => this.recarregar({ voltarInicio: true }), 320);
    this.montar();
  }

  montar() {
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

    this.corpo = this.raiz.querySelector("[data-corpo]");
    this.moldura = this.raiz.querySelector(".tabela-moldura");
    this.rodape = this.raiz.querySelector("[data-rodape]");
    this.barraSelecao = this.raiz.querySelector("[data-selecao]");

    this.raiz.querySelectorAll("[data-ordenar]").forEach((botao) => {
      botao.addEventListener("click", () => this.ordenarPor(botao.dataset.ordenar));
    });

    this.raiz.querySelector("[data-selecionar-todos]")?.addEventListener("change", (evento) => {
      for (const item of this.itens) {
        const chave = String(item[this.opcoes.chave]);
        if (evento.target.checked) this.selecionados.add(chave);
        else this.selecionados.delete(chave);
      }
      this.atualizarSelecao();
    });

    this.raiz.querySelector("[data-limpar-selecao]").addEventListener("click", () => this.limparSelecao());

    this.corpo.addEventListener("change", (evento) => {
      const caixa = evento.target.closest("[data-selecionar]");
      if (!caixa) return;
      if (caixa.checked) this.selecionados.add(caixa.dataset.selecionar);
      else this.selecionados.delete(caixa.dataset.selecionar);
      this.atualizarSelecao();
    });

    this.corpo.addEventListener("click", (evento) => {
      const botaoAcoes = evento.target.closest("[data-acoes-linha]");
      if (botaoAcoes) {
        evento.stopPropagation();
        const item = this.itens.find((registro) => String(registro[this.opcoes.chave]) === botaoAcoes.dataset.acoesLinha);
        if (item) abrirMenuAcoes(botaoAcoes, this.opcoes.acoesLinha(item));
        return;
      }
      if (evento.target.closest("a, button, input, label")) return;
      const linha = evento.target.closest("tr[data-chave]");
      if (linha && this.opcoes.aoClicarLinha) {
        const item = this.itens.find((registro) => String(registro[this.opcoes.chave]) === linha.dataset.chave);
        if (item) this.opcoes.aoClicarLinha(item);
      }
    });

    this.corpo.addEventListener("keydown", (evento) => {
      if (evento.key !== "Enter" || !this.opcoes.aoClicarLinha) return;
      const linha = evento.target.closest("tr[data-chave]");
      if (!linha || evento.target !== linha) return;
      const item = this.itens.find((registro) => String(registro[this.opcoes.chave]) === linha.dataset.chave);
      if (item) this.opcoes.aoClicarLinha(item);
    });

    this.rodape.addEventListener("click", (evento) => {
      const botao = evento.target.closest("[data-pagina]");
      if (!botao || botao.disabled) return;
      this.irParaPagina(Number(botao.dataset.pagina));
    });

    this.rodape.addEventListener("change", (evento) => {
      if (evento.target.matches("[data-por-pagina]")) {
        this.estado.porPagina = Number(evento.target.value);
        this.recarregar({ voltarInicio: true });
      }
    });

    this.renderizarCabecalho();
    this.renderizarEsqueleto();
  }

  renderizarCabecalho() {
    this.raiz.querySelectorAll("thead th[data-campo]").forEach((th) => {
      const ativo = th.dataset.campo === this.estado.ordenar;
      if (th.querySelector("[data-ordenar]")) th.setAttribute("aria-sort", ativo ? (this.estado.direcao === "asc" ? "ascending" : "descending") : "none");
    });
  }

  renderizarEsqueleto() {
    const colunas = this.opcoes.colunas.length + (this.opcoes.selecionavel ? 1 : 0);
    const linhas = Math.min(this.estado.porPagina, 8);
    this.corpo.innerHTML = Array.from({ length: linhas }, () => `<tr class="tabela-esqueleto">${"<td></td>".repeat(colunas)}</tr>`).join("");
  }

  renderizarLinhas() {
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
        const id = String(item[chave]);
        const selecionado = this.selecionados.has(id);
        return html`<tr data-chave="${id}" ${aoClicarLinha ? html`data-clicavel="true" tabindex="0"` : ""} data-selecionada="${selecionado}" ${item.__nova ? html`data-nova="true"` : ""}>
          ${selecionavel
            ? html`<td class="celula-selecao"><input type="checkbox" class="caixa-marcacao" data-selecionar="${id}" ${selecionado ? "checked" : ""} aria-label="Selecionar linha"></td>`
            : ""}
          ${colunas.map((coluna) => html`<td class="${coluna.classe ?? ""}">${coluna.render ? coluna.render(item) : item[coluna.campo]}</td>`)}
        </tr>`;
      })}`,
    );
  }

  renderizarRodape() {
    const { total = 0, pagina = 1, paginas = 1, porPagina = this.estado.porPagina } = this.resposta ?? {};
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

  atualizarSelecao() {
    const total = this.selecionados.size;
    if (this.barraSelecao) {
      this.barraSelecao.hidden = total === 0;
      this.barraSelecao.querySelector("[data-selecao-total]").textContent = `${numero(total)} ${total === 1 ? "selecionado" : "selecionados"}`;
    }
    const todos = this.raiz.querySelector("[data-selecionar-todos]");
    if (todos) {
      const naPagina = this.itens.filter((item) => this.selecionados.has(String(item[this.opcoes.chave]))).length;
      todos.checked = naPagina > 0 && naPagina === this.itens.length;
      todos.indeterminate = naPagina > 0 && naPagina < this.itens.length;
    }
    for (const linha of this.corpo.querySelectorAll("tr[data-chave]")) {
      const marcado = this.selecionados.has(linha.dataset.chave);
      linha.dataset.selecionada = String(marcado);
      const caixa = linha.querySelector("[data-selecionar]");
      if (caixa) caixa.checked = marcado;
    }
    this.opcoes.aoSelecionar?.([...this.selecionados]);
  }

  definirAcoesSelecao(marcacao) {
    const alvo = this.raiz.querySelector("[data-selecao-acoes]");
    alvo.innerHTML = String(marcacao);
    return alvo;
  }

  limparSelecao() {
    this.selecionados.clear();
    this.atualizarSelecao();
  }

  ordenarPor(campo) {
    if (this.estado.ordenar === campo) this.estado.direcao = this.estado.direcao === "asc" ? "desc" : "asc";
    else {
      this.estado.ordenar = campo;
      this.estado.direcao = this.opcoes.colunas.find((coluna) => coluna.campo === campo)?.direcaoInicial ?? "asc";
    }
    this.renderizarCabecalho();
    this.recarregar({ voltarInicio: true });
  }

  irParaPagina(pagina) {
    this.estado.pagina = Math.max(1, pagina);
    this.recarregar();
    this.raiz.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  buscar(texto) {
    this.estado.q = texto.trim();
    this.buscarAtrasado();
  }

  definirFiltro(nome, valor) {
    if (valor === "" || valor === null || valor === undefined) delete this.estado.filtros[nome];
    else this.estado.filtros[nome] = valor;
    this.recarregar({ voltarInicio: true });
  }

  parametros() {
    const { pagina, porPagina, ordenar, direcao, q, filtros } = this.estado;
    return { pagina, porPagina, ordenar, direcao, q, ...filtros };
  }

  async recarregar({ voltarInicio = false, silencioso = false } = {}) {
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
      if (erro?.name === "AbortError") return;
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

  inserirNoTopo(item) {
    if (this.estado.pagina !== 1) return;
    this.itens = [{ ...item, __nova: true }, ...this.itens].slice(0, this.estado.porPagina);
    if (this.resposta) this.resposta.total += 1;
    this.renderizarLinhas();
    this.renderizarRodape();
  }
}

export const botaoAcoesLinha = (id, rotulo = "Ações") =>
  html`<button type="button" class="botao botao-fantasma botao-icone botao-pequeno" data-acoes-linha="${id}" aria-label="${rotulo}" aria-haspopup="menu">${html([icone("mais")])}</button>`;

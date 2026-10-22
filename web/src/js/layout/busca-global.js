import { html, criar, atrasar, escapar } from "../nucleo/dom.js";
import { icone } from "../nucleo/icones.js";
import { api } from "../nucleo/api.js";
import { pode, sair } from "../nucleo/sessao.js";
import { alternarTema } from "../nucleo/tema.js";
import { moeda, rotulos } from "../nucleo/formato.js";
import { NAVEGACAO, ACOES_RAPIDAS } from "./navegacao.js";

let dialogo = null;
let resultados = [];
let indiceAtivo = 0;
let controlador = null;

const normalizar = (texto) =>
  String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const destacar = (texto, termo) => {
  const seguroTexto = escapar(texto);
  if (!termo) return seguroTexto;
  const indice = normalizar(texto).indexOf(normalizar(termo));
  if (indice < 0) return seguroTexto;
  return `${escapar(texto.slice(0, indice))}<mark>${escapar(texto.slice(indice, indice + termo.length))}</mark>${escapar(texto.slice(indice + termo.length))}`;
};

const executar = (item) => {
  fechar();
  if (item.acao === "alternar-tema") alternarTema();
  else if (item.acao === "sair") sair();
  else if (item.externo) window.open(item.href, "_blank", "noopener");
  else if (item.href) location.href = item.href;
};

const renderizar = (termo, remotos = null, carregandoRemoto = false) => {
  const filtro = normalizar(termo);
  const paginas = NAVEGACAO.flatMap((grupo) => grupo.itens)
    .filter((item) => pode(item.permissao))
    .filter((item) => !filtro || normalizar(`${item.rotulo} ${item.descricao}`).includes(filtro));
  const acoes = ACOES_RAPIDAS.filter((item) => pode(item.permissao)).filter((item) => !filtro || normalizar(item.rotulo).includes(filtro));

  const grupos = [];
  if (remotos?.usuarios?.length) {
    grupos.push({
      titulo: "Usuários",
      itens: remotos.usuarios.map((usuario) => ({
        icone: "usuario",
        titulo: usuario.nome,
        detalhe: usuario.email,
        lado: rotulos.status[usuario.status] ?? "",
        href: `/usuarios?usuario=${encodeURIComponent(usuario.id)}`,
      })),
    });
  }
  if (remotos?.transacoes?.length) {
    grupos.push({
      titulo: "Transações",
      itens: remotos.transacoes.map((transacao) => ({
        icone: "recibo",
        titulo: transacao.codigo,
        detalhe: transacao.usuario?.nome ?? "",
        lado: moeda(transacao.valor),
        href: `/?transacao=${encodeURIComponent(transacao.id)}`,
      })),
    });
  }
  if (paginas.length) grupos.push({ titulo: "Páginas", itens: paginas.map((item) => ({ ...item, titulo: item.rotulo, detalhe: item.descricao })) });
  if (acoes.length) grupos.push({ titulo: "Ações", itens: acoes.map((item) => ({ ...item, titulo: item.rotulo })) });

  resultados = grupos.flatMap((grupo) => grupo.itens);
  indiceAtivo = Math.min(indiceAtivo, Math.max(0, resultados.length - 1));
  const lista = dialogo.querySelector("[data-resultados]");

  if (!resultados.length) {
    lista.innerHTML = String(html`
      <div class="paleta-vazio">
        ${html([icone(carregandoRemoto ? "relogio" : "buscar")])}
        <p>${carregandoRemoto ? "Buscando…" : html`Nada encontrado para <strong>“${termo}”</strong>.`}</p>
      </div>
    `);
    return;
  }

  let posicao = -1;
  lista.innerHTML = String(html`
    ${grupos.map(
      (grupo) => html`<div class="paleta-grupo" role="group" aria-label="${grupo.titulo}">
        <p class="paleta-grupo-titulo">${grupo.titulo}</p>
        ${grupo.itens.map((item) => {
          posicao += 1;
          return html`<button type="button" class="paleta-item" role="option" id="paleta-opcao-${posicao}" data-indice="${posicao}" aria-selected="${posicao === indiceAtivo}">
            <span class="paleta-item-icone">${html([icone(item.icone)])}</span>
            <span class="paleta-item-textos">
              <span class="paleta-item-titulo">${html([destacar(item.titulo, termo)])}</span>
              ${item.detalhe ? html`<span class="paleta-item-detalhe">${html([destacar(item.detalhe, termo)])}</span>` : ""}
            </span>
            ${item.lado ? html`<span class="paleta-item-lado">${item.lado}</span>` : ""}
            ${item.externo ? html([icone("externo", "size-4 text-neutra-400")]) : ""}
          </button>`;
        })}
      </div>`,
    )}
    ${carregandoRemoto ? html`<p class="paleta-grupo-titulo">Buscando usuários e transações…</p>` : ""}
  `);
  dialogo.querySelector("[data-entrada]").setAttribute("aria-activedescendant", `paleta-opcao-${indiceAtivo}`);
};

const moverSelecao = (passo) => {
  if (!resultados.length) return;
  indiceAtivo = (indiceAtivo + passo + resultados.length) % resultados.length;
  for (const botao of dialogo.querySelectorAll(".paleta-item")) {
    const ativo = Number(botao.dataset.indice) === indiceAtivo;
    botao.setAttribute("aria-selected", String(ativo));
    if (ativo) botao.scrollIntoView({ block: "nearest" });
  }
  dialogo.querySelector("[data-entrada]").setAttribute("aria-activedescendant", `paleta-opcao-${indiceAtivo}`);
};

const buscarRemoto = atrasar(async (termo) => {
  controlador?.abort();
  if (termo.trim().length < 2 || !pode("painel.ver")) return;
  controlador = new AbortController();
  renderizar(termo, null, true);
  try {
    const remotos = await api.obter("/busca", { q: termo.trim() }, { sinal: controlador.signal });
    if (dialogo?.open && dialogo.querySelector("[data-entrada]").value === termo) renderizar(termo, remotos);
  } catch (erro) {
    if (erro?.name !== "AbortError") renderizar(termo);
  }
}, 220);

const criarDialogo = () => {
  dialogo = criar(html`
    <dialog class="paleta-comandos" aria-label="Busca global">
      <div class="paleta-entrada-caixa">
        ${html([icone("buscar")])}
        <input class="paleta-entrada" type="search" data-entrada placeholder="Buscar páginas, usuários, transações…" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="paleta-resultados" aria-autocomplete="list">
        <span class="tecla">Esc</span>
      </div>
      <div class="paleta-resultados" id="paleta-resultados" role="listbox" data-resultados></div>
      <div class="paleta-rodape">
        <span><span class="tecla">↑</span><span class="tecla">↓</span> navegar</span>
        <span><span class="tecla">↵</span> abrir</span>
        <span><span class="tecla">Ctrl</span><span class="tecla">K</span> abrir de qualquer página</span>
      </div>
    </dialog>
  `);
  document.body.append(dialogo);
  const entrada = dialogo.querySelector("[data-entrada]");
  entrada.addEventListener("input", () => {
    indiceAtivo = 0;
    renderizar(entrada.value);
    buscarRemoto(entrada.value);
  });
  entrada.addEventListener("keydown", (evento) => {
    if (evento.key === "ArrowDown") {
      evento.preventDefault();
      moverSelecao(1);
    } else if (evento.key === "ArrowUp") {
      evento.preventDefault();
      moverSelecao(-1);
    } else if (evento.key === "Enter") {
      evento.preventDefault();
      if (resultados[indiceAtivo]) executar(resultados[indiceAtivo]);
    } else if (evento.key === "Escape") {
      evento.preventDefault();
      fechar();
    }
  });
  dialogo.querySelector("[data-resultados]").addEventListener("click", (evento) => {
    const botao = evento.target.closest(".paleta-item");
    if (botao) executar(resultados[Number(botao.dataset.indice)]);
  });
  dialogo.addEventListener("click", (evento) => {
    if (evento.target === dialogo) fechar();
  });
};

export const abrirBusca = (termoInicial = "") => {
  if (!dialogo) criarDialogo();
  if (dialogo.open) return;
  const entrada = dialogo.querySelector("[data-entrada]");
  entrada.value = termoInicial;
  indiceAtivo = 0;
  renderizar(termoInicial);
  dialogo.showModal();
  entrada.focus();
};

export const fechar = () => {
  controlador?.abort();
  if (dialogo?.open) dialogo.close();
};

export const iniciarAtalhosBusca = () => {
  document.addEventListener("keydown", (evento) => {
    const editando = evento.target.closest?.("input, textarea, select, [contenteditable='true']");
    if ((evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === "k") {
      evento.preventDefault();
      abrirBusca();
    } else if (evento.key === "/" && !editando) {
      evento.preventDefault();
      abrirBusca();
    }
  });
};

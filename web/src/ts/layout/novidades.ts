import { html } from "../nucleo/dom.ts";
import { icone } from "../nucleo/icones.ts";
import { gravar, ler } from "../nucleo/armazenamento.ts";
import { pode } from "../nucleo/sessao.ts";

export interface Novidade {
  icone: string;
  titulo: string;
  texto: string;
  href?: string;
  permissao?: string;
}

export const VERSAO_NOVIDADES = "1.6.0";

export const NOVIDADES: Novidade[] = [
  {
    icone: "lampada",
    titulo: "Inteligência com Python",
    texto: "Uma página nova reúne previsões, risco de cancelamento, segmentos, coortes, LTV e qualidade dos dados, calculados por um motor analítico em Python.",
    href: "/inteligencia",
    permissao: "analytics.ver",
  },
  {
    icone: "previsao",
    titulo: "Previsões com faixa de confiança",
    texto: "Receita, pagamentos, cadastros, conversões e visitantes projetados para 30 dias com Holt-Winters, e o MRR para 6 meses. Cada modelo mostra o quanto acertou no teste.",
    href: "/inteligencia",
    permissao: "analytics.ver",
  },
  {
    icone: "escudo-alerta",
    titulo: "Quem pode cancelar",
    texto: "Um modelo de machine learning aponta os clientes com maior chance de cancelar em 30 dias, explica o motivo e sugere a ação.",
    href: "/inteligencia?aba=risco",
    permissao: "analytics.ver",
  },
  {
    icone: "usuarios",
    titulo: "Segmentos RFM e k-means",
    texto: "Clientes agrupados por recência, frequência e valor, com o perfil de cada grupo e o que fazer com ele.",
    href: "/inteligencia?aba=segmentos",
    permissao: "analytics.ver",
  },
  {
    icone: "ajustes",
    titulo: "Simulador “e se”",
    texto: "Mexa no preço, no churn e na aquisição e veja o MRR, os clientes e o LTV dos próximos meses na hora.",
    href: "/inteligencia?aba=simulador",
    permissao: "analytics.ver",
  },
  {
    icone: "arquivo-planilha",
    titulo: "Excel de verdade",
    texto: "Baixe o relatório de inteligência em .xlsx com gráficos nativos e importe usuários direto de planilhas do Excel, com análise das colunas e dos problemas.",
    href: "/inteligencia?excel=1",
    permissao: "relatorios.gerar",
  },
];

let dialogo: HTMLDialogElement | null = null;

export const abrirNovidades = (): void => {
  if (dialogo?.open) return;
  dialogo?.remove();
  const itens = NOVIDADES.filter((item) => pode(item.permissao));
  const marcacao = html`
    <dialog class="modal modal-largo novidades" aria-labelledby="versao-titulo">
      <div class="modal-conteudo">
        <div class="modal-topo">
          <div class="modal-textos">
            <p class="versao-rotulo">Versão ${VERSAO_NOVIDADES}</p>
            <h2 class="modal-titulo" id="versao-titulo">O que há de novo no Bento</h2>
            <p class="modal-texto">Um motor analítico em Python com previsões, risco de cancelamento, segmentos e Excel. Esta janela aparece uma vez por versão.</p>
          </div>
        </div>
        <ul class="versao-lista" role="list" tabindex="-1">
          ${itens.map(
            (item) => html`<li class="versao-item">
              <span class="versao-icone">${html([icone(item.icone)])}</span>
              <div class="versao-texto">
                <p class="versao-titulo">${item.titulo}</p>
                <p class="versao-descricao">${item.texto}</p>
              </div>
              ${item.href ? html`<a class="botao botao-fantasma botao-pequeno" href="${item.href}">Ver${html([icone("chevron-direita")])}</a>` : ""}
            </li>`,
          )}
        </ul>
      </div>
      <div class="modal-acoes">
        <button type="button" class="botao botao-primario" data-fechar-novidades autofocus>Entendi</button>
      </div>
    </dialog>
  `;
  document.body.insertAdjacentHTML("beforeend", String(marcacao));
  const caixa = document.body.lastElementChild as HTMLDialogElement;
  dialogo = caixa;
  caixa.querySelector("[data-fechar-novidades]")?.addEventListener("click", () => caixa.close());
  caixa.addEventListener("click", (evento) => {
    if (evento.target === caixa) caixa.close();
  });
  caixa.addEventListener("close", () => {
    gravar("novidades-vistas", VERSAO_NOVIDADES);
    caixa.remove();
    if (dialogo === caixa) dialogo = null;
  });
  caixa.showModal();
};

export const novidadesPendentes = (): boolean => ler("novidades-vistas") !== VERSAO_NOVIDADES;

export const mostrarNovidadesSeNecessario = (): void => {
  if (!novidadesPendentes() || document.querySelector("dialog[open]")) return;
  window.setTimeout(() => {
    if (!document.querySelector("dialog[open]") && novidadesPendentes()) abrirNovidades();
  }, 900);
};

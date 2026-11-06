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

export const VERSAO_NOVIDADES = "1.5.0";

export const NOVIDADES: Novidade[] = [
  {
    icone: "escudo-ok",
    titulo: "Verificação em duas etapas",
    texto: "Depois da senha, o painel pede o código de um aplicativo autenticador. Dez códigos de recuperação garantem o acesso se o celular sumir.",
    href: "/configuracoes?secao=seguranca",
  },
  {
    icone: "sirene",
    titulo: "Alertas de métricas",
    texto: "Regras sobre receita, falhas de pagamento, reembolsos, cancelamentos e conversão avisam a equipe nas notificações e nas integrações.",
    href: "/alertas",
    permissao: "alertas.ver",
  },
  {
    icone: "previsao",
    titulo: "Previsão do mês",
    texto: "A visão geral projeta a receita até o fim do mês, com a faixa provável e a chance de bater a meta.",
    href: "/",
    permissao: "painel.ver",
  },
  {
    icone: "lampada",
    titulo: "Insights automáticos",
    texto: "Dias fora do padrão em receita, pagamentos, cadastros e conversão aparecem sozinhos, com atalho para investigar e criar um alerta.",
    href: "/",
    permissao: "painel.ver",
  },
  {
    icone: "grade",
    titulo: "Visão geral do seu jeito",
    texto: "Em Personalizar, esconda, arraste e redimensione os cartões ou escolha um layout pronto. Fica salvo na sua conta.",
    href: "/?personalizar=1",
    permissao: "painel.ver",
  },
  {
    icone: "escudo",
    titulo: "Regra de segurança da empresa",
    texto: "Administradores podem exigir a verificação em duas etapas por papel em Configurações › Empresa.",
    href: "/configuracoes?secao=sistema",
    permissao: "configuracoes.sistema",
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
            <p class="modal-texto">Segurança, alertas, previsão e uma visão geral sob medida. Esta janela aparece uma vez por versão.</p>
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

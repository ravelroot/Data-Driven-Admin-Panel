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

export const VERSAO_NOVIDADES = "1.7.0";

export const NOVIDADES: Novidade[] = [
  {
    icone: "foguete",
    titulo: "Comece com os seus dados em um passo",
    texto: "Quando quiser sair da demonstração, o Bento grava um backup, apaga os exemplos e coloca a sua conta no lugar. Sem mexer no .env.",
    href: "/configuracoes?secao=sistema&comecar=1",
    permissao: "configuracoes.sistema",
  },
  {
    icone: "ajustes",
    titulo: "Operação ajustada pelo painel",
    texto: "Backup automático, quantas cópias guardar, prazos de retenção e o simulador agora mudam em Configurações › Manutenção e valem na hora, para todas as instâncias.",
    href: "/configuracoes?secao=manutencao",
    permissao: "configuracoes.sistema",
  },
  {
    icone: "integracao",
    titulo: "Teams, Google Chat e Telegram",
    texto: "Três integrações novas, cada uma com o passo a passo dentro da tela, e a escolha de quais eventos cada integração recebe.",
    href: "/configuracoes?secao=integracoes",
    permissao: "configuracoes.integracoes",
  },
  {
    icone: "webhook",
    titulo: "Webhook explicado",
    texto: "A tela do webhook mostra o JSON que chega no seu sistema e o código para conferir a assinatura, prontos para copiar.",
    href: "/configuracoes?secao=integracoes",
    permissao: "configuracoes.integracoes",
  },
  {
    icone: "ferramenta",
    titulo: "Atualizar com dois cliques",
    texto: "Os scripts atualizar.cmd e atualizar.sh fazem o backup, completam o .env com as variáveis novas, reconstroem e conferem a instalação.",
  },
  {
    icone: "verificacoes",
    titulo: "Erros de digitação no .env",
    texto: "Uma variável BENTO_ com nome errado vira aviso com a sugestão do nome certo, no log, no diagnóstico e na aba Manutenção.",
    href: "/configuracoes?secao=manutencao",
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
            <p class="modal-texto">Mais fácil de começar, configurar, manter e integrar. Esta janela aparece uma vez por versão.</p>
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

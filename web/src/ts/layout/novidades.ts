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

export const VERSAO_NOVIDADES = "1.4.0";

export const NOVIDADES: Novidade[] = [
  {
    icone: "ajustes",
    titulo: "Preferências de uso",
    texto: "Escolha a página inicial, quantas linhas cada tabela mostra, se as animações ficam reduzidas e se os atalhos de uma tecla ficam ligados.",
    href: "/configuracoes?secao=preferencias",
  },
  {
    icone: "colunas",
    titulo: "Colunas visíveis",
    texto: "Em Usuários, Transações e Auditoria, o botão Colunas no rodapé da tabela esconde o que você não usa. Fica salvo neste navegador.",
  },
  {
    icone: "historico",
    titulo: "Recentes na paleta de comandos",
    texto: "Ctrl + K mostra os últimos usuários e transações que você abriu, para voltar a eles com um Enter.",
  },
  {
    icone: "importar",
    titulo: "Importação de usuários por CSV",
    texto: "Envie uma planilha, veja a prévia linha a linha e só então confirme. Há um modelo pronto para baixar.",
    href: "/usuarios?importar=1",
    permissao: "usuarios.importar",
  },
  {
    icone: "webhook",
    titulo: "Histórico de entregas das integrações",
    texto: "Cada evento enviado fica registrado com o código HTTP e o tempo de resposta. Falhas são reenviadas sozinhas e dá para reenviar na hora.",
    href: "/configuracoes?secao=integracoes",
    permissao: "configuracoes.integracoes",
  },
  {
    icone: "ferramenta",
    titulo: "Manutenção",
    texto: "Verificações do ambiente, modo somente leitura, backups e limpeza de dados antigos em Configurações › Manutenção.",
    href: "/configuracoes?secao=manutencao",
    permissao: "configuracoes.sistema",
  },
  {
    icone: "foguete",
    titulo: "Primeiros passos",
    texto: "A visão geral mostra o que falta para deixar o painel pronto: empresa, senhas, equipe, integrações, relatórios e backups.",
    href: "/",
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
            <p class="modal-texto">Melhorias de uso, configuração e manutenção. Esta janela aparece uma vez por versão.</p>
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

import { html, $, renderizar } from "../nucleo/dom.js";
import { icone, LOGO_BENTO, hidratarIcones } from "../nucleo/icones.js";
import { api } from "../nucleo/api.js";
import { pode, usuarioAtual, sair, sessao } from "../nucleo/sessao.js";
import { alternarTema, aplicarTema, temaAtual, barraRecolhida, definirBarraRecolhida } from "../nucleo/tema.js";
import { ouvir } from "../nucleo/eventos.js";
import { estadoConexao } from "../nucleo/tempo-real.js";
import { iniciais, corAvatar, relativo, numero } from "../nucleo/formato.js";
import { iniciarMenus, fecharTodos } from "../componentes/menu-suspenso.js";
import { avisar } from "../componentes/aviso.js";
import { NAVEGACAO } from "./navegacao.js";
import { abrirBusca, iniciarAtalhosBusca } from "./busca-global.js";

const ROTULOS_PAPEL = { admin: "Administrador", gerente: "Gerente", analista: "Analista", suporte: "Suporte", cliente: "Cliente" };
const ROTULOS_CONEXAO = { conectado: "Ao vivo", conectando: "Conectando…", reconectando: "Reconectando…", desconectado: "Sem conexão" };
const ICONES_CATEGORIA = { transacao: "recibo", usuario: "usuario", sistema: "megafone", seguranca: "escudo", relatorio: "arquivo" };

let naoLidas = 0;

export const avatar = (usuario, tamanho = "") =>
  html`<span class="avatar ${tamanho}" data-cor="${corAvatar(usuario?.email ?? usuario?.nome ?? "")}" aria-hidden="true">${usuario?.iniciais ?? iniciais(usuario?.nome)}</span>`;

const marcacaoBarra = (paginaAtual) => {
  const usuario = usuarioAtual();
  return html`
    <nav class="barra-lateral" aria-label="Menu principal">
      <div class="barra-marca">
        <a href="/" class="flex min-w-0 items-center gap-3" aria-label="Bento, ir para a visão geral">
          <span class="barra-marca-logo">${html([LOGO_BENTO])}</span>
          <span class="barra-marca-texto">
            <span class="barra-marca-nome">Bento</span>
            <span class="barra-marca-versao">${sessao().sistema?.nomeEmpresa && sessao().sistema.nomeEmpresa !== "Bento" ? sessao().sistema.nomeEmpresa : "Painel administrativo"}</span>
          </span>
        </a>
        <button type="button" class="barra-recolher" data-acao="recolher" aria-label="Recolher menu">${html([icone("recolher-barra", "size-[1.1rem]")])}</button>
        <button type="button" class="barra-fechar-movel" data-acao="fechar-menu" aria-label="Fechar menu">${html([icone("fechar", "size-5")])}</button>
      </div>
      <button type="button" class="barra-expandir" data-acao="expandir" aria-label="Expandir menu">${html([icone("expandir-barra", "size-[1.1rem]")])}</button>
      <div class="barra-navegacao">
        ${NAVEGACAO.map((grupo) => {
          const itens = grupo.itens.filter((item) => pode(item.permissao));
          if (!itens.length) return "";
          return html`<div class="barra-grupo">
            <p class="barra-grupo-titulo">${grupo.grupo}</p>
            <ul class="barra-lista" role="list">
              ${itens.map(
                (item) => html`<li>
                  <a href="${item.href}" class="barra-item" data-dica="${item.rotulo}" ${item.id === paginaAtual ? html`aria-current="page"` : ""} ${item.externo ? html`target="_blank" rel="noopener"` : ""}>
                    ${html([icone(item.icone, "barra-item-icone")])}
                    <span class="barra-item-texto">${item.rotulo}</span>
                    ${item.contador ? html`<span class="barra-item-contador" data-contador="${item.contador}" hidden></span>` : ""}
                    ${item.externo ? html([icone("externo", "barra-item-externo")]) : ""}
                  </a>
                </li>`,
              )}
            </ul>
          </div>`;
        })}
      </div>
      <div class="barra-rodape">
        <p class="barra-ao-vivo" data-conexao-barra>
          <span class="ponto-vivo" data-estado="${estadoConexao()}"></span>
          <span class="barra-ao-vivo-texto">${ROTULOS_CONEXAO[estadoConexao()]}</span>
        </p>
        <a href="/configuracoes" class="barra-usuario" data-dica="${usuario?.nome ?? "Conta"}">
          ${avatar(usuario, "avatar-pequeno avatar-creme")}
          <span class="barra-usuario-texto">
            <span class="barra-usuario-nome" data-usuario-nome>${usuario?.nome}</span>
            <span class="barra-usuario-papel">${usuario?.papel?.nome ?? ROTULOS_PAPEL[usuario?.papel?.codigo] ?? ""}</span>
          </span>
          ${html([icone("configuracoes", "barra-usuario-icone")])}
        </a>
      </div>
    </nav>
  `;
};

const marcacaoCabecalho = (titulo) => {
  const usuario = usuarioAtual();
  const tema = temaAtual();
  return html`
    <button type="button" class="cabecalho-menu-movel" data-acao="abrir-menu" aria-label="Abrir menu">${html([icone("menu", "size-5")])}</button>
    <nav class="cabecalho-trilha" aria-label="Você está em">
      <ol class="trilha">
        <li><a class="trilha-item" href="/">Bento</a></li>
        <li aria-hidden="true">${html([icone("chevron-direita", "trilha-separador")])}</li>
        <li><span class="trilha-item" aria-current="page">${titulo}</span></li>
      </ol>
    </nav>
    <button type="button" class="cabecalho-busca" data-acao="buscar" aria-label="Abrir busca global">
      ${html([icone("buscar", "cabecalho-busca-icone")])}
      <span class="cabecalho-busca-texto">Buscar no painel…</span>
      <span class="cabecalho-busca-atalho"><span class="tecla">Ctrl</span><span class="tecla">K</span></span>
    </button>
    <div class="cabecalho-direita">
      <span class="cabecalho-ao-vivo" data-conexao-cabecalho title="Atualizações em tempo real">
        <span class="ponto-vivo" data-estado="${estadoConexao()}"></span>
        <span data-conexao-texto>${ROTULOS_CONEXAO[estadoConexao()]}</span>
      </span>
      <button type="button" class="cabecalho-acao cabecalho-tema" data-acao="tema" aria-label="Alternar tema claro ou escuro" data-dica-flutuante="Tema" data-dica-lado="baixo">
        ${html([icone("lua", "icone-lua")])}${html([icone("sol", "icone-sol")])}
      </button>
      <div class="menu-ancora">
        <button type="button" class="cabecalho-acao" data-acao="notificacoes" aria-label="Notificações" aria-expanded="false" aria-controls="central-notificacoes">
          ${html([icone("sino")])}
          <span class="cabecalho-acao-indicador" data-contador-sino hidden></span>
        </button>
        <section class="central-notificacoes" id="central-notificacoes" aria-label="Notificações recentes">
          <header class="central-cabecalho">
            <h2 class="central-titulo">Notificações <span class="contador contador-destaque" data-contador-central hidden></span></h2>
            <button type="button" class="botao botao-fantasma botao-pequeno" data-acao="ler-todas">${html([icone("confirmar")])}Marcar como lidas</button>
          </header>
          <div class="central-lista" data-lista-central><div class="vazio vazio-compacto"><span class="giro"></span></div></div>
          <footer class="central-rodape"><a href="/notificacoes">Ver todas as notificações${html([icone("chevron-direita", "size-4")])}</a></footer>
        </section>
      </div>
      <div class="menu-ancora">
        <button type="button" class="cabecalho-perfil" data-menu="menu-perfil" aria-label="Menu da conta">
          ${avatar(usuario, "avatar-pequeno")}
          <span class="cabecalho-perfil-nome" data-usuario-nome>${usuario?.nome?.split(" ")[0]}</span>
        </button>
        <div class="menu menu-largo" id="menu-perfil" role="menu">
          <div class="menu-cabecalho">
            ${avatar(usuario)}
            <div class="menu-cabecalho-texto">
              <span class="menu-cabecalho-nome" data-usuario-nome>${usuario?.nome}</span>
              <span class="menu-cabecalho-email">${usuario?.email}</span>
            </div>
          </div>
          <a href="/configuracoes" class="menu-item" role="menuitem">${html([icone("usuario")])}Meu perfil</a>
          <a href="/configuracoes?secao=seguranca" class="menu-item" role="menuitem">${html([icone("escudo")])}Segurança</a>
          <a href="/notificacoes" class="menu-item" role="menuitem">${html([icone("sino")])}Notificações</a>
          <div class="menu-separador"></div>
          <p class="menu-titulo">Tema</p>
          <div class="menu-tema" role="group" aria-label="Tema">
            <button type="button" data-tema="claro" aria-pressed="${tema === "claro"}">${html([icone("sol")])}Claro</button>
            <button type="button" data-tema="escuro" aria-pressed="${tema === "escuro"}">${html([icone("lua")])}Escuro</button>
            <button type="button" data-tema="sistema" aria-pressed="${tema === "sistema"}">${html([icone("monitor")])}Sistema</button>
          </div>
          <div class="menu-separador"></div>
          <a href="/api/v1/docs" target="_blank" rel="noopener" class="menu-item" role="menuitem">${html([icone("livro")])}Documentação da API${html([icone("externo", "ml-auto size-3.5")])}</a>
          <button type="button" class="menu-item menu-item-perigo" role="menuitem" data-acao="sair">${html([icone("sair")])}Sair</button>
        </div>
      </div>
    </div>
  `;
};

const atualizarContadores = (total) => {
  naoLidas = Math.max(0, Number(total) || 0);
  const texto = naoLidas > 99 ? "99+" : String(naoLidas);
  for (const alvo of document.querySelectorAll('[data-contador="notificacoes"], [data-contador-central]')) {
    alvo.textContent = texto;
    alvo.hidden = naoLidas === 0;
  }
  const sino = $("[data-contador-sino]");
  if (sino) {
    sino.textContent = naoLidas > 9 ? "9+" : texto;
    sino.hidden = naoLidas === 0;
  }
  document.title = document.title.replace(/^\(\d+\+?\)\s/, "");
  if (naoLidas) document.title = `(${texto}) ${document.title}`;
};

export const itemNotificacao = (notificacao, { grande = false, nova = false } = {}) => html`
  <article class="notificacao ${grande ? "notificacao-grande" : ""}" data-id="${notificacao.id}" data-lida="${Boolean(notificacao.lida)}" ${nova ? html`data-nova="true"` : ""}>
    ${notificacao.link ? html`<a class="notificacao-link" href="${notificacao.link}" data-abrir-notificacao="${notificacao.id}" aria-label="Abrir: ${notificacao.titulo}"></a>` : ""}
    <span class="notificacao-icone" data-tipo="${notificacao.tipo}">${html([icone(ICONES_CATEGORIA[notificacao.categoria] ?? "sino")])}</span>
    <div class="notificacao-conteudo">
      <h3 class="notificacao-titulo">${notificacao.titulo}</h3>
      <p class="notificacao-texto">${notificacao.mensagem}</p>
      <p class="notificacao-meta"><time datetime="${notificacao.criadoEm}" title="${new Date(notificacao.criadoEm).toLocaleString("pt-BR")}">${relativo(notificacao.criadoEm)}</time></p>
    </div>
    <div class="notificacao-acoes">
      ${notificacao.lida ? "" : html`<button type="button" class="botao botao-fantasma botao-icone botao-pequeno" data-ler="${notificacao.id}" aria-label="Marcar como lida" data-dica-flutuante="Marcar como lida">${html([icone("confirmar")])}</button>`}
      ${grande ? html`<button type="button" class="botao botao-fantasma botao-icone botao-pequeno" data-dispensar="${notificacao.id}" aria-label="Dispensar notificação" data-dica-flutuante="Dispensar">${html([icone("fechar")])}</button>` : ""}
    </div>
  </article>
`;

const carregarCentral = async () => {
  const lista = $("[data-lista-central]");
  try {
    const resposta = await api.obter("/notificacoes", { porPagina: 8 });
    atualizarContadores(resposta.naoLidas);
    if (!resposta.itens.length) {
      renderizar(
        lista,
        html`<div class="vazio vazio-compacto"><span class="vazio-icone">${html([icone("sino")])}</span><p class="vazio-titulo">Tudo em dia</p><p class="vazio-texto">Novos alertas aparecem aqui assim que acontecem.</p></div>`,
      );
      return;
    }
    renderizar(lista, html`${resposta.itens.map((item) => itemNotificacao(item))}`);
  } catch {
    renderizar(lista, html`<div class="vazio vazio-compacto vazio-erro"><span class="vazio-icone">${html([icone("alerta")])}</span><p class="vazio-texto">Não foi possível carregar as notificações.</p></div>`);
  }
};

export const marcarComoLida = async (id) => {
  await api.criar(`/notificacoes/${id}/ler`);
  for (const item of document.querySelectorAll(`.notificacao[data-id="${CSS.escape(id)}"]`)) {
    item.dataset.lida = "true";
    item.querySelector(`[data-ler]`)?.remove();
  }
  atualizarContadores(naoLidas - 1);
};

export const marcarTodasComoLidas = async () => {
  await api.criar("/notificacoes/ler-todas");
  for (const item of document.querySelectorAll(".notificacao")) {
    item.dataset.lida = "true";
    item.querySelector("[data-ler]")?.remove();
  }
  atualizarContadores(0);
};

const atualizarConexao = (estado) => {
  for (const ponto of document.querySelectorAll(".ponto-vivo:not([data-fixo])")) ponto.dataset.estado = estado;
  const texto = ROTULOS_CONEXAO[estado] ?? estado;
  const alvoCabecalho = $("[data-conexao-texto]");
  if (alvoCabecalho) alvoCabecalho.textContent = texto;
  const alvoBarra = $("[data-conexao-barra] .barra-ao-vivo-texto");
  if (alvoBarra) alvoBarra.textContent = texto;
};

const ligarEventos = (casca) => {
  const definirRecolhida = (recolhida) => {
    casca.dataset.barra = recolhida ? "recolhida" : "expandida";
    definirBarraRecolhida(recolhida);
  };

  const fecharMenuMovel = () => {
    casca.dataset.menuMovel = "fechado";
    document.body.style.overflow = "";
  };

  casca.addEventListener("click", async (evento) => {
    const gatilho = evento.target.closest("[data-acao]");
    if (!gatilho) return;
    const acao = gatilho.dataset.acao;
    if (acao === "recolher") definirRecolhida(true);
    else if (acao === "expandir") definirRecolhida(false);
    else if (acao === "abrir-menu") {
      casca.dataset.menuMovel = "aberto";
      document.body.style.overflow = "hidden";
      casca.querySelector(".barra-item")?.focus();
    } else if (acao === "fechar-menu") fecharMenuMovel();
    else if (acao === "buscar") abrirBusca();
    else if (acao === "tema") {
      alternarTema();
      document.querySelectorAll("[data-tema]").forEach((botao) => botao.setAttribute("aria-pressed", String(botao.dataset.tema === temaAtual())));
    } else if (acao === "notificacoes") {
      evento.stopPropagation();
      const central = $("#central-notificacoes");
      const aberta = central.dataset.aberto === "true";
      fecharTodos();
      if (!aberta) {
        central.dataset.aberto = "true";
        gatilho.setAttribute("aria-expanded", "true");
        carregarCentral();
      }
    } else if (acao === "ler-todas") {
      try {
        await marcarTodasComoLidas();
      } catch {
        avisar({ tipo: "erro", titulo: "Não foi possível marcar as notificações" });
      }
    } else if (acao === "sair") sair();
  });

  casca.addEventListener("click", async (evento) => {
    const botaoTema = evento.target.closest(".menu-tema [data-tema]");
    if (botaoTema) {
      aplicarTema(botaoTema.dataset.tema);
      document.querySelectorAll(".menu-tema [data-tema]").forEach((botao) => botao.setAttribute("aria-pressed", String(botao === botaoTema)));
      return;
    }
    const botaoLer = evento.target.closest(".central-notificacoes [data-ler]");
    if (botaoLer) {
      evento.stopPropagation();
      marcarComoLida(botaoLer.dataset.ler).catch(() => avisar({ tipo: "erro", titulo: "Não foi possível marcar como lida" }));
      return;
    }
    const link = evento.target.closest(".central-notificacoes [data-abrir-notificacao]");
    if (link) {
      const item = link.closest(".notificacao");
      if (item?.dataset.lida === "false") marcarComoLida(link.dataset.abrirNotificacao).catch(() => null);
    }
  });

  document.addEventListener("keydown", (evento) => {
    if (evento.key === "Escape" && casca.dataset.menuMovel === "aberto") fecharMenuMovel();
  });

  window.matchMedia("(min-width: 64rem)").addEventListener("change", fecharMenuMovel);

  const cabecalho = $(".cabecalho", casca);
  const aoRolar = () => {
    cabecalho.dataset.rolado = window.scrollY > 4 ? "true" : "false";
  };
  window.addEventListener("scroll", aoRolar, { passive: true });
  aoRolar();
};

export const montarCasca = ({ pagina, titulo }) => {
  const casca = $("#casca");
  if (!casca) return;
  casca.dataset.barra = barraRecolhida() ? "recolhida" : "expandida";
  casca.dataset.menuMovel = "fechado";
  renderizar($('[data-casca="barra"]', casca), marcacaoBarra(pagina));
  renderizar($('[data-casca="cabecalho"]', casca), marcacaoCabecalho(titulo));
  hidratarIcones(casca);
  iniciarMenus(casca);
  ligarEventos(casca);
  iniciarAtalhosBusca();

  ouvir("conexao", atualizarConexao);
  ouvir("tempo-real:contagem", (dados) => atualizarContadores(dados?.naoLidas));
  ouvir("tempo-real:notificacao", (notificacao) => {
    if (!notificacao) return;
    atualizarContadores(naoLidas + 1);
    const central = $("#central-notificacoes");
    if (central?.dataset.aberto === "true") {
      const lista = $("[data-lista-central]");
      lista.querySelector(".vazio")?.remove();
      lista.insertAdjacentHTML("afterbegin", String(itemNotificacao(notificacao, { nova: true })));
    }
    if (notificacao.tipo === "erro" || notificacao.categoria === "seguranca") {
      avisar({ tipo: notificacao.tipo === "erro" ? "erro" : "alerta", titulo: notificacao.titulo, texto: notificacao.mensagem });
    }
  });
  ouvir("sessao:usuario", (usuario) => {
    for (const alvo of document.querySelectorAll("[data-usuario-nome]")) alvo.textContent = alvo.closest(".cabecalho-perfil") ? usuario.nome.split(" ")[0] : usuario.nome;
  });

  api
    .obter("/notificacoes/contagem")
    .then((resposta) => atualizarContadores(resposta.naoLidas))
    .catch(() => null);
};

export const contagemNaoLidas = () => naoLidas;

export const definirContagemNaoLidas = atualizarContadores;

export const formatarContagem = (valor) => numero(valor);

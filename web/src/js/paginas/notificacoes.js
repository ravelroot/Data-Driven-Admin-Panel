import { iniciarPagina } from "../layout/inicio.js";
import { html, $, $$, renderizar, carregando } from "../nucleo/dom.js";
import { icone, hidratarIcones } from "../nucleo/icones.js";
import { api, mensagemDeErro, ErroApi } from "../nucleo/api.js";
import { pode } from "../nucleo/sessao.js";
import { ouvir } from "../nucleo/eventos.js";
import { estadoConexao } from "../nucleo/tempo-real.js";
import { diaRelativo, numero } from "../nucleo/formato.js";
import { itemNotificacao, marcarComoLida, marcarTodasComoLidas, definirContagemNaoLidas } from "../layout/casca.js";
import { Gaveta } from "../componentes/gaveta.js";
import { avisar, avisoSucesso } from "../componentes/aviso.js";
import { lerFormulario, mostrarErros } from "../componentes/formulario.js";

const TEXTOS_CONEXAO = {
  conectado: ["Recebendo em tempo real", "Novos alertas aparecem no topo da lista sem recarregar a página."],
  conectando: ["Conectando ao fluxo de eventos…", "Isso leva só alguns segundos."],
  reconectando: ["Reconectando…", "A conexão caiu. O painel tenta de novo sozinho."],
  desconectado: ["Sem conexão em tempo real", "A lista ainda funciona; atualize a página para ver novidades."],
};

const estado = { filtro: "todas", categoria: "", pagina: 1, itens: [], total: 0, paginas: 1 };

const renderizarLista = () => {
  const alvo = $("[data-lista]");
  if (!estado.itens.length) {
    renderizar(
      alvo,
      html`<div class="vazio"><span class="vazio-icone">${html([icone(estado.filtro === "nao-lidas" ? "confirmar" : "caixa")])}</span>
        <p class="vazio-titulo">${estado.filtro === "nao-lidas" ? "Nenhuma notificação não lida" : "Nenhuma notificação"}</p>
        <p class="vazio-texto">${estado.filtro === "nao-lidas" ? "Você está em dia." : "Quando algo importante acontecer na plataforma, aparece aqui."}</p></div>`,
    );
  } else {
    let diaAtual = "";
    renderizar(
      alvo,
      html`${estado.itens.map((notificacao) => {
        const dia = diaRelativo(notificacao.criadoEm);
        const titulo = dia !== diaAtual ? html`<h3 class="grupo-dia">${dia}</h3>` : "";
        diaAtual = dia;
        return html`${titulo}${itemNotificacao(notificacao, { grande: true, nova: notificacao.__nova })}`;
      })}`,
    );
  }
  $("[data-mais]").hidden = estado.pagina >= estado.paginas;
};

const carregar = async ({ acumular = false } = {}) => {
  if (!acumular) estado.pagina = 1;
  try {
    const resposta = await api.obter("/notificacoes", { filtro: estado.filtro, categoria: estado.categoria, pagina: estado.pagina, porPagina: 20 });
    estado.itens = acumular ? [...estado.itens, ...resposta.itens] : resposta.itens;
    estado.total = resposta.total;
    estado.paginas = resposta.paginas;
    $("[data-total-nao-lidas]").textContent = numero(resposta.naoLidas);
    definirContagemNaoLidas(resposta.naoLidas);
    renderizarLista();
  } catch (erro) {
    renderizar($("[data-lista]"), html`<div class="vazio vazio-erro"><span class="vazio-icone">${html([icone("alerta")])}</span><p class="vazio-titulo">Não foi possível carregar</p><p class="vazio-texto">${mensagemDeErro(erro)}</p></div>`);
  }
};

const carregarPreferencias = async () => {
  const corpo = $("[data-preferencias-corpo]");
  try {
    const preferencias = await api.obter("/notificacoes/preferencias");
    renderizar(
      corpo,
      html`${preferencias.map(
        (item) => html`<tr data-categoria="${item.categoria}">
          <td>${item.nome}</td>
          <td><label class="interruptor interruptor-pequeno"><input type="checkbox" name="app" ${item.app ? "checked" : ""} aria-label="${item.nome} no painel"><span class="interruptor-trilho"></span></label></td>
          <td><label class="interruptor interruptor-pequeno"><input type="checkbox" name="email" ${item.email ? "checked" : ""} aria-label="${item.nome} por e-mail"><span class="interruptor-trilho"></span></label></td>
        </tr>`,
      )}`,
    );
  } catch (erro) {
    renderizar(corpo, html`<tr><td colspan="3" class="texto-suave">${mensagemDeErro(erro)}</td></tr>`);
  }
};

const salvarPreferencias = async () => {
  const lista = $$("[data-preferencias-corpo] tr[data-categoria]").map((linha) => ({
    categoria: linha.dataset.categoria,
    app: linha.querySelector('[name="app"]').checked,
    email: linha.querySelector('[name="email"]').checked,
  }));
  try {
    await api.substituir("/notificacoes/preferencias", lista);
    avisar({ tipo: "sucesso", titulo: "Preferências salvas", duracao: 2500 });
  } catch (erro) {
    avisar({ tipo: "erro", titulo: "Não foi possível salvar", texto: mensagemDeErro(erro) });
  }
};

const abrirEnvio = async () => {
  const gaveta = new Gaveta({ titulo: "Enviar aviso", subtitulo: "Aparece na hora para quem estiver no painel." }).abrir();
  gaveta.definirCorpo(html`
    <form class="formulario" id="form-aviso" novalidate>
      <label class="campo">
        <span class="campo-rotulo campo-obrigatorio">Título</span>
        <input class="entrada" name="titulo" required maxlength="120" placeholder="Ex.: Manutenção programada no sábado">
      </label>
      <label class="campo">
        <span class="campo-rotulo campo-obrigatorio">Mensagem</span>
        <textarea class="area-texto" name="mensagem" required maxlength="500" rows="4" placeholder="O que as pessoas precisam saber e fazer"></textarea>
      </label>
      <div class="grade-campos">
        <label class="campo">
          <span class="campo-rotulo">Tipo</span>
          <select class="selecao" name="tipo">
            <option value="info">Informação</option>
            <option value="sucesso">Boa notícia</option>
            <option value="alerta">Atenção</option>
            <option value="erro">Problema</option>
          </select>
        </label>
        <label class="campo">
          <span class="campo-rotulo">Para quem</span>
          <select class="selecao" name="destinatario">
            <option value="todos">Toda a equipe</option>
          </select>
        </label>
      </div>
      <label class="campo">
        <span class="campo-rotulo">Link <span class="campo-rotulo-extra">opcional</span></span>
        <input class="entrada" name="link" maxlength="300" placeholder="/relatorios ou https://…">
        <span class="campo-ajuda">Ao clicar na notificação, a pessoa vai para este endereço.</span>
      </label>
    </form>
  `);
  gaveta.definirRodape(html`<button type="button" class="botao botao-secundario" data-cancelar>Cancelar</button><button type="submit" form="form-aviso" class="botao botao-primario" data-enviar><i data-icone="enviar"></i>Enviar aviso</button>`);
  gaveta.rodape.querySelector("[data-cancelar]").addEventListener("click", () => gaveta.fechar());

  api
    .obter("/usuarios", { porPagina: 50, ordenar: "nome", direcao: "asc", papel: "" })
    .then((resposta) => {
      const equipe = resposta.itens.filter((usuario) => usuario.papel?.codigo !== "cliente");
      $("#form-aviso [name=destinatario]")?.insertAdjacentHTML("beforeend", String(html`${equipe.map((usuario) => html`<option value="${usuario.id}">${usuario.nome}</option>`)}`));
    })
    .catch(() => null);

  const formulario = $("#form-aviso");
  formulario.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    if (!formulario.reportValidity()) return;
    const botao = gaveta.rodape.querySelector("[data-enviar]");
    carregando(botao, true);
    try {
      const dados = lerFormulario(formulario);
      if (!dados.link) delete dados.link;
      await api.criar("/notificacoes", dados);
      gaveta.fechar();
      avisoSucesso("Aviso enviado", dados.destinatario === "todos" ? "Toda a equipe recebe agora." : "A pessoa recebe agora.");
    } catch (erro) {
      if (erro instanceof ErroApi && erro.codigo === "VALIDACAO" && mostrarErros(formulario, erro.detalhes)) return;
      avisar({ tipo: "erro", titulo: "Não foi possível enviar", texto: mensagemDeErro(erro) });
    } finally {
      carregando(botao, false);
    }
  });
};

const atualizarConexao = (situacao) => {
  const [titulo, detalhe] = TEXTOS_CONEXAO[situacao] ?? TEXTOS_CONEXAO.conectando;
  $("[data-conexao-titulo]").textContent = titulo;
  $("[data-conexao-detalhe]").textContent = detalhe;
  $(".conexao-estado .ponto-vivo").dataset.estado = situacao;
};

iniciarPagina({
  pagina: "notificacoes",
  aoIniciar: async () => {
    $$("[data-permissao]").forEach((elemento) => {
      if (!pode(elemento.dataset.permissao)) elemento.remove();
    });
    atualizarConexao(estadoConexao());
    ouvir("conexao", atualizarConexao);

    $("[data-filtro-leitura]").addEventListener("click", (evento) => {
      const aba = evento.target.closest("[data-filtro]");
      if (!aba) return;
      estado.filtro = aba.dataset.filtro;
      $$("[data-filtro-leitura] [data-filtro]").forEach((outra) => outra.setAttribute("aria-selected", String(outra === aba)));
      carregar();
    });

    $("[data-filtro-categoria]").addEventListener("click", (evento) => {
      const chip = evento.target.closest("[data-categoria]");
      if (!chip) return;
      estado.categoria = chip.dataset.categoria;
      $$("[data-filtro-categoria] [data-categoria]").forEach((outro) => outro.setAttribute("aria-pressed", String(outro === chip)));
      carregar();
    });

    $("[data-lista]").addEventListener("click", async (evento) => {
      const ler = evento.target.closest("[data-ler]");
      const dispensar = evento.target.closest("[data-dispensar]");
      const abrir = evento.target.closest("[data-abrir-notificacao]");
      try {
        if (ler) {
          await marcarComoLida(ler.dataset.ler);
          estado.itens = estado.itens.map((item) => (item.id === ler.dataset.ler ? { ...item, lida: true } : item));
          $("[data-total-nao-lidas]").textContent = String(Math.max(0, Number($("[data-total-nao-lidas]").textContent) - 1));
          if (estado.filtro === "nao-lidas") carregar();
        } else if (dispensar) {
          await api.excluir(`/notificacoes/${dispensar.dataset.dispensar}`);
          estado.itens = estado.itens.filter((item) => item.id !== dispensar.dataset.dispensar);
          renderizarLista();
        } else if (abrir) {
          const item = abrir.closest(".notificacao");
          if (item?.dataset.lida === "false") marcarComoLida(abrir.dataset.abrirNotificacao).catch(() => null);
        }
      } catch (erro) {
        avisar({ tipo: "erro", titulo: "Não foi possível concluir", texto: mensagemDeErro(erro) });
      }
    });

    document.addEventListener("click", async (evento) => {
      const botao = evento.target.closest("[data-acao]");
      if (!botao || !$("#conteudo").contains(botao)) return;
      if (botao.dataset.acao === "mais") {
        estado.pagina += 1;
        carregando(botao, true);
        await carregar({ acumular: true });
        carregando(botao, false);
      } else if (botao.dataset.acao === "ler-pagina") {
        try {
          await marcarTodasComoLidas();
          $("[data-total-nao-lidas]").textContent = "0";
          avisoSucesso("Tudo lido", "Todas as notificações foram marcadas como lidas.");
          carregar();
        } catch (erro) {
          avisar({ tipo: "erro", titulo: "Não foi possível marcar", texto: mensagemDeErro(erro) });
        }
      } else if (botao.dataset.acao === "enviar") abrirEnvio();
    });

    $("[data-preferencias]").addEventListener("change", salvarPreferencias);

    ouvir("tempo-real:notificacao", (notificacao) => {
      if (!notificacao) return;
      if (estado.categoria && notificacao.categoria !== estado.categoria) return;
      estado.itens = [{ ...notificacao, __nova: true }, ...estado.itens.map((item) => ({ ...item, __nova: false }))];
      $("[data-total-nao-lidas]").textContent = String(Number($("[data-total-nao-lidas]").textContent || 0) + 1);
      renderizarLista();
      hidratarIcones($("[data-lista]"));
    });

    await Promise.all([carregar(), carregarPreferencias()]);
  },
});

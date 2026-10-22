import { iniciarPagina } from "../layout/inicio.js";
import { html, $, $$, renderizar } from "../nucleo/dom.js";
import { icone, hidratarIcones } from "../nucleo/icones.js";
import { faisca, medidor } from "../componentes/graficos.js";
import { avisar } from "../componentes/aviso.js";
import { Gaveta } from "../componentes/gaveta.js";
import { confirmar } from "../componentes/modal.js";
import { iniciarAbas } from "../componentes/abas.js";
import { abrirBusca } from "../layout/busca-global.js";

const TEXTOS_AVISO = {
  sucesso: ["Usuário cadastrado", "Ana Martins já aparece na lista."],
  erro: ["Não foi possível salvar", "A API recusou o e-mail porque ele já está em uso."],
  alerta: ["Meta em risco", "Faltam 9 dias e 41% da meta do mês."],
  info: ["Relatório na fila", "Você recebe uma notificação quando ficar pronto."],
};

const montarNavegacao = () => {
  const grupos = [];
  let atual = null;
  for (const elemento of $$("[data-vitrine] > .vitrine-grupo-titulo, [data-vitrine] > .vitrine-secao")) {
    if (elemento.classList.contains("vitrine-grupo-titulo")) {
      atual = { titulo: elemento.textContent.trim(), itens: [] };
      grupos.push(atual);
    } else if (atual) {
      atual.itens.push({ id: elemento.id, titulo: elemento.querySelector(".vitrine-titulo")?.textContent.trim() ?? elemento.id });
    }
  }
  renderizar(
    $("[data-vitrine-nav]"),
    html`${grupos.map(
      (grupo) => html`<div class="vitrine-nav-grupo">
        <p class="vitrine-nav-titulo">${grupo.titulo}</p>
        ${grupo.itens.map((item) => html`<a class="vitrine-nav-link" href="#${item.id}" data-alvo="${item.id}">${item.titulo}</a>`)}
      </div>`,
    )}`,
  );
};

const espiarRolagem = () => {
  const links = new Map($$("[data-alvo]").map((link) => [link.dataset.alvo, link]));
  const observador = new IntersectionObserver(
    (entradas) => {
      for (const entrada of entradas) {
        if (!entrada.isIntersecting) continue;
        for (const link of links.values()) link.removeAttribute("aria-current");
        links.get(entrada.target.id)?.setAttribute("aria-current", "true");
      }
    },
    { rootMargin: "-20% 0px -70% 0px" },
  );
  for (const secao of $$(".vitrine-secao")) observador.observe(secao);
};

const filtrar = (termo) => {
  const busca = termo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
  let visiveis = 0;
  for (const secao of $$(".vitrine-secao")) {
    const texto = `${secao.id} ${secao.querySelector(".vitrine-titulo")?.textContent ?? ""} ${secao.querySelector(".vitrine-descricao")?.textContent ?? ""}`
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();
    const mostrar = !busca || texto.includes(busca);
    secao.hidden = !mostrar;
    if (mostrar) visiveis += 1;
  }
  for (const titulo of $$(".vitrine-grupo-titulo")) {
    let irmao = titulo.nextElementSibling;
    let algum = false;
    while (irmao && !irmao.classList.contains("vitrine-grupo-titulo")) {
      if (irmao.classList.contains("vitrine-secao") && !irmao.hidden) algum = true;
      irmao = irmao.nextElementSibling;
    }
    titulo.hidden = !algum;
  }
  let vazio = $("[data-vitrine-vazio]");
  if (!visiveis && !vazio) {
    $("[data-vitrine]").insertAdjacentHTML("beforeend", '<p class="vitrine-sem-resultado" data-vitrine-vazio>Nenhum componente com esse nome.</p>');
  } else if (visiveis && vazio) vazio.remove();
};

const demonstrarGaveta = (largura) => {
  const gaveta = new Gaveta({ titulo: "Detalhes do pedido", subtitulo: "Gaveta lateral com cabeçalho, corpo rolável e rodapé", largura }).abrir();
  gaveta.definirCorpo(html`
    <section class="gaveta-secao">
      <h3 class="gaveta-secao-titulo">Resumo</h3>
      <dl class="lista-definicao"><dt>Plano</dt><dd>Profissional</dd><dt>Ciclo</dt><dd>Mensal</dd><dt>Valor</dt><dd>R$ 129,00</dd></dl>
    </section>
    <section class="gaveta-secao">
      <h3 class="gaveta-secao-titulo">Observação</h3>
      <textarea class="area-texto" rows="4" aria-label="Observação">Cliente pediu nota fiscal com CNPJ.</textarea>
    </section>
  `);
  gaveta.definirRodape(html`<button type="button" class="botao botao-secundario" data-fechar-demo>Fechar</button><button type="button" class="botao botao-primario" data-fechar-demo>${html([icone("salvar")])}Salvar</button>`);
  gaveta.rodape.addEventListener("click", (evento) => {
    if (evento.target.closest("[data-fechar-demo]")) gaveta.fechar();
  });
};

iniciarPagina({
  pagina: "componentes",
  aoIniciar: async () => {
    for (const alvo of $$("[data-faisca]")) {
      const valores = alvo.dataset.faisca.split(",").map(Number);
      alvo.innerHTML = faisca(valores, { tendencia: alvo.dataset.faiscaTendencia, rotulo: "Tendência de exemplo" });
    }
    const alvoMedidor = $("[data-demo-medidor]");
    if (alvoMedidor) alvoMedidor.innerHTML = medidor(68, { rotulo: "da meta" }) + medidor(32, { tamanho: 96, espessura: 9, rotulo: "uso" });

    iniciarAbas($("[data-demo-abas]"));
    montarNavegacao();
    espiarRolagem();
    hidratarIcones($("#conteudo"));

    $("[data-busca-vitrine]").addEventListener("input", (evento) => filtrar(evento.target.value));

    $("#conteudo").addEventListener("click", async (evento) => {
      const botaoAviso = evento.target.closest("[data-demo-aviso]");
      if (botaoAviso) {
        const [titulo, texto] = TEXTOS_AVISO[botaoAviso.dataset.demoAviso];
        avisar({ tipo: botaoAviso.dataset.demoAviso, titulo, texto });
        return;
      }
      const demo = evento.target.closest("[data-demo]")?.dataset.demo;
      if (demo === "gaveta") demonstrarGaveta("normal");
      else if (demo === "gaveta-larga") demonstrarGaveta("larga");
      else if (demo === "busca") abrirBusca();
      else if (demo === "confirmar") {
        const ok = await confirmar({ titulo: "Excluir este item?", texto: "Não dá para desfazer.", tipo: "perigo", confirmar: "Excluir" });
        avisar({ tipo: ok ? "sucesso" : "info", titulo: ok ? "Item excluído" : "Nada foi alterado", duracao: 2500 });
      }
    });

    if (location.hash) $(location.hash)?.scrollIntoView();
  },
});

import { iniciarPagina } from "../layout/inicio.ts";
import { html, $, $$, exigir, renderizar } from "../nucleo/dom.ts";
import { icone, hidratarIcones } from "../nucleo/icones.ts";
import { faisca, medidor } from "../componentes/graficos.ts";
import { avisar } from "../componentes/aviso.ts";
import { Gaveta } from "../componentes/gaveta.ts";
import { confirmar } from "../componentes/modal.ts";
import { iniciarAbas } from "../componentes/abas.ts";
import { abrirBusca } from "../layout/busca-global.ts";

type TipoAviso = "sucesso" | "erro" | "alerta" | "info";

interface ItemNavegacao {
  id: string;
  titulo: string;
}

interface GrupoNavegacao {
  titulo: string;
  itens: ItemNavegacao[];
}

const TEXTOS_AVISO: Record<TipoAviso, [string, string]> = {
  sucesso: ["Usuário cadastrado", "Ana Martins já aparece na lista."],
  erro: ["Não foi possível salvar", "A API recusou o e-mail porque ele já está em uso."],
  alerta: ["Meta em risco", "Faltam 9 dias e 41% da meta do mês."],
  info: ["Relatório na fila", "Você recebe uma notificação quando ficar pronto."],
};

const montarNavegacao = (): void => {
  const grupos: GrupoNavegacao[] = [];
  let atual: GrupoNavegacao | null = null;
  for (const elemento of $$("[data-vitrine] > .vitrine-grupo-titulo, [data-vitrine] > .vitrine-secao")) {
    if (elemento.classList.contains("vitrine-grupo-titulo")) {
      atual = { titulo: (elemento.textContent ?? "").trim(), itens: [] };
      grupos.push(atual);
    } else if (atual) {
      atual.itens.push({ id: elemento.id, titulo: elemento.querySelector(".vitrine-titulo")?.textContent?.trim() ?? elemento.id });
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

const espiarRolagem = (): void => {
  const links = new Map<string, HTMLElement>($$("[data-alvo]").map((link): [string, HTMLElement] => [link.dataset.alvo ?? "", link]));
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

const filtrar = (termo: string): void => {
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
    let irmao = titulo.nextElementSibling as HTMLElement | null;
    let algum = false;
    while (irmao && !irmao.classList.contains("vitrine-grupo-titulo")) {
      if (irmao.classList.contains("vitrine-secao") && !irmao.hidden) algum = true;
      irmao = irmao.nextElementSibling as HTMLElement | null;
    }
    titulo.hidden = !algum;
  }
  const vazio = $("[data-vitrine-vazio]");
  if (!visiveis && !vazio) {
    exigir("[data-vitrine]").insertAdjacentHTML("beforeend", '<p class="vitrine-sem-resultado" data-vitrine-vazio>Nenhum componente com esse nome.</p>');
  } else if (visiveis && vazio) vazio.remove();
};

const demonstrarGaveta = (largura: "normal" | "larga"): void => {
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
    if ((evento.target as Element | null)?.closest("[data-fechar-demo]")) gaveta.fechar();
  });
};

iniciarPagina({
  pagina: "componentes",
  aoIniciar: async () => {
    for (const alvo of $$("[data-faisca]")) {
      const valores = (alvo.dataset.faisca ?? "").split(",").map(Number);
      alvo.innerHTML = String(faisca(valores, { tendencia: alvo.dataset.faiscaTendencia, rotulo: "Tendência de exemplo" }));
    }
    const alvoMedidor = $("[data-demo-medidor]");
    if (alvoMedidor) alvoMedidor.innerHTML = String(medidor(68, { rotulo: "da meta" })) + String(medidor(32, { tamanho: 96, espessura: 9, rotulo: "uso" }));

    iniciarAbas(exigir("[data-demo-abas]"));
    montarNavegacao();
    espiarRolagem();
    hidratarIcones(exigir("#conteudo"));

    exigir<HTMLInputElement>("[data-busca-vitrine]").addEventListener("input", (evento) => filtrar((evento.target as HTMLInputElement).value));

    exigir("#conteudo").addEventListener("click", async (evento) => {
      const origem = evento.target as Element | null;
      const botaoAviso = origem?.closest<HTMLElement>("[data-demo-aviso]");
      if (botaoAviso) {
        const tipo = botaoAviso.dataset.demoAviso as TipoAviso;
        const [titulo, texto] = TEXTOS_AVISO[tipo];
        avisar({ tipo, titulo, texto });
        return;
      }
      const demo = origem?.closest<HTMLElement>("[data-demo]")?.dataset.demo;
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

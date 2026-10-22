import { iniciarPagina } from "../layout/inicio.js";
import { html, $, $$, renderizar, parametrosUrl } from "../nucleo/dom.js";
import { icone, hidratarIcones } from "../nucleo/icones.js";
import { api, mensagemDeErro } from "../nucleo/api.js";
import { pode, usuarioAtual } from "../nucleo/sessao.js";
import { ouvir } from "../nucleo/eventos.js";
import { ler, gravar } from "../nucleo/armazenamento.js";
import { moeda, numero, percentual, relativo, data, iniciais } from "../nucleo/formato.js";
import { Grafico, eixoMoeda, gradienteArea, coresDoTema } from "../componentes/graficos.js";
import { preencherKpi, tendencia, valorGrande } from "../componentes/indicadores.js";
import { linhaTransacao, abrirTransacao } from "../componentes/transacao.js";
import { avisar } from "../componentes/aviso.js";

const DESCRICOES = {
  "7d": "Receita, usuários e assinaturas nos últimos 7 dias.",
  "30d": "Receita, usuários e assinaturas nos últimos 30 dias.",
  "90d": "Receita, usuários e assinaturas nos últimos 90 dias.",
  "12m": "Receita, usuários e assinaturas nos últimos 12 meses.",
};

const COMPARACOES = { "7d": "7 dias antes", "30d": "30 dias antes", "90d": "90 dias antes", "12m": "12 meses antes" };

const TONS_ATIVIDADE = { bloqueado: "brasa", excluido: "brasa", desbloqueado: "oliva", criado: "oliva", gerado: "ouro", enviado: "anil", permissoes: "ouro" };
const ICONES_ATIVIDADE = { usuario: "usuario", relatorio: "arquivo", notificacao: "megafone", integracao: "integracao", configuracao: "configuracoes", sessao: "chave", transacao: "recibo" };

const estado = {
  periodo: ler("periodo-visao-geral", "30d"),
  dados: null,
  graficos: {},
  controlador: null,
};

const saudacao = () => {
  const hora = new Date().getHours();
  const parte = hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";
  return `${parte}, ${usuarioAtual()?.nome?.split(" ")[0] ?? ""}`;
};

const graficoReceita = (dados, cores) => ({
  chart: { type: "area", height: "100%", sparkline: { enabled: false } },
  series: [{ name: "Receita", data: dados?.serie ?? [] }],
  colors: [cores.destaqueClaro],
  stroke: { curve: "smooth", width: 2.5 },
  fill: gradienteArea(0.42, 0),
  grid: { show: true, strokeDashArray: 4, padding: { left: 12, right: 12 } },
  markers: { size: 0, hover: { size: 5 } },
  xaxis: { categories: dados?.rotulos ?? [], tickAmount: Math.min(window.innerWidth < 640 ? 4 : 8, (dados?.rotulos ?? []).length), labels: { style: { colors: cores.primariaTexto } } },
  yaxis: { tickAmount: 3, labels: { formatter: eixoMoeda, style: { colors: cores.primariaTexto } } },
  tooltip: { y: { formatter: (valor) => moeda(valor) } },
});

const graficoMensal = (dados, cores) => ({
  chart: { type: "line", height: "100%", stacked: false },
  series: [
    { name: "Receita", type: "column", data: dados?.receita ?? [] },
    { name: "Reembolsos", type: "column", data: dados?.reembolsos ?? [] },
    { name: "Meta", type: "line", data: dados?.meta ?? [] },
  ],
  colors: [cores.primaria, cores.areia, cores.destaque],
  stroke: { width: [0, 0, 2], curve: "straight", dashArray: [0, 0, 6] },
  plotOptions: { bar: { columnWidth: "58%", borderRadius: 5, borderRadiusApplication: "end" } },
  markers: { size: 0 },
  xaxis: { categories: dados?.rotulos ?? [] },
  yaxis: { tickAmount: 4, labels: { formatter: eixoMoeda } },
  tooltip: { shared: true, intersect: false, y: { formatter: (valor) => moeda(valor) } },
});

const graficoPlanos = (planos, cores) => ({
  chart: { type: "donut", height: 200 },
  series: (planos ?? []).map((plano) => plano.assinaturas),
  labels: (planos ?? []).map((plano) => plano.nome),
  colors: cores.serie(),
  stroke: { width: 3, colors: [cores.fundo] },
  plotOptions: {
    pie: {
      expandOnClick: false,
      donut: {
        size: "72%",
        labels: {
          show: true,
          name: { show: true, fontSize: "12px", color: cores.texto, offsetY: 18 },
          value: { show: true, fontSize: "26px", fontWeight: 650, color: cores.textoForte, offsetY: -12, formatter: (valor) => numero(Number(valor)) },
          total: { show: true, showAlways: true, label: "assinaturas", fontSize: "12px", color: cores.texto, formatter: (grafico) => numero(grafico.globals.seriesTotals.reduce((a, b) => a + b, 0)) },
        },
      },
    },
  },
  tooltip: { y: { formatter: (valor) => `${numero(valor)} assinaturas` } },
});

const renderizarPlanos = (planos) => {
  const total = planos.reduce((soma, plano) => soma + plano.assinaturas, 0) || 1;
  const paleta = coresDoTema();
  const cores = paleta.serie();
  renderizar(
    $("[data-lista-planos]"),
    html`${planos.map(
      (plano, indice) => html`<li class="lista-planos-item">
        <span class="lista-planos-cor" style="--cor:${cores[indice % cores.length]}"></span>
        <span class="lista-planos-nome">${plano.nome}<small>${percentual((plano.assinaturas / total) * 100, 0)}</small></span>
        <span class="lista-planos-valor">${moeda(plano.receita, { compacto: true })}</span>
      </li>`,
    )}`,
  );
};

const renderizarCanais = (canais) => {
  const maximo = Math.max(...canais.map((canal) => canal.visitantes), 1);
  renderizar(
    $("[data-canais]"),
    html`${canais.map(
      (canal) => html`<li class="lista-ranking-item">
        <div class="lista-ranking-topo">
          <span class="lista-ranking-nome">${canal.canal}</span>
          <span class="lista-ranking-valor">${numero(canal.visitantes, { compacto: true })}<small>${percentual(canal.visitantes ? (canal.conversoes / canal.visitantes) * 100 : 0)} conv.</small></span>
        </div>
        <div class="lista-ranking-barra"><span style="--valor:${((canal.visitantes / maximo) * 100).toFixed(1)}%"></span></div>
      </li>`,
    )}`,
  );
};

const tomAtividade = (acao = "") => {
  const sufixo = acao.split(".").at(-1);
  return TONS_ATIVIDADE[sufixo] ?? "";
};

const renderizarAtividades = (atividades) => {
  const alvo = $("[data-atividades]");
  if (!atividades.length) {
    renderizar(alvo, html`<li class="vazio vazio-compacto"><p class="vazio-texto">Nenhuma atividade registrada ainda.</p></li>`);
    return;
  }
  renderizar(
    alvo,
    html`${atividades.map(
      (atividade) => html`<li class="linha-tempo-item">
        <span class="linha-tempo-marcador" data-tom="${tomAtividade(atividade.acao)}">${html([icone(ICONES_ATIVIDADE[atividade.entidade] ?? "atividade")])}</span>
        <div class="linha-tempo-conteudo">
          <p class="linha-tempo-texto"><strong>${atividade.usuario?.nome ?? "Sistema"}</strong> ${atividade.descricao}</p>
          <time class="linha-tempo-tempo" datetime="${atividade.criadoEm}">${relativo(atividade.criadoEm)}</time>
        </div>
      </li>`,
    )}`,
  );
};

const renderizarTransacoes = (transacoes) => {
  const corpo = $("[data-transacoes-recentes]");
  if (!transacoes.length) {
    renderizar(corpo, html`<tr class="tabela-vazia"><td colspan="5"><div class="vazio vazio-compacto"><p class="vazio-texto">Nenhuma transação no período.</p></div></td></tr>`);
    return;
  }
  renderizar(corpo, html`${transacoes.map((transacao) => linhaTransacao(transacao))}`);
};

const renderizarMeta = (meta) => {
  const percentualMeta = Math.min(999, meta.percentual ?? 0);
  $("[data-meta-mes]").textContent = data(new Date().toISOString(), { month: "long", year: "numeric" }).replace(/^\w/, (letra) => letra.toUpperCase());
  $("[data-meta-percentual]").textContent = percentual(percentualMeta, 0);
  $("[data-meta-barra]").style.setProperty("--valor", `${Math.min(100, percentualMeta)}%`);
  $("[data-meta-progresso]").setAttribute("aria-valuenow", String(Math.round(Math.min(100, percentualMeta))));
  $("[data-meta-atingido]").textContent = moeda(meta.atingido, { compacto: true });
  $("[data-meta-valor]").textContent = `de ${moeda(meta.valor, { compacto: true })}`;
};

const preencherPagina = (dados) => {
  const { kpis } = dados;
  estado.dados = dados;
  $("[data-receita-valor]").innerHTML = String(valorGrande(kpis.receita.valor, "moeda"));
  $("[data-receita-tendencia]").innerHTML = String(tendencia(kpis.receita.variacao));
  $("[data-receita-comparacao]").textContent = `${COMPARACOES[estado.periodo]}: ${moeda(kpis.receita.anterior, { compacto: true })}`;
  $("[data-receita-intervalo]").textContent = dados.periodo?.rotulo ?? "";
  $('[data-mini="mrr"]').textContent = moeda(kpis.mrr.valor, { compacto: true });
  $('[data-mini="ticketMedio"]').textContent = moeda(kpis.ticketMedio.valor);
  $('[data-mini="conversao"]').textContent = percentual(kpis.conversao.valor);
  $('[data-mini="novos"]').textContent = numero(kpis.usuarios.novos ?? 0);

  const comparacao = `vs. ${COMPARACOES[estado.periodo]}`;
  preencherKpi($('[data-kpi="usuarios"]'), kpis.usuarios, { comparacao });
  preencherKpi($('[data-kpi="assinaturas"]'), kpis.assinaturas, { comparacao });
  preencherKpi($('[data-kpi="crescimento"]'), kpis.crescimento, { formato: "percentual", comparacao });
  preencherKpi($('[data-kpi="mrr"]'), kpis.mrr, { formato: "moeda", grafico: "barras", comparacao, compacto: true });
  preencherKpi($('[data-kpi="churn"]'), kpis.churn, { formato: "percentual", invertida: true, comparacao });

  renderizarMeta(dados.metaMensal);
  renderizarPlanos(dados.planos);
  renderizarCanais(dados.canais);
  renderizarAtividades(dados.atividades.slice(0, 7));
  renderizarTransacoes(dados.transacoesRecentes);

  estado.graficos.receita.renderizar(kpis.receita);
  estado.graficos.mensal.renderizar(dados.receitaMensal);
  estado.graficos.planos.renderizar(dados.planos);
  hidratarIcones($("#conteudo"));
};

const carregar = async () => {
  estado.controlador?.abort();
  estado.controlador = new AbortController();
  $$("[data-periodo]").forEach((botao) => botao.setAttribute("aria-pressed", String(botao.dataset.periodo === estado.periodo)));
  $("[data-descricao-periodo]").textContent = DESCRICOES[estado.periodo];
  try {
    const dados = await api.obter("/visao-geral", { periodo: estado.periodo }, { sinal: estado.controlador.signal });
    preencherPagina(dados);
  } catch (erro) {
    if (erro?.name === "AbortError") return;
    avisar({ tipo: "erro", titulo: "Não foi possível atualizar a visão geral", texto: mensagemDeErro(erro) });
  }
};

const aoVivo = () => {
  ouvir("tempo-real:transacao", (transacao) => {
    if (!transacao) return;
    const corpo = $("[data-transacoes-recentes]");
    corpo.querySelector(".tabela-vazia")?.remove();
    corpo.insertAdjacentHTML("afterbegin", String(linhaTransacao(transacao, { nova: true })));
    while (corpo.children.length > 6) corpo.lastElementChild.remove();
    hidratarIcones(corpo);
    if (transacao.status === "paga" && estado.dados) {
      const receita = estado.dados.kpis.receita;
      receita.valor += transacao.valor;
      if (receita.serie?.length) receita.serie[receita.serie.length - 1] += transacao.valor;
      $("[data-receita-valor]").innerHTML = String(valorGrande(receita.valor, "moeda"));
      estado.graficos.receita.atualizar(receita);
    }
  });
  ouvir("tempo-real:usuario", (usuario) => {
    if (!usuario || !estado.dados) return;
    const atividades = [
      { id: `vivo-${usuario.id}`, usuario: { nome: usuario.nome, iniciais: iniciais(usuario.nome) }, acao: "usuario.criado", entidade: "usuario", descricao: "criou uma conta", criadoEm: new Date().toISOString() },
      ...estado.dados.atividades,
    ].slice(0, 8);
    estado.dados.atividades = atividades;
    renderizarAtividades(atividades);
    const alvo = $('[data-mini="novos"]');
    estado.dados.kpis.usuarios.novos = (estado.dados.kpis.usuarios.novos ?? 0) + 1;
    alvo.textContent = numero(estado.dados.kpis.usuarios.novos);
  });
  ouvir("conexao", (situacao) => {
    for (const ponto of $$("#conteudo .ponto-vivo")) ponto.dataset.estado = situacao;
  });
};

iniciarPagina({
  pagina: "visao-geral",
  permissao: "painel.ver",
  aoIniciar: async () => {
    $("[data-saudacao]").textContent = saudacao();
    $$("[data-permissao]").forEach((elemento) => {
      if (!pode(elemento.dataset.permissao)) elemento.remove();
    });
    estado.graficos.receita = new Grafico($("[data-grafico-receita]"), graficoReceita);
    estado.graficos.mensal = new Grafico($("[data-grafico-mensal]"), graficoMensal);
    estado.graficos.planos = new Grafico($("[data-grafico-planos]"), graficoPlanos);

    $(".seletor-periodo").addEventListener("click", (evento) => {
      const botao = evento.target.closest("[data-periodo]");
      if (!botao || botao.dataset.periodo === estado.periodo) return;
      estado.periodo = botao.dataset.periodo;
      gravar("periodo-visao-geral", estado.periodo);
      carregar();
    });

    $("[data-transacoes-recentes]").addEventListener("click", (evento) => {
      const linha = evento.target.closest("tr[data-chave]");
      if (linha) abrirTransacao(linha.dataset.chave);
    });
    $("[data-transacoes-recentes]").addEventListener("keydown", (evento) => {
      const linha = evento.target.closest("tr[data-chave]");
      if (linha && evento.key === "Enter") abrirTransacao(linha.dataset.chave);
    });

    aoVivo();
    await carregar();

    const { transacao } = parametrosUrl();
    if (transacao && pode("transacoes.ver")) abrirTransacao(transacao);
  },
});

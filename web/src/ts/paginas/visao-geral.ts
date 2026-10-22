import type { ApexOptions } from "apexcharts";
import { iniciarPagina } from "../layout/inicio.ts";
import { html, $, $$, exigir, renderizar, parametrosUrl } from "../nucleo/dom.ts";
import { icone, hidratarIcones } from "../nucleo/icones.ts";
import { api, mensagemDeErro } from "../nucleo/api.ts";
import { pode, usuarioAtual } from "../nucleo/sessao.ts";
import { ouvir } from "../nucleo/eventos.ts";
import { ler, gravar } from "../nucleo/armazenamento.ts";
import { moeda, numero, percentual, relativo, data, iniciais } from "../nucleo/formato.ts";
import { Grafico, eixoMoeda, gradienteArea, coresDoTema } from "../componentes/graficos.ts";
import { preencherKpi, tendencia, valorGrande } from "../componentes/indicadores.ts";
import { linhaTransacao, abrirTransacao } from "../componentes/transacao.ts";
import { avisar } from "../componentes/aviso.ts";
import type { Atividade, EstadoConexao, Kpi, Transacao, Usuario } from "../nucleo/tipos.ts";

type Periodo = "7d" | "30d" | "90d" | "12m";
type Cores = ReturnType<typeof coresDoTema>;

interface KpiUsuarios extends Kpi {
  novos?: number;
}

interface PlanoResumo {
  codigo: string;
  nome: string;
  assinaturas: number;
  receita: number;
}

interface CanalResumo {
  canal: string;
  visitantes: number;
  conversoes: number;
}

interface MetaMensal {
  valor: number;
  atingido: number;
  percentual: number | null;
}

interface ReceitaMensal {
  rotulos: string[];
  receita: number[];
  reembolsos: number[];
  meta: number[];
}

interface VisaoGeral {
  periodo: { inicio: string; fim: string; rotulo: string } | null;
  kpis: {
    receita: Kpi;
    usuarios: KpiUsuarios;
    assinaturas: Kpi;
    crescimento: Kpi;
    mrr: Kpi;
    churn: Kpi;
    ticketMedio: Kpi;
    conversao: Kpi;
  };
  receitaMensal: ReceitaMensal;
  planos: PlanoResumo[];
  canais: CanalResumo[];
  metaMensal: MetaMensal;
  transacoesRecentes: Transacao[];
  atividades: Atividade[];
}

interface ContextoTotal {
  globals: { seriesTotals: number[] };
}

const DESCRICOES: Record<Periodo, string> = {
  "7d": "Receita, usuários e assinaturas nos últimos 7 dias.",
  "30d": "Receita, usuários e assinaturas nos últimos 30 dias.",
  "90d": "Receita, usuários e assinaturas nos últimos 90 dias.",
  "12m": "Receita, usuários e assinaturas nos últimos 12 meses.",
};

const COMPARACOES: Record<Periodo, string> = { "7d": "7 dias antes", "30d": "30 dias antes", "90d": "90 dias antes", "12m": "12 meses antes" };

const TONS_ATIVIDADE: Record<string, string> = { bloqueado: "brasa", excluido: "brasa", desbloqueado: "oliva", criado: "oliva", gerado: "ouro", enviado: "anil", permissoes: "ouro" };
const ICONES_ATIVIDADE: Record<string, string> = { usuario: "usuario", relatorio: "arquivo", notificacao: "megafone", integracao: "integracao", configuracao: "configuracoes", sessao: "chave", transacao: "recibo" };

const ehAborto = (erro: unknown): boolean => (erro as { name?: string } | null)?.name === "AbortError";

const graficoReceita = (dados: Kpi | null | undefined, cores: Cores): ApexOptions => ({
  chart: { type: "area", height: "100%", sparkline: { enabled: false } },
  series: [{ name: "Receita", data: dados?.serie ?? [] }],
  colors: [cores.destaqueClaro],
  stroke: { curve: "smooth", width: 2.5 },
  fill: gradienteArea(0.42, 0),
  grid: { show: true, strokeDashArray: 4, padding: { left: 12, right: 12 } },
  markers: { size: 0, hover: { size: 5 } },
  xaxis: { categories: dados?.rotulos ?? [], tickAmount: Math.min(window.innerWidth < 640 ? 4 : 8, (dados?.rotulos ?? []).length), labels: { style: { colors: cores.primariaTexto } } },
  yaxis: { tickAmount: 3, labels: { formatter: eixoMoeda, style: { colors: cores.primariaTexto } } },
  tooltip: { y: { formatter: (valor: number) => moeda(valor) } },
});

const graficoMensal = (dados: ReceitaMensal | null | undefined, cores: Cores): ApexOptions => ({
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
  tooltip: { shared: true, intersect: false, y: { formatter: (valor: number) => moeda(valor) } },
});

const graficoPlanos = (planos: PlanoResumo[] | null | undefined, cores: Cores): ApexOptions => ({
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
          value: { show: true, fontSize: "26px", fontWeight: 650, color: cores.textoForte, offsetY: -12, formatter: (valor: string) => numero(Number(valor)) },
          total: {
            show: true,
            showAlways: true,
            label: "assinaturas",
            fontSize: "12px",
            color: cores.texto,
            formatter: (grafico: ContextoTotal) => numero(grafico.globals.seriesTotals.reduce((a, b) => a + b, 0)),
          },
        },
      },
    },
  },
  tooltip: { y: { formatter: (valor: number) => `${numero(valor)} assinaturas` } },
});

const criarGraficos = () => ({
  receita: new Grafico($("[data-grafico-receita]"), graficoReceita),
  mensal: new Grafico($("[data-grafico-mensal]"), graficoMensal),
  planos: new Grafico($("[data-grafico-planos]"), graficoPlanos),
});

interface Estado {
  periodo: Periodo;
  dados: VisaoGeral | null;
  graficos: ReturnType<typeof criarGraficos> | null;
  controlador: AbortController | null;
}

const estado: Estado = {
  periodo: ler("periodo-visao-geral", "30d") as Periodo,
  dados: null,
  graficos: null,
  controlador: null,
};

const saudacao = (): string => {
  const hora = new Date().getHours();
  const parte = hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";
  return `${parte}, ${usuarioAtual()?.nome?.split(" ")[0] ?? ""}`;
};

const renderizarPlanos = (planos: PlanoResumo[]): void => {
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

const renderizarCanais = (canais: CanalResumo[]): void => {
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

const tomAtividade = (acao = ""): string => {
  const sufixo = acao.split(".").at(-1) ?? "";
  return TONS_ATIVIDADE[sufixo] ?? "";
};

const renderizarAtividades = (atividades: Atividade[]): void => {
  const alvo = $("[data-atividades]");
  if (!atividades.length) {
    renderizar(alvo, html`<li class="vazio vazio-compacto"><p class="vazio-texto">Nenhuma atividade registrada ainda.</p></li>`);
    return;
  }
  renderizar(
    alvo,
    html`${atividades.map(
      (atividade) => html`<li class="linha-tempo-item">
        <span class="linha-tempo-marcador" data-tom="${tomAtividade(atividade.acao)}">${html([icone(ICONES_ATIVIDADE[atividade.entidade ?? ""] ?? "atividade")])}</span>
        <div class="linha-tempo-conteudo">
          <p class="linha-tempo-texto"><strong>${atividade.usuario?.nome ?? "Sistema"}</strong> ${atividade.descricao}</p>
          <time class="linha-tempo-tempo" datetime="${atividade.criadoEm}">${relativo(atividade.criadoEm)}</time>
        </div>
      </li>`,
    )}`,
  );
};

const renderizarTransacoes = (transacoes: Transacao[]): void => {
  const corpo = $("[data-transacoes-recentes]");
  if (!transacoes.length) {
    renderizar(corpo, html`<tr class="tabela-vazia"><td colspan="5"><div class="vazio vazio-compacto"><p class="vazio-texto">Nenhuma transação no período.</p></div></td></tr>`);
    return;
  }
  renderizar(corpo, html`${transacoes.map((transacao) => linhaTransacao(transacao))}`);
};

const renderizarMeta = (meta: MetaMensal): void => {
  const percentualMeta = Math.min(999, meta.percentual ?? 0);
  exigir("[data-meta-mes]").textContent = data(new Date().toISOString(), { month: "long", year: "numeric" }).replace(/^\w/, (letra) => letra.toUpperCase());
  exigir("[data-meta-percentual]").textContent = percentual(percentualMeta, 0);
  exigir("[data-meta-barra]").style.setProperty("--valor", `${Math.min(100, percentualMeta)}%`);
  exigir("[data-meta-progresso]").setAttribute("aria-valuenow", String(Math.round(Math.min(100, percentualMeta))));
  exigir("[data-meta-atingido]").textContent = moeda(meta.atingido, { compacto: true });
  exigir("[data-meta-valor]").textContent = `de ${moeda(meta.valor, { compacto: true })}`;
};

const preencherPagina = (dados: VisaoGeral): void => {
  const { kpis } = dados;
  estado.dados = dados;
  exigir("[data-receita-valor]").innerHTML = String(valorGrande(kpis.receita.valor, "moeda"));
  exigir("[data-receita-tendencia]").innerHTML = String(tendencia(kpis.receita.variacao));
  exigir("[data-receita-comparacao]").textContent = `${COMPARACOES[estado.periodo]}: ${moeda(kpis.receita.anterior, { compacto: true })}`;
  exigir("[data-receita-intervalo]").textContent = dados.periodo?.rotulo ?? "";
  exigir('[data-mini="mrr"]').textContent = moeda(kpis.mrr.valor, { compacto: true });
  exigir('[data-mini="ticketMedio"]').textContent = moeda(kpis.ticketMedio.valor);
  exigir('[data-mini="conversao"]').textContent = percentual(kpis.conversao.valor);
  exigir('[data-mini="novos"]').textContent = numero(kpis.usuarios.novos ?? 0);

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

  estado.graficos?.receita.renderizar(kpis.receita);
  estado.graficos?.mensal.renderizar(dados.receitaMensal);
  estado.graficos?.planos.renderizar(dados.planos);
  hidratarIcones(exigir("#conteudo"));
};

const carregar = async (): Promise<void> => {
  estado.controlador?.abort();
  const controlador = new AbortController();
  estado.controlador = controlador;
  $$("[data-periodo]").forEach((botao) => botao.setAttribute("aria-pressed", String(botao.dataset.periodo === estado.periodo)));
  exigir("[data-descricao-periodo]").textContent = DESCRICOES[estado.periodo];
  try {
    const dados = await api.obter<VisaoGeral>("/visao-geral", { periodo: estado.periodo }, { sinal: controlador.signal });
    preencherPagina(dados);
  } catch (erro) {
    if (ehAborto(erro)) return;
    avisar({ tipo: "erro", titulo: "Não foi possível atualizar a visão geral", texto: mensagemDeErro(erro) });
  }
};

const aoVivo = (): void => {
  ouvir<Transacao | null>("tempo-real:transacao", (transacao) => {
    if (!transacao) return;
    const corpo = exigir("[data-transacoes-recentes]");
    corpo.querySelector(".tabela-vazia")?.remove();
    corpo.insertAdjacentHTML("afterbegin", String(linhaTransacao(transacao, { nova: true })));
    while (corpo.children.length > 6) corpo.lastElementChild?.remove();
    hidratarIcones(corpo);
    if (transacao.status === "paga" && estado.dados) {
      const receita = estado.dados.kpis.receita;
      receita.valor += transacao.valor;
      if (receita.serie?.length) receita.serie[receita.serie.length - 1] += transacao.valor;
      exigir("[data-receita-valor]").innerHTML = String(valorGrande(receita.valor, "moeda"));
      estado.graficos?.receita.atualizar(receita);
    }
  });
  ouvir<Usuario | null>("tempo-real:usuario", (usuario) => {
    if (!usuario || !estado.dados) return;
    const novaAtividade: Atividade = {
      id: `vivo-${usuario.id}`,
      usuario: { id: usuario.id, nome: usuario.nome, iniciais: iniciais(usuario.nome) },
      acao: "usuario.criado",
      entidade: "usuario",
      entidadeId: usuario.id,
      descricao: "criou uma conta",
      criadoEm: new Date().toISOString(),
    };
    const atividades = [novaAtividade, ...estado.dados.atividades].slice(0, 8);
    estado.dados.atividades = atividades;
    renderizarAtividades(atividades);
    const alvo = exigir('[data-mini="novos"]');
    estado.dados.kpis.usuarios.novos = (estado.dados.kpis.usuarios.novos ?? 0) + 1;
    alvo.textContent = numero(estado.dados.kpis.usuarios.novos);
  });
  ouvir<EstadoConexao>("conexao", (situacao) => {
    for (const ponto of $$("#conteudo .ponto-vivo")) ponto.dataset.estado = situacao;
  });
};

const linhaDoEvento = (evento: Event): HTMLTableRowElement | null => (evento.target as Element | null)?.closest<HTMLTableRowElement>("tr[data-chave]") ?? null;

iniciarPagina({
  pagina: "visao-geral",
  permissao: "painel.ver",
  aoIniciar: async () => {
    exigir("[data-saudacao]").textContent = saudacao();
    $$("[data-permissao]").forEach((elemento) => {
      if (!pode(elemento.dataset.permissao)) elemento.remove();
    });
    estado.graficos = criarGraficos();

    exigir(".seletor-periodo").addEventListener("click", (evento) => {
      const botao = (evento.target as Element | null)?.closest<HTMLElement>("[data-periodo]");
      if (!botao || botao.dataset.periodo === estado.periodo) return;
      estado.periodo = botao.dataset.periodo as Periodo;
      gravar("periodo-visao-geral", estado.periodo);
      carregar();
    });

    const corpoTransacoes = exigir("[data-transacoes-recentes]");
    corpoTransacoes.addEventListener("click", (evento) => {
      const linha = linhaDoEvento(evento);
      if (linha) abrirTransacao(linha.dataset.chave ?? "");
    });
    corpoTransacoes.addEventListener("keydown", (evento) => {
      const linha = linhaDoEvento(evento);
      if (linha && evento.key === "Enter") abrirTransacao(linha.dataset.chave ?? "");
    });

    aoVivo();
    await carregar();

    const { transacao } = parametrosUrl();
    if (transacao && pode("transacoes.ver")) abrirTransacao(transacao);
  },
});

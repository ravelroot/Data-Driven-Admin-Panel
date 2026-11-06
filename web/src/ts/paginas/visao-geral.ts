import type { ApexOptions } from "apexcharts";
import { iniciarPagina } from "../layout/inicio.ts";
import { html, $, $$, exigir, renderizar, parametrosUrl, atualizarUrl } from "../nucleo/dom.ts";
import { icone, hidratarIcones } from "../nucleo/icones.ts";
import { api, mensagemDeErro } from "../nucleo/api.ts";
import { atualizarPreferencias, pode, preferencia, usuarioAtual } from "../nucleo/sessao.ts";
import { ouvir } from "../nucleo/eventos.ts";
import { ler, gravar } from "../nucleo/armazenamento.ts";
import { moeda, numero, percentual, relativo, data, iniciais } from "../nucleo/formato.ts";
import { Grafico, eixoMoeda, gradienteArea, coresDoTema } from "../componentes/graficos.ts";
import { preencherKpi, tendencia, valorGrande } from "../componentes/indicadores.ts";
import { linhaTransacao, abrirTransacao } from "../componentes/transacao.ts";
import { avisar } from "../componentes/aviso.ts";
import { BentoPersonalizavel } from "../componentes/bento-personalizavel.ts";
import type { DefinicaoCartao, ModeloLayout } from "../nucleo/layout.ts";
import type { Atividade, EstadoConexao, ItemLayout, Kpi, Preferencias, Transacao, Usuario } from "../nucleo/tipos.ts";

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

interface PrevisaoMes {
  fim: string;
  hoje: string;
  diasRestantes: number;
  realizado: number;
  projetado: number;
  minimo: number;
  maximo: number;
  meta: number;
  percentualProjetado: number;
  probabilidadeMeta: number | null;
  ritmoAtual: number;
  ritmoNecessario: number;
  confiavel: boolean;
  serie: { rotulos: string[]; realizado: (number | null)[]; projetado: (number | null)[]; minimo: (number | null)[]; maximo: (number | null)[]; meta: number[] };
}

interface Anomalia {
  id: string;
  metrica: string;
  nome: string;
  unidade: "moeda" | "numero" | "percentual";
  dia: string;
  valor: number;
  esperado: number;
  desvioPercentual: number;
  sentido: "alta" | "queda";
  gravidade: "media" | "alta";
  positiva: boolean;
  link: string;
}

interface Destaque {
  id: string;
  icone: string;
  titulo: string;
  texto: string;
  tom: "positivo" | "negativo" | "neutro";
  link: string | null;
}

interface Insights {
  previsao: PrevisaoMes;
  mrr: { atual: number; em30: number; em90: number; variacaoSemanal: number };
  anomalias: Anomalia[];
  destaques: Destaque[];
}

const CARTOES: DefinicaoCartao[] = [
  { id: "receita", nome: "Receita no período", larguras: ["metade", "sete-doze", "dois-tercos", "tres-quartos", "inteiro"], alturas: ["normal", "alto"], largura: "dois-tercos", altura: "alto" },
  { id: "usuarios-assinaturas", nome: "Usuários e assinaturas", larguras: ["terco"], alturas: ["alto"], largura: "terco", altura: "alto" },
  { id: "crescimento", nome: "Crescimento do MRR", larguras: ["quarto", "terco", "metade"], alturas: ["normal"], largura: "quarto", altura: "normal" },
  { id: "mrr", nome: "Receita recorrente", larguras: ["quarto", "terco", "metade"], alturas: ["normal"], largura: "quarto", altura: "normal" },
  { id: "churn", nome: "Cancelamentos", larguras: ["quarto", "terco", "metade"], alturas: ["normal"], largura: "quarto", altura: "normal" },
  { id: "meta", nome: "Meta do mês", larguras: ["quarto", "terco", "metade"], alturas: ["normal"], largura: "quarto", altura: "normal" },
  { id: "previsao", nome: "Previsão do mês", larguras: ["metade", "sete-doze", "dois-tercos", "inteiro"], alturas: ["normal", "alto"], largura: "sete-doze", altura: "normal" },
  { id: "insights", nome: "Insights", larguras: ["terco", "cinco-doze", "metade", "sete-doze"], alturas: ["normal", "alto"], largura: "cinco-doze", altura: "normal" },
  { id: "mensal", nome: "Receita mês a mês", larguras: ["metade", "sete-doze", "dois-tercos", "inteiro"], alturas: ["normal", "alto"], largura: "sete-doze", altura: "normal" },
  { id: "planos", nome: "Assinaturas por plano", larguras: ["terco", "cinco-doze", "metade"], alturas: ["normal"], largura: "cinco-doze", altura: "normal" },
  { id: "transacoes", nome: "Transações recentes", larguras: ["sete-doze", "dois-tercos", "inteiro"], alturas: ["normal", "alto"], largura: "dois-tercos", altura: "normal" },
  { id: "atividades", nome: "Atividades recentes", larguras: ["terco", "cinco-doze", "metade"], alturas: ["normal", "alto"], largura: "terco", altura: "alto" },
  { id: "canais", nome: "Canais de aquisição", larguras: ["metade", "sete-doze", "dois-tercos", "inteiro"], alturas: ["normal"], largura: "dois-tercos", altura: "normal" },
];

const item = (id: string, largura: ItemLayout["largura"], altura: ItemLayout["altura"] = "normal"): ItemLayout => ({ id, largura, altura, oculto: false });

const MODELOS_LAYOUT: ModeloLayout[] = [
  {
    id: "financeiro",
    nome: "Financeiro",
    descricao: "Receita, meta, previsão e transações em primeiro lugar",
    itens: [item("receita", "dois-tercos", "alto"), item("meta", "terco"), item("mrr", "terco"), item("previsao", "inteiro"), item("mensal", "sete-doze"), item("planos", "cinco-doze"), item("transacoes", "inteiro")],
  },
  {
    id: "crescimento",
    nome: "Crescimento",
    descricao: "Usuários, assinaturas, canais e cancelamentos",
    itens: [item("usuarios-assinaturas", "terco", "alto"), item("crescimento", "terco"), item("churn", "terco"), item("insights", "dois-tercos"), item("canais", "dois-tercos"), item("planos", "terco"), item("atividades", "terco"), item("previsao", "dois-tercos")],
  },
  {
    id: "operacao",
    nome: "Operação do dia",
    descricao: "Transações, atividades e o que saiu do padrão",
    itens: [item("transacoes", "dois-tercos", "alto"), item("insights", "terco", "alto"), item("crescimento", "quarto"), item("mrr", "quarto"), item("churn", "quarto"), item("meta", "quarto"), item("atividades", "terco", "alto"), item("receita", "dois-tercos", "alto")],
  },
  {
    id: "enxuto",
    nome: "Enxuto",
    descricao: "Só os números principais e a previsão",
    itens: [item("crescimento", "quarto"), item("mrr", "quarto"), item("churn", "quarto"), item("meta", "quarto"), item("previsao", "sete-doze"), item("insights", "cinco-doze")],
  },
];

const ROTULO_METRICA_ALERTA: Record<string, string> = { receita: "receita", pagas: "transacoes_pagas", taxa_falha: "taxa_falha", reembolsos: "reembolsos", novos_usuarios: "novos_usuarios", conversao: "conversao" };

const DESCRICOES: Record<Periodo, string> = {
  "7d": "Receita, usuários e assinaturas nos últimos 7 dias.",
  "30d": "Receita, usuários e assinaturas nos últimos 30 dias.",
  "90d": "Receita, usuários e assinaturas nos últimos 90 dias.",
  "12m": "Receita, usuários e assinaturas nos últimos 12 meses.",
};

const COMPARACOES: Record<Periodo, string> = { "7d": "7 dias antes", "30d": "30 dias antes", "90d": "90 dias antes", "12m": "12 meses antes" };

const TONS_ATIVIDADE: Record<string, string> = { bloqueado: "brasa", excluido: "brasa", desbloqueado: "oliva", criado: "oliva", gerado: "ouro", enviado: "anil", permissoes: "ouro" };
const ICONES_ATIVIDADE: Record<string, string> = { usuario: "usuario", relatorio: "arquivo", notificacao: "megafone", integracao: "integracao", configuracao: "configuracoes", sessao: "chave", transacao: "recibo", alerta: "sirene" };

const ehAborto = (erro: unknown): boolean => (erro as { name?: string } | null)?.name === "AbortError";

const graficoReceita = (dados: Kpi | null | undefined, cores: Cores): ApexOptions => ({
  chart: { type: "area", height: "100%", sparkline: { enabled: false } },
  series: [{ name: "Receita", data: dados?.serie ?? [] }],
  colors: [cores.destaqueClaro],
  stroke: { curve: "straight", width: 1.75 },
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
  plotOptions: { bar: { columnWidth: "58%", borderRadius: 0, borderRadiusApplication: "end" } },
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

const tetoBonito = (valor: number): number => {
  if (valor <= 0) return 100;
  const potencia = 10 ** Math.floor(Math.log10(valor));
  const fator = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((candidato) => candidato * potencia >= valor * 1.04) ?? 10;
  return fator * potencia;
};

const graficoPrevisao = (previsao: PrevisaoMes | null | undefined, cores: Cores): ApexOptions => ({
  chart: { type: "line", height: 240 },
  series: [
    { name: "Realizado", type: "area", data: previsao?.serie.realizado ?? [] },
    { name: "Projeção", type: "line", data: previsao?.serie.projetado ?? [] },
    { name: "Mínimo provável", type: "line", data: previsao?.serie.minimo ?? [] },
    { name: "Máximo provável", type: "line", data: previsao?.serie.maximo ?? [] },
    { name: "Ritmo da meta", type: "line", data: previsao?.serie.meta ?? [] },
  ],
  colors: [cores.primaria, cores.destaque, cores.destaqueSuave, cores.destaqueSuave, cores.grade],
  stroke: { curve: "straight", width: [1.75, 2, 1, 1, 1.25], dashArray: [0, 5, 2, 2, 4] },
  fill: { type: ["gradient", "solid", "solid", "solid", "solid"], gradient: { shadeIntensity: 0, opacityFrom: 0.28, opacityTo: 0, stops: [0, 100] }, opacity: [1, 1, 1, 1, 1] },
  markers: { size: 0, hover: { size: 4 } },
  xaxis: { categories: previsao?.serie.rotulos ?? [], tickAmount: Math.min(window.innerWidth < 640 ? 4 : 6, (previsao?.serie.rotulos ?? []).length) },
  yaxis: { min: 0, max: tetoBonito(Math.max(previsao?.meta ?? 0, previsao?.maximo ?? 0)), tickAmount: 4, labels: { formatter: eixoMoeda } },
  tooltip: { shared: true, intersect: false, y: { formatter: (valor: number | null) => (valor === null || valor === undefined ? "—" : moeda(valor)) } },
});

const criarGraficos = () => ({
  receita: new Grafico($("[data-grafico-receita]"), graficoReceita),
  mensal: new Grafico($("[data-grafico-mensal]"), graficoMensal),
  planos: new Grafico($("[data-grafico-planos]"), graficoPlanos),
  previsao: new Grafico($("[data-grafico-previsao]"), graficoPrevisao),
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

const formatarAnomalia = (valor: number, unidade: Anomalia["unidade"]): string =>
  unidade === "moeda" ? moeda(valor, { compacto: valor >= 1_000_000 }) : unidade === "percentual" ? percentual(valor) : numero(valor, { casas: Number.isInteger(valor) ? 0 : 1 });

const diaCurto = (dia: string): string => data(`${dia}T12:00:00`, { day: "2-digit", month: "2-digit" });

const renderizarPrevisao = (insights: Insights): void => {
  const { previsao, mrr } = insights;
  exigir("[data-previsao-valor]").innerHTML = String(valorGrande(previsao.projetado, "moeda"));
  exigir("[data-previsao-faixa]").textContent = previsao.meta
    ? `${percentual(previsao.percentualProjetado, 0)} da meta de ${moeda(previsao.meta, { compacto: true })} · faixa provável de ${moeda(previsao.minimo, { compacto: true })} a ${moeda(previsao.maximo, { compacto: true })}`
    : `Faixa provável de ${moeda(previsao.minimo, { compacto: true })} a ${moeda(previsao.maximo, { compacto: true })}`;
  exigir("[data-previsao-subtitulo]").textContent = previsao.confiavel
    ? `Até ${diaCurto(previsao.fim)}, com o ritmo dos últimos 28 dias ajustado por dia da semana`
    : "Pouco histórico ainda: a projeção fica mais precisa depois de 3 semanas de vendas";
  const chance = exigir("[data-previsao-chance]");
  if (previsao.probabilidadeMeta !== null && previsao.meta) {
    const valor = previsao.probabilidadeMeta;
    chance.hidden = false;
    chance.className = `emblema emblema-pequeno ${valor >= 70 ? "emblema-oliva" : valor >= 35 ? "emblema-ouro" : "emblema-brasa"}`;
    chance.textContent = `${valor >= 99.5 ? "Meta garantida" : valor < 0.5 ? "Meta improvável" : `${percentual(valor, 0)} de chance de bater a meta`}`;
  } else {
    chance.hidden = true;
  }
  const mini = (chave: string, texto: string): void => {
    exigir(`[data-previsao-mini="${chave}"]`).textContent = texto;
  };
  mini("realizado", moeda(previsao.realizado, { compacto: true }));
  mini("ritmoAtual", moeda(previsao.ritmoAtual, { compacto: true }));
  mini("ritmoNecessario", previsao.realizado >= previsao.meta ? "Meta batida" : moeda(previsao.ritmoNecessario, { compacto: true }));
  mini("mrr90", moeda(mrr.em90, { compacto: true }));
  estado.graficos?.previsao.atualizar(previsao);
};

const renderizarInsights = (insights: Insights): void => {
  const alvo = exigir("[data-insights]");
  const podeAlertar = pode("alertas.gerenciar");
  const anomalias = insights.anomalias.slice(0, 3);
  const destaques = insights.destaques.slice(0, Math.max(1, 4 - anomalias.length));
  if (!anomalias.length && !destaques.length) {
    renderizar(alvo, html`<li class="vazio vazio-compacto"><span class="vazio-icone">${html([icone("lampada")])}</span><p class="vazio-titulo">Nada fora do padrão</p><p class="vazio-texto">As métricas dos últimos 7 dias ficaram dentro do esperado.</p></li>`);
    return;
  }
  renderizar(
    alvo,
    html`${anomalias.map((anomalia) => {
      const metricaAlerta = ROTULO_METRICA_ALERTA[anomalia.metrica];
      return html`<li class="insight" data-tom="${anomalia.positiva ? "positivo" : "negativo"}">
        <span class="insight-icone">${html([icone(anomalia.sentido === "alta" ? "tendencia-alta" : "tendencia-baixa")])}</span>
        <div class="insight-textos">
          <p class="insight-titulo">${anomalia.nome} ${anomalia.sentido === "alta" ? "acima" : "abaixo"} do esperado em ${diaCurto(anomalia.dia)}${anomalia.gravidade === "alta" ? html`<span class="emblema emblema-pequeno ${anomalia.positiva ? "emblema-oliva" : "emblema-brasa"}">Forte</span>` : ""}</p>
          <p class="insight-texto">${formatarAnomalia(anomalia.valor, anomalia.unidade)} contra ${formatarAnomalia(anomalia.esperado, anomalia.unidade)} esperados (${anomalia.desvioPercentual > 0 ? "+" : "−"}${percentual(Math.abs(anomalia.desvioPercentual), 0)})</p>
          <p class="insight-links"><a href="${anomalia.link}">Ver o dia${html([icone("chevron-direita")])}</a>${podeAlertar && metricaAlerta ? html`<a href="/alertas?novo=1&metrica=${metricaAlerta}">${html([icone("sirene")])}Criar alerta</a>` : ""}</p>
        </div>
      </li>`;
    })}
    ${destaques.map(
      (destaque) => html`<li class="insight" data-tom="${destaque.tom}">
        <span class="insight-icone">${html([icone(destaque.icone)])}</span>
        <div class="insight-textos">
          <p class="insight-titulo">${destaque.titulo}</p>
          <p class="insight-texto">${destaque.texto}</p>
          ${destaque.link ? html`<p class="insight-links"><a href="${destaque.link}">Detalhes${html([icone("chevron-direita")])}</a></p>` : ""}
        </div>
      </li>`,
    )}`,
  );
};

const carregarInsights = async (): Promise<void> => {
  try {
    const insights = await api.obter<Insights>("/insights");
    renderizarPrevisao(insights);
    renderizarInsights(insights);
  } catch (erro) {
    renderizar(exigir("[data-insights]"), html`<li class="vazio vazio-compacto vazio-erro"><span class="vazio-icone">${html([icone("alerta")])}</span><p class="vazio-texto">${mensagemDeErro(erro)}</p></li>`);
    exigir("[data-previsao-valor]").textContent = "—";
    estado.graficos?.previsao.atualizar(null);
  }
};

const iniciarPersonalizacao = (): void => {
  const grade = exigir("[data-bento-visao-geral]");
  const personalizavel = new BentoPersonalizavel({
    grade,
    barra: exigir("[data-barra-personalizacao]"),
    botao: $<HTMLButtonElement>("[data-personalizar]"),
    definicoes: CARTOES,
    modelos: MODELOS_LAYOUT,
    salvo: preferencia("layoutVisaoGeral", [] as ItemLayout[]),
    aoSalvar: async (layout) => {
      try {
        const salvas = await api.substituir<Preferencias>("/configuracoes/preferencias", { layoutVisaoGeral: layout });
        atualizarPreferencias(salvas);
        avisar({ tipo: "sucesso", titulo: layout ? "Layout salvo" : "Layout padrão restaurado", texto: "Vale para a sua conta em qualquer navegador." });
      } catch (erro) {
        avisar({ tipo: "erro", titulo: "Não foi possível salvar o layout", texto: mensagemDeErro(erro) });
        throw erro;
      }
    },
  });
  if (parametrosUrl().personalizar !== undefined) {
    atualizarUrl({ personalizar: null });
    personalizavel.entrar();
  }
};

const saudacao = (): string => {
  const hoje = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "short", year: "numeric" }).format(new Date());
  const nome = usuarioAtual()?.nome?.split(" ")[0];
  return `${hoje.replace(/\./g, "")}${nome ? ` · ${nome}` : ""}`;
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
    const existente = corpo.querySelector(`tr[data-chave="${CSS.escape(transacao.id)}"]`);
    if (existente) {
      existente.outerHTML = String(linhaTransacao(transacao));
      hidratarIcones(corpo);
      return;
    }
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

interface PassoInicial {
  id: string;
  titulo: string;
  texto: string;
  feito: boolean;
  href: string;
  acao: string;
}

const carregarPrimeirosPassos = async (): Promise<void> => {
  const alvo = $<HTMLElement>("[data-primeiros-passos]");
  if (!alvo || !pode("configuracoes.sistema") || preferencia("primeirosPassosOcultos", false)) return;
  let resposta: { passos: PassoInicial[]; feitos: number; total: number };
  try {
    resposta = await api.obter("/sistema/primeiros-passos");
  } catch {
    return;
  }
  if (resposta.feitos >= resposta.total) return;
  const porcentagem = Math.round((resposta.feitos / resposta.total) * 100);
  const atual = resposta.passos.find((passo) => !passo.feito)?.id;
  renderizar(
    alvo,
    html`
      <div class="primeiros-passos-cabecalho">
        <div class="primeiros-passos-topo">
          <div>
            <h2 class="primeiros-passos-titulo" id="titulo-primeiros-passos">Primeiros passos</h2>
            <p class="primeiros-passos-texto">O que falta para a equipe usar o painel com segurança.</p>
          </div>
          <button type="button" class="botao botao-fantasma botao-pequeno" data-ocultar-passos>${html([icone("olho-fechado")])}Ocultar</button>
        </div>
        <div class="primeiros-passos-progresso">
          <div class="primeiros-passos-trilho" role="progressbar" aria-valuenow="${porcentagem}" aria-valuemin="0" aria-valuemax="100" aria-label="Progresso dos primeiros passos"><span style="--valor: ${porcentagem}%"></span></div>
          <span class="primeiros-passos-contagem">${resposta.feitos} de ${resposta.total}</span>
        </div>
      </div>
      <ol class="primeiros-passos-lista">
        ${resposta.passos.map(
          (passo, indice) => html`<li class="primeiros-passos-item" ${passo.feito ? html`data-feito="true"` : ""} ${passo.id === atual ? html`data-atual="true"` : ""}>
            <span class="primeiros-passos-marcador">${passo.feito ? html([icone("confirmar")]) : indice + 1}</span>
            <div class="primeiros-passos-item-textos">
              <p class="primeiros-passos-item-titulo">${passo.titulo}<span class="sr-only">${passo.feito ? " (feito)" : " (pendente)"}</span></p>
              <p class="primeiros-passos-item-texto">${passo.texto}</p>
            </div>
            ${passo.feito ? "" : html`<a class="botao ${passo.id === atual ? "botao-primario" : "botao-secundario"} botao-pequeno primeiros-passos-item-acao" href="${passo.href}">${passo.acao}</a>`}
          </li>`,
        )}
      </ol>
    `,
  );
  alvo.hidden = false;
  alvo.querySelector("[data-ocultar-passos]")?.addEventListener("click", async () => {
    alvo.hidden = true;
    try {
      const salvas = await api.substituir<Preferencias>("/configuracoes/preferencias", { primeirosPassosOcultos: true });
      atualizarPreferencias(salvas);
      avisar({ tipo: "info", titulo: "Primeiros passos ocultos", texto: "Para mostrar de novo, use Configurações › Preferências." });
    } catch (erro) {
      alvo.hidden = false;
      avisar({ tipo: "erro", titulo: "Não foi possível ocultar", texto: mensagemDeErro(erro) });
    }
  });
};

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

    iniciarPersonalizacao();
    aoVivo();
    void carregarPrimeirosPassos();
    void carregarInsights();
    await carregar();

    const { transacao } = parametrosUrl();
    if (transacao && pode("transacoes.ver")) abrirTransacao(transacao);
  },
});

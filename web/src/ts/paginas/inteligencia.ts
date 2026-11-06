import type { ApexOptions } from "apexcharts";
import { iniciarPagina } from "../layout/inicio.ts";
import { html, $, $$, exigir, renderizar, carregando, parametrosUrl, atualizarUrl } from "../nucleo/dom.ts";
import { icone, hidratarIcones } from "../nucleo/icones.ts";
import { api, ErroApi, mensagemDeErro } from "../nucleo/api.ts";
import { moeda, numero, percentual, relativo, plural } from "../nucleo/formato.ts";
import { pode } from "../nucleo/sessao.ts";
import { Grafico, eixoMoeda, eixoNumero, medidor, coresDoTema } from "../componentes/graficos.ts";
import { iniciarAbas } from "../componentes/abas.ts";
import { valorGrande } from "../componentes/indicadores.ts";
import { avisar, avisoSucesso } from "../componentes/aviso.ts";

type Cores = ReturnType<typeof coresDoTema>;
type Faixa = "alta" | "media" | "baixa";

interface Teste {
  wape: number;
  wape_ingenuo: number;
  acuracia: number;
  ganho: number;
  janela: number;
}

interface SeriePrevista {
  codigo: string;
  nome: string;
  unidade: "moeda" | "numero";
  historico: { datas: string[]; valores: number[] };
  previsao: { datas: string[]; valores: number[]; min80: number[]; max80: number[]; min95: number[]; max95: number[] };
  mes: { rotulo: string; realizado: number; previsto: number; minimo: number; maximo: number };
  proximos30: number;
  media_recente: number;
  modelo: { tipo: string; parametros: Record<string, number>; erro_padrao: number; teste: Teste | null };
}

interface PrevisaoMrr {
  historico: { rotulos: string[]; valores: number[] };
  previsao: { rotulos: string[]; valores: number[]; min80: number[]; max80: number[] };
  atual: number;
  em6: number;
  crescimento: number | null;
  modelo: { tipo: string; erro_padrao: number; teste: Teste | null };
}

interface ClienteRisco {
  id: string;
  probabilidade: number;
  faixa: Faixa;
  mrr: number;
  plano: string;
  ciclo: string;
  meses: number;
  motivos: string[];
  acao: string;
}

interface Risco {
  modelo: { tipo: string; janela_dias: number; auc: number | null; taxa_base: number; amostras: number; cancelamentos: number; instantaneos: number };
  resumo: { ativos: number; alto: number; medio: number; esperados: number; mrr_em_risco: number; mrr_alto: number };
  fatores: { fator: string; peso: number; efeito: "aumenta" | "reduz" }[];
  distribuicao: { bordas: number[]; contagem: number[] };
  clientes: ClienteRisco[];
}

interface Segmento {
  codigo: string;
  nome: string;
  descricao: string;
  acao: string;
  clientes: number;
  receita: number;
  participacao: number;
  ticket: number;
  recencia: number;
  frequencia: number;
  exemplos: string[];
}

interface Segmentos {
  clientes: number;
  segmentos: Segmento[];
  matriz: number[][];
  agrupamento: {
    k: number;
    silhueta: number;
    perfis: { grupo: number; nome: string; clientes: number; recencia: number; frequencia: number; valor: number; receita: number }[];
    pontos: [number, number, number, number][];
  } | null;
}

interface Coortes {
  linhas: { coorte: string; clientes: number; retencao: (number | null)[]; receita: (number | null)[] }[];
  media: (number | null)[];
}

interface Ltv {
  plano: string;
  ativos: number;
  arpu: number;
  churn: number;
  vida_meses: number;
  ltv: number;
}

interface Verificacao {
  codigo: string;
  titulo: string;
  severidade: "alta" | "media" | "baixa";
  afetados: number;
  total: number;
  percentual: number;
  saude: number;
  recomendacao: string;
  exemplos: string[];
}

interface Qualidade {
  nota: number;
  classificacao: string;
  verificacoes: Verificacao[];
  campos: { campo: string; preenchimento: number }[];
}

interface Analise {
  previsoes: { series: SeriePrevista[]; mrr: PrevisaoMrr | null } | null;
  risco: Risco | null;
  segmentos: Segmentos | null;
  coortes: Coortes | null;
  ltv: Ltv[] | null;
  simulador: { ativos: number; arpu: number; churn: number; novos: number; mrr: number } | null;
  qualidade: Qualidade | null;
  avisos: string[];
  gerado_em: string;
  duracao_ms: number;
  versao: string;
  clientes: Record<string, { usuarioId: string; nome: string }>;
  volumes: { assinaturas: number; eventos: number; dias: number; truncado: boolean };
  emCache: boolean;
}

interface Simulacao {
  rotulos: string[];
  base: { ativos: number[]; mrr: number[] };
  cenario: { ativos: number[]; mrr: number[] };
  resumo: Record<string, number | null>;
}

interface EstadoMotor {
  configurado: boolean;
  disponivel: boolean;
  versao: string | null;
}

const ABAS = ["previsoes", "risco", "segmentos", "coortes", "simulador", "qualidade"];
const CORES_FAIXA: Record<Faixa, string> = { alta: "brasa", media: "ouro", baixa: "oliva" };
const ROTULOS_FAIXA: Record<Faixa, string> = { alta: "Alto", media: "Médio", baixa: "Baixo" };
const CORES_SEVERIDADE: Record<Verificacao["severidade"], string> = { alta: "brasa", media: "ouro", baixa: "neutro" };
const ROTULOS_SEVERIDADE: Record<Verificacao["severidade"], string> = { alta: "Alta", media: "Média", baixa: "Baixa" };
const COM_CLIENTES = new Set(["sem_canal", "datas_invertidas", "testes_vencidos", "valor_divergente", "sem_cobranca", "pago_apos_cancelar", "cobranca_duplicada"]);

const estado = {
  analise: null as Analise | null,
  serie: "receita",
  faixa: "todas",
  simulacao: 0,
};

const formatar = (valor: number | null | undefined, unidade: string): string => (unidade === "moeda" ? moeda(valor ?? 0) : numero(valor ?? 0, { casas: 0 }));
const fracao = (valor: number | null | undefined, casas = 1): string => (valor === null || valor === undefined ? "—" : percentual(valor * 100, casas));
const nomeCliente = (id: string): string => estado.analise?.clientes[id]?.nome ?? "Cliente";
const linkCliente = (id: string): string | null => {
  const cliente = estado.analise?.clientes[id];
  return cliente && pode("usuarios.ver") ? `/usuarios?usuario=${encodeURIComponent(cliente.usuarioId)}` : null;
};
const nomePlano = (codigo: string): string => codigo.charAt(0).toUpperCase() + codigo.slice(1);
const rotuloDia = (iso: string): string => new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");

const graficoPrevisao = (serie: SeriePrevista | null, cores: Cores): ApexOptions => {
  const historico = serie?.historico ?? { datas: [], valores: [] };
  const previsao = serie?.previsao ?? { datas: [], valores: [], min80: [], max80: [], min95: [], max95: [] };
  const passado = historico.valores.length;
  const nulos = (quantidade: number) => Array.from({ length: Math.max(quantidade, 0) }, () => null);
  const ligacao = passado ? [historico.valores[passado - 1]] : [];
  const futuro = (valores: number[]) => [...nulos(passado - ligacao.length), ...ligacao, ...valores];
  const formato = (valor: number) => (serie?.unidade === "moeda" ? eixoMoeda(valor) : eixoNumero(valor));
  return {
    chart: { type: "line", height: 300 },
    series: [
      { name: "Realizado", type: "area", data: [...historico.valores, ...nulos(previsao.valores.length)] },
      { name: "Previsto", type: "line", data: futuro(previsao.valores) },
      { name: "Mínimo provável (80%)", type: "line", data: futuro(previsao.min80) },
      { name: "Máximo provável (80%)", type: "line", data: futuro(previsao.max80) },
    ],
    colors: [cores.primaria, cores.destaque, cores.destaqueSuave, cores.destaqueSuave],
    fill: { type: ["gradient", "solid", "solid", "solid"], gradient: { shadeIntensity: 0, opacityFrom: 0.24, opacityTo: 0, stops: [0, 100] }, opacity: [1, 1, 1, 1] },
    stroke: { curve: "straight", width: [1.75, 2.25, 1, 1], dashArray: [0, 5, 2, 2] },
    markers: { size: 0, hover: { size: 4 } },
    legend: { show: true, position: "top", horizontalAlign: "left" },
    xaxis: { categories: [...historico.datas, ...previsao.datas].map(rotuloDia), tickAmount: window.innerWidth < 640 ? 4 : 8 },
    yaxis: { min: 0, tickAmount: 4, labels: { formatter: formato } },
    tooltip: { shared: true, intersect: false, y: { formatter: (valor: number | null) => (valor === null || valor === undefined ? "—" : formatar(valor, serie?.unidade ?? "numero")) } },
  } as ApexOptions;
};

const graficoMrr = (mrr: PrevisaoMrr | null, cores: Cores): ApexOptions => {
  const historico = mrr?.historico.valores ?? [];
  const previsto = mrr?.previsao.valores ?? [];
  const vazio = (n: number) => Array.from({ length: n }, () => null);
  return {
    chart: { type: "bar", height: 280 },
    series: [
      { name: "Realizado", data: [...historico, ...vazio(previsto.length)] },
      { name: "Previsto", data: [...vazio(historico.length), ...previsto] },
    ],
    colors: [cores.primaria, cores.destaque],
    plotOptions: { bar: { columnWidth: "62%", borderRadius: 3 } },
    dataLabels: { enabled: false },
    legend: { show: true, position: "top", horizontalAlign: "left" },
    xaxis: { categories: [...(mrr?.historico.rotulos ?? []), ...(mrr?.previsao.rotulos ?? [])], tickAmount: window.innerWidth < 640 ? 5 : 10 },
    yaxis: { min: 0, tickAmount: 4, labels: { formatter: eixoMoeda } },
    tooltip: { shared: true, intersect: false, y: { formatter: (valor: number | null) => (valor === null || valor === undefined ? "—" : moeda(valor)) } },
  } as ApexOptions;
};

const graficoDistribuicao = (risco: Risco | null, cores: Cores): ApexOptions => {
  const bordas = risco?.distribuicao.bordas ?? [];
  return {
    chart: { type: "bar", height: 200 },
    series: [{ name: "Clientes", data: risco?.distribuicao.contagem ?? [] }],
    colors: [cores.brasa],
    plotOptions: { bar: { columnWidth: "86%", borderRadius: 2 } },
    dataLabels: { enabled: false },
    xaxis: { categories: bordas.slice(0, -1).map((borda, i) => `${numero(borda * 100, { casas: 0 })}–${numero(bordas[i + 1] * 100, { casas: 0 })}%`), labels: { rotate: -45, hideOverlappingLabels: true } },
    yaxis: { labels: { formatter: eixoNumero } },
    tooltip: { y: { formatter: (valor: number) => plural(valor, "cliente") } },
  } as ApexOptions;
};

const graficoGrupos = (segmentos: Segmentos | null, cores: Cores): ApexOptions => {
  const grupos = segmentos?.agrupamento;
  const paleta = cores.serie();
  return {
    chart: { type: "scatter", height: 300, zoom: { enabled: false } },
    series: (grupos?.perfis ?? []).map((perfil) => ({
      name: perfil.nome,
      data: grupos!.pontos.filter((ponto) => ponto[3] === perfil.grupo).map(([recencia, , valor]) => [recencia, valor]),
    })),
    colors: paleta,
    markers: { size: 5, strokeWidth: 0, fillOpacity: 0.7 },
    legend: { show: true, position: "top", horizontalAlign: "left" },
    xaxis: { type: "numeric", title: { text: "Dias desde o último pagamento" }, tickAmount: 6, labels: { formatter: (valor: string) => numero(Number(valor)) } },
    yaxis: { title: { text: "Valor pago" }, labels: { formatter: eixoMoeda } },
    tooltip: { custom: ({ seriesIndex, dataPointIndex, w }: { seriesIndex: number; dataPointIndex: number; w: { config: { series: { name: string; data: number[][] }[] } } }) => {
      const serie = w.config.series[seriesIndex];
      const [dias, valor] = serie.data[dataPointIndex];
      return `<div class="inteligencia-dica"><strong>${serie.name}</strong><span>${numero(dias)} dias · ${moeda(valor)}</span></div>`;
    } },
  } as ApexOptions;
};

const graficoCurva = (coortes: Coortes | null, cores: Cores): ApexOptions => ({
  chart: { type: "area", height: 240 },
  series: [{ name: "Retenção média", data: (coortes?.media ?? []).map((valor) => (valor === null ? null : Math.round(valor * 1000) / 10)) }],
  colors: [cores.primaria],
  fill: { type: "gradient", gradient: { shadeIntensity: 0, opacityFrom: 0.3, opacityTo: 0, stops: [0, 100] } },
  stroke: { curve: "smooth", width: 2 },
  dataLabels: { enabled: false },
  xaxis: { categories: (coortes?.media ?? []).map((_, i) => `Mês ${i}`) },
  yaxis: { min: 0, max: 100, tickAmount: 4, labels: { formatter: (valor: number) => `${numero(valor)}%` } },
  tooltip: { y: { formatter: (valor: number) => percentual(valor) } },
});

const graficoSimulador = (simulacao: Simulacao | null, cores: Cores): ApexOptions => ({
  chart: { type: "line", height: 280 },
  series: [
    { name: "Cenário atual", data: simulacao?.base.mrr ?? [] },
    { name: "Cenário simulado", data: simulacao?.cenario.mrr ?? [] },
  ],
  colors: [cores.grade, cores.destaque],
  stroke: { curve: "smooth", width: [2, 3], dashArray: [5, 0] },
  markers: { size: 0, hover: { size: 4 } },
  legend: { show: true, position: "top", horizontalAlign: "left" },
  xaxis: { categories: simulacao?.rotulos ?? [] },
  yaxis: { tickAmount: 4, labels: { formatter: eixoMoeda } },
  tooltip: { shared: true, intersect: false, y: { formatter: (valor: number) => moeda(valor) } },
});

const graficos = {
  previsao: new Grafico<SeriePrevista | null>($("[data-grafico-previsao]"), graficoPrevisao),
  mrr: new Grafico<PrevisaoMrr | null>($("[data-grafico-mrr]"), graficoMrr),
  distribuicao: new Grafico<Risco | null>($("[data-grafico-distribuicao]"), graficoDistribuicao),
  grupos: new Grafico<Segmentos | null>($("[data-grafico-grupos]"), graficoGrupos),
  curva: new Grafico<Coortes | null>($("[data-grafico-curva]"), graficoCurva),
  simulador: new Grafico<Simulacao | null>($("[data-grafico-simulador]"), graficoSimulador),
};

const kpi = (nome: string, valor: string, rodape: string): void => {
  const cartao = exigir(`[data-kpi="${nome}"]`);
  exigir("[data-kpi-valor]", cartao).innerHTML = valor;
  exigir("[data-kpi-rodape]", cartao).textContent = rodape;
};

const preencherKpis = (analise: Analise): void => {
  const receita = analise.previsoes?.series.find((serie) => serie.codigo === "receita");
  kpi("previsao", receita ? String(valorGrande(receita.mes.previsto, "moeda")) : "—", receita ? `Entre ${moeda(receita.mes.minimo, { compacto: true })} e ${moeda(receita.mes.maximo, { compacto: true })} (80%)` : "Sem histórico suficiente");
  const mrr = analise.previsoes?.mrr;
  kpi("mrr", mrr ? String(valorGrande(mrr.em6, "moeda")) : "—", mrr ? `${mrr.crescimento !== null && mrr.crescimento >= 0 ? "+" : ""}${fracao(mrr.crescimento)} sobre os ${moeda(mrr.atual, { compacto: true })} de hoje` : "Sem histórico suficiente");
  const risco = analise.risco;
  kpi("risco", risco ? numero(risco.resumo.alto) : "—", risco ? `${moeda(risco.resumo.mrr_em_risco, { compacto: true })} de MRR em risco esperado` : "Poucos cancelamentos para treinar o modelo");
  const qualidade = analise.qualidade;
  kpi("qualidade", qualidade ? `${numero(qualidade.nota, { casas: 0 })}<small>/100</small>` : "—", qualidade ? `Classificação ${qualidade.classificacao}` : "—");
};

const linhaModelo = (rotulo: string, valor: string, dica = ""): string =>
  String(html`<div class="inteligencia-linha"><dt>${rotulo}</dt><dd title="${dica}">${valor}</dd></div>`);

const preencherPrevisoes = (analise: Analise): void => {
  const series = analise.previsoes?.series ?? [];
  if (!series.some((serie) => serie.codigo === estado.serie)) estado.serie = series[0]?.codigo ?? "receita";
  const lista = exigir("[data-series]");
  renderizar(lista, html`${series.map((serie) => html`<button type="button" class="aba" role="tab" data-aba="${serie.codigo}" aria-selected="${serie.codigo === estado.serie ? "true" : "false"}">${serie.nome}</button>`)}`);
  iniciarAbas(lista, { inicial: estado.serie, aoTrocar: (nome) => {
    estado.serie = nome;
    desenharSerie();
  } });
  const mrr = analise.previsoes?.mrr ?? null;
  void graficos.mrr.renderizar(mrr);
  const teste = mrr?.modelo.teste;
  renderizar(
    $("[data-modelo-mrr]"),
    mrr
      ? html`<dl class="inteligencia-lista">
          ${html([linhaModelo("MRR hoje", moeda(mrr.atual))])}
          ${html([linhaModelo("Em 6 meses", moeda(mrr.em6))])}
          ${html([linhaModelo("Variação", `${mrr.crescimento !== null && mrr.crescimento >= 0 ? "+" : ""}${fracao(mrr.crescimento)}`)])}
          ${html([linhaModelo("Modelo", mrr.modelo.tipo)])}
          ${teste ? html([linhaModelo("Acerto no teste", fracao(teste.acuracia), `Erro de ${fracao(teste.wape)} contra ${fracao(teste.wape_ingenuo)} de repetir o último mês`)]) : ""}
        </dl>`
      : html`<p class="inteligencia-nota-texto">Ainda não há meses suficientes de assinaturas para projetar o MRR.</p>`,
  );
  desenharSerie();
};

const desenharSerie = (): void => {
  const serie = estado.analise?.previsoes?.series.find((item) => item.codigo === estado.serie) ?? null;
  void graficos.previsao.renderizar(serie);
  if (!serie) return;
  const teste = serie.modelo.teste;
  exigir("[data-modelo-previsao-sub]").textContent = serie.modelo.tipo;
  renderizar(
    $("[data-modelo-previsao]"),
    html`<p class="inteligencia-destaque">${formatar(serie.mes.previsto, serie.unidade)}<span>previsto para ${serie.mes.rotulo}</span></p>
      <div class="inteligencia-faixa" role="img" aria-label="Faixa provável de ${formatar(serie.mes.minimo, serie.unidade)} a ${formatar(serie.mes.maximo, serie.unidade)}">
        <span style="--inicio: ${Math.max(0, Math.min(100, (serie.mes.realizado / Math.max(serie.mes.maximo, 1)) * 100))}%"></span>
      </div>
      <dl class="inteligencia-lista">
        ${html([linhaModelo("Realizado até ontem", formatar(serie.mes.realizado, serie.unidade))])}
        ${html([linhaModelo("Faixa provável (80%)", `${formatar(serie.mes.minimo, serie.unidade)} a ${formatar(serie.mes.maximo, serie.unidade)}`)])}
        ${html([linhaModelo("Próximos 30 dias", formatar(serie.proximos30, serie.unidade))])}
        ${html([linhaModelo("Média diária recente", formatar(serie.media_recente, serie.unidade))])}
        ${teste ? html([linhaModelo("Acerto nos últimos 28 dias", fracao(teste.acuracia), `Erro de ${fracao(teste.wape)}; repetir a semana anterior erraria ${fracao(teste.wape_ingenuo)}`)]) : ""}
      </dl>`,
  );
};

const preencherRisco = (analise: Analise): void => {
  const risco = analise.risco;
  const tabela = exigir("[data-tabela-risco]");
  if (!risco) {
    renderizar(tabela, html`<tbody><tr><td><div class="vazio vazio-compacto"><p class="vazio-titulo">Modelo ainda sem dados</p><p class="vazio-texto">São precisos pelo menos alguns cancelamentos nos últimos 12 meses para treinar o modelo.</p></div></td></tr></tbody>`);
    return;
  }
  const { modelo, resumo } = risco;
  exigir("[data-risco-sub]").textContent = `${plural(resumo.ativos, "cliente pagante", "clientes pagantes")} · ${numero(resumo.esperados, { casas: 1 })} cancelamentos esperados em ${modelo.janela_dias} dias`;
  exigir("[data-modelo-risco]").textContent = `${modelo.tipo} · AUC ${modelo.auc === null ? "—" : numero(modelo.auc, { casas: 2 })} · taxa média ${fracao(modelo.taxa_base)}`;
  const maximo = Math.max(...risco.fatores.map((fator) => Math.abs(fator.peso)), 0.01);
  renderizar(
    $("[data-fatores]"),
    html`${risco.fatores.map(
      (fator) => html`<li class="inteligencia-fator" data-efeito="${fator.efeito}">
        <span class="inteligencia-fator-nome">${fator.fator}</span>
        <span class="inteligencia-fator-barra"><span style="width: ${((Math.abs(fator.peso) / maximo) * 100).toFixed(1)}%"></span></span>
        <span class="inteligencia-fator-efeito">${fator.efeito === "aumenta" ? "aumenta" : "reduz"}</span>
      </li>`,
    )}`,
  );
  void graficos.distribuicao.renderizar(risco);
  desenharTabelaRisco();
};

const desenharTabelaRisco = (): void => {
  const risco = estado.analise?.risco;
  if (!risco) return;
  const clientes = risco.clientes.filter((cliente) => estado.faixa === "todas" || cliente.faixa === estado.faixa);
  renderizar(
    $("[data-tabela-risco]"),
    html`<caption class="sr-only">Clientes com maior risco de cancelamento</caption>
      <thead><tr><th scope="col">Cliente</th><th scope="col" class="celula-numero">Risco</th><th scope="col" class="celula-moeda">MRR</th><th scope="col">Por quê e o que fazer</th></tr></thead>
      <tbody>${clientes.length
        ? clientes.map((cliente) => {
            const link = linkCliente(cliente.id);
            return html`<tr>
              <td><div class="celula-usuario-texto">${link ? html`<a class="celula-usuario-nome" href="${link}">${nomeCliente(cliente.id)}</a>` : html`<span class="celula-usuario-nome">${nomeCliente(cliente.id)}</span>`}<span class="celula-usuario-email">${nomePlano(cliente.plano)} · ${cliente.ciclo} · ${plural(cliente.meses, "mês", "meses")} de casa</span></div></td>
              <td class="celula-numero"><span class="inteligencia-probabilidade"><span class="emblema emblema-${CORES_FAIXA[cliente.faixa]} emblema-pequeno">${ROTULOS_FAIXA[cliente.faixa]}</span>${fracao(cliente.probabilidade)}</span></td>
              <td class="celula-moeda">${moeda(cliente.mrr)}</td>
              <td><ul class="inteligencia-motivos">${cliente.motivos.map((motivo) => html`<li>${motivo}</li>`)}</ul><p class="inteligencia-acao">${html([icone("lampada")])}<span>${cliente.acao}</span></p></td>
            </tr>`;
          })
        : html`<tr><td colspan="4"><p class="inteligencia-nota-texto">Nenhum cliente nesta faixa.</p></td></tr>`}</tbody>`,
  );
  hidratarIcones(exigir("[data-tabela-risco]"));
};

const preencherSegmentos = (analise: Analise): void => {
  const segmentos = analise.segmentos;
  if (!segmentos) {
    renderizar($("[data-segmentos]"), html`<p class="inteligencia-nota-texto">Ainda não há pagamentos suficientes para segmentar os clientes.</p>`);
    return;
  }
  renderizar(
    $("[data-segmentos]"),
    html`${segmentos.segmentos.map(
      (segmento) => html`<article class="inteligencia-segmento" data-segmento="${segmento.codigo}">
        <header><h3>${segmento.nome}</h3><span class="emblema emblema-neutro emblema-pequeno">${plural(segmento.clientes, "cliente")}</span></header>
        <p class="inteligencia-segmento-receita">${moeda(segmento.receita, { compacto: true })}<span>${fracao(segmento.participacao)} da receita</span></p>
        <span class="barra-progresso barra-progresso-fina"><span class="barra-progresso-valor" style="width: ${(segmento.participacao * 100).toFixed(1)}%"></span></span>
        <p class="inteligencia-segmento-texto">${segmento.descricao}</p>
        <dl class="inteligencia-lista inteligencia-lista-compacta">
          ${html([linhaModelo("Última compra", `${numero(segmento.recencia)} dias (mediana)`)])}
          ${html([linhaModelo("Pagamentos", numero(segmento.frequencia, { casas: 1 }))])}
          ${html([linhaModelo("Ticket médio", moeda(segmento.ticket))])}
        </dl>
        <p class="inteligencia-segmento-acao">${html([icone("lampada")])}<span>${segmento.acao}</span></p>
        ${segmento.exemplos.length ? html`<p class="inteligencia-segmento-exemplos">${segmento.exemplos.slice(0, 4).map((id, indice) => {
          const link = linkCliente(id);
          return html`${indice ? ", " : ""}${link ? html`<a href="${link}">${nomeCliente(id)}</a>` : nomeCliente(id)}`;
        })}</p>` : ""}
      </article>`,
    )}`,
  );
  const maximo = Math.max(...segmentos.matriz.flat(), 1);
  renderizar(
    $("[data-matriz]"),
    html`<span class="inteligencia-matriz-eixo" aria-hidden="true">F ↑</span>${[5, 4, 3, 2, 1].map(
      (f) => html`<span class="inteligencia-matriz-rotulo">${f}</span>${[1, 2, 3, 4, 5].map((r) => {
        const valor = segmentos.matriz[r - 1][f - 1];
        return html`<span class="inteligencia-matriz-celula" data-nivel="${valor <= 0 ? 0 : Math.min(5, Math.ceil((valor / maximo) * 5))}" title="Recência ${r}, frequência ${f}: ${plural(valor, "cliente")}">${numero(valor)}</span>`;
      })}`,
    )}<span></span>${[1, 2, 3, 4, 5].map((r) => html`<span class="inteligencia-matriz-rotulo">${r}</span>`)}<span class="inteligencia-matriz-legenda">Recência →</span>`,
  );
  const grupos = segmentos.agrupamento;
  exigir("[data-grupos-sub]").textContent = grupos ? `${grupos.k} grupos · silhueta ${numero(grupos.silhueta, { casas: 2 })} · amostra de ${plural(grupos.pontos.length, "cliente")}` : "Poucos clientes para agrupar";
  void graficos.grupos.renderizar(segmentos);
};

const nivelRetencao = (valor: number): number => (valor >= 0.9 ? 5 : valor >= 0.7 ? 4 : valor >= 0.5 ? 3 : valor >= 0.3 ? 2 : valor > 0 ? 1 : 0);

const preencherCoortes = (analise: Analise): void => {
  const coortes = analise.coortes;
  if (coortes) {
    const colunas = Math.max(...coortes.linhas.map((linha) => linha.retencao.length), 1);
    renderizar(
      $("[data-coortes]"),
      html`<caption class="sr-only">Retenção por coorte de conversão</caption>
        <thead><tr><th scope="col">Coorte</th>${Array.from({ length: colunas }, (_, indice) => html`<th scope="col" class="celula-numero">Mês ${indice}</th>`)}</tr></thead>
        <tbody>${coortes.linhas.map(
          (linha) => html`<tr>
            <th scope="row" class="coorte-rotulo">${linha.coorte}<span class="coorte-tamanho">${plural(linha.clientes, "cliente")}</span></th>
            ${Array.from({ length: colunas }, (_, indice) => {
              const valor = linha.retencao[indice];
              const receita = linha.receita[indice];
              return valor === undefined || valor === null
                ? html`<td></td>`
                : html`<td class="coorte-celula" data-nivel="${nivelRetencao(valor)}" title="${receita === null || receita === undefined ? "" : `Receita acumulada por cliente: ${moeda(receita)}`}">${percentual(valor * 100, 0)}</td>`;
            })}
          </tr>`,
        )}</tbody>`,
    );
  }
  void graficos.curva.renderizar(coortes);
  const ltv = analise.ltv ?? [];
  renderizar(
    $("[data-tabela-ltv]"),
    html`<caption class="sr-only">Valor do tempo de vida por plano</caption>
      <thead><tr><th scope="col">Plano</th><th scope="col" class="celula-numero">Ativos</th><th scope="col" class="celula-moeda">Ticket mensal</th><th scope="col" class="celula-numero">Churn mensal</th><th scope="col" class="celula-numero">Vida média</th><th scope="col" class="celula-moeda">LTV</th></tr></thead>
      <tbody>${ltv.map(
        (linha) => html`<tr data-total="${linha.plano === "Todos" ? "true" : "false"}">
          <th scope="row">${linha.plano}</th>
          <td class="celula-numero">${numero(linha.ativos)}</td>
          <td class="celula-moeda">${moeda(linha.arpu)}</td>
          <td class="celula-numero">${fracao(linha.churn, 2)}</td>
          <td class="celula-numero">${plural(Math.round(linha.vida_meses), "mês", "meses")}</td>
          <td class="celula-moeda"><strong>${moeda(linha.ltv)}</strong></td>
        </tr>`,
      )}</tbody>`,
  );
};

const lerCenario = (): Record<string, number> => {
  const formulario = exigir<HTMLFormElement>("[data-cenario]");
  const valor = (nome: string) => Number((formulario.elements.namedItem(nome) as HTMLInputElement | HTMLSelectElement).value);
  return { preco: valor("preco"), churnPp: valor("churnPp"), aquisicao: valor("aquisicao"), elasticidade: valor("elasticidade"), meses: valor("meses") };
};

const atualizarSaidas = (): void => {
  $$<HTMLInputElement>("[data-cenario] input[type=range]").forEach((entrada) => {
    const minimo = Number(entrada.min);
    const maximo = Number(entrada.max);
    entrada.style.setProperty("--valor", `${((Number(entrada.value) - minimo) / (maximo - minimo)) * 100}%`);
    const valor = Number(entrada.value);
    const sinal = valor > 0 && entrada.name !== "elasticidade" ? "+" : "";
    exigir(`[data-saida="${entrada.name}"]`).textContent = `${sinal}${numero(valor, { casas: entrada.step.includes(".") ? 1 : 0 })}${entrada.dataset.sufixo ?? ""}`;
  });
};

const diferenca = (valor: number | null | undefined, formato: (v: number) => string): string => {
  const numeroValor = valor ?? 0;
  return `${numeroValor > 0 ? "+" : numeroValor < 0 ? "−" : ""}${formato(Math.abs(numeroValor))}`;
};

const simular = async (): Promise<void> => {
  const pedido = ++estado.simulacao;
  atualizarSaidas();
  try {
    const simulacao = await api.criar<Simulacao>("/ciencia/simulador", lerCenario());
    if (pedido !== estado.simulacao) return;
    const resumo = simulacao.resumo;
    const tom = (valor: number | null | undefined) => ((valor ?? 0) > 0 ? "positivo" : (valor ?? 0) < 0 ? "negativo" : "neutro");
    renderizar(
      $("[data-resumo-simulador]"),
      html`<div class="inteligencia-bloco" data-tom="${tom(resumo.diferenca_mrr)}"><span>MRR no fim</span><strong>${moeda(resumo.mrr_cenario ?? 0, { compacto: true })}</strong><small>${diferenca(resumo.diferenca_mrr, (v) => moeda(v, { compacto: true }))} vs. atual</small></div>
        <div class="inteligencia-bloco" data-tom="${tom(resumo.diferenca_receita)}"><span>Receita no período</span><strong>${moeda(resumo.receita_cenario ?? 0, { compacto: true })}</strong><small>${diferenca(resumo.diferenca_receita, (v) => moeda(v, { compacto: true }))}</small></div>
        <div class="inteligencia-bloco" data-tom="${tom((resumo.ativos_cenario ?? 0) - (resumo.ativos_base ?? 0))}"><span>Clientes no fim</span><strong>${numero(resumo.ativos_cenario ?? 0)}</strong><small>${diferenca((resumo.ativos_cenario ?? 0) - (resumo.ativos_base ?? 0), (v) => numero(v))}</small></div>
        <div class="inteligencia-bloco" data-tom="${tom((resumo.ltv_cenario ?? 0) - (resumo.ltv_base ?? 0))}"><span>LTV</span><strong>${moeda(resumo.ltv_cenario ?? 0, { compacto: true })}</strong><small>churn ${fracao(resumo.churn_cenario, 2)} ao mês</small></div>`,
    );
    void graficos.simulador.renderizar(simulacao);
  } catch (erro) {
    if (pedido === estado.simulacao) avisar({ tipo: "erro", titulo: "Não foi possível simular", texto: mensagemDeErro(erro) });
  }
};

let espera = 0;
const agendarSimulacao = (): void => {
  atualizarSaidas();
  window.clearTimeout(espera);
  espera = window.setTimeout(() => void simular(), 250);
};

const preencherSimulador = (analise: Analise): void => {
  const base = analise.simulador;
  exigir("[data-base-simulador]").textContent = base
    ? `Hoje: ${plural(base.ativos, "cliente pagante", "clientes pagantes")}, ticket de ${moeda(base.arpu)}, churn de ${fracao(base.churn, 2)} e ${numero(base.novos, { casas: 0 })} novos por mês`
    : "Sem clientes pagantes para simular";
  if (base?.ativos) void simular();
};

const preencherQualidade = (analise: Analise): void => {
  const qualidade = analise.qualidade;
  if (!qualidade) return;
  renderizar($("[data-nota]"), html`${html([medidor(qualidade.nota, { rotulo: qualidade.classificacao, tamanho: 148 })])}`);
  renderizar(
    $("[data-campos]"),
    html`${qualidade.campos.map(
      (campo) => html`<li><span>${campo.campo}</span><span class="barra-progresso barra-progresso-fina"><span class="barra-progresso-valor" style="width: ${(campo.preenchimento * 100).toFixed(1)}%"></span></span><strong>${fracao(campo.preenchimento, 0)}</strong></li>`,
    )}`,
  );
  renderizar(
    $("[data-verificacoes]"),
    html`${qualidade.verificacoes.map((verificacao) => {
      const ok = verificacao.afetados === 0;
      const exemplos = COM_CLIENTES.has(verificacao.codigo) ? verificacao.exemplos.map((id) => ({ texto: nomeCliente(id), link: linkCliente(id) })) : verificacao.exemplos.map((texto) => ({ texto, link: null }));
      return html`<li class="inteligencia-verificacao" data-ok="${ok ? "true" : "false"}">
        <span class="inteligencia-verificacao-icone">${html([icone(ok ? "sucesso" : verificacao.severidade === "alta" ? "erro" : "alerta")])}</span>
        <div class="inteligencia-verificacao-texto">
          <p class="inteligencia-verificacao-titulo">${verificacao.titulo}<span class="emblema emblema-${CORES_SEVERIDADE[verificacao.severidade]} emblema-pequeno">${ROTULOS_SEVERIDADE[verificacao.severidade]}</span></p>
          <p class="inteligencia-verificacao-numeros">${ok ? "Nenhum problema encontrado" : `${numero(verificacao.afetados)} de ${numero(verificacao.total)} (${fracao(verificacao.percentual)})`}</p>
          ${ok ? "" : html`<p class="inteligencia-verificacao-dica">${verificacao.recomendacao}</p>`}
          ${!ok && exemplos.length ? html`<p class="inteligencia-verificacao-exemplos">Exemplos: ${exemplos.map((exemplo, indice) => html`${indice ? ", " : ""}${exemplo.link ? html`<a href="${exemplo.link}">${exemplo.texto}</a>` : exemplo.texto}`)}</p>` : ""}
        </div>
        <span class="inteligencia-verificacao-saude" title="Saúde da verificação">${fracao(verificacao.saude, 0)}</span>
      </li>`;
    })}`,
  );
};

const mostrarIndisponivel = (motor: EstadoMotor | null, mensagem: string): void => {
  $("[data-conteudo-inteligencia]")?.setAttribute("hidden", "");
  const caixa = exigir("[data-indisponivel]");
  caixa.hidden = false;
  renderizar(
    caixa,
    html`<div class="vazio">
      <span class="vazio-icone">${html([icone("lampada")])}</span>
      <p class="vazio-titulo">${motor && !motor.configurado ? "O motor analítico está desligado" : "O motor analítico não respondeu"}</p>
      <p class="vazio-texto">${mensagem}</p>
      <div class="inteligencia-passos">
        <p>Com Docker, o serviço <code>analise</code> sobe junto: <code>docker compose up -d</code>.</p>
        <p>Sem Docker: <code>cd analise</code>, <code>pip install -r requirements.txt</code> e <code>uvicorn bento_analise.app:app --port 8090</code>, com <code>BENTO_ANALISE_URL</code> e <code>BENTO_ANALISE_TOKEN</code> definidos no <code>.env</code>.</p>
      </div>
      <button type="button" class="botao botao-secundario" data-acao="tentar">${html([icone("atualizar")])}Tentar de novo</button>
    </div>`,
  );
  hidratarIcones(caixa);
  exigir("[data-acao=tentar]", caixa).addEventListener("click", () => void carregar(true));
};

const preencher = (analise: Analise): void => {
  estado.analise = analise;
  $("[data-conteudo-inteligencia]")?.removeAttribute("hidden");
  exigir("[data-indisponivel]").hidden = true;
  const volumes = analise.volumes;
  exigir("[data-situacao]").textContent = `Calculado ${relativo(analise.gerado_em)} em ${numero(analise.duracao_ms / 1000, { casas: 1 })} s pelo motor Python ${analise.versao} · ${plural(volumes.assinaturas, "assinatura")}, ${plural(volumes.eventos, "pagamento")} e ${plural(volumes.dias, "dia")} de histórico${volumes.truncado ? " (amostra limitada)" : ""}`;
  preencherKpis(analise);
  preencherPrevisoes(analise);
  preencherRisco(analise);
  preencherSegmentos(analise);
  preencherCoortes(analise);
  preencherSimulador(analise);
  preencherQualidade(analise);
  for (const aviso of analise.avisos) avisar({ tipo: "alerta", titulo: "Análise parcial", texto: aviso });
  $$<HTMLButtonElement>("[data-acao=atualizar], [data-acao=excel]").forEach((botao) => (botao.disabled = false));
  hidratarIcones(exigir("[data-conteudo-inteligencia]"));
};

const carregar = async (atualizar = false): Promise<void> => {
  const botao = $<HTMLButtonElement>("[data-acao=atualizar]");
  carregando(botao, true);
  try {
    const analise = await api.obter<Analise>("/ciencia/analise", atualizar ? { atualizar: "1" } : null);
    preencher(analise);
    if (atualizar) avisoSucesso("Análise recalculada com os dados de agora.");
  } catch (erro) {
    if (erro instanceof ErroApi && erro.codigo === "INDISPONIVEL") {
      const motor = await api.obter<EstadoMotor>("/ciencia/estado").catch(() => null);
      mostrarIndisponivel(motor, erro.message);
    } else {
      avisar({ tipo: "erro", titulo: "Não foi possível carregar a análise", texto: mensagemDeErro(erro) });
    }
  } finally {
    carregando(botao, false);
  }
};

const baixarExcel = async (): Promise<void> => {
  const botao = $<HTMLButtonElement>("[data-acao=excel]");
  carregando(botao, true);
  try {
    await api.baixar("/ciencia/relatorio", null, "bento-inteligencia.xlsx");
    avisoSucesso("Relatório em Excel baixado.");
  } catch (erro) {
    avisar({ tipo: "erro", titulo: "Não foi possível gerar o Excel", texto: mensagemDeErro(erro) });
  } finally {
    carregando(botao, false);
  }
};

iniciarPagina({
  pagina: "inteligencia",
  permissao: "analytics.ver",
  aoIniciar: async () => {
    $$("[data-permissao]").forEach((elemento) => {
      if (!pode(elemento.dataset.permissao)) elemento.remove();
    });
    const parametros = parametrosUrl();
    iniciarAbas($("[data-abas]"), {
      inicial: ABAS.includes(parametros.aba ?? "") ? parametros.aba : "previsoes",
      aoTrocar: (nome) => {
        atualizarUrl({ aba: nome === "previsoes" ? null : nome });
        Object.values(graficos).forEach((grafico) => grafico.redesenhar());
      },
    });
    iniciarAbas($("[data-faixas]"), {
      aoTrocar: (nome) => {
        estado.faixa = nome;
        desenharTabelaRisco();
      },
    });
    $("[data-acao=atualizar]")?.addEventListener("click", () => void carregar(true));
    $("[data-acao=excel]")?.addEventListener("click", () => void baixarExcel());
    const cenario = exigir<HTMLFormElement>("[data-cenario]");
    cenario.addEventListener("input", agendarSimulacao);
    cenario.addEventListener("submit", (evento) => evento.preventDefault());
    $("[data-acao=zerar-cenario]")?.addEventListener("click", () => {
      cenario.reset();
      agendarSimulacao();
    });
    atualizarSaidas();
    await carregar();
    if (parametros.excel === "1" && estado.analise && pode("relatorios.gerar")) {
      atualizarUrl({ excel: null });
      void baixarExcel();
    }
  },
});

import type { ApexOptions } from "apexcharts";
import { iniciarPagina } from "../layout/inicio.ts";
import { html, $, $$, exigir, renderizar, parametrosUrl, atualizarUrl } from "../nucleo/dom.ts";
import { icone } from "../nucleo/icones.ts";
import { api, mensagemDeErro } from "../nucleo/api.ts";
import { moeda, numero, percentual, dataIso, somarDias, data } from "../nucleo/formato.ts";
import { Grafico, eixoMoeda, eixoNumero, gradienteArea, coresDoTema } from "../componentes/graficos.ts";
import { tendencia, valorGrande, formatarValor } from "../componentes/indicadores.ts";
import { avisar } from "../componentes/aviso.ts";
import type { FormatoValor } from "../nucleo/tipos.ts";

type Agrupar = "dia" | "semana" | "mes";
type TipoReceita = "area" | "bar";
type Cores = ReturnType<typeof coresDoTema>;

interface Filtros {
  inicio: string;
  fim: string;
  agrupar: Agrupar;
}

interface Comparativo {
  valor: number;
  anterior: number;
  variacao: number | null;
}

interface ResumoAnalytics {
  receita: Comparativo;
  transacoes: Comparativo;
  novosUsuarios: Comparativo;
  visitantes: Comparativo;
  conversao: Comparativo;
  ticketMedio: Comparativo;
  churn: Comparativo;
  mrr: Comparativo;
}

interface SerieAnalytics {
  rotulos: string[];
  receita: number[];
  reembolsos: number[];
  novosUsuarios: number[];
  ativos: number[];
  visitantes: number[];
  sessoes: number[];
  conversoes: number[];
  assinaturasNovas: number[];
  cancelamentos: number[];
}

interface CanalAnalytics {
  canal: string;
  visitantes: number;
  sessoes: number;
  conversoes: number;
  taxa: number;
}

interface DispositivoAnalytics {
  dispositivo: "Desktop" | "Celular" | "Tablet";
  visitantes: number;
  percentual: number;
}

interface PaisAnalytics {
  pais: string;
  codigo: string;
  visitantes: number;
  receita: number;
}

interface PlanoAnalytics {
  codigo: string;
  nome: string;
  receita: number;
  assinaturas: number;
}

interface EtapaFunil {
  etapa: string;
  valor: number;
}

interface Coorte {
  coorte: string;
  rotulo: string;
  tamanho: number;
  retencao: number[];
}

interface MapaCalor {
  dias: string[];
  horas: number[];
  valores: number[][];
}

interface Analytics {
  inicio: string;
  fim: string;
  agrupar: Agrupar;
  resumo: ResumoAnalytics;
  serie: SerieAnalytics;
  canais: CanalAnalytics[];
  dispositivos: DispositivoAnalytics[];
  paises: PaisAnalytics[];
  planos: PlanoAnalytics[];
  funil: EtapaFunil[];
  coortes: Coorte[];
  mapaCalor: MapaCalor;
}

interface ContextoTotal {
  globals: { seriesTotals: number[] };
}

type Dados = Analytics | null | undefined;

const ROTULOS_AGRUPAR: Record<Agrupar, string> = { dia: "Por dia", semana: "Por semana", mes: "Por mês" };
const ICONES_DISPOSITIVO: Record<string, string> = { Desktop: "monitor", Celular: "celular", Tablet: "tablet" };
const FORMATOS_RESUMO: Partial<Record<keyof ResumoAnalytics, FormatoValor>> = { receita: "moeda", novosUsuarios: "numero", visitantes: "numero", conversao: "percentual" };

const AGRUPAMENTOS: readonly Agrupar[] = ["dia", "semana", "mes"];

const ehAborto = (erro: unknown): boolean => (erro as { name?: string } | null)?.name === "AbortError";

const filtrosIniciais = (): Filtros => {
  const parametros = parametrosUrl();
  const hoje = new Date();
  return {
    inicio: parametros.inicio || dataIso(somarDias(hoje, -29)),
    fim: parametros.fim || dataIso(hoje),
    agrupar: (AGRUPAMENTOS as readonly string[]).includes(parametros.agrupar) ? (parametros.agrupar as Agrupar) : "dia",
  };
};

const graficoReceita = (dados: Dados, cores: Cores): ApexOptions => ({
  chart: { type: estado.tipoReceita === "bar" ? "bar" : "area", height: "100%", stacked: false },
  series: [
    { name: "Receita", data: dados?.serie.receita ?? [] },
    { name: "Reembolsos", data: dados?.serie.reembolsos ?? [] },
  ],
  colors: [cores.primaria, cores.brasa],
  stroke: estado.tipoReceita === "bar" ? { width: 0 } : { curve: "straight", width: [1.75, 1.25], dashArray: [0, 4] },
  fill: estado.tipoReceita === "bar" ? { opacity: 1 } : gradienteArea(0.3, 0.02),
  plotOptions: { bar: { columnWidth: "62%", borderRadius: 0, borderRadiusApplication: "end" } },
  xaxis: { categories: dados?.serie.rotulos ?? [], tickAmount: Math.min(window.innerWidth < 640 ? 4 : 10, (dados?.serie.rotulos ?? []).length) },
  yaxis: { tickAmount: 4, labels: { formatter: eixoMoeda } },
  tooltip: { shared: true, intersect: false, y: { formatter: (valor: number) => moeda(valor) } },
});

const graficoDispositivos = (dados: Dados, cores: Cores): ApexOptions => ({
  chart: { type: "donut", height: 180 },
  series: (dados?.dispositivos ?? []).map((item) => item.visitantes),
  labels: (dados?.dispositivos ?? []).map((item) => item.dispositivo),
  colors: [cores.primaria, cores.destaque, cores.salvia],
  stroke: { width: 3, colors: [cores.fundo] },
  plotOptions: { pie: { expandOnClick: false, donut: { size: "70%", labels: { show: true, name: { show: true, fontSize: "11px", color: cores.texto, offsetY: 16 }, value: { show: true, fontSize: "20px", fontWeight: 650, color: cores.textoForte, offsetY: -10, formatter: (valor: string) => numero(Number(valor), { compacto: true }) }, total: { show: true, label: "visitantes", fontSize: "11px", color: cores.texto, formatter: (grafico: ContextoTotal) => numero(grafico.globals.seriesTotals.reduce((a, b) => a + b, 0), { compacto: true }) } } } } },
  tooltip: { y: { formatter: (valor: number) => `${numero(valor)} visitantes` } },
});

const graficoCanais = (dados: Dados, cores: Cores): ApexOptions => ({
  chart: { type: "bar", height: "100%" },
  series: [
    { name: "Visitantes", data: (dados?.canais ?? []).map((item) => item.visitantes) },
    { name: "Conversões", data: (dados?.canais ?? []).map((item) => item.conversoes) },
  ],
  colors: [cores.primaria, cores.destaque],
  plotOptions: { bar: { horizontal: true, barHeight: "68%", borderRadius: 0, borderRadiusApplication: "end" } },
  xaxis: { categories: (dados?.canais ?? []).map((item) => item.canal), labels: { formatter: (valor: string) => eixoNumero(Number(valor)) } },
  legend: { show: true, position: "top", horizontalAlign: "right", fontSize: "12px", markers: { size: 5 } },
  tooltip: { shared: true, intersect: false, y: { formatter: (valor: number) => numero(valor) } },
});

const graficoUsuarios = (dados: Dados, cores: Cores): ApexOptions => ({
  chart: { type: "line", height: "100%" },
  series: [
    { name: "Novos", data: dados?.serie.novosUsuarios ?? [] },
    { name: "Ativos", data: dados?.serie.ativos ?? [] },
  ],
  colors: [cores.primaria, cores.destaque],
  stroke: { curve: "straight", width: 1.75 },
  markers: { size: 0, hover: { size: 4 } },
  xaxis: { categories: dados?.serie.rotulos ?? [], tickAmount: Math.min(window.innerWidth < 640 ? 4 : 8, (dados?.serie.rotulos ?? []).length) },
  yaxis: [
    { seriesName: "Novos", tickAmount: 4, labels: { formatter: eixoNumero } },
    { seriesName: "Ativos", opposite: true, tickAmount: 4, labels: { formatter: eixoNumero } },
  ],
  tooltip: { shared: true, intersect: false, y: { formatter: (valor: number) => numero(valor) } },
});

const graficoAssinaturas = (dados: Dados, cores: Cores): ApexOptions => ({
  chart: { type: "bar", height: "100%" },
  series: [
    { name: "Novas", data: dados?.serie.assinaturasNovas ?? [] },
    { name: "Cancelamentos", data: (dados?.serie.cancelamentos ?? []).map((valor: number) => -valor) },
  ],
  colors: [cores.primaria, cores.brasa],
  plotOptions: { bar: { columnWidth: "70%", borderRadius: 0 } },
  xaxis: { categories: dados?.serie.rotulos ?? [], tickAmount: Math.min(window.innerWidth < 640 ? 4 : 8, (dados?.serie.rotulos ?? []).length) },
  yaxis: { tickAmount: 4, labels: { formatter: (valor: number) => numero(Math.abs(valor)) } },
  tooltip: { shared: true, intersect: false, y: { formatter: (valor: number) => numero(Math.abs(valor)) } },
});

const graficoPlanos = (dados: Dados, cores: Cores): ApexOptions => ({
  chart: { type: "bar", height: "100%" },
  series: [{ name: "Receita", data: (dados?.planos ?? []).map((item) => item.receita) }],
  colors: cores.serie(),
  plotOptions: { bar: { horizontal: true, distributed: true, barHeight: "62%", borderRadius: 0, borderRadiusApplication: "end" } },
  xaxis: { categories: (dados?.planos ?? []).map((item) => item.nome), tickAmount: 4, labels: { formatter: (valor: string) => eixoMoeda(Number(valor)) } },
  tooltip: { y: { formatter: (valor: number) => moeda(valor) } },
});

const criarGraficoReceita = () => new Grafico($('[data-grafico="receita"]'), graficoReceita);

const criarGraficos = () => ({
  receita: criarGraficoReceita(),
  dispositivos: new Grafico($('[data-grafico="dispositivos"]'), graficoDispositivos),
  canais: new Grafico($('[data-grafico="canais"]'), graficoCanais),
  usuarios: new Grafico($('[data-grafico="usuarios"]'), graficoUsuarios),
  assinaturas: new Grafico($('[data-grafico="assinaturas"]'), graficoAssinaturas),
  planos: new Grafico($('[data-grafico="planos"]'), graficoPlanos),
});

interface Estado {
  filtros: Filtros;
  tipoReceita: TipoReceita;
  graficos: ReturnType<typeof criarGraficos> | null;
  dados: Analytics | null;
  controlador: AbortController | null;
}

const estado: Estado = {
  filtros: { inicio: "", fim: "", agrupar: "dia" },
  tipoReceita: "area",
  graficos: null,
  dados: null,
  controlador: null,
};

const preencherResumo = (resumo: ResumoAnalytics): void => {
  for (const [chave, formato] of Object.entries(FORMATOS_RESUMO) as [keyof ResumoAnalytics, FormatoValor][]) {
    const cartao = $(`[data-resumo="${chave}"]`);
    const item = resumo[chave];
    if (!cartao || !item) continue;
    cartao.classList.remove("kpi-carregando");
    exigir("[data-kpi-valor]", cartao).innerHTML = String(valorGrande(item.valor, formato));
    exigir("[data-kpi-tendencia]", cartao).innerHTML = String(tendencia(item.variacao));
    exigir("[data-kpi-comparacao]", cartao).textContent = `Período anterior: ${formatarValor(item.anterior, formato)}`;
  }
  exigir('[data-resumo-texto="transacoes"]').textContent = numero(resumo.transacoes?.valor ?? 0);
  exigir('[data-resumo-texto="ticketMedio"]').textContent = moeda(resumo.ticketMedio?.valor ?? 0);
  exigir('[data-resumo-texto="mrr"]').textContent = moeda(resumo.mrr?.valor ?? 0, { compacto: true });
  exigir('[data-resumo-texto="churn"]').textContent = percentual(resumo.churn?.valor ?? 0);
};

const preencherFunil = (funil: EtapaFunil[]): void => {
  const topo = funil[0]?.valor || 1;
  renderizar(
    $("[data-funil]"),
    html`${funil.map((etapa, indice) => {
      const largura = etapa.valor > 0 ? Math.max(8, (etapa.valor / topo) * 100) : 0;
      const anterior = indice ? funil[indice - 1].valor : null;
      const taxa = indice === 0 ? (etapa.valor > 0 ? "100%" : percentual(0)) : anterior !== null && anterior > 0 ? percentual((etapa.valor / anterior) * 100) : percentual(0);
      return html`<div class="funil-etapa">
        <span class="funil-nome">${etapa.etapa}<small>${numero(etapa.valor, { compacto: etapa.valor >= 10000 })}</small></span>
        <div class="funil-trilho"><span class="funil-barra" style="--valor:${largura.toFixed(1)}%"></span></div>
        <span class="funil-taxa">${taxa}<small>${indice === 0 ? "do total" : "da anterior"}</small></span>
      </div>`;
    })}`,
  );
};

const preencherDispositivos = (dispositivos: DispositivoAnalytics[]): void => {
  renderizar(
    $("[data-dispositivos]"),
    html`${dispositivos.map(
      (item) => html`<div class="analytics-dispositivo">${html([icone(ICONES_DISPOSITIVO[item.dispositivo] ?? "monitor")])}<strong>${percentual(item.percentual, 0)}</strong><span>${item.dispositivo}</span></div>`,
    )}`,
  );
};

const preencherPaises = (paises: PaisAnalytics[]): void => {
  const maximo = Math.max(...paises.map((pais) => pais.visitantes), 1);
  renderizar(
    $("[data-paises]"),
    html`${paises.map(
      (pais) => html`<li class="lista-ranking-item">
        <div class="lista-ranking-topo">
          <span class="lista-ranking-nome"><span class="lista-ranking-bandeira">${pais.codigo}</span>${pais.pais}</span>
          <span class="lista-ranking-valor">${numero(pais.visitantes)}<small>${moeda(pais.receita, { compacto: true })}</small></span>
        </div>
        <div class="lista-ranking-barra"><span style="--valor:${((pais.visitantes / maximo) * 100).toFixed(1)}%"></span></div>
      </li>`,
    )}`,
  );
};

const preencherMapaCalor = (mapa: MapaCalor): void => {
  const alvo = $("[data-mapa-calor]");
  const maximo = Math.max(...mapa.valores.flat(), 1);
  const nivel = (valor: number): number => (valor <= 0 ? 0 : Math.min(5, Math.ceil((valor / maximo) * 5)));
  renderizar(
    alvo,
    html`<span></span>${mapa.horas.map((horaDoDia) => html`<span class="mapa-calor-hora">${horaDoDia}</span>`)}
    ${mapa.dias.map(
      (dia, indiceDia) => html`<span class="mapa-calor-rotulo">${dia}</span>${mapa.valores[indiceDia].map(
        (valor, indiceHora) => html`<span class="mapa-calor-celula" data-nivel="${nivel(valor)}" title="${dia}, ${mapa.horas[indiceHora]}h: ${numero(valor)} transações"></span>`,
      )}`,
    )}`,
  );
};

const nivelRetencao = (valor: number): number => (valor >= 90 ? 5 : valor >= 70 ? 4 : valor >= 50 ? 3 : valor >= 30 ? 2 : valor > 0 ? 1 : 0);

const preencherCoortes = (coortes: Coorte[]): void => {
  const colunas = Math.max(...coortes.map((coorte) => coorte.retencao.length), 1);
  renderizar(
    $("[data-coortes]"),
    html`<caption class="sr-only">Retenção de clientes por mês de cadastro</caption>
      <thead><tr><th scope="col">Coorte</th>${Array.from({ length: colunas }, (_, indice) => html`<th scope="col" class="celula-numero">Mês ${indice}</th>`)}</tr></thead>
      <tbody>
        ${coortes.map(
          (coorte) => html`<tr>
            <th scope="row" class="coorte-rotulo">${coorte.rotulo}<span class="coorte-tamanho">${numero(coorte.tamanho)} clientes</span></th>
            ${Array.from({ length: colunas }, (_, indice) => {
              const valor = coorte.retencao[indice];
              return valor === undefined ? html`<td></td>` : html`<td class="coorte-celula" data-nivel="${nivelRetencao(valor)}">${percentual(valor, 0)}</td>`;
            })}
          </tr>`,
        )}
      </tbody>`,
  );
};

const marcarPredefinicao = (): void => {
  const { inicio, fim } = estado.filtros;
  const dias = Math.round((new Date(fim).getTime() - new Date(inicio).getTime()) / 86400000) + 1;
  const hoje = dataIso(new Date());
  const inicioAno = `${new Date().getFullYear()}-01-01`;
  $$("[data-predefinicao]").forEach((botao) => {
    const valor = botao.dataset.predefinicao;
    const ativo = fim === hoje && (valor === "ano" ? inicio === inicioAno : Number(valor) === dias);
    botao.setAttribute("aria-pressed", String(ativo));
  });
};

const carregar = async (): Promise<void> => {
  estado.controlador?.abort();
  const controlador = new AbortController();
  estado.controlador = controlador;
  atualizarUrl({ ...estado.filtros });
  marcarPredefinicao();
  exigir("[data-rotulo-agrupamento]").textContent = `${ROTULOS_AGRUPAR[estado.filtros.agrupar]}, de ${data(`${estado.filtros.inicio}T12:00:00`)} a ${data(`${estado.filtros.fim}T12:00:00`)}`;
  exigir<HTMLAnchorElement>("[data-exportar]").href = `/relatorios?inicio=${estado.filtros.inicio}&fim=${estado.filtros.fim}`;
  try {
    const dados = await api.obter<Analytics>("/analytics", { ...estado.filtros }, { sinal: controlador.signal });
    estado.dados = dados;
    preencherResumo(dados.resumo);
    preencherFunil(dados.funil);
    preencherDispositivos(dados.dispositivos);
    preencherPaises(dados.paises);
    preencherMapaCalor(dados.mapaCalor);
    preencherCoortes(dados.coortes);
    const graficos = estado.graficos;
    if (graficos) {
      await Promise.all([
        graficos.receita.renderizar(dados),
        graficos.dispositivos.renderizar(dados),
        graficos.canais.renderizar(dados),
        graficos.usuarios.renderizar(dados),
        graficos.assinaturas.renderizar(dados),
        graficos.planos.renderizar(dados),
      ]);
    }
  } catch (erro) {
    if (ehAborto(erro)) return;
    avisar({ tipo: "erro", titulo: "Não foi possível carregar o analytics", texto: mensagemDeErro(erro) });
  }
};

const aplicarPredefinicao = (valor: string | undefined): void => {
  const hoje = new Date();
  estado.filtros.fim = dataIso(hoje);
  if (valor === "ano") estado.filtros.inicio = `${hoje.getFullYear()}-01-01`;
  else estado.filtros.inicio = dataIso(somarDias(hoje, -(Number(valor) - 1)));
  const dias = (new Date(estado.filtros.fim).getTime() - new Date(estado.filtros.inicio).getTime()) / 86400000;
  estado.filtros.agrupar = dias > 120 ? "mes" : dias > 45 ? "semana" : "dia";
};

interface CamposFiltro {
  inicio: HTMLInputElement;
  fim: HTMLInputElement;
  agrupar: HTMLSelectElement;
}

const camposDe = (formulario: HTMLFormElement): CamposFiltro => ({
  inicio: formulario.elements.namedItem("inicio") as HTMLInputElement,
  fim: formulario.elements.namedItem("fim") as HTMLInputElement,
  agrupar: formulario.elements.namedItem("agrupar") as HTMLSelectElement,
});

const sincronizarFormulario = (formulario: HTMLFormElement): void => {
  const campos = camposDe(formulario);
  campos.inicio.value = estado.filtros.inicio;
  campos.fim.value = estado.filtros.fim;
  campos.agrupar.value = estado.filtros.agrupar;
  campos.inicio.max = estado.filtros.fim;
  campos.fim.min = estado.filtros.inicio;
  campos.fim.max = dataIso(new Date());
};

iniciarPagina({
  pagina: "analytics",
  permissao: "analytics.ver",
  aoIniciar: async () => {
    estado.filtros = filtrosIniciais();
    const formulario = exigir<HTMLFormElement>("[data-filtros]");
    sincronizarFormulario(formulario);

    estado.graficos = criarGraficos();

    formulario.addEventListener("change", () => {
      const { inicio, fim, agrupar } = camposDe(formulario);
      if (!inicio.value || !fim.value) return;
      if (inicio.value > fim.value) {
        avisar({ tipo: "alerta", titulo: "Período inválido", texto: "A data inicial precisa vir antes da data final." });
        sincronizarFormulario(formulario);
        return;
      }
      estado.filtros = { inicio: inicio.value, fim: fim.value, agrupar: agrupar.value as Agrupar };
      sincronizarFormulario(formulario);
      carregar();
    });
    formulario.addEventListener("submit", (evento) => evento.preventDefault());

    exigir(".predefinicoes").addEventListener("click", (evento) => {
      const botao = (evento.target as Element | null)?.closest<HTMLElement>("[data-predefinicao]");
      if (!botao) return;
      aplicarPredefinicao(botao.dataset.predefinicao);
      sincronizarFormulario(formulario);
      carregar();
    });

    $$("[data-tipo-receita]").forEach((botao) => {
      botao.addEventListener("click", async () => {
        if (estado.tipoReceita === botao.dataset.tipoReceita) return;
        estado.tipoReceita = botao.dataset.tipoReceita as TipoReceita;
        $$("[data-tipo-receita]").forEach((outro) => outro.setAttribute("aria-pressed", String(outro === botao)));
        const graficos = estado.graficos;
        if (!graficos) return;
        graficos.receita.destruir();
        graficos.receita = criarGraficoReceita();
        if (estado.dados) await graficos.receita.renderizar(estado.dados);
      });
    });

    await carregar();
  },
});

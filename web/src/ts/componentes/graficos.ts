import ApexCharts, { type ApexOptions } from "apexcharts";
import { ouvir } from "../nucleo/eventos.ts";
import { escuroAtivo } from "../nucleo/tema.ts";
import { moeda, numero } from "../nucleo/formato.ts";

const PT_BR = {
  name: "pt-br",
  options: {
    months: ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"],
    shortMonths: ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"],
    days: ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"],
    shortDays: ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"],
    toolbar: {
      exportToSVG: "Baixar SVG",
      exportToPNG: "Baixar PNG",
      exportToCSV: "Baixar CSV",
      menu: "Menu",
      selection: "Selecionar",
      selectionZoom: "Zoom da seleção",
      zoomIn: "Aproximar",
      zoomOut: "Afastar",
      pan: "Mover",
      reset: "Restaurar",
    },
  },
};

const variavel = (nome: string): string => getComputedStyle(document.documentElement).getPropertyValue(nome).trim();

export interface CoresTema {
  escuro: boolean;
  primaria: string;
  primariaForte: string;
  primariaSuave: string;
  destaque: string;
  destaqueSuave: string;
  salvia: string;
  casca: string;
  musgo: string;
  areia: string;
  brasa: string;
  anil: string;
  sucesso: string;
  texto: string;
  textoForte: string;
  grade: string;
  fundo: string;
  destaqueClaro: string;
  primariaTexto: string;
  creme: string;
  tinta: string;
  fonte: string;
  serie(): string[];
}

export type OpcoesGrafico = ApexOptions | Record<string, unknown>;
export type ConstrutorGrafico<D = any> = (dados: D, cores: CoresTema) => OpcoesGrafico;
type Objeto = Record<string, unknown>;

export const coresDoTema = (): CoresTema => {
  const escuro = escuroAtivo();
  const tom = (nome: string, claro: number, noEscuro: number): string => variavel(`--color-${nome}-${escuro ? noEscuro : claro}`);
  return {
    escuro,
    primaria: tom("primaria", 700, 100),
    primariaForte: tom("primaria", 800, 50),
    primariaSuave: tom("primaria", 300, 700),
    destaque: tom("destaque", 500, 400),
    destaqueSuave: tom("destaque", 200, 700),
    salvia: tom("primaria", 500, 500),
    casca: tom("primaria", 200, 600),
    musgo: tom("destaque", 300, 800),
    areia: tom("destaque", 300, 700),
    brasa: tom("brasa", 600, 300),
    anil: tom("anil", 600, 300),
    sucesso: tom("oliva", 600, 300),
    texto: tom("neutra", 600, 400),
    textoForte: tom("neutra", 900, 100),
    grade: tom("neutra", 200, 800),
    fundo: tom("neutra", 50, 900),
    destaqueClaro: variavel("--color-destaque-400"),
    primariaTexto: variavel("--color-primaria-200"),
    creme: variavel("--color-creme"),
    tinta: variavel("--color-tinta"),
    fonte: variavel("--font-sans"),
    serie(this: CoresTema): string[] {
      return [this.primaria, this.salvia, this.destaque, this.casca, this.musgo, this.areia, this.anil];
    },
  };
};

const ehObjeto = (valor: unknown): valor is Objeto => Boolean(valor) && typeof valor === "object" && !Array.isArray(valor);

export const mesclar = <T extends object>(alvo: T, ...fontes: Array<object | null | undefined>): T => {
  const resultado: Objeto = { ...(alvo as Objeto) };
  for (const fonte of fontes) {
    if (!fonte) continue;
    for (const [chave, valor] of Object.entries(fonte)) {
      const atual = resultado[chave];
      resultado[chave] = ehObjeto(valor) && ehObjeto(atual) ? mesclar(atual, valor) : valor;
    }
  }
  return resultado as T;
};

const movimentoReduzido = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const opcoesBase = (cores: CoresTema): ApexOptions => ({
  chart: {
    fontFamily: cores.fonte,
    background: "transparent",
    foreColor: cores.texto,
    toolbar: { show: false },
    zoom: { enabled: false },
    selection: { enabled: false },
    parentHeightOffset: 0,
    redrawOnParentResize: true,
    redrawOnWindowResize: true,
    locales: [PT_BR],
    defaultLocale: "pt-br",
    animations: { enabled: !movimentoReduzido(), speed: 450, animateGradually: { enabled: false } },
  },
  theme: { mode: cores.escuro ? "dark" : "light" },
  colors: cores.serie(),
  dataLabels: { enabled: false },
  legend: { show: false },
  grid: {
    borderColor: cores.grade,
    strokeDashArray: 0,
    padding: { top: -8, right: 8, bottom: -4, left: 8 },
    xaxis: { lines: { show: false } },
  },
  stroke: { lineCap: "butt" },
  states: { hover: { filter: { type: "none" } }, active: { filter: { type: "none" } } },
  tooltip: { theme: cores.escuro ? "dark" : "light", style: { fontSize: "12px", fontFamily: cores.fonte } },
  xaxis: {
    axisBorder: { show: false },
    axisTicks: { show: false },
    crosshairs: { stroke: { color: cores.grade, dashArray: 3 } },
    tooltip: { enabled: false },
    labels: { style: { colors: cores.texto, fontSize: "11px" }, hideOverlappingLabels: true, rotate: 0, trim: false },
  },
  yaxis: { labels: { style: { colors: cores.texto, fontSize: "11px" } } },
  noData: { text: "Sem dados no período", style: { color: cores.texto, fontSize: "13px" } },
});

export class Grafico<D = any> {
  readonly elemento: HTMLElement | null;
  private readonly construtor: ConstrutorGrafico<D>;
  private dados: D | null;
  instancia: ApexCharts | null;
  private readonly pararDeOuvir: () => void;

  constructor(elemento: HTMLElement | null, construtor: ConstrutorGrafico<D>, dados: D | null = null) {
    this.elemento = elemento;
    this.construtor = construtor;
    this.dados = dados;
    this.instancia = null;
    this.pararDeOuvir = ouvir("tema:alterado", () => this.redesenhar());
  }

  opcoes(): ApexOptions {
    const cores = coresDoTema();
    return mesclar(opcoesBase(cores), this.construtor(this.dados as D, cores));
  }

  async renderizar(dados: D | null = this.dados): Promise<this> {
    this.dados = dados;
    if (!this.elemento?.isConnected) return this;
    this.elemento.dataset.carregando = "false";
    if (this.instancia) {
      await this.instancia.updateOptions(this.opcoes(), true, !movimentoReduzido());
      return this;
    }
    this.elemento.innerHTML = "";
    this.instancia = new ApexCharts(this.elemento, this.opcoes());
    await this.instancia.render();
    return this;
  }

  atualizar(dados: D): Promise<this> {
    return this.renderizar(dados);
  }

  redesenhar(): void {
    if (!this.instancia || !this.elemento?.isConnected) return;
    this.instancia.updateOptions(this.opcoes(), false, false);
  }

  destruir(): void {
    this.pararDeOuvir?.();
    this.instancia?.destroy();
    this.instancia = null;
  }
}

export const eixoMoeda = (valor: number): string => moeda(valor, { compacto: true, semCentavos: true });

export const eixoNumero = (valor: number): string => numero(valor, { compacto: true });

export const gradienteArea = (opacidadeInicio = 0.18, opacidadeFim = 0): ApexFill => ({
  type: "gradient",
  gradient: { shadeIntensity: 0, opacityFrom: opacidadeInicio, opacityTo: opacidadeFim, stops: [0, 95] },
});

export interface OpcoesFaisca {
  largura?: number;
  altura?: number;
  tendencia?: string;
  rotulo?: string;
}

export const faisca = (valores: Array<number | string> = [], { largura = 112, altura = 48, tendencia, rotulo = "Tendência" }: OpcoesFaisca = {}): string => {
  const pontos = valores.map(Number).filter((valor) => Number.isFinite(valor));
  if (pontos.length < 2) return `<svg class="faisca" viewBox="0 0 ${largura} ${altura}" role="img" aria-label="${rotulo}: sem dados"></svg>`;
  const minimo = Math.min(...pontos);
  const maximo = Math.max(...pontos);
  const amplitude = maximo - minimo || 1;
  const margem = 4;
  const passo = (largura - margem * 2) / (pontos.length - 1);
  const coordenadas: Array<[number, number]> = pontos.map((valor, indice): [number, number] => [margem + indice * passo, margem + (altura - margem * 2) * (1 - (valor - minimo) / amplitude)]);
  const linha = coordenadas
    .map(([x, y], indice) => {
      if (indice === 0) return `M${x.toFixed(1)} ${y.toFixed(1)}`;
      const [xAnterior, yAnterior] = coordenadas[indice - 1];
      const meio = (xAnterior + x) / 2;
      return `C${meio.toFixed(1)} ${yAnterior.toFixed(1)} ${meio.toFixed(1)} ${y.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const [ultimoX, ultimoY] = coordenadas[coordenadas.length - 1];
  const area = `${linha} L${ultimoX.toFixed(1)} ${altura} L${margem} ${altura} Z`;
  const direcao = tendencia ?? (pontos[pontos.length - 1] >= pontos[0] ? "alta" : "baixa");
  return `<svg class="faisca" data-tendencia="${direcao}" viewBox="0 0 ${largura} ${altura}" preserveAspectRatio="none" role="img" aria-label="${rotulo}"><path class="faisca-area" d="${area}"/><path class="faisca-linha" d="${linha}" vector-effect="non-scaling-stroke"/><circle class="faisca-ponto" cx="${ultimoX.toFixed(1)}" cy="${ultimoY.toFixed(1)}" r="3"/></svg>`;
};

export const barrasMini = (valores: number[] = []): string => {
  const maximo = Math.max(...valores, 1);
  return `<div class="barras-mini" aria-hidden="true">${valores.map((valor) => `<span style="height:${Math.max(6, (valor / maximo) * 100).toFixed(1)}%"></span>`).join("")}</div>`;
};

export interface OpcoesMedidor {
  tamanho?: number;
  espessura?: number;
  rotulo?: string;
}

export const medidor = (percentual: number | string | null | undefined, { tamanho = 132, espessura = 11, rotulo = "" }: OpcoesMedidor = {}): string => {
  const raio = (tamanho - espessura) / 2;
  const circunferencia = 2 * Math.PI * raio;
  const valor = Math.max(0, Math.min(100, Number(percentual) || 0));
  const deslocamento = circunferencia * (1 - valor / 100);
  return `<div class="medidor" role="img" aria-label="${rotulo} ${numero(valor, { casas: 0 })}%"><svg width="${tamanho}" height="${tamanho}" viewBox="0 0 ${tamanho} ${tamanho}"><circle class="medidor-trilho" cx="${tamanho / 2}" cy="${tamanho / 2}" r="${raio}" stroke-width="${espessura}"/><circle class="medidor-valor" cx="${tamanho / 2}" cy="${tamanho / 2}" r="${raio}" stroke-width="${espessura}" stroke-dasharray="${circunferencia.toFixed(2)}" stroke-dashoffset="${deslocamento.toFixed(2)}"/></svg><div class="medidor-centro"><span class="medidor-numero">${numero(valor, { casas: 0 })}%</span>${rotulo ? `<span class="medidor-rotulo">${rotulo}</span>` : ""}</div></div>`;
};

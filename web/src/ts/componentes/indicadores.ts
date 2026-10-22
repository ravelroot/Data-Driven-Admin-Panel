import { html } from "../nucleo/dom.ts";
import { icone } from "../nucleo/icones.ts";
import { moeda, numero, percentual, variacao, partesMoeda } from "../nucleo/formato.ts";
import { faisca, barrasMini } from "./graficos.ts";
import type { Seguro } from "../nucleo/dom.ts";
import type { Kpi } from "../nucleo/tipos.ts";

export type FormatoIndicador = "moeda" | "percentual" | "numero";

export interface OpcoesKpi {
  formato?: FormatoIndicador;
  invertida?: boolean;
  grafico?: "linha" | "barras";
  comparacao?: string;
  compacto?: boolean;
}

type KpiParcial = Pick<Kpi, "valor" | "variacao"> & Partial<Pick<Kpi, "anterior" | "serie">>;

export const formatarValor = (valor: number, formato: string): string => {
  if (formato === "moeda") return moeda(valor, { compacto: Math.abs(valor) >= 100000000 });
  if (formato === "percentual") return percentual(valor);
  return numero(valor);
};

export const tendencia = (valorVariacao: number | null | undefined, { invertida = false, casas = 1 }: { invertida?: boolean; casas?: number } = {}): Seguro => {
  if (valorVariacao === null || valorVariacao === undefined || Number.isNaN(valorVariacao)) {
    return html`<span class="tendencia tendencia-neutra">${html([icone("menos")])}—</span>`;
  }
  const direcao = valorVariacao > 0.05 ? "alta" : valorVariacao < -0.05 ? "baixa" : "neutra";
  const nomeIcone = direcao === "alta" ? "seta-cima-direita" : direcao === "baixa" ? "seta-baixo-direita" : "menos";
  const descricao = direcao === "alta" ? "Aumento de" : direcao === "baixa" ? "Queda de" : "Estável:";
  return html`<span class="tendencia tendencia-${direcao} ${invertida ? "tendencia-invertida" : ""}" title="${descricao} ${variacao(valorVariacao, casas)}"><span class="sr-only">${descricao}</span>${html([icone(nomeIcone)])}${variacao(valorVariacao, casas).replace(/^[+−]/, "")}</span>`;
};

export const valorGrande = (valor: number, formato: string, { compacto = false }: { compacto?: boolean } = {}): Seguro => {
  if (formato === "moeda" && compacto && Math.abs(valor) >= 1000000) {
    const { simbolo, numero: texto } = partesMoeda(valor, { compacto: true });
    return html`<small>${simbolo}</small>${texto}`;
  }
  if (formato === "moeda") {
    const { simbolo, numero: texto } = partesMoeda(valor, { semCentavos: Math.abs(valor) >= 1000000 });
    return html`<small>${simbolo}</small>${texto}`;
  }
  if (formato === "percentual") return html`${numero(valor, { casas: 1 })}<small>%</small>`;
  return html`${numero(valor)}`;
};

export const preencherKpi = (cartao: Element | null | undefined, kpi: KpiParcial | null | undefined, { formato = "numero", invertida = false, grafico = "linha", comparacao = "vs. período anterior", compacto = false }: OpcoesKpi = {}): void => {
  if (!cartao || !kpi) return;
  cartao.classList.remove("kpi-carregando");
  const alvoValor = cartao.querySelector("[data-kpi-valor]");
  const alvoTendencia = cartao.querySelector("[data-kpi-tendencia]");
  const alvoComparacao = cartao.querySelector("[data-kpi-comparacao]");
  const alvoGrafico = cartao.querySelector("[data-kpi-grafico]");
  if (alvoValor) alvoValor.innerHTML = String(valorGrande(kpi.valor, formato, { compacto }));
  if (alvoTendencia) alvoTendencia.innerHTML = String(tendencia(kpi.variacao, { invertida }));
  if (alvoComparacao) alvoComparacao.textContent = kpi.anterior !== undefined ? `${comparacao}: ${compacto && formato === "moeda" ? moeda(kpi.anterior, { compacto: true }) : formatarValor(kpi.anterior, formato)}` : comparacao;
  if (alvoGrafico && kpi.serie?.length) {
    const variacaoKpi = kpi.variacao ?? 0;
    const direcaoRuim = invertida ? variacaoKpi > 0 : variacaoKpi < 0;
    const largo = alvoGrafico.classList.contains("kpi-grafico-largo");
    alvoGrafico.innerHTML = grafico === "barras" ? barrasMini(kpi.serie.slice(-12)) : faisca(kpi.serie, { tendencia: direcaoRuim ? "baixa" : "alta", rotulo: cartao.querySelector(".kpi-rotulo")?.textContent?.trim(), largura: largo ? 320 : 112, altura: largo ? 80 : 48 });
  }
};

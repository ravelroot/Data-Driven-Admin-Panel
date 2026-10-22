const LOCAL = "pt-BR";
let moedaPadrao = "BRL";

export const definirMoeda = (moeda: string | null | undefined): void => {
  if (moeda) moedaPadrao = moeda;
};

type Formato = Intl.NumberFormat | Intl.DateTimeFormat | Intl.RelativeTimeFormat;

const cacheFormatos = new Map<string, Formato>();

const formatador = <F extends Formato>(chave: string, criarFormato: () => F): F => {
  if (!cacheFormatos.has(chave)) cacheFormatos.set(chave, criarFormato());
  return cacheFormatos.get(chave) as F;
};

export interface OpcoesMoeda {
  compacto?: boolean;
  moeda?: string;
  semCentavos?: boolean;
}

export interface OpcoesNumero {
  compacto?: boolean;
  casas?: number;
}

type Valor = number | string | null | undefined;
type DataEntrada = string | number | Date | null | undefined;

export const moeda = (centavos: Valor, { compacto = false, moeda: codigo = moedaPadrao, semCentavos = false }: OpcoesMoeda = {}): string => {
  const valor = Number(centavos ?? 0) / 100;
  if (compacto && Math.abs(valor) >= 10000) {
    return formatador(`moeda-compacta-${codigo}`, () =>
      new Intl.NumberFormat(LOCAL, { style: "currency", currency: codigo, notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 1 }),
    ).format(valor);
  }
  const casas = semCentavos ? 0 : 2;
  return formatador(`moeda-${codigo}-${casas}`, () =>
    new Intl.NumberFormat(LOCAL, { style: "currency", currency: codigo, minimumFractionDigits: casas, maximumFractionDigits: casas }),
  ).format(valor);
};

export const partesMoeda = (centavos: Valor, opcoes: OpcoesMoeda = {}): { simbolo: string; numero: string } => {
  const texto = moeda(centavos, opcoes);
  const correspondencia = texto.match(/^([^\d-]*)(-?[\d.,]+\s?\S*)$/u);
  if (!correspondencia) return { simbolo: "", numero: texto };
  return { simbolo: correspondencia[1].trim(), numero: correspondencia[2].trim() };
};

export const numero = (valor: Valor, { compacto = false, casas = 0 }: OpcoesNumero = {}): string => {
  const chave = `numero-${compacto}-${casas}`;
  return formatador(chave, () =>
    new Intl.NumberFormat(LOCAL, compacto ? { notation: "compact", maximumFractionDigits: 1 } : { minimumFractionDigits: casas, maximumFractionDigits: casas }),
  ).format(Number(valor ?? 0));
};

export const percentual = (valor: Valor, casas = 1): string => {
  if (valor === null || valor === undefined || Number.isNaN(Number(valor))) return "—";
  return `${numero(valor, { casas })}%`;
};

export const variacao = (valor: number | null | undefined, casas = 1): string => {
  if (valor === null || valor === undefined) return "—";
  const sinal = valor > 0 ? "+" : valor < 0 ? "−" : "";
  return `${sinal}${numero(Math.abs(valor), { casas })}%`;
};

const paraData = (valor: string | number | Date): Date => (typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor) ? new Date(`${valor}T12:00:00`) : new Date(valor));

export const data = (iso: DataEntrada, opcoes: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" }): string => {
  if (!iso) return "—";
  const chave = `data-${JSON.stringify(opcoes)}`;
  return formatador(chave, () => new Intl.DateTimeFormat(LOCAL, opcoes)).format(paraData(iso)).replace(/\./g, "");
};

export const dataCurta = (iso: DataEntrada): string => data(iso, { day: "2-digit", month: "2-digit", year: "numeric" });

export const dataHora = (iso: DataEntrada): string => data(iso, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export const hora = (iso: DataEntrada): string => data(iso, { hour: "2-digit", minute: "2-digit" });

const UNIDADES: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 31536000],
  ["month", 2592000],
  ["week", 604800],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];

export const relativo = (iso: DataEntrada): string => {
  if (!iso) return "nunca";
  const segundos = (new Date(iso).getTime() - Date.now()) / 1000;
  const absoluto = Math.abs(segundos);
  if (absoluto < 45) return "agora mesmo";
  const relativa = formatador("relativo", () => new Intl.RelativeTimeFormat(LOCAL, { numeric: "auto" }));
  for (const [unidade, tamanho] of UNIDADES) {
    if (absoluto >= tamanho || unidade === "minute") return relativa.format(Math.round(segundos / tamanho), unidade);
  }
  return relativa.format(Math.round(segundos), "second");
};

export const diaRelativo = (iso: string | number | Date): string => {
  const alvo = new Date(iso);
  const hoje = new Date();
  const inicio = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diferenca = Math.round((inicio(hoje) - inicio(alvo)) / 86400000);
  if (diferenca === 0) return "Hoje";
  if (diferenca === 1) return "Ontem";
  if (diferenca < 7) return data(iso, { weekday: "long" }).replace(/^\w/, (letra) => letra.toUpperCase());
  return data(iso, { day: "2-digit", month: "long", year: "numeric" });
};

export const bytes = (valor: Valor): string => {
  const tamanho = Number(valor ?? 0);
  if (tamanho < 1024) return `${tamanho} B`;
  if (tamanho < 1048576) return `${numero(tamanho / 1024, { casas: 1 })} KB`;
  return `${numero(tamanho / 1048576, { casas: 1 })} MB`;
};

export const iniciais = (nome = ""): string =>
  nome
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((parte, indice, partes) => (indice === 0 || indice === partes.length - 1 ? parte[0] : ""))
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";

export const corAvatar = (texto = ""): number => {
  let soma = 0;
  for (const caractere of texto) soma = (soma * 31 + caractere.charCodeAt(0)) >>> 0;
  return soma % 8;
};

export const dataIso = (d: Date): string => {
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
};

export const somarDias = (d: Date | string | number, dias: number): Date => {
  const copia = new Date(d);
  copia.setDate(copia.getDate() + dias);
  return copia;
};

export const plural = (quantidade: number, singular: string, pluralTexto = `${singular}s`): string => `${numero(quantidade)} ${quantidade === 1 ? singular : pluralTexto}`;

export const rotulos: Record<string, Record<string, string>> = {
  status: { ativo: "Ativo", bloqueado: "Bloqueado", pendente: "Pendente", inativo: "Inativo" },
  transacao: { paga: "Paga", pendente: "Pendente", falhou: "Falhou", reembolsada: "Reembolsada" },
  assinatura: { ativa: "Ativa", teste: "Em teste", cancelada: "Cancelada", inadimplente: "Inadimplente" },
  metodo: { cartao: "Cartão", pix: "Pix", boleto: "Boleto" },
  tipoTransacao: { assinatura: "Assinatura", upgrade: "Upgrade", avulsa: "Avulsa", reembolso: "Reembolso" },
  categoria: { transacao: "Transações", usuario: "Usuários", sistema: "Sistema", seguranca: "Segurança", relatorio: "Relatórios" },
  frequencia: { diaria: "Diária", semanal: "Semanal", mensal: "Mensal" },
  periodo: { "7d": "Últimos 7 dias", "30d": "Últimos 30 dias", "mes-anterior": "Mês anterior" },
  ciclo: { mensal: "Mensal", anual: "Anual" },
};

import type { Consulta } from "./tipos.ts";

const BASE = "/api/v1";

export interface DetalheErro {
  campo?: string;
  mensagem: string;
}

export class ErroApi extends Error {
  readonly status: number;
  readonly codigo: string;
  readonly detalhes: DetalheErro[] | undefined;

  constructor(status: number, codigo: string, mensagem: string, detalhes?: DetalheErro[]) {
    super(mensagem);
    this.name = "ErroApi";
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

const MENSAGENS_PADRAO: Record<number, string> = {
  0: "Não foi possível falar com a API. Confira se ela está rodando e tente de novo.",
  403: "Você não tem permissão para fazer isso.",
  404: "O item procurado não existe mais.",
  429: "Muitas tentativas seguidas. Aguarde um pouco e tente de novo.",
  500: "A API encontrou um erro inesperado. Tente de novo em instantes.",
};

let renovacaoEmAndamento: Promise<boolean> | null = null;

export const irParaEntrar = (): void => {
  if (location.pathname.startsWith("/entrar")) return;
  const voltar = encodeURIComponent(location.pathname + location.search);
  location.replace(`/entrar?voltar=${voltar}`);
};

const renovarSessao = (): Promise<boolean> => {
  if (!renovacaoEmAndamento) {
    renovacaoEmAndamento = fetch(`${BASE}/auth/renovar`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "X-Bento": "1", Accept: "application/json" },
    })
      .then((resposta) => resposta.ok)
      .catch(() => false)
      .finally(() => {
        setTimeout(() => {
          renovacaoEmAndamento = null;
        }, 0);
      });
  }
  return renovacaoEmAndamento;
};

const montarUrl = (caminho: string, consulta?: Consulta | null): URL => {
  const url = new URL(BASE + caminho, location.origin);
  if (consulta) {
    for (const [chave, valor] of Object.entries(consulta)) {
      if (valor === undefined || valor === null || valor === "") continue;
      url.searchParams.set(chave, Array.isArray(valor) ? valor.join(",") : String(valor));
    }
  }
  return url;
};

const erroDaResposta = async (resposta: Response): Promise<ErroApi> => {
  const dados = await resposta.json().catch(() => null);
  return new ErroApi(
    resposta.status,
    dados?.erro?.codigo ?? "INTERNO",
    dados?.erro?.mensagem ?? MENSAGENS_PADRAO[resposta.status] ?? MENSAGENS_PADRAO[500],
    dados?.erro?.detalhes,
  );
};

export interface OpcoesRequisicao {
  corpo?: unknown;
  consulta?: Consulta | null;
  sinal?: AbortSignal;
  bruto?: boolean;
  semRenovar?: boolean;
}

type Metodo = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

async function requisitar(metodo: Metodo, caminho: string, opcoes: OpcoesRequisicao & { bruto: true }, tentativa?: number): Promise<Response>;
async function requisitar(metodo: Metodo, caminho: string, opcoes?: OpcoesRequisicao, tentativa?: number): Promise<any>;
async function requisitar(metodo: Metodo, caminho: string, { corpo, consulta, sinal, bruto = false, semRenovar = false }: OpcoesRequisicao = {}, tentativa = 0): Promise<any> {
  const cabecalhos: Record<string, string> = { "X-Bento": "1", Accept: bruto ? "*/*" : "application/json" };
  let body: string | undefined;
  if (corpo !== undefined) {
    cabecalhos["Content-Type"] = "application/json";
    body = JSON.stringify(corpo);
  }

  let resposta: Response;
  try {
    resposta = await fetch(montarUrl(caminho, consulta), { method: metodo, headers: cabecalhos, body, credentials: "same-origin", signal: sinal });
  } catch (erro) {
    if (erro instanceof DOMException && erro.name === "AbortError") throw erro;
    throw new ErroApi(0, "SEM_CONEXAO", MENSAGENS_PADRAO[0]);
  }

  if (resposta.status === 401 && !semRenovar && tentativa === 0 && !caminho.startsWith("/auth/entrar")) {
    const renovou = await renovarSessao();
    if (renovou) return requisitar(metodo, caminho, { corpo, consulta, sinal, bruto, semRenovar }, 1);
    irParaEntrar();
    throw await erroDaResposta(resposta);
  }

  if (!resposta.ok) throw await erroDaResposta(resposta);
  if (bruto) return resposta;
  if (resposta.status === 204) return null;
  const texto = await resposta.text();
  return texto ? JSON.parse(texto) : null;
}

const nomeDoArquivo = (resposta: Response, padrao: string): string => {
  const disposicao = resposta.headers.get("Content-Disposition") || "";
  const utf = disposicao.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf) return decodeURIComponent(utf[1]);
  const simples = disposicao.match(/filename="?([^";]+)"?/i);
  return simples ? simples[1] : padrao;
};

export const api = {
  obter: <T = any>(caminho: string, consulta?: Consulta | null, opcoes: OpcoesRequisicao = {}): Promise<T> => requisitar("GET", caminho, { consulta, ...opcoes }),
  criar: <T = any>(caminho: string, corpo?: unknown, opcoes: OpcoesRequisicao = {}): Promise<T> => requisitar("POST", caminho, { corpo: corpo ?? {}, ...opcoes }),
  atualizar: <T = any>(caminho: string, corpo?: unknown, opcoes: OpcoesRequisicao = {}): Promise<T> => requisitar("PATCH", caminho, { corpo: corpo ?? {}, ...opcoes }),
  substituir: <T = any>(caminho: string, corpo?: unknown, opcoes: OpcoesRequisicao = {}): Promise<T> => requisitar("PUT", caminho, { corpo: corpo ?? {}, ...opcoes }),
  excluir: <T = any>(caminho: string, opcoes: OpcoesRequisicao = {}): Promise<T> => requisitar("DELETE", caminho, opcoes),
  baixar: async (caminho: string, consulta?: Consulta | null, padrao = "bento-arquivo"): Promise<string> => {
    const resposta = await requisitar("GET", caminho, { consulta, bruto: true });
    const blob = await resposta.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = nomeDoArquivo(resposta, padrao);
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 4000);
    return link.download;
  },
  url: (caminho: string, consulta?: Consulta | null): string => montarUrl(caminho, consulta).toString(),
};

export const mensagemDeErro = (erro: unknown): string => {
  if (erro instanceof ErroApi) return erro.message;
  return MENSAGENS_PADRAO[500];
};

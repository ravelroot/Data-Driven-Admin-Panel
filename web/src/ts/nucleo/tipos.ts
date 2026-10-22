export type Tema = "claro" | "escuro" | "sistema";
export type Densidade = "confortavel" | "compacta";
export type EstadoConexao = "desconectado" | "conectando" | "conectado" | "reconectando";
export type StatusUsuario = "ativo" | "bloqueado" | "pendente" | "inativo";
export type StatusTransacao = "paga" | "pendente" | "falhou" | "reembolsada";
export type TipoNotificacao = "info" | "sucesso" | "alerta" | "erro";
export type CategoriaNotificacao = "transacao" | "usuario" | "sistema" | "seguranca" | "relatorio";
export type FormatoRelatorio = "csv" | "pdf";
export type TipoRelatorio = "receita" | "transacoes" | "usuarios" | "assinaturas" | "crescimento";
export type FormatoValor = "texto" | "moeda" | "numero" | "data" | "percentual";
export type Consulta = Record<string, string | number | boolean | null | undefined | Array<string | number>>;

export interface Referencia {
  codigo: string;
  nome: string;
}

export interface Pessoa {
  id: string;
  nome: string;
  email?: string;
  iniciais?: string;
  status?: StatusUsuario;
}

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  iniciais: string;
  papel: Referencia;
  status: StatusUsuario;
  cargo: string | null;
  empresa: string | null;
  telefone: string | null;
  pais: string | null;
  cidade: string | null;
  plano: Referencia | null;
  ultimoAcesso: string | null;
  criadoEm: string;
  atualizadoEm: string;
  bloqueadoEm: string | null;
  motivoBloqueio: string | null;
}

export interface Transacao {
  id: string;
  codigo: string;
  usuario: Pessoa;
  plano: Referencia | null;
  tipo: "assinatura" | "upgrade" | "avulsa" | "reembolso";
  metodo: "cartao" | "pix" | "boleto";
  status: StatusTransacao;
  valor: number;
  moeda: string;
  criadoEm: string;
}

export interface Atividade {
  id: string | number;
  usuario: Pessoa | null;
  acao: string;
  descricao: string;
  entidade: string | null;
  entidadeId: string | null;
  criadoEm: string;
}

export interface Notificacao {
  id: string;
  tipo: TipoNotificacao;
  categoria: CategoriaNotificacao;
  titulo: string;
  mensagem: string;
  link: string | null;
  lida: boolean;
  criadoEm: string;
}

export interface Kpi {
  valor: number;
  anterior: number;
  variacao: number | null;
  serie: number[];
  rotulos: string[];
}

export interface Pagina<T> {
  itens: T[];
  total: number;
  pagina: number;
  porPagina: number;
  paginas: number;
}

export interface Preferencias {
  tema: Tema;
  paleta: string;
  densidade: Densidade;
  sidebarRecolhida: boolean;
}

export interface Sistema {
  nomeEmpresa: string;
  moeda: string;
  metaMensal: number;
  fuso?: string;
  idiomaPadrao?: string;
}

export interface Sessao {
  usuario: Usuario | null;
  permissoes: Set<string>;
  preferencias: Preferencias | null;
  sistema: Sistema | null;
}

export interface Relatorio {
  id: string;
  nome: string;
  tipo: TipoRelatorio;
  formato: FormatoRelatorio;
  inicio: string;
  fim: string;
  status: "pronto" | "erro";
  linhas: number;
  tamanhoBytes: number;
  criadoPor: Pessoa | null;
  criadoEm: string;
}

export interface Agendamento {
  id: string;
  nome: string;
  tipo: TipoRelatorio;
  formato: FormatoRelatorio;
  frequencia: "diaria" | "semanal" | "mensal";
  periodo: "7d" | "30d" | "mes-anterior";
  ativo: boolean;
  proximaExecucao: string | null;
  ultimaExecucao: string | null;
  criadoEm: string;
}

export interface CampoIntegracao {
  nome: string;
  rotulo: string;
  tipo: "texto" | "url" | "segredo";
  valor: string;
  obrigatorio?: boolean;
}

export interface Integracao {
  id: string;
  provedor: string;
  nome: string;
  descricao: string;
  categoria: string;
  ativo: boolean;
  configurada: boolean;
  status: "conectada" | "desconectada" | "erro";
  ultimoEvento: string | null;
  ultimoErro?: string | null;
  campos: CampoIntegracao[];
}

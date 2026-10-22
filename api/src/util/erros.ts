export type CodigoErro =
  | 'NAO_AUTENTICADO'
  | 'SEM_PERMISSAO'
  | 'SEM_ACESSO_PAINEL'
  | 'NAO_ENCONTRADO'
  | 'VALIDACAO'
  | 'CONFLITO'
  | 'LIMITE'
  | 'CREDENCIAIS'
  | 'BLOQUEADO'
  | 'CSRF'
  | 'INTERNO';

const STATUS_POR_CODIGO: Record<CodigoErro, number> = {
  NAO_AUTENTICADO: 401,
  SEM_PERMISSAO: 403,
  SEM_ACESSO_PAINEL: 403,
  NAO_ENCONTRADO: 404,
  VALIDACAO: 422,
  CONFLITO: 409,
  LIMITE: 429,
  CREDENCIAIS: 401,
  BLOQUEADO: 423,
  CSRF: 403,
  INTERNO: 500,
};

export class ErroApi extends Error {
  readonly codigo: CodigoErro;
  readonly status: number;
  readonly detalhes?: unknown;

  constructor(codigo: CodigoErro, mensagem: string, detalhes?: unknown) {
    super(mensagem);
    this.name = 'ErroApi';
    this.codigo = codigo;
    this.status = STATUS_POR_CODIGO[codigo];
    this.detalhes = detalhes;
  }

  paraJson(): { erro: { codigo: CodigoErro; mensagem: string; detalhes?: unknown } } {
    return {
      erro: {
        codigo: this.codigo,
        mensagem: this.message,
        ...(this.detalhes === undefined ? {} : { detalhes: this.detalhes }),
      },
    };
  }
}

export const naoEncontrado = (o_que: string): ErroApi => new ErroApi('NAO_ENCONTRADO', `${o_que} não encontrado.`);
export const conflito = (mensagem: string): ErroApi => new ErroApi('CONFLITO', mensagem);
export const validacao = (mensagem: string, detalhes?: unknown): ErroApi => new ErroApi('VALIDACAO', mensagem, detalhes);
export const semPermissao = (mensagem = 'Você não tem permissão para esta ação.'): ErroApi =>
  new ErroApi('SEM_PERMISSAO', mensagem);
export const naoAutenticado = (mensagem = 'Faça login para continuar.'): ErroApi =>
  new ErroApi('NAO_AUTENTICADO', mensagem);

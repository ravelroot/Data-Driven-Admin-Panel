import type { FastifyError, FastifyInstance } from 'fastify';
import { ErroApi } from '../util/erros.js';

interface ProblemaZod {
  path: PropertyKey[];
  message: string;
}

function problemasDe(erro: unknown): ProblemaZod[] | null {
  const issues = (erro as { issues?: unknown }).issues;
  return Array.isArray(issues) ? (issues as ProblemaZod[]) : null;
}

const CODIGOS_CONFLITO: Record<string, string> = {
  '23505': 'Já existe um registro com esses dados.',
  '23503': 'O registro está ligado a outros dados e não pode ser alterado assim.',
};

const CODIGOS_VALIDACAO = new Set(['23514', '22P02', '22007', '22008', '22001', '23502']);

export function registrarErros(app: FastifyInstance): void {
  app.setErrorHandler((erro: FastifyError | ErroApi | Error, requisicao, resposta) => {
    if (erro instanceof ErroApi) {
      return resposta.status(erro.status).send(erro.paraJson());
    }
    const problemas = problemasDe(erro);
    if (problemas) {
      const detalhes = problemas.map((problema) => ({
        campo: problema.path.map(String).join('.'),
        mensagem: problema.message,
      }));
      const primeiro = detalhes[0];
      const mensagem = primeiro ? `${primeiro.campo ? `${primeiro.campo}: ` : ''}${primeiro.mensagem}` : 'Dados inválidos.';
      return resposta.status(422).send(new ErroApi('VALIDACAO', mensagem, detalhes).paraJson());
    }
    const codigo = String((erro as { code?: unknown }).code ?? '');
    if (CODIGOS_CONFLITO[codigo]) {
      return resposta.status(409).send(new ErroApi('CONFLITO', CODIGOS_CONFLITO[codigo]).paraJson());
    }
    if (CODIGOS_VALIDACAO.has(codigo)) {
      return resposta.status(422).send(new ErroApi('VALIDACAO', 'Algum valor enviado é inválido.').paraJson());
    }
    const status = (erro as FastifyError).statusCode ?? 500;
    if (status === 429) {
      return resposta.status(429).send(new ErroApi('LIMITE', 'Muitas requisições. Aguarde um pouco e tente de novo.').paraJson());
    }
    if (status === 404) {
      return resposta.status(404).send(new ErroApi('NAO_ENCONTRADO', 'Recurso não encontrado.').paraJson());
    }
    if (status >= 400 && status < 500) {
      return resposta.status(status === 401 ? 401 : 422).send(
        new ErroApi(status === 401 ? 'NAO_AUTENTICADO' : 'VALIDACAO', 'Requisição inválida.', {
          motivo: erro.message,
        }).paraJson(),
      );
    }
    requisicao.log.error({ err: erro }, 'Erro inesperado');
    return resposta.status(500).send(new ErroApi('INTERNO', 'Algo deu errado do nosso lado. Tente de novo.').paraJson());
  });
}

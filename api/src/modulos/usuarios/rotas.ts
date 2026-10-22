import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { exigir } from '../../plugins/autenticacao.js';
import { gerarCsv, type Coluna } from '../../relatorios/csv.js';
import { usuarioAtual } from '../../tipos.js';
import { esquemaPaginacao, esquemaUuid, opcional, paramId, textoOpcional } from '../../util/validacao.js';
import { hojeLocal } from '../metricas/base.js';
import {
  acoesEmMassa,
  atualizarUsuario,
  bloquearUsuario,
  criarUsuario,
  desbloquearUsuario,
  detalharUsuario,
  excluirUsuario,
  linhasExportacaoUsuarios,
  listarPapeis,
  listarPermissoes,
  listarUsuarios,
  obterPermissoesUsuario,
  redefinirSenha,
  salvarPermissoesUsuario,
  type Ator,
} from './servico.js';

const papel = z.string().trim().regex(/^[a-z][a-z0-9_]{1,31}$/, 'Papel inválido.');

const filtros = {
  status: opcional(z.enum(['ativo', 'bloqueado', 'pendente', 'inativo'])),
  papel: opcional(papel),
  plano: opcional(z.string().trim().max(32)),
};

const consultaLista = esquemaPaginacao(['nome', 'email', 'criadoEm', 'ultimoAcesso', 'status', 'papel'] as const, 'criadoEm').extend(
  filtros,
);

const consultaExportar = z.object({
  formato: z.enum(['csv']).default('csv'),
  q: opcional(z.string().trim().max(120)),
  ...filtros,
});

const campos = {
  cargo: textoOpcional(80),
  empresa: textoOpcional(120),
  telefone: textoOpcional(30),
  pais: textoOpcional(60),
  cidade: textoOpcional(80),
};

const corpoCriar = z.object({
  nome: z.string().trim().min(2, 'Informe o nome completo.').max(120),
  email: z.email('E-mail inválido.').max(254),
  papel,
  status: z.enum(['ativo', 'pendente']).default('ativo'),
  senha: opcional(z.string().min(8, 'A senha precisa de pelo menos 8 caracteres.').max(200)),
  ...campos,
});

const corpoAtualizar = z
  .object({
    nome: z.string().trim().min(2).max(120).optional(),
    email: z.email('E-mail inválido.').max(254).optional(),
    papel: papel.optional(),
    status: z.enum(['ativo', 'pendente', 'inativo']).optional(),
    ...campos,
  })
  .strict();

const corpoBloquear = z.object({ motivo: z.string().trim().min(3, 'Explique o motivo do bloqueio.').max(300) });

const listaPermissoes = z.array(z.string().regex(/^[a-z]+\.[a-z]+$/)).max(50);

const corpoPermissoes = z.object({ papel, concedidas: listaPermissoes.default([]), negadas: listaPermissoes.default([]) });

const corpoMassa = z.object({
  ids: z.array(esquemaUuid).min(1).max(200),
  acao: z.enum(['bloquear', 'desbloquear', 'ativar', 'excluir']),
  motivo: opcional(z.string().trim().max(300)),
});

const COLUNAS_USUARIOS: Coluna[] = [
  { campo: 'nome', titulo: 'Nome', formato: 'texto' },
  { campo: 'email', titulo: 'E-mail', formato: 'texto' },
  { campo: 'papel', titulo: 'Papel', formato: 'texto' },
  { campo: 'status', titulo: 'Status', formato: 'texto' },
  { campo: 'plano', titulo: 'Plano', formato: 'texto' },
  { campo: 'empresa', titulo: 'Empresa', formato: 'texto' },
  { campo: 'cargo', titulo: 'Cargo', formato: 'texto' },
  { campo: 'pais', titulo: 'País', formato: 'texto' },
  { campo: 'cidade', titulo: 'Cidade', formato: 'texto' },
  { campo: 'criadoEm', titulo: 'Cadastrado em', formato: 'data' },
  { campo: 'ultimoAcesso', titulo: 'Último acesso', formato: 'data' },
];

function ator(requisicao: FastifyRequest): Ator {
  return { usuario: usuarioAtual(requisicao), ip: requisicao.ip };
}

const id = (requisicao: FastifyRequest) => (requisicao.params as z.infer<typeof paramId>).id;

export async function rotasUsuarios(app: FastifyInstance): Promise<void> {
  const tags = ['Usuários'];
  const pode = (...permissoes: string[]) => [app.autenticar, exigir(...permissoes)];

  app.get(
    '/usuarios',
    { schema: { tags, summary: 'Lista paginada com busca, filtros, ordenação e contagens', querystring: consultaLista }, preHandler: pode('usuarios.ver') },
    async (requisicao) => listarUsuarios(app.banco, requisicao.query as z.infer<typeof consultaLista>),
  );

  app.post(
    '/usuarios',
    { schema: { tags, summary: 'Cadastra um usuário', body: corpoCriar }, preHandler: pode('usuarios.criar') },
    async (requisicao, resposta) => {
      const resultado = await criarUsuario(app, ator(requisicao), requisicao.body as z.infer<typeof corpoCriar>);
      return resposta.status(201).send(resultado);
    },
  );

  app.get(
    '/usuarios/exportar',
    { schema: { tags, summary: 'Exporta os usuários filtrados em CSV', querystring: consultaExportar }, preHandler: pode('usuarios.ver') },
    async (requisicao, resposta) => {
      const linhas = await linhasExportacaoUsuarios(app.banco, requisicao.query as z.infer<typeof consultaExportar>);
      return resposta
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="bento-usuarios-${hojeLocal(app.config.fuso)}.csv"`)
        .send(gerarCsv(COLUNAS_USUARIOS, linhas, app.config.fuso));
    },
  );

  app.post(
    '/usuarios/acoes-em-massa',
    { schema: { tags, summary: 'Bloqueia, desbloqueia, ativa ou exclui vários usuários', body: corpoMassa }, preHandler: pode('usuarios.ver') },
    async (requisicao) => acoesEmMassa(app, ator(requisicao), requisicao.body as z.infer<typeof corpoMassa>),
  );

  app.get(
    '/usuarios/:id',
    { schema: { tags, summary: 'Detalhe com assinatura, transações e atividades', params: paramId }, preHandler: pode('usuarios.ver') },
    async (requisicao) => detalharUsuario(app.banco, id(requisicao)),
  );

  app.patch(
    '/usuarios/:id',
    { schema: { tags, summary: 'Edita os dados de um usuário', params: paramId, body: corpoAtualizar }, preHandler: pode('usuarios.editar') },
    async (requisicao) => atualizarUsuario(app, ator(requisicao), id(requisicao), requisicao.body as z.infer<typeof corpoAtualizar>),
  );

  app.delete(
    '/usuarios/:id',
    { schema: { tags, summary: 'Exclui um usuário', params: paramId }, preHandler: pode('usuarios.excluir') },
    async (requisicao, resposta) => {
      await excluirUsuario(app, ator(requisicao), id(requisicao));
      return resposta.status(204).send();
    },
  );

  app.post(
    '/usuarios/:id/bloquear',
    { schema: { tags, summary: 'Bloqueia a conta e encerra as sessões', params: paramId, body: corpoBloquear }, preHandler: pode('usuarios.bloquear') },
    async (requisicao) =>
      bloquearUsuario(app, ator(requisicao), id(requisicao), (requisicao.body as z.infer<typeof corpoBloquear>).motivo),
  );

  app.post(
    '/usuarios/:id/desbloquear',
    { schema: { tags, summary: 'Desbloqueia a conta', params: paramId }, preHandler: pode('usuarios.bloquear') },
    async (requisicao) => desbloquearUsuario(app, ator(requisicao), id(requisicao)),
  );

  app.post(
    '/usuarios/:id/redefinir-senha',
    { schema: { tags, summary: 'Gera uma senha temporária', params: paramId }, preHandler: pode('usuarios.editar') },
    async (requisicao) => redefinirSenha(app, ator(requisicao), id(requisicao)),
  );

  app.get(
    '/usuarios/:id/permissoes',
    { schema: { tags, summary: 'Papel, permissões do papel e ajustes individuais', params: paramId }, preHandler: pode('usuarios.ver') },
    async (requisicao) => obterPermissoesUsuario(app.banco, id(requisicao)),
  );

  app.put(
    '/usuarios/:id/permissoes',
    { schema: { tags, summary: 'Define o papel e as permissões individuais', params: paramId, body: corpoPermissoes }, preHandler: pode('usuarios.permissoes') },
    async (requisicao) =>
      salvarPermissoesUsuario(app, ator(requisicao), id(requisicao), requisicao.body as z.infer<typeof corpoPermissoes>),
  );

  app.get(
    '/papeis',
    { schema: { tags, summary: 'Papéis com permissões e quantidade de usuários' }, preHandler: pode('usuarios.ver') },
    async () => listarPapeis(app.banco),
  );

  app.get(
    '/permissoes',
    { schema: { tags, summary: 'Catálogo de permissões' }, preHandler: pode('usuarios.ver') },
    async () => listarPermissoes(app.banco),
  );
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { exigir } from '../../plugins/autenticacao.js';
import { usuarioAtual } from '../../tipos.js';
import { opcional, paramId, textoOpcional } from '../../util/validacao.js';
import {
  ALTURAS_CARTAO,
  buscarUsuario,
  ITENS_POR_PAGINA,
  LARGURAS_CARTAO,
  type Preferencias,
  obterConfigSistema,
  obterPreferencias,
  PAGINAS_INICIAIS,
} from '../comum/consultas.js';
import {
  atualizarPerfil,
  criarChave,
  listarChaves,
  listarSessoes,
  revogarChave,
  revogarSessao,
  salvarPreferencias,
  salvarConfigSistema,
  trocarSenha,
  validarPapeisDoisFatores,
} from './servico.js';

const corpoPerfil = z
  .object({
    nome: z.string().trim().min(2).max(120).optional(),
    cargo: textoOpcional(80),
    telefone: textoOpcional(30),
    empresa: textoOpcional(120),
    pais: textoOpcional(60),
    cidade: textoOpcional(80),
    email: z.email('E-mail inválido.').max(254).optional(),
    senhaAtual: opcional(z.string().max(200)),
  })
  .strict();

const itemLayout = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/, 'Identificador de cartão inválido.'),
    largura: z.enum(LARGURAS_CARTAO),
    altura: z.enum(ALTURAS_CARTAO),
    oculto: z.boolean(),
  })
  .strict();

const layoutVisaoGeral = z
  .array(itemLayout)
  .max(40)
  .refine((itens) => new Set(itens.map((item) => item.id)).size === itens.length, 'Cada cartão aparece uma vez só.')
  .nullable();

const corpoAparencia = z
  .object({
    tema: z.enum(['claro', 'escuro', 'sistema']).optional(),
    paleta: z.enum(['bento', 'oliva', 'grafite', 'oceano', 'terracota', 'ameixa', 'floresta', 'ardosia', 'vinho', 'lavanda', 'cobre', 'petroleo', 'girassol', 'menta', 'noite', 'areia']).optional(),
    densidade: z.enum(['confortavel', 'compacta']).optional(),
    sidebarRecolhida: z.boolean().optional(),
    paginaInicial: z.enum(PAGINAS_INICIAIS).optional(),
    itensPorPagina: z
      .number()
      .int()
      .refine((valor) => (ITENS_POR_PAGINA as readonly number[]).includes(valor), 'Use 10, 25, 50 ou 100.')
      .optional(),
    movimento: z.enum(['sistema', 'reduzido']).optional(),
    atalhosTeclado: z.boolean().optional(),
    primeirosPassosOcultos: z.boolean().optional(),
    layoutVisaoGeral: layoutVisaoGeral.optional(),
  })
  .strict();

const corpoSenha = z.object({
  senhaAtual: z.string().min(1, 'Informe a senha atual.').max(200),
  novaSenha: z.string().min(8, 'A nova senha precisa de pelo menos 8 caracteres.').max(200),
});

const corpoChave = z.object({
  nome: z.string().trim().min(2).max(60),
  escopos: z.array(z.enum(['leitura', 'escrita'])).min(1).max(2),
});

const corpoSistema = z
  .object({
    nomeEmpresa: z.string().trim().min(2).max(80).optional(),
    moeda: z.enum(['BRL', 'USD', 'EUR']).optional(),
    fuso: z
      .string()
      .trim()
      .regex(/^[A-Za-z_]+\/[A-Za-z_]+(\/[A-Za-z_]+)?$/, 'Fuso inválido.')
      .optional(),
    metaMensal: z.number().int().min(100).max(100_000_000_000).optional(),
    idiomaPadrao: z.enum(['pt-BR', 'en-US', 'es-ES']).optional(),
    doisFatoresPapeis: z.array(z.string().trim().regex(/^[a-z][a-z0-9_]{1,31}$/, 'Papel inválido.')).max(20).optional(),
  })
  .strict();

export async function rotasConfiguracoes(app: FastifyInstance): Promise<void> {
  const tags = ['Configurações'];
  const autenticado = [app.autenticar];

  app.get('/configuracoes/perfil', { schema: { tags, summary: 'Perfil da pessoa logada' }, preHandler: autenticado }, async (requisicao) =>
    buscarUsuario(app.banco, usuarioAtual(requisicao).id),
  );

  app.patch(
    '/configuracoes/perfil',
    { schema: { tags, summary: 'Atualiza o próprio perfil', body: corpoPerfil }, preHandler: autenticado },
    async (requisicao) =>
      atualizarPerfil(app.banco, usuarioAtual(requisicao).id, requisicao.body as z.infer<typeof corpoPerfil>, requisicao.ip),
  );

  for (const caminho of ['/configuracoes/aparencia', '/configuracoes/preferencias']) {
    app.get(caminho, { schema: { tags, summary: 'Aparência e preferências de uso da pessoa logada' }, preHandler: autenticado }, async (requisicao) =>
      obterPreferencias(app.banco, usuarioAtual(requisicao).id),
    );

    app.put(
      caminho,
      {
        schema: {
          tags,
          summary: 'Salva tema, paleta, densidade, menu, página inicial, itens por página, movimento, atalhos, primeiros passos e o layout da visão geral',
          body: corpoAparencia,
        },
        preHandler: autenticado,
      },
      async (requisicao) =>
        salvarPreferencias(app.banco, usuarioAtual(requisicao).id, requisicao.body as Partial<Preferencias>),
    );
  }

  app.post(
    '/configuracoes/seguranca/senha',
    {
      schema: { tags, summary: 'Troca a senha e encerra as outras sessões', body: corpoSenha },
      preHandler: autenticado,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (requisicao) => {
      const usuario = usuarioAtual(requisicao);
      const corpo = requisicao.body as z.infer<typeof corpoSenha>;
      await trocarSenha(app.banco, usuario.id, usuario.sessaoId, corpo.senhaAtual, corpo.novaSenha, requisicao.ip);
      return { ok: true };
    },
  );

  app.get(
    '/configuracoes/seguranca/sessoes',
    { schema: { tags, summary: 'Sessões abertas' }, preHandler: autenticado },
    async (requisicao) => {
      const usuario = usuarioAtual(requisicao);
      return listarSessoes(app.banco, usuario.id, usuario.sessaoId);
    },
  );

  app.delete(
    '/configuracoes/seguranca/sessoes/:id',
    { schema: { tags, summary: 'Encerra uma sessão', params: paramId }, preHandler: autenticado },
    async (requisicao, resposta) => {
      await revogarSessao(app.banco, usuarioAtual(requisicao).id, (requisicao.params as z.infer<typeof paramId>).id);
      return resposta.status(204).send();
    },
  );

  app.delete(
    '/configuracoes/seguranca/sessoes',
    { schema: { tags, summary: 'Encerra todas as outras sessões' }, preHandler: autenticado },
    async (requisicao) => {
      const usuario = usuarioAtual(requisicao);
      const { total } = await app.banco.consultar(
        `update sessoes set revogada_em = now()
          where usuario_id = $1 and revogada_em is null and ($2::uuid is null or id <> $2::uuid)`,
        [usuario.id, usuario.sessaoId],
      );
      return { revogadas: total };
    },
  );

  app.get('/configuracoes/chaves-api', { schema: { tags, summary: 'Chaves de API ativas' }, preHandler: autenticado }, async (requisicao) =>
    listarChaves(app.banco, usuarioAtual(requisicao).id),
  );

  app.post(
    '/configuracoes/chaves-api',
    { schema: { tags, summary: 'Cria uma chave de API (o segredo aparece uma vez)', body: corpoChave }, preHandler: autenticado },
    async (requisicao, resposta) => {
      const corpo = requisicao.body as z.infer<typeof corpoChave>;
      const criada = await criarChave(app.banco, usuarioAtual(requisicao).id, corpo.nome, corpo.escopos, requisicao.ip);
      return resposta.status(201).send(criada);
    },
  );

  app.delete(
    '/configuracoes/chaves-api/:id',
    { schema: { tags, summary: 'Revoga uma chave de API', params: paramId }, preHandler: autenticado },
    async (requisicao, resposta) => {
      await revogarChave(app.banco, usuarioAtual(requisicao).id, (requisicao.params as z.infer<typeof paramId>).id, requisicao.ip);
      return resposta.status(204).send();
    },
  );

  app.get('/configuracoes/sistema', { schema: { tags, summary: 'Configurações gerais' }, preHandler: autenticado }, async () =>
    obterConfigSistema(app.banco),
  );

  app.put(
    '/configuracoes/sistema',
    {
      schema: { tags, summary: 'Altera as configurações gerais', body: corpoSistema },
      preHandler: [app.autenticar, exigir('configuracoes.sistema')],
    },
    async (requisicao) => {
      const usuario = usuarioAtual(requisicao);
      const corpo = requisicao.body as z.infer<typeof corpoSistema>;
      if (corpo.doisFatoresPapeis) corpo.doisFatoresPapeis = await validarPapeisDoisFatores(app.banco, usuario.id, usuario.papel, corpo.doisFatoresPapeis);
      return salvarConfigSistema(app.banco, app.config.fuso, usuario.id, corpo, requisicao.ip);
    },
  );
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { exigir } from '../../plugins/autenticacao.js';
import { iniciais } from '../../util/formato.js';
import { filtroBusca } from '../../util/validacao.js';

const consulta = z.object({ q: z.string().trim().min(2, 'Digite pelo menos 2 caracteres.').max(120) });

export async function rotasBusca(app: FastifyInstance): Promise<void> {
  app.get(
    '/busca',
    {
      schema: { tags: ['Busca'], summary: 'Busca global por usuários e transações', querystring: consulta },
      preHandler: [app.autenticar, exigir('painel.ver')],
    },
    async (requisicao) => {
      const { q } = requisicao.query as z.infer<typeof consulta>;
      const usuario = requisicao.usuario;
      const termo = filtroBusca(q);
      const podeUsuarios = usuario?.permissoes.has('usuarios.ver') ?? false;
      const podeTransacoes = usuario?.permissoes.has('transacoes.ver') ?? false;
      const [usuarios, transacoes] = await Promise.all([
        podeUsuarios
          ? app.banco.consultar<{ id: string; nome: string; email: string; status: string }>(
              `select id, nome, email, status from usuarios
                where nome ilike $1 or email ilike $1
                order by (lower(nome) like lower($2)) desc, nome
                limit 5`,
              [termo, `${q.replace(/[\\%_]/g, (caractere) => `\\${caractere}`)}%`],
            )
          : Promise.resolve({ linhas: [], total: 0 }),
        podeTransacoes
          ? app.banco.consultar<{ id: string; codigo: string; valor: number; status: string; nome: string }>(
              `select t.id, t.codigo, t.valor, t.status, coalesce(u.nome, t.cliente_nome) as nome
                 from transacoes t left join usuarios u on u.id = t.usuario_id
                where t.codigo ilike $1 or coalesce(u.nome, t.cliente_nome) ilike $1
                order by t.criado_em desc
                limit 5`,
              [termo],
            )
          : Promise.resolve({ linhas: [], total: 0 }),
      ]);
      return {
        usuarios: usuarios.linhas.map((linha) => ({ ...linha, iniciais: iniciais(linha.nome) })),
        transacoes: transacoes.linhas.map((linha) => ({
          id: linha.id,
          codigo: linha.codigo,
          valor: linha.valor,
          status: linha.status,
          usuario: { nome: linha.nome },
        })),
      };
    },
  );
}

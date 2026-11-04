import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Banco } from '../banco/conexao.js';
import { registrarAtividade } from '../modulos/comum/auditoria.js';
import { ErroApi } from '../util/erros.js';

export interface EstadoManutencao {
  ativo: boolean;
  mensagem: string;
  desde: string | null;
  porId: string | null;
  porNome: string | null;
}

export const MANUTENCAO_DESLIGADA: EstadoManutencao = { ativo: false, mensagem: '', desde: null, porId: null, porNome: null };

export const PERMISSAO_MANUTENCAO = 'configuracoes.sistema';

const METODOS_LEITURA = new Set(['GET', 'HEAD', 'OPTIONS']);

const ISENTAS = [
  /^\/api\/v1\/auth\//,
  /^\/api\/v1\/notificacoes\/[^/]+\/ler$/,
  /^\/api\/v1\/notificacoes\/ler-todas$/,
  /^\/api\/v1\/configuracoes\/(aparencia|preferencias)$/,
];

function normalizar(valor: unknown): EstadoManutencao {
  const bruto = (valor && typeof valor === 'object' ? valor : {}) as Record<string, unknown>;
  return {
    ativo: bruto.ativo === true,
    mensagem: typeof bruto.mensagem === 'string' ? bruto.mensagem.slice(0, 300) : '',
    desde: typeof bruto.desde === 'string' ? bruto.desde : null,
    porId: typeof bruto.porId === 'string' ? bruto.porId : null,
    porNome: typeof bruto.porNome === 'string' ? bruto.porNome : null,
  };
}

export async function lerManutencao(banco: Banco): Promise<EstadoManutencao> {
  const { linhas } = await banco.consultar<{ valor: unknown }>(`select valor from configuracoes_sistema where chave = 'manutencao'`);
  return normalizar(linhas[0]?.valor);
}

export async function sincronizarManutencao(app: FastifyInstance): Promise<EstadoManutencao> {
  const estado = await lerManutencao(app.banco).catch(() => app.estado.manutencao);
  app.estado.manutencao = estado;
  return estado;
}

export async function definirManutencao(
  app: FastifyInstance,
  dados: { ativo: boolean; mensagem?: string | null },
  autor: { id: string; nome: string },
  ip: string,
): Promise<EstadoManutencao> {
  const atual = await lerManutencao(app.banco);
  const mensagem = (dados.mensagem ?? atual.mensagem ?? '').trim().slice(0, 300);
  const novo: EstadoManutencao = dados.ativo
    ? { ativo: true, mensagem, desde: atual.ativo && atual.desde ? atual.desde : new Date().toISOString(), porId: autor.id, porNome: autor.nome }
    : { ...MANUTENCAO_DESLIGADA, mensagem };
  await app.banco.transacao(async (tx) => {
    await tx.consultar(
      `insert into configuracoes_sistema (chave, valor, atualizado_em) values ('manutencao', $1::jsonb, now())
       on conflict (chave) do update set valor = excluded.valor, atualizado_em = now()`,
      [JSON.stringify(novo)],
    );
    if (atual.ativo !== novo.ativo) {
      await registrarAtividade(tx, {
        usuarioId: autor.id,
        acao: novo.ativo ? 'sistema.manutencao_ativada' : 'sistema.manutencao_encerrada',
        entidade: 'sistema',
        descricao: novo.ativo ? 'ativou o modo de manutenção' : 'encerrou o modo de manutenção',
        detalhes: novo.ativo && mensagem ? { mensagem } : {},
        ip,
      });
    }
  });
  app.estado.manutencao = novo;
  await app.barramento.publicar({ tipo: 'sistema', destinatarioId: null, dados: { manutencao: novo } });
  return novo;
}

export function rotaIsenta(url: string): boolean {
  const caminho = url.split('?')[0] ?? url;
  return ISENTAS.some((padrao) => padrao.test(caminho));
}

export function erroManutencao(estado: EstadoManutencao): ErroApi {
  const complemento = estado.mensagem ? ` ${estado.mensagem}` : '';
  return new ErroApi('MANUTENCAO', `O painel está em manutenção e aceita só consultas por enquanto.${complemento}`);
}

export function registrarModoManutencao(app: FastifyInstance): void {
  app.addHook('preHandler', async (requisicao: FastifyRequest, resposta) => {
    const estado = app.estado.manutencao;
    if (!estado.ativo) return;
    if (METODOS_LEITURA.has(requisicao.method) || !requisicao.url.startsWith('/api/') || rotaIsenta(requisicao.url)) return;
    try {
      await app.autenticar(requisicao, resposta);
    } catch {
      throw erroManutencao(estado);
    }
    if (!requisicao.usuario?.permissoes.has(PERMISSAO_MANUTENCAO)) throw erroManutencao(estado);
  });
}

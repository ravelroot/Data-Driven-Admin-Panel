import type { FastifyInstance } from 'fastify';
import type { Banco } from '../../banco/conexao.js';
import { naoEncontrado, semPermissao } from '../../util/erros.js';
import { iniciais } from '../../util/formato.js';
import { registrarAtividade } from '../comum/auditoria.js';
import { buscarUsuario } from '../comum/consultas.js';
import type { Ator } from './servico.js';

export interface NotaUsuario {
  id: string;
  texto: string;
  fixada: boolean;
  criadoEm: string;
  atualizadoEm: string;
  editada: boolean;
  autor: { id: string; nome: string; iniciais: string } | null;
  podeAlterar: boolean;
}

interface LinhaNota {
  id: string;
  texto: string;
  fixada: boolean;
  criado_em: Date | string;
  atualizado_em: Date | string;
  autor_id: string | null;
  autor_nome: string | null;
}

const SELECAO = `
  select n.id::text as id, n.texto, n.fixada, n.criado_em, n.atualizado_em, n.autor_id::text as autor_id, a.nome as autor_nome
    from notas_usuario n
    left join usuarios a on a.id = n.autor_id
`;

const iso = (valor: Date | string): string => new Date(valor instanceof Date ? valor.toISOString() : valor).toISOString();

const moderador = (ator: Ator): boolean => ator.usuario.permissoes.has('usuarios.permissoes');

function mapear(linha: LinhaNota, ator: Ator): NotaUsuario {
  const criadoEm = iso(linha.criado_em);
  const atualizadoEm = iso(linha.atualizado_em);
  return {
    id: linha.id,
    texto: linha.texto,
    fixada: Boolean(linha.fixada),
    criadoEm,
    atualizadoEm,
    editada: new Date(atualizadoEm).getTime() - new Date(criadoEm).getTime() > 1000,
    autor: linha.autor_id && linha.autor_nome ? { id: linha.autor_id, nome: linha.autor_nome, iniciais: iniciais(linha.autor_nome) } : null,
    podeAlterar: ator.usuario.permissoes.has('usuarios.anotar') && (linha.autor_id === ator.usuario.id || moderador(ator)),
  };
}

export async function contarNotas(banco: Banco, usuarioId: string): Promise<{ total: number; fixadas: number }> {
  const { linhas } = await banco.consultar<{ total: number; fixadas: number }>(
    'select count(*)::int as total, count(*) filter (where fixada)::int as fixadas from notas_usuario where usuario_id = $1',
    [usuarioId],
  );
  return { total: linhas[0]?.total ?? 0, fixadas: linhas[0]?.fixadas ?? 0 };
}

export async function listarNotas(banco: Banco, ator: Ator, usuarioId: string): Promise<NotaUsuario[]> {
  await buscarUsuario(banco, usuarioId);
  const { linhas } = await banco.consultar<LinhaNota>(
    `${SELECAO} where n.usuario_id = $1 order by n.fixada desc, n.criado_em desc limit 200`,
    [usuarioId],
  );
  return linhas.map((linha) => mapear(linha, ator));
}

async function buscarNota(banco: Banco, ator: Ator, usuarioId: string, notaId: string): Promise<NotaUsuario> {
  const { linhas } = await banco.consultar<LinhaNota>(`${SELECAO} where n.id = $1 and n.usuario_id = $2`, [notaId, usuarioId]);
  const linha = linhas[0];
  if (!linha) throw naoEncontrado('Nota');
  return mapear(linha, ator);
}

const resumir = (texto: string): string => (texto.length > 80 ? `${texto.slice(0, 77)}...` : texto);

export async function criarNota(
  app: FastifyInstance,
  ator: Ator,
  usuarioId: string,
  dados: { texto: string; fixada?: boolean },
): Promise<NotaUsuario> {
  const { banco } = app;
  const alvo = await buscarUsuario(banco, usuarioId);
  const id = await banco.transacao(async (tx) => {
    const { linhas } = await tx.consultar<{ id: string }>(
      'insert into notas_usuario (usuario_id, autor_id, texto, fixada) values ($1, $2, $3, $4) returning id::text as id',
      [usuarioId, ator.usuario.id, dados.texto, dados.fixada ?? false],
    );
    const novo = linhas[0]?.id ?? '';
    await registrarAtividade(tx, {
      usuarioId: ator.usuario.id,
      acao: 'usuario.nota_adicionada',
      entidade: 'usuario',
      entidadeId: usuarioId,
      descricao: `anotou no perfil de ${alvo.nome}`,
      detalhes: { nota: novo, trecho: resumir(dados.texto) },
      ip: ator.ip,
    });
    return novo;
  });
  return buscarNota(banco, ator, usuarioId, id);
}

export async function atualizarNota(
  app: FastifyInstance,
  ator: Ator,
  usuarioId: string,
  notaId: string,
  dados: { texto?: string; fixada?: boolean },
): Promise<NotaUsuario> {
  const { banco } = app;
  const atual = await buscarNota(banco, ator, usuarioId, notaId);
  if (!atual.podeAlterar) throw semPermissao('Só quem escreveu a nota ou quem controla permissões pode alterá-la.');
  const texto = dados.texto ?? atual.texto;
  const fixada = dados.fixada ?? atual.fixada;
  const textoMudou = texto !== atual.texto;
  await banco.consultar(
    `update notas_usuario set texto = $3, fixada = $4, atualizado_em = case when $5 then now() else atualizado_em end
      where id = $1 and usuario_id = $2`,
    [notaId, usuarioId, texto, fixada, textoMudou],
  );
  return buscarNota(banco, ator, usuarioId, notaId);
}

export async function excluirNota(app: FastifyInstance, ator: Ator, usuarioId: string, notaId: string): Promise<void> {
  const { banco } = app;
  const alvo = await buscarUsuario(banco, usuarioId);
  const atual = await buscarNota(banco, ator, usuarioId, notaId);
  if (!atual.podeAlterar) throw semPermissao('Só quem escreveu a nota ou quem controla permissões pode removê-la.');
  await banco.transacao(async (tx) => {
    await tx.consultar('delete from notas_usuario where id = $1 and usuario_id = $2', [notaId, usuarioId]);
    await registrarAtividade(tx, {
      usuarioId: ator.usuario.id,
      acao: 'usuario.nota_removida',
      entidade: 'usuario',
      entidadeId: usuarioId,
      descricao: `removeu uma nota do perfil de ${alvo.nome}`,
      detalhes: { nota: notaId, trecho: resumir(atual.texto) },
      ip: ator.ip,
    });
  });
}

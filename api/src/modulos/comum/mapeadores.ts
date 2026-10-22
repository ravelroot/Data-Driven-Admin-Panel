import { paraIso } from '../../util/datas.js';
import { iniciais } from '../../util/formato.js';

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  iniciais: string;
  papel: { codigo: string; nome: string };
  status: 'ativo' | 'bloqueado' | 'pendente' | 'inativo';
  cargo: string | null;
  empresa: string | null;
  telefone: string | null;
  pais: string | null;
  cidade: string | null;
  plano: { codigo: string; nome: string } | null;
  ultimoAcesso: string | null;
  criadoEm: string | null;
  atualizadoEm: string | null;
  bloqueadoEm: string | null;
  motivoBloqueio: string | null;
}

export interface Transacao {
  id: string;
  codigo: string;
  usuario: { id: string | null; nome: string; email: string; iniciais: string };
  plano: { codigo: string; nome: string } | null;
  tipo: string;
  metodo: string;
  status: string;
  valor: number;
  moeda: string;
  criadoEm: string | null;
}

export interface Atividade {
  id: string;
  usuario: { id: string; nome: string; iniciais: string } | null;
  acao: string;
  descricao: string;
  entidade: string | null;
  entidadeId: string | null;
  criadoEm: string | null;
}

export interface Notificacao {
  id: string;
  tipo: string;
  categoria: string;
  titulo: string;
  mensagem: string;
  link: string | null;
  lida: boolean;
  criadoEm: string | null;
}

export const SELECAO_USUARIO = `
  select u.id, u.nome, u.email, u.papel, p.nome as papel_nome, u.status, u.cargo, u.empresa, u.telefone,
         u.pais, u.cidade, pl.codigo as plano_codigo, pl.nome as plano_nome, u.ultimo_acesso, u.criado_em,
         u.atualizado_em, u.bloqueado_em, u.motivo_bloqueio
  from usuarios u
  join papeis p on p.codigo = u.papel
  left join assinaturas a on a.usuario_id = u.id and a.status in ('ativa', 'teste', 'inadimplente')
  left join planos pl on pl.codigo = a.plano
`;

export const SELECAO_TRANSACAO = `
  select t.id, t.codigo, t.usuario_id, coalesce(u.nome, t.cliente_nome) as usuario_nome,
         coalesce(u.email, t.cliente_email) as usuario_email, t.plano, pl.nome as plano_nome, t.tipo, t.metodo,
         t.status, t.valor, t.moeda, t.criado_em
  from transacoes t
  left join usuarios u on u.id = t.usuario_id
  left join planos pl on pl.codigo = t.plano
`;

export const SELECAO_ATIVIDADE = `
  select a.id::text as id, a.usuario_id, u.nome as usuario_nome, a.acao, a.descricao, a.entidade, a.entidade_id,
         a.criado_em
  from auditoria a
  left join usuarios u on u.id = a.usuario_id
`;

type Linha = Record<string, unknown>;

const texto = (valor: unknown): string | null => (valor === null || valor === undefined ? null : String(valor));

export function mapearUsuario(linha: Linha): Usuario {
  const nome = String(linha.nome);
  return {
    id: String(linha.id),
    nome,
    email: String(linha.email),
    iniciais: iniciais(nome),
    papel: { codigo: String(linha.papel), nome: String(linha.papel_nome ?? linha.papel) },
    status: linha.status as Usuario['status'],
    cargo: texto(linha.cargo),
    empresa: texto(linha.empresa),
    telefone: texto(linha.telefone),
    pais: texto(linha.pais),
    cidade: texto(linha.cidade),
    plano: linha.plano_codigo ? { codigo: String(linha.plano_codigo), nome: String(linha.plano_nome) } : null,
    ultimoAcesso: paraIso(linha.ultimo_acesso),
    criadoEm: paraIso(linha.criado_em),
    atualizadoEm: paraIso(linha.atualizado_em),
    bloqueadoEm: paraIso(linha.bloqueado_em),
    motivoBloqueio: texto(linha.motivo_bloqueio),
  };
}

export function mapearTransacao(linha: Linha): Transacao {
  const nome = String(linha.usuario_nome);
  return {
    id: String(linha.id),
    codigo: String(linha.codigo),
    usuario: { id: texto(linha.usuario_id), nome, email: String(linha.usuario_email), iniciais: iniciais(nome) },
    plano: linha.plano ? { codigo: String(linha.plano), nome: String(linha.plano_nome ?? linha.plano) } : null,
    tipo: String(linha.tipo),
    metodo: String(linha.metodo),
    status: String(linha.status),
    valor: Number(linha.valor),
    moeda: String(linha.moeda).trim(),
    criadoEm: paraIso(linha.criado_em),
  };
}

export function mapearAtividade(linha: Linha): Atividade {
  const nome = texto(linha.usuario_nome);
  return {
    id: String(linha.id),
    usuario: linha.usuario_id && nome ? { id: String(linha.usuario_id), nome, iniciais: iniciais(nome) } : null,
    acao: String(linha.acao),
    descricao: String(linha.descricao),
    entidade: texto(linha.entidade),
    entidadeId: texto(linha.entidade_id),
    criadoEm: paraIso(linha.criado_em),
  };
}

export function mapearNotificacao(linha: Linha): Notificacao {
  return {
    id: String(linha.id),
    tipo: String(linha.tipo),
    categoria: String(linha.categoria),
    titulo: String(linha.titulo),
    mensagem: String(linha.mensagem),
    link: texto(linha.link),
    lida: Boolean(linha.lida_em),
    criadoEm: paraIso(linha.criado_em),
  };
}

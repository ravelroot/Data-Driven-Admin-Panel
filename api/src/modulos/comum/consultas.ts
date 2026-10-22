import type { Banco } from '../../banco/conexao.js';
import { naoEncontrado } from '../../util/erros.js';
import {
  mapearAtividade,
  mapearTransacao,
  mapearUsuario,
  SELECAO_ATIVIDADE,
  SELECAO_TRANSACAO,
  SELECAO_USUARIO,
  type Atividade,
  type Transacao,
  type Usuario,
} from './mapeadores.js';

export async function buscarUsuario(banco: Banco, id: string): Promise<Usuario> {
  const { linhas } = await banco.consultar(`${SELECAO_USUARIO} where u.id = $1`, [id]);
  if (!linhas[0]) throw naoEncontrado('Usuário');
  return mapearUsuario(linhas[0]);
}

export async function buscarTransacao(banco: Banco, id: string): Promise<Transacao> {
  const { linhas } = await banco.consultar(`${SELECAO_TRANSACAO} where t.id = $1`, [id]);
  if (!linhas[0]) throw naoEncontrado('Transação');
  return mapearTransacao(linhas[0]);
}

export async function transacoesRecentes(banco: Banco, limite: number, usuarioId?: string): Promise<Transacao[]> {
  const filtro = usuarioId ? 'where t.usuario_id = $2' : '';
  const parametros: unknown[] = usuarioId ? [limite, usuarioId] : [limite];
  const { linhas } = await banco.consultar(
    `${SELECAO_TRANSACAO} ${filtro} order by t.criado_em desc, t.codigo desc limit $1`,
    parametros,
  );
  return linhas.map(mapearTransacao);
}

export async function atividadesRecentes(banco: Banco, limite: number, usuarioId?: string): Promise<Atividade[]> {
  const filtro = usuarioId ? `where a.usuario_id = $2 or (a.entidade = 'usuario' and a.entidade_id = $2::text)` : '';
  const parametros: unknown[] = usuarioId ? [limite, usuarioId] : [limite];
  const { linhas } = await banco.consultar(
    `${SELECAO_ATIVIDADE} ${filtro} order by a.criado_em desc, a.id desc limit $1`,
    parametros,
  );
  return linhas.map(mapearAtividade);
}

export async function permissoesEfetivas(banco: Banco, usuarioId: string): Promise<string[]> {
  const { linhas } = await banco.consultar<{ permissao: string }>(
    `select pp.permissao
       from usuarios u
       join papel_permissoes pp on pp.papel = u.papel
      where u.id = $1
        and not exists (
          select 1 from usuario_permissoes up
           where up.usuario_id = u.id and up.permissao = pp.permissao and not up.concedida)
     union
     select up.permissao from usuario_permissoes up where up.usuario_id = $1 and up.concedida
     order by 1`,
    [usuarioId],
  );
  return linhas.map((linha) => linha.permissao);
}

export interface Preferencias {
  tema: 'claro' | 'escuro' | 'sistema';
  paleta: 'bento' | 'oliva' | 'grafite' | 'oceano' | 'terracota' | 'ameixa' | 'floresta' | 'ardosia' | 'vinho' | 'lavanda' | 'cobre' | 'petroleo' | 'girassol' | 'menta' | 'noite' | 'areia';
  densidade: 'confortavel' | 'compacta';
  sidebarRecolhida: boolean;
}

export async function obterPreferencias(banco: Banco, usuarioId: string): Promise<Preferencias> {
  const { linhas } = await banco.consultar<Record<string, unknown>>(
    'select tema, paleta, densidade, sidebar_recolhida from preferencias_usuario where usuario_id = $1',
    [usuarioId],
  );
  const linha = linhas[0];
  return {
    tema: (linha?.tema as Preferencias['tema']) ?? 'sistema',
    paleta: (linha?.paleta as Preferencias['paleta']) ?? 'bento',
    densidade: (linha?.densidade as Preferencias['densidade']) ?? 'confortavel',
    sidebarRecolhida: Boolean(linha?.sidebar_recolhida ?? false),
  };
}

export interface ConfigSistema {
  nomeEmpresa: string;
  moeda: string;
  fuso: string;
  metaMensal: number;
  idiomaPadrao: string;
}

export async function obterConfigSistema(banco: Banco): Promise<ConfigSistema> {
  const { linhas } = await banco.consultar<{ chave: string; valor: unknown }>(
    'select chave, valor from configuracoes_sistema',
  );
  const mapa = new Map(linhas.map((linha) => [linha.chave, linha.valor]));
  return {
    nomeEmpresa: String(mapa.get('nomeEmpresa') ?? 'Bento'),
    moeda: String(mapa.get('moeda') ?? 'BRL'),
    fuso: String(mapa.get('fuso') ?? 'America/Sao_Paulo'),
    metaMensal: Number(mapa.get('metaMensal') ?? 0),
    idiomaPadrao: String(mapa.get('idiomaPadrao') ?? 'pt-BR'),
  };
}

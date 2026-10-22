import type { Banco } from '../../banco/conexao.js';
import { descreverAgente } from '../../util/agente.js';
import { paraIso, primeiroDiaDoMes } from '../../util/datas.js';
import { ErroApi, conflito, naoEncontrado, validacao } from '../../util/erros.js';
import { hashSha256, segredoChaveApi } from '../../util/seguranca.js';
import { conferirSenha, gerarHashSenha, revogarSessoesDoUsuario } from '../auth/servico.js';
import { registrarAtividade } from '../comum/auditoria.js';
import { buscarUsuario, obterConfigSistema, obterPreferencias, type ConfigSistema, type Preferencias } from '../comum/consultas.js';
import type { Usuario } from '../comum/mapeadores.js';
import { hojeLocal } from '../metricas/base.js';

export interface DadosPerfil {
  nome?: string;
  cargo?: string | null;
  telefone?: string | null;
  empresa?: string | null;
  pais?: string | null;
  cidade?: string | null;
  email?: string;
  senhaAtual?: string;
}

export async function atualizarPerfil(banco: Banco, usuarioId: string, dados: DadosPerfil, ip: string): Promise<Usuario> {
  const atual = await buscarUsuario(banco, usuarioId);
  const atribuicoes: string[] = [];
  const parametros: unknown[] = [usuarioId];
  const definir = (coluna: string, valor: unknown) => {
    parametros.push(valor);
    atribuicoes.push(`${coluna} = $${parametros.length}`);
  };
  for (const campo of ['nome', 'cargo', 'telefone', 'empresa', 'pais', 'cidade'] as const) {
    if (dados[campo] !== undefined) definir(campo, typeof dados[campo] === 'string' ? (dados[campo] as string).trim() : dados[campo]);
  }
  if (dados.email !== undefined && dados.email.toLowerCase() !== atual.email.toLowerCase()) {
    if (!dados.senhaAtual) throw validacao('Confirme sua senha atual para trocar o e-mail.', [{ campo: 'senhaAtual', mensagem: 'Obrigatória para trocar o e-mail.' }]);
    const { linhas } = await banco.consultar<{ senha_hash: string | null }>('select senha_hash from usuarios where id = $1', [usuarioId]);
    if (!(await conferirSenha(dados.senhaAtual, linhas[0]?.senha_hash ?? null))) {
      throw new ErroApi('CREDENCIAIS', 'Senha atual incorreta.');
    }
    const { linhas: existentes } = await banco.consultar('select 1 from usuarios where lower(email) = lower($1) and id <> $2', [
      dados.email,
      usuarioId,
    ]);
    if (existentes[0]) throw conflito('Já existe um usuário com este e-mail.');
    definir('email', dados.email.trim().toLowerCase());
  }
  if (atribuicoes.length === 0) return atual;
  atribuicoes.push('atualizado_em = now()');
  await banco.consultar(`update usuarios set ${atribuicoes.join(', ')} where id = $1`, parametros);
  await registrarAtividade(banco, {
    usuarioId,
    acao: 'perfil.atualizado',
    entidade: 'usuario',
    entidadeId: usuarioId,
    descricao: 'atualizou o próprio perfil',
    ip,
  });
  return buscarUsuario(banco, usuarioId);
}

export async function salvarAparencia(banco: Banco, usuarioId: string, dados: Partial<Preferencias>): Promise<Preferencias> {
  const atual = await obterPreferencias(banco, usuarioId);
  const final = { ...atual, ...Object.fromEntries(Object.entries(dados).filter(([, valor]) => valor !== undefined)) } as Preferencias;
  await banco.consultar(
    `insert into preferencias_usuario (usuario_id, tema, paleta, densidade, sidebar_recolhida, atualizado_em)
     values ($1, $2, $3, $4, $5, now())
     on conflict (usuario_id) do update set tema = excluded.tema, paleta = excluded.paleta, densidade = excluded.densidade,
       sidebar_recolhida = excluded.sidebar_recolhida, atualizado_em = now()`,
    [usuarioId, final.tema, final.paleta, final.densidade, final.sidebarRecolhida],
  );
  return final;
}

export async function trocarSenha(
  banco: Banco,
  usuarioId: string,
  sessaoAtual: string | null,
  senhaAtual: string,
  novaSenha: string,
  ip: string,
): Promise<void> {
  const { linhas } = await banco.consultar<{ senha_hash: string | null }>('select senha_hash from usuarios where id = $1', [usuarioId]);
  if (!(await conferirSenha(senhaAtual, linhas[0]?.senha_hash ?? null))) throw new ErroApi('CREDENCIAIS', 'Senha atual incorreta.');
  if (senhaAtual === novaSenha) throw validacao('A nova senha precisa ser diferente da atual.');
  const hash = await gerarHashSenha(novaSenha);
  await banco.transacao(async (tx) => {
    await tx.consultar('update usuarios set senha_hash = $2, atualizado_em = now() where id = $1', [usuarioId, hash]);
    await revogarSessoesDoUsuario(tx, usuarioId, sessaoAtual);
    await registrarAtividade(tx, {
      usuarioId,
      acao: 'seguranca.senha_alterada',
      entidade: 'usuario',
      entidadeId: usuarioId,
      descricao: 'trocou a própria senha',
      ip,
    });
  });
}

export async function listarSessoes(banco: Banco, usuarioId: string, sessaoAtual: string | null) {
  const { linhas } = await banco.consultar<{ id: string; agente: string | null; ip: string | null; criado_em: Date; ultimo_uso: Date }>(
    `select id, agente, ip, criado_em, ultimo_uso from sessoes
      where usuario_id = $1 and revogada_em is null and expira_em > now()
      order by ultimo_uso desc`,
    [usuarioId],
  );
  return linhas.map((linha) => ({
    id: linha.id,
    ...descreverAgente(linha.agente),
    ip: linha.ip,
    criadoEm: paraIso(linha.criado_em),
    ultimoUso: paraIso(linha.ultimo_uso),
    atual: linha.id === sessaoAtual,
  }));
}

export async function revogarSessao(banco: Banco, usuarioId: string, id: string): Promise<void> {
  const { total } = await banco.consultar(
    'update sessoes set revogada_em = now() where id = $1 and usuario_id = $2 and revogada_em is null',
    [id, usuarioId],
  );
  if (total === 0) throw naoEncontrado('Sessão');
}

export async function listarChaves(banco: Banco, usuarioId: string) {
  const { linhas } = await banco.consultar<{
    id: string;
    nome: string;
    prefixo: string;
    escopos: string[];
    ultimo_uso: Date | null;
    criado_em: Date;
  }>(
    `select id, nome, prefixo, escopos, ultimo_uso, criado_em from chaves_api
      where usuario_id = $1 and revogada_em is null order by criado_em desc`,
    [usuarioId],
  );
  return linhas.map((linha) => ({
    id: linha.id,
    nome: linha.nome,
    prefixo: linha.prefixo,
    escopos: linha.escopos,
    ultimoUso: paraIso(linha.ultimo_uso),
    criadoEm: paraIso(linha.criado_em),
  }));
}

export async function criarChave(banco: Banco, usuarioId: string, nome: string, escopos: string[], ip: string) {
  const segredo = segredoChaveApi();
  const prefixo = segredo.slice(0, 10);
  const { linhas } = await banco.consultar<{ id: string; criado_em: Date }>(
    `insert into chaves_api (usuario_id, nome, prefixo, segredo_hash, escopos) values ($1, $2, $3, $4, $5::text[])
     returning id, criado_em`,
    [usuarioId, nome.trim(), prefixo, hashSha256(segredo), [...new Set(escopos)]],
  );
  await registrarAtividade(banco, {
    usuarioId,
    acao: 'seguranca.chave_criada',
    entidade: 'chave_api',
    entidadeId: linhas[0].id,
    descricao: `criou a chave de API "${nome.trim()}"`,
    ip,
  });
  return {
    chave: {
      id: linhas[0].id,
      nome: nome.trim(),
      prefixo,
      escopos: [...new Set(escopos)],
      ultimoUso: null,
      criadoEm: paraIso(linhas[0].criado_em),
    },
    segredo,
  };
}

export async function revogarChave(banco: Banco, usuarioId: string, id: string, ip: string): Promise<void> {
  const { linhas } = await banco.consultar<{ nome: string }>(
    'update chaves_api set revogada_em = now() where id = $1 and usuario_id = $2 and revogada_em is null returning nome',
    [id, usuarioId],
  );
  if (!linhas[0]) throw naoEncontrado('Chave de API');
  await registrarAtividade(banco, {
    usuarioId,
    acao: 'seguranca.chave_revogada',
    entidade: 'chave_api',
    entidadeId: id,
    descricao: `revogou a chave de API "${linhas[0].nome}"`,
    ip,
  });
}

export async function salvarConfigSistema(
  banco: Banco,
  fuso: string,
  usuarioId: string,
  dados: Partial<ConfigSistema>,
  ip: string,
): Promise<ConfigSistema> {
  await banco.transacao(async (tx) => {
    for (const [chave, valor] of Object.entries(dados)) {
      if (valor === undefined) continue;
      await tx.consultar(
        `insert into configuracoes_sistema (chave, valor, atualizado_em) values ($1, $2::jsonb, now())
         on conflict (chave) do update set valor = excluded.valor, atualizado_em = now()`,
        [chave, JSON.stringify(valor)],
      );
    }
    if (dados.metaMensal !== undefined) {
      await tx.consultar(
        `insert into metas_mensais (mes, valor) values ($1::date, $2) on conflict (mes) do update set valor = excluded.valor`,
        [primeiroDiaDoMes(hojeLocal(fuso)), dados.metaMensal],
      );
    }
    await registrarAtividade(tx, {
      usuarioId,
      acao: 'sistema.configurado',
      entidade: 'sistema',
      descricao: 'alterou as configurações do sistema',
      detalhes: { campos: Object.keys(dados) },
      ip,
    });
  });
  return obterConfigSistema(banco);
}

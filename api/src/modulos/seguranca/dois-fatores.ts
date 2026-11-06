import type { FastifyInstance } from 'fastify';
import type { Banco } from '../../banco/conexao.js';
import type { Config } from '../../config.js';
import { paraIso } from '../../util/datas.js';
import { ErroApi, conflito, validacao } from '../../util/erros.js';
import { assinarHmac, cifrar, decifrar } from '../../util/seguranca.js';
import {
  conferirTotp,
  gerarCodigosRecuperacao,
  gerarSegredoTotp,
  normalizarCodigoRecuperacao,
  uriTotp,
} from '../../util/totp.js';
import { conferirSenha, revogarSessoesDoUsuario } from '../auth/servico.js';
import { registrarAtividade } from '../comum/auditoria.js';
import { obterConfigSistema } from '../comum/consultas.js';
import { criarNotificacao } from '../notificacoes/servico.js';

const MINUTOS_CONFIGURACAO = 15;

export type MetodoSegundoFator = 'app' | 'recuperacao';

export interface EstadoDoisFatores {
  ativo: boolean;
  ativadoEm: string | null;
  codigosRestantes: number;
  obrigatorio: boolean;
  pendente: boolean;
}

export interface UsuarioSeguranca {
  id: string;
  nome: string;
  email: string;
  papel: string;
  sessaoId: string | null;
}

const chave = (config: Config): string => `totp:${config.segredoJwt}`;

const resumoCodigo = (config: Config, usuarioId: string, normalizado: string): string =>
  assinarHmac(`recuperacao:${config.segredoJwt}`, `${usuarioId}:${normalizado}`);

export async function papeisObrigatorios(banco: Banco): Promise<string[]> {
  const { linhas } = await banco.consultar<{ valor: unknown }>(`select valor from configuracoes_sistema where chave = 'doisFatoresPapeis'`);
  const valor = linhas[0]?.valor;
  return Array.isArray(valor) ? valor.filter((item): item is string => typeof item === 'string') : [];
}

export async function estadoDoisFatores(banco: Banco, usuarioId: string): Promise<EstadoDoisFatores> {
  const [{ linhas }, obrigatorios] = await Promise.all([
    banco.consultar<{ papel: string; totp_ativado_em: Date | null; restantes: number }>(
      `select u.papel, u.totp_ativado_em,
              (select count(*)::int from codigos_recuperacao c where c.usuario_id = u.id and c.usado_em is null) as restantes
         from usuarios u where u.id = $1`,
      [usuarioId],
    ),
    papeisObrigatorios(banco),
  ]);
  const linha = linhas[0];
  const ativo = Boolean(linha?.totp_ativado_em);
  const obrigatorio = Boolean(linha && obrigatorios.includes(linha.papel));
  return {
    ativo,
    ativadoEm: paraIso(linha?.totp_ativado_em ?? null),
    codigosRestantes: ativo ? (linha?.restantes ?? 0) : 0,
    obrigatorio,
    pendente: obrigatorio && !ativo,
  };
}

async function exigirSenha(banco: Banco, usuarioId: string, senha: string): Promise<void> {
  const { linhas } = await banco.consultar<{ senha_hash: string | null }>('select senha_hash from usuarios where id = $1', [usuarioId]);
  if (!(await conferirSenha(senha, linhas[0]?.senha_hash ?? null))) throw new ErroApi('CREDENCIAIS', 'Senha atual incorreta.');
}

async function gravarCodigos(banco: Banco, config: Config, usuarioId: string): Promise<string[]> {
  const codigos = gerarCodigosRecuperacao();
  await banco.consultar('delete from codigos_recuperacao where usuario_id = $1', [usuarioId]);
  await banco.consultar(
    `insert into codigos_recuperacao (usuario_id, codigo_hash) select $1, unnest($2::text[])`,
    [usuarioId, codigos.map((codigo) => resumoCodigo(config, usuarioId, normalizarCodigoRecuperacao(codigo) ?? codigo))],
  );
  return codigos;
}

export async function iniciarConfiguracao(app: FastifyInstance, usuario: UsuarioSeguranca, senhaAtual: string) {
  const { banco, config } = app;
  await exigirSenha(banco, usuario.id, senhaAtual);
  const estado = await estadoDoisFatores(banco, usuario.id);
  if (estado.ativo) throw conflito('A verificação em duas etapas já está ativa. Desative antes de configurar um novo aplicativo.');
  const segredo = gerarSegredoTotp();
  await banco.consultar('update usuarios set totp_pendente = $2, totp_pendente_em = now() where id = $1', [usuario.id, cifrar(segredo, chave(config))]);
  const { nomeEmpresa } = await obterConfigSistema(banco);
  const emissor = nomeEmpresa.trim() || 'Bento';
  return {
    segredo: segredo.replace(/(.{4})/g, '$1 ').trim(),
    uri: uriTotp(emissor, usuario.email, segredo),
    emissor,
    conta: usuario.email,
    expiraEm: new Date(Date.now() + MINUTOS_CONFIGURACAO * 60_000).toISOString(),
  };
}

export async function ativarDoisFatores(app: FastifyInstance, usuario: UsuarioSeguranca, codigo: string, ip: string) {
  const { banco, config } = app;
  const { linhas } = await banco.consultar<{ totp_pendente: string | null; totp_pendente_em: Date | null; totp_ativado_em: Date | null }>(
    'select totp_pendente, totp_pendente_em, totp_ativado_em from usuarios where id = $1',
    [usuario.id],
  );
  const linha = linhas[0];
  if (linha?.totp_ativado_em) throw conflito('A verificação em duas etapas já está ativa.');
  const iniciadaEm = linha?.totp_pendente_em ? new Date(linha.totp_pendente_em).getTime() : 0;
  if (!linha?.totp_pendente || Date.now() - iniciadaEm > MINUTOS_CONFIGURACAO * 60_000) {
    throw validacao('A configuração expirou. Comece de novo para gerar outro QR code.', [{ campo: 'codigo', mensagem: 'Configuração expirada.' }]);
  }
  const segredo = decifrar(linha.totp_pendente, chave(config));
  const passo = segredo ? conferirTotp(segredo, codigo, null) : null;
  if (passo === null) {
    throw validacao('Código incorreto. Confira se o horário do celular está automático e digite o código atual.', [
      { campo: 'codigo', mensagem: 'Código incorreto.' },
    ]);
  }
  const codigos = await banco.transacao(async (tx) => {
    await tx.consultar(
      `update usuarios set totp_segredo = totp_pendente, totp_ativado_em = now(), totp_ultimo_passo = $2,
              totp_pendente = null, totp_pendente_em = null, atualizado_em = now()
        where id = $1`,
      [usuario.id, passo],
    );
    const gerados = await gravarCodigos(tx, config, usuario.id);
    await revogarSessoesDoUsuario(tx, usuario.id, usuario.sessaoId);
    await registrarAtividade(tx, {
      usuarioId: usuario.id,
      acao: 'seguranca.dois_fatores_ativado',
      entidade: 'usuario',
      entidadeId: usuario.id,
      descricao: 'ativou a verificação em duas etapas',
      ip,
    });
    return gerados;
  });
  await criarNotificacao(banco, app.barramento, {
    destinatarioId: usuario.id,
    tipo: 'sucesso',
    categoria: 'seguranca',
    titulo: 'Verificação em duas etapas ativada',
    mensagem: 'A partir de agora o painel pede o código do aplicativo depois da senha. As outras sessões foram encerradas.',
    link: '/configuracoes?secao=seguranca',
  });
  return { codigos, estado: await estadoDoisFatores(banco, usuario.id) };
}

export async function conferirSegundoFator(
  banco: Banco,
  config: Config,
  usuarioId: string,
  codigo: string,
): Promise<{ metodo: MetodoSegundoFator; restantes: number | null } | null> {
  const { linhas } = await banco.consultar<{ totp_segredo: string | null; totp_ultimo_passo: string | number | null }>(
    'select totp_segredo, totp_ultimo_passo from usuarios where id = $1 and totp_ativado_em is not null',
    [usuarioId],
  );
  const linha = linhas[0];
  if (!linha?.totp_segredo) return null;
  const limpo = codigo.trim();
  if (/^\d[\d\s]*$/.test(limpo)) {
    const segredo = decifrar(linha.totp_segredo, chave(config));
    const ultimo = linha.totp_ultimo_passo === null ? null : Number(linha.totp_ultimo_passo);
    const passo = segredo ? conferirTotp(segredo, limpo, ultimo) : null;
    if (passo === null) return null;
    const { total } = await banco.consultar(
      'update usuarios set totp_ultimo_passo = $2 where id = $1 and (totp_ultimo_passo is null or totp_ultimo_passo < $2)',
      [usuarioId, passo],
    );
    return total > 0 ? { metodo: 'app', restantes: null } : null;
  }
  const normalizado = normalizarCodigoRecuperacao(limpo);
  if (!normalizado) return null;
  const { linhas: usados } = await banco.consultar<{ id: string }>(
    `update codigos_recuperacao set usado_em = now()
      where usuario_id = $1 and codigo_hash = $2 and usado_em is null
      returning id`,
    [usuarioId, resumoCodigo(config, usuarioId, normalizado)],
  );
  if (!usados[0]) return null;
  const { linhas: contagem } = await banco.consultar<{ total: number }>(
    'select count(*)::int as total from codigos_recuperacao where usuario_id = $1 and usado_em is null',
    [usuarioId],
  );
  return { metodo: 'recuperacao', restantes: contagem[0]?.total ?? 0 };
}

export async function desativarDoisFatores(app: FastifyInstance, usuario: UsuarioSeguranca, senhaAtual: string, codigo: string, ip: string) {
  const { banco, config } = app;
  await exigirSenha(banco, usuario.id, senhaAtual);
  const estado = await estadoDoisFatores(banco, usuario.id);
  if (!estado.ativo) throw conflito('A verificação em duas etapas já está desligada.');
  if (estado.obrigatorio) throw conflito('Seu papel exige a verificação em duas etapas. Peça a um administrador para mudar a regra em Configurações › Empresa.');
  if (!(await conferirSegundoFator(banco, config, usuario.id, codigo))) {
    throw validacao('Código incorreto ou já usado.', [{ campo: 'codigo', mensagem: 'Código incorreto ou já usado.' }]);
  }
  await banco.transacao(async (tx) => {
    await removerDoisFatores(tx, usuario.id);
    await registrarAtividade(tx, {
      usuarioId: usuario.id,
      acao: 'seguranca.dois_fatores_desativado',
      entidade: 'usuario',
      entidadeId: usuario.id,
      descricao: 'desativou a verificação em duas etapas',
      ip,
    });
  });
  await criarNotificacao(banco, app.barramento, {
    destinatarioId: usuario.id,
    tipo: 'alerta',
    categoria: 'seguranca',
    titulo: 'Verificação em duas etapas desativada',
    mensagem: 'A sua conta voltou a entrar só com a senha. Se não foi você, troque a senha e ative de novo em Configurações › Segurança.',
    link: '/configuracoes?secao=seguranca',
  });
  return estadoDoisFatores(banco, usuario.id);
}

export async function regenerarCodigos(app: FastifyInstance, usuario: UsuarioSeguranca, senhaAtual: string, codigo: string, ip: string) {
  const { banco, config } = app;
  await exigirSenha(banco, usuario.id, senhaAtual);
  const estado = await estadoDoisFatores(banco, usuario.id);
  if (!estado.ativo) throw conflito('Ative a verificação em duas etapas antes de gerar códigos de recuperação.');
  if (!(await conferirSegundoFator(banco, config, usuario.id, codigo))) {
    throw validacao('Código incorreto ou já usado.', [{ campo: 'codigo', mensagem: 'Código incorreto ou já usado.' }]);
  }
  const codigos = await banco.transacao(async (tx) => {
    const gerados = await gravarCodigos(tx, config, usuario.id);
    await registrarAtividade(tx, {
      usuarioId: usuario.id,
      acao: 'seguranca.codigos_gerados',
      entidade: 'usuario',
      entidadeId: usuario.id,
      descricao: 'gerou novos códigos de recuperação',
      ip,
    });
    return gerados;
  });
  await criarNotificacao(banco, app.barramento, {
    destinatarioId: usuario.id,
    tipo: 'info',
    categoria: 'seguranca',
    titulo: 'Novos códigos de recuperação',
    mensagem: 'Os códigos de recuperação anteriores deixaram de valer. Se não foi você, troque a senha agora.',
    link: '/configuracoes?secao=seguranca',
  });
  return { codigos, estado: await estadoDoisFatores(banco, usuario.id) };
}

export async function removerDoisFatores(banco: Banco, usuarioId: string): Promise<boolean> {
  const { total } = await banco.consultar(
    `update usuarios set totp_segredo = null, totp_ativado_em = null, totp_ultimo_passo = null, totp_pendente = null,
            totp_pendente_em = null, atualizado_em = now()
      where id = $1 and (totp_ativado_em is not null or totp_pendente is not null)`,
    [usuarioId],
  );
  await banco.consultar('delete from codigos_recuperacao where usuario_id = $1', [usuarioId]);
  return total > 0;
}

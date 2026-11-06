import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import type { Banco } from '../../banco/conexao.js';
import { ErroApi, naoAutenticado } from '../../util/erros.js';
import { hashSha256, tokenAleatorio } from '../../util/seguranca.js';
import { DIAS_LEMBRAR, DURACAO_ACESSO, HORAS_SEM_LEMBRAR, type CargaJwt } from '../../plugins/autenticacao.js';
import { registrarAtividade } from '../comum/auditoria.js';
import {
  buscarUsuario,
  obterConfigSistema,
  obterPreferencias,
  permissoesEfetivas,
  type ConfigSistema,
  type Preferencias,
} from '../comum/consultas.js';
import type { Usuario } from '../comum/mapeadores.js';
import { criarNotificacao } from '../notificacoes/servico.js';
import { VERSAO } from '../../config.js';
import { lerManutencao, type EstadoManutencao } from '../../operacao/manutencao.js';
import { conferirSegundoFator, estadoDoisFatores, type EstadoDoisFatores, type MetodoSegundoFator } from '../seguranca/dois-fatores.js';

export const CUSTO_BCRYPT = 10;
export const DURACAO_DESAFIO = '5m';
const LIMITE_TENTATIVAS = 5;
const MINUTOS_BLOQUEIO = 15;
let hashFicticio: string | null = null;

const MAX_EMAILS_DESCONHECIDOS = 10_000;
const tentativasDesconhecidas = new Map<string, { tentativas: number; bloqueadoAte: number }>();

function bloqueioDesconhecido(email: string): number | null {
  const registro = tentativasDesconhecidas.get(email);
  if (!registro || registro.bloqueadoAte <= Date.now()) return null;
  return registro.bloqueadoAte;
}

function registrarFalhaDesconhecida(email: string): void {
  const registro = tentativasDesconhecidas.get(email) ?? { tentativas: 0, bloqueadoAte: 0 };
  registro.tentativas += 1;
  if (registro.tentativas >= LIMITE_TENTATIVAS) {
    registro.tentativas = 0;
    registro.bloqueadoAte = Date.now() + MINUTOS_BLOQUEIO * 60_000;
  }
  tentativasDesconhecidas.delete(email);
  tentativasDesconhecidas.set(email, registro);
  if (tentativasDesconhecidas.size > MAX_EMAILS_DESCONHECIDOS) {
    const maisAntigo = tentativasDesconhecidas.keys().next().value;
    if (maisAntigo !== undefined) tentativasDesconhecidas.delete(maisAntigo);
  }
}

export async function gerarHashSenha(senha: string): Promise<string> {
  return bcrypt.hash(senha, CUSTO_BCRYPT);
}

export async function conferirSenha(senha: string, hash: string | null): Promise<boolean> {
  if (!hash) {
    hashFicticio ??= bcrypt.hashSync('bento-senha-ficticia', CUSTO_BCRYPT);
    await bcrypt.compare(senha, hashFicticio);
    return false;
  }
  return bcrypt.compare(senha, hash);
}

export interface Contexto {
  usuario: Usuario;
  permissoes: string[];
  preferencias: Preferencias;
  sistema: Pick<ConfigSistema, 'nomeEmpresa' | 'moeda' | 'metaMensal'> & { versao: string; manutencao: EstadoManutencao };
  doisFatores: EstadoDoisFatores;
}

export async function montarContexto(banco: Banco, usuarioId: string): Promise<Contexto> {
  const [usuario, permissoes, preferencias, sistema, manutencao, doisFatores] = await Promise.all([
    buscarUsuario(banco, usuarioId),
    permissoesEfetivas(banco, usuarioId),
    obterPreferencias(banco, usuarioId),
    obterConfigSistema(banco),
    lerManutencao(banco),
    estadoDoisFatores(banco, usuarioId),
  ]);
  return {
    usuario,
    permissoes,
    preferencias,
    sistema: { nomeEmpresa: sistema.nomeEmpresa, moeda: sistema.moeda, metaMensal: sistema.metaMensal, versao: VERSAO, manutencao },
    doisFatores,
  };
}

export interface ResultadoSessao {
  tokenAcesso: string;
  tokenRenovacao: string;
  lembrar: boolean;
}

function assinarAcesso(app: FastifyInstance, carga: CargaJwt): string {
  return app.jwt.sign(carga, { expiresIn: DURACAO_ACESSO });
}

function validadeSessao(lembrar: boolean): Date {
  const horas = lembrar ? DIAS_LEMBRAR * 24 : HORAS_SEM_LEMBRAR;
  return new Date(Date.now() + horas * 3_600_000);
}

export interface DesafioDoisFatores {
  etapa: 'dois-fatores';
  desafio: string;
  lembrar: boolean;
}

export type ResultadoEntrar = DesafioDoisFatores | (Contexto & ResultadoSessao & { etapa: 'sessao' });

interface CargaDesafio {
  sub: string;
  tipo: 'dois-fatores';
  lembrar: boolean;
}

interface ContaLogin {
  id: string;
  nome: string;
  email: string;
  status: string;
  tentativas_falhas: number;
  bloqueio_temporario_ate: Date | null;
}

function lancarSeBloqueado(bloqueadoAte: number | null): void {
  if (bloqueadoAte && bloqueadoAte > Date.now()) {
    const minutos = Math.ceil((bloqueadoAte - Date.now()) / 60_000);
    throw new ErroApi('LIMITE', `Muitas tentativas sem sucesso. Tente de novo em ${minutos} min.`);
  }
}

async function registrarFalha(app: FastifyInstance, conta: ContaLogin, ip: string, motivo: string): Promise<void> {
  const { banco } = app;
  const { linhas } = await banco.consultar<{ tentativas: number }>(
    `update usuarios set tentativas_falhas = tentativas_falhas + 1 where id = $1 returning tentativas_falhas as tentativas`,
    [conta.id],
  );
  if ((linhas[0]?.tentativas ?? 0) < LIMITE_TENTATIVAS) return;
  const { total } = await banco.consultar(
    `update usuarios set tentativas_falhas = 0, bloqueio_temporario_ate = now() + interval '${MINUTOS_BLOQUEIO} minutes'
      where id = $1 and tentativas_falhas >= $2`,
    [conta.id, LIMITE_TENTATIVAS],
  );
  if (total === 0) return;
  await criarNotificacao(banco, app.barramento, {
    destinatarioId: null,
    tipo: 'alerta',
    categoria: 'seguranca',
    titulo: 'Tentativas de acesso bloqueadas',
    mensagem: `${LIMITE_TENTATIVAS} ${motivo} sem sucesso para ${conta.email}. O acesso ficou suspenso por ${MINUTOS_BLOQUEIO} minutos.`,
    link: '/usuarios',
  });
  await registrarAtividade(banco, {
    usuarioId: null,
    acao: 'auth.bloqueio_temporario',
    entidade: 'usuario',
    entidadeId: conta.id,
    descricao: `Acesso de ${conta.nome} suspenso por ${MINUTOS_BLOQUEIO} minutos após tentativas sem sucesso`,
    ip,
  });
}

async function abrirSessao(
  app: FastifyInstance,
  conta: { id: string },
  lembrar: boolean,
  ip: string,
  agente: string | null,
  metodo: MetodoSegundoFator | null,
): Promise<Contexto & ResultadoSessao & { etapa: 'sessao' }> {
  const { banco } = app;
  const tokenRenovacao = tokenAleatorio();
  const sessao = await banco.transacao(async (tx) => {
    await tx.consultar(
      `update usuarios set tentativas_falhas = 0, bloqueio_temporario_ate = null, ultimo_acesso = now() where id = $1`,
      [conta.id],
    );
    const { linhas: criadas } = await tx.consultar<{ id: string }>(
      `insert into sessoes (usuario_id, token_hash, agente, ip, lembrar, expira_em)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [conta.id, hashSha256(tokenRenovacao), agente?.slice(0, 400) ?? null, ip, lembrar, validadeSessao(lembrar)],
    );
    await registrarAtividade(tx, {
      usuarioId: conta.id,
      acao: 'auth.entrou',
      descricao: metodo === 'recuperacao' ? 'entrou no painel com um código de recuperação' : 'entrou no painel',
      entidade: 'sessao',
      entidadeId: criadas[0].id,
      detalhes: metodo ? { doisFatores: metodo } : {},
      ip,
    });
    return criadas[0];
  });
  const contexto = await montarContexto(banco, conta.id);
  return {
    etapa: 'sessao',
    ...contexto,
    tokenAcesso: assinarAcesso(app, { sub: conta.id, sid: sessao.id }),
    tokenRenovacao,
    lembrar,
  };
}

export async function entrar(
  app: FastifyInstance,
  dados: { email: string; senha: string; lembrar: boolean },
  ip: string,
  agente: string | null,
): Promise<ResultadoEntrar> {
  const { banco } = app;
  const { linhas } = await banco.consultar<ContaLogin & { senha_hash: string | null; totp_ativado_em: Date | null }>(
    `select id, nome, email, senha_hash, status, tentativas_falhas, bloqueio_temporario_ate, totp_ativado_em
       from usuarios where lower(email) = lower($1)`,
    [dados.email],
  );
  const conta = linhas[0];
  const emailNormalizado = dados.email.trim().toLowerCase();
  lancarSeBloqueado(
    conta?.bloqueio_temporario_ate ? new Date(conta.bloqueio_temporario_ate).getTime() : conta ? null : bloqueioDesconhecido(emailNormalizado),
  );
  const senhaCorreta = await conferirSenha(dados.senha, conta?.senha_hash ?? null);
  if (!conta || !senhaCorreta) {
    if (conta) await registrarFalha(app, conta, ip, 'tentativas de login');
    else registrarFalhaDesconhecida(emailNormalizado);
    throw new ErroApi('CREDENCIAIS', 'E-mail ou senha incorretos.');
  }
  if (conta.status === 'bloqueado') throw new ErroApi('BLOQUEADO', 'Esta conta está bloqueada. Fale com um administrador.');
  if (conta.status !== 'ativo') {
    throw new ErroApi('SEM_ACESSO_PAINEL', 'Esta conta está inativa ou aguardando ativação.');
  }
  const permissoes = await permissoesEfetivas(banco, conta.id);
  if (!permissoes.includes('painel.ver')) {
    throw new ErroApi('SEM_ACESSO_PAINEL', 'Esta conta não tem acesso ao painel administrativo.');
  }
  if (conta.totp_ativado_em) {
    const carga: CargaDesafio = { sub: conta.id, tipo: 'dois-fatores', lembrar: dados.lembrar };
    return { etapa: 'dois-fatores', desafio: app.jwt.sign(carga, { expiresIn: DURACAO_DESAFIO }), lembrar: dados.lembrar };
  }
  return abrirSessao(app, conta, dados.lembrar, ip, agente, null);
}

export async function concluirDoisFatores(
  app: FastifyInstance,
  desafio: string | undefined,
  codigo: string,
  ip: string,
  agente: string | null,
): Promise<Contexto & ResultadoSessao & { etapa: 'sessao'; codigosRestantes: number | null }> {
  const { banco } = app;
  let carga: CargaDesafio;
  try {
    carga = app.jwt.verify<CargaDesafio>(desafio ?? '');
  } catch {
    throw naoAutenticado('A verificação expirou. Entre com a senha de novo.');
  }
  if (carga.tipo !== 'dois-fatores' || typeof carga.sub !== 'string') throw naoAutenticado('A verificação expirou. Entre com a senha de novo.');
  const { linhas } = await banco.consultar<ContaLogin & { totp_ativado_em: Date | null }>(
    `select id, nome, email, status, tentativas_falhas, bloqueio_temporario_ate, totp_ativado_em from usuarios where id = $1`,
    [carga.sub],
  );
  const conta = linhas[0];
  if (!conta || !conta.totp_ativado_em) throw naoAutenticado('A verificação expirou. Entre com a senha de novo.');
  lancarSeBloqueado(conta.bloqueio_temporario_ate ? new Date(conta.bloqueio_temporario_ate).getTime() : null);
  if (conta.status !== 'ativo') throw new ErroApi(conta.status === 'bloqueado' ? 'BLOQUEADO' : 'SEM_ACESSO_PAINEL', 'Esta conta não está ativa.');
  const resultado = await conferirSegundoFator(banco, app.config, conta.id, codigo);
  if (!resultado) {
    await registrarFalha(app, conta, ip, 'códigos de verificação');
    throw new ErroApi('CREDENCIAIS', 'Código incorreto ou já usado. Confira o aplicativo e tente de novo.');
  }
  if (resultado.metodo === 'recuperacao') {
    await criarNotificacao(banco, app.barramento, {
      destinatarioId: conta.id,
      tipo: resultado.restantes && resultado.restantes > 2 ? 'info' : 'alerta',
      categoria: 'seguranca',
      titulo: 'Código de recuperação usado',
      mensagem: `Você entrou com um código de recuperação. Restam ${resultado.restantes ?? 0}. Gere novos códigos em Configurações › Segurança.`,
      link: '/configuracoes?secao=seguranca',
    });
  }
  const sessao = await abrirSessao(app, conta, Boolean(carga.lembrar), ip, agente, resultado.metodo);
  return { ...sessao, codigosRestantes: resultado.restantes };
}

export async function renovar(app: FastifyInstance, tokenRenovacao: string | undefined): Promise<ResultadoSessao> {
  if (!tokenRenovacao) throw naoAutenticado('Sessão expirada. Entre novamente.');
  const { banco } = app;
  const { linhas } = await banco.consultar<{
    id: string;
    usuario_id: string;
    lembrar: boolean;
    expira_em: Date;
    revogada_em: Date | null;
    status: string;
  }>(
    `select s.id, s.usuario_id, s.lembrar, s.expira_em, s.revogada_em, u.status
       from sessoes s join usuarios u on u.id = s.usuario_id
      where s.token_hash = $1`,
    [hashSha256(tokenRenovacao)],
  );
  const sessao = linhas[0];
  if (!sessao || sessao.revogada_em || new Date(sessao.expira_em).getTime() < Date.now()) {
    throw naoAutenticado('Sessão expirada. Entre novamente.');
  }
  if (sessao.status === 'bloqueado') throw new ErroApi('BLOQUEADO', 'Esta conta está bloqueada.');
  if (sessao.status !== 'ativo') throw new ErroApi('SEM_ACESSO_PAINEL', 'Esta conta não está ativa.');
  const novo = tokenAleatorio();
  const { total } = await banco.consultar(
    `update sessoes set token_hash = $2, ultimo_uso = now() where id = $1 and token_hash = $3 and revogada_em is null`,
    [sessao.id, hashSha256(novo), hashSha256(tokenRenovacao)],
  );
  if (total === 0) throw naoAutenticado('Sessão expirada. Entre novamente.');
  return {
    tokenAcesso: assinarAcesso(app, { sub: sessao.usuario_id, sid: sessao.id }),
    tokenRenovacao: novo,
    lembrar: sessao.lembrar,
  };
}

export async function sair(app: FastifyInstance, tokenAcesso: string | undefined, tokenRenovacao: string | undefined) {
  const { banco } = app;
  if (tokenRenovacao) {
    await banco.consultar('update sessoes set revogada_em = now() where token_hash = $1 and revogada_em is null', [
      hashSha256(tokenRenovacao),
    ]);
  }
  if (tokenAcesso) {
    try {
      const carga = app.jwt.verify<CargaJwt>(tokenAcesso, { ignoreExpiration: true } as never);
      await banco.consultar('update sessoes set revogada_em = now() where id = $1 and revogada_em is null', [carga.sid]);
    } catch {
      return;
    }
  }
}

export async function revogarSessoesDoUsuario(banco: Banco, usuarioId: string, exceto: string | null = null): Promise<number> {
  const { total } = await banco.consultar(
    `update sessoes set revogada_em = now()
      where usuario_id = $1 and revogada_em is null and ($2::uuid is null or id <> $2::uuid)`,
    [usuarioId, exceto],
  );
  return total;
}

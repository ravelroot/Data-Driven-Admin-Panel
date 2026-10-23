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

export const CUSTO_BCRYPT = 10;
const LIMITE_TENTATIVAS = 5;
const MINUTOS_BLOQUEIO = 15;
let hashFicticio: string | null = null;

/**
 * Tentativas contra e-mails que não existem. Sem isso, só contas reais chegavam ao bloqueio temporário
 * ("Muitas tentativas..."), e a diferença de resposta revelava quais e-mails estão cadastrados.
 */
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
  sistema: Pick<ConfigSistema, 'nomeEmpresa' | 'moeda' | 'metaMensal'>;
}

export async function montarContexto(banco: Banco, usuarioId: string): Promise<Contexto> {
  const [usuario, permissoes, preferencias, sistema] = await Promise.all([
    buscarUsuario(banco, usuarioId),
    permissoesEfetivas(banco, usuarioId),
    obterPreferencias(banco, usuarioId),
    obterConfigSistema(banco),
  ]);
  return {
    usuario,
    permissoes,
    preferencias,
    sistema: { nomeEmpresa: sistema.nomeEmpresa, moeda: sistema.moeda, metaMensal: sistema.metaMensal },
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

export async function entrar(
  app: FastifyInstance,
  dados: { email: string; senha: string; lembrar: boolean },
  ip: string,
  agente: string | null,
): Promise<Contexto & ResultadoSessao> {
  const { banco } = app;
  const { linhas } = await banco.consultar<{
    id: string;
    nome: string;
    senha_hash: string | null;
    status: string;
    tentativas_falhas: number;
    bloqueio_temporario_ate: Date | null;
  }>(
    `select id, nome, senha_hash, status, tentativas_falhas, bloqueio_temporario_ate
       from usuarios where lower(email) = lower($1)`,
    [dados.email],
  );
  const conta = linhas[0];
  const emailNormalizado = dados.email.trim().toLowerCase();
  const bloqueadoAte = conta?.bloqueio_temporario_ate
    ? new Date(conta.bloqueio_temporario_ate).getTime()
    : conta
      ? null
      : bloqueioDesconhecido(emailNormalizado);
  if (bloqueadoAte && bloqueadoAte > Date.now()) {
    const minutos = Math.ceil((bloqueadoAte - Date.now()) / 60_000);
    throw new ErroApi('LIMITE', `Muitas tentativas sem sucesso. Tente de novo em ${minutos} min.`);
  }
  const senhaCorreta = await conferirSenha(dados.senha, conta?.senha_hash ?? null);
  if (!conta || !senhaCorreta) {
    if (conta) {
      const tentativas = conta.tentativas_falhas + 1;
      if (tentativas >= LIMITE_TENTATIVAS) {
        await banco.consultar(
          `update usuarios set tentativas_falhas = 0, bloqueio_temporario_ate = now() + interval '${MINUTOS_BLOQUEIO} minutes'
            where id = $1`,
          [conta.id],
        );
        await criarNotificacao(banco, app.barramento, {
          destinatarioId: null,
          tipo: 'alerta',
          categoria: 'seguranca',
          titulo: 'Tentativas de acesso bloqueadas',
          mensagem: `${LIMITE_TENTATIVAS} tentativas de login sem sucesso para ${dados.email}. O acesso ficou suspenso por ${MINUTOS_BLOQUEIO} minutos.`,
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
      } else {
        await banco.consultar('update usuarios set tentativas_falhas = $2 where id = $1', [conta.id, tentativas]);
      }
    } else {
      registrarFalhaDesconhecida(emailNormalizado);
    }
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
  const tokenRenovacao = tokenAleatorio();
  const sessao = await banco.transacao(async (tx) => {
    await tx.consultar(
      `update usuarios set tentativas_falhas = 0, bloqueio_temporario_ate = null, ultimo_acesso = now() where id = $1`,
      [conta.id],
    );
    const { linhas: criadas } = await tx.consultar<{ id: string }>(
      `insert into sessoes (usuario_id, token_hash, agente, ip, lembrar, expira_em)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [conta.id, hashSha256(tokenRenovacao), agente?.slice(0, 400) ?? null, ip, dados.lembrar, validadeSessao(dados.lembrar)],
    );
    await registrarAtividade(tx, {
      usuarioId: conta.id,
      acao: 'auth.entrou',
      descricao: 'entrou no painel',
      entidade: 'sessao',
      entidadeId: criadas[0].id,
      ip,
    });
    return criadas[0];
  });
  const contexto = await montarContexto(banco, conta.id);
  return {
    ...contexto,
    tokenAcesso: assinarAcesso(app, { sub: conta.id, sid: sessao.id }),
    tokenRenovacao,
    lembrar: dados.lembrar,
  };
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

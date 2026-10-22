import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const raizProjeto = fileURLToPath(new URL('../../', import.meta.url));
export const VERSAO = '1.0.0';

export interface Config {
  porta: number;
  host: string;
  urlBanco: string | null;
  dirDados: string;
  segredoJwt: string;
  segredoGerado: boolean;
  https: boolean;
  origens: string[];
  semear: boolean;
  simulador: boolean;
  intervaloSimulador: number;
  fuso: string;
  log: string;
  dirWeb: string;
  tamanhoPool: number;
  proxyConfiavel: boolean;
  admin: { email: string; senha: string; nome: string } | null;
}

export const DADOS_EM_MEMORIA = 'memoria';

function carregarArquivoEnv(): void {
  const arquivo = path.join(raizProjeto, '.env');
  if (existsSync(arquivo)) {
    process.loadEnvFile(arquivo);
  }
}

function booleano(valor: string | undefined, padrao: boolean): boolean {
  if (valor === undefined || valor.trim() === '') return padrao;
  return ['1', 'true', 'sim', 'yes', 'on'].includes(valor.trim().toLowerCase());
}

function numero(valor: string | undefined, padrao: number): number {
  const convertido = Number(valor);
  return Number.isFinite(convertido) && convertido > 0 ? convertido : padrao;
}

function lerAdministrador(env: NodeJS.ProcessEnv): Config['admin'] {
  const email = env.BENTO_ADMIN_EMAIL?.trim() ?? '';
  const senha = env.BENTO_ADMIN_SENHA ?? '';
  if (!email && !senha) return null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error('BENTO_ADMIN_EMAIL precisa ser um e-mail válido.');
  }
  if (senha.length < 8) {
    throw new Error('BENTO_ADMIN_SENHA precisa ter pelo menos 8 caracteres.');
  }
  const nome = env.BENTO_ADMIN_NOME?.trim() || 'Administrador';
  return { email, senha, nome };
}

function resolverCaminho(valor: string): string {
  if (valor === DADOS_EM_MEMORIA) return valor;
  return path.isAbsolute(valor) ? valor : path.join(raizProjeto, valor);
}

function obterSegredo(dirDados: string): { segredo: string; gerado: boolean } {
  const definido = process.env.BENTO_SEGREDO_JWT?.trim();
  if (definido) return { segredo: definido, gerado: false };
  if (dirDados === DADOS_EM_MEMORIA) return { segredo: randomBytes(48).toString('base64url'), gerado: true };
  const pasta = path.join(raizProjeto, 'dados');
  const arquivo = path.join(pasta, 'segredo');
  if (existsSync(arquivo)) {
    const lido = readFileSync(arquivo, 'utf8').trim();
    if (lido.length >= 32) return { segredo: lido, gerado: true };
  }
  mkdirSync(pasta, { recursive: true });
  const novo = randomBytes(48).toString('base64url');
  writeFileSync(arquivo, novo, { encoding: 'utf8', mode: 0o600 });
  return { segredo: novo, gerado: true };
}

export function lerConfig(sobrescrever: Partial<Config> = {}): Config {
  carregarArquivoEnv();
  const env = process.env;
  const dirDados = sobrescrever.dirDados ?? resolverCaminho(env.BENTO_DADOS?.trim() || path.join('dados', 'pglite'));
  const { segredo, gerado } = sobrescrever.segredoJwt
    ? { segredo: sobrescrever.segredoJwt, gerado: false }
    : obterSegredo(dirDados);
  const fuso = env.BENTO_FUSO?.trim() || 'America/Sao_Paulo';
  if (!/^[A-Za-z0-9_+\-/]+$/.test(fuso)) {
    throw new Error(`Fuso horário inválido: ${fuso}`);
  }
  const base: Config = {
    porta: numero(env.BENTO_PORTA, 8080),
    host: env.BENTO_HOST?.trim() || '0.0.0.0',
    urlBanco: env.DATABASE_URL?.trim() || null,
    dirDados,
    segredoJwt: segredo,
    segredoGerado: gerado,
    https: booleano(env.BENTO_HTTPS, false),
    origens: (env.BENTO_ORIGENS ?? '').split(',').map((origem) => origem.trim()).filter(Boolean),
    semear: (env.BENTO_SEMEAR ?? 'auto').trim().toLowerCase() !== 'nao',
    simulador: booleano(env.BENTO_SIMULADOR, true),
    intervaloSimulador: numero(env.BENTO_SIMULADOR_INTERVALO, 25),
    fuso,
    log: env.BENTO_LOG?.trim() || 'info',
    dirWeb: resolverCaminho(env.BENTO_WEB?.trim() || path.join('web', 'dist')),
    tamanhoPool: numero(env.BENTO_POOL, 10),
    proxyConfiavel: booleano(env.BENTO_PROXY, false),
    admin: lerAdministrador(env),
  };
  return { ...base, ...sobrescrever, dirDados, segredoJwt: segredo, segredoGerado: gerado };
}

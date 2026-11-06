import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const raizProjeto = fileURLToPath(new URL('../../', import.meta.url));

function lerVersao(): string {
  for (const arquivo of ['VERSION', 'package.json']) {
    const caminho = path.join(raizProjeto, arquivo);
    if (!existsSync(caminho)) continue;
    try {
      const conteudo = readFileSync(caminho, 'utf8');
      const versao = arquivo === 'VERSION' ? conteudo.trim() : String((JSON.parse(conteudo) as { version?: unknown }).version ?? '');
      if (/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(versao)) return versao;
    } catch {
      continue;
    }
  }
  return '0.0.0';
}

export const VERSAO = lerVersao();

export const SEGREDOS_DE_EXEMPLO = new Set(['troque-esta-chave', 'troque-esta-senha', 'changeme', 'secret', 'segredo']);
export const NIVEIS_LOG = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export const FREQUENCIAS_BACKUP = ['desligado', 'diario', 'semanal'] as const;

export type FrequenciaBackup = (typeof FREQUENCIAS_BACKUP)[number];

export interface Retencao {
  notificacoesDias: number;
  relatoriosDias: number;
  auditoriaDias: number;
  sessoesDias: number;
  entregasDias: number;
  alertasDias: number;
}

export interface ConfigBackup {
  automatico: FrequenciaBackup;
  manter: number;
  pasta: string;
}

export interface ConfigAnalise {
  url: string | null;
  token: string | null;
  timeoutMs: number;
  cacheMinutos: number;
}

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
  producao: boolean;
  retencao: Retencao;
  backup: ConfigBackup;
  metricasToken: string | null;
  analise: ConfigAnalise;
  avisos: string[];
}

export const DADOS_EM_MEMORIA = 'memoria';

const VERDADEIROS = ['1', 'true', 'sim', 'yes', 'on'];
const FALSOS = ['0', 'false', 'nao', 'não', 'no', 'off'];

function carregarArquivoEnv(): void {
  const arquivo = path.join(raizProjeto, '.env');
  if (existsSync(arquivo)) {
    process.loadEnvFile(arquivo);
  }
}

function criarLeitor(env: NodeJS.ProcessEnv, avisos: string[]) {
  const texto = (nome: string): string | undefined => {
    const valor = env[nome]?.trim();
    return valor ? valor : undefined;
  };

  const booleano = (nome: string, padrao: boolean): boolean => {
    const valor = texto(nome)?.toLowerCase();
    if (valor === undefined) return padrao;
    if (VERDADEIROS.includes(valor)) return true;
    if (FALSOS.includes(valor)) return false;
    avisos.push(`${nome}="${valor}" não é sim ou não; usando ${padrao ? 'true' : 'false'}.`);
    return padrao;
  };

  const inteiro = (nome: string, padrao: number, minimo: number, maximo: number): number => {
    const valor = texto(nome);
    if (valor === undefined) return padrao;
    const convertido = Number(valor);
    if (!Number.isInteger(convertido) || convertido < minimo || convertido > maximo) {
      avisos.push(`${nome}="${valor}" precisa ser um número inteiro entre ${minimo} e ${maximo}; usando ${padrao}.`);
      return padrao;
    }
    return convertido;
  };

  const opcao = <T extends string>(nome: string, opcoes: readonly T[], padrao: T): T => {
    const valor = texto(nome)?.toLowerCase();
    if (valor === undefined) return padrao;
    if ((opcoes as readonly string[]).includes(valor)) return valor as T;
    avisos.push(`${nome}="${valor}" não é uma opção válida (${opcoes.join(', ')}); usando ${padrao}.`);
    return padrao;
  };

  return { texto, booleano, inteiro, opcao };
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

export function segredoFraco(segredo: string): boolean {
  return segredo.length < 32 || SEGREDOS_DE_EXEMPLO.has(segredo.toLowerCase());
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
  const avisos: string[] = [];
  const ler = criarLeitor(env, avisos);
  const producao = sobrescrever.producao ?? env.NODE_ENV === 'production';
  const dirDados = sobrescrever.dirDados ?? resolverCaminho(ler.texto('BENTO_DADOS') ?? path.join('dados', 'pglite'));
  const { segredo, gerado } = sobrescrever.segredoJwt
    ? { segredo: sobrescrever.segredoJwt, gerado: false }
    : obterSegredo(dirDados);
  if (!gerado && !sobrescrever.segredoJwt && segredoFraco(segredo)) {
    const mensagem = 'BENTO_SEGREDO_JWT é curto ou é o valor de exemplo. Use pelo menos 32 caracteres aleatórios (os scripts iniciar.sh e iniciar.cmd geram um).';
    if (producao) throw new Error(mensagem);
    avisos.push(mensagem);
  }
  const fuso = ler.texto('BENTO_FUSO') ?? 'America/Sao_Paulo';
  if (!/^[A-Za-z0-9_+\-/]+$/.test(fuso)) {
    throw new Error(`Fuso horário inválido: ${fuso}`);
  }
  const semear = ler.opcao('BENTO_SEMEAR', ['auto', 'sim', 'nao', 'não'] as const, 'auto');
  const base: Config = {
    porta: ler.inteiro('BENTO_PORTA', 8080, 1, 65_535),
    host: ler.texto('BENTO_HOST') ?? '0.0.0.0',
    urlBanco: ler.texto('DATABASE_URL') ?? null,
    dirDados,
    segredoJwt: segredo,
    segredoGerado: gerado,
    https: ler.booleano('BENTO_HTTPS', false),
    origens: (env.BENTO_ORIGENS ?? '').split(',').map((origem) => origem.trim()).filter(Boolean),
    semear: semear !== 'nao' && semear !== 'não',
    simulador: ler.booleano('BENTO_SIMULADOR', true),
    intervaloSimulador: ler.inteiro('BENTO_SIMULADOR_INTERVALO', 25, 5, 3_600),
    fuso,
    log: ler.opcao('BENTO_LOG', NIVEIS_LOG, 'info'),
    dirWeb: resolverCaminho(ler.texto('BENTO_WEB') ?? path.join('web', 'dist')),
    tamanhoPool: ler.inteiro('BENTO_POOL', 10, 1, 200),
    proxyConfiavel: ler.booleano('BENTO_PROXY', false),
    admin: lerAdministrador(env),
    producao,
    retencao: {
      notificacoesDias: ler.inteiro('BENTO_RETENCAO_NOTIFICACOES', 180, 0, 3_650),
      relatoriosDias: ler.inteiro('BENTO_RETENCAO_RELATORIOS', 90, 0, 3_650),
      auditoriaDias: ler.inteiro('BENTO_RETENCAO_AUDITORIA', 0, 0, 3_650),
      sessoesDias: ler.inteiro('BENTO_RETENCAO_SESSOES', 30, 1, 3_650),
      entregasDias: ler.inteiro('BENTO_RETENCAO_ENTREGAS', 30, 1, 3_650),
      alertasDias: ler.inteiro('BENTO_RETENCAO_ALERTAS', 180, 1, 3_650),
    },
    backup: {
      automatico: ler.opcao('BENTO_BACKUP_AUTOMATICO', FREQUENCIAS_BACKUP, 'desligado'),
      manter: ler.inteiro('BENTO_BACKUP_MANTER', 7, 1, 365),
      pasta: resolverCaminho(ler.texto('BENTO_BACKUP_PASTA') ?? path.join('dados', 'backups')),
    },
    metricasToken: ler.texto('BENTO_METRICAS_TOKEN') ?? null,
    analise: {
      url: ler.texto('BENTO_ANALISE_URL')?.replace(/\/+$/, '') ?? null,
      token: ler.texto('BENTO_ANALISE_TOKEN') ?? null,
      timeoutMs: ler.inteiro('BENTO_ANALISE_TIMEOUT', 60, 5, 600) * 1000,
      cacheMinutos: ler.inteiro('BENTO_ANALISE_CACHE', 10, 0, 1_440),
    },
    avisos,
  };
  if (base.metricasToken && base.metricasToken.length < 16) {
    avisos.push('BENTO_METRICAS_TOKEN tem menos de 16 caracteres; use um valor longo e aleatório.');
  }
  if (base.analise.url && !/^https?:\/\/[^\s]+$/.test(base.analise.url)) {
    avisos.push('BENTO_ANALISE_URL deve ser uma URL http(s) completa, como http://analise:8090.');
    base.analise.url = null;
  }
  if (base.analise.url && (!base.analise.token || base.analise.token.length < 24)) {
    avisos.push('BENTO_ANALISE_TOKEN precisa ter pelo menos 24 caracteres para usar o motor analítico.');
    base.analise.url = null;
  }
  if (base.origens.some((origem) => !/^https?:\/\/[^/\s]+$/.test(origem))) {
    avisos.push('BENTO_ORIGENS deve listar origens completas separadas por vírgula, como https://painel.suaempresa.com (sem barra no fim).');
  }
  return { ...base, ...sobrescrever, dirDados, segredoJwt: segredo, segredoGerado: gerado, avisos: [...avisos, ...(sobrescrever.avisos ?? [])] };
}

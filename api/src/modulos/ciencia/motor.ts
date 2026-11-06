import type { ConfigAnalise } from '../../config.js';
import { ErroApi, validacao } from '../../util/erros.js';

export interface SaudeMotor {
  status: string;
  versao: string;
  bibliotecas: Record<string, string>;
}

const indisponivel = (mensagem: string) => new ErroApi('INDISPONIVEL', mensagem);

export function motorConfigurado(config: ConfigAnalise): boolean {
  return Boolean(config.url && config.token);
}

async function chamar(config: ConfigAnalise, caminho: string, iniciar: RequestInit, timeoutMs = config.timeoutMs): Promise<Response> {
  if (!config.url || !config.token) {
    throw indisponivel('O motor analítico não está configurado. Defina BENTO_ANALISE_URL e BENTO_ANALISE_TOKEN.');
  }
  let resposta: Response;
  try {
    resposta = await fetch(`${config.url}${caminho}`, {
      ...iniciar,
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'x-bento-token': config.token, accept: 'application/json', ...(iniciar.headers ?? {}) },
    });
  } catch (erro) {
    const tempo = erro instanceof Error && (erro.name === 'TimeoutError' || erro.name === 'AbortError');
    throw indisponivel(tempo ? 'O motor analítico demorou demais para responder.' : 'O motor analítico está fora do ar.');
  }
  if (resposta.ok) return resposta;
  const corpo = (await resposta.json().catch(() => null)) as { mensagem?: unknown } | null;
  const mensagem = typeof corpo?.mensagem === 'string' ? corpo.mensagem.slice(0, 300) : null;
  if (resposta.status === 422) throw validacao(mensagem ?? 'O motor analítico recusou os dados enviados.');
  if (resposta.status === 413) throw validacao('O volume de dados passou do limite aceito pelo motor analítico.');
  if (resposta.status === 401) throw indisponivel('O motor analítico recusou o token. Confira BENTO_ANALISE_TOKEN nos dois serviços.');
  throw indisponivel(mensagem ?? `O motor analítico respondeu com erro ${resposta.status}.`);
}

async function lerCorpo<T>(leitura: () => Promise<T>): Promise<T> {
  try {
    return await leitura();
  } catch {
    throw indisponivel('A resposta do motor analítico chegou incompleta.');
  }
}

export async function enviarAoMotor<T>(config: ConfigAnalise, caminho: string, corpo: unknown): Promise<T> {
  const resposta = await chamar(config, caminho, { method: 'POST', body: JSON.stringify(corpo), headers: { 'content-type': 'application/json' } });
  return lerCorpo(async () => (await resposta.json()) as T);
}

export async function baixarDoMotor(config: ConfigAnalise, caminho: string, corpo: unknown): Promise<Buffer> {
  const resposta = await chamar(config, caminho, { method: 'POST', body: JSON.stringify(corpo), headers: { 'content-type': 'application/json' } });
  return lerCorpo(async () => Buffer.from(await resposta.arrayBuffer()));
}

export async function saudeDoMotor(config: ConfigAnalise): Promise<SaudeMotor | null> {
  if (!motorConfigurado(config)) return null;
  try {
    const resposta = await chamar(config, '/saude', { method: 'GET' }, 3_000);
    return await lerCorpo(async () => (await resposta.json()) as SaudeMotor);
  } catch {
    return null;
  }
}

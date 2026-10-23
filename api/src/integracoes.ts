import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { FastifyBaseLogger } from 'fastify';
import type { Banco } from './banco/conexao.js';
import { assinarHmac, decifrar } from './util/seguranca.js';

/** Faixas IPv4 que nunca devem receber webhooks: loopback, privadas, link-local (metadados de nuvem), CGNAT, multicast etc. */
const FAIXAS_IPV4_INTERNAS: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
];

function ipv4ParaNumero(ip: string): number {
  return ip.split('.').reduce((total, parte) => total * 256 + Number(parte), 0);
}

function ipv4Interno(ip: string): boolean {
  const valor = ipv4ParaNumero(ip);
  return FAIXAS_IPV4_INTERNAS.some(([base, prefixo]) => {
    const tamanho = 2 ** (32 - prefixo);
    const inicio = ipv4ParaNumero(base);
    return valor >= inicio && valor < inicio + tamanho;
  });
}

/** Diz se um endereço IP (v4 ou v6) aponta para a própria máquina ou para uma rede interna. */
export function enderecoInterno(endereco: string): boolean {
  const ip = endereco.replace(/^\[|\]$/g, '').toLowerCase();
  const versao = isIP(ip);
  if (versao === 4) return ipv4Interno(ip);
  if (versao !== 6) return true;
  const mapeado = /^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapeado) return ipv4Interno(mapeado[1]);
  const hex = /^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
  if (hex) {
    const alto = Number.parseInt(hex[1], 16);
    const baixo = Number.parseInt(hex[2], 16);
    return ipv4Interno(`${alto >> 8}.${alto & 255}.${baixo >> 8}.${baixo & 255}`);
  }
  if (ip === '::' || ip === '::1') return true;
  const primeiro = Number.parseInt(ip.split(':')[0] || '0', 16);
  if ((primeiro & 0xfe00) === 0xfc00) return true; // fc00::/7 (ULA)
  if ((primeiro & 0xffc0) === 0xfe80) return true; // fe80::/10 (link-local)
  if ((primeiro & 0xff00) === 0xff00) return true; // ff00::/8 (multicast)
  if (ip.startsWith('64:ff9b:')) return true; // NAT64 pode apontar para IPv4 interno
  return false;
}

const permitirRedeInterna = () => ['1', 'true', 'sim'].includes((process.env.BENTO_INTEGRACOES_REDE_INTERNA ?? '').trim().toLowerCase());

/** Checagem sem DNS, usada ao salvar a configuração: recusa esquemas estranhos, localhost e IPs internos literais. */
export function destinoClaramenteInterno(bruto: string): string | null {
  if (permitirRedeInterna()) return null;
  let url: URL;
  try {
    url = new URL(bruto);
  } catch {
    return 'URL inválida.';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'Use uma URL http(s).';
  if (url.username || url.password) return 'A URL não pode conter usuário e senha.';
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return 'O destino aponta para a rede interna.';
  }
  if (isIP(host) && enderecoInterno(host)) return 'O destino aponta para a rede interna.';
  return null;
}

/** Proteção contra SSRF: resolve o nome e recusa o envio se qualquer endereço for interno. */
export async function garantirDestinoExterno(bruto: string): Promise<URL> {
  const problema = destinoClaramenteInterno(bruto);
  if (problema) throw new Error(`Destino bloqueado: ${problema}`);
  const url = new URL(bruto);
  if (permitirRedeInterna()) return url;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const enderecos = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
  if (enderecos.length === 0 || enderecos.some((item) => enderecoInterno(item.address))) {
    throw new Error('Destino bloqueado: o endereço resolve para a rede interna.');
  }
  return url;
}

export type EventoNegocio = 'transacao.paga' | 'usuario.criado' | 'usuario.bloqueado' | 'relatorio.gerado';

export type Provedor = 'webhook' | 'slack' | 'discord' | 'google-analytics' | 'stripe';

export interface CampoIntegracao {
  nome: string;
  rotulo: string;
  tipo: 'texto' | 'url' | 'segredo';
  obrigatorio: boolean;
  padrao?: RegExp;
  dica?: string;
}

export const CAMPOS_POR_PROVEDOR: Record<Provedor, CampoIntegracao[]> = {
  webhook: [
    { nome: 'url', rotulo: 'URL de destino', tipo: 'url', obrigatorio: true, padrao: /^https?:\/\/\S+$/ },
    { nome: 'segredo', rotulo: 'Segredo de assinatura', tipo: 'segredo', obrigatorio: true, padrao: /^.{12,200}$/ },
  ],
  slack: [
    {
      nome: 'webhookUrl',
      rotulo: 'URL do webhook de entrada',
      tipo: 'url',
      obrigatorio: true,
      padrao: /^https:\/\/hooks\.slack\.com\/\S+$/,
    },
  ],
  discord: [
    {
      nome: 'webhookUrl',
      rotulo: 'URL do webhook do canal',
      tipo: 'url',
      obrigatorio: true,
      padrao: /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\S+$/,
    },
  ],
  'google-analytics': [
    { nome: 'idMedicao', rotulo: 'ID de medição', tipo: 'texto', obrigatorio: true, padrao: /^G-[A-Z0-9]{6,12}$/ },
    { nome: 'segredoApi', rotulo: 'Segredo da API de medição', tipo: 'segredo', obrigatorio: false },
  ],
  stripe: [
    { nome: 'chavePublica', rotulo: 'Chave publicável', tipo: 'texto', obrigatorio: true, padrao: /^pk_(test|live)_\w{10,}$/ },
    { nome: 'chaveSecreta', rotulo: 'Chave secreta', tipo: 'segredo', obrigatorio: true, padrao: /^(sk|rk)_(test|live)_\w{10,}$/ },
    { nome: 'segredoWebhook', rotulo: 'Segredo do webhook', tipo: 'segredo', obrigatorio: false, padrao: /^whsec_\w{10,}$/ },
  ],
};

export const ENVIA_EVENTOS: Provedor[] = ['webhook', 'slack', 'discord'];

export function lerConfigIntegracao(config: unknown, segredo: string): Record<string, string> {
  const bruto = (config && typeof config === 'object' ? config : {}) as Record<string, unknown>;
  const resultado: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(bruto)) {
    resultado[chave] = decifrar(String(valor ?? ''), segredo);
  }
  return resultado;
}

export async function enviarParaProvedor(
  provedor: Provedor,
  valores: Record<string, string>,
  evento: string,
  resumo: string,
  dados: unknown,
): Promise<void> {
  const controle = AbortSignal.timeout(5_000);
  let url = '';
  let corpo = '';
  const cabecalhos: Record<string, string> = { 'content-type': 'application/json', 'user-agent': 'Bento/1.0' };
  if (provedor === 'webhook') {
    url = valores.url;
    corpo = JSON.stringify({ evento, resumo, criadoEm: new Date().toISOString(), dados });
    cabecalhos['x-bento-evento'] = evento;
    cabecalhos['x-bento-assinatura'] = `sha256=${assinarHmac(valores.segredo ?? '', corpo)}`;
  } else if (provedor === 'slack') {
    url = valores.webhookUrl;
    corpo = JSON.stringify({ text: `*Bento* · ${resumo}` });
  } else if (provedor === 'discord') {
    url = valores.webhookUrl;
    corpo = JSON.stringify({ content: `**Bento** · ${resumo}` });
  } else {
    return;
  }
  const destino = await garantirDestinoExterno(url);
  // redirect: 'manual' impede que um 3xx leve o servidor a um endereço interno depois da checagem.
  const resposta = await fetch(destino, { method: 'POST', headers: cabecalhos, body: corpo, signal: controle, redirect: 'manual' });
  if (!resposta.ok) throw new Error(`O destino respondeu ${resposta.status}`);
}

export async function dispararIntegracoes(
  banco: Banco,
  segredo: string,
  log: FastifyBaseLogger,
  evento: EventoNegocio,
  resumo: string,
  dados: unknown,
): Promise<void> {
  const { linhas } = await banco.consultar<{ id: string; provedor: Provedor; config: unknown }>(
    `select id, provedor, config from integracoes where ativo and provedor = any($1::text[])`,
    [ENVIA_EVENTOS],
  );
  await Promise.all(
    linhas.map(async (integracao) => {
      try {
        await enviarParaProvedor(integracao.provedor, lerConfigIntegracao(integracao.config, segredo), evento, resumo, dados);
        await banco.consultar(
          `update integracoes set ultimo_evento = now(), status = 'conectada', ultimo_erro = null where id = $1`,
          [integracao.id],
        );
      } catch (erro) {
        const mensagem = erro instanceof Error ? erro.message : String(erro);
        log.warn({ provedor: integracao.provedor, erro: mensagem }, 'Falha ao enviar evento para integração');
        await banco
          .consultar(`update integracoes set status = 'erro', ultimo_erro = $2 where id = $1`, [integracao.id, mensagem.slice(0, 300)])
          .catch(() => undefined);
      }
    }),
  );
}

export function dispararEmSegundoPlano(
  banco: Banco,
  segredo: string,
  log: FastifyBaseLogger,
  evento: EventoNegocio,
  resumo: string,
  dados: unknown,
): void {
  void dispararIntegracoes(banco, segredo, log, evento, resumo, dados).catch((erro) => {
    log.warn({ erro }, 'Falha ao processar integrações');
  });
}

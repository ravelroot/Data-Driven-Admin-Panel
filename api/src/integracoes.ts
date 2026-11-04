import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { performance } from 'node:perf_hooks';
import type { FastifyBaseLogger } from 'fastify';
import type { Banco } from './banco/conexao.js';
import { VERSAO } from './config.js';
import { assinarHmac, decifrar } from './util/seguranca.js';

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
  if ((primeiro & 0xfe00) === 0xfc00) return true;
  if ((primeiro & 0xffc0) === 0xfe80) return true;
  if ((primeiro & 0xff00) === 0xff00) return true;
  if (ip.startsWith('64:ff9b:')) return true;
  return false;
}

const permitirRedeInterna = () => ['1', 'true', 'sim'].includes((process.env.BENTO_INTEGRACOES_REDE_INTERNA ?? '').trim().toLowerCase());

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

export interface ResultadoEnvio {
  codigoHttp: number | null;
  duracaoMs: number;
}

export class ErroEnvio extends Error {
  readonly codigoHttp: number | null;
  readonly duracaoMs: number;

  constructor(mensagem: string, codigoHttp: number | null, duracaoMs: number) {
    super(mensagem);
    this.name = 'ErroEnvio';
    this.codigoHttp = codigoHttp;
    this.duracaoMs = duracaoMs;
  }
}

export interface OpcoesEnvio {
  entregaId?: string;
  criadoEm?: string;
  tentativa?: number;
}

export async function enviarParaProvedor(
  provedor: Provedor,
  valores: Record<string, string>,
  evento: string,
  resumo: string,
  dados: unknown,
  opcoes: OpcoesEnvio = {},
): Promise<ResultadoEnvio> {
  const inicio = performance.now();
  const duracao = () => Math.round(performance.now() - inicio);
  let url = '';
  let corpo = '';
  const cabecalhos: Record<string, string> = { 'content-type': 'application/json', 'user-agent': `Bento/${VERSAO}` };
  if (provedor === 'webhook') {
    url = valores.url;
    corpo = JSON.stringify({ evento, resumo, criadoEm: opcoes.criadoEm ?? new Date().toISOString(), entrega: opcoes.entregaId ?? null, dados });
    cabecalhos['x-bento-evento'] = evento;
    cabecalhos['x-bento-assinatura'] = `sha256=${assinarHmac(valores.segredo ?? '', corpo)}`;
    if (opcoes.entregaId) cabecalhos['x-bento-entrega'] = opcoes.entregaId;
    if (opcoes.tentativa) cabecalhos['x-bento-tentativa'] = String(opcoes.tentativa);
  } else if (provedor === 'slack') {
    url = valores.webhookUrl;
    corpo = JSON.stringify({ text: `*Bento* · ${resumo}` });
  } else if (provedor === 'discord') {
    url = valores.webhookUrl;
    corpo = JSON.stringify({ content: `**Bento** · ${resumo}` });
  } else {
    return { codigoHttp: null, duracaoMs: 0 };
  }
  let destino: URL;
  try {
    destino = await garantirDestinoExterno(url);
  } catch (erro) {
    throw new ErroEnvio(erro instanceof Error ? erro.message : String(erro), null, duracao());
  }
  let resposta: Response;
  try {
    resposta = await fetch(destino, { method: 'POST', headers: cabecalhos, body: corpo, signal: AbortSignal.timeout(TEMPO_LIMITE_ENVIO), redirect: 'manual' });
  } catch (erro) {
    const nome = (erro as { name?: string }).name;
    throw new ErroEnvio(nome === 'TimeoutError' ? `O destino não respondeu em ${TEMPO_LIMITE_ENVIO / 1000} s` : 'Não foi possível conectar ao destino', null, duracao());
  }
  await resposta.body?.cancel().catch(() => undefined);
  if (!resposta.ok) throw new ErroEnvio(`O destino respondeu ${resposta.status}`, resposta.status, duracao());
  return { codigoHttp: resposta.status, duracaoMs: duracao() };
}

export const MAX_TENTATIVAS = 4;
export const ESPERAS_MINUTOS = [1, 5, 30];
const TEMPO_LIMITE_ENVIO = 5_000;

interface EntregaReservada {
  id: string;
  integracao_id: string;
  evento: string;
  resumo: string;
  carga: unknown;
  tentativas: number;
  teste: boolean;
  criado_em: Date | string;
  provedor: Provedor;
  ativo: boolean;
  config: unknown;
}

export async function registrarEntrega(
  banco: Banco,
  integracaoId: string,
  evento: string,
  resumo: string,
  dados: unknown,
  teste = false,
): Promise<string> {
  const { linhas } = await banco.consultar<{ id: string }>(
    `insert into entregas_integracao (integracao_id, evento, resumo, carga, teste, proxima_tentativa)
     values ($1, $2, $3, $4::jsonb, $5, now()) returning id`,
    [integracaoId, evento, resumo.slice(0, 300), JSON.stringify(dados ?? {}), teste],
  );
  return linhas[0].id;
}

export interface ResultadoEntrega {
  id: string;
  ok: boolean;
  status: 'pendente' | 'entregue' | 'falhou';
  mensagem: string;
  codigoHttp: number | null;
  tentativas: number;
}

export async function tentarEntrega(banco: Banco, segredo: string, log: FastifyBaseLogger, entregaId: string): Promise<ResultadoEntrega | null> {
  const { linhas } = await banco.consultar<EntregaReservada>(
    `with reservada as (
       update entregas_integracao set proxima_tentativa = now() + interval '2 minutes', atualizado_em = now()
        where id = $1 and status = 'pendente' and proxima_tentativa <= now()
        returning *
     )
     select r.id, r.integracao_id, r.evento, r.resumo, r.carga, r.tentativas, r.teste, r.criado_em, i.provedor, i.ativo, i.config
       from reservada r join integracoes i on i.id = r.integracao_id`,
    [entregaId],
  );
  const entrega = linhas[0];
  if (!entrega) return null;
  const tentativa = entrega.tentativas + 1;
  if (!entrega.ativo && !entrega.teste) {
    await banco.consultar(
      `update entregas_integracao set status = 'falhou', proxima_tentativa = null, erro = 'A integração foi desativada.', atualizado_em = now() where id = $1`,
      [entrega.id],
    );
    return { id: entrega.id, ok: false, status: 'falhou', mensagem: 'A integração foi desativada.', codigoHttp: null, tentativas: entrega.tentativas };
  }
  try {
    const resultado = await enviarParaProvedor(
      entrega.provedor,
      lerConfigIntegracao(entrega.config, segredo),
      entrega.evento,
      entrega.resumo,
      entrega.carga,
      { entregaId: entrega.id, criadoEm: new Date(entrega.criado_em).toISOString(), tentativa },
    );
    await banco.transacao(async (tx) => {
      await tx.consultar(
        `update entregas_integracao set status = 'entregue', tentativas = $2, proxima_tentativa = null, codigo_http = $3, duracao_ms = $4,
                erro = null, atualizado_em = now()
          where id = $1`,
        [entrega.id, tentativa, resultado.codigoHttp, resultado.duracaoMs],
      );
      await tx.consultar(
        `update integracoes set ultimo_evento = now(), ultimo_erro = null, status = case when ativo then 'conectada' else status end where id = $1`,
        [entrega.integracao_id],
      );
    });
    return { id: entrega.id, ok: true, status: 'entregue', mensagem: 'Entregue.', codigoHttp: resultado.codigoHttp, tentativas: tentativa };
  } catch (erro) {
    const mensagem = (erro instanceof Error ? erro.message : String(erro)).slice(0, 300);
    const codigoHttp = erro instanceof ErroEnvio ? erro.codigoHttp : null;
    const duracaoMs = erro instanceof ErroEnvio ? erro.duracaoMs : null;
    const definitivo = entrega.teste || tentativa >= MAX_TENTATIVAS || mensagem.startsWith('Destino bloqueado');
    const espera = ESPERAS_MINUTOS[Math.min(tentativa - 1, ESPERAS_MINUTOS.length - 1)] ?? 30;
    await banco.transacao(async (tx) => {
      await tx.consultar(
        `update entregas_integracao
            set status = $2, tentativas = $3, codigo_http = $4, duracao_ms = $5, erro = $6, atualizado_em = now(),
                proxima_tentativa = case when $2 = 'pendente' then now() + make_interval(mins => $7::int) else null end
          where id = $1`,
        [entrega.id, definitivo ? 'falhou' : 'pendente', tentativa, codigoHttp, duracaoMs, mensagem, espera],
      );
      await tx.consultar(`update integracoes set ultimo_erro = $2, status = case when ativo then 'erro' else status end where id = $1`, [
        entrega.integracao_id,
        mensagem,
      ]);
    });
    if (!entrega.teste) log.warn({ provedor: entrega.provedor, erro: mensagem, tentativa }, 'Falha ao entregar evento para integração');
    return { id: entrega.id, ok: false, status: definitivo ? 'falhou' : 'pendente', mensagem, codigoHttp, tentativas: tentativa };
  }
}

export async function processarEntregasPendentes(banco: Banco, segredo: string, log: FastifyBaseLogger, limite = 20): Promise<number> {
  const { linhas } = await banco.consultar<{ id: string }>(
    `select id from entregas_integracao where status = 'pendente' and proxima_tentativa <= now() order by proxima_tentativa limit $1`,
    [limite],
  );
  let processadas = 0;
  for (const { id } of linhas) {
    if (await tentarEntrega(banco, segredo, log, id)) processadas += 1;
  }
  return processadas;
}

export async function dispararIntegracoes(
  banco: Banco,
  segredo: string,
  log: FastifyBaseLogger,
  evento: EventoNegocio,
  resumo: string,
  dados: unknown,
): Promise<void> {
  const { linhas } = await banco.consultar<{ id: string }>(`select id from integracoes where ativo and provedor = any($1::text[])`, [ENVIA_EVENTOS]);
  await Promise.all(
    linhas.map(async (integracao) => {
      const entregaId = await registrarEntrega(banco, integracao.id, evento, resumo, dados);
      await tentarEntrega(banco, segredo, log, entregaId);
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

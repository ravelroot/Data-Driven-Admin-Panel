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

export const EVENTOS_NEGOCIO = ['transacao.paga', 'usuario.criado', 'usuario.bloqueado', 'relatorio.gerado', 'alerta.disparado'] as const;

export type EventoNegocio = (typeof EVENTOS_NEGOCIO)[number];

export const PROVEDORES = ['webhook', 'slack', 'discord', 'teams', 'google-chat', 'telegram', 'google-analytics', 'stripe'] as const;

export type Provedor = (typeof PROVEDORES)[number];

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
  teams: [
    {
      nome: 'webhookUrl',
      rotulo: 'URL do webhook do canal',
      tipo: 'url',
      obrigatorio: true,
      padrao: /^https:\/\/\S+$/,
      dica: 'Endereço gerado pelo fluxo "Postar em um canal quando uma solicitação de webhook for recebida" do Teams.',
    },
  ],
  'google-chat': [
    {
      nome: 'webhookUrl',
      rotulo: 'URL do webhook do espaço',
      tipo: 'url',
      obrigatorio: true,
      padrao: /^https:\/\/chat\.googleapis\.com\/v1\/spaces\/\S+$/,
      dica: 'Começa com https://chat.googleapis.com/v1/spaces/ e já traz a chave e o token.',
    },
  ],
  telegram: [
    {
      nome: 'tokenBot',
      rotulo: 'Token do bot',
      tipo: 'segredo',
      obrigatorio: true,
      padrao: /^\d{5,12}:[A-Za-z0-9_-]{30,60}$/,
      dica: 'Entregue pelo @BotFather, no formato 123456789:AA…',
    },
    {
      nome: 'chatId',
      rotulo: 'ID da conversa ou @canal',
      tipo: 'texto',
      obrigatorio: true,
      padrao: /^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/,
      dica: 'Número da conversa (grupos começam com -100) ou o @nome de um canal público.',
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

export const ENVIA_EVENTOS: Provedor[] = ['webhook', 'slack', 'discord', 'teams', 'google-chat', 'telegram'];

export interface GuiaIntegracao {
  passos: string[];
  documentacao: string;
}

export const GUIAS: Record<Provedor, GuiaIntegracao> = {
  webhook: {
    passos: [
      'Crie no seu sistema (n8n, Make, Zapier, Pipedream ou a sua API) um endereço que aceite POST com JSON.',
      'Cole o endereço aqui e invente um segredo longo: o Bento assina cada envio com ele.',
      'No destino, confira o cabeçalho X-Bento-Assinatura (HMAC-SHA256 do corpo) e ignore entregas repetidas pelo X-Bento-Entrega.',
      'Clique em Testar para mandar um evento de exemplo.',
    ],
    documentacao: '/api/v1/docs',
  },
  slack: {
    passos: [
      'No Slack, crie um app em api.slack.com/apps e ative Incoming Webhooks.',
      'Clique em "Add New Webhook to Workspace" e escolha o canal.',
      'Copie a URL https://hooks.slack.com/… e cole aqui.',
      'Clique em Testar: a mensagem chega no canal na hora.',
    ],
    documentacao: 'https://api.slack.com/messaging/webhooks',
  },
  discord: {
    passos: [
      'No Discord, abra Configurações do canal › Integrações › Webhooks.',
      'Clique em "Novo webhook", dê um nome e escolha o canal.',
      'Clique em "Copiar URL do webhook" e cole aqui.',
      'Clique em Testar para conferir.',
    ],
    documentacao: 'https://support.discord.com/hc/pt-br/articles/228383668',
  },
  teams: {
    passos: [
      'No Teams, clique em ⋯ ao lado do canal (ou da conversa) › Fluxos de trabalho.',
      'Escolha o modelo "Postar em um canal quando uma solicitação de webhook for recebida", escolha a equipe e o canal e salve.',
      'Copie a URL do HTTP POST que o Teams mostra no fim e cole aqui.',
      'Clique em Testar: o Bento manda um cartão adaptável para o canal.',
    ],
    documentacao: 'https://learn.microsoft.com/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook',
  },
  'google-chat': {
    passos: [
      'No Google Chat pelo navegador, abra o espaço e clique na seta ao lado do nome › Apps e integrações.',
      'Clique em "Adicionar webhooks", dê um nome e salve.',
      'No webhook criado, clique em Mais › Copiar link e cole aqui a URL https://chat.googleapis.com/v1/spaces/….',
      'Clique em Testar para conferir.',
    ],
    documentacao: 'https://developers.google.com/workspace/chat/quickstart/webhooks',
  },
  telegram: {
    passos: [
      'No Telegram, converse com o @BotFather, envie /newbot e copie o token que ele devolve.',
      'Adicione o bot ao grupo (ou mande uma mensagem para ele, se for uma conversa direta).',
      'Descubra o ID da conversa: abra api.telegram.org/bot<token>/getUpdates depois de mandar uma mensagem no grupo e copie o "chat":{"id"}.',
      'Cole o token e o ID aqui e clique em Testar.',
    ],
    documentacao: 'https://core.telegram.org/bots/features#botfather',
  },
  'google-analytics': {
    passos: [
      'No Google Analytics, abra Administrador › Fluxos de dados e escolha o fluxo da web.',
      'Copie o ID de medição (G-XXXXXXX) e cole aqui.',
      'Se for usar o Measurement Protocol, crie também um segredo da API no mesmo fluxo.',
    ],
    documentacao: 'https://developers.google.com/analytics/devguides/collection/protocol/ga4',
  },
  stripe: {
    passos: [
      'No Stripe, abra Desenvolvedores › Chaves de API.',
      'Copie a chave publicável (pk_…) e crie uma chave restrita (rk_…) só com leitura.',
      'Se for receber eventos do Stripe, copie também o segredo do endpoint de webhook (whsec_…).',
    ],
    documentacao: 'https://docs.stripe.com/keys',
  },
};

export const EXEMPLO_WEBHOOK = {
  evento: 'transacao.paga',
  resumo: 'Ana Souza pagou R$ 129,00 (Profissional)',
  criadoEm: '2026-11-20T12:00:00.000Z',
  entrega: '3f1c2a9e-1b7d-4e0a-9c55-1f2e3d4c5b6a',
  dados: { id: '9b2d…', codigo: 'TX-1042', valor: 12900, status: 'paga', plano: 'profissional' },
};

export interface Envio {
  url: string;
  corpo: string;
  cabecalhos: Record<string, string>;
}

const ROTULOS_EVENTO: Record<string, string> = {
  'transacao.paga': 'Transação paga',
  'usuario.criado': 'Novo cadastro',
  'usuario.bloqueado': 'Usuário bloqueado',
  'relatorio.gerado': 'Relatório gerado',
  'alerta.disparado': 'Alerta de métrica',
  'integracao.teste': 'Teste',
};

export function montarEnvio(
  provedor: Provedor,
  valores: Record<string, string>,
  evento: string,
  resumo: string,
  dados: unknown,
  opcoes: OpcoesEnvio = {},
): Envio | null {
  const cabecalhos: Record<string, string> = { 'content-type': 'application/json', 'user-agent': `Bento/${VERSAO}` };
  const titulo = ROTULOS_EVENTO[evento] ?? evento;
  if (provedor === 'webhook') {
    const corpo = JSON.stringify({ evento, resumo, criadoEm: opcoes.criadoEm ?? new Date().toISOString(), entrega: opcoes.entregaId ?? null, dados });
    cabecalhos['x-bento-evento'] = evento;
    cabecalhos['x-bento-assinatura'] = `sha256=${assinarHmac(valores.segredo ?? '', corpo)}`;
    if (opcoes.entregaId) cabecalhos['x-bento-entrega'] = opcoes.entregaId;
    if (opcoes.tentativa) cabecalhos['x-bento-tentativa'] = String(opcoes.tentativa);
    return { url: valores.url, corpo, cabecalhos };
  }
  if (provedor === 'slack') return { url: valores.webhookUrl, corpo: JSON.stringify({ text: `*Bento* · ${resumo}` }), cabecalhos };
  if (provedor === 'discord') return { url: valores.webhookUrl, corpo: JSON.stringify({ content: `**Bento** · ${resumo}` }), cabecalhos };
  if (provedor === 'google-chat') return { url: valores.webhookUrl, corpo: JSON.stringify({ text: `*Bento · ${titulo}*\n${resumo}` }), cabecalhos };
  if (provedor === 'teams') {
    const cartao = {
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          contentUrl: null,
          content: {
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            type: 'AdaptiveCard',
            version: '1.4',
            body: [
              { type: 'TextBlock', text: `Bento · ${titulo}`, weight: 'Bolder', size: 'Medium', wrap: true },
              { type: 'TextBlock', text: resumo, wrap: true },
            ],
          },
        },
      ],
    };
    return { url: valores.webhookUrl, corpo: JSON.stringify(cartao), cabecalhos };
  }
  if (provedor === 'telegram') {
    const corpo = JSON.stringify({ chat_id: valores.chatId, text: `Bento · ${titulo}\n${resumo}`, disable_web_page_preview: true });
    return { url: `https://api.telegram.org/bot${valores.tokenBot ?? ''}/sendMessage`, corpo, cabecalhos };
  }
  return null;
}

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
  const envio = montarEnvio(provedor, valores, evento, resumo, dados, opcoes);
  if (!envio) return { codigoHttp: null, duracaoMs: 0 };
  const { url, corpo, cabecalhos } = envio;
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
  const { linhas } = await banco.consultar<{ id: string }>(
    `select id from integracoes where ativo and provedor = any($1::text[]) and (cardinality(eventos) = 0 or $2 = any(eventos))`,
    [ENVIA_EVENTOS, evento],
  );
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

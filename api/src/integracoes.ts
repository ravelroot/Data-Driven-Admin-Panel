import type { FastifyBaseLogger } from 'fastify';
import type { Banco } from './banco/conexao.js';
import { assinarHmac, decifrar } from './util/seguranca.js';

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
  const resposta = await fetch(url, { method: 'POST', headers: cabecalhos, body: corpo, signal: controle });
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

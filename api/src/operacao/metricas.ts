import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { VERSAO } from '../config.js';

const LIMITES_DURACAO = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const MAX_ROTAS = 400;

interface Histograma {
  baldes: number[];
  soma: number;
  total: number;
}

export interface Metricas {
  registrar(metodo: string, rota: string, status: number, segundos: number): void;
  requisicoes(): number;
  exportar(extras: string[]): string;
}

const escaparRotulo = (valor: string): string => valor.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

export const rotulos = (pares: Record<string, string | number>): string => {
  const partes = Object.entries(pares).map(([chave, valor]) => `${chave}="${escaparRotulo(String(valor))}"`);
  return partes.length ? `{${partes.join(',')}}` : '';
};

export function linhaMetrica(nome: string, tipo: 'counter' | 'gauge', ajuda: string, amostras: { rotulos?: Record<string, string | number>; valor: number }[]): string {
  const linhas = [`# HELP ${nome} ${ajuda}`, `# TYPE ${nome} ${tipo}`];
  for (const amostra of amostras) linhas.push(`${nome}${rotulos(amostra.rotulos ?? {})} ${Number.isFinite(amostra.valor) ? amostra.valor : 0}`);
  return linhas.join('\n');
}

export function criarMetricas(): Metricas {
  const contagens = new Map<string, number>();
  const duracoes = new Map<string, Histograma>();
  let totalRequisicoes = 0;

  return {
    registrar(metodo, rota, status, segundos) {
      totalRequisicoes += 1;
      const rotaLimitada = duracoes.has(rota) || duracoes.size < MAX_ROTAS ? rota : 'outras';
      const chave = `${metodo}\u0000${rotaLimitada}\u0000${status}`;
      contagens.set(chave, (contagens.get(chave) ?? 0) + 1);
      let histograma = duracoes.get(rotaLimitada);
      if (!histograma) {
        histograma = { baldes: LIMITES_DURACAO.map(() => 0), soma: 0, total: 0 };
        duracoes.set(rotaLimitada, histograma);
      }
      histograma.soma += segundos;
      histograma.total += 1;
      LIMITES_DURACAO.forEach((limite, indice) => {
        if (segundos <= limite) histograma.baldes[indice] += 1;
      });
    },
    requisicoes: () => totalRequisicoes,
    exportar(extras) {
      const blocos: string[] = [];
      blocos.push(
        linhaMetrica(
          'bento_requisicoes_total',
          'counter',
          'Requisições HTTP atendidas, por método, rota e status.',
          [...contagens.entries()].map(([chave, valor]) => {
            const [metodo, rota, status] = chave.split('\u0000');
            return { rotulos: { metodo: metodo ?? '', rota: rota ?? '', status: status ?? '' }, valor };
          }),
        ),
      );
      const histogramas = ['# HELP bento_requisicao_duracao_segundos Duração das requisições HTTP por rota.', '# TYPE bento_requisicao_duracao_segundos histogram'];
      for (const [rota, histograma] of duracoes) {
        LIMITES_DURACAO.forEach((limite, indice) => {
          histogramas.push(`bento_requisicao_duracao_segundos_bucket${rotulos({ rota, le: limite })} ${histograma.baldes[indice]}`);
        });
        histogramas.push(`bento_requisicao_duracao_segundos_bucket${rotulos({ rota, le: '+Inf' })} ${histograma.total}`);
        histogramas.push(`bento_requisicao_duracao_segundos_sum${rotulos({ rota })} ${Number(histograma.soma.toFixed(6))}`);
        histogramas.push(`bento_requisicao_duracao_segundos_count${rotulos({ rota })} ${histograma.total}`);
      }
      blocos.push(histogramas.join('\n'));
      blocos.push(...extras);
      return `${blocos.join('\n')}\n`;
    },
  };
}

export function tokenConfere(recebido: string, esperado: string): boolean {
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function registrarColetaMetricas(app: FastifyInstance): void {
  app.addHook('onResponse', async (requisicao, resposta) => {
    const rota = requisicao.routeOptions.url ?? 'nao_encontrada';
    app.metricas.registrar(requisicao.method, rota, resposta.statusCode, resposta.elapsedTime / 1_000);
  });
}

export async function metricasDoProcesso(app: FastifyInstance): Promise<string[]> {
  const memoria = process.memoryUsage();
  const blocos = [
    linhaMetrica('bento_info', 'gauge', 'Versão do Bento e tipo de banco.', [{ rotulos: { versao: VERSAO, banco: app.banco.tipo, node: process.version }, valor: 1 }]),
    linhaMetrica('bento_tempo_no_ar_segundos', 'gauge', 'Segundos desde que o processo começou.', [{ valor: Math.round(process.uptime()) }]),
    linhaMetrica('bento_memoria_bytes', 'gauge', 'Memória do processo.', [
      { rotulos: { tipo: 'rss' }, valor: memoria.rss },
      { rotulos: { tipo: 'heap_usado' }, valor: memoria.heapUsed },
      { rotulos: { tipo: 'heap_total' }, valor: memoria.heapTotal },
    ]),
    linhaMetrica('bento_tempo_real_conexoes', 'gauge', 'Conexões de tempo real abertas nesta instância.', [{ valor: app.barramento.assinantes() }]),
    linhaMetrica('bento_manutencao', 'gauge', '1 quando o modo de manutenção está ativo.', [{ valor: app.estado.manutencao.ativo ? 1 : 0 }]),
  ];
  try {
    const { linhas } = await app.banco.consultar<{
      usuarios_ativos: number;
      usuarios_bloqueados: number;
      sessoes_ativas: number;
      notificacoes: number;
      relatorios_bytes: number;
      agendamentos_atrasados: number;
      entregas_pendentes: number;
      entregas_falhas_24h: number;
      integracoes_com_erro: number;
    }>(
      `select
         (select count(*) from usuarios where status = 'ativo')::int as usuarios_ativos,
         (select count(*) from usuarios where status = 'bloqueado')::int as usuarios_bloqueados,
         (select count(*) from sessoes where revogada_em is null and expira_em > now())::int as sessoes_ativas,
         (select count(*) from notificacoes)::int as notificacoes,
         (select coalesce(sum(tamanho_bytes), 0) from relatorios)::float8 as relatorios_bytes,
         (select count(*) from relatorios_agendados where ativo and proxima_execucao < now() - interval '10 minutes')::int as agendamentos_atrasados,
         (select count(*) from entregas_integracao where status = 'pendente')::int as entregas_pendentes,
         (select count(*) from entregas_integracao where status = 'falhou' and atualizado_em > now() - interval '24 hours')::int as entregas_falhas_24h,
         (select count(*) from integracoes where status = 'erro')::int as integracoes_com_erro`,
    );
    const dados = linhas[0];
    if (dados) {
      blocos.push(
        linhaMetrica('bento_banco_disponivel', 'gauge', '1 quando o banco respondeu à coleta.', [{ valor: 1 }]),
        linhaMetrica('bento_usuarios', 'gauge', 'Contas por status.', [
          { rotulos: { status: 'ativo' }, valor: dados.usuarios_ativos },
          { rotulos: { status: 'bloqueado' }, valor: dados.usuarios_bloqueados },
        ]),
        linhaMetrica('bento_sessoes_ativas', 'gauge', 'Sessões abertas e não expiradas.', [{ valor: dados.sessoes_ativas }]),
        linhaMetrica('bento_notificacoes', 'gauge', 'Notificações guardadas.', [{ valor: dados.notificacoes }]),
        linhaMetrica('bento_relatorios_bytes', 'gauge', 'Espaço ocupado pelos relatórios gerados.', [{ valor: dados.relatorios_bytes }]),
        linhaMetrica('bento_agendamentos_atrasados', 'gauge', 'Relatórios agendados com mais de 10 minutos de atraso.', [{ valor: dados.agendamentos_atrasados }]),
        linhaMetrica('bento_entregas_pendentes', 'gauge', 'Entregas de integrações aguardando nova tentativa.', [{ valor: dados.entregas_pendentes }]),
        linhaMetrica('bento_entregas_falhas_24h', 'gauge', 'Entregas de integrações que falharam de vez nas últimas 24 horas.', [{ valor: dados.entregas_falhas_24h }]),
        linhaMetrica('bento_integracoes_com_erro', 'gauge', 'Integrações com status de erro.', [{ valor: dados.integracoes_com_erro }]),
      );
    }
  } catch {
    blocos.push(linhaMetrica('bento_banco_disponivel', 'gauge', '1 quando o banco respondeu à coleta.', [{ valor: 0 }]));
  }
  return blocos;
}

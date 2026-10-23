import type { FastifyInstance } from 'fastify';
import { performance } from 'node:perf_hooks';
import { VERSAO } from '../../config.js';
import { exigir } from '../../plugins/autenticacao.js';

/** Tabelas mostradas no status, na ordem em que aparecem na tela. */
const TABELAS = ['usuarios', 'assinaturas', 'transacoes', 'notificacoes', 'relatorios', 'relatorios_agendados', 'sessoes', 'chaves_api', 'auditoria'] as const;

interface LinhaMigracao {
  nome: string;
  aplicada_em: Date | string;
}

export async function rotasSistema(app: FastifyInstance): Promise<void> {
  app.get(
    '/sistema/status',
    {
      schema: {
        tags: ['Sistema'],
        summary: 'Versão, banco, processo, tempo real, volume das tabelas e migrações aplicadas',
      },
      preHandler: [app.autenticar, exigir('configuracoes.sistema')],
    },
    async () => {
      const inicio = performance.now();
      await app.banco.consultar('select 1');
      const latenciaMs = Math.round((performance.now() - inicio) * 100) / 100;

      const contagens = TABELAS.map((tabela) => `(select count(*) from ${tabela})::int as ${tabela}`).join(', ');
      const [versaoBanco, tamanho, volume, migracoes] = await Promise.all([
        app.banco.consultar<{ versao: string }>('select version() as versao'),
        app.banco
          .consultar<{ bytes: number }>('select pg_database_size(current_database())::float8 as bytes')
          .catch(() => ({ linhas: [{ bytes: 0 }] })),
        app.banco.consultar<Record<string, number>>(`select ${contagens}`),
        app.banco.consultar<LinhaMigracao>('select nome, aplicada_em from migracoes order by nome'),
      ]);

      const memoria = process.memoryUsage();
      const linhaVolume = volume.linhas[0] ?? {};
      return {
        versao: VERSAO,
        agora: new Date().toISOString(),
        fuso: app.config.fuso,
        simulador: app.config.simulador,
        node: process.version,
        plataforma: `${process.platform} ${process.arch}`,
        processo: {
          pid: process.pid,
          tempoNoArSegundos: Math.round(process.uptime()),
          memoriaBytes: memoria.rss,
          heapUsadoBytes: memoria.heapUsed,
        },
        banco: {
          tipo: app.banco.tipo,
          versao: (versaoBanco.linhas[0]?.versao ?? '').split(' ').slice(0, 2).join(' '),
          latenciaMs,
          tamanhoBytes: Number(tamanho.linhas[0]?.bytes ?? 0),
        },
        tempoReal: {
          conexoes: app.barramento.assinantes(),
          canalAtivo: app.barramento.conectado(),
        },
        tabelas: TABELAS.map((nome) => ({ nome, registros: Number(linhaVolume[nome] ?? 0) })),
        migracoes: migracoes.linhas.map((linha) => ({
          nome: linha.nome,
          aplicadaEm: new Date(linha.aplicada_em).toISOString(),
        })),
      };
    },
  );
}

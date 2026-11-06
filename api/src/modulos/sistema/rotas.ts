import { createReadStream } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { VERSAO } from '../../config.js';
import { arquivoBackupValido, listarBackups, podarBackups, salvarBackup } from '../../operacao/backup.js';
import { executarDiagnostico } from '../../operacao/diagnostico.js';
import { definirManutencao } from '../../operacao/manutencao.js';
import { executarLimpeza, previaLimpeza, totalRemovido } from '../../operacao/retencao.js';
import { exigir } from '../../plugins/autenticacao.js';
import { usuarioAtual } from '../../tipos.js';
import { naoEncontrado } from '../../util/erros.js';
import { registrarAtividade } from '../comum/auditoria.js';
import { primeirosPassos } from './primeiros-passos.js';

const TABELAS = [
  'usuarios',
  'assinaturas',
  'transacoes',
  'notificacoes',
  'relatorios',
  'relatorios_agendados',
  'sessoes',
  'chaves_api',
  'notas_usuario',
  'entregas_integracao',
  'auditoria',
] as const;

interface LinhaMigracao {
  nome: string;
  aplicada_em: Date | string;
}

const corpoManutencao = z
  .object({
    ativo: z.boolean(),
    mensagem: z.string().trim().max(300).optional(),
  })
  .strict();

const paramArquivo = z.object({ nome: z.string().refine(arquivoBackupValido, 'Nome de arquivo inválido.') });

export async function rotasSistema(app: FastifyInstance): Promise<void> {
  const tags = ['Sistema'];
  const administrar = [app.autenticar, exigir('configuracoes.sistema')];

  app.get(
    '/sistema/status',
    {
      schema: { tags, summary: 'Versão, banco, processo, tempo real, volume das tabelas, migrações, retenção e backups' },
      preHandler: administrar,
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
      const { config } = app;
      return {
        versao: VERSAO,
        agora: new Date().toISOString(),
        fuso: config.fuso,
        simulador: config.simulador,
        producao: config.producao,
        node: process.version,
        plataforma: `${process.platform} ${process.arch}`,
        processo: {
          pid: process.pid,
          tempoNoArSegundos: Math.round(process.uptime()),
          memoriaBytes: memoria.rss,
          heapUsadoBytes: memoria.heapUsed,
          requisicoes: app.metricas.requisicoes(),
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
        manutencao: app.estado.manutencao,
        retencao: config.retencao,
        backup: {
          automatico: config.backup.automatico,
          manter: config.backup.manter,
          pasta: path.relative(process.cwd(), config.backup.pasta) || config.backup.pasta,
        },
        metricas: Boolean(config.metricasToken),
        analise: { configurado: Boolean(config.analise.url && config.analise.token), cacheMinutos: config.analise.cacheMinutos },
        tabelas: TABELAS.map((nome) => ({ nome, registros: Number(linhaVolume[nome] ?? 0) })),
        migracoes: migracoes.linhas.map((linha) => ({
          nome: linha.nome,
          aplicadaEm: new Date(linha.aplicada_em).toISOString(),
        })),
      };
    },
  );

  app.get(
    '/sistema/diagnostico',
    { schema: { tags, summary: 'Confere ambiente, configuração, banco, segurança e operação' }, preHandler: administrar },
    async () => executarDiagnostico(app.config, app.banco),
  );

  app.get(
    '/sistema/manutencao',
    { schema: { tags, summary: 'Estado do modo de manutenção' }, preHandler: [app.autenticar] },
    async () => app.estado.manutencao,
  );

  app.put(
    '/sistema/manutencao',
    { schema: { tags, summary: 'Liga ou desliga o modo de manutenção (somente leitura)', body: corpoManutencao }, preHandler: administrar },
    async (requisicao) => {
      const autor = usuarioAtual(requisicao);
      return definirManutencao(app, requisicao.body as z.infer<typeof corpoManutencao>, autor, requisicao.ip);
    },
  );

  app.get(
    '/sistema/limpeza',
    { schema: { tags, summary: 'Prévia do que a política de retenção removeria agora' }, preHandler: administrar },
    async () => {
      const itens = await previaLimpeza(app.banco, app.config.retencao);
      return { itens, total: totalRemovido(itens) };
    },
  );

  app.post(
    '/sistema/limpeza',
    {
      schema: { tags, summary: 'Aplica a política de retenção agora' },
      preHandler: administrar,
      config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
    },
    async (requisicao) => {
      const usuario = usuarioAtual(requisicao);
      const itens = await executarLimpeza(app.banco, app.config.retencao);
      const total = totalRemovido(itens);
      await registrarAtividade(app.banco, {
        usuarioId: usuario.id,
        acao: 'sistema.limpeza_executada',
        entidade: 'sistema',
        descricao: total ? `aplicou a retenção de dados e removeu ${total} registros` : 'aplicou a retenção de dados (nada a remover)',
        detalhes: Object.fromEntries(itens.filter((item) => item.registros > 0).map((item) => [item.categoria, item.registros])),
        ip: requisicao.ip,
      });
      return { itens, total };
    },
  );

  app.get(
    '/sistema/backups',
    { schema: { tags, summary: 'Backups gravados na pasta do servidor' }, preHandler: administrar },
    async () => ({
      automatico: app.config.backup.automatico,
      manter: app.config.backup.manter,
      itens: listarBackups(app.config.backup.pasta),
    }),
  );

  app.post(
    '/sistema/backups',
    {
      schema: { tags, summary: 'Grava um backup completo agora' },
      preHandler: administrar,
      config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
    },
    async (requisicao, resposta) => {
      const usuario = usuarioAtual(requisicao);
      const resumo = await salvarBackup(app.banco, app.config.backup.pasta, 'manual');
      if (app.config.backup.automatico !== 'desligado') podarBackups(app.config.backup.pasta, app.config.backup.manter + 20);
      const nome = path.basename(resumo.arquivo);
      await registrarAtividade(app.banco, {
        usuarioId: usuario.id,
        acao: 'sistema.backup_criado',
        entidade: 'sistema',
        entidadeId: nome,
        descricao: `gravou o backup ${nome}`,
        detalhes: { registros: resumo.registros, bytes: resumo.bytes },
        ip: requisicao.ip,
      });
      return resposta.status(201).send({ nome, registros: resumo.registros, tabelas: resumo.tabelas, bytes: resumo.bytes });
    },
  );

  app.get(
    '/sistema/backups/:nome',
    { schema: { tags, summary: 'Baixa um backup gravado', params: paramArquivo }, preHandler: administrar },
    async (requisicao, resposta) => {
      const { nome } = requisicao.params as z.infer<typeof paramArquivo>;
      const arquivo = listarBackups(app.config.backup.pasta).find((item) => item.nome === nome);
      if (!arquivo) throw naoEncontrado('Backup');
      const usuario = usuarioAtual(requisicao);
      await registrarAtividade(app.banco, {
        usuarioId: usuario.id,
        acao: 'sistema.backup_baixado',
        entidade: 'sistema',
        entidadeId: nome,
        descricao: `baixou o backup ${nome}`,
        ip: requisicao.ip,
      });
      return resposta
        .header('content-type', 'application/gzip')
        .header('content-length', arquivo.bytes)
        .header('content-disposition', `attachment; filename="${nome}"`)
        .header('cache-control', 'no-store')
        .send(createReadStream(path.join(app.config.backup.pasta, nome)));
    },
  );

  app.get(
    '/sistema/primeiros-passos',
    { schema: { tags, summary: 'Lista de primeiros passos para deixar o painel pronto para uso' }, preHandler: administrar },
    async () => primeirosPassos(app),
  );
}

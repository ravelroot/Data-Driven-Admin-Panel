import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Banco } from './banco/conexao.js';
import { processarEntregasPendentes } from './integracoes.js';
import { avaliarAlertas } from './modulos/alertas/servico.js';
import { registrarAtividade } from './modulos/comum/auditoria.js';
import { podarBackups, salvarBackup } from './operacao/backup.js';
import { executarLimpeza, totalRemovido } from './operacao/retencao.js';
import { gerarRelatorio, periodoDoAgendamento, proximaExecucao, type Frequencia, type FormatoRelatorio, type PeriodoAgendamento } from './modulos/relatorios/servico.js';
import type { TipoRelatorio } from './modulos/relatorios/dados.js';

const INTERVALO = 60_000;

interface Vencido {
  id: string;
  nome: string;
  tipo: TipoRelatorio;
  formato: FormatoRelatorio;
  frequencia: Frequencia;
  periodo: PeriodoAgendamento;
  proxima_execucao: Date;
  criado_por: string;
  criado_por_nome: string;
}

export async function executarVencidos(app: FastifyInstance): Promise<number> {
  const { banco, config } = app;
  const { linhas } = await banco.consultar<Vencido>(
    `select a.id, a.nome, a.tipo, a.formato, a.frequencia, a.periodo, a.proxima_execucao, a.criado_por, u.nome as criado_por_nome
       from relatorios_agendados a
       join usuarios u on u.id = a.criado_por
      where a.ativo and a.proxima_execucao <= now()
      order by a.proxima_execucao
      limit 10`,
  );
  let executados = 0;
  for (const agendamento of linhas) {
    const proxima = proximaExecucao(agendamento.frequencia, config.fuso);
    const { total } = await banco.consultar(
      `update relatorios_agendados set proxima_execucao = $2, ultima_execucao = now()
        where id = $1 and proxima_execucao = $3`,
      [agendamento.id, proxima, agendamento.proxima_execucao],
    );
    if (total === 0) continue;
    const { inicio, fim } = periodoDoAgendamento(agendamento.periodo, config.fuso);
    try {
      await gerarRelatorio(
        app,
        { tipo: agendamento.tipo, formato: agendamento.formato, inicio, fim, nome: agendamento.nome },
        { id: agendamento.criado_por, nome: agendamento.criado_por_nome },
        { agendamentoId: agendamento.id },
      );
      executados += 1;
    } catch (erro) {
      app.log.error({ erro, agendamento: agendamento.id }, 'Falha ao gerar relatório agendado');
    }
  }
  return executados;
}

export async function reservarTarefa(banco: Banco, chave: string, intervaloHoras: number): Promise<boolean> {
  const { linhas } = await banco.consultar<{ chave: string }>(
    `insert into configuracoes_sistema (chave, valor, atualizado_em) values ($1, to_jsonb(now()), now())
     on conflict (chave) do update set valor = excluded.valor, atualizado_em = now()
      where configuracoes_sistema.atualizado_em < now() - make_interval(hours => $2::int)
     returning chave`,
    [chave, intervaloHoras],
  );
  return linhas.length > 0;
}

export async function executarRetencao(app: FastifyInstance): Promise<number> {
  if (!(await reservarTarefa(app.banco, 'tarefa:limpeza', 24))) return 0;
  const itens = await executarLimpeza(app.banco, app.config.retencao);
  const total = totalRemovido(itens);
  if (total > 0) {
    await registrarAtividade(app.banco, {
      usuarioId: null,
      acao: 'sistema.limpeza_executada',
      entidade: 'sistema',
      descricao: `retenção automática removeu ${total} registros`,
      detalhes: Object.fromEntries(itens.filter((item) => item.registros > 0).map((item) => [item.categoria, item.registros])),
    });
    app.log.info({ removidos: total }, 'Retenção de dados aplicada');
  }
  return total;
}

export async function executarBackupAutomatico(app: FastifyInstance): Promise<string | null> {
  const { automatico, pasta, manter } = app.config.backup;
  if (automatico === 'desligado') return null;
  if (!(await reservarTarefa(app.banco, 'tarefa:backup', automatico === 'diario' ? 24 : 24 * 7))) return null;
  const resumo = await salvarBackup(app.banco, pasta, 'auto');
  const removidos = podarBackups(pasta, manter);
  app.log.info({ arquivo: resumo.arquivo, registros: resumo.registros, removidos: removidos.length }, 'Backup automático gravado');
  await registrarAtividade(app.banco, {
    usuarioId: null,
    acao: 'sistema.backup_criado',
    entidade: 'sistema',
    entidadeId: path.basename(resumo.arquivo),
    descricao: `backup automático ${path.basename(resumo.arquivo)} gravado`,
    detalhes: { registros: resumo.registros, bytes: resumo.bytes, removidos: removidos.length },
  });
  return resumo.arquivo;
}

export async function rodarCiclo(app: FastifyInstance): Promise<void> {
  const tarefas: [string, () => Promise<unknown>][] = [
    ['relatórios agendados', () => (app.estado.manutencao.ativo ? Promise.resolve(0) : executarVencidos(app))],
    ['entregas das integrações', () => processarEntregasPendentes(app.banco, app.config.segredoJwt, app.log)],
    ['alertas de métricas', () => avaliarAlertas(app)],
    ['retenção de dados', () => executarRetencao(app)],
    ['backup automático', () => executarBackupAutomatico(app)],
  ];
  for (const [nome, tarefa] of tarefas) {
    if (app.estado.encerrando) return;
    try {
      await tarefa();
    } catch (erro) {
      app.log.error({ erro, tarefa: nome }, 'Falha em tarefa do agendador');
    }
  }
}

export function iniciarAgendador(app: FastifyInstance): () => void {
  let rodando = false;
  const temporizador = setInterval(() => {
    if (rodando) return;
    rodando = true;
    rodarCiclo(app).finally(() => {
      rodando = false;
    });
  }, INTERVALO);
  temporizador.unref();
  return () => clearInterval(temporizador);
}

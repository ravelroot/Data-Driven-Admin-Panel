import type { FastifyInstance } from 'fastify';
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

export function iniciarAgendador(app: FastifyInstance): () => void {
  let rodando = false;
  const temporizador = setInterval(() => {
    if (rodando) return;
    rodando = true;
    executarVencidos(app)
      .catch((erro) => app.log.error({ erro }, 'Falha no agendador de relatórios'))
      .finally(() => {
        rodando = false;
      });
  }, INTERVALO);
  temporizador.unref();
  return () => clearInterval(temporizador);
}

import type { FastifyInstance } from 'fastify';
import type { Banco } from '../banco/conexao.js';
import { FREQUENCIAS_BACKUP, type Config, type FrequenciaBackup, type Retencao } from '../config.js';
import { registrarAtividade } from '../modulos/comum/auditoria.js';

export const MODOS_SIMULADOR = ['auto', 'ligado', 'desligado'] as const;

export type ModoSimulador = (typeof MODOS_SIMULADOR)[number];

export interface AjustesOperacao {
  simulador: ModoSimulador;
  backupAutomatico: FrequenciaBackup;
  backupManter: number;
  retencao: Retencao;
}

export type AlteracaoAjustes = Partial<Omit<AjustesOperacao, 'retencao'>> & { retencao?: Partial<Retencao> };

export const LIMITES_RETENCAO: Record<keyof Retencao, { minimo: number; maximo: number }> = {
  notificacoesDias: { minimo: 0, maximo: 3_650 },
  relatoriosDias: { minimo: 0, maximo: 3_650 },
  auditoriaDias: { minimo: 0, maximo: 3_650 },
  sessoesDias: { minimo: 1, maximo: 3_650 },
  entregasDias: { minimo: 1, maximo: 3_650 },
  alertasDias: { minimo: 1, maximo: 3_650 },
};

export interface PadroesAmbiente {
  backupAutomatico: FrequenciaBackup;
  backupManter: number;
  retencao: Retencao;
}

export function padroesDoAmbiente(config: Config): PadroesAmbiente {
  return { backupAutomatico: config.backup.automatico, backupManter: config.backup.manter, retencao: { ...config.retencao } };
}

const inteiroEntre = (valor: unknown, minimo: number, maximo: number): number | undefined =>
  typeof valor === 'number' && Number.isInteger(valor) && valor >= minimo && valor <= maximo ? valor : undefined;

export function normalizarAlteracao(bruto: unknown): AlteracaoAjustes {
  const dados = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>;
  const resultado: AlteracaoAjustes = {};
  if (typeof dados.simulador === 'string' && (MODOS_SIMULADOR as readonly string[]).includes(dados.simulador)) {
    resultado.simulador = dados.simulador as ModoSimulador;
  }
  if (typeof dados.backupAutomatico === 'string' && (FREQUENCIAS_BACKUP as readonly string[]).includes(dados.backupAutomatico)) {
    resultado.backupAutomatico = dados.backupAutomatico as FrequenciaBackup;
  }
  const manter = inteiroEntre(dados.backupManter, 1, 365);
  if (manter !== undefined) resultado.backupManter = manter;
  const retencaoBruta = (dados.retencao && typeof dados.retencao === 'object' ? dados.retencao : {}) as Record<string, unknown>;
  const retencao: Partial<Retencao> = {};
  for (const [chave, limite] of Object.entries(LIMITES_RETENCAO) as [keyof Retencao, { minimo: number; maximo: number }][]) {
    const valor = inteiroEntre(retencaoBruta[chave], limite.minimo, limite.maximo);
    if (valor !== undefined) retencao[chave] = valor;
  }
  if (Object.keys(retencao).length) resultado.retencao = retencao;
  return resultado;
}

export function combinarAjustes(padroes: PadroesAmbiente, alteracao: AlteracaoAjustes): AjustesOperacao {
  return {
    simulador: alteracao.simulador ?? 'auto',
    backupAutomatico: alteracao.backupAutomatico ?? padroes.backupAutomatico,
    backupManter: alteracao.backupManter ?? padroes.backupManter,
    retencao: { ...padroes.retencao, ...alteracao.retencao },
  };
}

export async function lerAlteracoes(banco: Banco): Promise<AlteracaoAjustes> {
  const { linhas } = await banco.consultar<{ valor: unknown }>(`select valor from configuracoes_sistema where chave = 'operacao'`);
  return normalizarAlteracao(linhas[0]?.valor);
}

export async function lerDemonstracao(banco: Banco): Promise<boolean> {
  const { linhas } = await banco.consultar<{ valor: unknown }>(`select valor from configuracoes_sistema where chave = 'demonstracao'`);
  return linhas[0]?.valor === true;
}

export async function definirDemonstracao(banco: Pick<Banco, 'consultar'>, ativa: boolean): Promise<void> {
  await banco.consultar(
    `insert into configuracoes_sistema (chave, valor, atualizado_em) values ('demonstracao', $1::jsonb, now())
     on conflict (chave) do update set valor = excluded.valor, atualizado_em = now()`,
    [JSON.stringify(ativa)],
  );
}

export function aplicarAjustes(config: Config, ajustes: AjustesOperacao): void {
  config.backup.automatico = ajustes.backupAutomatico;
  config.backup.manter = ajustes.backupManter;
  Object.assign(config.retencao, ajustes.retencao);
}

export async function carregarAjustes(banco: Banco, padroes: PadroesAmbiente): Promise<AjustesOperacao> {
  return combinarAjustes(padroes, await lerAlteracoes(banco));
}

export function simuladorDeveRodar(config: Config, modo: ModoSimulador, demonstracao: boolean): boolean {
  if (!config.simulador) return false;
  if (modo === 'auto') return demonstracao;
  return modo === 'ligado';
}

export function simuladorAtivo(app: FastifyInstance): boolean {
  return simuladorDeveRodar(app.config, app.estado.operacao.simulador, app.estado.demonstracao);
}

export interface EstadoAjustes {
  ajustes: AjustesOperacao;
  padroes: PadroesAmbiente;
  alterados: string[];
  simulador: { modo: ModoSimulador; ativo: boolean; permitido: boolean; intervaloSegundos: number };
  demonstracao: boolean;
}

function chavesAlteradas(alteracao: AlteracaoAjustes): string[] {
  const chaves = Object.keys(alteracao).filter((chave) => chave !== 'retencao');
  for (const chave of Object.keys(alteracao.retencao ?? {})) chaves.push(`retencao.${chave}`);
  return chaves;
}

export async function descreverAjustes(app: FastifyInstance): Promise<EstadoAjustes> {
  const alteracao = await lerAlteracoes(app.banco);
  return {
    ajustes: app.estado.operacao,
    padroes: app.estado.padroes,
    alterados: chavesAlteradas(alteracao),
    simulador: {
      modo: app.estado.operacao.simulador,
      ativo: simuladorAtivo(app),
      permitido: app.config.simulador,
      intervaloSegundos: app.config.intervaloSimulador,
    },
    demonstracao: app.estado.demonstracao,
  };
}

export function aplicarNoApp(app: FastifyInstance, ajustes: AjustesOperacao, demonstracao?: boolean): void {
  app.estado.operacao = ajustes;
  aplicarAjustes(app.config, ajustes);
  if (demonstracao !== undefined) app.estado.demonstracao = demonstracao;
}

async function gravarEPublicar(app: FastifyInstance, alteracao: AlteracaoAjustes, autor: { id: string }, ip: string, descricao: string): Promise<EstadoAjustes> {
  const ajustes = combinarAjustes(app.estado.padroes, alteracao);
  await app.banco.transacao(async (tx) => {
    await tx.consultar(
      `insert into configuracoes_sistema (chave, valor, atualizado_em) values ('operacao', $1::jsonb, now())
       on conflict (chave) do update set valor = excluded.valor, atualizado_em = now()`,
      [JSON.stringify(alteracao)],
    );
    await registrarAtividade(tx, {
      usuarioId: autor.id,
      acao: 'sistema.operacao_ajustada',
      entidade: 'sistema',
      descricao,
      detalhes: { ...alteracao },
      ip,
    });
  });
  aplicarNoApp(app, ajustes);
  await app.barramento.publicar({ tipo: 'sistema', destinatarioId: null, dados: { operacao: ajustes } });
  return descreverAjustes(app);
}

export async function salvarAjustes(app: FastifyInstance, dados: AlteracaoAjustes, autor: { id: string }, ip: string): Promise<EstadoAjustes> {
  const atual = await lerAlteracoes(app.banco);
  const alteracao: AlteracaoAjustes = {
    ...atual,
    ...Object.fromEntries(Object.entries(dados).filter(([chave, valor]) => chave !== 'retencao' && valor !== undefined)),
  };
  if (dados.retencao) alteracao.retencao = { ...atual.retencao, ...dados.retencao };
  return gravarEPublicar(app, normalizarAlteracao(alteracao), autor, ip, 'ajustou a operação (simulador, backups ou retenção)');
}

export async function restaurarPadroes(app: FastifyInstance, autor: { id: string }, ip: string): Promise<EstadoAjustes> {
  return gravarEPublicar(app, {}, autor, ip, 'voltou a operação para os padrões do .env');
}

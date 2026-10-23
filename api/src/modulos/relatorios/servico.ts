import type { FastifyInstance } from 'fastify';
import type { Banco } from '../../banco/conexao.js';
import { dispararEmSegundoPlano } from '../../integracoes.js';
import { gerarCsv } from '../../relatorios/csv.js';
import { gerarPdf } from '../../relatorios/pdf.js';
import {
  dataBr,
  dataHoraBr,
  diferencaDias,
  inicioDaSemana,
  inicioDoDia,
  paraIso,
  primeiroDiaDoMes,
  somarDias,
  somarMeses,
} from '../../util/datas.js';
import { naoEncontrado, semPermissao, validacao } from '../../util/erros.js';
import { montarPagina, type Pagina } from '../../util/validacao.js';
import { registrarAtividade } from '../comum/auditoria.js';
import { hojeLocal } from '../metricas/base.js';
import { criarNotificacao } from '../notificacoes/servico.js';
import { definicaoDe, obterDadosRelatorio, type TipoRelatorio } from './dados.js';

export type FormatoRelatorio = 'csv' | 'pdf';
export type Frequencia = 'diaria' | 'semanal' | 'mensal';
export type PeriodoAgendamento = '7d' | '30d' | 'mes-anterior';

export interface Relatorio {
  id: string;
  nome: string;
  tipo: TipoRelatorio;
  formato: FormatoRelatorio;
  inicio: string;
  fim: string;
  status: 'pronto' | 'erro';
  linhas: number;
  tamanhoBytes: number;
  criadoPor: { id: string; nome: string } | null;
  criadoEm: string | null;
}

export interface Agendamento {
  id: string;
  nome: string;
  tipo: TipoRelatorio;
  formato: FormatoRelatorio;
  frequencia: Frequencia;
  periodo: PeriodoAgendamento;
  ativo: boolean;
  proximaExecucao: string | null;
  ultimaExecucao: string | null;
  criadoEm: string | null;
}

const MIME: Record<FormatoRelatorio, string> = { csv: 'text/csv; charset=utf-8', pdf: 'application/pdf' };
const HORA_EXECUCAO = 7;
const MAXIMO_DIAS = 1_100;

const SELECAO_RELATORIO = `
  select r.id, r.nome, r.tipo, r.formato, r.inicio, r.fim, r.status, r.linhas, r.tamanho_bytes, r.criado_por,
         u.nome as criado_por_nome, r.criado_em
  from relatorios r
  left join usuarios u on u.id = r.criado_por
`;

function mapearRelatorio(linha: Record<string, unknown>): Relatorio {
  return {
    id: String(linha.id),
    nome: String(linha.nome),
    tipo: linha.tipo as TipoRelatorio,
    formato: linha.formato as FormatoRelatorio,
    inicio: String(linha.inicio),
    fim: String(linha.fim),
    status: linha.status as 'pronto' | 'erro',
    linhas: Number(linha.linhas),
    tamanhoBytes: Number(linha.tamanho_bytes),
    criadoPor: linha.criado_por ? { id: String(linha.criado_por), nome: String(linha.criado_por_nome ?? '') } : null,
    criadoEm: paraIso(linha.criado_em),
  };
}

function mapearAgendamento(linha: Record<string, unknown>): Agendamento {
  return {
    id: String(linha.id),
    nome: String(linha.nome),
    tipo: linha.tipo as TipoRelatorio,
    formato: linha.formato as FormatoRelatorio,
    frequencia: linha.frequencia as Frequencia,
    periodo: linha.periodo as PeriodoAgendamento,
    ativo: Boolean(linha.ativo),
    proximaExecucao: paraIso(linha.proxima_execucao),
    ultimaExecucao: paraIso(linha.ultima_execucao),
    criadoEm: paraIso(linha.criado_em),
  };
}

export function validarPeriodo(inicio: string, fim: string): void {
  if (inicio > fim) throw validacao('A data inicial precisa ser anterior à final.');
  if (diferencaDias(inicio, fim) > MAXIMO_DIAS) throw validacao('O intervalo máximo é de 3 anos.');
}

export function nomePadrao(tipo: TipoRelatorio, inicio: string, fim: string): string {
  return `${definicaoDe(tipo).nome} · ${dataBr(inicio)} a ${dataBr(fim)}`;
}

export function nomeArquivo(tipo: TipoRelatorio, formato: FormatoRelatorio, inicio: string, fim: string): string {
  return `bento-${tipo}-${inicio}-a-${fim}.${formato}`;
}

export async function gerarArquivo(
  banco: Banco,
  fuso: string,
  pedido: { tipo: TipoRelatorio; formato: FormatoRelatorio; inicio: string; fim: string; nome: string },
): Promise<{ conteudo: Buffer; linhas: number }> {
  const dados = await obterDadosRelatorio(banco, fuso, pedido.tipo, pedido.inicio, pedido.fim);
  if (pedido.formato === 'csv') {
    return { conteudo: gerarCsv(dados.colunas, dados.linhas, fuso), linhas: dados.linhas.length };
  }
  const conteudo = await gerarPdf({
    titulo: pedido.nome,
    subtitulo: definicaoDe(pedido.tipo).descricao,
    periodo: `${dataBr(pedido.inicio)} a ${dataBr(pedido.fim)}`,
    geradoEm: dataHoraBr(new Date(), fuso),
    colunas: dados.colunas,
    linhas: dados.linhas,
    resumo: dados.resumo,
    fuso,
  });
  return { conteudo, linhas: dados.linhas.length };
}

export async function previa(banco: Banco, fuso: string, tipo: TipoRelatorio, inicio: string, fim: string) {
  validarPeriodo(inicio, fim);
  const dados = await obterDadosRelatorio(banco, fuso, tipo, inicio, fim);
  return { colunas: dados.colunas, linhas: dados.linhas.slice(0, 25), total: dados.linhas.length, resumo: dados.resumo };
}

export async function gerarRelatorio(
  app: FastifyInstance,
  pedido: { tipo: TipoRelatorio; formato: FormatoRelatorio; inicio: string; fim: string; nome?: string },
  autor: { id: string; nome: string },
  opcoes: { agendamentoId?: string | null; ip?: string | null } = {},
): Promise<Relatorio> {
  const { banco, config } = app;
  validarPeriodo(pedido.inicio, pedido.fim);
  const nome = pedido.nome?.trim() || nomePadrao(pedido.tipo, pedido.inicio, pedido.fim);
  const { conteudo, linhas } = await gerarArquivo(banco, config.fuso, { ...pedido, nome });
  const { linhas: criadas } = await banco.consultar<{ id: string }>(
    `insert into relatorios (nome, tipo, formato, inicio, fim, status, linhas, tamanho_bytes, conteudo, tipo_mime, criado_por, agendamento_id)
     values ($1, $2, $3, $4::date, $5::date, 'pronto', $6, $7, $8, $9, $10, $11) returning id`,
    [
      nome,
      pedido.tipo,
      pedido.formato,
      pedido.inicio,
      pedido.fim,
      linhas,
      conteudo.length,
      conteudo,
      MIME[pedido.formato],
      autor.id,
      opcoes.agendamentoId ?? null,
    ],
  );
  const id = criadas[0].id;
  await registrarAtividade(banco, {
    usuarioId: opcoes.agendamentoId ? null : autor.id,
    acao: 'relatorio.gerado',
    entidade: 'relatorio',
    entidadeId: id,
    descricao: opcoes.agendamentoId
      ? `Relatório agendado "${nome}" (${pedido.formato.toUpperCase()}) gerado para ${autor.nome}`
      : `gerou o relatório "${nome}" (${pedido.formato.toUpperCase()})`,
    ip: opcoes.ip ?? null,
  });
  await criarNotificacao(banco, app.barramento, {
    destinatarioId: autor.id,
    tipo: 'sucesso',
    categoria: 'relatorio',
    titulo: 'Relatório pronto',
    mensagem: `"${nome}" (${pedido.formato.toUpperCase()}, ${linhas.toLocaleString('pt-BR')} linhas) está pronto para baixar.`,
    link: '/relatorios',
    dados: { relatorioId: id },
  });
  const relatorio = await buscarRelatorio(banco, id);
  dispararEmSegundoPlano(banco, config.segredoJwt, app.log, 'relatorio.gerado', `Relatório pronto: ${nome}`, relatorio);
  return relatorio;
}

export async function buscarRelatorio(banco: Banco, id: string): Promise<Relatorio> {
  const { linhas } = await banco.consultar(`${SELECAO_RELATORIO} where r.id = $1`, [id]);
  if (!linhas[0]) throw naoEncontrado('Relatório');
  return mapearRelatorio(linhas[0]);
}

export async function listarRelatorios(banco: Banco, pagina: number, porPagina: number): Promise<Pagina<Relatorio>> {
  const [total, itens] = await Promise.all([
    banco.consultar<{ total: number }>('select count(*)::int as total from relatorios'),
    banco.consultar(`${SELECAO_RELATORIO} order by r.criado_em desc limit ${porPagina} offset ${(pagina - 1) * porPagina}`),
  ]);
  return montarPagina(itens.linhas.map(mapearRelatorio), total.linhas[0]?.total ?? 0, pagina, porPagina);
}

export async function obterArquivo(banco: Banco, id: string): Promise<{ conteudo: Buffer; mime: string; nome: string }> {
  const { linhas } = await banco.consultar<{
    conteudo: Uint8Array | null;
    tipo_mime: string;
    tipo: TipoRelatorio;
    formato: FormatoRelatorio;
    inicio: string;
    fim: string;
  }>('select conteudo, tipo_mime, tipo, formato, inicio, fim from relatorios where id = $1', [id]);
  const linha = linhas[0];
  if (!linha || !linha.conteudo) throw naoEncontrado('Relatório');
  return {
    conteudo: Buffer.from(linha.conteudo),
    mime: linha.tipo_mime,
    nome: nomeArquivo(linha.tipo, linha.formato, linha.inicio, linha.fim),
  };
}

export interface AtorRelatorio {
  id: string;
  permissoes: Set<string>;
}

/** O histórico é compartilhado para leitura, mas só o autor (ou um administrador do sistema) apaga ou altera o que é de outra pessoa. */
function garantirDono(ator: AtorRelatorio, criadoPor: string | null, oQue: string): void {
  if (criadoPor === ator.id || ator.permissoes.has('configuracoes.sistema')) return;
  throw semPermissao(`Só quem criou ${oQue} (ou um administrador) pode fazer isso.`);
}

export async function excluirRelatorio(banco: Banco, id: string, autor: AtorRelatorio, ip: string): Promise<void> {
  const relatorio = await buscarRelatorio(banco, id);
  garantirDono(autor, relatorio.criadoPor?.id ?? null, 'o relatório');
  await banco.consultar('delete from relatorios where id = $1', [id]);
  await registrarAtividade(banco, {
    usuarioId: autor.id,
    acao: 'relatorio.excluido',
    entidade: 'relatorio',
    entidadeId: id,
    descricao: `excluiu o relatório "${relatorio.nome}"`,
    ip,
  });
}

export function proximaExecucao(frequencia: Frequencia, fuso: string, depoisDe = new Date()): Date {
  const hoje = hojeLocal(fuso);
  const noDia = (dia: string) => new Date(inicioDoDia(dia, fuso).getTime() + HORA_EXECUCAO * 3_600_000);
  let candidato: string;
  if (frequencia === 'diaria') {
    candidato = hoje;
    while (noDia(candidato) <= depoisDe) candidato = somarDias(candidato, 1);
  } else if (frequencia === 'semanal') {
    candidato = inicioDaSemana(hoje);
    while (noDia(candidato) <= depoisDe) candidato = somarDias(candidato, 7);
  } else {
    candidato = primeiroDiaDoMes(hoje);
    while (noDia(candidato) <= depoisDe) candidato = somarMeses(candidato, 1);
  }
  return noDia(candidato);
}

export function periodoDoAgendamento(periodo: PeriodoAgendamento, fuso: string): { inicio: string; fim: string } {
  const hoje = hojeLocal(fuso);
  if (periodo === 'mes-anterior') {
    const inicio = somarMeses(primeiroDiaDoMes(hoje), -1);
    return { inicio, fim: somarDias(primeiroDiaDoMes(hoje), -1) };
  }
  const dias = periodo === '7d' ? 7 : 30;
  return { inicio: somarDias(hoje, -dias), fim: somarDias(hoje, -1) };
}

export async function listarAgendamentos(banco: Banco): Promise<Agendamento[]> {
  const { linhas } = await banco.consultar('select * from relatorios_agendados order by criado_em desc');
  return linhas.map(mapearAgendamento);
}

export async function criarAgendamento(
  banco: Banco,
  fuso: string,
  dados: { nome: string; tipo: TipoRelatorio; formato: FormatoRelatorio; frequencia: Frequencia; periodo: PeriodoAgendamento },
  autor: { id: string },
  ip: string,
): Promise<Agendamento> {
  const { linhas } = await banco.consultar(
    `insert into relatorios_agendados (nome, tipo, formato, frequencia, periodo, proxima_execucao, criado_por)
     values ($1, $2, $3, $4, $5, $6, $7) returning *`,
    [dados.nome.trim(), dados.tipo, dados.formato, dados.frequencia, dados.periodo, proximaExecucao(dados.frequencia, fuso), autor.id],
  );
  await registrarAtividade(banco, {
    usuarioId: autor.id,
    acao: 'relatorio.agendado',
    entidade: 'agendamento',
    entidadeId: String(linhas[0].id),
    descricao: `agendou o relatório "${dados.nome.trim()}"`,
    ip,
  });
  return mapearAgendamento(linhas[0]);
}

export async function alterarAgendamento(
  banco: Banco,
  fuso: string,
  id: string,
  ativo: boolean,
  ator: AtorRelatorio,
): Promise<Agendamento> {
  const { linhas: atuais } = await banco.consultar<{ frequencia: Frequencia; criado_por: string }>(
    'select frequencia, criado_por from relatorios_agendados where id = $1',
    [id],
  );
  if (!atuais[0]) throw naoEncontrado('Agendamento');
  garantirDono(ator, String(atuais[0].criado_por), 'o agendamento');
  const { linhas } = await banco.consultar(
    `update relatorios_agendados set ativo = $2, proxima_execucao = case when $2 then $3::timestamptz else proxima_execucao end
      where id = $1 returning *`,
    [id, ativo, proximaExecucao(atuais[0].frequencia, fuso)],
  );
  return mapearAgendamento(linhas[0]);
}

export async function excluirAgendamento(banco: Banco, id: string, ator: AtorRelatorio): Promise<void> {
  const { linhas } = await banco.consultar<{ criado_por: string }>('select criado_por from relatorios_agendados where id = $1', [id]);
  if (!linhas[0]) throw naoEncontrado('Agendamento');
  garantirDono(ator, String(linhas[0].criado_por), 'o agendamento');
  const { total } = await banco.consultar('delete from relatorios_agendados where id = $1', [id]);
  if (total === 0) throw naoEncontrado('Agendamento');
}

import type { FastifyInstance } from 'fastify';
import type { Banco } from '../../banco/conexao.js';
import { dispararEmSegundoPlano } from '../../integracoes.js';
import { paraIso } from '../../util/datas.js';
import { conflito, naoEncontrado } from '../../util/erros.js';
import { montarPagina, type Pagina } from '../../util/validacao.js';
import { registrarAtividade } from '../comum/auditoria.js';
import { obterConfigSistema } from '../comum/consultas.js';
import { criarNotificacao } from '../notificacoes/servico.js';
import {
  CATALOGO_METRICAS,
  formatarValorMetrica,
  medirMetrica,
  ROTULOS_JANELA,
  type JanelaAlerta,
  type Medicao,
  type MetricaAlerta,
} from './metricas.js';

export const MAX_ALERTAS = 50;
export const MINUTOS_ENTRE_AVALIACOES = 5;

export type ModoAlerta = 'valor' | 'variacao';
export type OperadorAlerta = 'maior' | 'menor';
export type SeveridadeAlerta = 'info' | 'alerta' | 'erro';

export interface DadosAlerta {
  nome: string;
  metrica: MetricaAlerta;
  janela: JanelaAlerta;
  modo: ModoAlerta;
  operador: OperadorAlerta;
  limite: number;
  severidade: SeveridadeAlerta;
  notificarIntegracoes: boolean;
  silencioMinutos: number;
  ativo: boolean;
}

export interface Regra {
  metrica: MetricaAlerta;
  janela: JanelaAlerta;
  modo: ModoAlerta;
  operador: OperadorAlerta;
  limite: number;
}

export interface Alerta extends DadosAlerta {
  id: string;
  estado: 'normal' | 'disparado';
  ultimoValor: number | null;
  ultimaAvaliacao: string | null;
  ultimoDisparo: string | null;
  descricao: string;
  criadoPor: { id: string; nome: string } | null;
  criadoEm: string | null;
  atualizadoEm: string | null;
  disparos7d: number;
}

export interface Disparo {
  id: string;
  alerta: { id: string; nome: string; metrica: MetricaAlerta; severidade: SeveridadeAlerta };
  valor: number;
  limite: number;
  mensagem: string;
  criadoEm: string | null;
  resolvidoEm: string | null;
}

export interface Simulacao extends Medicao {
  valor: number | null;
  dispararia: boolean;
  descricao: string;
  valorFormatado: string;
}

interface LinhaAlerta {
  id: string;
  nome: string;
  metrica: MetricaAlerta;
  janela: JanelaAlerta;
  modo: ModoAlerta;
  operador: OperadorAlerta;
  limite: number;
  severidade: SeveridadeAlerta;
  notificar_integracoes: boolean;
  silencio_minutos: number;
  ativo: boolean;
  estado: 'normal' | 'disparado';
  ultimo_valor: number | null;
  ultima_avaliacao: Date | null;
  ultimo_disparo: Date | null;
  criado_por: string | null;
  criado_por_nome: string | null;
  criado_em: Date;
  atualizado_em: Date;
  disparos_7d: number;
}

const SELECAO = `
  select a.id, a.nome, a.metrica, a.janela, a.modo, a.operador, a.limite, a.severidade, a.notificar_integracoes,
         a.silencio_minutos, a.ativo, a.estado, a.ultimo_valor, a.ultima_avaliacao, a.ultimo_disparo, a.criado_por,
         u.nome as criado_por_nome, a.criado_em, a.atualizado_em,
         (select count(*) from disparos_alerta d where d.alerta_id = a.id and d.criado_em > now() - interval '7 days')::int as disparos_7d
    from alertas_metricas a
    left join usuarios u on u.id = a.criado_por
`;

export function descreverRegra(regra: Regra, moeda: string): string {
  const definicao = CATALOGO_METRICAS[regra.metrica];
  const sentido = regra.operador === 'maior' ? 'acima de' : 'abaixo de';
  if (regra.modo === 'variacao') {
    const verbo = regra.operador === 'maior' ? 'sobe mais de' : 'cai mais de';
    const limite = Math.abs(regra.limite);
    return `${definicao.nome} ${ROTULOS_JANELA[regra.janela]} ${verbo} ${formatarValorMetrica(limite, 'percentual', moeda)} em relação ao período anterior`;
  }
  return `${definicao.nome} ${ROTULOS_JANELA[regra.janela]} ${sentido} ${formatarValorMetrica(regra.limite, definicao.unidade, moeda)}`;
}

export function valorDaRegra(regra: Regra, medicao: Medicao): number | null {
  return regra.modo === 'variacao' ? medicao.variacao : medicao.atual;
}

export function condicaoAtendida(regra: Regra, valor: number | null): boolean {
  if (valor === null || Number.isNaN(valor)) return false;
  if (regra.modo === 'variacao') {
    const limite = Math.abs(regra.limite);
    return regra.operador === 'maior' ? valor > limite : valor < -limite;
  }
  return regra.operador === 'maior' ? valor > regra.limite : valor < regra.limite;
}

function formatarValorRegra(regra: Regra, valor: number | null, moeda: string): string {
  if (valor === null) return 'sem base de comparação';
  if (regra.modo === 'variacao') return `${valor > 0 ? '+' : valor < 0 ? '−' : ''}${formatarValorMetrica(Math.abs(valor), 'percentual', moeda)}`;
  return formatarValorMetrica(valor, CATALOGO_METRICAS[regra.metrica].unidade, moeda);
}

function mapear(linha: LinhaAlerta, moeda: string): Alerta {
  const regra: Regra = { metrica: linha.metrica, janela: linha.janela, modo: linha.modo, operador: linha.operador, limite: Number(linha.limite) };
  return {
    id: linha.id,
    nome: linha.nome,
    metrica: linha.metrica,
    janela: linha.janela,
    modo: linha.modo,
    operador: linha.operador,
    limite: Number(linha.limite),
    severidade: linha.severidade,
    notificarIntegracoes: linha.notificar_integracoes,
    silencioMinutos: linha.silencio_minutos,
    ativo: linha.ativo,
    estado: linha.estado,
    ultimoValor: linha.ultimo_valor === null ? null : Number(linha.ultimo_valor),
    ultimaAvaliacao: paraIso(linha.ultima_avaliacao),
    ultimoDisparo: paraIso(linha.ultimo_disparo),
    descricao: descreverRegra(regra, moeda),
    criadoPor: linha.criado_por ? { id: linha.criado_por, nome: linha.criado_por_nome ?? '' } : null,
    criadoEm: paraIso(linha.criado_em),
    atualizadoEm: paraIso(linha.atualizado_em),
    disparos7d: linha.disparos_7d,
  };
}

async function moedaDoSistema(banco: Banco): Promise<string> {
  return (await obterConfigSistema(banco)).moeda;
}

export async function listarAlertas(banco: Banco) {
  const [moeda, { linhas }, resumo] = await Promise.all([
    moedaDoSistema(banco),
    banco.consultar<LinhaAlerta>(`${SELECAO} order by (a.estado = 'disparado') desc, a.ativo desc, a.criado_em desc`),
    banco.consultar<{ disparos: number; abertos: number }>(
      `select count(*) filter (where criado_em > now() - interval '7 days')::int as disparos,
              count(*) filter (where resolvido_em is null)::int as abertos
         from disparos_alerta`,
    ),
  ]);
  const itens = linhas.map((linha) => mapear(linha, moeda));
  return {
    itens,
    resumo: {
      total: itens.length,
      ativos: itens.filter((alerta) => alerta.ativo).length,
      disparados: itens.filter((alerta) => alerta.ativo && alerta.estado === 'disparado').length,
      disparos7d: resumo.linhas[0]?.disparos ?? 0,
    },
    limite: MAX_ALERTAS,
  };
}

export async function buscarAlerta(banco: Banco, id: string): Promise<Alerta> {
  const [moeda, { linhas }] = await Promise.all([moedaDoSistema(banco), banco.consultar<LinhaAlerta>(`${SELECAO} where a.id = $1`, [id])]);
  if (!linhas[0]) throw naoEncontrado('Alerta');
  return mapear(linhas[0], moeda);
}

export async function criarAlerta(banco: Banco, usuarioId: string, dados: DadosAlerta, ip: string): Promise<Alerta> {
  const { linhas: contagem } = await banco.consultar<{ total: number }>('select count(*)::int as total from alertas_metricas');
  if ((contagem[0]?.total ?? 0) >= MAX_ALERTAS) throw conflito(`Limite de ${MAX_ALERTAS} alertas atingido. Exclua um que não usa mais.`);
  const { linhas } = await banco.consultar<{ id: string }>(
    `insert into alertas_metricas (nome, metrica, janela, modo, operador, limite, severidade, notificar_integracoes, silencio_minutos, ativo, criado_por)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
    [
      dados.nome.trim(),
      dados.metrica,
      dados.janela,
      dados.modo,
      dados.operador,
      dados.limite,
      dados.severidade,
      dados.notificarIntegracoes,
      dados.silencioMinutos,
      dados.ativo,
      usuarioId,
    ],
  );
  const id = linhas[0].id;
  await registrarAtividade(banco, {
    usuarioId,
    acao: 'alerta.criado',
    entidade: 'alerta',
    entidadeId: id,
    descricao: `criou o alerta "${dados.nome.trim()}"`,
    detalhes: { metrica: dados.metrica, janela: dados.janela, modo: dados.modo, operador: dados.operador, limite: dados.limite },
    ip,
  });
  return buscarAlerta(banco, id);
}

const COLUNAS: Record<keyof DadosAlerta, string> = {
  nome: 'nome',
  metrica: 'metrica',
  janela: 'janela',
  modo: 'modo',
  operador: 'operador',
  limite: 'limite',
  severidade: 'severidade',
  notificarIntegracoes: 'notificar_integracoes',
  silencioMinutos: 'silencio_minutos',
  ativo: 'ativo',
};

const MUDAM_A_REGRA: (keyof DadosAlerta)[] = ['metrica', 'janela', 'modo', 'operador', 'limite'];

export async function atualizarAlerta(banco: Banco, usuarioId: string, id: string, dados: Partial<DadosAlerta>, ip: string): Promise<Alerta> {
  const atual = await buscarAlerta(banco, id);
  const atribuicoes: string[] = [];
  const parametros: unknown[] = [id];
  for (const [campo, coluna] of Object.entries(COLUNAS) as [keyof DadosAlerta, string][]) {
    const valor = dados[campo];
    if (valor === undefined) continue;
    parametros.push(typeof valor === 'string' && campo === 'nome' ? valor.trim() : valor);
    atribuicoes.push(`${coluna} = $${parametros.length}`);
  }
  if (atribuicoes.length === 0) return atual;
  const regraMudou = MUDAM_A_REGRA.some((campo) => dados[campo] !== undefined && dados[campo] !== atual[campo]);
  const pausou = dados.ativo === false && atual.ativo;
  if (regraMudou || pausou) atribuicoes.push(`estado = 'normal'`, 'ultima_avaliacao = null', 'ultimo_valor = null');
  atribuicoes.push('atualizado_em = now()');
  await banco.transacao(async (tx) => {
    await tx.consultar(`update alertas_metricas set ${atribuicoes.join(', ')} where id = $1`, parametros);
    if (regraMudou || pausou) await tx.consultar('update disparos_alerta set resolvido_em = now() where alerta_id = $1 and resolvido_em is null', [id]);
    await registrarAtividade(tx, {
      usuarioId,
      acao: dados.ativo === undefined || Object.keys(dados).length > 1 ? 'alerta.atualizado' : dados.ativo ? 'alerta.retomado' : 'alerta.pausado',
      entidade: 'alerta',
      entidadeId: id,
      descricao:
        dados.ativo !== undefined && Object.keys(dados).length === 1
          ? `${dados.ativo ? 'retomou' : 'pausou'} o alerta "${atual.nome}"`
          : `alterou o alerta "${(dados.nome ?? atual.nome).trim()}"`,
      detalhes: { campos: Object.keys(dados) },
      ip,
    });
  });
  return buscarAlerta(banco, id);
}

export async function excluirAlerta(banco: Banco, usuarioId: string, id: string, ip: string): Promise<void> {
  const { linhas } = await banco.consultar<{ nome: string }>('delete from alertas_metricas where id = $1 returning nome', [id]);
  if (!linhas[0]) throw naoEncontrado('Alerta');
  await registrarAtividade(banco, {
    usuarioId,
    acao: 'alerta.excluido',
    entidade: 'alerta',
    entidadeId: id,
    descricao: `excluiu o alerta "${linhas[0].nome}"`,
    ip,
  });
}

export async function simularRegra(banco: Banco, fuso: string, regra: Regra): Promise<Simulacao> {
  const [moeda, medicao] = await Promise.all([moedaDoSistema(banco), medirMetrica(banco, fuso, regra.metrica, regra.janela)]);
  const valor = valorDaRegra(regra, medicao);
  return {
    ...medicao,
    valor,
    dispararia: condicaoAtendida(regra, valor),
    descricao: descreverRegra(regra, moeda),
    valorFormatado: formatarValorRegra(regra, valor, moeda),
  };
}

export async function listarDisparos(banco: Banco, filtros: { alertaId?: string; pagina: number; porPagina: number }): Promise<Pagina<Disparo>> {
  const parametros: unknown[] = [];
  let onde = '';
  if (filtros.alertaId) {
    parametros.push(filtros.alertaId);
    onde = 'where d.alerta_id = $1';
  }
  const [itens, total] = await Promise.all([
    banco.consultar<{
      id: string;
      alerta_id: string;
      nome: string;
      metrica: MetricaAlerta;
      severidade: SeveridadeAlerta;
      valor: number;
      limite: number;
      mensagem: string;
      criado_em: Date;
      resolvido_em: Date | null;
    }>(
      `select d.id, d.alerta_id, a.nome, a.metrica, a.severidade, d.valor, d.limite, d.mensagem, d.criado_em, d.resolvido_em
         from disparos_alerta d join alertas_metricas a on a.id = d.alerta_id
         ${onde}
        order by d.criado_em desc
        limit ${filtros.porPagina} offset ${(filtros.pagina - 1) * filtros.porPagina}`,
      parametros,
    ),
    banco.consultar<{ total: number }>(`select count(*)::int as total from disparos_alerta d ${onde}`, parametros),
  ]);
  return montarPagina(
    itens.linhas.map((linha) => ({
      id: linha.id,
      alerta: { id: linha.alerta_id, nome: linha.nome, metrica: linha.metrica, severidade: linha.severidade },
      valor: Number(linha.valor),
      limite: Number(linha.limite),
      mensagem: linha.mensagem,
      criadoEm: paraIso(linha.criado_em),
      resolvidoEm: paraIso(linha.resolvido_em),
    })),
    total.linhas[0]?.total ?? 0,
    filtros.pagina,
    filtros.porPagina,
  );
}

type Cache = Map<string, Promise<Medicao>>;

async function avaliarUm(app: FastifyInstance, linha: LinhaAlerta, moeda: string, cache: Cache): Promise<'disparou' | 'resolveu' | 'igual'> {
  const { banco, config } = app;
  const regra: Regra = { metrica: linha.metrica, janela: linha.janela, modo: linha.modo, operador: linha.operador, limite: Number(linha.limite) };
  const chave = `${regra.metrica}:${regra.janela}`;
  let pendente = cache.get(chave);
  if (!pendente) {
    pendente = medirMetrica(banco, config.fuso, regra.metrica, regra.janela);
    cache.set(chave, pendente);
  }
  const medicao = await pendente;
  const valor = valorDaRegra(regra, medicao);
  const atendida = condicaoAtendida(regra, valor);
  const emSilencio = linha.ultimo_disparo ? Date.now() - new Date(linha.ultimo_disparo).getTime() < linha.silencio_minutos * 60_000 : false;
  const valorTexto = formatarValorRegra(regra, valor, moeda);

  if (linha.estado === 'normal' && atendida && !emSilencio) {
    const mensagem = `${descreverRegra(regra, moeda)}. Valor medido: ${valorTexto}.`.slice(0, 300);
    const mudou = await banco.transacao(async (tx) => {
      const { total } = await tx.consultar(
        `update alertas_metricas set estado = 'disparado', ultimo_valor = $2, ultimo_disparo = now()
          where id = $1 and estado = 'normal' and ativo and atualizado_em = $3`,
        [linha.id, valor, linha.atualizado_em],
      );
      if (total === 0) return false;
      await tx.consultar('insert into disparos_alerta (alerta_id, valor, limite, mensagem) values ($1, $2, $3, $4)', [
        linha.id,
        valor ?? 0,
        regra.limite,
        mensagem,
      ]);
      return true;
    });
    if (!mudou) return 'igual';
    await criarNotificacao(banco, app.barramento, {
      destinatarioId: null,
      tipo: linha.severidade,
      categoria: 'metrica',
      titulo: `Alerta: ${linha.nome}`.slice(0, 120),
      mensagem,
      link: `/alertas?alerta=${linha.id}`,
      dados: { alerta: linha.id, valor, limite: regra.limite },
    });
    if (linha.notificar_integracoes) {
      dispararEmSegundoPlano(banco, config.segredoJwt, app.log, 'alerta.disparado', `Alerta: ${linha.nome} · ${valorTexto}`, {
        alerta: { id: linha.id, nome: linha.nome, metrica: regra.metrica, janela: regra.janela, modo: regra.modo, operador: regra.operador, limite: regra.limite, severidade: linha.severidade },
        valor,
        mensagem,
      });
    }
    return 'disparou';
  }

  if (linha.estado === 'disparado' && !atendida) {
    const mudou = await banco.transacao(async (tx) => {
      const { total } = await tx.consultar(
        `update alertas_metricas set estado = 'normal', ultimo_valor = $2 where id = $1 and estado = 'disparado' and atualizado_em = $3`,
        [linha.id, valor, linha.atualizado_em],
      );
      if (total === 0) return false;
      await tx.consultar('update disparos_alerta set resolvido_em = now() where alerta_id = $1 and resolvido_em is null', [linha.id]);
      return true;
    });
    if (!mudou) return 'igual';
    await criarNotificacao(banco, app.barramento, {
      destinatarioId: null,
      tipo: 'sucesso',
      categoria: 'metrica',
      titulo: `Normalizado: ${linha.nome}`.slice(0, 120),
      mensagem: `${CATALOGO_METRICAS[regra.metrica].nome} voltou ao normal: ${valorTexto}.`,
      link: `/alertas?alerta=${linha.id}`,
      dados: { alerta: linha.id, valor },
    });
    return 'resolveu';
  }

  await banco.consultar('update alertas_metricas set ultimo_valor = $2 where id = $1', [linha.id, valor]);
  return 'igual';
}

export async function avaliarAlertas(app: FastifyInstance, opcoes: { id?: string; limite?: number } = {}): Promise<{ avaliados: number; disparados: number; resolvidos: number }> {
  const { banco } = app;
  const parametros: unknown[] = [opcoes.limite ?? 50];
  let filtro = `a.ativo and (a.ultima_avaliacao is null or a.ultima_avaliacao < now() - make_interval(mins => ${MINUTOS_ENTRE_AVALIACOES}))`;
  if (opcoes.id) {
    parametros.push(opcoes.id);
    filtro = 'a.id = $2 and a.ativo';
  }
  const { linhas } = await banco.consultar<LinhaAlerta>(
    `update alertas_metricas set ultima_avaliacao = now()
      where id in (select a.id from alertas_metricas a where ${filtro} order by a.ultima_avaliacao nulls first limit $1 for update skip locked)
      returning id, nome, metrica, janela, modo, operador, limite, severidade, notificar_integracoes, silencio_minutos, ativo, estado,
                ultimo_valor, ultima_avaliacao, ultimo_disparo, criado_por, null::text as criado_por_nome, criado_em, atualizado_em, 0 as disparos_7d`,
    parametros,
  );
  const moeda = await moedaDoSistema(banco);
  const cache: Cache = new Map();
  const resultado = { avaliados: 0, disparados: 0, resolvidos: 0 };
  for (const linha of linhas) {
    if (app.estado.encerrando) break;
    try {
      const efeito = await avaliarUm(app, linha, moeda, cache);
      resultado.avaliados += 1;
      if (efeito === 'disparou') resultado.disparados += 1;
      if (efeito === 'resolveu') resultado.resolvidos += 1;
    } catch (erro) {
      app.log.error({ erro, alerta: linha.id }, 'Falha ao avaliar alerta');
    }
  }
  return resultado;
}

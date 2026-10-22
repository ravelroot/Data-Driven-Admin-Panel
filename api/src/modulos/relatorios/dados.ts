import type { Banco } from '../../banco/conexao.js';
import type { Coluna, FormatoColuna } from '../../relatorios/csv.js';
import { fimDoDia, inicioDoDia, paraIso, primeiroDiaDoMes, rotuloMes, somarDias, ultimoDiaDoMes } from '../../util/datas.js';
import { arredondar } from '../../util/formato.js';
import { mapearUsuario, SELECAO_USUARIO } from '../comum/mapeadores.js';
import {
  baldesMensais,
  cancelamentosEntre,
  carregarAssinaturas,
  carregarDiario,
  conversoesEntre,
  mrrEm,
  somar,
} from '../metricas/base.js';
import { linhasExportacaoTransacoes } from '../transacoes/servico.js';
import { ROTULOS_STATUS_USUARIO } from '../usuarios/servico.js';

export type TipoRelatorio = 'receita' | 'transacoes' | 'usuarios' | 'assinaturas' | 'crescimento';

export interface ItemResumo {
  rotulo: string;
  valor: number;
  formato: FormatoColuna;
}

export interface DadosRelatorio {
  colunas: Coluna[];
  linhas: Record<string, unknown>[];
  resumo: ItemResumo[];
}

export interface DefinicaoTipo {
  tipo: TipoRelatorio;
  nome: string;
  descricao: string;
  colunas: Coluna[];
}

export const TIPOS_RELATORIO: DefinicaoTipo[] = [
  {
    tipo: 'receita',
    nome: 'Receita',
    descricao: 'Receita bruta, reembolsos e receita líquida dia a dia.',
    colunas: [
      { campo: 'data', titulo: 'Data', formato: 'data' },
      { campo: 'transacoes', titulo: 'Transações pagas', formato: 'numero' },
      { campo: 'receita', titulo: 'Receita bruta', formato: 'moeda' },
      { campo: 'reembolsos', titulo: 'Reembolsos', formato: 'moeda' },
      { campo: 'liquido', titulo: 'Receita líquida', formato: 'moeda' },
    ],
  },
  {
    tipo: 'transacoes',
    nome: 'Transações',
    descricao: 'Todas as transações do período com cliente, plano, método e status.',
    colunas: [
      { campo: 'codigo', titulo: 'Código', formato: 'texto' },
      { campo: 'data', titulo: 'Data', formato: 'data' },
      { campo: 'cliente', titulo: 'Cliente', formato: 'texto' },
      { campo: 'email', titulo: 'E-mail', formato: 'texto' },
      { campo: 'plano', titulo: 'Plano', formato: 'texto' },
      { campo: 'metodo', titulo: 'Método', formato: 'texto' },
      { campo: 'status', titulo: 'Status', formato: 'texto' },
      { campo: 'valor', titulo: 'Valor', formato: 'moeda' },
    ],
  },
  {
    tipo: 'usuarios',
    nome: 'Usuários',
    descricao: 'Contas cadastradas no período com papel, status e plano.',
    colunas: [
      { campo: 'nome', titulo: 'Nome', formato: 'texto' },
      { campo: 'email', titulo: 'E-mail', formato: 'texto' },
      { campo: 'papel', titulo: 'Papel', formato: 'texto' },
      { campo: 'status', titulo: 'Status', formato: 'texto' },
      { campo: 'plano', titulo: 'Plano', formato: 'texto' },
      { campo: 'pais', titulo: 'País', formato: 'texto' },
      { campo: 'criadoEm', titulo: 'Cadastro', formato: 'data' },
    ],
  },
  {
    tipo: 'assinaturas',
    nome: 'Assinaturas',
    descricao: 'Assinaturas iniciadas no período, com ciclo, status e valor.',
    colunas: [
      { campo: 'cliente', titulo: 'Cliente', formato: 'texto' },
      { campo: 'email', titulo: 'E-mail', formato: 'texto' },
      { campo: 'plano', titulo: 'Plano', formato: 'texto' },
      { campo: 'ciclo', titulo: 'Ciclo', formato: 'texto' },
      { campo: 'status', titulo: 'Status', formato: 'texto' },
      { campo: 'valor', titulo: 'Valor', formato: 'moeda' },
      { campo: 'iniciadaEm', titulo: 'Início', formato: 'data' },
      { campo: 'canceladaEm', titulo: 'Cancelamento', formato: 'data' },
    ],
  },
  {
    tipo: 'crescimento',
    nome: 'Crescimento',
    descricao: 'Novos usuários, assinaturas, cancelamentos e MRR mês a mês.',
    colunas: [
      { campo: 'mes', titulo: 'Mês', formato: 'texto' },
      { campo: 'novosUsuarios', titulo: 'Novos usuários', formato: 'numero' },
      { campo: 'assinaturasNovas', titulo: 'Assinaturas novas', formato: 'numero' },
      { campo: 'cancelamentos', titulo: 'Cancelamentos', formato: 'numero' },
      { campo: 'mrr', titulo: 'MRR no fim do mês', formato: 'moeda' },
      { campo: 'crescimento', titulo: 'Crescimento do MRR', formato: 'percentual' },
    ],
  },
];

export function definicaoDe(tipo: TipoRelatorio): DefinicaoTipo {
  return TIPOS_RELATORIO.find((definicao) => definicao.tipo === tipo) ?? TIPOS_RELATORIO[0];
}

const ROTULOS_ASSINATURA: Record<string, string> = {
  ativa: 'Ativa',
  teste: 'Em teste',
  cancelada: 'Cancelada',
  inadimplente: 'Inadimplente',
};

async function dadosReceita(banco: Banco, fuso: string, inicio: string, fim: string): Promise<DadosRelatorio> {
  const diario = await carregarDiario(banco, fuso, inicio, fim);
  const linhas: Record<string, unknown>[] = [];
  for (let dia = inicio; dia <= fim; dia = somarDias(dia, 1)) {
    const item = diario.get(dia);
    linhas.push({
      data: dia,
      transacoes: item?.pagas ?? 0,
      receita: item?.receita ?? 0,
      reembolsos: item?.reembolsos ?? 0,
      liquido: (item?.receita ?? 0) - (item?.reembolsos ?? 0),
    });
  }
  const total = somar(diario, inicio, fim);
  return {
    colunas: definicaoDe('receita').colunas,
    linhas,
    resumo: [
      { rotulo: 'Receita bruta', valor: total.receita, formato: 'moeda' },
      { rotulo: 'Reembolsos', valor: total.reembolsos, formato: 'moeda' },
      { rotulo: 'Receita líquida', valor: total.receita - total.reembolsos, formato: 'moeda' },
      { rotulo: 'Transações pagas', valor: total.pagas, formato: 'numero' },
      { rotulo: 'Ticket médio', valor: total.pagas ? Math.round(total.receita / total.pagas) : 0, formato: 'moeda' },
    ],
  };
}

async function dadosTransacoes(banco: Banco, fuso: string, inicio: string, fim: string): Promise<DadosRelatorio> {
  const linhas = await linhasExportacaoTransacoes(banco, fuso, { inicio, fim });
  const pagas = linhas.filter((linha) => linha.status === 'Paga');
  return {
    colunas: definicaoDe('transacoes').colunas,
    linhas,
    resumo: [
      { rotulo: 'Transações', valor: linhas.length, formato: 'numero' },
      { rotulo: 'Pagas', valor: pagas.length, formato: 'numero' },
      { rotulo: 'Valor pago', valor: pagas.reduce((soma, linha) => soma + Number(linha.valor), 0), formato: 'moeda' },
      { rotulo: 'Falhas', valor: linhas.filter((linha) => linha.status === 'Falhou').length, formato: 'numero' },
    ],
  };
}

async function dadosUsuarios(banco: Banco, fuso: string, inicio: string, fim: string): Promise<DadosRelatorio> {
  const { linhas: brutas } = await banco.consultar(
    `${SELECAO_USUARIO} where u.criado_em >= $1 and u.criado_em <= $2 order by u.criado_em desc limit 50000`,
    [inicioDoDia(inicio, fuso), fimDoDia(fim, fuso)],
  );
  const usuarios = brutas.map(mapearUsuario);
  const linhas = usuarios.map((usuario) => ({
    nome: usuario.nome,
    email: usuario.email,
    papel: usuario.papel.nome,
    status: ROTULOS_STATUS_USUARIO[usuario.status],
    plano: usuario.plano?.nome ?? '',
    pais: usuario.pais ?? '',
    criadoEm: usuario.criadoEm,
  }));
  return {
    colunas: definicaoDe('usuarios').colunas,
    linhas,
    resumo: [
      { rotulo: 'Novos usuários', valor: usuarios.length, formato: 'numero' },
      { rotulo: 'Ativos', valor: usuarios.filter((usuario) => usuario.status === 'ativo').length, formato: 'numero' },
      { rotulo: 'Bloqueados', valor: usuarios.filter((usuario) => usuario.status === 'bloqueado').length, formato: 'numero' },
      { rotulo: 'Com assinatura', valor: usuarios.filter((usuario) => usuario.plano).length, formato: 'numero' },
    ],
  };
}

async function dadosAssinaturas(banco: Banco, fuso: string, inicio: string, fim: string): Promise<DadosRelatorio> {
  const { linhas: brutas } = await banco.consultar<Record<string, unknown>>(
    `select u.nome, u.email, p.nome as plano_nome, a.ciclo, a.status, a.valor, a.iniciada_em, a.convertida_em, a.cancelada_em
       from assinaturas a
       join usuarios u on u.id = a.usuario_id
       join planos p on p.codigo = a.plano
      where a.iniciada_em >= $1 and a.iniciada_em <= $2
      order by a.iniciada_em desc
      limit 50000`,
    [inicioDoDia(inicio, fuso), fimDoDia(fim, fuso)],
  );
  const linhas = brutas.map((linha) => ({
    cliente: String(linha.nome),
    email: String(linha.email),
    plano: String(linha.plano_nome),
    ciclo: linha.ciclo === 'anual' ? 'Anual' : 'Mensal',
    status: ROTULOS_ASSINATURA[String(linha.status)] ?? String(linha.status),
    valor: Number(linha.valor),
    iniciadaEm: paraIso(linha.iniciada_em),
    canceladaEm: paraIso(linha.cancelada_em),
  }));
  const convertidas = brutas.filter((linha) => linha.convertida_em);
  const mrrNovas = convertidas.reduce(
    (soma, linha) => soma + (linha.ciclo === 'anual' ? Number(linha.valor) / 12 : Number(linha.valor)),
    0,
  );
  return {
    colunas: definicaoDe('assinaturas').colunas,
    linhas,
    resumo: [
      { rotulo: 'Novas assinaturas', valor: brutas.length, formato: 'numero' },
      { rotulo: 'Convertidas', valor: convertidas.length, formato: 'numero' },
      { rotulo: 'Canceladas', valor: brutas.filter((linha) => linha.cancelada_em).length, formato: 'numero' },
      { rotulo: 'MRR das novas', valor: Math.round(mrrNovas), formato: 'moeda' },
    ],
  };
}

async function dadosCrescimento(banco: Banco, fuso: string, inicio: string, fim: string): Promise<DadosRelatorio> {
  const agora = Date.now();
  const [diario, assinaturas] = await Promise.all([carregarDiario(banco, fuso, inicio, fim), carregarAssinaturas(banco)]);
  const linhas: Record<string, unknown>[] = [];
  let mrrAnterior = mrrEm(assinaturas, inicioDoDia(primeiroDiaDoMes(inicio), fuso).getTime() - 1);
  const mrrInicial = mrrAnterior;
  let totalNovos = 0;
  let totalAssinaturas = 0;
  let totalCancelamentos = 0;
  let mrrFinal = mrrAnterior;
  for (const balde of baldesMensais(inicio, fim)) {
    const de = inicioDoDia(balde.inicio, fuso).getTime();
    const ate = Math.min(fimDoDia(ultimoDiaDoMes(balde.inicio) < balde.fim ? ultimoDiaDoMes(balde.inicio) : balde.fim, fuso).getTime(), agora);
    const soma = somar(diario, balde.inicio, balde.fim);
    const novas = conversoesEntre(assinaturas, de, ate);
    const cancelamentos = cancelamentosEntre(assinaturas, de, ate);
    const mrr = mrrEm(assinaturas, ate);
    linhas.push({
      mes: rotuloMes(balde.inicio),
      novosUsuarios: soma.novosUsuarios,
      assinaturasNovas: novas,
      cancelamentos,
      mrr,
      crescimento: mrrAnterior ? arredondar(((mrr - mrrAnterior) / mrrAnterior) * 100) : 0,
    });
    totalNovos += soma.novosUsuarios;
    totalAssinaturas += novas;
    totalCancelamentos += cancelamentos;
    mrrAnterior = mrr;
    mrrFinal = mrr;
  }
  return {
    colunas: definicaoDe('crescimento').colunas,
    linhas,
    resumo: [
      { rotulo: 'Novos usuários', valor: totalNovos, formato: 'numero' },
      { rotulo: 'Assinaturas novas', valor: totalAssinaturas, formato: 'numero' },
      { rotulo: 'Cancelamentos', valor: totalCancelamentos, formato: 'numero' },
      { rotulo: 'MRR final', valor: mrrFinal, formato: 'moeda' },
      {
        rotulo: 'Crescimento no período',
        valor: mrrInicial ? arredondar(((mrrFinal - mrrInicial) / mrrInicial) * 100) : 0,
        formato: 'percentual',
      },
    ],
  };
}

export async function obterDadosRelatorio(
  banco: Banco,
  fuso: string,
  tipo: TipoRelatorio,
  inicio: string,
  fim: string,
): Promise<DadosRelatorio> {
  switch (tipo) {
    case 'receita':
      return dadosReceita(banco, fuso, inicio, fim);
    case 'transacoes':
      return dadosTransacoes(banco, fuso, inicio, fim);
    case 'usuarios':
      return dadosUsuarios(banco, fuso, inicio, fim);
    case 'assinaturas':
      return dadosAssinaturas(banco, fuso, inicio, fim);
    case 'crescimento':
      return dadosCrescimento(banco, fuso, inicio, fim);
  }
}

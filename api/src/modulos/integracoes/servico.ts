import type { FastifyBaseLogger } from 'fastify';
import type { Banco } from '../../banco/conexao.js';
import {
  CAMPOS_POR_PROVEDOR,
  destinoClaramenteInterno,
  ENVIA_EVENTOS,
  lerConfigIntegracao,
  registrarEntrega,
  tentarEntrega,
  type Provedor,
} from '../../integracoes.js';
import { montarPagina, type Pagina } from '../../util/validacao.js';
import { paraIso } from '../../util/datas.js';
import { naoEncontrado, validacao } from '../../util/erros.js';
import { cifrar, mascarar } from '../../util/seguranca.js';
import { registrarAtividade } from '../comum/auditoria.js';

export interface Integracao {
  id: string;
  provedor: Provedor;
  nome: string;
  descricao: string;
  categoria: string;
  ativo: boolean;
  configurada: boolean;
  status: 'conectada' | 'desconectada' | 'erro';
  ultimoEvento: string | null;
  ultimoErro: string | null;
  campos: { nome: string; rotulo: string; tipo: 'texto' | 'url' | 'segredo'; valor: string }[];
}

interface LinhaIntegracao {
  id: string;
  provedor: Provedor;
  nome: string;
  descricao: string;
  categoria: string;
  ativo: boolean;
  config: unknown;
  status: Integracao['status'];
  ultimo_evento: Date | null;
  ultimo_erro: string | null;
}

function estaConfigurada(provedor: Provedor, valores: Record<string, string>): boolean {
  return CAMPOS_POR_PROVEDOR[provedor].every((campo) => !campo.obrigatorio || Boolean(valores[campo.nome]));
}

function mapear(linha: LinhaIntegracao, segredo: string): Integracao {
  const valores = lerConfigIntegracao(linha.config, segredo);
  return {
    id: linha.id,
    provedor: linha.provedor,
    nome: linha.nome,
    descricao: linha.descricao,
    categoria: linha.categoria,
    ativo: linha.ativo,
    configurada: estaConfigurada(linha.provedor, valores),
    status: linha.status,
    ultimoEvento: paraIso(linha.ultimo_evento),
    ultimoErro: linha.status === 'erro' ? linha.ultimo_erro : null,
    campos: CAMPOS_POR_PROVEDOR[linha.provedor].map((campo) => ({
      nome: campo.nome,
      rotulo: campo.rotulo,
      tipo: campo.tipo,
      valor: campo.tipo === 'segredo' ? mascarar(valores[campo.nome] ?? '') : (valores[campo.nome] ?? ''),
    })),
  };
}

async function buscar(banco: Banco, id: string): Promise<LinhaIntegracao> {
  const { linhas } = await banco.consultar<LinhaIntegracao>('select * from integracoes where id = $1', [id]);
  if (!linhas[0]) throw naoEncontrado('Integração');
  return linhas[0];
}

export async function listarIntegracoes(banco: Banco, segredo: string): Promise<Integracao[]> {
  const { linhas } = await banco.consultar<LinhaIntegracao>('select * from integracoes order by categoria, nome');
  return linhas.map((linha) => mapear(linha, segredo));
}

export async function atualizarIntegracao(
  banco: Banco,
  segredo: string,
  id: string,
  dados: { ativo?: boolean; config?: Record<string, string> },
  autor: { id: string },
  ip: string,
): Promise<Integracao> {
  const atual = await buscar(banco, id);
  const campos = CAMPOS_POR_PROVEDOR[atual.provedor];
  const valores = lerConfigIntegracao(atual.config, segredo);
  if (dados.config) {
    for (const [chave, valorBruto] of Object.entries(dados.config)) {
      const campo = campos.find((item) => item.nome === chave);
      if (!campo) throw validacao(`Campo desconhecido para ${atual.nome}: ${chave}`);
      const valor = String(valorBruto ?? '').trim();
      if (campo.tipo === 'segredo' && (valor === '' || valor.startsWith('••••'))) continue;
      if (valor && campo.padrao && !campo.padrao.test(valor)) {
        throw validacao(`${campo.rotulo} está em formato inválido.`, [{ campo: chave, mensagem: 'Formato inválido.' }]);
      }
      const problemaDestino = valor && campo.tipo === 'url' ? destinoClaramenteInterno(valor) : null;
      if (problemaDestino) {
        throw validacao(`${campo.rotulo}: ${problemaDestino}`, [{ campo: chave, mensagem: problemaDestino }]);
      }
      valores[chave] = valor;
    }
  }
  const ativo = dados.ativo ?? atual.ativo;
  if (ativo && !estaConfigurada(atual.provedor, valores)) {
    throw validacao(`Preencha os campos obrigatórios de ${atual.nome} antes de ativar.`);
  }
  const armazenados: Record<string, string> = {};
  for (const campo of campos) {
    const valor = valores[campo.nome];
    if (!valor) continue;
    armazenados[campo.nome] = campo.tipo === 'segredo' ? cifrar(valor, segredo) : valor;
  }
  const status = ativo ? (atual.status === 'erro' ? 'erro' : 'conectada') : 'desconectada';
  await banco.consultar(
    `update integracoes set ativo = $2, config = $3::jsonb, status = $4, atualizado_em = now() where id = $1`,
    [id, ativo, JSON.stringify(armazenados), status],
  );
  await registrarAtividade(banco, {
    usuarioId: autor.id,
    acao: dados.ativo === undefined ? 'integracao.configurada' : ativo ? 'integracao.ativada' : 'integracao.desativada',
    entidade: 'integracao',
    entidadeId: id,
    descricao:
      dados.ativo === undefined
        ? `configurou a integração ${atual.nome}`
        : ativo
          ? `ativou a integração ${atual.nome}`
          : `desativou a integração ${atual.nome}`,
    ip,
  });
  return mapear(await buscar(banco, id), segredo);
}

export async function testarIntegracao(
  banco: Banco,
  segredo: string,
  log: FastifyBaseLogger,
  id: string,
): Promise<{ ok: boolean; mensagem: string; entrega?: string }> {
  const atual = await buscar(banco, id);
  const valores = lerConfigIntegracao(atual.config, segredo);
  const campos = CAMPOS_POR_PROVEDOR[atual.provedor];
  const faltando = campos.filter((campo) => campo.obrigatorio && !valores[campo.nome]);
  if (faltando.length) {
    return { ok: false, mensagem: `Preencha: ${faltando.map((campo) => campo.rotulo).join(', ')}.` };
  }
  const invalidos = campos.filter((campo) => valores[campo.nome] && campo.padrao && !campo.padrao.test(valores[campo.nome]));
  if (invalidos.length) {
    return { ok: false, mensagem: `Formato inválido: ${invalidos.map((campo) => campo.rotulo).join(', ')}.` };
  }
  if (!ENVIA_EVENTOS.includes(atual.provedor)) {
    return { ok: true, mensagem: `Os campos de ${atual.nome} estão no formato esperado.` };
  }
  const entregaId = await registrarEntrega(banco, id, 'integracao.teste', 'Teste de integração do Bento', { teste: true }, true);
  const resultado = await tentarEntrega(banco, segredo, log, entregaId);
  if (resultado?.ok) return { ok: true, mensagem: `Mensagem de teste entregue para ${atual.nome}.`, entrega: entregaId };
  return { ok: false, mensagem: `Não foi possível entregar: ${resultado?.mensagem ?? 'tente de novo.'}`, entrega: entregaId };
}

export interface Entrega {
  id: string;
  evento: string;
  resumo: string;
  status: 'pendente' | 'entregue' | 'falhou';
  tentativas: number;
  proximaTentativa: string | null;
  codigoHttp: number | null;
  duracaoMs: number | null;
  erro: string | null;
  teste: boolean;
  criadoEm: string;
  atualizadoEm: string;
}

interface LinhaEntrega {
  id: string;
  evento: string;
  resumo: string;
  status: Entrega['status'];
  tentativas: number;
  proxima_tentativa: Date | null;
  codigo_http: number | null;
  duracao_ms: number | null;
  erro: string | null;
  teste: boolean;
  criado_em: Date;
  atualizado_em: Date;
}

const mapearEntrega = (linha: LinhaEntrega): Entrega => ({
  id: linha.id,
  evento: linha.evento,
  resumo: linha.resumo,
  status: linha.status,
  tentativas: linha.tentativas,
  proximaTentativa: paraIso(linha.proxima_tentativa),
  codigoHttp: linha.codigo_http,
  duracaoMs: linha.duracao_ms,
  erro: linha.erro,
  teste: linha.teste,
  criadoEm: paraIso(linha.criado_em) ?? '',
  atualizadoEm: paraIso(linha.atualizado_em) ?? '',
});

export async function listarEntregas(
  banco: Banco,
  integracaoId: string,
  filtro: { status?: Entrega['status']; pagina: number; porPagina: number },
): Promise<Pagina<Entrega> & { resumo: Record<Entrega['status'], number> }> {
  await buscar(banco, integracaoId);
  const parametros: unknown[] = [integracaoId];
  let condicao = 'integracao_id = $1';
  if (filtro.status) {
    parametros.push(filtro.status);
    condicao += ` and status = $${parametros.length}`;
  }
  const [lista, total, resumo] = await Promise.all([
    banco.consultar<LinhaEntrega>(
      `select id, evento, resumo, status, tentativas, proxima_tentativa, codigo_http, duracao_ms, erro, teste, criado_em, atualizado_em
         from entregas_integracao where ${condicao}
        order by criado_em desc, id desc
        limit $${parametros.length + 1} offset $${parametros.length + 2}`,
      [...parametros, filtro.porPagina, (filtro.pagina - 1) * filtro.porPagina],
    ),
    banco.consultar<{ total: number }>(`select count(*)::int as total from entregas_integracao where ${condicao}`, parametros),
    banco.consultar<{ status: Entrega['status']; total: number }>(
      `select status, count(*)::int as total from entregas_integracao where integracao_id = $1 group by status`,
      [integracaoId],
    ),
  ]);
  const porStatus = { pendente: 0, entregue: 0, falhou: 0 };
  for (const linha of resumo.linhas) porStatus[linha.status] = linha.total;
  return {
    ...montarPagina(lista.linhas.map(mapearEntrega), total.linhas[0]?.total ?? 0, filtro.pagina, filtro.porPagina),
    resumo: porStatus,
  };
}

export async function reenviarEntrega(
  banco: Banco,
  segredo: string,
  log: FastifyBaseLogger,
  integracaoId: string,
  entregaId: string,
  autor: { id: string },
  ip: string,
): Promise<Entrega> {
  const integracao = await buscar(banco, integracaoId);
  const { linhas } = await banco.consultar<{ id: string; evento: string; teste: boolean }>(
    `update entregas_integracao set status = 'pendente', proxima_tentativa = now(), atualizado_em = now()
      where id = $1 and integracao_id = $2 and status <> 'pendente'
      returning id, evento, teste`,
    [entregaId, integracaoId],
  );
  if (!linhas[0]) {
    const { linhas: existentes } = await banco.consultar('select 1 from entregas_integracao where id = $1 and integracao_id = $2', [entregaId, integracaoId]);
    if (!existentes[0]) throw naoEncontrado('Entrega');
    await banco.consultar(`update entregas_integracao set proxima_tentativa = now() where id = $1 and status = 'pendente'`, [entregaId]);
  }
  await registrarAtividade(banco, {
    usuarioId: autor.id,
    acao: 'integracao.reenvio',
    entidade: 'integracao',
    entidadeId: integracaoId,
    descricao: `reenviou um evento para a integração ${integracao.nome}`,
    detalhes: { entrega: entregaId, evento: linhas[0]?.evento ?? null },
    ip,
  });
  await tentarEntrega(banco, segredo, log, entregaId);
  const { linhas: final } = await banco.consultar<LinhaEntrega>(
    `select id, evento, resumo, status, tentativas, proxima_tentativa, codigo_http, duracao_ms, erro, teste, criado_em, atualizado_em
       from entregas_integracao where id = $1`,
    [entregaId],
  );
  return mapearEntrega(final[0] as LinhaEntrega);
}

import type { Banco } from '../../banco/conexao.js';
import {
  CAMPOS_POR_PROVEDOR,
  destinoClaramenteInterno,
  ENVIA_EVENTOS,
  enviarParaProvedor,
  lerConfigIntegracao,
  type Provedor,
} from '../../integracoes.js';
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

export async function testarIntegracao(banco: Banco, segredo: string, id: string): Promise<{ ok: boolean; mensagem: string }> {
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
  try {
    await enviarParaProvedor(atual.provedor, valores, 'integracao.teste', 'Teste de integração do Bento', { teste: true });
    await banco.consultar(`update integracoes set ultimo_evento = now(), ultimo_erro = null, status = case when ativo then 'conectada' else status end where id = $1`, [id]);
    return { ok: true, mensagem: `Mensagem de teste entregue para ${atual.nome}.` };
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    await banco.consultar(`update integracoes set ultimo_erro = $2, status = case when ativo then 'erro' else status end where id = $1`, [
      id,
      mensagem.slice(0, 300),
    ]);
    return { ok: false, mensagem: `Não foi possível entregar: ${mensagem}` };
  }
}

import type { Banco } from '../../banco/conexao.js';
import { somarDias } from '../../util/datas.js';
import { carregarDiario, hojeLocal } from '../metricas/base.js';

export const LIMITE_ASSINATURAS = 100_000;
export const LIMITE_EVENTOS = 600_000;
const DIAS_DIARIO = 400;
const MESES_EVENTOS = 25;

type Evento = [number, string, string, number, string];

export interface ConjuntoAnalise {
  corpo: {
    referencia: string;
    planos: { codigo: string; nome: string; preco_mensal: number; preco_anual: number }[];
    diario: Record<string, number | string>[];
    assinaturas: Record<string, string | number | null>[];
    eventos: Evento[];
  };
  usuarios: Map<string, string>;
  truncado: boolean;
}

export async function montarConjunto(banco: Banco, fuso: string): Promise<ConjuntoAnalise> {
  const referencia = hojeLocal(fuso);
  const inicioDiario = somarDias(referencia, -DIAS_DIARIO);
  const [planos, assinaturas, diario] = await Promise.all([
    banco.consultar<{ codigo: string; nome: string; preco_mensal: number; preco_anual: number }>(
      'select codigo, nome, preco_mensal, preco_anual from planos order by ordem, codigo',
    ),
    banco.consultar<Record<string, string | number | null>>(
      `select a.id::text as id, a.usuario_id::text as usuario, a.plano, a.ciclo, a.metodo, u.canal, a.valor, a.status,
              (a.iniciada_em at time zone $1)::date::text as inicio,
              (a.teste_ate at time zone $1)::date::text as teste_ate,
              (a.convertida_em at time zone $1)::date::text as convertida,
              (a.cancelada_em at time zone $1)::date::text as cancelada,
              (u.ultimo_acesso at time zone $1)::date::text as ultimo_acesso
         from assinaturas a
         join usuarios u on u.id = a.usuario_id
        order by a.iniciada_em desc
        limit $2`,
      [fuso, LIMITE_ASSINATURAS + 1],
    ),
    carregarDiario(banco, fuso, inicioDiario, somarDias(referencia, -1)),
  ]);
  const truncadoAssinaturas = assinaturas.linhas.length > LIMITE_ASSINATURAS;
  const linhas = assinaturas.linhas.slice(0, LIMITE_ASSINATURAS);
  const indices = new Map<string, number>();
  const usuarios = new Map<string, string>();
  const corpoAssinaturas = linhas.map((linha, indice) => {
    const id = String(linha.id);
    indices.set(id, indice);
    usuarios.set(id, String(linha.usuario));
    return {
      id,
      plano: linha.plano,
      ciclo: linha.ciclo,
      metodo: linha.metodo,
      canal: linha.canal,
      valor: Number(linha.valor),
      status: linha.status,
      inicio: linha.inicio,
      teste_ate: linha.teste_ate,
      convertida: linha.convertida,
      cancelada: linha.cancelada,
      ultimo_acesso: linha.ultimo_acesso,
    };
  });
  const eventos = await banco.consultar<{ assinatura: string; dia: string; status: string; valor: number; tipo: string }>(
    `select assinatura_id::text as assinatura, (criado_em at time zone $1)::date::text as dia, status, valor, tipo
       from transacoes
      where assinatura_id is not null and criado_em >= now() - make_interval(months => $2)
      order by criado_em desc
      limit $3`,
    [fuso, MESES_EVENTOS, LIMITE_EVENTOS + 1],
  );
  const corpoEventos: Evento[] = [];
  for (const evento of eventos.linhas.slice(0, LIMITE_EVENTOS)) {
    const indice = indices.get(evento.assinatura);
    if (indice !== undefined) corpoEventos.push([indice, evento.dia, evento.status, Number(evento.valor), evento.tipo]);
  }
  const corpoDiario = [...diario.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dia, item]) => ({
      dia,
      receita: item.receita,
      reembolsos: item.reembolsos,
      pagas: item.pagas,
      falhas: item.falhas,
      novos: item.novosUsuarios,
      visitantes: item.visitantes,
      cadastros: item.cadastros,
      conversoes: item.conversoes,
    }));
  return {
    corpo: {
      referencia,
      planos: planos.linhas.map((plano) => ({ ...plano, preco_mensal: Number(plano.preco_mensal), preco_anual: Number(plano.preco_anual) })),
      diario: corpoDiario,
      assinaturas: corpoAssinaturas,
      eventos: corpoEventos,
    },
    usuarios,
    truncado: truncadoAssinaturas || eventos.linhas.length > LIMITE_EVENTOS,
  };
}

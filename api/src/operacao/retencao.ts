import type { Banco } from '../banco/conexao.js';
import type { Retencao } from '../config.js';

export type CategoriaLimpeza = 'sessoes' | 'notificacoes' | 'relatorios' | 'entregas' | 'alertas' | 'auditoria';

export interface ItemLimpeza {
  categoria: CategoriaLimpeza;
  nome: string;
  dias: number;
  registros: number;
  bytes: number;
}

interface Regra {
  categoria: CategoriaLimpeza;
  nome: string;
  dias: (retencao: Retencao) => number;
  contar: string;
  apagar: string;
}

const REGRAS: Regra[] = [
  {
    categoria: 'sessoes',
    nome: 'Sessões encerradas ou expiradas',
    dias: (retencao) => retencao.sessoesDias,
    contar: `select count(*)::int as registros, 0::float8 as bytes from sessoes
              where coalesce(revogada_em, expira_em) < now() - make_interval(days => $1::int)`,
    apagar: `delete from sessoes where coalesce(revogada_em, expira_em) < now() - make_interval(days => $1::int)`,
  },
  {
    categoria: 'notificacoes',
    nome: 'Notificações antigas',
    dias: (retencao) => retencao.notificacoesDias,
    contar: `select count(*)::int as registros, 0::float8 as bytes from notificacoes where criado_em < now() - make_interval(days => $1::int)`,
    apagar: `delete from notificacoes where criado_em < now() - make_interval(days => $1::int)`,
  },
  {
    categoria: 'relatorios',
    nome: 'Arquivos de relatórios gerados',
    dias: (retencao) => retencao.relatoriosDias,
    contar: `select count(*)::int as registros, coalesce(sum(tamanho_bytes), 0)::float8 as bytes from relatorios
              where criado_em < now() - make_interval(days => $1::int)`,
    apagar: `delete from relatorios where criado_em < now() - make_interval(days => $1::int)`,
  },
  {
    categoria: 'entregas',
    nome: 'Histórico de entregas das integrações',
    dias: (retencao) => retencao.entregasDias,
    contar: `select count(*)::int as registros, 0::float8 as bytes from entregas_integracao
              where status <> 'pendente' and criado_em < now() - make_interval(days => $1::int)`,
    apagar: `delete from entregas_integracao where status <> 'pendente' and criado_em < now() - make_interval(days => $1::int)`,
  },
  {
    categoria: 'alertas',
    nome: 'Histórico de disparos dos alertas',
    dias: (retencao) => retencao.alertasDias,
    contar: `select count(*)::int as registros, 0::float8 as bytes from disparos_alerta
              where resolvido_em is not null and criado_em < now() - make_interval(days => $1::int)`,
    apagar: `delete from disparos_alerta where resolvido_em is not null and criado_em < now() - make_interval(days => $1::int)`,
  },
  {
    categoria: 'auditoria',
    nome: 'Registros da auditoria',
    dias: (retencao) => retencao.auditoriaDias,
    contar: `select count(*)::int as registros, 0::float8 as bytes from auditoria where criado_em < now() - make_interval(days => $1::int)`,
    apagar: `delete from auditoria where criado_em < now() - make_interval(days => $1::int)`,
  },
];

export async function previaLimpeza(banco: Banco, retencao: Retencao): Promise<ItemLimpeza[]> {
  const itens: ItemLimpeza[] = [];
  for (const regra of REGRAS) {
    const dias = regra.dias(retencao);
    if (dias <= 0) {
      itens.push({ categoria: regra.categoria, nome: regra.nome, dias, registros: 0, bytes: 0 });
      continue;
    }
    const { linhas } = await banco.consultar<{ registros: number; bytes: number }>(regra.contar, [dias]);
    itens.push({ categoria: regra.categoria, nome: regra.nome, dias, registros: linhas[0]?.registros ?? 0, bytes: Number(linhas[0]?.bytes ?? 0) });
  }
  return itens;
}

export async function executarLimpeza(banco: Banco, retencao: Retencao): Promise<ItemLimpeza[]> {
  return banco.transacao(async (tx) => {
    const previa = await previaLimpeza(tx, retencao);
    for (const item of previa) {
      if (item.dias <= 0 || item.registros === 0) continue;
      const regra = REGRAS.find((candidata) => candidata.categoria === item.categoria);
      if (regra) await tx.consultar(regra.apagar, [item.dias]);
    }
    return previa;
  });
}

export const totalRemovido = (itens: ItemLimpeza[]): number => itens.reduce((soma, item) => soma + item.registros, 0);

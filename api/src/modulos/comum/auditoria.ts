import type { Banco } from '../../banco/conexao.js';

export interface NovaAtividade {
  usuarioId: string | null;
  acao: string;
  descricao: string;
  entidade?: string | null;
  entidadeId?: string | null;
  detalhes?: Record<string, unknown>;
  ip?: string | null;
}

export async function registrarAtividade(banco: Banco, atividade: NovaAtividade): Promise<void> {
  await banco.consultar(
    `insert into auditoria (usuario_id, acao, entidade, entidade_id, descricao, detalhes, ip)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [
      atividade.usuarioId,
      atividade.acao,
      atividade.entidade ?? null,
      atividade.entidadeId ?? null,
      atividade.descricao,
      JSON.stringify(atividade.detalhes ?? {}),
      atividade.ip ?? null,
    ],
  );
}

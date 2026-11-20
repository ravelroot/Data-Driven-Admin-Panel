import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { definirDemonstracao, lerDemonstracao } from '../../operacao/ajustes.js';
import { salvarBackup } from '../../operacao/backup.js';
import { conflito, ErroApi, validacao } from '../../util/erros.js';
import { conferirSenha, gerarHashSenha } from '../auth/servico.js';
import { registrarAtividade } from '../comum/auditoria.js';

export interface ResumoDemonstracao {
  ativa: boolean;
  equipe: number;
  clientes: number;
  assinaturas: number;
  transacoes: number;
  relatorios: number;
  notificacoes: number;
  alertas: number;
}

export interface DadosReais {
  nome: string;
  email: string;
  senha: string;
  senhaAtual: string;
  nomeEmpresa?: string;
}

export interface ResultadoDadosReais {
  backup: string;
  email: string;
  removidos: Record<string, number>;
}

const LIMPEZA: [string, string][] = [
  ['notificacoes', 'delete from notificacoes'],
  ['relatorios', 'delete from relatorios'],
  ['agendamentos', 'delete from relatorios_agendados'],
  ['alertas', 'delete from alertas_metricas'],
  ['entregas', 'delete from entregas_integracao'],
  ['notas', 'delete from notas_usuario'],
  ['transacoes', 'delete from transacoes'],
  ['assinaturas', 'delete from assinaturas'],
  ['trafego', 'delete from trafego_diario'],
  ['paises', 'delete from trafego_paises'],
  ['metas', 'delete from metas_mensais'],
];

export async function resumoDemonstracao(app: FastifyInstance): Promise<ResumoDemonstracao> {
  const [ativa, contagens] = await Promise.all([
    lerDemonstracao(app.banco),
    app.banco.consultar<Omit<ResumoDemonstracao, 'ativa'>>(
      `select
         (select count(*) from usuarios u join papeis p on p.codigo = u.papel where p.acesso_painel)::int as equipe,
         (select count(*) from usuarios u join papeis p on p.codigo = u.papel where not p.acesso_painel)::int as clientes,
         (select count(*) from assinaturas)::int as assinaturas,
         (select count(*) from transacoes)::int as transacoes,
         (select count(*) from relatorios)::int as relatorios,
         (select count(*) from notificacoes)::int as notificacoes,
         (select count(*) from alertas_metricas)::int as alertas`,
    ),
  ]);
  const linha = contagens.linhas[0] ?? { equipe: 0, clientes: 0, assinaturas: 0, transacoes: 0, relatorios: 0, notificacoes: 0, alertas: 0 };
  return { ativa, ...linha };
}

export async function comecarComDadosReais(
  app: FastifyInstance,
  autor: { id: string },
  dados: DadosReais,
  ip: string,
): Promise<ResultadoDadosReais> {
  const { banco } = app;
  if (!(await lerDemonstracao(banco))) {
    throw conflito('O painel já está com os seus dados. Esta ação só existe enquanto os dados de demonstração estão em uso.');
  }
  const email = dados.email.trim().toLowerCase();
  if (email.endsWith('@bento.local')) {
    throw validacao('Use o seu e-mail de verdade; os endereços @bento.local são da demonstração.', [{ campo: 'email', mensagem: 'Use um e-mail real.' }]);
  }
  const { linhas } = await banco.consultar<{ senha_hash: string | null }>('select senha_hash from usuarios where id = $1', [autor.id]);
  if (!(await conferirSenha(dados.senhaAtual, linhas[0]?.senha_hash ?? null))) {
    throw new ErroApi('CREDENCIAIS', 'Senha atual incorreta.');
  }
  const backup = await salvarBackup(banco, app.config.backup.pasta, 'demonstracao');
  const hash = await gerarHashSenha(dados.senha);
  const removidos: Record<string, number> = {};
  await banco.transacao(async (tx) => {
    for (const [nome, sql] of LIMPEZA) removidos[nome] = (await tx.consultar(sql)).total;
    removidos.contas = (await tx.consultar('delete from usuarios where id <> $1', [autor.id])).total;
    await tx.consultar('delete from auditoria');
    await tx.consultar('delete from sessoes where usuario_id = $1', [autor.id]);
    await tx.consultar(
      `update usuarios set nome = $2, email = $3, senha_hash = $4, cargo = null, empresa = null, cidade = null, pais = null,
              telefone = null, tentativas_falhas = 0, bloqueio_temporario_ate = null, atualizado_em = now()
        where id = $1`,
      [autor.id, dados.nome.trim(), email, hash],
    );
    await tx.consultar(`update integracoes set ultimo_evento = null, ultimo_erro = null, status = case when ativo then 'conectada' else 'desconectada' end`);
    if (dados.nomeEmpresa?.trim()) {
      await tx.consultar(
        `insert into configuracoes_sistema (chave, valor, atualizado_em) values ('nomeEmpresa', $1::jsonb, now())
         on conflict (chave) do update set valor = excluded.valor, atualizado_em = now()`,
        [JSON.stringify(dados.nomeEmpresa.trim())],
      );
    }
    await definirDemonstracao(tx, false);
    await registrarAtividade(tx, {
      usuarioId: autor.id,
      acao: 'sistema.dados_reais',
      entidade: 'sistema',
      entidadeId: path.basename(backup.arquivo),
      descricao: 'apagou os dados de demonstração e começou a usar o painel com os dados reais',
      detalhes: { backup: path.basename(backup.arquivo), ...removidos },
      ip,
    });
  });
  app.estado.demonstracao = false;
  await app.barramento.publicar({ tipo: 'sistema', destinatarioId: null, dados: { demonstracao: false } });
  return { backup: path.basename(backup.arquivo), email, removidos };
}

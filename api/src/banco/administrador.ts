import { registrarAtividade } from '../modulos/comum/auditoria.js';
import { gerarHashSenha } from '../modulos/auth/servico.js';
import type { Banco } from './conexao.js';

export interface DadosAdministrador {
  email: string;
  senha: string;
  nome: string;
}

export async function garantirAdministrador(banco: Banco, dados: DadosAdministrador): Promise<'criado' | 'existente'> {
  const email = dados.email.trim().toLowerCase();
  const nome = dados.nome.trim();
  const { linhas } = await banco.consultar<{ id: string }>('select id from usuarios where lower(email) = $1', [email]);
  if (linhas.length > 0) return 'existente';
  const hash = await gerarHashSenha(dados.senha);
  await banco.transacao(async (tx) => {
    const { linhas: novos } = await tx.consultar<{ id: string }>(
      `insert into usuarios (nome, email, senha_hash, papel, status) values ($1, $2, $3, 'admin', 'ativo') returning id`,
      [nome, email, hash],
    );
    await registrarAtividade(tx, {
      usuarioId: null,
      acao: 'usuario.criado',
      entidade: 'usuario',
      entidadeId: novos[0].id,
      descricao: `criou a conta de administrador de ${nome}`,
    });
  });
  return 'criado';
}

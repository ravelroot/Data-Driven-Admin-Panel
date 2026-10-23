import type { FastifyInstance } from 'fastify';
import type { Banco } from '../../banco/conexao.js';
import { dispararEmSegundoPlano } from '../../integracoes.js';
import { conflito, semPermissao, validacao } from '../../util/erros.js';
import { senhaTemporaria } from '../../util/seguranca.js';
import { filtroBusca, montarPagina, type Pagina } from '../../util/validacao.js';
import type { UsuarioSessao } from '../../tipos.js';
import { gerarHashSenha, revogarSessoesDoUsuario } from '../auth/servico.js';
import { registrarAtividade } from '../comum/auditoria.js';
import { atividadesRecentes, buscarUsuario, transacoesRecentes } from '../comum/consultas.js';
import { mapearUsuario, SELECAO_USUARIO, type Usuario } from '../comum/mapeadores.js';
import { criarNotificacao } from '../notificacoes/servico.js';

export interface Ator {
  usuario: UsuarioSessao;
  ip: string;
}

export const ORDENACAO_USUARIOS = {
  nome: 'lower(u.nome)',
  email: 'lower(u.email)',
  criadoEm: 'u.criado_em',
  ultimoAcesso: 'u.ultimo_acesso',
  status: 'u.status',
  papel: 'p.nivel',
} as const;

export type CampoOrdenacaoUsuario = keyof typeof ORDENACAO_USUARIOS;

export interface FiltroUsuarios {
  q?: string;
  status?: string;
  papel?: string;
  plano?: string;
}

const STATUS = ['ativo', 'bloqueado', 'pendente', 'inativo'] as const;

function montarFiltro(filtro: FiltroUsuarios, incluirStatus: boolean): { onde: string; parametros: unknown[] } {
  const condicoes: string[] = [];
  const parametros: unknown[] = [];
  const adicionar = (sql: (indice: number) => string, valor: unknown) => {
    parametros.push(valor);
    condicoes.push(sql(parametros.length));
  };
  if (filtro.q) {
    adicionar((i) => `(u.nome ilike $${i} or u.email ilike $${i} or coalesce(u.empresa, '') ilike $${i})`, filtroBusca(filtro.q));
  }
  if (incluirStatus && filtro.status) adicionar((i) => `u.status = $${i}`, filtro.status);
  if (filtro.papel) adicionar((i) => `u.papel = $${i}`, filtro.papel);
  if (filtro.plano) adicionar((i) => `pl.codigo = $${i}`, filtro.plano);
  return { onde: condicoes.length ? `where ${condicoes.join(' and ')}` : '', parametros };
}

const JUNCOES = `
  from usuarios u
  join papeis p on p.codigo = u.papel
  left join assinaturas a on a.usuario_id = u.id and a.status in ('ativa', 'teste', 'inadimplente')
  left join planos pl on pl.codigo = a.plano
`;

export async function listarUsuarios(
  banco: Banco,
  filtro: FiltroUsuarios & { ordenar: CampoOrdenacaoUsuario; direcao: 'asc' | 'desc'; pagina: number; porPagina: number },
): Promise<Pagina<Usuario> & { contagens: Record<'todos' | (typeof STATUS)[number], number> }> {
  const { onde, parametros } = montarFiltro(filtro, true);
  const semStatus = montarFiltro(filtro, false);
  const direcao = filtro.direcao === 'asc' ? 'asc' : 'desc';
  const nulos = filtro.ordenar === 'ultimoAcesso' ? ' nulls last' : '';
  const deslocamento = (filtro.pagina - 1) * filtro.porPagina;
  const [total, itens, contagens] = await Promise.all([
    banco.consultar<{ total: number }>(`select count(*)::int as total ${JUNCOES} ${onde}`, parametros),
    banco.consultar(
      `${SELECAO_USUARIO} ${onde}
       order by ${ORDENACAO_USUARIOS[filtro.ordenar]} ${direcao}${nulos}, u.id ${direcao}
       limit ${filtro.porPagina} offset ${deslocamento}`,
      parametros,
    ),
    banco.consultar<{ status: string; total: number }>(
      `select u.status, count(*)::int as total ${JUNCOES} ${semStatus.onde} group by u.status`,
      semStatus.parametros,
    ),
  ]);
  const resumo = { todos: 0, ativo: 0, bloqueado: 0, pendente: 0, inativo: 0 };
  for (const linha of contagens.linhas) {
    resumo[linha.status as (typeof STATUS)[number]] = linha.total;
    resumo.todos += linha.total;
  }
  return {
    ...montarPagina(itens.linhas.map(mapearUsuario), total.linhas[0]?.total ?? 0, filtro.pagina, filtro.porPagina),
    contagens: resumo,
  };
}

async function garantirPapel(banco: Banco, papel: string): Promise<{ codigo: string; nome: string }> {
  const { linhas } = await banco.consultar<{ codigo: string; nome: string }>('select codigo, nome from papeis where codigo = $1', [
    papel,
  ]);
  if (!linhas[0]) throw validacao('Papel inexistente.', [{ campo: 'papel', mensagem: 'Escolha um papel válido.' }]);
  return linhas[0];
}

async function garantirEmailLivre(banco: Banco, email: string, exceto?: string): Promise<void> {
  const { linhas } = await banco.consultar(
    'select 1 from usuarios where lower(email) = lower($1) and ($2::uuid is null or id <> $2::uuid)',
    [email, exceto ?? null],
  );
  if (linhas[0]) throw conflito('Já existe um usuário com este e-mail.');
}

async function contarAdminsAtivos(banco: Banco, exceto: string): Promise<number> {
  const { linhas } = await banco.consultar<{ total: number }>(
    `select count(*)::int as total from usuarios where papel = 'admin' and status = 'ativo' and id <> $1`,
    [exceto],
  );
  return linhas[0]?.total ?? 0;
}

/**
 * Quem não controla permissões (usuarios.permissoes) só pode alterar contas de nível
 * estritamente inferior ao próprio papel. Sem isso, um papel como "suporte" (que tem
 * usuarios.editar) redefiniria a senha de um administrador e assumiria a conta dele.
 */
async function garantirHierarquia(banco: Banco, ator: Ator, alvo: Usuario): Promise<void> {
  if (alvo.id === ator.usuario.id || ator.usuario.permissoes.has('usuarios.permissoes')) return;
  const { linhas } = await banco.consultar<{ codigo: string; nivel: number }>(
    'select codigo, nivel from papeis where codigo = any($1::text[])',
    [[ator.usuario.papel, alvo.papel.codigo]],
  );
  const nivelAtor = linhas.find((linha) => linha.codigo === ator.usuario.papel)?.nivel ?? -1;
  const nivelAlvo = linhas.find((linha) => linha.codigo === alvo.papel.codigo)?.nivel ?? Number.POSITIVE_INFINITY;
  if (nivelAlvo >= nivelAtor) {
    throw semPermissao('Você não pode alterar contas de nível igual ou superior ao seu.');
  }
}

async function protegerUltimoAdmin(banco: Banco, alvo: Usuario, mensagem: string): Promise<void> {
  if (alvo.papel.codigo === 'admin' && alvo.status === 'ativo' && (await contarAdminsAtivos(banco, alvo.id)) === 0) {
    throw conflito(mensagem);
  }
}

export interface DadosNovoUsuario {
  nome: string;
  email: string;
  papel: string;
  cargo?: string | null;
  empresa?: string | null;
  telefone?: string | null;
  pais?: string | null;
  cidade?: string | null;
  status: 'ativo' | 'pendente';
  senha?: string;
}

export async function criarUsuario(app: FastifyInstance, ator: Ator, dados: DadosNovoUsuario) {
  const { banco } = app;
  const papel = await garantirPapel(banco, dados.papel);
  if (['admin', 'gerente'].includes(papel.codigo) && !ator.usuario.permissoes.has('usuarios.permissoes')) {
    throw semPermissao('Só quem controla permissões pode cadastrar administradores e gerentes.');
  }
  await garantirEmailLivre(banco, dados.email);
  const temporaria = dados.senha ? null : senhaTemporaria(12);
  const hash = await gerarHashSenha(dados.senha ?? temporaria ?? '');
  const id = await banco.transacao(async (tx) => {
    const { linhas } = await tx.consultar<{ id: string }>(
      `insert into usuarios (nome, email, senha_hash, papel, status, cargo, empresa, telefone, pais, cidade)
       values ($1, lower($2), $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
      [
        dados.nome.trim(),
        dados.email.trim(),
        hash,
        papel.codigo,
        dados.status,
        dados.cargo ?? null,
        dados.empresa ?? null,
        dados.telefone ?? null,
        dados.pais ?? null,
        dados.cidade ?? null,
      ],
    );
    const novoId = linhas[0].id;
    await registrarAtividade(tx, {
      usuarioId: ator.usuario.id,
      acao: 'usuario.criado',
      entidade: 'usuario',
      entidadeId: novoId,
      descricao: `cadastrou ${dados.nome.trim()} como ${papel.nome}`,
      ip: ator.ip,
    });
    return novoId;
  });
  const usuario = await buscarUsuario(banco, id);
  await criarNotificacao(banco, app.barramento, {
    destinatarioId: null,
    tipo: 'info',
    categoria: 'usuario',
    titulo: 'Novo usuário cadastrado',
    mensagem: `${ator.usuario.nome} cadastrou ${usuario.nome} (${papel.nome}).`,
    link: '/usuarios',
    criadoPor: ator.usuario.id,
  });
  await app.barramento.publicar({ tipo: 'usuario', destinatarioId: null, dados: usuario });
  dispararEmSegundoPlano(banco, app.config.segredoJwt, app.log, 'usuario.criado', `Novo usuário: ${usuario.nome}`, usuario);
  return { usuario, ...(temporaria ? { senhaTemporaria: temporaria } : {}) };
}

export async function detalharUsuario(banco: Banco, id: string) {
  const usuario = await buscarUsuario(banco, id);
  const [assinaturas, transacoes, atividades, sessoes] = await Promise.all([
    banco.consultar<Record<string, unknown>>(
      `select a.id, a.plano, p.nome as plano_nome, a.status, a.ciclo, a.metodo, a.valor, a.iniciada_em, a.teste_ate,
              a.convertida_em, a.renovacao_em, a.cancelada_em
         from assinaturas a join planos p on p.codigo = a.plano
        where a.usuario_id = $1
        order by (a.status in ('ativa', 'teste', 'inadimplente')) desc, a.iniciada_em desc
        limit 1`,
      [id],
    ),
    transacoesRecentes(banco, 5, id),
    atividadesRecentes(banco, 5, id),
    banco.consultar<{ total: number }>(
      'select count(*)::int as total from sessoes where usuario_id = $1 and revogada_em is null and expira_em > now()',
      [id],
    ),
  ]);
  const assinatura = assinaturas.linhas[0];
  const iso = (valor: unknown) => (valor ? new Date(String(valor instanceof Date ? valor.toISOString() : valor)).toISOString() : null);
  return {
    usuario,
    assinatura: assinatura
      ? {
          id: String(assinatura.id),
          plano: { codigo: String(assinatura.plano), nome: String(assinatura.plano_nome) },
          status: String(assinatura.status),
          ciclo: String(assinatura.ciclo),
          metodo: String(assinatura.metodo),
          valor: Number(assinatura.valor),
          iniciadaEm: iso(assinatura.iniciada_em),
          testeAte: iso(assinatura.teste_ate),
          convertidaEm: iso(assinatura.convertida_em),
          renovacaoEm: iso(assinatura.renovacao_em),
          canceladaEm: iso(assinatura.cancelada_em),
        }
      : null,
    transacoes,
    atividades,
    sessoesAtivas: sessoes.linhas[0]?.total ?? 0,
  };
}

export interface DadosAtualizacao {
  nome?: string;
  email?: string;
  papel?: string;
  cargo?: string | null;
  empresa?: string | null;
  telefone?: string | null;
  pais?: string | null;
  cidade?: string | null;
  status?: 'ativo' | 'pendente' | 'inativo';
}

const COLUNAS_EDITAVEIS: Record<string, string> = {
  nome: 'nome',
  email: 'email',
  cargo: 'cargo',
  empresa: 'empresa',
  telefone: 'telefone',
  pais: 'pais',
  cidade: 'cidade',
};

export async function atualizarUsuario(app: FastifyInstance, ator: Ator, id: string, dados: DadosAtualizacao) {
  const { banco } = app;
  const atual = await buscarUsuario(banco, id);
  await garantirHierarquia(banco, ator, atual);
  const atribuicoes: string[] = [];
  const parametros: unknown[] = [id];
  const mudancas: string[] = [];
  const definir = (coluna: string, valor: unknown) => {
    parametros.push(valor);
    atribuicoes.push(`${coluna} = $${parametros.length}`);
  };
  for (const [campo, coluna] of Object.entries(COLUNAS_EDITAVEIS)) {
    const valor = dados[campo as keyof DadosAtualizacao];
    if (valor === undefined) continue;
    if (campo === 'email' && typeof valor === 'string') {
      await garantirEmailLivre(banco, valor, id);
      definir(coluna, valor.trim().toLowerCase());
    } else {
      definir(coluna, typeof valor === 'string' ? valor.trim() : valor);
    }
    mudancas.push(campo);
  }
  if (dados.papel !== undefined && dados.papel !== atual.papel.codigo) {
    if (!ator.usuario.permissoes.has('usuarios.permissoes')) {
      throw semPermissao('Você precisa da permissão usuarios.permissoes para mudar o papel.');
    }
    if (id === ator.usuario.id) throw conflito('Você não pode alterar o próprio papel.');
    await garantirPapel(banco, dados.papel);
    if (dados.papel !== 'admin') await protegerUltimoAdmin(banco, atual, 'É preciso manter pelo menos um administrador ativo.');
    definir('papel', dados.papel);
    mudancas.push('papel');
  }
  if (dados.status !== undefined && dados.status !== atual.status) {
    if (id === ator.usuario.id) throw conflito('Você não pode alterar o status da própria conta.');
    if (atual.status === 'bloqueado' && !ator.usuario.permissoes.has('usuarios.bloquear')) {
      throw semPermissao('Você precisa da permissão usuarios.bloquear para desbloquear uma conta.');
    }
    if (dados.status !== 'ativo') await protegerUltimoAdmin(banco, atual, 'É preciso manter pelo menos um administrador ativo.');
    definir('status', dados.status);
    atribuicoes.push('bloqueado_em = null', 'motivo_bloqueio = null');
    mudancas.push('status');
  }
  if (atribuicoes.length === 0) return { usuario: atual };
  atribuicoes.push('atualizado_em = now()');
  await banco.transacao(async (tx) => {
    await tx.consultar(`update usuarios set ${atribuicoes.join(', ')} where id = $1`, parametros);
    if (dados.status && dados.status !== 'ativo') await revogarSessoesDoUsuario(tx, id);
    await registrarAtividade(tx, {
      usuarioId: ator.usuario.id,
      acao: mudancas.includes('papel') ? 'usuario.papel_alterado' : 'usuario.editado',
      entidade: 'usuario',
      entidadeId: id,
      descricao: mudancas.includes('papel')
        ? `alterou o papel de ${atual.nome}`
        : `editou o cadastro de ${atual.nome}`,
      detalhes: { campos: mudancas },
      ip: ator.ip,
    });
  });
  return { usuario: await buscarUsuario(banco, id) };
}

export async function excluirUsuario(app: FastifyInstance, ator: Ator, id: string): Promise<void> {
  const { banco } = app;
  if (id === ator.usuario.id) throw conflito('Você não pode excluir a própria conta.');
  const alvo = await buscarUsuario(banco, id);
  await garantirHierarquia(banco, ator, alvo);
  await protegerUltimoAdmin(banco, alvo, 'Não é possível excluir o último administrador ativo.');
  await banco.transacao(async (tx) => {
    await tx.consultar('delete from usuarios where id = $1', [id]);
    await registrarAtividade(tx, {
      usuarioId: ator.usuario.id,
      acao: 'usuario.excluido',
      entidade: 'usuario',
      entidadeId: id,
      descricao: `excluiu a conta de ${alvo.nome}`,
      detalhes: { email: alvo.email },
      ip: ator.ip,
    });
  });
}

export async function bloquearUsuario(app: FastifyInstance, ator: Ator, id: string, motivo: string) {
  const { banco } = app;
  if (id === ator.usuario.id) throw conflito('Você não pode bloquear a própria conta.');
  const alvo = await buscarUsuario(banco, id);
  await garantirHierarquia(banco, ator, alvo);
  if (alvo.status === 'bloqueado') return { usuario: alvo };
  await protegerUltimoAdmin(banco, alvo, 'Não é possível bloquear o último administrador ativo.');
  await banco.transacao(async (tx) => {
    await tx.consultar(
      `update usuarios set status = 'bloqueado', bloqueado_em = now(), motivo_bloqueio = $2, atualizado_em = now() where id = $1`,
      [id, motivo],
    );
    await revogarSessoesDoUsuario(tx, id);
    await registrarAtividade(tx, {
      usuarioId: ator.usuario.id,
      acao: 'usuario.bloqueado',
      entidade: 'usuario',
      entidadeId: id,
      descricao: `bloqueou a conta de ${alvo.nome}`,
      detalhes: { motivo },
      ip: ator.ip,
    });
  });
  const usuario = await buscarUsuario(banco, id);
  await criarNotificacao(banco, app.barramento, {
    destinatarioId: null,
    tipo: 'alerta',
    categoria: 'seguranca',
    titulo: 'Conta bloqueada',
    mensagem: `${ator.usuario.nome} bloqueou a conta de ${alvo.nome}. Motivo: ${motivo}`,
    link: '/usuarios',
    criadoPor: ator.usuario.id,
  });
  dispararEmSegundoPlano(banco, app.config.segredoJwt, app.log, 'usuario.bloqueado', `Conta bloqueada: ${alvo.nome}`, {
    usuario,
    motivo,
  });
  return { usuario };
}

export async function desbloquearUsuario(app: FastifyInstance, ator: Ator, id: string) {
  const { banco } = app;
  const alvo = await buscarUsuario(banco, id);
  await garantirHierarquia(banco, ator, alvo);
  if (alvo.status !== 'bloqueado') return { usuario: alvo };
  await banco.transacao(async (tx) => {
    await tx.consultar(
      `update usuarios set status = 'ativo', bloqueado_em = null, motivo_bloqueio = null, tentativas_falhas = 0,
              bloqueio_temporario_ate = null, atualizado_em = now()
        where id = $1`,
      [id],
    );
    await registrarAtividade(tx, {
      usuarioId: ator.usuario.id,
      acao: 'usuario.desbloqueado',
      entidade: 'usuario',
      entidadeId: id,
      descricao: `desbloqueou a conta de ${alvo.nome}`,
      ip: ator.ip,
    });
  });
  return { usuario: await buscarUsuario(banco, id) };
}

export async function redefinirSenha(app: FastifyInstance, ator: Ator, id: string): Promise<{ senhaTemporaria: string }> {
  const { banco } = app;
  const alvo = await buscarUsuario(banco, id);
  await garantirHierarquia(banco, ator, alvo);
  const temporaria = senhaTemporaria(12);
  const hash = await gerarHashSenha(temporaria);
  await banco.transacao(async (tx) => {
    await tx.consultar('update usuarios set senha_hash = $2, atualizado_em = now() where id = $1', [id, hash]);
    if (id !== ator.usuario.id) await revogarSessoesDoUsuario(tx, id);
    await registrarAtividade(tx, {
      usuarioId: ator.usuario.id,
      acao: 'usuario.senha_redefinida',
      entidade: 'usuario',
      entidadeId: id,
      descricao: `redefiniu a senha de ${alvo.nome}`,
      ip: ator.ip,
    });
  });
  return { senhaTemporaria: temporaria };
}

export async function obterPermissoesUsuario(banco: Banco, id: string) {
  const alvo = await buscarUsuario(banco, id);
  const [doPapel, individuais] = await Promise.all([
    banco.consultar<{ permissao: string }>('select permissao from papel_permissoes where papel = $1 order by permissao', [
      alvo.papel.codigo,
    ]),
    banco.consultar<{ permissao: string; concedida: boolean }>(
      'select permissao, concedida from usuario_permissoes where usuario_id = $1 order by permissao',
      [id],
    ),
  ]);
  const permissoesPapel = doPapel.linhas.map((linha) => linha.permissao);
  const concedidas = individuais.linhas.filter((linha) => linha.concedida).map((linha) => linha.permissao);
  const negadas = individuais.linhas.filter((linha) => !linha.concedida).map((linha) => linha.permissao);
  const efetivas = [...new Set([...permissoesPapel.filter((p) => !negadas.includes(p)), ...concedidas])].sort();
  return { papel: alvo.papel, permissoesPapel, concedidas, negadas, efetivas };
}

export async function salvarPermissoesUsuario(
  app: FastifyInstance,
  ator: Ator,
  id: string,
  dados: { papel: string; concedidas: string[]; negadas: string[] },
) {
  const { banco } = app;
  if (id === ator.usuario.id) throw conflito('Você não pode alterar as próprias permissões.');
  const alvo = await buscarUsuario(banco, id);
  await garantirPapel(banco, dados.papel);
  if (dados.papel !== 'admin') await protegerUltimoAdmin(banco, alvo, 'É preciso manter pelo menos um administrador ativo.');
  const { linhas: existentes } = await banco.consultar<{ codigo: string }>('select codigo from permissoes');
  const validas = new Set(existentes.map((linha) => linha.codigo));
  const invalidas = [...dados.concedidas, ...dados.negadas].filter((codigo) => !validas.has(codigo));
  if (invalidas.length) throw validacao(`Permissões desconhecidas: ${invalidas.join(', ')}`);
  const conflitantes = dados.concedidas.filter((codigo) => dados.negadas.includes(codigo));
  if (conflitantes.length) throw validacao(`Uma permissão não pode ser concedida e negada ao mesmo tempo: ${conflitantes.join(', ')}`);
  const { linhas: doPapel } = await banco.consultar<{ permissao: string }>('select permissao from papel_permissoes where papel = $1', [
    dados.papel,
  ]);
  const permissoesPapel = new Set(doPapel.map((linha) => linha.permissao));
  const concedidas = [...new Set(dados.concedidas)].filter((codigo) => !permissoesPapel.has(codigo));
  const negadas = [...new Set(dados.negadas)].filter((codigo) => permissoesPapel.has(codigo));
  await banco.transacao(async (tx) => {
    await tx.consultar('update usuarios set papel = $2, atualizado_em = now() where id = $1', [id, dados.papel]);
    await tx.consultar('delete from usuario_permissoes where usuario_id = $1', [id]);
    for (const codigo of concedidas) {
      await tx.consultar('insert into usuario_permissoes (usuario_id, permissao, concedida) values ($1, $2, true)', [id, codigo]);
    }
    for (const codigo of negadas) {
      await tx.consultar('insert into usuario_permissoes (usuario_id, permissao, concedida) values ($1, $2, false)', [id, codigo]);
    }
    await registrarAtividade(tx, {
      usuarioId: ator.usuario.id,
      acao: 'usuario.permissoes_alteradas',
      entidade: 'usuario',
      entidadeId: id,
      descricao: `alterou as permissões de ${alvo.nome}`,
      detalhes: { papel: dados.papel, concedidas, negadas },
      ip: ator.ip,
    });
  });
  return obterPermissoesUsuario(banco, id);
}

export async function acoesEmMassa(
  app: FastifyInstance,
  ator: Ator,
  dados: { ids: string[]; acao: 'bloquear' | 'desbloquear' | 'ativar' | 'excluir'; motivo?: string },
): Promise<{ afetados: number }> {
  const permissaoPorAcao = {
    bloquear: 'usuarios.bloquear',
    desbloquear: 'usuarios.bloquear',
    ativar: 'usuarios.editar',
    excluir: 'usuarios.excluir',
  } as const;
  const necessaria = permissaoPorAcao[dados.acao];
  if (!ator.usuario.permissoes.has(necessaria)) throw semPermissao(`Você precisa da permissão ${necessaria} para esta ação.`);
  let afetados = 0;
  for (const id of [...new Set(dados.ids)]) {
    if (id === ator.usuario.id) continue;
    try {
      if (dados.acao === 'bloquear') {
        const { usuario } = await bloquearUsuario(app, ator, id, dados.motivo?.trim() || 'Bloqueio em massa pelo painel');
        if (usuario.status === 'bloqueado') afetados += 1;
      } else if (dados.acao === 'desbloquear') {
        await desbloquearUsuario(app, ator, id);
        afetados += 1;
      } else if (dados.acao === 'ativar') {
        const alvo = await buscarUsuario(app.banco, id);
        if (alvo.status === 'pendente' || alvo.status === 'inativo') {
          await atualizarUsuario(app, ator, id, { status: 'ativo' });
          afetados += 1;
        }
      } else {
        await excluirUsuario(app, ator, id);
        afetados += 1;
      }
    } catch (erro) {
      const codigo = (erro as { codigo?: string }).codigo;
      if (codigo === 'NAO_ENCONTRADO' || codigo === 'CONFLITO' || codigo === 'SEM_PERMISSAO') continue;
      throw erro;
    }
  }
  return { afetados };
}

export async function linhasExportacaoUsuarios(banco: Banco, filtro: FiltroUsuarios): Promise<Record<string, unknown>[]> {
  const { onde, parametros } = montarFiltro(filtro, true);
  const { linhas } = await banco.consultar(`${SELECAO_USUARIO} ${onde} order by u.criado_em desc limit 50000`, parametros);
  return linhas.map((linha) => {
    const usuario = mapearUsuario(linha);
    return {
      nome: usuario.nome,
      email: usuario.email,
      papel: usuario.papel.nome,
      status: ROTULOS_STATUS_USUARIO[usuario.status],
      plano: usuario.plano?.nome ?? '',
      empresa: usuario.empresa ?? '',
      cargo: usuario.cargo ?? '',
      pais: usuario.pais ?? '',
      cidade: usuario.cidade ?? '',
      criadoEm: usuario.criadoEm,
      ultimoAcesso: usuario.ultimoAcesso,
    };
  });
}

export const ROTULOS_STATUS_USUARIO: Record<string, string> = {
  ativo: 'Ativo',
  bloqueado: 'Bloqueado',
  pendente: 'Pendente',
  inativo: 'Inativo',
};

export async function listarPapeis(banco: Banco) {
  const { linhas } = await banco.consultar<{
    codigo: string;
    nome: string;
    descricao: string;
    permissoes: string[] | null;
    usuarios: number;
  }>(
    `select p.codigo, p.nome, p.descricao,
            coalesce((select array_agg(pp.permissao order by pp.permissao) from papel_permissoes pp where pp.papel = p.codigo), '{}') as permissoes,
            (select count(*)::int from usuarios u where u.papel = p.codigo) as usuarios
       from papeis p
      order by p.nivel desc`,
  );
  return linhas.map((linha) => ({ ...linha, permissoes: linha.permissoes ?? [] }));
}

export async function listarPermissoes(banco: Banco) {
  const { linhas } = await banco.consultar<{ codigo: string; modulo: string; nome: string; descricao: string }>(
    'select codigo, modulo, nome, descricao from permissoes order by ordem, codigo',
  );
  return linhas;
}

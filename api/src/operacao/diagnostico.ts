import { accessSync, constants, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import bcrypt from 'bcryptjs';
import type { Banco } from '../banco/conexao.js';
import { listarMigracoes } from '../banco/migrar.js';
import { DADOS_EM_MEMORIA, segredoFraco, VERSAO, type Config } from '../config.js';
import { listarBackups } from './backup.js';
import { saudeDoMotor } from '../modulos/ciencia/motor.js';

export type StatusVerificacao = 'ok' | 'info' | 'aviso' | 'erro';

export interface Verificacao {
  id: string;
  grupo: 'Ambiente' | 'Configuração' | 'Banco de dados' | 'Segurança' | 'Operação';
  titulo: string;
  status: StatusVerificacao;
  detalhe: string;
  dica?: string;
}

export interface ResultadoDiagnostico {
  versao: string;
  geradoEm: string;
  resumo: Record<StatusVerificacao, number>;
  verificacoes: Verificacao[];
}

export const SENHA_DEMONSTRACAO = 'bento123';
const VERSAO_MINIMA_NODE = 22;
const cacheSenhas = new Map<string, boolean>();

export async function contasComSenhaDeDemonstracao(banco: Banco): Promise<string[]> {
  const { linhas } = await banco.consultar<{ email: string; senha_hash: string }>(
    `select u.email, u.senha_hash
       from usuarios u join papeis p on p.codigo = u.papel
      where p.acesso_painel and u.status = 'ativo' and u.senha_hash is not null and u.email like '%@bento.local'
      order by u.email
      limit 10`,
  );
  const encontradas: string[] = [];
  for (const linha of linhas) {
    let usaPadrao = cacheSenhas.get(linha.senha_hash);
    if (usaPadrao === undefined) {
      usaPadrao = await bcrypt.compare(SENHA_DEMONSTRACAO, linha.senha_hash);
      if (cacheSenhas.size > 200) cacheSenhas.clear();
      cacheSenhas.set(linha.senha_hash, usaPadrao);
    }
    if (usaPadrao) encontradas.push(linha.email);
  }
  return encontradas;
}

function gravavel(pasta: string): boolean {
  try {
    mkdirSync(pasta, { recursive: true });
    accessSync(pasta, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

const plural = (total: number, singular: string, pluralTexto: string) => `${total} ${total === 1 ? singular : pluralTexto}`;

export async function executarDiagnostico(config: Config, banco: Banco | null): Promise<ResultadoDiagnostico> {
  const verificacoes: Verificacao[] = [];
  const adicionar = (verificacao: Verificacao) => verificacoes.push(verificacao);

  const maior = Number(process.versions.node.split('.')[0]);
  adicionar({
    id: 'node',
    grupo: 'Ambiente',
    titulo: 'Node.js',
    status: maior >= VERSAO_MINIMA_NODE ? 'ok' : 'erro',
    detalhe: `Versão ${process.version} em ${process.platform} ${process.arch}.`,
    dica: maior >= VERSAO_MINIMA_NODE ? undefined : `Instale o Node.js ${VERSAO_MINIMA_NODE} ou mais novo.`,
  });

  adicionar({
    id: 'modo',
    grupo: 'Ambiente',
    titulo: 'Modo de execução',
    status: 'info',
    detalhe: config.producao ? 'Produção (NODE_ENV=production).' : 'Desenvolvimento.',
  });

  const temWeb = existsSync(path.join(config.dirWeb, 'index.html'));
  adicionar({
    id: 'interface',
    grupo: 'Ambiente',
    titulo: 'Interface web',
    status: temWeb ? 'ok' : 'aviso',
    detalhe: temWeb ? `Servida a partir de ${config.dirWeb}.` : 'A pasta da interface não foi encontrada; a API sobe sozinha.',
    dica: temWeb ? undefined : 'Rode "npm run build" para gerar web/dist.',
  });

  adicionar({
    id: 'variaveis',
    grupo: 'Configuração',
    titulo: 'Variáveis de ambiente',
    status: config.avisos.length ? 'aviso' : 'ok',
    detalhe: config.avisos.length ? config.avisos.join(' ') : 'Todas as variáveis definidas têm valores válidos.',
    dica: config.avisos.length ? 'Corrija o arquivo .env e reinicie o Bento.' : undefined,
  });

  const fraco = !config.segredoGerado && segredoFraco(config.segredoJwt);
  adicionar({
    id: 'segredo',
    grupo: 'Segurança',
    titulo: 'Segredo das sessões',
    status: fraco ? 'erro' : config.segredoGerado ? (config.producao ? 'aviso' : 'info') : 'ok',
    detalhe: fraco
      ? 'BENTO_SEGREDO_JWT é curto ou é o valor de exemplo.'
      : config.segredoGerado
        ? 'Gerado automaticamente em dados/segredo.'
        : 'Definido em BENTO_SEGREDO_JWT.',
    dica: fraco || config.segredoGerado ? 'Defina BENTO_SEGREDO_JWT com pelo menos 32 caracteres aleatórios.' : undefined,
  });

  adicionar({
    id: 'https',
    grupo: 'Segurança',
    titulo: 'HTTPS e cookies seguros',
    status: config.https ? 'ok' : config.producao ? 'aviso' : 'info',
    detalhe: config.https ? 'Cookies com a flag Secure e HSTS ativos.' : 'Cookies sem a flag Secure (BENTO_HTTPS=false).',
    dica: config.https ? undefined : 'Atrás de HTTPS, defina BENTO_HTTPS=true.',
  });

  adicionar({
    id: 'metricas',
    grupo: 'Operação',
    titulo: 'Métricas Prometheus',
    status: 'info',
    detalhe: config.metricasToken ? 'Ativas em /api/v1/metricas com token.' : 'Desligadas (defina BENTO_METRICAS_TOKEN para ativar).',
  });

  const motor = config.analise.url && config.analise.token ? await saudeDoMotor(config.analise) : null;
  adicionar({
    id: 'motor-analitico',
    grupo: 'Operação',
    titulo: 'Motor analítico (Python)',
    status: !config.analise.url ? 'info' : motor?.status === 'ok' ? 'ok' : 'aviso',
    detalhe: !config.analise.url
      ? 'Desligado: a página Inteligência fica indisponível.'
      : motor?.status === 'ok'
        ? `No ar em ${config.analise.url} (versão ${motor.versao}).`
        : `Sem resposta em ${config.analise.url}.`,
    dica: !config.analise.url
      ? 'Suba o serviço "analise" do docker-compose e defina BENTO_ANALISE_URL e BENTO_ANALISE_TOKEN.'
      : motor?.status === 'ok'
        ? undefined
        : 'Confira se o serviço está no ar e se BENTO_ANALISE_TOKEN é o mesmo nos dois lados.',
  });

  adicionar({
    id: 'simulador',
    grupo: 'Operação',
    titulo: 'Simulador de atividade',
    status: config.simulador && config.producao ? 'aviso' : 'info',
    detalhe: config.simulador ? `Ligado: cria transações de exemplo a cada ~${config.intervaloSimulador} s.` : 'Desligado.',
    dica: config.simulador && config.producao ? 'Em produção, defina BENTO_SIMULADOR=false.' : undefined,
  });

  const { retencao } = config;
  adicionar({
    id: 'retencao',
    grupo: 'Operação',
    titulo: 'Retenção de dados',
    status: 'info',
    detalhe: `Notificações ${retencao.notificacoesDias || 'sem limite'}${retencao.notificacoesDias ? ' dias' : ''}, relatórios ${retencao.relatoriosDias || 'sem limite'}${retencao.relatoriosDias ? ' dias' : ''}, auditoria ${retencao.auditoriaDias || 'sem limite'}${retencao.auditoriaDias ? ' dias' : ''}, sessões ${retencao.sessoesDias} dias, entregas ${retencao.entregasDias} dias e disparos de alertas ${retencao.alertasDias} dias.`,
  });

  if (config.backup.automatico !== 'desligado') {
    const pastaOk = gravavel(config.backup.pasta);
    const ultimo = pastaOk ? listarBackups(config.backup.pasta)[0] : undefined;
    const limiteHoras = config.backup.automatico === 'diario' ? 26 : 7 * 24 + 2;
    const atrasado = ultimo ? Date.now() - new Date(ultimo.criadoEm).getTime() > limiteHoras * 3_600_000 : false;
    adicionar({
      id: 'backup',
      grupo: 'Operação',
      titulo: 'Backup automático',
      status: !pastaOk ? 'erro' : atrasado ? 'aviso' : 'ok',
      detalhe: !pastaOk
        ? `Sem permissão de escrita em ${config.backup.pasta}.`
        : ultimo
          ? `${config.backup.automatico === 'diario' ? 'Diário' : 'Semanal'}, guardando ${config.backup.manter}. Último: ${ultimo.nome}.`
          : `${config.backup.automatico === 'diario' ? 'Diário' : 'Semanal'}, guardando ${config.backup.manter}. Nenhum feito ainda.`,
      dica: !pastaOk ? 'Ajuste BENTO_BACKUP_PASTA ou as permissões da pasta.' : atrasado ? 'Confira os logs do agendador.' : undefined,
    });
  } else {
    adicionar({
      id: 'backup',
      grupo: 'Operação',
      titulo: 'Backup automático',
      status: config.producao && !config.urlBanco ? 'aviso' : 'info',
      detalhe: 'Desligado.',
      dica: 'Defina BENTO_BACKUP_AUTOMATICO=diario ou rode "npm run backup".',
    });
  }

  if (!banco) {
    adicionar({ id: 'banco', grupo: 'Banco de dados', titulo: 'Conexão', status: 'erro', detalhe: 'Não foi possível abrir o banco.' });
    return finalizar(verificacoes);
  }

  try {
    const inicio = performance.now();
    await banco.consultar('select 1');
    const latencia = Math.round((performance.now() - inicio) * 10) / 10;
    const { linhas } = await banco.consultar<{ versao: string }>('select version() as versao');
    const versao = (linhas[0]?.versao ?? '').split(' ').slice(0, 2).join(' ');
    adicionar({
      id: 'banco',
      grupo: 'Banco de dados',
      titulo: 'Conexão',
      status: latencia > 250 ? 'aviso' : 'ok',
      detalhe: `${banco.tipo === 'postgresql' ? 'PostgreSQL' : config.dirDados === DADOS_EM_MEMORIA ? 'PGlite em memória' : 'PGlite embutido'} (${versao}), respondeu em ${latencia} ms.`,
      dica: latencia > 250 ? 'A latência está alta; confira a rede até o banco.' : undefined,
    });
  } catch (erro) {
    adicionar({
      id: 'banco',
      grupo: 'Banco de dados',
      titulo: 'Conexão',
      status: 'erro',
      detalhe: erro instanceof Error ? erro.message : String(erro),
      dica: 'Confira DATABASE_URL e se o PostgreSQL está no ar.',
    });
    return finalizar(verificacoes);
  }

  if (banco.tipo === 'pglite') {
    adicionar({
      id: 'banco-tipo',
      grupo: 'Banco de dados',
      titulo: 'Tipo de banco',
      status: config.producao ? 'aviso' : 'info',
      detalhe: config.dirDados === DADOS_EM_MEMORIA ? 'PGlite em memória: os dados somem ao reiniciar.' : `PGlite em ${config.dirDados}.`,
      dica: config.producao ? 'Para vários acessos simultâneos e backups do servidor, use PostgreSQL (DATABASE_URL).' : undefined,
    });
    if (config.dirDados !== DADOS_EM_MEMORIA) {
      const ok = gravavel(config.dirDados);
      adicionar({
        id: 'pasta-dados',
        grupo: 'Banco de dados',
        titulo: 'Pasta de dados',
        status: ok ? 'ok' : 'erro',
        detalhe: ok ? `Gravável: ${config.dirDados}.` : `Sem permissão de escrita em ${config.dirDados}.`,
      });
    }
  }

  const conhecidas = listarMigracoes().map((migracao) => migracao.nome);
  const aplicadas = await banco
    .consultar<{ nome: string }>('select nome from migracoes order by nome')
    .then((resultado) => resultado.linhas.map((linha) => linha.nome))
    .catch(() => [] as string[]);
  const pendentes = conhecidas.filter((nome) => !aplicadas.includes(nome));
  const desconhecidas = aplicadas.filter((nome) => !conhecidas.includes(nome));
  adicionar({
    id: 'migracoes',
    grupo: 'Banco de dados',
    titulo: 'Migrações',
    status: pendentes.length ? 'erro' : desconhecidas.length ? 'aviso' : 'ok',
    detalhe: pendentes.length
      ? `Pendentes: ${pendentes.join(', ')}.`
      : desconhecidas.length
        ? `O banco tem migrações que este código não conhece: ${desconhecidas.join(', ')}.`
        : `${plural(aplicadas.length, 'migração aplicada', 'migrações aplicadas')}, nenhuma pendente.`,
    dica: pendentes.length ? 'Rode "npm run migrar" ou reinicie o servidor.' : desconhecidas.length ? 'O banco foi atualizado por uma versão mais nova do Bento.' : undefined,
  });
  if (pendentes.length === conhecidas.length) return finalizar(verificacoes);

  const { linhas: admins } = await banco.consultar<{ total: number }>(
    `select count(*)::int as total from usuarios where papel = 'admin' and status = 'ativo'`,
  );
  const totalAdmins = admins[0]?.total ?? 0;
  adicionar({
    id: 'administradores',
    grupo: 'Segurança',
    titulo: 'Administradores',
    status: totalAdmins > 0 ? 'ok' : 'erro',
    detalhe: totalAdmins > 0 ? plural(totalAdmins, 'administrador ativo', 'administradores ativos') + '.' : 'Nenhum administrador ativo.',
    dica: totalAdmins > 0 ? undefined : 'Defina BENTO_ADMIN_EMAIL e BENTO_ADMIN_SENHA e rode "npm run admin".',
  });

  const { linhas: semDoisFatores } = await banco.consultar<{ total: number; obrigatorio: boolean }>(
    `select count(*) filter (where totp_ativado_em is null)::int as total,
            coalesce((select valor from configuracoes_sistema where chave = 'doisFatoresPapeis'), '[]'::jsonb) ? 'admin' as obrigatorio
       from usuarios where papel = 'admin' and status = 'ativo'`,
  );
  const adminsSemDoisFatores = semDoisFatores[0]?.total ?? 0;
  adicionar({
    id: 'dois-fatores',
    grupo: 'Segurança',
    titulo: 'Verificação em duas etapas',
    status: adminsSemDoisFatores === 0 ? 'ok' : semDoisFatores[0]?.obrigatorio ? 'info' : 'aviso',
    detalhe:
      adminsSemDoisFatores === 0
        ? 'Todos os administradores ativos usam o aplicativo autenticador.'
        : `${plural(adminsSemDoisFatores, 'administrador ainda entra', 'administradores ainda entram')} só com a senha.${semDoisFatores[0]?.obrigatorio ? ' A regra da empresa vai pedir a configuração no próximo acesso.' : ''}`,
    dica: adminsSemDoisFatores && !semDoisFatores[0]?.obrigatorio ? 'Exija a verificação para administradores em Configurações › Empresa.' : undefined,
  });

  const demonstracao = await contasComSenhaDeDemonstracao(banco);
  adicionar({
    id: 'senha-demonstracao',
    grupo: 'Segurança',
    titulo: 'Senhas de demonstração',
    status: demonstracao.length ? (config.producao ? 'erro' : 'aviso') : 'ok',
    detalhe: demonstracao.length
      ? `${plural(demonstracao.length, 'conta usa', 'contas usam')} a senha padrão ${SENHA_DEMONSTRACAO}: ${demonstracao.join(', ')}.`
      : 'Nenhuma conta da equipe usa a senha de demonstração.',
    dica: demonstracao.length ? 'Troque as senhas em Configurações › Segurança ou bloqueie essas contas.' : undefined,
  });

  const [integracoes, atrasados, entregas] = await Promise.all([
    banco.consultar<{ nome: string }>(`select nome from integracoes where ativo and status = 'erro' order by nome`),
    banco.consultar<{ total: number }>(
      `select count(*)::int as total from relatorios_agendados where ativo and proxima_execucao < now() - interval '10 minutes'`,
    ),
    banco
      .consultar<{ total: number }>(`select count(*)::int as total from entregas_integracao where status = 'falhou' and atualizado_em > now() - interval '24 hours'`)
      .catch(() => ({ linhas: [{ total: 0 }], total: 1 })),
  ]);
  adicionar({
    id: 'integracoes',
    grupo: 'Operação',
    titulo: 'Integrações',
    status: integracoes.linhas.length ? 'aviso' : 'ok',
    detalhe: integracoes.linhas.length
      ? `Com erro: ${integracoes.linhas.map((linha) => linha.nome).join(', ')}.${entregas.linhas[0]?.total ? ` ${plural(entregas.linhas[0].total, 'entrega falhou', 'entregas falharam')} nas últimas 24 horas.` : ''}`
      : 'Nenhuma integração ativa com erro.',
    dica: integracoes.linhas.length ? 'Abra Configurações › Integrações e veja o histórico de entregas.' : undefined,
  });
  const totalAtrasados = atrasados.linhas[0]?.total ?? 0;
  adicionar({
    id: 'agendador',
    grupo: 'Operação',
    titulo: 'Relatórios agendados',
    status: totalAtrasados ? 'aviso' : 'ok',
    detalhe: totalAtrasados ? `${plural(totalAtrasados, 'envio está atrasado', 'envios estão atrasados')} há mais de 10 minutos.` : 'Nenhum envio atrasado.',
    dica: totalAtrasados ? 'O agendador roda dentro do servidor; confira se ele está no ar e os logs.' : undefined,
  });

  return finalizar(verificacoes);
}

function finalizar(verificacoes: Verificacao[]): ResultadoDiagnostico {
  const resumo: Record<StatusVerificacao, number> = { ok: 0, info: 0, aviso: 0, erro: 0 };
  for (const verificacao of verificacoes) resumo[verificacao.status] += 1;
  return { versao: VERSAO, geradoEm: new Date().toISOString(), resumo, verificacoes };
}

const MARCAS: Record<StatusVerificacao, string> = { ok: '✓', info: 'i', aviso: '!', erro: '✗' };
const CORES: Record<StatusVerificacao, string> = { ok: '\x1b[32m', info: '\x1b[36m', aviso: '\x1b[33m', erro: '\x1b[31m' };

const ORDEM_GRUPOS: Verificacao['grupo'][] = ['Ambiente', 'Configuração', 'Banco de dados', 'Segurança', 'Operação'];

export function formatarDiagnostico(resultado: ResultadoDiagnostico, cores = true): string {
  const pintar = (status: StatusVerificacao, texto: string) => (cores ? `${CORES[status]}${texto}\x1b[0m` : texto);
  const linhas: string[] = [`Bento ${resultado.versao} · diagnóstico de ${new Date(resultado.geradoEm).toLocaleString('pt-BR')}`, ''];
  let grupoAtual = '';
  const ordenadas = [...resultado.verificacoes].sort((a, b) => ORDEM_GRUPOS.indexOf(a.grupo) - ORDEM_GRUPOS.indexOf(b.grupo));
  for (const verificacao of ordenadas) {
    if (verificacao.grupo !== grupoAtual) {
      if (grupoAtual) linhas.push('');
      grupoAtual = verificacao.grupo;
      linhas.push(verificacao.grupo.toUpperCase());
    }
    linhas.push(`  ${pintar(verificacao.status, MARCAS[verificacao.status])} ${verificacao.titulo}: ${verificacao.detalhe}`);
    if (verificacao.dica) linhas.push(`      → ${verificacao.dica}`);
  }
  const { ok, info, aviso, erro } = resultado.resumo;
  linhas.push('', `${ok} ok · ${info} informativas · ${aviso} avisos · ${erro} erros`);
  return linhas.join('\n');
}

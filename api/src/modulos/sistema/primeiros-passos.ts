import type { FastifyInstance } from 'fastify';
import { contasComSenhaDeDemonstracao } from '../../operacao/diagnostico.js';
import { listarBackups } from '../../operacao/backup.js';
import { obterConfigSistema } from '../comum/consultas.js';

export interface PassoInicial {
  id: string;
  titulo: string;
  texto: string;
  feito: boolean;
  href: string;
  acao: string;
}

export interface PrimeirosPassos {
  passos: PassoInicial[];
  feitos: number;
  total: number;
}

export async function primeirosPassos(app: FastifyInstance): Promise<PrimeirosPassos> {
  const { banco, config } = app;
  const [sistema, demonstracao, contagens] = await Promise.all([
    obterConfigSistema(banco),
    contasComSenhaDeDemonstracao(banco),
    banco.consultar<{ equipe: number; integracoes: number; agendamentos: number; chaves: number; doisFatores: number; alertas: number }>(
      `select
         (select count(*) from usuarios where papel = 'admin' and status = 'ativo' and totp_ativado_em is not null)::int as "doisFatores",
         (select count(*) from alertas_metricas where ativo)::int as alertas,
         (select count(*) from usuarios u join papeis p on p.codigo = u.papel where p.acesso_painel and u.status = 'ativo')::int as equipe,
         (select count(*) from integracoes where ativo)::int as integracoes,
         (select count(*) from relatorios_agendados where ativo)::int as agendamentos,
         (select count(*) from chaves_api where revogada_em is null)::int as chaves`,
    ),
  ]);
  const totais = contagens.linhas[0] ?? { equipe: 0, integracoes: 0, agendamentos: 0, chaves: 0, doisFatores: 0, alertas: 0 };
  const temBackup = config.backup.automatico !== 'desligado' || listarBackups(config.backup.pasta).length > 0;
  const passos: PassoInicial[] = [
    {
      id: 'empresa',
      titulo: 'Dados da empresa',
      texto: 'Nome, moeda, fuso e a meta mensal que aparece na visão geral.',
      feito: sistema.nomeEmpresa.trim().toLowerCase() !== 'bento',
      href: '/configuracoes?secao=sistema',
      acao: 'Abrir Empresa',
    },
    {
      id: 'senhas',
      titulo: 'Senhas de demonstração',
      texto: demonstracao.length
        ? `${demonstracao.length === 1 ? 'Uma conta ainda usa' : `${demonstracao.length} contas ainda usam`} a senha bento123.`
        : 'Nenhuma conta da equipe usa a senha de demonstração.',
      feito: demonstracao.length === 0,
      href: '/usuarios?papel=admin',
      acao: 'Revisar contas',
    },
    {
      id: 'dois-fatores',
      titulo: 'Verificação em duas etapas',
      texto: 'Proteja as contas de administrador com o código de um aplicativo autenticador.',
      feito: totais.doisFatores > 0,
      href: '/configuracoes?secao=seguranca',
      acao: 'Ativar',
    },
    {
      id: 'equipe',
      titulo: 'Equipe cadastrada',
      texto: 'Convide quem vai usar o painel, um a um ou importando uma planilha CSV.',
      feito: totais.equipe > 1,
      href: '/usuarios?novo=1',
      acao: 'Cadastrar',
    },
    {
      id: 'integracao',
      titulo: 'Uma integração ativa',
      texto: 'Receba transações e cadastros no Slack, no Discord ou no seu webhook.',
      feito: totais.integracoes > 0,
      href: '/configuracoes?secao=integracoes',
      acao: 'Conectar',
    },
    {
      id: 'relatorio',
      titulo: 'Um relatório agendado',
      texto: 'Receba receita, transações ou crescimento todo dia, semana ou mês.',
      feito: totais.agendamentos > 0,
      href: '/relatorios',
      acao: 'Agendar',
    },
    {
      id: 'alerta',
      titulo: 'Um alerta de métrica',
      texto: 'Seja avisado quando a receita cair ou a taxa de falha dos pagamentos subir.',
      feito: totais.alertas > 0,
      href: '/alertas?novo=1',
      acao: 'Criar alerta',
    },
    {
      id: 'backup',
      titulo: 'Backups',
      texto: 'Ative o backup automático ou grave o primeiro backup manualmente.',
      feito: temBackup,
      href: '/configuracoes?secao=status',
      acao: 'Ver status',
    },
  ];
  const feitos = passos.filter((passo) => passo.feito).length;
  return { passos, feitos, total: passos.length };
}

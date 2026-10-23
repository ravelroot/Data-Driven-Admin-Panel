export interface ItemNavegacao {
  id: string;
  rotulo: string;
  icone: string;
  href: string;
  permissao?: string;
  contador?: string;
  externo?: boolean;
  descricao: string;
}

export interface GrupoNavegacao {
  grupo: string;
  itens: ItemNavegacao[];
}

export interface AcaoRapida {
  id: string;
  rotulo: string;
  icone: string;
  href?: string;
  acao?: string;
  permissao?: string;
  externo?: boolean;
  atalho?: string;
}

export const NAVEGACAO: GrupoNavegacao[] = [
  {
    grupo: "Painel",
    itens: [
      { id: "visao-geral", rotulo: "Visão geral", icone: "painel", href: "/", permissao: "painel.ver", descricao: "KPIs de receita, usuários e assinaturas" },
      { id: "analytics", rotulo: "Analytics", icone: "grafico-linha", href: "/analytics", permissao: "analytics.ver", descricao: "Gráficos com filtros por período" },
    ],
  },
  {
    grupo: "Gestão",
    itens: [
      { id: "usuarios", rotulo: "Usuários", icone: "usuarios", href: "/usuarios", permissao: "usuarios.ver", descricao: "Cadastro, bloqueio e permissões" },
      { id: "transacoes", rotulo: "Transações", icone: "recibo", href: "/transacoes", permissao: "transacoes.ver", descricao: "Pagamentos, filtros e reembolsos" },
      { id: "notificacoes", rotulo: "Notificações", icone: "sino", href: "/notificacoes", contador: "notificacoes", descricao: "Alertas e atividades recentes" },
      { id: "relatorios", rotulo: "Relatórios", icone: "arquivo-grafico", href: "/relatorios", permissao: "relatorios.ver", descricao: "Exportação em CSV e PDF" },
    ],
  },
  {
    grupo: "Conta",
    itens: [
      { id: "auditoria", rotulo: "Auditoria", icone: "historico", href: "/auditoria", permissao: "auditoria.ver", descricao: "Registro de atividades da equipe" },
      { id: "configuracoes", rotulo: "Configurações", icone: "configuracoes", href: "/configuracoes", descricao: "Perfil, aparência, segurança e integrações" },
      { id: "componentes", rotulo: "Componentes", icone: "camadas", href: "/componentes", descricao: "Biblioteca de componentes em Tailwind CSS" },
      { id: "documentacao", rotulo: "Documentação da API", icone: "livro", href: "/api/v1/docs", externo: true, descricao: "Rotas da API com exemplos" },
    ],
  },
];

export const ACOES_RAPIDAS: AcaoRapida[] = [
  { id: "novo-usuario", rotulo: "Cadastrar usuário", icone: "usuario-novo", href: "/usuarios?novo=1", permissao: "usuarios.criar" },
  { id: "gerar-relatorio", rotulo: "Gerar relatório", icone: "arquivo-baixar", href: "/relatorios", permissao: "relatorios.gerar" },
  { id: "exportar-transacoes", rotulo: "Exportar transações em CSV", icone: "arquivo-baixar", href: "/api/v1/transacoes/exportar", permissao: "transacoes.ver", externo: true },
  { id: "enviar-aviso", rotulo: "Enviar aviso para a equipe", icone: "sino", href: "/notificacoes?novo=1", permissao: "notificacoes.enviar" },
  { id: "status-sistema", rotulo: "Ver status do sistema", icone: "atividade", href: "/configuracoes?secao=status", permissao: "configuracoes.sistema" },
  { id: "alternar-tema", rotulo: "Alternar tema claro/escuro", icone: "contraste", acao: "alternar-tema" },
  { id: "aparencia", rotulo: "Ajustar aparência", icone: "paleta", href: "/configuracoes?secao=aparencia" },
  { id: "atalhos", rotulo: "Ver atalhos de teclado", icone: "comando", acao: "atalhos", atalho: "?" },
  { id: "documentacao-api", rotulo: "Abrir a documentação da API", icone: "livro", href: "/api/v1/docs", externo: true },
  { id: "sair", rotulo: "Sair da conta", icone: "sair", acao: "sair" },
];

/** Atalhos "g" + tecla: a tecla e o id da página em NAVEGACAO que ela abre. */
export const IR_PARA: Record<string, string> = {
  v: "visao-geral",
  a: "analytics",
  u: "usuarios",
  t: "transacoes",
  n: "notificacoes",
  r: "relatorios",
  d: "auditoria",
  c: "configuracoes",
  k: "componentes",
};

export const paginaPorId = (id: string): ItemNavegacao | undefined => NAVEGACAO.flatMap((grupo) => grupo.itens).find((item) => item.id === id);

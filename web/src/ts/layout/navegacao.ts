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
      { id: "notificacoes", rotulo: "Notificações", icone: "sino", href: "/notificacoes", contador: "notificacoes", descricao: "Alertas e atividades recentes" },
      { id: "relatorios", rotulo: "Relatórios", icone: "arquivo-grafico", href: "/relatorios", permissao: "relatorios.ver", descricao: "Exportação em CSV e PDF" },
    ],
  },
  {
    grupo: "Conta",
    itens: [
      { id: "configuracoes", rotulo: "Configurações", icone: "configuracoes", href: "/configuracoes", descricao: "Perfil, aparência, segurança e integrações" },
      { id: "componentes", rotulo: "Componentes", icone: "camadas", href: "/componentes", descricao: "Biblioteca de componentes em Tailwind CSS" },
      { id: "documentacao", rotulo: "Documentação da API", icone: "livro", href: "/api/v1/docs", externo: true, descricao: "Rotas da API com exemplos" },
    ],
  },
];

export const ACOES_RAPIDAS: AcaoRapida[] = [
  { id: "novo-usuario", rotulo: "Cadastrar usuário", icone: "usuario-novo", href: "/usuarios?novo=1", permissao: "usuarios.criar" },
  { id: "gerar-relatorio", rotulo: "Gerar relatório", icone: "arquivo-baixar", href: "/relatorios", permissao: "relatorios.gerar" },
  { id: "alternar-tema", rotulo: "Alternar tema claro/escuro", icone: "contraste", acao: "alternar-tema" },
  { id: "aparencia", rotulo: "Ajustar aparência", icone: "paleta", href: "/configuracoes?secao=aparencia" },
  { id: "sair", rotulo: "Sair da conta", icone: "sair", acao: "sair" },
];

export const paginaPorId = (id: string): ItemNavegacao | undefined => NAVEGACAO.flatMap((grupo) => grupo.itens).find((item) => item.id === id);

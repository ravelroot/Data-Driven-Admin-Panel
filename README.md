<p align="center">
  <img src="docs/images/logo.png" width="160" alt="Bento">
</p>

<h1 align="center">Bento<br><sub><sup><sup><sub>Copyright (©) 2026 Erik Pimenta</sub></sup></sup></sub></h1>

<p align="center">
  Painel administrativo para SaaS montado em bento grid: cada bloco mostra uma parte do negócio, da receita e dos usuários às assinaturas e ao crescimento. Modo escuro nativo, gráficos interativos, tabelas com ordenação, busca e paginação, gavetas laterais, transações com reembolso, trilha de auditoria, paleta de comandos com atalhos de teclado, status do sistema, notificações em tempo real e relatórios em CSV e PDF, com uma API completa e testada por trás.<br>
  Pronto para usar, estudar ou adaptar.
</p>

<p align="center">
  TypeScript · Tailwind CSS 4 · HTML5 · ApexCharts · Node.js 22 · Fastify 5 · Zod · PostgreSQL 18 · PGlite · PDFKit · Vite · Docker Compose · Node Test Runner
</p>

---

> **Manual completo:** [`Manual-Bento.pdf`](Manual-Bento.pdf) explica a instalação, cada módulo do painel, a biblioteca de componentes em Tailwind CSS, os temas e paletas, a API rota por rota, as permissões, o tempo real, os relatórios, a configuração e a solução de problemas, passo a passo (cópia em [`docs/`](docs/Manual-Bento.pdf)).

> **Banco de dados:** [`Banco-de-Dados-Bento.pdf`](Banco-de-Dados-Bento.pdf) traz o diagrama de relacionamentos, todas as tabelas com campos, tipos, chaves e restrições, os índices, as decisões de arquitetura (PostgreSQL ou PGlite, LISTEN/NOTIFY, sessões, auditoria) e como escalar (cópia em [`docs/`](docs/Banco-de-Dados-Bento.pdf)).

<p align="center">
  <img src="docs/images/tela-visao-geral.png" alt="Visão geral: a receita do período na tampa escura e os indicadores nos compartimentos da caixa">
</p>

## O que o Bento faz

- **Identidade "caixa única":** um bento é uma caixa só, dividida em compartimentos. Em cada página, os blocos dividem paredes finas dentro de uma única caixa de cantos arredondados, e o menu, o cabeçalho e os títulos ficam impressos no fundo, sem bordas. Títulos e números em Bricolage Grotesque fina e condensada, rótulos em texto normal, status como um ponto de cor e variações com + e −. Fica tudo em `web/src/css/identidade.css`.
- **Bento grid:** a grade de 12 colunas encaixa cartões de tamanhos diferentes (um quarto, um terço, metade, dois terços, cartões altos e pilhas) e se reorganiza no tablet e no celular. Há modelos prontos para vendas, produto, suporte, financeiro e marketing.
- **Menu lateral e cabeçalho:** o menu recolhe para só ícones em telas grandes e vira gaveta no celular. O cabeçalho tem trilha de navegação, busca global (`Ctrl` + `K` ou `/`), indicador de conexão ao vivo, troca de tema, central de notificações e menu da conta.
- **Visão geral:** receita do período em destaque com gráfico, MRR, ticket médio, conversão, usuários e assinaturas ativas, crescimento, cancelamentos e meta do mês. Cada KPI traz o sinal + ou − e o percentual em relação ao período anterior, em verde ou vermelho, e um mini gráfico. Transações e cadastros novos entram na tela na hora.
- **Analytics:** filtros por intervalo de datas, períodos prontos e agrupamento por dia, semana ou mês. Receita e reembolsos, funil de conversão, dispositivos, tráfego por canal, países, usuários novos e ativos, assinaturas e cancelamentos, receita por plano, mapa de calor de horários de compra e retenção por coorte.
- **Transações:** busca por código, cliente ou e-mail, filtros por status, método, tipo e período (que ficam na URL para compartilhar), resumo do filtro, gaveta com a linha do tempo de cada cobrança, **reembolso com motivo** registrado na auditoria e exportação em CSV.
- **Auditoria:** a trilha de tudo o que a equipe fez (contas, transações, sessões, relatórios, configurações, integrações e chaves de API), com filtros por pessoa, tipo de ação, período e texto, detalhes de cada registro e exportação em CSV.
- **Paleta de comandos e atalhos:** `Ctrl` + `K` abre busca e comandos (ir para páginas, cadastrar usuário, exportar transações, enviar aviso, ver o status do sistema, alternar tema, sair). `?` mostra a folha de atalhos e `g` seguido de uma letra navega (`g` `t` abre Transações, `g` `d` abre Auditoria).
- **Usuários:** cadastro, edição, busca instantânea, filtros por status, papel e plano, colunas ordenáveis, paginação, ações em massa, bloqueio e desbloqueio com motivo, senha temporária, exportação em CSV e controle de permissões por papel com exceções por pessoa.
- **Notificações:** alertas em tempo real via Server-Sent Events sobre transações, contas, segurança e relatórios, com filtros, marcar como lida, dispensar, preferências por categoria e envio de avisos para a equipe.
- **Relatórios:** receita, transações, usuários, assinaturas e crescimento, com prévia antes de gerar, exportação em CSV (pronto para Excel) ou PDF paginado, histórico para baixar de novo e envios agendados diários, semanais ou mensais.
- **Configurações:** perfil, aparência (tema claro, escuro ou do sistema, 16 paletas e densidade), troca de senha, sessões ativas, chaves de API com escopo, integrações com webhook, Slack e Discord, dados da empresa (moeda, fuso e meta mensal) e **status do sistema** (versão, banco e latência, tempo no ar, memória, conexões em tempo real, volume das tabelas e migrações aplicadas).
- **Componentes:** uma página com toda a biblioteca em Tailwind CSS, de botões e formulários a kanban, calendário, fatura, preços, página de status, construtor de filtros e páginas de erro, para copiar e adaptar.

<p align="center">
  <img src="docs/images/tela-escuro.png" width="49%" alt="Visão geral no tema escuro">
  <img src="docs/images/tela-analytics.png" width="49%" alt="Analytics com filtros de período, funil e dispositivos">
</p>

## Arquitetura

```mermaid
flowchart LR
    UI["Navegador<br/>TypeScript + Tailwind CSS"] -- "HTTP / JSON<br/>cookie de sessão + X-Bento" --> API["api<br/>Node.js 22 + Fastify 5<br/>TypeScript"]
    API -- "Server-Sent Events" --> UI
    API --> BD[("PostgreSQL 18<br/>ou PGlite embutido")]
    API -- "webhooks assinados" --> EXT["Slack, Discord<br/>ou seu endpoint"]
    API -- "CSV / PDF" --> REL["Relatórios"]
```

| Parte | Linguagem | Responsabilidade |
|---|---|---|
| `web/src/ts` | TypeScript | Tipos da API, cliente HTTP, sessão, tema com `localStorage`, tempo real, tabela de dados, gráficos, gavetas, diálogos, busca global e o controlador de cada página |
| `web/src/css` | Tailwind CSS | Tokens de cor, tipografia e medidas, 16 paletas, modo escuro com a variante `dark:`, layout bento, componentes, kit de interface, páginas e impressão |
| `web/*.html` | HTML | Estrutura de cada página: visão geral, analytics, usuários, notificações, relatórios, configurações, componentes e entrada |
| `api/src` | TypeScript | API REST com Fastify: autenticação, permissões, métricas, analytics, usuários, notificações, relatórios, agendador, simulador e integrações |
| `api/migracoes` | SQL | Esquema, índices e dados de base (papéis, permissões e planos) |
| `postgres` | — | Fonte da verdade. Sem `DATABASE_URL`, o PGlite roda o mesmo PostgreSQL embutido, sem instalar nada |

### Como o tempo real funciona

O navegador abre uma conexão em `GET /api/v1/notificacoes/fluxo` e recebe os eventos `notificacao`, `contagem`, `transacao` e `usuario`. Com PostgreSQL, a API publica cada evento no canal `bento_eventos` com `LISTEN/NOTIFY`, então várias instâncias atrás de um balanceador entregam o mesmo evento. Com PGlite, os eventos passam por um emissor em memória. Se a conexão cair, o painel reconecta sozinho e mostra o estado no cabeçalho.

### Como as permissões funcionam

| Papel | O que pode |
|---|---|
| Administrador | Tudo |
| Gerente | Tudo, menos dados da empresa, status do sistema, excluir usuários e alterar permissões |
| Analista | Visão geral, analytics, ver transações, ver usuários e relatórios |
| Suporte | Visão geral, ver, editar e bloquear usuários, ver transações |
| Cliente | Não acessa o painel |

As permissões efetivas de cada pessoa são as do papel, mais as concedidas e menos as negadas na aba **Permissões** do usuário. A API confere tudo de novo em cada rota.

<p align="center">
  <img src="docs/images/tela-transacoes.png" width="49%" alt="Transações com o resumo do filtro, os filtros por status, método, tipo e período e a lista">
  <img src="docs/images/tela-auditoria.png" width="49%" alt="Trilha de auditoria com filtros por pessoa, ação e período">
</p>

<p align="center">
  <img src="docs/images/tela-usuarios.png" width="49%" alt="Lista de usuários com filtros por status, papel e plano">
  <img src="docs/images/tela-relatorios.png" width="49%" alt="Relatórios com prévia, histórico e envios agendados">
</p>

## Como rodar

### Com Docker (painel + API + PostgreSQL)

Você só precisa do **Docker** com Docker Compose.

**Windows:** dê dois cliques em `iniciar.cmd`.

**Linux ou macOS:**

```bash
./iniciar.sh
```

Na primeira vez o script cria o arquivo `.env` com uma senha aleatória para o banco e um segredo aleatório para as sessões, sobe o PostgreSQL e o Bento e abre **http://localhost:8080**. Sem Docker, os mesmos scripts usam o Node.js e o banco embutido.

| Endereço | O que é |
|---|---|
| http://localhost:8080 | Painel |
| http://localhost:8080/api/v1/docs | Documentação interativa da API |
| http://localhost:8080/api/v1/saude | Saúde da API e do banco |

Contas de demonstração (senha `bento123`): `admin@bento.local`, `gerente@bento.local`, `analista@bento.local` e `suporte@bento.local`.

### Sem Docker (Node.js 22+)

```bash
git clone https://github.com/ravelroot/Data-Driven-Admin-Panel.git
cd Data-Driven-Admin-Panel
npm install
npm run build
npm start                         # http://localhost:8080
```

Sem `DATABASE_URL`, a API usa o PGlite, que guarda o banco na pasta `dados/`. Na primeira vez ela cria as tabelas e os dados de demonstração em poucos segundos. Para usar o seu PostgreSQL, defina `DATABASE_URL=postgres://usuario:senha@servidor:5432/banco`.

### Começando sem os dados de demonstração

Para usar o Bento com os seus próprios dados, comece com um banco vazio e defina no `.env`:

```bash
BENTO_SEMEAR=nao
BENTO_SIMULADOR=false
BENTO_ADMIN_EMAIL=voce@suaempresa.com
BENTO_ADMIN_SENHA=uma-senha-com-8-ou-mais-caracteres
BENTO_ADMIN_NOME=Seu Nome
```

Na inicialização, a API cria essa conta de administrador se o e-mail ainda não existir. Depois de entrar, cadastre a equipe em **Usuários** e apague as três variáveis `BENTO_ADMIN_*` do `.env`. Em desenvolvimento, `npm run admin` faz o mesmo sem subir o servidor.

### Desenvolvimento

```bash
npm run dev                       # API em :8080 e Vite em http://localhost:5173
```

O Vite recarrega a página a cada mudança no TypeScript, no Tailwind CSS ou no HTML, e encaminha `/api` para a API, que reinicia sozinha quando o TypeScript muda.

<p align="center">
  <img src="docs/images/tela-atalhos.png" width="49%" alt="Folha de atalhos de teclado aberta com a tecla ?">
  <img src="docs/images/tela-sistema.png" width="49%" alt="Status do sistema com banco, processo, tempo real, tabelas e migrações">
</p>

<p align="center">
  <img src="docs/images/tela-componentes.png" width="49%" alt="Biblioteca de componentes em Tailwind CSS">
  <img src="docs/images/tela-configuracoes.png" width="49%" alt="Aparência com tema e 16 paletas">
</p>

## Usando a API

```bash
# entrar e guardar o cookie de sessão
curl -c sessao.txt -H "Content-Type: application/json" \
     -d '{"email":"admin@bento.local","senha":"bento123"}' http://localhost:8080/api/v1/auth/entrar

# KPIs dos últimos 30 dias
curl -b sessao.txt "http://localhost:8080/api/v1/visao-geral?periodo=30d"

# usuários bloqueados, em ordem alfabética
curl -b sessao.txt "http://localhost:8080/api/v1/usuarios?status=bloqueado&ordenar=nome&direcao=asc"

# com uma chave de API criada em Configurações › Chaves de API
curl -H "Authorization: Bearer bnt_SUA_CHAVE" "http://localhost:8080/api/v1/transacoes?status=paga&porPagina=50"
```

| Rota | O que faz |
|---|---|
| `POST /api/v1/auth/entrar` · `sair` · `renovar` · `GET eu` | Sessão com cookie httpOnly, renovação e dados da conta |
| `GET /api/v1/visao-geral` | KPIs com tendência, receita mês a mês, planos, canais, meta, transações e atividades |
| `GET /api/v1/analytics` | Séries por dia, semana ou mês, funil, dispositivos, países, coortes e mapa de calor |
| `GET /api/v1/transacoes` · `/{id}` · `/exportar` | Lista com filtros, ordenação e paginação, detalhes e CSV |
| `GET/POST /api/v1/usuarios` · `GET/PATCH/DELETE /{id}` | Lista, cadastro, edição e exclusão |
| `POST /api/v1/usuarios/{id}/bloquear` · `desbloquear` · `redefinir-senha` | Bloqueio com motivo e senha temporária |
| `GET/PUT /api/v1/usuarios/{id}/permissoes` · `GET /papeis` · `GET /permissoes` | Papel e exceções de cada pessoa |
| `POST /api/v1/usuarios/acoes-em-massa` · `GET /usuarios/exportar` | Ações em várias contas e CSV |
| `GET /api/v1/notificacoes` · `/contagem` · `/fluxo` | Lista, contagem e fluxo em tempo real |
| `POST /api/v1/notificacoes` · `/{id}/ler` · `/ler-todas` · `GET/PUT /preferencias` | Avisos, leitura e preferências |
| `GET /api/v1/relatorios/tipos` · `/previa` · `GET/POST /relatorios` · `/{id}/baixar` | Tipos, prévia, geração e download em CSV ou PDF |
| `GET/POST /api/v1/relatorios/agendados` · `PATCH/DELETE /{id}` | Envios automáticos |
| `GET/PATCH /api/v1/configuracoes/perfil` · `GET/PUT /aparencia` · `GET/PUT /sistema` | Perfil, aparência e dados da empresa |
| `POST /api/v1/configuracoes/seguranca/senha` · `GET/DELETE /seguranca/sessoes` | Senha e sessões |
| `GET/POST/DELETE /api/v1/configuracoes/chaves-api` | Chaves de API com escopo de leitura ou escrita |
| `GET/PATCH /api/v1/integracoes` · `POST /{id}/testar` | Webhook, Slack, Discord, Google Analytics e Stripe |
| `GET /api/v1/transacoes/resumo` · `POST /{id}/reembolsar` | Resumo do filtro (pagas, reembolsadas, taxa de falha) e reembolso de uma transação paga, com motivo |
| `GET /api/v1/atividades` · `/exportar` · `/pessoas` | Trilha de auditoria com filtros por pessoa, ação, período e texto, CSV e a equipe para o filtro |
| `GET /api/v1/sistema/status` | Versão, banco, processo, tempo real, volume das tabelas e migrações |
| `GET /api/v1/busca` | Busca global |

Pedidos que alteram dados com o cookie de sessão precisam do cabeçalho `X-Bento: 1` (o painel cuida disso). Chaves de API dispensam o cabeçalho. Todas as rotas, com exemplos e esquemas, estão em `/api/v1/docs`.

## Configuração

As principais variáveis do `.env` (a lista completa está no manual):

| Variável | Padrão | O que faz |
|---|---|---|
| `BENTO_PORTA` | `8080` | Porta no navegador |
| `DATABASE_URL` | vazio | PostgreSQL. Vazio usa o PGlite embutido em `dados/pglite` |
| `BENTO_SEGREDO_JWT` | gerado | Assina as sessões. Gerado pelos scripts; nunca publique o seu |
| `BENTO_HTTPS` | `false` | Cookies seguros e HSTS atrás de HTTPS |
| `BENTO_ORIGENS` | vazio | Outras origens autorizadas a chamar a API (CORS) |
| `BENTO_PROXY` | `false` | Confiar no IP repassado por um proxy reverso |
| `BENTO_SEMEAR` | `auto` | `nao` desliga os dados de demonstração em banco vazio |
| `BENTO_SIMULADOR` | `true` | Gera transações e cadastros de exemplo para o tempo real |
| `BENTO_FUSO` | `America/Sao_Paulo` | Fuso das agregações e do agendador |
| `BENTO_ADMIN_EMAIL` / `BENTO_ADMIN_SENHA` / `BENTO_ADMIN_NOME` | vazio | Cria a primeira conta de administrador ao iniciar, se o e-mail ainda não existir |
| `BENTO_INTEGRACOES_REDE_INTERNA` | vazio | `1` libera webhooks para endereços da rede interna (bloqueados por padrão contra SSRF) |
| `BENTO_DB_NOME` / `BENTO_DB_USUARIO` / `BENTO_DB_SENHA` | `bento` / `bento` / — | PostgreSQL do Docker Compose |

<p align="center">
  <img src="docs/images/tela-notificacoes.png" width="49%" alt="Notificações em tempo real com filtros e preferências">
  <img src="docs/images/tela-escuro-analytics.png" width="49%" alt="Mapa de calor e retenção por coorte no tema escuro">
</p>

## Personalizando o Bento

O projeto foi organizado para ser fácil de adaptar:

| Quero... | Onde mexer |
|---|---|
| Trocar as cores padrão | `web/src/css/tema/cores.css` (escalas `primaria`, `destaque` e `neutra`) |
| Criar uma paleta nova | Um bloco `[data-paleta="nome"]` em `web/src/css/tema/paletas.css` e o nome em `PALETAS` (`web/src/ts/nucleo/tema.ts`) e na validação da API |
| Mudar fontes, tamanhos e raios | `web/src/css/tema/tipografia.css` e `web/src/css/tema/medidas.css` |
| Mudar a identidade visual | `web/src/css/identidade.css` (materiais da caixa: fundo, compartimentos, paredes e tampa, raios, tipografia fina, status e variações) |
| Novo item no menu | `NAVEGACAO` em `web/src/ts/layout/navegacao.ts` |
| Novo comando na paleta | `ACOES_RAPIDAS` em `web/src/ts/layout/navegacao.ts` |
| Novo atalho de teclado | `IR_PARA` em `web/src/ts/layout/atalhos.ts` |
| Novo cartão na visão geral | Marcação em `web/index.html` com as classes `.bento-*` e o preenchimento em `web/src/ts/paginas/visao-geral.ts` |
| Nova coluna na tabela de usuários | `COLUNAS` em `web/src/ts/paginas/usuarios.ts` e o campo de ordenação em `api/src/modulos/usuarios` |
| Novo tipo de relatório | `api/src/modulos/relatorios` (colunas, consulta e resumo) |
| Nova permissão | `api/migracoes` (tabela `permissoes` e `papel_permissoes`) e o `pode("...")` na interface |
| Novo componente | Um arquivo em `web/src/css/kit/`, o `@import` em `web/src/css/bento.css` e uma seção em `web/componentes.html` |

## Desenvolvimento e testes

```bash
npm test                          # 58 testes da API e 13 da interface
npm run verificar                 # checagem de tipos (strict) da interface e da API
npm run build                     # gera web/dist e api/dist
```

### Segurança e qualidade

A versão 1.1.0 passou por uma auditoria de segurança, com 20 testes automatizados em `api/test/seguranca.test.ts`. O que foi corrigido:

| Gravidade | O que era | Como ficou |
|---|---|---|
| Crítica | O papel Suporte podia redefinir a senha do administrador e entrar como ele | Quem não controla permissões só altera contas de nível menor que o seu (editar, senha, bloqueio, exclusão e ações em massa) |
| Alta | Webhooks aceitavam qualquer endereço (SSRF) | Localhost, IPs internos, metadados de nuvem e redes privadas são recusados ao salvar e ao enviar, sem seguir redirecionamentos |
| Média | Textos começando com `=`, `+`, `-` ou `@` viravam fórmula no Excel | As células de texto do CSV são neutralizadas |
| Média | Qualquer analista apagava relatórios e agendamentos de outras pessoas | Só o autor ou quem configura o sistema |
| Baixa | O bloqueio por tentativas revelava quais e-mails existiam | E-mails inexistentes recebem a mesma resposta e o mesmo bloqueio |
| Baixa | Links de avisos e o `?voltar=` do login aceitavam outro domínio | Só caminhos internos |

Os testes também conferem sessão obrigatória, JWT forjado, permissões por papel, proteção CSRF (`X-Bento`), chaves de API só leitura, 11 tentativas de injeção SQL, cookies `httpOnly` e `SameSite`, cabeçalhos de segurança (CSP, `nosniff`, `X-Frame-Options`, `Referrer-Policy`), rate limit, mass assignment, IDOR e path traversal. O `npm audit` não aponta nenhuma vulnerabilidade.

O GitHub Actions roda os testes, checa os tipos, constrói a interface, sobe a API contra um PostgreSQL de verdade e constrói a imagem Docker a cada push.

### Estrutura

```text
web/                        interface
  *.html                    uma página por módulo
  src/css/                  Tailwind CSS: tema, base, layout, componentes, kit, páginas
  src/ts/nucleo/            tipos, API, sessão, tema, tempo real, formatação, ícones
  src/ts/componentes/       tabela, gráficos, gavetas, diálogos, avisos, formulários
  src/ts/layout/            menu, cabeçalho, paleta de comandos, atalhos e início das páginas
  src/ts/paginas/           controlador de cada página
  public/                   favicon, logo e script de tema
  tests/                    testes do núcleo e da navegação
api/                        API em TypeScript
  src/modulos/              auth, visão geral, analytics, usuários, transações, auditoria, notificações, relatórios, configurações, integrações, sistema
  src/banco/                conexão (PostgreSQL ou PGlite), migrações e dados de demonstração
  src/relatorios/           geração de CSV e PDF
  migracoes/                esquema do banco
  test/                     testes da API, de segurança, de transações e de auditoria
scripts/                    servidor de desenvolvimento e criação do .env no Windows
docs/                       manuais em PDF e imagens do README
.github/workflows/          CI
```

### Componentes de terceiros

O Bento depende de componentes com licenças próprias, que continuam valendo para cada um deles:

| Componente | Uso no projeto | Licença |
|---|---|---|
| [Tailwind CSS](https://tailwindcss.com/) | Estilos e componentes | MIT |
| [Vite](https://vite.dev/) | Servidor de desenvolvimento e build | MIT |
| [ApexCharts](https://apexcharts.com/) 4.7 | Gráficos interativos | MIT |
| [Lucide](https://lucide.dev/) | Ícones | ISC |
| [Instrument Sans](https://fonts.google.com/specimen/Instrument+Sans), [Bricolage Grotesque](https://fonts.google.com/specimen/Bricolage+Grotesque) e [IBM Plex Mono](https://www.ibm.com/plex/) via [Fontsource](https://fontsource.org/) | Tipografia | OFL-1.1 |
| [Fastify](https://fastify.dev/) e plugins oficiais | Servidor da API | MIT |
| [Zod](https://zod.dev/) | Validação | MIT |
| [node-postgres](https://node-postgres.com/) | Driver do PostgreSQL | MIT |
| [PGlite](https://pglite.dev/) | PostgreSQL embutido | Apache-2.0 |
| [bcrypt.js](https://github.com/dcodeIO/bcrypt.js) | Hash de senhas | BSD-3-Clause |
| [PDFKit](https://pdfkit.org/) | Relatórios em PDF | MIT |

O ApexCharts está fixado na versão 4.7.0, a última publicada sob a licença MIT. As versões a partir da 5.1 usam uma licença dupla que exige compra para empresas com receita anual acima de US$ 2 milhões; confira antes de atualizar. O PostgreSQL roda como serviço externo via Docker e não é redistribuído neste repositório. Os nomes Slack, Discord, Google Analytics e Stripe pertencem aos seus donos e aparecem só como destinos de integração.

## Licença

Copyright (©) 2026 Erik Pimenta

Este projeto é distribuído sob a licença [MIT](LICENSE). Você pode usar, copiar, modificar e redistribuir o código, inclusive para fins comerciais, desde que mantenha o aviso de copyright e o texto da licença.

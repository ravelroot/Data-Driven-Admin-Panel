<p align="center">
  <img src="docs/images/logo.png" width="160" alt="Bento">
</p>

<h1 align="center">Bento<br><sub><sup><sup><sub>Copyright (©) 2026 Erik Pimenta</sub></sup></sup></sub></h1>

<p align="center">
  Painel administrativo para SaaS montado em bento grid: cada bloco mostra uma parte do negócio, da receita e dos usuários às assinaturas e ao crescimento. Modo escuro nativo, visão geral personalizável, previsão da receita do mês, insights automáticos sobre o que saiu do padrão, alertas de métricas, verificação em duas etapas, gráficos interativos, tabelas com colunas configuráveis, gavetas laterais, transações com reembolso, trilha de auditoria, paleta de comandos com itens recentes, preferências por pessoa, importação de usuários por CSV, notificações em tempo real, relatórios em CSV e PDF, integrações com histórico de entregas e ferramentas de operação (diagnóstico, modo de manutenção, backups, retenção de dados, sondas de saúde e métricas), com uma API completa e testada por trás.<br>
  Pronto para usar, estudar ou adaptar.
</p>

<p align="center">
  TypeScript · Tailwind CSS 4 · HTML5 · ApexCharts · TOTP (RFC 6238) · Node.js 22 · Fastify 5 · Zod · PostgreSQL 18 · PGlite · PDFKit · Vite · Docker Compose · Prometheus · Node Test Runner · GitHub Actions
</p>

---

> **Manual completo:** [`Manual-Bento.pdf`](Manual-Bento.pdf) explica a instalação, cada módulo do painel, a verificação em duas etapas, os alertas de métricas, a previsão e os insights, a personalização da visão geral, as preferências, a biblioteca de componentes em Tailwind CSS, os temas e paletas, a API rota por rota, as permissões, o tempo real, os relatórios, as integrações, a configuração, a operação e manutenção (diagnóstico, modo de manutenção, backups, retenção, saúde e métricas) e a solução de problemas, passo a passo (cópia em [`docs/`](docs/Manual-Bento.pdf)).

> **Banco de dados:** [`Banco-de-Dados-Bento.pdf`](Banco-de-Dados-Bento.pdf) traz o diagrama de relacionamentos, todas as tabelas com campos, tipos, chaves e restrições, os índices, as decisões de arquitetura (PostgreSQL ou PGlite, LISTEN/NOTIFY, sessões, segundo fator, fila de entregas, avaliação de alertas, backup lógico), os fluxos de dados, a operação e como escalar (cópia em [`docs/`](docs/Banco-de-Dados-Bento.pdf)).

<p align="center">
  <img src="docs/images/tela-visao-geral.png" alt="Visão geral: a receita do período na tampa escura e os indicadores nos compartimentos da caixa">
</p>

## O que o Bento faz

- **Identidade "caixa única":** um bento é uma caixa só, dividida em compartimentos. Em cada página, os blocos dividem paredes finas dentro de uma única caixa de cantos arredondados, e o menu, o cabeçalho e os títulos ficam impressos no fundo, sem bordas. Títulos e números em Bricolage Grotesque fina e condensada, rótulos em texto normal, status como um ponto de cor e variações com + e −. Fica tudo em `web/src/css/identidade.css`.
- **Bento grid:** a grade de 12 colunas encaixa cartões de tamanhos diferentes (um quarto, um terço, metade, dois terços, cartões altos e pilhas) e se reorganiza no tablet e no celular. Há modelos prontos para vendas, produto, suporte, financeiro e marketing.
- **Menu lateral e cabeçalho:** o menu recolhe para só ícones em telas grandes e vira gaveta no celular. O cabeçalho tem trilha de navegação, busca global (`Ctrl` + `K` ou `/`), indicador de conexão ao vivo, troca de tema, central de notificações e menu da conta. Durante o modo de manutenção, uma faixa ao vivo avisa toda a equipe.
- **Visão geral:** receita do período em destaque com gráfico, MRR, ticket médio, conversão, usuários e assinaturas ativas, crescimento, cancelamentos e meta do mês. Cada KPI traz o sinal + ou − e o percentual em relação ao período anterior, em verde ou vermelho, e um mini gráfico. Transações e cadastros novos entram na tela na hora.
- **Visão geral personalizável:** o botão **Personalizar** deixa esconder, arrastar e redimensionar cada cartão (largura de um quarto até a tela inteira e altura normal ou alta), com setas do teclado na alça para quem não usa mouse e quatro layouts prontos (Financeiro, Crescimento, Operação do dia e Enxuto). O layout fica salvo na conta e vale em qualquer navegador.
- **Previsão do mês:** projeta a receita até o último dia do mês com a média dos últimos 28 dias ajustada pelo dia da semana, mostra a faixa provável (80%), a chance de bater a meta, o ritmo atual por dia, quanto falta por dia para a meta e o MRR esperado em 90 dias.
- **Insights automáticos:** compara cada um dos últimos 7 dias com as 4 semanas anteriores (mediana e desvio absoluto, corrigidos pelo dia da semana) e aponta receita, pagamentos, falhas, reembolsos, cadastros, visitantes e conversão fora do padrão, com atalho para ver o dia e criar um alerta. Destaques como a receita da semana, o dia que mais vende, o canal que mais converte e o plano em alta completam o cartão.
- **Alertas de métricas:** regras como "taxa de falha acima de 8% nas últimas 24 horas" ou "receita da semana cai mais de 15%" são medidas a cada 5 minutos. Ao disparar, avisam a equipe nas notificações (categoria própria) e, se marcado, no Slack, no Discord ou no webhook (`alerta.disparado`). Têm prévia com o valor de agora, cinco modelos prontos, gravidade, silêncio contra avisos repetidos, pausa, teste na hora e histórico de disparos.
- **Verificação em duas etapas:** cada pessoa ativa o código de um aplicativo autenticador (TOTP) com QR code, recebe dez códigos de recuperação de uso único e pode gerar novos. O login pede o código depois da senha, com bloqueio após tentativas erradas. Administradores podem exigir a verificação por papel e redefinir a de quem perdeu o celular.
- **Primeiros passos:** para administradores, um guia no topo da visão geral mostra o que falta para o painel ficar pronto (dados da empresa, senhas de demonstração, verificação em duas etapas, equipe, integração, relatório agendado, alerta de métrica e backups), com a barra de progresso e um botão para cada passo.
- **Analytics:** filtros por intervalo de datas, períodos prontos e agrupamento por dia, semana ou mês. Receita e reembolsos, funil de conversão, dispositivos, tráfego por canal, países, usuários novos e ativos, assinaturas e cancelamentos, receita por plano, mapa de calor de horários de compra e retenção por coorte.
- **Transações:** busca por código, cliente ou e-mail, filtros por status, método, tipo e período (que ficam na URL para compartilhar), resumo do filtro, gaveta com a linha do tempo de cada cobrança, **reembolso com motivo** registrado na auditoria e exportação em CSV.
- **Visões salvas:** em Transações e Auditoria, a combinação atual de filtros, busca e ordenação vira um atalho com nome (até 12 por página). Um clique reaplica a visão, a ativa fica destacada e dá para removê-la ali mesmo. Fica guardado por pessoa no navegador.
- **Auditoria:** a trilha de tudo o que a equipe fez (contas, transações, sessões, relatórios, configurações, integrações e chaves de API), com filtros por pessoa, tipo de ação, período e texto, detalhes de cada registro e exportação em CSV.
- **Paleta de comandos e atalhos:** `Ctrl` + `K` abre busca e comandos (ir para páginas, cadastrar ou importar usuários, exportar transações, enviar aviso, abrir a manutenção, ver as novidades, alternar tema, sair). Com o campo vazio, o grupo **Abertos recentemente** traz os últimos usuários e transações abertos. `?` mostra a folha de atalhos e `g` seguido de uma letra navega (`g` `t` abre Transações, `g` `d` abre Auditoria); os atalhos de uma tecla podem ser desligados.
- **Usuários:** cadastro, edição, busca instantânea, filtros por status, papel e plano (também pela URL), colunas ordenáveis e configuráveis, paginação, ações em massa, bloqueio e desbloqueio com motivo, senha temporária, exportação em CSV e controle de permissões por papel com exceções por pessoa.
- **Importação por CSV:** a gaveta **Importar CSV** lê planilhas de até 2.000 contas (vírgula, ponto e vírgula ou tabulação, UTF-8 ou ANSI do Excel), mostra a prévia linha a linha com o que será criado, ignorado ou tem erro, e grava tudo de uma vez. Tem modelo para baixar e permissão própria (`usuarios.importar`).
- **Notas internas:** cada usuário tem a aba **Notas** na gaveta, com o contador no título. A equipe registra combinados e contexto de atendimento (até 2.000 caracteres, com quebras de linha), fixa as importantes no topo, edita e remove as próprias. `Ctrl` + `Enter` salva. Só o autor ou quem controla permissões altera uma nota, e cada nota criada ou removida entra na auditoria.
- **Notificações:** alertas em tempo real via Server-Sent Events sobre transações, contas, segurança e relatórios, com filtros, marcar como lida, dispensar, preferências por categoria e envio de avisos para a equipe.
- **Relatórios:** receita, transações, usuários, assinaturas e crescimento, com prévia antes de gerar, exportação em CSV (pronto para Excel) ou PDF paginado, histórico para baixar de novo e envios agendados diários, semanais ou mensais.
- **Configurações:** perfil, aparência (tema claro, escuro ou do sistema, 16 paletas e densidade), **preferências** (página inicial, linhas por página, animações reduzidas, atalhos de uma tecla e primeiros passos), troca de senha, sessões ativas, chaves de API com escopo, integrações com webhook, Slack e Discord e o **histórico de entregas** (código HTTP, tempo, tentativas, novas tentativas automáticas e reenvio), dados da empresa (moeda, fuso e meta mensal), **status do sistema** e a aba **Manutenção**.
- **Operação e manutenção:** verificações do ambiente, modo de manutenção somente leitura com mensagem para a equipe, backups manuais e automáticos com download, retenção de dados com prévia e limpeza, sondas `/saude/vivo` e `/saude/pronto`, métricas do Prometheus e `X-Request-Id` em toda resposta, com o código curto do erro nas mensagens da interface.
- **Componentes:** uma página com toda a biblioteca em Tailwind CSS, de botões e formulários a kanban, calendário, fatura, preços, página de status, construtor de filtros, páginas de erro e os componentes de operação, para copiar e adaptar. Endereços inexistentes abrem uma página 404 própria, e a janela de novidades mostra o que mudou a cada versão.

<p align="center">
  <img src="docs/images/tela-previsao.png" width="49%" alt="Previsão da receita do mês com faixa provável e insights automáticos">
  <img src="docs/images/tela-personalizar.png" width="49%" alt="Personalização da visão geral: cartões com alça, tamanho e ocultar">
</p>

<p align="center">
  <img src="docs/images/tela-alertas.png" width="49%" alt="Alertas de métricas com regras, estado e histórico de disparos">
  <img src="docs/images/tela-alerta-novo.png" width="49%" alt="Nova regra de alerta com a prévia do valor de agora">
</p>

<p align="center">
  <img src="docs/images/tela-dois-fatores.png" width="49%" alt="Ativação da verificação em duas etapas com QR code">
  <img src="docs/images/tela-entrar-dois-fatores.png" width="49%" alt="Segunda etapa do login com o código do aplicativo">
</p>

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
    API -- "webhooks assinados<br/>com novas tentativas" --> EXT["Slack, Discord<br/>ou seu endpoint"]
    API -- "CSV / PDF" --> REL["Relatórios"]
    API -- "NDJSON.gz" --> BKP["Backups"]
    AG["Agendador<br/>alertas a cada 5 min"] --> API
    APP["Aplicativo autenticador<br/>TOTP"] -. "código de 6 dígitos" .-> UI
    PROM["Prometheus"] -- "/api/v1/metricas" --> API
```

| Parte | Linguagem | Responsabilidade |
|---|---|---|
| `web/src/ts` | TypeScript | Tipos da API, cliente HTTP, sessão e preferências, tema com `localStorage`, tempo real, tabela de dados com colunas configuráveis, bento grid personalizável, gráficos, gavetas, diálogos, QR code e verificação em duas etapas, importação, busca global com recentes, faixa de manutenção, novidades e o controlador de cada página |
| `web/src/css` | Tailwind CSS | Tokens de cor, tipografia e medidas, 16 paletas, modo escuro com a variante `dark:`, layout bento, componentes, kit de interface, páginas e impressão |
| `web/*.html` | HTML | Estrutura de cada página: visão geral, analytics, alertas, usuários, transações, auditoria, notificações, relatórios, configurações, componentes, entrada e 404 |
| `api/src` | TypeScript | API REST com Fastify: autenticação com segundo fator, permissões, métricas, previsão e insights, alertas, analytics, usuários, importação, notificações, relatórios, agendador, simulador e integrações com fila de entregas |
| `api/src/operacao` | TypeScript | Backup e restauração, diagnóstico, modo de manutenção, métricas do Prometheus e retenção de dados |
| `api/src/cli.ts` | TypeScript | Comandos `migrar`, `semear`, `admin`, `diagnostico`, `backup`, `restaurar` e `limpar` |
| `api/migracoes` | SQL | Esquema, índices, dados de base (papéis, permissões e planos) e as migrações de cada versão (001 a 007) |
| `postgres` | — | Fonte da verdade. Sem `DATABASE_URL`, o PGlite roda o mesmo PostgreSQL embutido, sem instalar nada |

### Como o tempo real funciona

O navegador abre uma conexão em `GET /api/v1/notificacoes/fluxo` e recebe os eventos `notificacao`, `contagem`, `transacao`, `usuario` e `sistema` (modo de manutenção). Com PostgreSQL, a API publica cada evento no canal `bento_eventos` com `LISTEN/NOTIFY`, então várias instâncias atrás de um balanceador entregam o mesmo evento. Com PGlite, os eventos passam por um emissor em memória. Se a conexão cair, o painel reconecta sozinho e mostra o estado no cabeçalho.

### Como as permissões funcionam

| Papel | O que pode |
|---|---|
| Administrador | Tudo, inclusive a aba Manutenção (diagnóstico, modo de manutenção, backups e retenção) e a regra de verificação em duas etapas por papel |
| Gerente | Tudo, menos dados da empresa, status do sistema, manutenção, excluir usuários e alterar permissões (importa, anota e cria alertas, mas só altera as próprias notas) |
| Analista | Visão geral, analytics, alertas (ver e gerenciar), ver transações, ver usuários e relatórios |
| Suporte | Visão geral, ver, editar, bloquear e anotar em usuários, ver transações |
| Cliente | Não acessa o painel |

As permissões efetivas de cada pessoa são as do papel, mais as concedidas e menos as negadas na aba **Permissões** do usuário. A API confere tudo de novo em cada rota. Quando a empresa exige a verificação em duas etapas para um papel, quem ainda não ativou só alcança a própria conta (perfil, preferências e Segurança) até configurar o aplicativo; a API responde `403` com o código `DOIS_FATORES` nas demais rotas.

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
| http://localhost:8080/api/v1/saude/pronto | Sonda de prontidão (banco no ar e migrações em dia) |

Contas de demonstração (senha `bento123`): `admin@bento.local`, `gerente@bento.local`, `analista@bento.local` e `suporte@bento.local`.

### Sem Docker (Node.js 22+)

```bash
git clone https://github.com/ravelroot/Data-Driven-Admin-Panel.git
cd Data-Driven-Admin-Panel
npm install
npm run build
npm start                         # http://localhost:8080
```

Sem `DATABASE_URL`, a API usa o PGlite, que guarda o banco na pasta `dados/pglite`. O `.nvmrc` indica o Node.js 22 para o nvm e o fnm. Na primeira vez ela cria as tabelas e os dados de demonstração em poucos segundos. Para usar o seu PostgreSQL, defina `DATABASE_URL=postgres://usuario:senha@servidor:5432/banco`.

### Começando sem os dados de demonstração

Para usar o Bento com os seus próprios dados, comece com um banco vazio e defina no `.env`:

```bash
BENTO_SEMEAR=nao
BENTO_SIMULADOR=false
BENTO_ADMIN_EMAIL=voce@suaempresa.com
BENTO_ADMIN_SENHA=uma-senha-com-8-ou-mais-caracteres
BENTO_ADMIN_NOME=Seu Nome
```

Na inicialização, a API cria essa conta de administrador se o e-mail ainda não existir. Depois de entrar, siga o guia **Primeiros passos** da visão geral, cadastre a equipe em **Usuários** (uma a uma ou com **Importar CSV**) e apague as três variáveis `BENTO_ADMIN_*` do `.env`. Em desenvolvimento, `npm run admin` faz o mesmo sem subir o servidor.

### Atualizando uma instalação

```bash
npm run backup                    # antes de tudo (com PGlite, com o servidor parado)
git pull
npm install && npm run build
npm start                         # aplica a migração 007 sozinho, em uma transação
npm run diagnostico               # confere ambiente, banco e segurança
```

Com Docker: `docker compose exec bento node api/dist/cli.js backup` e depois `docker compose up -d --build`.

### Desenvolvimento

```bash
npm run dev                       # API em :8080 e Vite em http://localhost:5173
```

O Vite recarrega a página a cada mudança no TypeScript, no Tailwind CSS ou no HTML, e encaminha `/api` para a API, que reinicia sozinha quando o TypeScript muda.

<p align="center">
  <img src="docs/images/tela-primeiros-passos.png" width="49%" alt="Guia de primeiros passos no topo da visão geral">
  <img src="docs/images/tela-preferencias.png" width="49%" alt="Preferências: página inicial, linhas por página, animações, atalhos e primeiros passos">
</p>

<p align="center">
  <img src="docs/images/tela-importacao.png" width="49%" alt="Prévia da importação de usuários por CSV">
  <img src="docs/images/tela-colunas.png" width="49%" alt="Menu de colunas configuráveis na tabela de transações">
</p>

<p align="center">
  <img src="docs/images/tela-recentes.png" width="49%" alt="Paleta de comandos com os itens abertos recentemente">
  <img src="docs/images/tela-atalhos.png" width="49%" alt="Folha de atalhos de teclado aberta com a tecla ?">
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

# login com verificação em duas etapas: a senha devolve {"doisFatores": true} e um cookie curto de desafio
curl -c sessao.txt -b sessao.txt -H "Content-Type: application/json" -H "X-Bento: 1" \
     -d '{"codigo":"123456"}' http://localhost:8080/api/v1/auth/dois-fatores

# previsão do mês, tendência do MRR, anomalias e destaques
curl -b sessao.txt http://localhost:8080/api/v1/insights

# alerta: taxa de falha acima de 8% nas últimas 24 horas, avisando também nas integrações
curl -b sessao.txt -H "X-Bento: 1" -H "Content-Type: application/json" \
     -d '{"nome":"Pagamentos falhando","metrica":"taxa_falha","janela":"24h","modo":"valor","operador":"maior","limite":8,"severidade":"erro","notificarIntegracoes":true}' \
     http://localhost:8080/api/v1/alertas

# ligar o modo de manutenção (somente leitura) com uma mensagem para a equipe
curl -b sessao.txt -X PUT -H "X-Bento: 1" -H "Content-Type: application/json" \
     -d '{"ativo":true,"mensagem":"Atualização até as 22h."}' http://localhost:8080/api/v1/sistema/manutencao
```

| Rota | O que faz |
|---|---|
| `POST /api/v1/auth/entrar` · `sair` · `renovar` · `GET eu` | Sessão com cookie httpOnly, renovação e dados da conta (com o estado da verificação em duas etapas) |
| `POST /api/v1/auth/dois-fatores` | Segunda etapa do login com o código do aplicativo ou um código de recuperação |
| `GET /api/v1/configuracoes/seguranca/dois-fatores` · `POST /iniciar` · `/ativar` · `/desativar` · `/codigos` | Estado, QR code, ativação, desligamento e novos códigos de recuperação |
| `GET /api/v1/insights` | Previsão da receita do mês, tendência do MRR, anomalias dos últimos 7 dias e destaques |
| `GET/POST /api/v1/alertas` · `GET/PATCH/DELETE /{id}` · `POST /{id}/avaliar` | Regras de alerta: lista com resumo, criação, edição, pausa, exclusão e avaliação na hora |
| `GET /api/v1/alertas/catalogo` · `POST /simular` · `GET /disparos` | Métricas e janelas, prévia de uma regra e histórico de disparos |
| `GET /api/v1/visao-geral` | KPIs com tendência, receita mês a mês, planos, canais, meta, transações e atividades |
| `GET /api/v1/analytics` | Séries por dia, semana ou mês, funil, dispositivos, países, coortes e mapa de calor |
| `GET /api/v1/transacoes` · `/{id}` · `/exportar` | Lista com filtros, ordenação e paginação, detalhes e CSV |
| `GET/POST /api/v1/usuarios` · `GET/PATCH/DELETE /{id}` | Lista, cadastro, edição e exclusão |
| `POST /api/v1/usuarios/{id}/bloquear` · `desbloquear` · `redefinir-senha` · `redefinir-dois-fatores` | Bloqueio com motivo, senha temporária e remoção do aplicativo autenticador de quem perdeu o acesso |
| `GET/PUT /api/v1/usuarios/{id}/permissoes` · `GET /papeis` · `GET /permissoes` | Papel e exceções de cada pessoa |
| `POST /api/v1/usuarios/acoes-em-massa` · `GET /usuarios/exportar` | Ações em várias contas e CSV |
| `POST /api/v1/usuarios/importar` · `GET /usuarios/importar/modelo` | Importação por CSV (com `simular: true`, só a prévia) e planilha de exemplo |
| `GET/POST /api/v1/usuarios/{id}/notas` · `PATCH/DELETE /{nota}` | Notas internas da conta: lista com as fixadas primeiro, criação, edição, fixar e remoção |
| `GET /api/v1/notificacoes` · `/contagem` · `/fluxo` | Lista, contagem e fluxo em tempo real |
| `POST /api/v1/notificacoes` · `/{id}/ler` · `/ler-todas` · `GET/PUT /preferencias` | Avisos, leitura e preferências |
| `GET /api/v1/relatorios/tipos` · `/previa` · `GET/POST /relatorios` · `/{id}/baixar` | Tipos, prévia, geração e download em CSV ou PDF |
| `GET/POST /api/v1/relatorios/agendados` · `PATCH/DELETE /{id}` | Envios automáticos |
| `GET/PATCH /api/v1/configuracoes/perfil` · `GET/PUT /preferencias` · `GET/PUT /sistema` | Perfil, aparência, preferências de uso e layout da visão geral (também em `/aparencia`), dados da empresa e papéis com verificação em duas etapas obrigatória |
| `POST /api/v1/configuracoes/seguranca/senha` · `GET/DELETE /seguranca/sessoes` | Senha e sessões |
| `GET/POST/DELETE /api/v1/configuracoes/chaves-api` | Chaves de API com escopo de leitura ou escrita |
| `GET/PATCH /api/v1/integracoes` · `POST /{id}/testar` | Webhook, Slack, Discord, Google Analytics e Stripe |
| `GET /api/v1/integracoes/{id}/entregas` · `POST /{id}/entregas/{entrega}/reenviar` | Histórico de entregas com status, código HTTP e tentativas, e reenvio |
| `GET /api/v1/transacoes/resumo` · `POST /{id}/reembolsar` | Resumo do filtro (pagas, reembolsadas, taxa de falha) e reembolso de uma transação paga, com motivo |
| `GET /api/v1/atividades` · `/exportar` · `/pessoas` | Trilha de auditoria com filtros por pessoa, ação, período e texto, CSV e a equipe para o filtro |
| `GET /api/v1/sistema/status` · `/diagnostico` · `/primeiros-passos` | Status do servidor, verificações do ambiente e guia de primeiros passos |
| `GET/PUT /api/v1/sistema/manutencao` | Estado do modo de manutenção; liga ou desliga |
| `GET/POST /api/v1/sistema/backups` · `GET /backups/{nome}` | Lista, grava e baixa backups |
| `GET/POST /api/v1/sistema/limpeza` | Prévia e aplicação da retenção de dados |
| `GET /api/v1/saude` · `/saude/vivo` · `/saude/pronto` | Saúde, sonda de vida e sonda de prontidão |
| `GET /api/v1/metricas` | Métricas do Prometheus, com `Authorization: Bearer` e o valor de `BENTO_METRICAS_TOKEN` |
| `GET /api/v1/busca` | Busca global |

Pedidos que alteram dados com o cookie de sessão precisam do cabeçalho `X-Bento: 1` (o painel cuida disso). Chaves de API dispensam o cabeçalho. Toda resposta traz `X-Request-Id`, e erros 500 devolvem o mesmo identificador em `erro.requisicao`, para achar a linha no log. Durante o modo de manutenção, alterações respondem 503 com o código `MANUTENCAO`. Todas as rotas, com exemplos e esquemas, estão em `/api/v1/docs`.

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
| `BENTO_METRICAS_TOKEN` | vazio | Liga `/api/v1/metricas` e define o token exigido pelo Prometheus |
| `BENTO_BACKUP_AUTOMATICO` | `desligado` | `diario` ou `semanal` (o `.env.example` e o Docker Compose já usam `diario`) |
| `BENTO_BACKUP_MANTER` / `BENTO_BACKUP_PASTA` | `7` / `dados/backups` | Quantos backups automáticos guardar e onde |
| `BENTO_RETENCAO_NOTIFICACOES` / `_RELATORIOS` / `_AUDITORIA` | `180` / `90` / `0` | Dias que cada tipo de registro fica guardado (`0` guarda para sempre) |
| `BENTO_RETENCAO_SESSOES` / `_ENTREGAS` | `30` / `30` | Dias para sessões encerradas e histórico de entregas das integrações |
| `BENTO_RETENCAO_ALERTAS` | `180` | Dias que os disparos já resolvidos dos alertas ficam guardados |
| `BENTO_DB_NOME` / `BENTO_DB_USUARIO` / `BENTO_DB_SENHA` | `bento` / `bento` / — | PostgreSQL do Docker Compose |

Cada variável é conferida na inicialização: valores inválidos viram avisos com o nome da variável (no log, no diagnóstico e na aba Manutenção) e o padrão é usado. Com `NODE_ENV=production`, padrão da imagem Docker, a API não sobe com o segredo de exemplo ou com menos de 32 caracteres. O `BENTO_SEGREDO_JWT` também cifra (AES-256-GCM) os segredos dos aplicativos autenticadores e das integrações: trocar o segredo obriga a redefinir a verificação em duas etapas da equipe e a reconfigurar as integrações.

## Operação e manutenção

| Comando | O que faz |
|---|---|
| `npm run diagnostico` | Confere Node.js, configuração, banco, migrações, segurança, backups, integrações e agendamentos (`-- --json` para scripts; sai com código 1 se houver erro) |
| `npm run backup` | Grava um backup completo em `.ndjson.gz` (`-- --pasta <pasta>` para outro lugar) |
| `npm run restaurar -- <arquivo>` | Substitui todos os dados pelos do backup, em uma transação (`--sim` para não perguntar) |
| `npm run limpar` | Aplica a retenção de dados agora (`-- --simular` só mostra o que sairia) |
| `npm run versao -- 1.6.0` | Grava a versão em `VERSION`, nos `package.json` e no `package-lock.json` (`-- --conferir` só confere) |

No Docker, os mesmos comandos rodam com `docker compose exec bento node api/dist/cli.js <comando>`. A aba **Configurações › Manutenção** reúne as verificações, o modo de manutenção, os backups com download e a retenção de dados, sem precisar de terminal.

- **Modo de manutenção:** deixa o painel em somente leitura em todas as instâncias ao mesmo tempo. A faixa avisa a equipe, a API recusa alterações com 503 e os relatórios agendados esperam; login, notificações e preferências continuam funcionando.
- **Backups:** lógicos e portáveis entre PGlite e PostgreSQL, lidos em uma transação consistente. Com `BENTO_BACKUP_AUTOMATICO`, o agendador grava e poda os automáticos sozinho.
- **Retenção:** uma vez por dia, sessões, notificações, relatórios e entregas antigas saem do banco, cada limpeza registrada na auditoria.
- **Saúde e métricas:** `/saude/vivo` e `/saude/pronto` para orquestradores (a imagem Docker usa a prontidão), encerramento gracioso em `SIGTERM` e métricas do Prometheus com requisições por rota, tempo de resposta, sessões, manutenção, agendamentos atrasados e entregas com falha.

<p align="center">
  <img src="docs/images/tela-manutencao.png" width="49%" alt="Aba Manutenção com verificações, modo de manutenção e backups">
  <img src="docs/images/tela-entregas.png" width="49%" alt="Histórico de entregas de uma integração">
</p>

<p align="center">
  <img src="docs/images/tela-faixa-manutencao.png" width="49%" alt="Faixa de manutenção na página de transações">
  <img src="docs/images/tela-sistema.png" width="49%" alt="Status do sistema com banco, processo, tempo real, tabelas e migrações">
</p>

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
| Novo item no menu | `NAVEGACAO` em `web/src/ts/layout/navegacao.ts` (e `PAGINAS` em `api/src/estatico.ts` e `paginas` em `web/vite.config.ts` para a rota) |
| Novo comando na paleta | `ACOES_RAPIDAS` em `web/src/ts/layout/navegacao.ts` |
| Novo atalho de teclado | `IR_PARA` em `web/src/ts/layout/atalhos.ts` |
| Visões salvas em outra página | `iniciarVisoesSalvas` (`web/src/ts/componentes/visoes-salvas.ts`) no `aoIniciar` da página, com `visoes.atualizar()` depois de sincronizar a URL |
| Novo cartão na visão geral | Marcação em `web/index.html` com as classes `.bento-*` e `data-cartao`, o preenchimento e a entrada em `CARTOES` (tamanhos permitidos) em `web/src/ts/paginas/visao-geral.ts` |
| Novo layout pronto | `MODELOS_LAYOUT` em `web/src/ts/paginas/visao-geral.ts` |
| Bento personalizável em outra página | `BentoPersonalizavel` (`web/src/ts/componentes/bento-personalizavel.ts`) com as definições dos cartões e onde salvar |
| Nova métrica para alertas | `CATALOGO_METRICAS` e `medirMetrica` em `api/src/modulos/alertas/metricas.ts` e a lista do `check` em uma migração nova |
| Novo modelo de alerta | `MODELOS` em `web/src/ts/paginas/alertas.ts` |
| Nova série nos insights | `SERIES` em `api/src/modulos/insights/servico.ts` (com volume mínimo, se for taxa) |
| Nova coluna na tabela de usuários | `COLUNAS` em `web/src/ts/paginas/usuarios.ts` (com `fixa` ou `escondidaPorPadrao`, se quiser) e o campo de ordenação em `api/src/modulos/usuarios` |
| Colunas configuráveis em outra tabela | A opção `idColunas` da `TabelaDados` (`web/src/ts/componentes/tabela.ts`) |
| Rota liberada durante a manutenção | `ISENTAS` em `api/src/operacao/manutencao.ts` |
| Nova verificação no diagnóstico | `api/src/operacao/diagnostico.ts` |
| Novidades de uma versão nova | `VERSAO_NOVIDADES` e `NOVIDADES` em `web/src/ts/layout/novidades.ts` |
| Novo tipo de relatório | `api/src/modulos/relatorios` (colunas, consulta e resumo) |
| Nova permissão | `api/migracoes` (tabela `permissoes` e `papel_permissoes`) e o `pode("...")` na interface |
| Novo componente | Um arquivo em `web/src/css/kit/`, o `@import` em `web/src/css/bento.css` e uma seção em `web/componentes.html` |

## Desenvolvimento e testes

```bash
npm test                          # 107 testes da API e 28 da interface
npm run cobertura                 # testes da API com relatório de cobertura
npm run verificar                 # checagem de tipos (strict) da interface e da API
npm run build                     # gera web/dist e api/dist
npm run versao -- --conferir      # confere a versão em todos os arquivos
```

O código não tem comentários: nomes descritivos em português, funções curtas e tipos explícitos contam o que cada parte faz, e os manuais em PDF guardam o porquê.

### Novidades da versão 1.5.0

| Área | O que mudou |
|---|---|
| Segurança | Verificação em duas etapas com aplicativo autenticador (TOTP, RFC 6238) e QR code, dez códigos de recuperação de uso único guardados com HMAC, segredo cifrado com AES-256-GCM, proteção contra reuso de código, bloqueio atômico após 5 códigos errados, regra por papel (também para tokens enviados em `Authorization`) e redefinição pelo administrador |
| Alertas | Página **Alertas** com regras sobre 9 métricas e 4 janelas, por valor ou por variação, prévia do valor de agora, modelos prontos, gravidade, silêncio, pausa, teste na hora, histórico de disparos, notificações na categoria **Alertas de métricas** e evento `alerta.disparado` nas integrações |
| Previsão e insights | Cartões **Previsão do mês** (projeção, faixa provável, chance de bater a meta, ritmo necessário e MRR em 90 dias) e **Insights** (anomalias dos últimos 7 dias com atalho para criar alerta e destaques do negócio) na visão geral, pela rota `GET /insights` |
| Visão geral | Botão **Personalizar**: esconder, arrastar, mover pelo teclado e redimensionar cartões, quatro layouts prontos e layout salvo na conta |
| Interface | Primeiros passos com 8 etapas, paleta de comandos com atalhos para alertas, personalização e verificação em duas etapas, `g` `l` abre Alertas e a janela de novidades da versão |
| Correções | O idioma padrão em Configurações › Empresa usava códigos que a API recusava; menus de ações abertos por botões sem `data-menu` não fecham mais no mesmo clique |
| Banco | Migração `007_dois_fatores_alertas.sql` (colunas do segundo fator, `codigos_recuperacao`, `alertas_metricas`, `disparos_alerta`, layout nas preferências, categoria `metrica` e permissões `alertas.ver` e `alertas.gerenciar`) |
| Operação | Retenção dos disparos de alertas (`BENTO_RETENCAO_ALERTAS`), verificação de administradores sem segundo fator no diagnóstico e avaliação dos alertas no agendador, segura com várias instâncias |
| Testes | 20 testes novos da API (vetores da RFC 6238, fluxo completo do login em duas etapas, alertas, previsão, anomalias e layout) e 5 da interface |

### Versões anteriores

| Versão | O que mudou |
|---|---|
| 1.4.0 | Preferências de uso, colunas configuráveis, recentes na paleta de comandos, importação de usuários por CSV, histórico de entregas das integrações e operação (manutenção, backups, retenção, diagnóstico, sondas e métricas) |
| 1.3.0 | Notas internas na gaveta de cada usuário (permissão `usuarios.anotar`) e visões salvas de filtros em Transações e Auditoria |
| 1.2.0 | Identidade “caixa única”, tipografia fina e condensada, status como ponto de cor e variações com sinal |
| 1.1.0 | Transações com reembolso auditado, Auditoria, paleta de comandos e atalhos, status do sistema e auditoria de segurança |
| 1.0.0 | Primeira versão: visão geral, analytics, usuários, notificações, relatórios, configurações, componentes e API |

### Segurança e qualidade

A versão 1.1.0 passou por uma auditoria de segurança, com 20 testes automatizados em `api/test/seguranca.test.ts`, e a 1.5.0 acrescentou o segundo fator, coberto em `api/test/dois-fatores.test.ts` (o desafio do login não vale como sessão, códigos não podem ser reusados, tentativas erradas bloqueiam a conta e a regra por papel fecha as outras rotas). O que foi corrigido na auditoria:

| Gravidade | O que era | Como ficou |
|---|---|---|
| Crítica | O papel Suporte podia redefinir a senha do administrador e entrar como ele | Quem não controla permissões só altera contas de nível menor que o seu (editar, senha, bloqueio, exclusão e ações em massa) |
| Alta | Webhooks aceitavam qualquer endereço (SSRF) | Localhost, IPs internos, metadados de nuvem e redes privadas são recusados ao salvar e ao enviar, sem seguir redirecionamentos |
| Média | Textos começando com `=`, `+`, `-` ou `@` viravam fórmula no Excel | As células de texto do CSV são neutralizadas |
| Média | Qualquer analista apagava relatórios e agendamentos de outras pessoas | Só o autor ou quem configura o sistema |
| Baixa | O bloqueio por tentativas revelava quais e-mails existiam | E-mails inexistentes recebem a mesma resposta e o mesmo bloqueio |
| Baixa | Links de avisos e o `?voltar=` do login aceitavam outro domínio | Só caminhos internos |

Os testes também conferem sessão obrigatória, JWT forjado, permissões por papel, proteção CSRF (`X-Bento`), chaves de API só leitura, 11 tentativas de injeção SQL, cookies `httpOnly` e `SameSite`, cabeçalhos de segurança (CSP, `nosniff`, `X-Frame-Options`, `Referrer-Policy`), rate limit, mass assignment, IDOR e path traversal. A CI também roda `npm audit --omit=dev --audit-level=high` a cada envio.

O GitHub Actions confere a versão, checa os tipos, roda os testes com cobertura, constrói a interface, roda `migrar`, `semear`, `backup`, `restaurar` e `diagnostico` contra um PostgreSQL 18 de verdade, sobe a API, espera a prontidão, consulta métricas e rotas reais e constrói a imagem Docker. O Dependabot propõe atualizações semanais das dependências (com o ApexCharts fixado de propósito) e mensais das Actions e da imagem.

### Estrutura

```text
web/                        interface
  *.html                    uma página por módulo
  src/css/                  Tailwind CSS: tema, base, layout, componentes, kit, páginas
  src/ts/nucleo/            tipos, API, sessão, tema, tempo real, formatação, ícones, recentes, colunas
  src/ts/componentes/       tabela, gráficos, gavetas, diálogos, avisos, formulários, importação
  src/ts/layout/            menu, cabeçalho, paleta de comandos, atalhos, manutenção, novidades
  src/ts/paginas/           controlador de cada página
  public/                   favicon, logo e script de tema
  tests/                    testes do núcleo e da navegação
api/                        API em TypeScript
  src/modulos/              auth, segurança (duas etapas), visão geral, insights, alertas, analytics, usuários, transações, auditoria, notificações, relatórios, configurações, integrações, sistema
  src/operacao/             backup, diagnóstico, manutenção, métricas e retenção
  src/banco/                conexão (PostgreSQL ou PGlite), migrações e dados de demonstração
  src/relatorios/           geração de CSV e PDF
  src/cli.ts                comandos de linha: migrar, semear, admin, diagnostico, backup, restaurar, limpar
  migracoes/                esquema do banco (001 a 007)
  test/                     testes da API, de segurança, de duas etapas, de alertas e insights, de operação, de backup, de importação e entregas
scripts/                    servidor de desenvolvimento, versão e criação do .env no Windows
docs/                       manuais em PDF e imagens do README
.github/                    CI e Dependabot
VERSION                     versão única do projeto
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
| [QR Code Generator](https://github.com/kazuhikoarase/qrcode-generator) | QR code da verificação em duas etapas, gerado no navegador | MIT |

O ApexCharts está fixado na versão 4.7.0, a última publicada sob a licença MIT. As versões a partir da 5.1 usam uma licença dupla que exige compra para empresas com receita anual acima de US$ 2 milhões; confira antes de atualizar. O PostgreSQL roda como serviço externo via Docker e não é redistribuído neste repositório. Os nomes Slack, Discord, Google Analytics e Stripe pertencem aos seus donos e aparecem só como destinos de integração.

## Licença

Copyright (©) 2026 Erik Pimenta

Este projeto é distribuído sob a licença [MIT](LICENSE). Você pode usar, copiar, modificar e redistribuir o código, inclusive para fins comerciais, desde que mantenha o aviso de copyright e o texto da licença.

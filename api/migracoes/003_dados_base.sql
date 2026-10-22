insert into papeis (codigo, nome, descricao, nivel, acesso_painel) values
  ('admin', 'Administrador', 'Acesso total ao painel, inclusive configurações do sistema e permissões.', 100, true),
  ('gerente', 'Gerente', 'Gerencia usuários, relatórios e integrações, sem alterar o sistema.', 80, true),
  ('analista', 'Analista', 'Consulta métricas e analytics e gera relatórios.', 60, true),
  ('suporte', 'Suporte', 'Atende clientes: consulta, edita e bloqueia contas.', 40, true),
  ('cliente', 'Cliente', 'Conta de cliente da plataforma, sem acesso ao painel.', 0, false);

insert into permissoes (codigo, modulo, nome, descricao, ordem) values
  ('painel.ver', 'Visão geral', 'Ver a visão geral', 'Acessa o painel e os indicadores principais.', 10),
  ('analytics.ver', 'Analytics', 'Ver analytics', 'Consulta gráficos, filtros por período e coortes.', 20),
  ('usuarios.ver', 'Usuários', 'Ver usuários', 'Lista, pesquisa e abre o detalhe dos usuários.', 30),
  ('usuarios.criar', 'Usuários', 'Cadastrar usuários', 'Cria contas novas.', 31),
  ('usuarios.editar', 'Usuários', 'Editar usuários', 'Altera dados cadastrais e redefine senhas.', 32),
  ('usuarios.bloquear', 'Usuários', 'Bloquear contas', 'Bloqueia e desbloqueia contas.', 33),
  ('usuarios.excluir', 'Usuários', 'Excluir usuários', 'Remove contas definitivamente.', 34),
  ('usuarios.permissoes', 'Usuários', 'Controlar permissões', 'Muda o papel e as permissões individuais.', 35),
  ('transacoes.ver', 'Transações', 'Ver transações', 'Consulta e exporta transações.', 40),
  ('notificacoes.enviar', 'Notificações', 'Enviar avisos', 'Publica avisos para a equipe.', 50),
  ('relatorios.ver', 'Relatórios', 'Ver relatórios', 'Consulta o histórico e baixa relatórios.', 60),
  ('relatorios.gerar', 'Relatórios', 'Gerar relatórios', 'Gera relatórios em CSV e PDF.', 61),
  ('relatorios.agendar', 'Relatórios', 'Agendar relatórios', 'Cria e pausa relatórios recorrentes.', 62),
  ('configuracoes.integracoes', 'Configurações', 'Gerenciar integrações', 'Conecta webhooks, Slack, Discord e outros serviços.', 70),
  ('configuracoes.sistema', 'Configurações', 'Configurar o sistema', 'Altera nome da empresa, moeda, fuso e meta mensal.', 71),
  ('auditoria.ver', 'Auditoria', 'Ver atividades', 'Consulta o registro de atividades da plataforma.', 80);

insert into papel_permissoes (papel, permissao)
select 'admin', codigo from permissoes;

insert into papel_permissoes (papel, permissao)
select 'gerente', codigo from permissoes
where codigo not in ('configuracoes.sistema', 'usuarios.excluir', 'usuarios.permissoes');

insert into papel_permissoes (papel, permissao) values
  ('analista', 'painel.ver'),
  ('analista', 'analytics.ver'),
  ('analista', 'transacoes.ver'),
  ('analista', 'usuarios.ver'),
  ('analista', 'relatorios.ver'),
  ('analista', 'relatorios.gerar'),
  ('analista', 'relatorios.agendar'),
  ('suporte', 'painel.ver'),
  ('suporte', 'usuarios.ver'),
  ('suporte', 'usuarios.editar'),
  ('suporte', 'usuarios.bloquear'),
  ('suporte', 'transacoes.ver');

insert into planos (codigo, nome, preco_mensal, preco_anual, ordem, recursos) values
  ('essencial', 'Essencial', 4900, 49000, 1, '["1 painel", "3 usuários", "Relatórios em CSV"]'::jsonb),
  ('profissional', 'Profissional', 12900, 129000, 2, '["5 painéis", "10 usuários", "Relatórios em CSV e PDF", "Integrações"]'::jsonb),
  ('equipe', 'Equipe', 29900, 299000, 3, '["Painéis ilimitados", "30 usuários", "Relatórios agendados", "Permissões avançadas"]'::jsonb),
  ('empresa', 'Empresa', 79900, 799000, 4, '["Tudo do Equipe", "Usuários ilimitados", "SLA dedicado", "Auditoria completa"]'::jsonb);

insert into integracoes (provedor, nome, descricao, categoria) values
  ('webhook', 'Webhook', 'Envia eventos assinados com HMAC-SHA256 para qualquer URL.', 'Automação'),
  ('slack', 'Slack', 'Publica transações, cadastros e alertas em um canal do Slack.', 'Comunicação'),
  ('discord', 'Discord', 'Publica os mesmos eventos em um canal do Discord.', 'Comunicação'),
  ('google-analytics', 'Google Analytics', 'Guarda o ID de medição para importar tráfego e conversões.', 'Analytics'),
  ('stripe', 'Stripe', 'Guarda as chaves para importar pagamentos e assinaturas.', 'Pagamentos');

insert into configuracoes_sistema (chave, valor) values
  ('nomeEmpresa', '"Bento"'::jsonb),
  ('moeda', '"BRL"'::jsonb),
  ('fuso', '"America/Sao_Paulo"'::jsonb),
  ('metaMensal', '15000000'::jsonb),
  ('idiomaPadrao', '"pt-BR"'::jsonb);

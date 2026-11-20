alter table integracoes drop constraint if exists integracoes_provedor_check;
alter table integracoes
  add constraint integracoes_provedor_check
    check (provedor in ('webhook', 'slack', 'discord', 'teams', 'google-chat', 'telegram', 'google-analytics', 'stripe'));

alter table integracoes
  add column if not exists eventos text[] not null default '{}'::text[];

alter table integracoes drop constraint if exists integracoes_eventos_check;
alter table integracoes
  add constraint integracoes_eventos_check
    check (eventos <@ array['transacao.paga', 'usuario.criado', 'usuario.bloqueado', 'relatorio.gerado', 'alerta.disparado']::text[]);

insert into integracoes (provedor, nome, descricao, categoria) values
  ('teams', 'Microsoft Teams', 'Publica transações, cadastros e alertas em um canal do Teams.', 'Comunicação'),
  ('google-chat', 'Google Chat', 'Publica os mesmos eventos em um espaço do Google Chat.', 'Comunicação'),
  ('telegram', 'Telegram', 'Envia os eventos para um grupo ou conversa pelo seu bot.', 'Comunicação')
on conflict (provedor) do nothing;

insert into configuracoes_sistema (chave, valor)
select 'demonstracao', to_jsonb(exists (
  select 1 from usuarios
   where lower(email) in ('admin@bento.local', 'gerente@bento.local', 'analista@bento.local', 'suporte@bento.local')
))
on conflict (chave) do nothing;

insert into configuracoes_sistema (chave, valor) values ('operacao', '{}'::jsonb)
on conflict (chave) do nothing;

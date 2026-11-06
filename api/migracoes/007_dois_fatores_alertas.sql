alter table usuarios
  add column if not exists totp_segredo text,
  add column if not exists totp_ativado_em timestamptz,
  add column if not exists totp_ultimo_passo bigint,
  add column if not exists totp_pendente text,
  add column if not exists totp_pendente_em timestamptz;

alter table usuarios
  add constraint usuarios_totp_coerente check (totp_ativado_em is null or totp_segredo is not null);

create table if not exists codigos_recuperacao (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references usuarios (id) on delete cascade,
  codigo_hash text not null,
  usado_em timestamptz,
  criado_em timestamptz not null default now(),
  unique (usuario_id, codigo_hash)
);

create index if not exists codigos_recuperacao_disponiveis on codigos_recuperacao (usuario_id) where usado_em is null;

alter table preferencias_usuario
  add column if not exists layout_visao_geral jsonb
    check (layout_visao_geral is null or (jsonb_typeof(layout_visao_geral) = 'array' and jsonb_array_length(layout_visao_geral) <= 40));

alter table notificacoes drop constraint if exists notificacoes_categoria_check;
alter table notificacoes
  add constraint notificacoes_categoria_check
    check (categoria in ('transacao', 'usuario', 'sistema', 'seguranca', 'relatorio', 'metrica'));

alter table preferencias_notificacao drop constraint if exists preferencias_notificacao_categoria_check;
alter table preferencias_notificacao
  add constraint preferencias_notificacao_categoria_check
    check (categoria in ('transacao', 'usuario', 'sistema', 'seguranca', 'relatorio', 'metrica'));

create table if not exists alertas_metricas (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(btrim(nome)) between 2 and 80),
  metrica text not null
    check (metrica in ('receita', 'transacoes_pagas', 'taxa_falha', 'reembolsos', 'novos_usuarios', 'cancelamentos', 'mrr', 'ticket_medio', 'conversao')),
  janela text not null check (janela in ('1h', '24h', '7d', '30d')),
  modo text not null check (modo in ('valor', 'variacao')),
  operador text not null check (operador in ('maior', 'menor')),
  limite double precision not null check (limite > -1000000000000 and limite < 1000000000000),
  severidade text not null default 'alerta' check (severidade in ('info', 'alerta', 'erro')),
  notificar_integracoes boolean not null default false,
  silencio_minutos integer not null default 60 check (silencio_minutos between 5 and 10080),
  ativo boolean not null default true,
  estado text not null default 'normal' check (estado in ('normal', 'disparado')),
  ultimo_valor double precision,
  ultima_avaliacao timestamptz,
  ultimo_disparo timestamptz,
  criado_por uuid references usuarios (id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists alertas_metricas_fila on alertas_metricas (ultima_avaliacao nulls first) where ativo;

create table if not exists disparos_alerta (
  id uuid primary key default gen_random_uuid(),
  alerta_id uuid not null references alertas_metricas (id) on delete cascade,
  valor double precision not null,
  limite double precision not null,
  mensagem text not null check (char_length(mensagem) between 1 and 300),
  criado_em timestamptz not null default now(),
  resolvido_em timestamptz,
  check (resolvido_em is null or resolvido_em >= criado_em)
);

create index if not exists disparos_alerta_lista on disparos_alerta (alerta_id, criado_em desc);
create index if not exists disparos_alerta_recentes on disparos_alerta (criado_em desc);

insert into permissoes (codigo, modulo, nome, descricao, ordem) values
  ('alertas.ver', 'Alertas', 'Ver alertas', 'Consulta as regras de alerta das métricas e o histórico de disparos.', 63),
  ('alertas.gerenciar', 'Alertas', 'Gerenciar alertas', 'Cria, edita, pausa e exclui regras de alerta das métricas.', 64)
on conflict (codigo) do nothing;

insert into papel_permissoes (papel, permissao)
select alvo.papel, alvo.permissao
  from (values ('admin', 'alertas.ver'), ('admin', 'alertas.gerenciar'), ('gerente', 'alertas.ver'), ('gerente', 'alertas.gerenciar'),
               ('analista', 'alertas.ver'), ('analista', 'alertas.gerenciar')) as alvo (papel, permissao)
 where exists (select 1 from papeis where codigo = alvo.papel)
on conflict (papel, permissao) do nothing;

insert into configuracoes_sistema (chave, valor) values
  ('doisFatoresPapeis', '[]'::jsonb)
on conflict (chave) do nothing;

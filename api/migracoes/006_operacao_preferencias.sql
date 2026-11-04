alter table preferencias_usuario
  add column if not exists pagina_inicial text not null default 'visao-geral'
    check (pagina_inicial in ('visao-geral', 'analytics', 'usuarios', 'transacoes', 'notificacoes', 'relatorios', 'auditoria')),
  add column if not exists itens_por_pagina smallint not null default 25
    check (itens_por_pagina in (10, 25, 50, 100)),
  add column if not exists movimento text not null default 'sistema'
    check (movimento in ('sistema', 'reduzido')),
  add column if not exists atalhos_teclado boolean not null default true,
  add column if not exists primeiros_passos_ocultos boolean not null default false;

create table if not exists entregas_integracao (
  id uuid primary key default gen_random_uuid(),
  integracao_id uuid not null references integracoes (id) on delete cascade,
  evento text not null check (evento ~ '^[a-z_]+\.[a-z_]+$'),
  resumo text not null check (char_length(resumo) between 1 and 300),
  carga jsonb not null default '{}'::jsonb,
  status text not null default 'pendente' check (status in ('pendente', 'entregue', 'falhou')),
  tentativas smallint not null default 0 check (tentativas >= 0),
  proxima_tentativa timestamptz,
  codigo_http smallint,
  duracao_ms integer check (duracao_ms is null or duracao_ms >= 0),
  erro text check (erro is null or char_length(erro) <= 300),
  teste boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check ((status = 'pendente') = (proxima_tentativa is not null))
);

create index if not exists entregas_integracao_lista on entregas_integracao (integracao_id, criado_em desc);
create index if not exists entregas_integracao_pendentes on entregas_integracao (proxima_tentativa) where status = 'pendente';
create index if not exists sessoes_expira_em on sessoes (expira_em);

insert into permissoes (codigo, modulo, nome, descricao, ordem) values
  ('usuarios.importar', 'Usuários', 'Importar usuários', 'Cadastra várias contas de uma vez a partir de uma planilha CSV.', 37)
on conflict (codigo) do nothing;

insert into papel_permissoes (papel, permissao)
select papel, 'usuarios.importar' from (values ('admin'), ('gerente')) as alvo (papel)
where exists (select 1 from papeis where codigo = alvo.papel)
on conflict (papel, permissao) do nothing;

insert into configuracoes_sistema (chave, valor) values
  ('manutencao', '{"ativo": false, "mensagem": "", "desde": null, "porId": null, "porNome": null}'::jsonb)
on conflict (chave) do nothing;

create table notas_usuario (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references usuarios (id) on delete cascade,
  autor_id uuid references usuarios (id) on delete set null,
  texto text not null check (char_length(btrim(texto)) between 2 and 2000),
  fixada boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists notas_usuario_lista on notas_usuario (usuario_id, fixada desc, criado_em desc);

insert into permissoes (codigo, modulo, nome, descricao, ordem) values
  ('usuarios.anotar', 'Usuários', 'Anotar nas contas', 'Escreve, fixa e remove notas internas no perfil dos usuários.', 36)
on conflict (codigo) do nothing;

insert into papel_permissoes (papel, permissao)
select papel, 'usuarios.anotar' from (values ('admin'), ('gerente'), ('suporte')) as alvo (papel)
where exists (select 1 from papeis where codigo = alvo.papel)
on conflict (papel, permissao) do nothing;

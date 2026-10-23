alter table transacoes
  add column reembolsado_em timestamptz,
  add column reembolso_motivo text check (reembolso_motivo is null or char_length(reembolso_motivo) between 3 and 300),
  add column reembolsado_por uuid references usuarios (id) on delete set null;

insert into permissoes (codigo, modulo, nome, descricao, ordem) values
  ('transacoes.reembolsar', 'Transações', 'Reembolsar transações', 'Devolve o valor de transações pagas, com o motivo registrado na auditoria.', 41)
on conflict (codigo) do nothing;

insert into papel_permissoes (papel, permissao)
select papel, 'transacoes.reembolsar' from (values ('admin'), ('gerente')) as alvo (papel)
where exists (select 1 from papeis where codigo = alvo.papel)
on conflict (papel, permissao) do nothing;

create index if not exists auditoria_acao_criado_em on auditoria (acao, criado_em desc);

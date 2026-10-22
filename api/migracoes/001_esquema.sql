create table papeis (
  codigo text primary key check (codigo ~ '^[a-z][a-z0-9_]{1,31}$'),
  nome text not null,
  descricao text not null default '',
  nivel smallint not null default 0,
  acesso_painel boolean not null default true,
  sistema boolean not null default true
);

create table permissoes (
  codigo text primary key check (codigo ~ '^[a-z]+\.[a-z]+$'),
  modulo text not null,
  nome text not null,
  descricao text not null default '',
  ordem smallint not null default 0
);

create table papel_permissoes (
  papel text not null references papeis (codigo) on update cascade on delete cascade,
  permissao text not null references permissoes (codigo) on update cascade on delete cascade,
  primary key (papel, permissao)
);

create table usuarios (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(btrim(nome)) between 2 and 120),
  email text not null check (char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  senha_hash text,
  papel text not null default 'cliente' references papeis (codigo) on update cascade,
  status text not null default 'ativo' check (status in ('ativo', 'bloqueado', 'pendente', 'inativo')),
  cargo text check (cargo is null or char_length(cargo) <= 80),
  empresa text check (empresa is null or char_length(empresa) <= 120),
  telefone text check (telefone is null or char_length(telefone) <= 30),
  pais text check (pais is null or char_length(pais) <= 60),
  cidade text check (cidade is null or char_length(cidade) <= 80),
  canal text check (canal is null or canal in ('Orgânico', 'Direto', 'Pago', 'Social', 'Indicação', 'E-mail')),
  fuso text not null default 'America/Sao_Paulo',
  idioma text not null default 'pt-BR',
  tentativas_falhas smallint not null default 0 check (tentativas_falhas >= 0),
  bloqueio_temporario_ate timestamptz,
  bloqueado_em timestamptz,
  motivo_bloqueio text check (motivo_bloqueio is null or char_length(motivo_bloqueio) <= 300),
  ultimo_acesso timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check ((status = 'bloqueado') = (bloqueado_em is not null))
);

create table usuario_permissoes (
  usuario_id uuid not null references usuarios (id) on delete cascade,
  permissao text not null references permissoes (codigo) on update cascade on delete cascade,
  concedida boolean not null,
  primary key (usuario_id, permissao)
);

create table preferencias_usuario (
  usuario_id uuid primary key references usuarios (id) on delete cascade,
  tema text not null default 'sistema' check (tema in ('claro', 'escuro', 'sistema')),
  paleta text not null default 'bento' check (paleta in ('bento', 'oliva', 'grafite', 'oceano', 'terracota', 'ameixa', 'floresta', 'ardosia', 'vinho', 'lavanda', 'cobre', 'petroleo', 'girassol', 'menta', 'noite', 'areia')),
  densidade text not null default 'confortavel' check (densidade in ('confortavel', 'compacta')),
  sidebar_recolhida boolean not null default false,
  atualizado_em timestamptz not null default now()
);

create table preferencias_notificacao (
  usuario_id uuid not null references usuarios (id) on delete cascade,
  categoria text not null check (categoria in ('transacao', 'usuario', 'sistema', 'seguranca', 'relatorio')),
  app boolean not null default true,
  email boolean not null default false,
  primary key (usuario_id, categoria)
);

create table sessoes (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references usuarios (id) on delete cascade,
  token_hash text not null unique,
  agente text,
  ip text,
  lembrar boolean not null default false,
  criado_em timestamptz not null default now(),
  ultimo_uso timestamptz not null default now(),
  expira_em timestamptz not null,
  revogada_em timestamptz,
  check (expira_em > criado_em)
);

create table chaves_api (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references usuarios (id) on delete cascade,
  nome text not null check (char_length(btrim(nome)) between 2 and 60),
  prefixo text not null,
  segredo_hash text not null unique,
  escopos text[] not null check (cardinality(escopos) > 0 and escopos <@ array['leitura', 'escrita']),
  ultimo_uso timestamptz,
  criado_em timestamptz not null default now(),
  revogada_em timestamptz
);

create table planos (
  codigo text primary key check (codigo ~ '^[a-z][a-z0-9_]{1,31}$'),
  nome text not null,
  preco_mensal integer not null check (preco_mensal > 0),
  preco_anual integer not null check (preco_anual > 0),
  ordem smallint not null default 0,
  ativo boolean not null default true,
  recursos jsonb not null default '[]'::jsonb
);

create table assinaturas (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references usuarios (id) on delete cascade,
  plano text not null references planos (codigo) on update cascade,
  status text not null check (status in ('ativa', 'teste', 'cancelada', 'inadimplente')),
  ciclo text not null default 'mensal' check (ciclo in ('mensal', 'anual')),
  metodo text not null default 'cartao' check (metodo in ('cartao', 'pix', 'boleto')),
  valor integer not null check (valor >= 0),
  iniciada_em timestamptz not null,
  teste_ate timestamptz,
  convertida_em timestamptz,
  renovacao_em timestamptz,
  cancelada_em timestamptz,
  motivo_cancelamento text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (teste_ate is null or teste_ate >= iniciada_em),
  check (convertida_em is null or convertida_em >= iniciada_em),
  check ((status = 'cancelada') = (cancelada_em is not null)),
  check (status <> 'teste' or teste_ate is not null)
);

create sequence transacoes_codigo_seq;

create table transacoes (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique default ('TX-' || lpad(nextval('transacoes_codigo_seq')::text, 6, '0')),
  usuario_id uuid references usuarios (id) on delete set null,
  assinatura_id uuid references assinaturas (id) on delete set null,
  plano text references planos (codigo) on update cascade,
  cliente_nome text not null,
  cliente_email text not null,
  tipo text not null check (tipo in ('assinatura', 'upgrade', 'avulsa', 'reembolso')),
  metodo text not null check (metodo in ('cartao', 'pix', 'boleto')),
  status text not null check (status in ('paga', 'pendente', 'falhou', 'reembolsada')),
  valor integer not null check (valor >= 0),
  moeda char(3) not null default 'BRL',
  criado_em timestamptz not null default now(),
  pago_em timestamptz,
  check ((status in ('paga', 'reembolsada')) = (pago_em is not null))
);

create table metas_mensais (
  mes date primary key check (extract(day from mes) = 1),
  valor integer not null check (valor > 0)
);

create table trafego_diario (
  dia date not null,
  canal text not null check (canal in ('Orgânico', 'Direto', 'Pago', 'Social', 'Indicação', 'E-mail')),
  dispositivo text not null check (dispositivo in ('Desktop', 'Celular', 'Tablet')),
  visitantes integer not null default 0 check (visitantes >= 0),
  sessoes integer not null default 0 check (sessoes >= 0),
  cadastros integer not null default 0 check (cadastros >= 0),
  conversoes integer not null default 0 check (conversoes >= 0),
  primary key (dia, canal, dispositivo)
);

create table trafego_paises (
  dia date not null,
  pais_codigo char(2) not null check (pais_codigo ~ '^[A-Z]{2}$'),
  visitantes integer not null default 0 check (visitantes >= 0),
  primary key (dia, pais_codigo)
);

create table notificacoes (
  id uuid primary key default gen_random_uuid(),
  destinatario_id uuid references usuarios (id) on delete cascade,
  tipo text not null check (tipo in ('info', 'sucesso', 'alerta', 'erro')),
  categoria text not null check (categoria in ('transacao', 'usuario', 'sistema', 'seguranca', 'relatorio')),
  titulo text not null check (char_length(titulo) between 1 and 120),
  mensagem text not null check (char_length(mensagem) between 1 and 1000),
  link text,
  dados jsonb not null default '{}'::jsonb,
  criado_por uuid references usuarios (id) on delete set null,
  criado_em timestamptz not null default now()
);

create table notificacao_estados (
  notificacao_id uuid not null references notificacoes (id) on delete cascade,
  usuario_id uuid not null references usuarios (id) on delete cascade,
  lida_em timestamptz,
  dispensada_em timestamptz,
  primary key (notificacao_id, usuario_id)
);

create table relatorios_agendados (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(btrim(nome)) between 2 and 120),
  tipo text not null check (tipo in ('receita', 'transacoes', 'usuarios', 'assinaturas', 'crescimento')),
  formato text not null check (formato in ('csv', 'pdf')),
  frequencia text not null check (frequencia in ('diaria', 'semanal', 'mensal')),
  periodo text not null check (periodo in ('7d', '30d', 'mes-anterior')),
  ativo boolean not null default true,
  proxima_execucao timestamptz not null,
  ultima_execucao timestamptz,
  criado_por uuid not null references usuarios (id) on delete cascade,
  criado_em timestamptz not null default now()
);

create table relatorios (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(btrim(nome)) between 2 and 160),
  tipo text not null check (tipo in ('receita', 'transacoes', 'usuarios', 'assinaturas', 'crescimento')),
  formato text not null check (formato in ('csv', 'pdf')),
  inicio date not null,
  fim date not null,
  filtros jsonb not null default '{}'::jsonb,
  status text not null check (status in ('pronto', 'erro')),
  linhas integer not null default 0 check (linhas >= 0),
  tamanho_bytes integer not null default 0 check (tamanho_bytes >= 0),
  conteudo bytea,
  tipo_mime text not null,
  erro text,
  criado_por uuid references usuarios (id) on delete set null,
  agendamento_id uuid references relatorios_agendados (id) on delete set null,
  criado_em timestamptz not null default now(),
  check (fim >= inicio),
  check ((status = 'pronto') = (conteudo is not null))
);

create table integracoes (
  id uuid primary key default gen_random_uuid(),
  provedor text not null unique check (provedor in ('webhook', 'slack', 'discord', 'google-analytics', 'stripe')),
  nome text not null,
  descricao text not null default '',
  categoria text not null check (categoria in ('Automação', 'Comunicação', 'Analytics', 'Pagamentos')),
  ativo boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  status text not null default 'desconectada' check (status in ('conectada', 'desconectada', 'erro')),
  ultimo_evento timestamptz,
  ultimo_erro text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table auditoria (
  id bigint generated always as identity primary key,
  usuario_id uuid references usuarios (id) on delete set null,
  acao text not null check (acao ~ '^[a-z_]+\.[a-z_]+$'),
  entidade text,
  entidade_id text,
  descricao text not null,
  detalhes jsonb not null default '{}'::jsonb,
  ip text,
  criado_em timestamptz not null default now()
);

create table configuracoes_sistema (
  chave text primary key,
  valor jsonb not null,
  atualizado_em timestamptz not null default now()
);

create unique index usuarios_email_unico on usuarios (lower(email));
create index usuarios_criado_em on usuarios (criado_em);
create index usuarios_status on usuarios (status);
create index usuarios_papel on usuarios (papel);
create index usuarios_nome on usuarios (lower(nome));
create index usuarios_ultimo_acesso on usuarios (ultimo_acesso desc nulls last);

create index sessoes_usuario_ativas on sessoes (usuario_id) where revogada_em is null;
create index chaves_api_usuario on chaves_api (usuario_id) where revogada_em is null;

create unique index assinaturas_uma_vigente on assinaturas (usuario_id) where status in ('ativa', 'teste', 'inadimplente');
create index assinaturas_status on assinaturas (status);
create index assinaturas_plano on assinaturas (plano);
create index assinaturas_convertida_em on assinaturas (convertida_em) where convertida_em is not null;
create index assinaturas_cancelada_em on assinaturas (cancelada_em) where cancelada_em is not null;
create index assinaturas_iniciada_em on assinaturas (iniciada_em);

create index transacoes_criado_em on transacoes (criado_em desc);
create index transacoes_status_criado_em on transacoes (status, criado_em);
create index transacoes_usuario on transacoes (usuario_id, criado_em desc);
create index transacoes_assinatura on transacoes (assinatura_id);
create index transacoes_metodo on transacoes (metodo);
create index transacoes_plano on transacoes (plano, criado_em);

create index trafego_diario_canal on trafego_diario (canal, dia);

create index notificacoes_destinatario on notificacoes (destinatario_id, criado_em desc);
create index notificacoes_criado_em on notificacoes (criado_em desc);
create index notificacao_estados_usuario on notificacao_estados (usuario_id);

create index relatorios_criado_em on relatorios (criado_em desc);
create index relatorios_agendados_vencidos on relatorios_agendados (proxima_execucao) where ativo;

create index auditoria_criado_em on auditoria (criado_em desc);
create index auditoria_usuario on auditoria (usuario_id, criado_em desc);
create index auditoria_entidade on auditoria (entidade, entidade_id);

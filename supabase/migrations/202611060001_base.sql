begin;
create extension if not exists pgcrypto with schema extensions;
create table public.profiles(id uuid primary key references auth.users on delete cascade, nome text not null default '', criado_em timestamptz not null default now());
create table public.obras(id uuid primary key default gen_random_uuid(), nome text not null check(length(nome) between 1 and 300), orcamento bigint not null default 0 check(orcamento>=0), criado_por uuid not null default auth.uid() references auth.users, criado_em timestamptz not null default now());
create table public.obra_membros(obra_id uuid references public.obras on delete cascade, user_id uuid references auth.users on delete cascade, role text not null check(role in ('admin','user')), criado_em timestamptz not null default now(), primary key(obra_id,user_id));
create function public.is_member(p_obra uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.obra_membros where obra_id=p_obra and user_id=auth.uid())$$;
create function public.is_admin(p_obra uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.obra_membros where obra_id=p_obra and user_id=auth.uid() and role='admin')$$;
create function public.init_obra() returns trigger language plpgsql security definer set search_path='' as $$begin insert into public.obra_membros values(new.id,new.criado_por,'admin',now());return new;end$$;
create trigger init_obra after insert on public.obras for each row execute function public.init_obra();
create table public.convites(id uuid primary key default gen_random_uuid(),obra_id uuid not null references public.obras on delete cascade,token_hash text not null unique check(length(token_hash)=64),role text not null check(role in ('admin','user')),expira_em timestamptz not null default now()+interval '7 days',usado_em timestamptz,revogado boolean not null default false,criado_por uuid not null default auth.uid() references auth.users,criado_em timestamptz not null default now());
create table public.gastos(id uuid primary key default gen_random_uuid(),obra_id uuid not null references public.obras on delete cascade,categoria text not null check(categoria in ('Alvenaria','Elétrica','Hidráulica','Transporte','Decoração','Serviço (mão de obra)','Extras')),descricao text not null check(length(descricao) between 1 and 300),fornecedor text not null,quantidade numeric(14,4) not null check(quantidade>0),valor_unitario bigint not null check(valor_unitario>=0),valor_total bigint generated always as (round(quantidade*valor_unitario)) stored,data_compra date not null,data_entrega date,forma_pagamento text not null,observacoes text not null default '',status_entrega text not null check(status_entrega in ('pendente','entregue')),criado_por uuid not null default auth.uid() references auth.users,criado_em timestamptz not null default now(),unique(obra_id,id));
create table public.contratos_mao_de_obra(id uuid primary key default gen_random_uuid(),obra_id uuid not null references public.obras on delete cascade,profissional text not null,tipo text not null check(tipo in ('empreitada','diaria')),valor_geral bigint not null check(valor_geral>=0),plano_ativo boolean not null default false,criado_por uuid not null default auth.uid() references auth.users,criado_em timestamptz not null default now(),unique(obra_id,id));
create table public.servicos(id uuid primary key default gen_random_uuid(),obra_id uuid not null references public.obras on delete cascade,contrato_id uuid not null,nome text not null,descricao text not null default '',categoria text not null,peso integer not null check(peso between 0 and 10000),percentual_executado integer not null default 0 check(percentual_executado between 0 and 100),status text generated always as (case when percentual_executado=100 then 'concluido' when percentual_executado=0 then 'a_fazer' else 'em_andamento' end) stored,criado_por uuid not null default auth.uid() references auth.users,criado_em timestamptz not null default now(),unique(obra_id,id),foreign key(obra_id,contrato_id) references public.contratos_mao_de_obra(obra_id,id));
create table public.execucoes(id uuid primary key default gen_random_uuid(),obra_id uuid not null references public.obras on delete cascade,servico_id uuid not null,data date not null,percentual integer not null check(percentual between 0 and 100),observacoes text not null default '',criado_por uuid not null default auth.uid() references auth.users,criado_em timestamptz not null default now(),foreign key(obra_id,servico_id) references public.servicos(obra_id,id));
create table public.pagamentos(id uuid primary key default gen_random_uuid(),obra_id uuid not null references public.obras on delete cascade,contrato_id uuid not null,servico_id uuid,anulado boolean not null default false,data date not null,valor_bruto bigint not null check(valor_bruto>=0),desconto bigint not null default 0 check(desconto>=0 and desconto<=valor_bruto),valor bigint generated always as (valor_bruto-desconto) stored,referencia text not null,forma_pagamento text not null,modo text not null check(modo in ('servico','semanal')),criado_por uuid not null default auth.uid() references auth.users,criado_em timestamptz not null default now(),unique(obra_id,id),foreign key(obra_id,contrato_id) references public.contratos_mao_de_obra(obra_id,id),foreign key(obra_id,servico_id) references public.servicos(obra_id,id),check(modo<>'servico' or servico_id is not null));
create table public.descontos_profissional(id uuid primary key default gen_random_uuid(),obra_id uuid not null references public.obras on delete cascade,contrato_id uuid not null,descricao text not null,valor bigint not null check(valor>0),aplicado bigint not null default 0 check(aplicado>=0 and aplicado<=valor),aplicacao text not null check(aplicacao in ('semanal','final')),criado_por uuid not null default auth.uid() references auth.users,criado_em timestamptz not null default now(),unique(obra_id,id),foreign key(obra_id,contrato_id) references public.contratos_mao_de_obra(obra_id,id));
create table public.pagamento_descontos(pagamento_id uuid not null references public.pagamentos,desconto_id uuid not null references public.descontos_profissional,valor bigint not null check(valor>0),primary key(pagamento_id,desconto_id));
alter table public.pagamento_descontos enable row level security;
create policy member_read on public.pagamento_descontos for select to authenticated using(exists(select 1 from public.pagamentos p where p.id=pagamento_id and public.is_member(p.obra_id)));
create table public.ocorrencias(id uuid primary key default gen_random_uuid(),obra_id uuid not null references public.obras on delete cascade,titulo text not null,descricao text not null default '',tipo text not null check(tipo in ('problema','atencao','mudanca','andamento')),data date not null,servico_id uuid,status text not null default 'aberto' check(status in ('aberto','em_analise','resolvido')),responsavel text not null default '',criado_por uuid not null default auth.uid() references auth.users,criado_em timestamptz not null default now(),unique(obra_id,id),foreign key(obra_id,servico_id) references public.servicos(obra_id,id));
create table public.anexos(id uuid primary key default gen_random_uuid(),obra_id uuid not null references public.obras on delete cascade,entidade text not null check(entidade in ('gastos','contratos_mao_de_obra','pagamentos','descontos_profissional','ocorrencias')),entidade_id uuid not null,path text not null unique,mime text not null check(mime in ('image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf','application/xml','text/xml')),tamanho integer not null check(tamanho between 1 and 4194304),criado_por uuid not null default auth.uid() references auth.users,criado_em timestamptz not null default now());
create table public.audit_logs(id bigint generated always as identity primary key,obra_id uuid not null references public.obras on delete cascade,user_id uuid,acao text not null,tabela text not null,registro_id uuid not null,antes jsonb,depois jsonb,criado_em timestamptz not null default now());
create table public.rate_limits(bucket text primary key,window_start timestamptz not null,hits integer not null);
create function public.consume_rate(p_bucket text,p_limit integer) returns boolean language plpgsql security definer set search_path='' as $$declare n integer;begin
 insert into public.rate_limits values(p_bucket,date_trunc('minute',now()),1) on conflict(bucket) do update set hits=case when rate_limits.window_start=date_trunc('minute',now()) then rate_limits.hits+1 else 1 end,window_start=date_trunc('minute',now()) returning hits into n;
 return n<=least(p_limit,100);end$$;
create function public.audit_change() returns trigger language plpgsql security definer set search_path='' as $$begin
 insert into public.audit_logs(obra_id,user_id,acao,tabela,registro_id,antes,depois) values(coalesce(new.obra_id,old.obra_id),auth.uid(),tg_op,tg_table_name,coalesce(new.id,old.id),case when tg_op<>'INSERT' then to_jsonb(old) end,case when tg_op<>'DELETE' then to_jsonb(new) end);return coalesce(new,old);end$$;
create function public.accept_invite(p_token text) returns uuid language plpgsql security definer set search_path='' as $$declare i public.convites;begin
 if auth.uid() is null or length(p_token)<>64 then raise exception 'Convite inválido';end if;
 if not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then raise exception 'Confirme seu e-mail';end if;
 select * into i from public.convites where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') for update;
 if i.id is null or i.revogado or i.usado_em is not null or i.expira_em<=now() then raise exception 'Convite inválido ou expirado';end if;
 insert into public.obra_membros(obra_id,user_id,role) values(i.obra_id,auth.uid(),i.role) on conflict do nothing;
 update public.convites set usado_em=now() where id=i.id;return i.obra_id;end$$;
create function public.remove_member(p_obra uuid,p_user uuid) returns void language plpgsql security definer set search_path='' as $$begin
 if not public.is_admin(p_obra) then raise exception 'Sem permissão';end if;
 perform 1 from public.obras where id=p_obra for update;
 if exists(select 1 from public.obra_membros where obra_id=p_obra and user_id=p_user and role='admin') and (select count(*) from public.obra_membros where obra_id=p_obra and role='admin')<=1 then raise exception 'A obra precisa de um ADM';end if;
 delete from public.obra_membros where obra_id=p_obra and user_id=p_user;end$$;
create function public.activate_plan(p_contrato uuid) returns void language plpgsql security definer set search_path='' as $$declare c public.contratos_mao_de_obra;begin
 select * into c from public.contratos_mao_de_obra where id=p_contrato for update;
 if not public.is_admin(c.obra_id) then raise exception 'Sem permissão';end if;
 if c.tipo<>'empreitada' or (select coalesce(sum(peso),0) from public.servicos where contrato_id=c.id)<>10000 then raise exception 'Os pesos devem somar 100%%';end if;
 update public.contratos_mao_de_obra set plano_ativo=true where id=c.id;end$$;
create function public.lock_plan() returns trigger language plpgsql security definer set search_path='' as $$declare c public.contratos_mao_de_obra;begin
 select * into c from public.contratos_mao_de_obra where id=coalesce(new.contrato_id,old.contrato_id) for update;
 if c.plano_ativo and (tg_op<>'UPDATE' or new.peso<>old.peso or new.contrato_id<>old.contrato_id) then raise exception 'Plano ativo: pesos imutáveis';end if;return coalesce(new,old);end$$;
create trigger lock_plan before insert or update or delete on public.servicos for each row execute function public.lock_plan();
create function public.protect_contract() returns trigger language plpgsql security definer set search_path='' as $$begin
 if (new.tipo<>old.tipo or new.valor_geral<>old.valor_geral) and (old.plano_ativo or exists(select 1 from public.pagamentos where contrato_id=old.id and not anulado)) then raise exception 'Contrato em execução: mantenha o valor e tipo originais';end if;return new;end$$;
create trigger protect_contract before update on public.contratos_mao_de_obra for each row execute function public.protect_contract();
create function public.record_execution(p_servico uuid,p_data date,p_percentual integer,p_observacoes text) returns void language plpgsql security definer set search_path='' as $$declare s public.servicos;begin
 select * into s from public.servicos where id=p_servico for update;
 if not public.is_admin(s.obra_id) then raise exception 'Sem permissão';end if;
 if not exists(select 1 from public.contratos_mao_de_obra where id=s.contrato_id and plano_ativo) then raise exception 'Ative o plano primeiro';end if;
 if p_percentual<s.percentual_executado or p_percentual>100 then raise exception 'Avanço inválido';end if;
 insert into public.execucoes(obra_id,servico_id,data,percentual,observacoes) values(s.obra_id,s.id,p_data,p_percentual,p_observacoes);
 update public.servicos set percentual_executado=p_percentual where id=s.id;end$$;
create function public.record_payment(p_contrato uuid,p_servico uuid,p_data date,p_bruto bigint,p_referencia text,p_forma text,p_modo text,p_final boolean default false) returns uuid language plpgsql security definer set search_path='' as $$declare c public.contratos_mao_de_obra;d public.descontos_profissional;r bigint;v bigint;pid uuid;begin
 select * into c from public.contratos_mao_de_obra where id=p_contrato for update;
 if not public.is_admin(c.obra_id) then raise exception 'Sem permissão';end if;
 if p_bruto<0 or p_bruto>c.valor_geral-coalesce((select sum(valor_bruto) from public.pagamentos where contrato_id=c.id and not anulado),0) then raise exception 'Pagamento excede saldo do contrato';end if;
 if p_modo='servico' and not exists(select 1 from public.servicos where id=p_servico and contrato_id=c.id) then raise exception 'Serviço inválido';end if;
 insert into public.pagamentos(obra_id,contrato_id,servico_id,data,valor_bruto,desconto,referencia,forma_pagamento,modo) values(c.obra_id,c.id,p_servico,p_data,p_bruto,0,p_referencia,p_forma,p_modo) returning id into pid;
 r:=p_bruto;
 for d in select * from public.descontos_profissional where contrato_id=c.id and aplicado<valor and (aplicacao='semanal' or p_final) order by criado_em,id for update loop
 v:=least(r,d.valor-d.aplicado);if v>0 then insert into public.pagamento_descontos values(pid,d.id,v);end if;update public.descontos_profissional set aplicado=aplicado+v where id=d.id;r:=r-v;exit when r=0;end loop;
 update public.pagamentos set desconto=p_bruto-r where id=pid;return pid;end$$;
create function public.cancel_payment(p_id uuid) returns void language plpgsql security definer set search_path='' as $$declare p public.pagamentos;a record;begin
 select * into p from public.pagamentos where id=p_id;
 if not public.is_admin(p.obra_id) then raise exception 'Sem permissão';end if;
 perform 1 from public.contratos_mao_de_obra where id=p.contrato_id for update;
 select * into p from public.pagamentos where id=p_id for update;
 if p.anulado then raise exception 'Pagamento já estornado';end if;
 for a in select * from public.pagamento_descontos where pagamento_id=p.id loop
 update public.descontos_profissional set aplicado=aplicado-a.valor where id=a.desconto_id;end loop;
 update public.pagamentos set anulado=true where id=p.id;end$$;
create function public.revise_payment(p_id uuid,p_servico uuid,p_data date,p_bruto bigint,p_referencia text,p_forma text,p_modo text,p_final boolean) returns uuid language plpgsql security definer set search_path='' as $$declare c uuid;begin
 select contrato_id into c from public.pagamentos where id=p_id;
 perform public.cancel_payment(p_id);
 return public.record_payment(c,p_servico,p_data,p_bruto,p_referencia,p_forma,p_modo,p_final);end$$;
create function public.can_attach(p_obra uuid,p_entity text,p_id uuid) returns boolean language plpgsql stable security definer set search_path='' as $$declare found_row boolean;begin
 if not public.is_member(p_obra) or p_entity not in ('gastos','contratos_mao_de_obra','pagamentos','descontos_profissional','ocorrencias') then return false;end if;
 if p_entity<>'ocorrencias' and not public.is_admin(p_obra) then return false;end if;
 execute format('select exists(select 1 from public.%I where id=$1 and obra_id=$2)',p_entity) into found_row using p_id,p_obra;return found_row;end$$;
create function public.validate_attachment() returns trigger language plpgsql set search_path='' as $$begin
 if not public.can_attach(new.obra_id,new.entidade,new.entidade_id) or new.path<>new.obra_id::text||'/'||new.entidade||'/'||new.entidade_id::text||'/'||new.id::text then raise exception 'Anexo inválido';end if;return new;end$$;
create trigger validate_attachment before insert on public.anexos for each row execute function public.validate_attachment();
alter table public.profiles enable row level security;
alter table public.obras enable row level security;
alter table public.obra_membros enable row level security;
alter table public.convites enable row level security;
alter table public.rate_limits enable row level security;
create policy self_read on public.profiles for select to authenticated using(id=auth.uid());
create policy self_insert on public.profiles for insert to authenticated with check(id=auth.uid());
create policy self_update on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
create policy obra_read on public.obras for select to authenticated using(public.is_member(id));
create policy obra_create on public.obras for insert to authenticated with check(criado_por=auth.uid());
create policy obra_edit on public.obras for update to authenticated using(public.is_admin(id)) with check(public.is_admin(id));
create policy members_read on public.obra_membros for select to authenticated using(public.is_member(obra_id));
create policy invite_read on public.convites for select to authenticated using(public.is_admin(obra_id));
create policy invite_create on public.convites for insert to authenticated with check(public.is_admin(obra_id) and criado_por=auth.uid() and usado_em is null and not revogado and expira_em<=now()+interval '7 days');
create policy invite_revoke on public.convites for update to authenticated using(public.is_admin(obra_id)) with check(public.is_admin(obra_id));
alter table public.gastos enable row level security;
create policy member_read on public.gastos for select to authenticated using(public.is_member(obra_id));
create index gastos_obra_idx on public.gastos(obra_id);
create policy allowed_insert on public.gastos for insert to authenticated with check((public.is_admin(obra_id)) and criado_por=auth.uid());
create policy admin_update on public.gastos for update to authenticated using(public.is_admin(obra_id)) with check(public.is_admin(obra_id));
create policy admin_delete on public.gastos for delete to authenticated using(public.is_admin(obra_id));
create trigger audit_changes after insert or update or delete on public.gastos for each row execute function public.audit_change();
alter table public.contratos_mao_de_obra enable row level security;
create policy member_read on public.contratos_mao_de_obra for select to authenticated using(public.is_member(obra_id));
create index contratos_mao_de_obra_obra_idx on public.contratos_mao_de_obra(obra_id);
create policy allowed_insert on public.contratos_mao_de_obra for insert to authenticated with check((public.is_admin(obra_id)) and criado_por=auth.uid());
create policy admin_update on public.contratos_mao_de_obra for update to authenticated using(public.is_admin(obra_id)) with check(public.is_admin(obra_id));
create trigger audit_changes after insert or update or delete on public.contratos_mao_de_obra for each row execute function public.audit_change();
alter table public.servicos enable row level security;
create policy member_read on public.servicos for select to authenticated using(public.is_member(obra_id));
create index servicos_obra_idx on public.servicos(obra_id);
create policy allowed_insert on public.servicos for insert to authenticated with check((public.is_admin(obra_id)) and criado_por=auth.uid());
create policy admin_update on public.servicos for update to authenticated using(public.is_admin(obra_id)) with check(public.is_admin(obra_id));
create policy admin_delete on public.servicos for delete to authenticated using(public.is_admin(obra_id));
create trigger audit_changes after insert or update or delete on public.servicos for each row execute function public.audit_change();
alter table public.execucoes enable row level security;
create policy member_read on public.execucoes for select to authenticated using(public.is_member(obra_id));
create index execucoes_obra_idx on public.execucoes(obra_id);
create trigger audit_changes after insert or update or delete on public.execucoes for each row execute function public.audit_change();
alter table public.pagamentos enable row level security;
create policy member_read on public.pagamentos for select to authenticated using(public.is_member(obra_id));
create index pagamentos_obra_idx on public.pagamentos(obra_id);
create trigger audit_changes after insert or update or delete on public.pagamentos for each row execute function public.audit_change();
alter table public.descontos_profissional enable row level security;
create policy member_read on public.descontos_profissional for select to authenticated using(public.is_member(obra_id));
create index descontos_profissional_obra_idx on public.descontos_profissional(obra_id);
create policy allowed_insert on public.descontos_profissional for insert to authenticated with check((public.is_admin(obra_id)) and criado_por=auth.uid());
create trigger audit_changes after insert or update or delete on public.descontos_profissional for each row execute function public.audit_change();
alter table public.ocorrencias enable row level security;
create policy member_read on public.ocorrencias for select to authenticated using(public.is_member(obra_id));
create index ocorrencias_obra_idx on public.ocorrencias(obra_id);
create policy allowed_insert on public.ocorrencias for insert to authenticated with check((public.is_member(obra_id) and status='aberto') and criado_por=auth.uid());
create policy admin_update on public.ocorrencias for update to authenticated using(public.is_admin(obra_id)) with check(public.is_admin(obra_id));
create policy admin_delete on public.ocorrencias for delete to authenticated using(public.is_admin(obra_id));
create trigger audit_changes after insert or update or delete on public.ocorrencias for each row execute function public.audit_change();
alter table public.anexos enable row level security;
create policy member_read on public.anexos for select to authenticated using(public.is_member(obra_id));
create index anexos_obra_idx on public.anexos(obra_id);
create policy allowed_insert on public.anexos for insert to authenticated with check((public.can_attach(obra_id,entidade,entidade_id)) and criado_por=auth.uid());
create policy admin_delete on public.anexos for delete to authenticated using(public.is_admin(obra_id));
create trigger audit_changes after insert or update or delete on public.anexos for each row execute function public.audit_change();
alter table public.audit_logs enable row level security;
create policy member_read on public.audit_logs for select to authenticated using(public.is_member(obra_id));
create index audit_logs_obra_idx on public.audit_logs(obra_id);

create index convites_obra_idx on public.convites(obra_id);
create index gastos_filters_idx on public.gastos(obra_id,data_compra,categoria,status_entrega);
create index ocorrencias_timeline_idx on public.ocorrencias(obra_id,data desc);
create index servicos_contrato_idx on public.servicos(contrato_id);
create index pagamentos_contrato_idx on public.pagamentos(contrato_id);
-- Remove default broad privileges. Sensitive mutations are only available through RPC.
revoke all on public.profiles,public.obras,public.obra_membros,public.convites,public.gastos,public.contratos_mao_de_obra,public.servicos,public.execucoes,public.pagamentos,public.descontos_profissional,public.pagamento_descontos,public.ocorrencias,public.anexos,public.audit_logs,public.rate_limits from anon,authenticated;
grant select on public.pagamento_descontos,public.profiles,public.obras,public.obra_membros,public.convites,public.gastos,public.contratos_mao_de_obra,public.servicos,public.execucoes,public.pagamentos,public.descontos_profissional,public.ocorrencias,public.anexos,public.audit_logs to authenticated;
grant insert(nome,orcamento) on public.obras to authenticated;
grant update(nome,orcamento) on public.obras to authenticated;
grant insert(id,nome),update(nome) on public.profiles to authenticated;
grant insert(obra_id,token_hash,role) on public.convites to authenticated;
grant update(revogado) on public.convites to authenticated;
grant insert(obra_id,categoria,descricao,fornecedor,quantidade,valor_unitario,data_compra,data_entrega,forma_pagamento,observacoes,status_entrega) on public.gastos to authenticated;
grant update(categoria,descricao,fornecedor,quantidade,valor_unitario,data_compra,data_entrega,forma_pagamento,observacoes,status_entrega) on public.gastos to authenticated;
grant insert(obra_id,profissional,tipo,valor_geral) on public.contratos_mao_de_obra to authenticated;
grant update(profissional,tipo,valor_geral) on public.contratos_mao_de_obra to authenticated;
grant insert(obra_id,contrato_id,nome,descricao,categoria,peso) on public.servicos to authenticated;
grant update(nome,descricao,categoria,peso) on public.servicos to authenticated;
grant insert(obra_id,contrato_id,descricao,valor,aplicacao) on public.descontos_profissional to authenticated;
grant insert(obra_id,titulo,descricao,tipo,data,servico_id,responsavel) on public.ocorrencias to authenticated;
grant update(titulo,descricao,tipo,data,servico_id,responsavel,status) on public.ocorrencias to authenticated;
grant insert(id,obra_id,entidade,entidade_id,path,mime,tamanho) on public.anexos to authenticated;
grant delete on public.gastos,public.servicos,public.ocorrencias,public.anexos to authenticated;
-- Restrict only this application's functions; preserve unrelated project grants.
do $permissions$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('is_member','is_admin','init_obra','consume_rate','audit_change','accept_invite','remove_member','activate_plan','lock_plan','protect_contract','record_execution','record_payment','cancel_payment','revise_payment','can_attach','validate_attachment') loop
 execute format('revoke execute on function %s from public,anon,authenticated',f.signature);
 end loop;
end $permissions$;
grant execute on function public.cancel_payment(uuid),public.revise_payment(uuid,uuid,date,bigint,text,text,text,boolean),public.is_member(uuid),public.is_admin(uuid),public.can_attach(uuid,text,uuid),public.accept_invite(text),public.remove_member(uuid,uuid),public.activate_plan(uuid),public.record_execution(uuid,date,integer,text),public.record_payment(uuid,uuid,date,bigint,text,text,text,boolean) to authenticated;
grant execute on function public.consume_rate(text,integer) to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('obra-anexos','obra-anexos',false,4194304,array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf','application/xml','text/xml']);
create policy attachment_read on storage.objects for select to authenticated using(bucket_id='obra-anexos' and exists(select 1 from public.anexos a where a.path=name and public.is_member(a.obra_id)));
-- Browser writes are intentionally denied: upload endpoint validates bytes with service-role,
-- after checking membership with the user's session. Metadata remains subject to RLS.
commit;

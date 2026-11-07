begin;
alter table public.contratos_mao_de_obra add column itens_ativo boolean not null default false;
create table public.empreitada_itens(
 id uuid primary key default gen_random_uuid(),obra_id uuid not null references public.obras on delete cascade,contrato_id uuid not null,
 nome text not null check(length(trim(nome)) between 1 and 300),descricao text not null default '' check(length(descricao)<=4000),categoria text not null default 'Serviço (mão de obra)',
 unidade text not null default 'serviço' check(unidade in ('serviço','m²','m','m³','un','diária')),quantidade numeric(14,4) not null default 1 check(quantidade>0 and quantidade<=1000000),
 classe text not null default 'incluido' check(classe in ('incluido','extra')),aprovado boolean not null default false,valor_cobrado bigint check(valor_cobrado between 0 and 100000000000),
 percentual_executado integer not null default 0 check(percentual_executado between 0 and 100),arquivado boolean not null default false,
 valor_estimado bigint check(valor_estimado between 0 and 100000000000),estimado_minimo bigint,estimado_maximo bigint,estimativa_json jsonb,pesquisado_em timestamptz,
 criado_por uuid not null default auth.uid() references auth.users,criado_em timestamptz not null default now(),
 unique(obra_id,contrato_id,id),foreign key(obra_id,contrato_id) references public.contratos_mao_de_obra(obra_id,id),check(classe<>'extra' or not aprovado or valor_cobrado is not null)
);
create unique index empreitada_item_nome on public.empreitada_itens(contrato_id,lower(trim(nome)),classe) where not arquivado;
create index empreitada_item_contrato on public.empreitada_itens(obra_id,contrato_id);
create table public.empreitada_execucoes(id uuid primary key default gen_random_uuid(),obra_id uuid not null references public.obras on delete cascade,contrato_id uuid not null,item_id uuid not null,data date not null,percentual integer not null check(percentual between 0 and 100),observacoes text not null default '',criado_por uuid not null default auth.uid() references auth.users,criado_em timestamptz not null default now(),foreign key(obra_id,contrato_id,item_id) references public.empreitada_itens(obra_id,contrato_id,id));
alter table public.pagamentos add column item_id uuid;
alter table public.pagamentos add constraint pagamento_item_fk foreign key(obra_id,contrato_id,item_id) references public.empreitada_itens(obra_id,contrato_id,id);
do $$declare c record;begin for c in select conname from pg_constraint where conrelid='public.pagamentos'::regclass and contype='c' and pg_get_constraintdef(oid) like '%servico_id IS NOT NULL%' loop execute format('alter table public.pagamentos drop constraint %I',c.conname);end loop;end$$;
alter table public.pagamentos add constraint pagamento_servico_ou_item check(modo<>'servico' or servico_id is not null or item_id is not null);
create table public.pagamento_itens(id uuid primary key default gen_random_uuid(),obra_id uuid not null references public.obras on delete cascade,contrato_id uuid not null,pagamento_id uuid not null,item_id uuid not null,valor_bruto bigint not null check(valor_bruto>=0),desconto bigint not null default 0 check(desconto between 0 and valor_bruto),criado_em timestamptz not null default now(),unique(pagamento_id,item_id),foreign key(obra_id,pagamento_id) references public.pagamentos(obra_id,id),foreign key(obra_id,contrato_id,item_id) references public.empreitada_itens(obra_id,contrato_id,id));
create table public.empreitada_importacoes(id uuid primary key,obra_id uuid not null references public.obras on delete cascade,contrato_id uuid not null,criado_por uuid not null default auth.uid() references auth.users,criado_em timestamptz not null default now(),foreign key(obra_id,contrato_id) references public.contratos_mao_de_obra(obra_id,id));
do $$declare t text;begin foreach t in array array['empreitada_itens','empreitada_execucoes','pagamento_itens','empreitada_importacoes'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy member_read on public.%I for select to authenticated using(public.is_member(obra_id))',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create trigger audit_changes after insert or update or delete on public.%I for each row execute function public.audit_change()',t);
 end loop;end$$;
create function public.contract_item_budget(p_contrato uuid) returns bigint language sql stable security definer set search_path='' as $$select c.valor_geral+case when c.itens_ativo then coalesce((select sum(i.valor_cobrado) from public.empreitada_itens i where i.contrato_id=c.id and i.classe='extra' and i.aprovado and not i.arquivado),0) else 0 end from public.contratos_mao_de_obra c where c.id=p_contrato$$;
create function public.adopt_contract_items(p_contrato uuid) returns void language plpgsql security definer set search_path='' as $$declare c public.contratos_mao_de_obra;begin
 select * into c from public.contratos_mao_de_obra where id=p_contrato for update;
 if c.id is null or not public.is_admin(c.obra_id) then raise exception 'Sem permissão';end if;
 if c.tipo<>'empreitada' then raise exception 'A tabela é exclusiva de empreitadas';end if;
 if c.itens_ativo then return;end if;
 insert into public.empreitada_itens(id,obra_id,contrato_id,nome,descricao,categoria,unidade,quantidade,classe,aprovado,valor_cobrado,percentual_executado)
 select s.id,s.obra_id,s.contrato_id,case when count(*) over(partition by lower(trim(s.nome)))>1 then left(s.nome,260)||' · etapa '||(row_number() over(partition by lower(trim(s.nome)) order by s.criado_em,s.id))::text else s.nome end,s.descricao,s.categoria,s.unidade,s.quantidade,'incluido',true,floor(c.valor_geral::numeric*s.peso/10000)::bigint,s.percentual_executado from public.servicos s where s.contrato_id=c.id;
 if (select coalesce(sum(peso),0) from public.servicos where contrato_id=c.id)=10000 then
  with ranked as(select s.id,row_number() over(order by (c.valor_geral::numeric*s.peso/10000-floor(c.valor_geral::numeric*s.peso/10000)) desc,s.id) n from public.servicos s where s.contrato_id=c.id),missing as(select c.valor_geral-coalesce(sum(valor_cobrado),0) amount from public.empreitada_itens where contrato_id=c.id)
  update public.empreitada_itens i set valor_cobrado=i.valor_cobrado+1 from ranked r,missing m where i.id=r.id and r.n<=m.amount;
 end if;
 update public.pagamentos p set item_id=p.servico_id where p.contrato_id=c.id and p.servico_id is not null and exists(select 1 from public.empreitada_itens i where i.id=p.servico_id and i.contrato_id=c.id);
 insert into public.pagamento_itens(obra_id,contrato_id,pagamento_id,item_id,valor_bruto,desconto) select p.obra_id,p.contrato_id,p.id,p.item_id,p.valor_bruto,p.desconto from public.pagamentos p where p.contrato_id=c.id and p.item_id is not null;
 update public.contratos_mao_de_obra set itens_ativo=true where id=c.id;
end$$;
create function public.save_contract_items(p_contrato uuid,p_itens jsonb,p_lote uuid,p_importar_pagamentos boolean default false) returns void language plpgsql security definer set search_path='' as $$declare c public.contratos_mao_de_obra;j jsonb;old_item public.empreitada_itens;iid uuid;is_new boolean;paid bigint;budget bigint;pid uuid;progress integer;invalidate boolean;begin
 select * into c from public.contratos_mao_de_obra where id=p_contrato for update;
 if c.id is null or not public.is_admin(c.obra_id) then raise exception 'Sem permissão';end if;
 if p_itens is null or jsonb_typeof(p_itens)<>'array' or jsonb_array_length(p_itens) not between 1 and 60 or p_lote is null then raise exception 'Lista inválida';end if;
 if exists(select 1 from public.empreitada_importacoes where id=p_lote and contrato_id=c.id) then return;end if;
 if exists(select 1 from public.empreitada_importacoes where id=p_lote) then raise exception 'Lote inválido';end if;
 perform public.adopt_contract_items(c.id);
 insert into public.empreitada_importacoes(id,obra_id,contrato_id) values(p_lote,c.obra_id,c.id);
 for j in select value from jsonb_array_elements(p_itens) loop
  iid:=nullif(j->>'id','')::uuid;is_new:=iid is null;progress:=coalesce((j->>'percentual_executado')::integer,0);
  if not is_new then
   select * into old_item from public.empreitada_itens where id=iid and contrato_id=c.id and not arquivado for update;
   if old_item.id is null then raise exception 'Item inválido';end if;
   invalidate:=old_item.nome<>trim(j->>'nome') or old_item.descricao<>coalesce(j->>'descricao','') or old_item.unidade<>coalesce(j->>'unidade','serviço') or old_item.quantidade<>coalesce((j->>'quantidade')::numeric,1);
   if progress<old_item.percentual_executado then raise exception 'Não reduza avanço já registrado';end if;
   if (old_item.classe<>j->>'classe' or (old_item.aprovado and not coalesce((j->>'aprovado')::boolean,false))) and (old_item.percentual_executado>0 or exists(select 1 from public.pagamento_itens where item_id=iid)) then raise exception 'Item com execução/pagamento: preserve classificação e aprovação';end if;
  else iid:=gen_random_uuid();end if;
  if is_new then
   insert into public.empreitada_itens(id,obra_id,contrato_id,nome,descricao,unidade,quantidade,classe,aprovado,valor_cobrado,percentual_executado) values(iid,c.obra_id,c.id,trim(j->>'nome'),coalesce(j->>'descricao',''),coalesce(j->>'unidade','serviço'),coalesce((j->>'quantidade')::numeric,1),j->>'classe',case when j->>'classe'='incluido' then true else coalesce((j->>'aprovado')::boolean,false) end,nullif(j->>'valor_cobrado','')::bigint,progress);
  else
   update public.empreitada_itens set nome=trim(j->>'nome'),descricao=coalesce(j->>'descricao',''),unidade=coalesce(j->>'unidade','serviço'),quantidade=coalesce((j->>'quantidade')::numeric,1),classe=j->>'classe',aprovado=case when j->>'classe'='incluido' then true else coalesce((j->>'aprovado')::boolean,false) end,valor_cobrado=nullif(j->>'valor_cobrado','')::bigint,percentual_executado=progress,
    valor_estimado=case when invalidate then null else old_item.valor_estimado end,
    estimado_minimo=case when invalidate then null else old_item.estimado_minimo end,estimado_maximo=case when invalidate then null else old_item.estimado_maximo end,pesquisado_em=case when invalidate then null else old_item.pesquisado_em end,
    estimativa_json=case when invalidate then null else old_item.estimativa_json end
    where id=iid;
  end if;
  if progress>0 and (is_new or progress>old_item.percentual_executado) then insert into public.empreitada_execucoes(obra_id,contrato_id,item_id,data,percentual,observacoes) values(c.obra_id,c.id,iid,current_date,progress,'Avanço registrado na tabela de serviços');end if;
 end loop;
 if (select coalesce(sum(valor_cobrado),0) from public.empreitada_itens where contrato_id=c.id and classe='incluido' and not arquivado)>c.valor_geral then raise exception 'Itens incluídos excedem a empreitada. Redistribua valores ou classifique extras';end if;
 budget:=public.contract_item_budget(c.id);
 if budget>100000000000 or budget<coalesce((select sum(valor_bruto) from public.pagamentos where contrato_id=c.id and not anulado),0) then raise exception 'Total incompatível com pagamentos já registrados';end if;
 if p_importar_pagamentos then
  for j in select value from jsonb_array_elements(p_itens) loop
   paid:=coalesce((j->>'valor_pago_informado')::bigint,0);if paid<0 then raise exception 'Pagamento inválido';end if;
   if paid>0 then
    if nullif(j->>'id','') is not null then raise exception 'Pagamento importado só para item novo; vincule pagamentos existentes';end if;
    select * into old_item from public.empreitada_itens where contrato_id=c.id and lower(trim(nome))=lower(trim(j->>'nome')) and classe=j->>'classe' and not arquivado;
    if old_item.classe='extra' and not old_item.aprovado then raise exception 'Aprove o extra antes de registrar pagamento';end if;
    if paid>budget-coalesce((select sum(valor_bruto) from public.pagamentos where contrato_id=c.id and not anulado),0) then raise exception 'Pagamentos do arquivo excedem o saldo';end if;
    insert into public.pagamentos(obra_id,contrato_id,item_id,data,valor_bruto,desconto,referencia,forma_pagamento,modo) values(c.obra_id,c.id,old_item.id,coalesce(nullif(j->>'data_pagamento','')::date,current_date),paid,0,'Importação revisada de texto — líquido histórico sem desconto informado','Informada no arquivo','servico') returning id into pid;
    insert into public.pagamento_itens(obra_id,contrato_id,pagamento_id,item_id,valor_bruto,desconto) values(c.obra_id,c.id,pid,old_item.id,paid,0);
   end if;
  end loop;
 end if;
end$$;
create function public.archive_contract_item(p_item uuid) returns void language plpgsql security definer set search_path='' as $$declare i public.empreitada_itens;begin
 select * into i from public.empreitada_itens where id=p_item;
 if i.id is null or not public.is_admin(i.obra_id) then raise exception 'Sem permissão';end if;
 perform 1 from public.contratos_mao_de_obra where id=i.contrato_id for update;
 select * into i from public.empreitada_itens where id=p_item for update;
 if i.percentual_executado>0 or exists(select 1 from public.pagamento_itens where item_id=i.id) then raise exception 'Preserve item com execução ou pagamentos';end if;
 update public.empreitada_itens set arquivado=true where id=i.id;
 if public.contract_item_budget(i.contrato_id)<coalesce((select sum(valor_bruto) from public.pagamentos where contrato_id=i.contrato_id and not anulado),0) then raise exception 'Saldo comprometido por pagamentos';end if;
end$$;
create function public.allocate_contract_payment(p_pagamento uuid,p_item uuid,p_bruto bigint,p_desconto bigint) returns void language plpgsql security definer set search_path='' as $$declare p public.pagamentos;i public.empreitada_itens;begin
 select * into p from public.pagamentos where id=p_pagamento;
 if p.id is null or not public.is_admin(p.obra_id) then raise exception 'Sem permissão';end if;
 perform 1 from public.contratos_mao_de_obra where id=p.contrato_id for update;
 select * into p from public.pagamentos where id=p_pagamento for update;
 select * into i from public.empreitada_itens where id=p_item and contrato_id=p.contrato_id and not arquivado;
 if p.anulado or i.id is null or (i.classe='extra' and not i.aprovado) or p_bruto<0 or p_desconto<0 or p_desconto>p_bruto then raise exception 'Distribuição inválida';end if;
 if p_bruto+coalesce((select sum(valor_bruto) from public.pagamento_itens where pagamento_id=p.id and item_id<>i.id),0)>p.valor_bruto or p_desconto+coalesce((select sum(desconto) from public.pagamento_itens where pagamento_id=p.id and item_id<>i.id),0)>p.desconto or (p_bruto-p_desconto)+coalesce((select sum(valor_bruto-desconto) from public.pagamento_itens where pagamento_id=p.id and item_id<>i.id),0)>p.valor then raise exception 'Distribuição excede o pagamento real';end if;
 if p_bruto=0 then delete from public.pagamento_itens where pagamento_id=p.id and item_id=i.id;
 else insert into public.pagamento_itens(obra_id,contrato_id,pagamento_id,item_id,valor_bruto,desconto) values(p.obra_id,p.contrato_id,p.id,i.id,p_bruto,p_desconto) on conflict(pagamento_id,item_id) do update set valor_bruto=excluded.valor_bruto,desconto=excluded.desconto;end if;
end$$;
create function public.save_contract_item_estimate(p_item uuid,p_actor uuid,p_mean bigint,p_min bigint,p_max bigint,p_result jsonb,p_expected jsonb default null) returns void language plpgsql security definer set search_path='' as $$declare i public.empreitada_itens;begin
 select * into i from public.empreitada_itens where id=p_item and not arquivado for update;
 if i.id is null or not exists(select 1 from public.obra_membros where obra_id=i.obra_id and user_id=p_actor and role='admin') then raise exception 'Sem permissão';end if;
 if p_expected is not null and ((p_expected->>'nome') is distinct from i.nome or (p_expected->>'descricao') is distinct from i.descricao or (p_expected->>'unidade') is distinct from i.unidade or (p_expected->>'quantidade')::numeric is distinct from i.quantidade) then raise exception 'Serviço alterado durante a pesquisa. Repita a análise';end if;
 if p_result is null or jsonb_typeof(p_result)<>'object' or octet_length(p_result::text)>100000 or (p_mean is not null and (p_min is null or p_max is null or p_mean<0 or p_min<0 or p_max<p_min or p_mean<p_min or p_mean>p_max or p_max>100000000000)) then raise exception 'Estimativa inválida';end if;
 perform set_config('request.jwt.claim.sub',p_actor::text,true);
 update public.empreitada_itens set valor_estimado=p_mean,estimado_minimo=p_min,estimado_maximo=p_max,estimativa_json=p_result,pesquisado_em=now() where id=i.id;
end$$;
create or replace function public.record_payment(p_contrato uuid,p_servico uuid,p_data date,p_bruto bigint,p_referencia text,p_forma text,p_modo text,p_final boolean default false) returns uuid language plpgsql security definer set search_path='' as $$declare c public.contratos_mao_de_obra;d public.descontos_profissional;r bigint;v bigint;pid uuid;iid uuid;sid uuid;budget bigint;begin
 select * into c from public.contratos_mao_de_obra where id=p_contrato for update;
 if c.id is null or not public.is_admin(c.obra_id) then raise exception 'Sem permissão';end if;
 budget:=public.contract_item_budget(c.id);
 if p_bruto<0 or p_bruto>budget-coalesce((select sum(valor_bruto) from public.pagamentos where contrato_id=c.id and not anulado),0) then raise exception 'Pagamento excede saldo do contrato';end if;
 if p_modo='servico' and p_servico is null then raise exception 'Serviço inválido';end if;
 if p_servico is not null then
  if c.itens_ativo then
   select id into iid from public.empreitada_itens where id=p_servico and contrato_id=c.id and not arquivado and (classe='incluido' or aprovado);
   if iid is null then raise exception 'Item inválido';end if;
   select id into sid from public.servicos where id=p_servico and contrato_id=c.id;
  else
   select id into sid from public.servicos where id=p_servico and contrato_id=c.id;
   if sid is null then raise exception 'Serviço inválido';end if;
  end if;
 end if;
 insert into public.pagamentos(obra_id,contrato_id,servico_id,item_id,data,valor_bruto,desconto,referencia,forma_pagamento,modo) values(c.obra_id,c.id,sid,iid,p_data,p_bruto,0,p_referencia,p_forma,p_modo) returning id into pid;
 r:=p_bruto;
 for d in select * from public.descontos_profissional where contrato_id=c.id and aplicado<valor and (aplicacao='semanal' or p_final) order by criado_em,id for update loop
  v:=least(r,d.valor-d.aplicado);if v>0 then insert into public.pagamento_descontos values(pid,d.id,v);end if;update public.descontos_profissional set aplicado=aplicado+v where id=d.id;r:=r-v;exit when r=0;
 end loop;
 update public.pagamentos set desconto=p_bruto-r where id=pid;
 if iid is not null then insert into public.pagamento_itens(obra_id,contrato_id,pagamento_id,item_id,valor_bruto,desconto) values(c.obra_id,c.id,pid,iid,p_bruto,p_bruto-r);end if;
 return pid;
end$$;
create or replace function public.protect_contract() returns trigger language plpgsql security definer set search_path='' as $$begin
 if (new.tipo<>old.tipo or new.valor_geral<>old.valor_geral) and (old.plano_ativo or old.itens_ativo or exists(select 1 from public.pagamentos where contrato_id=old.id and not anulado)) then raise exception 'Contrato em execução: mantenha valor original e registre extras aprovados';end if;return new;end$$;
create or replace function public.lock_plan() returns trigger language plpgsql security definer set search_path='' as $$declare c public.contratos_mao_de_obra;begin
 select * into c from public.contratos_mao_de_obra where id=coalesce(new.contrato_id,old.contrato_id) for update;
 if c.itens_ativo then raise exception 'Plano antigo preservado: use a tabela de serviços da empreitada';end if;
 if c.plano_ativo and (tg_op<>'UPDATE' or new.peso<>old.peso or new.contrato_id<>old.contrato_id or new.unidade<>old.unidade or new.quantidade<>old.quantidade) then raise exception 'Plano ativo: pesos e medições imutáveis';end if;return coalesce(new,old);end$$;
do $$declare f record;begin for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('contract_item_budget','adopt_contract_items','save_contract_items','archive_contract_item','allocate_contract_payment','save_contract_item_estimate') loop execute format('revoke execute on function %s from public,anon,authenticated',f.signature);end loop;end$$;
grant execute on function public.adopt_contract_items(uuid),public.save_contract_items(uuid,jsonb,uuid,boolean),public.archive_contract_item(uuid),public.allocate_contract_payment(uuid,uuid,bigint,bigint) to authenticated;
grant execute on function public.save_contract_item_estimate(uuid,uuid,bigint,bigint,bigint,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
commit;

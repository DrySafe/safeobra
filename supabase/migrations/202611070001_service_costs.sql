begin;
alter table public.servicos add column unidade text not null default 'serviço' check(unidade in ('serviço','m²','m','m³','un','diária'));
alter table public.servicos add column quantidade numeric(14,4) not null default 1 check(quantidade>0 and quantidade<=1000000);
grant insert(unidade,quantidade),update(unidade,quantidade) on public.servicos to authenticated;
create or replace function public.lock_plan() returns trigger language plpgsql security definer set search_path='' as $$declare c public.contratos_mao_de_obra;begin
 select * into c from public.contratos_mao_de_obra where id=coalesce(new.contrato_id,old.contrato_id) for update;
 if c.plano_ativo and (tg_op<>'UPDATE' or new.peso<>old.peso or new.contrato_id<>old.contrato_id or new.unidade<>old.unidade or new.quantidade<>old.quantidade) then raise exception 'Plano ativo: pesos e medições imutáveis';end if;return coalesce(new,old);end$$;
create table public.referencias_servicos(
 id uuid primary key default gen_random_uuid(),
 obra_id uuid not null references public.obras on delete cascade,
 nome text not null check(length(trim(nome)) between 1 and 300),
 categoria text not null check(categoria in ('Alvenaria','Elétrica','Hidráulica','Transporte','Decoração','Serviço (mão de obra)','Extras')),
 unidade text not null check(unidade in ('serviço','m²','m','m³','un','diária')),
 valor_unitario bigint not null check(valor_unitario>0 and valor_unitario<=100000000000),
 fonte text not null check(length(trim(fonte)) between 1 and 300),
 data_referencia date not null,
 regiao text not null default 'Obra atual' check(length(trim(regiao)) between 1 and 300),
 criado_por uuid not null default auth.uid() references auth.users,
 criado_em timestamptz not null default now()
);
alter table public.referencias_servicos enable row level security;
create policy member_read on public.referencias_servicos for select to authenticated using(public.is_member(obra_id));
create policy admin_insert on public.referencias_servicos for insert to authenticated with check(public.is_admin(obra_id) and criado_por=auth.uid());
create policy admin_update on public.referencias_servicos for update to authenticated using(public.is_admin(obra_id)) with check(public.is_admin(obra_id));
create policy admin_delete on public.referencias_servicos for delete to authenticated using(public.is_admin(obra_id));
create index referencias_servicos_obra_idx on public.referencias_servicos(obra_id);
create trigger audit_changes after insert or update or delete on public.referencias_servicos for each row execute function public.audit_change();
revoke all on public.referencias_servicos from anon,authenticated;
grant select,delete on public.referencias_servicos to authenticated;
grant insert(obra_id,nome,categoria,unidade,valor_unitario,fonte,data_referencia,regiao),update(nome,categoria,unidade,valor_unitario,fonte,data_referencia,regiao) on public.referencias_servicos to authenticated;
notify pgrst,'reload schema';
commit;

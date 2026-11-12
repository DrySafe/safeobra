begin;

create table public.orcamento_grupos (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obras on delete cascade,
  nome text not null check (length(trim(nome)) between 1 and 300),
  descricao text not null default '' check (length(descricao)<=2000),
  criado_por uuid not null default auth.uid() references auth.users,
  criado_em timestamptz not null default now(),
  unique(obra_id,id)
);
create table public.orcamento_propostas (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obras on delete cascade,
  grupo_id uuid not null,
  empresa text not null check (length(trim(empresa)) between 1 and 300),
  itens text not null check (length(trim(itens)) between 1 and 2000),
  valor_total bigint not null check (valor_total between 1 and 100000000000),
  prazo text not null default '' check (length(prazo)<=300),
  condicoes text not null default '' check (length(condicoes)<=2000),
  observacoes text not null default '' check (length(observacoes)<=2000),
  selecionada boolean not null default false,
  criado_por uuid not null default auth.uid() references auth.users,
  criado_em timestamptz not null default now(),
  foreign key (obra_id,grupo_id) references public.orcamento_grupos(obra_id,id)
);
create index orcamento_grupos_obra_idx on public.orcamento_grupos(obra_id);
create index orcamento_propostas_grupo_idx on public.orcamento_propostas(obra_id,grupo_id);

alter table public.orcamento_grupos enable row level security;
alter table public.orcamento_propostas enable row level security;
do $quotes$
declare t text;
begin
  foreach t in array array['orcamento_grupos','orcamento_propostas'] loop
    execute format('create policy member_read on public.%I for select to authenticated using(public.is_member(obra_id))',t);
    execute format('create policy admin_insert on public.%I for insert to authenticated with check(public.is_admin(obra_id) and criado_por=auth.uid())',t);
    execute format('create policy admin_update on public.%I for update to authenticated using(public.is_admin(obra_id)) with check(public.is_admin(obra_id))',t);
    execute format('create trigger audit_changes after insert or update on public.%I for each row execute function public.audit_change()',t);
  end loop;
end $quotes$;
revoke all on public.orcamento_grupos,public.orcamento_propostas from public,anon,authenticated;
grant select on public.orcamento_grupos,public.orcamento_propostas to authenticated;
grant insert(obra_id,nome,descricao),update(nome,descricao) on public.orcamento_grupos to authenticated;
grant insert(obra_id,grupo_id,empresa,itens,valor_total,prazo,condicoes,observacoes) on public.orcamento_propostas to authenticated;
grant update(empresa,itens,valor_total,prazo,condicoes,observacoes,selecionada) on public.orcamento_propostas to authenticated;

alter table public.anexos drop constraint anexos_entidade_check;
alter table public.anexos add constraint anexos_entidade_check check (
  entidade in ('gastos','contratos_mao_de_obra','pagamentos','descontos_profissional','ocorrencias','orcamento_propostas')
);
create or replace function public.can_attach(p_obra uuid,p_entity text,p_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare found_row boolean;
begin
  if not public.is_member(p_obra) or p_entity not in ('gastos','contratos_mao_de_obra','pagamentos','descontos_profissional','ocorrencias','orcamento_propostas') then return false;end if;
  if p_entity<>'ocorrencias' and not public.is_admin(p_obra) then return false;end if;
  execute format('select exists(select 1 from public.%I where id=$1 and obra_id=$2)',p_entity) into found_row using p_id,p_obra;
  return found_row;
end $$;

commit;

begin;

-- Operação interna: devolve somente este desconto, preservando bruto, outros
-- descontos, IDs, comprovantes e pagamentos estornados. Repetir não duplica valores.
create function public.defer_applied_discount(p_obra uuid,p_desconto uuid)
returns bigint language plpgsql security definer set search_path='' as $$
declare d public.descontos_profissional; p record; total bigint; allocated bigint; remaining bigint;
begin
  select * into d from public.descontos_profissional where id=p_desconto and obra_id=p_obra;
  if not found then raise exception 'Desconto não encontrado'; end if;
  perform 1 from public.contratos_mao_de_obra where id=d.contrato_id and obra_id=p_obra for update;
  select * into d from public.descontos_profissional where id=p_desconto and obra_id=p_obra for update;
  select coalesce(sum(pd.valor),0) into total from public.pagamento_descontos pd
    join public.pagamentos pa on pa.id=pd.pagamento_id
    where pd.desconto_id=d.id and not pa.anulado;
  if total<>d.aplicado then raise exception 'Confira os vínculos do desconto antes de corrigir'; end if;
  for p in select pa.*,pd.valor as refund from public.pagamento_descontos pd
    join public.pagamentos pa on pa.id=pd.pagamento_id
    where pd.desconto_id=d.id and not pa.anulado order by pa.id for update of pa
  loop
    if p.obra_id<>p_obra or p.contrato_id<>d.contrato_id or p.refund>p.desconto
      then raise exception 'Vínculo de desconto inválido'; end if;
    perform 1 from public.pagamento_itens where pagamento_id=p.id for update;
    select coalesce(sum(desconto),0) into allocated from public.pagamento_itens where pagamento_id=p.id;
    if allocated>p.desconto then raise exception 'Confira a distribuição do pagamento'; end if;
    remaining:=p.desconto-p.refund;
    -- Mantém a proporção entre serviços já vinculados e a parte a distribuir.
    -- Maiores restos distribuem os centavos sem criar ou perder dinheiro.
    with portions as (
      select id,desconto as amount from public.pagamento_itens where pagamento_id=p.id
      union all select null::uuid,p.desconto-allocated
    ), scaled as (
      select id,floor(amount::numeric*remaining/p.desconto)::bigint as base,
        mod(amount::numeric*remaining,p.desconto) as remainder from portions
    ), ranked as (
      select id,base,row_number() over(order by remainder desc,id nulls last) as rank,
        remaining-sum(base) over() as extra from scaled
    ) update public.pagamento_itens a set desconto=r.base+case when r.rank<=r.extra then 1 else 0 end
      from ranked r where a.id=r.id;
    delete from public.pagamento_descontos where pagamento_id=p.id and desconto_id=d.id;
    update public.pagamentos set desconto=remaining where id=p.id;
  end loop;
  update public.descontos_profissional set aplicado=0,aplicacao='final' where id=d.id;
  return total;
end;
$$;
revoke all on function public.defer_applied_discount(uuid,uuid) from public,anon,authenticated;
grant execute on function public.defer_applied_discount(uuid,uuid) to service_role;

create function public.revise_discount(p_obra uuid,p_desconto uuid,p_descricao text,p_valor bigint,p_aplicacao text,p_devolver boolean default false)
returns bigint language plpgsql security definer set search_path='' as $$
declare d public.descontos_profissional; returned bigint:=0;
begin
  if not public.is_admin(p_obra) then raise exception 'Sem permissão'; end if;
  select * into d from public.descontos_profissional where id=p_desconto and obra_id=p_obra;
  if not found then raise exception 'Desconto não encontrado'; end if;
  perform 1 from public.contratos_mao_de_obra where id=d.contrato_id and obra_id=p_obra for update;
  select * into d from public.descontos_profissional where id=p_desconto and obra_id=p_obra for update;
  if p_devolver and p_aplicacao<>'final' then raise exception 'Escolha fechamento final para devolver o desconto'; end if;
  if p_aplicacao='final' and (d.aplicacao<>'final' or p_devolver) then
    returned:=public.defer_applied_discount(p_obra,p_desconto);
  end if;
  perform public.update_discount(p_obra,p_desconto,p_descricao,p_valor,p_aplicacao);
  return returned;
end;
$$;
revoke all on function public.revise_discount(uuid,uuid,text,bigint,text,boolean) from public,anon;
grant execute on function public.revise_discount(uuid,uuid,text,bigint,text,boolean) to authenticated;

commit;

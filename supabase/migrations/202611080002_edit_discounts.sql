begin;

-- A edição compartilha a trava do contrato usada pelos pagamentos e estornos.
-- Apenas descrição, valor total e destino do saldo pendente podem mudar.
create function public.update_discount(
  p_obra uuid, p_desconto uuid, p_descricao text, p_valor bigint, p_aplicacao text
) returns void language plpgsql security definer set search_path = '' as $$
declare d public.descontos_profissional;
begin
  if not public.is_admin(p_obra) then raise exception 'Sem permissão'; end if;
  select * into d from public.descontos_profissional where id=p_desconto and obra_id=p_obra;
  if not found then raise exception 'Desconto não encontrado'; end if;
  perform 1 from public.contratos_mao_de_obra where id=d.contrato_id and obra_id=p_obra for update;
  select * into d from public.descontos_profissional where id=p_desconto and obra_id=p_obra for update;
  if not found then raise exception 'Desconto não encontrado'; end if;
  if p_descricao is null or char_length(btrim(p_descricao)) not between 1 and 300
    or p_aplicacao is null or p_aplicacao not in ('semanal','final')
    or p_valor is null or p_valor<=0 or p_valor>100000000000
    then raise exception 'Confira a descrição, o valor e o fechamento'; end if;
  if p_valor<d.aplicado then raise exception 'O valor total não pode ser menor que o desconto já aplicado'; end if;
  update public.descontos_profissional
    set descricao=btrim(p_descricao),valor=p_valor,aplicacao=p_aplicacao
    where id=d.id and obra_id=p_obra;
end;
$$;

revoke all on function public.update_discount(uuid,uuid,text,bigint,text) from public,anon;
grant execute on function public.update_discount(uuid,uuid,text,bigint,text) to authenticated;

commit;

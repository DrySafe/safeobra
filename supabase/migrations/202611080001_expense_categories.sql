begin;

-- Despesas aceitam um nome livre, além das categorias sugeridas no aplicativo.
alter table public.gastos
  drop constraint gastos_categoria_check,
  add constraint gastos_categoria_check
    check (char_length(btrim(categoria)) between 1 and 300);

commit;

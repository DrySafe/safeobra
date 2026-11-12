begin;

-- Mantém os lançamentos anteriores como pagos, preservando os totais existentes.
alter table public.gastos
  add column status_pagamento text not null default 'pago'
    check (status_pagamento in ('pago','a_pagar'));

grant insert(status_pagamento),update(status_pagamento) on public.gastos to authenticated;

commit;

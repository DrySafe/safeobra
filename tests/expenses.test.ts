import { test } from "node:test";
import assert from "node:assert/strict";
import { expenseTotals } from "../src/lib/expenses.ts";

test("despesas pagas e a pagar compõem o total sem duplicação", () => {
  const rows = [
    { valor_total: 10000, status_pagamento: "pago" as const },
    { valor_total: "5000", status_pagamento: "a_pagar" as const },
  ];
  const before = expenseTotals(rows);
  assert.deepEqual(before, {
    total: 15000,
    paid: 10000,
    pending: 5000,
    pendingCount: 1,
  });
  const after = expenseTotals(
    rows.map((r) => ({ ...r, status_pagamento: "pago" })),
  );
  assert.deepEqual(after, {
    total: 15000,
    paid: 15000,
    pending: 0,
    pendingCount: 0,
  });
  assert.equal(after.total, before.total);
  assert.equal(after.paid - before.paid, before.pending);
});
test("totais recusam valores inválidos em centavos", () => {
  for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() =>
      expenseTotals([{ valor_total: value, status_pagamento: "pago" }]),
    );
});

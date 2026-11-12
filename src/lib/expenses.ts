export const expensePaymentStatuses = ["pago", "a_pagar"] as const;
export type ExpensePaymentStatus = (typeof expensePaymentStatuses)[number];

export function expenseTotals(
  expenses: {
    valor_total: number | string;
    status_pagamento: ExpensePaymentStatus;
  }[],
) {
  let paid = 0,
    pending = 0,
    pendingCount = 0;
  for (const expense of expenses) {
    const value = Number(expense.valor_total);
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error("Valor de despesa inválido");
    if (expense.status_pagamento === "pago") paid += value;
    else if (expense.status_pagamento === "a_pagar") {
      pending += value;
      pendingCount++;
    } else throw new Error("Situação de pagamento inválida");
    if (!Number.isSafeInteger(paid + pending))
      throw new Error("Total de despesas excede o limite");
  }
  return { total: paid + pending, paid, pending, pendingCount };
}

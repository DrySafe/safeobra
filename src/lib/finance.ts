export type Stage = { weight: number; progress: number };
function nonnegative(n: number) {
  if (!Number.isSafeInteger(n) || n < 0)
    throw new Error("Valor inválido em centavos");
}
export function execution(contract: number, stages: Stage[]) {
  nonnegative(contract);
  const weight = stages.reduce((s, x) => s + x.weight, 0);
  if (weight !== 10000) throw new Error("Os pesos devem somar 100%");
  for (const s of stages)
    if (
      !Number.isInteger(s.weight) ||
      s.weight < 0 ||
      !Number.isInteger(s.progress) ||
      s.progress < 0 ||
      s.progress > 100
    )
      throw new Error("Etapa inválida");
  const earned = Math.round(
    stages.reduce(
      (s, x) => s + (contract * x.weight * x.progress) / 1000000,
      0,
    ),
  );
  return {
    earned,
    progress: contract ? (earned / contract) * 100 : 0,
    remaining: contract - earned,
  };
}
export function settlement(gross: number, pendingDiscounts: number) {
  nonnegative(gross);
  nonnegative(pendingDiscounts);
  const applied = Math.min(gross, pendingDiscounts);
  return {
    gross,
    applied,
    net: gross - applied,
    carry: pendingDiscounts - applied,
  };
}
export function balance(
  contract: number,
  earned: number,
  paid: number,
  discounted: number,
) {
  [contract, earned, paid, discounted].forEach(nonnegative);
  return {
    due: Math.max(0, earned - paid - discounted),
    advance: Math.max(0, paid + discounted - earned),
    remaining: Math.max(0, contract - paid - discounted),
  };
}
export const money = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    cents / 100,
  );
export function dateBR(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Maceio",
  }).format(new Date(value.length === 10 ? value + "T12:00:00-03:00" : value));
}
export function csv(rows: unknown[][]) {
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map(
            (v) =>
              '"' +
              String(v ?? "")
                .replace(/^[=+@\-\t\r]/, "'$&")
                .replaceAll('"', '""') +
              '"',
          )
          .join(";"),
      )
      .join("\r\n")
  );
}

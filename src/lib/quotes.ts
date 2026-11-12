import type { Base } from "./models";

export type QuoteGroup = Base & { nome: string; descricao: string };
export type Quote = Base & {
  grupo_id: string;
  empresa: string;
  itens: string;
  valor_total: number;
  prazo: string;
  condicoes: string;
  observacoes: string;
  selecionada: boolean;
};

// Prices are whole centavos. Compare only proposals from the same group.
export function compareQuotes<
  T extends Pick<Quote, "id" | "empresa" | "valor_total" | "selecionada">,
>(rows: T[]) {
  let selectedTotal = 0;
  for (const row of rows) {
    if (
      !Number.isSafeInteger(Number(row.valor_total)) ||
      Number(row.valor_total) <= 0
    )
      throw new Error("Valor de orçamento inválido");
    if (row.selecionada) selectedTotal += Number(row.valor_total);
  }
  if (!Number.isSafeInteger(selectedTotal))
    throw new Error("Total de orçamento inválido");
  const ordered = [...rows].sort(
    (a, b) =>
      Number(a.valor_total) - Number(b.valor_total) ||
      a.empresa.localeCompare(b.empresa, "pt-BR") ||
      a.id.localeCompare(b.id),
  );
  return {
    ordered,
    lowest: ordered.length ? Number(ordered[0].valor_total) : null,
    selectedTotal,
    selectedCount: rows.filter((r) => r.selecionada).length,
  };
}

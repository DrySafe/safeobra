export const mainSections = [
  ["dashboard", "◫", "Resumo"],
  ["equipe", "▤", "Serviços"],
  ["gastos", "↗", "Financeiro"],
  ["diario", "▧", "Obra"],
  ["orcamentos", "≋", "Orçamentos"],
];
export function sectionFor(tab: string) {
  return tab === "estimativas"
    ? "equipe"
    : ["relatorios", "pagamentos"].includes(tab)
      ? "gastos"
      : tab === "membros"
        ? "diario"
        : tab;
}

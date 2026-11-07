export const serviceUnits = [
  "serviço",
  "m²",
  "m",
  "m³",
  "un",
  "diária",
] as const;
export type ServiceUnit = (typeof serviceUnits)[number];
export type CostSample = {
  id: string;
  nome: string;
  unidade: ServiceUnit;
  valor_unitario: number;
  fonte: string;
  data_referencia: string;
  regiao: string;
};
export function serviceKey(
  sample: Pick<CostSample, "nome" | "unidade" | "regiao">,
) {
  const clean = (text: string) =>
    text
      .trim()
      .toLocaleLowerCase("pt-BR")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ");
  return [clean(sample.nome), sample.unidade, clean(sample.regiao)].join("|");
}
export function estimateService(
  prices: number[],
  quantity: number,
  progress: number,
) {
  if (!prices.length || prices.some((p) => !Number.isSafeInteger(p) || p <= 0))
    throw new Error("Cadastre pelo menos uma referência de preço válida.");
  if (
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    quantity > 1000000 ||
    !Number.isFinite(progress) ||
    progress < 0 ||
    progress > 100
  )
    throw new Error("Quantidade ou percentual inválido.");
  const mean = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
  const total = Math.round(mean * quantity);
  if (!Number.isSafeInteger(total) || total > 100000000000)
    throw new Error("Valor estimado acima do limite.");
  return {
    mean,
    total,
    completed: Math.round((total * progress) / 100),
    remaining: total - Math.round((total * progress) / 100),
    minimum: Math.round((Math.min(...prices) * quantity * progress) / 100),
    maximum: Math.round((Math.max(...prices) * quantity * progress) / 100),
    samples: prices.length,
  };
}

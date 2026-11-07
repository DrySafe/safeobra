import { z } from "zod";
import { serviceUnits } from "./estimates.ts";
import type { AiEstimateResult } from "./ai-estimates.ts";
const cents = z.number().int().min(0).max(100000000000);
export const contractItemInput = z
  .object({
    id: z.uuid().nullable().default(null),
    nome: z.string().trim().min(1).max(300),
    descricao: z.string().trim().max(4000).default(""),
    unidade: z.enum(serviceUnits).default("serviço"),
    quantidade: z.number().positive().max(1000000).default(1),
    classe: z.enum(["incluido", "extra"]).default("incluido"),
    aprovado: z.boolean().default(false),
    valor_cobrado: cents.nullable().default(null),
    percentual_executado: z.number().int().min(0).max(100).default(0),
    valor_pago_informado: cents.nullable().default(null),
    data_pagamento: z.iso.date().nullable().default(null),
  })
  .strict()
  .refine(
    (i) => i.classe !== "extra" || !i.aprovado || i.valor_cobrado !== null,
    { message: "Informe o valor do extra aprovado.", path: ["valor_cobrado"] },
  );
export const contractItemsInput = z
  .object({
    itens: z.array(contractItemInput).min(1).max(60),
    lote: z.uuid(),
    importar_pagamentos: z.boolean().default(false),
  })
  .strict();
export type ContractItemDraft = z.infer<typeof contractItemInput>;
export type ContractItem = ContractItemDraft & {
  id: string;
  obra_id: string;
  contrato_id: string;
  arquivado: boolean;
  valor_estimado: number | null;
  estimado_minimo: number | null;
  estimado_maximo: number | null;
  estimativa_json: AiEstimateResult | null;
  pesquisado_em: string | null;
  criado_em: string;
  criado_por: string;
};
export type PaymentAllocation = {
  id: string;
  obra_id: string;
  contrato_id: string;
  pagamento_id: string;
  item_id: string;
  valor_bruto: number;
  desconto: number;
};
export type ItemExecution = {
  id: string;
  item_id: string;
  data: string;
  percentual: number;
  observacoes: string;
};
export type PaymentForItems = {
  id: string;
  contrato_id: string;
  anulado: boolean;
  valor_bruto: number;
  valor: number;
  desconto: number;
};
const money = (value: unknown) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0 || n > 100000000000)
    throw new Error("Valor financeiro inválido.");
  return n;
};
export function contractItemMetrics(
  base: number,
  items: ContractItem[],
  payments: PaymentForItems[],
  allocations: PaymentAllocation[],
) {
  base = money(base);
  const active = items.filter((i) => !i.arquivado),
    approved = active.filter((i) => i.classe === "incluido" || i.aprovado),
    live = payments.filter((p) => !p.anulado),
    ids = new Set(live.map((p) => p.id)),
    assigned = allocations.filter((a) => ids.has(a.pagamento_id));
  const extras = approved
      .filter((i) => i.classe === "extra")
      .reduce((s, i) => s + money(i.valor_cobrado ?? 0), 0),
    included = approved
      .filter((i) => i.classe === "incluido")
      .reduce((s, i) => s + money(i.valor_cobrado ?? 0), 0),
    total = base + extras;
  if (total > 100000000000 || included > base)
    throw new Error("Planejamento excede o valor da empreitada.");
  const rows = active.map((item) => {
    const relevant = assigned.filter((a) => a.item_id === item.id),
      gross = relevant.reduce((s, a) => s + money(a.valor_bruto), 0),
      discount = relevant.reduce((s, a) => s + money(a.desconto), 0),
      value =
        item.classe === "extra" && !item.aprovado
          ? 0
          : money(item.valor_cobrado ?? 0),
      earned = Math.round((value * item.percentual_executado) / 100);
    return {
      item,
      value,
      earned,
      paid: gross - discount,
      discount,
      gross,
      remaining: Math.max(0, value - gross),
      due: Math.max(0, earned - gross),
      advance: Math.max(0, gross - earned),
    };
  });
  const earned = rows.reduce((s, r) => s + r.earned, 0),
    paid = live.reduce((s, p) => s + money(p.valor), 0),
    discount = live.reduce((s, p) => s + money(p.desconto), 0),
    gross = live.reduce((s, p) => s + money(p.valor_bruto), 0),
    allocatedGross = assigned.reduce((s, a) => s + money(a.valor_bruto), 0),
    allocatedDiscount = assigned.reduce((s, a) => s + money(a.desconto), 0),
    estimated = approved.filter((i) => i.valor_estimado !== null),
    market = estimated.reduce((s, i) => s + money(i.valor_estimado), 0);
  return {
    rows,
    total,
    base,
    extras,
    included,
    reserve: base - included,
    earned,
    paid,
    discount,
    gross,
    progressKnown:
      base === included &&
      approved
        .filter((i) => i.classe === "incluido")
        .every((i) => i.valor_cobrado !== null),
    progress: total ? (earned / total) * 100 : 0,
    remainingProgress: total ? 100 - (earned / total) * 100 : 100,
    remaining: Math.max(0, total - gross),
    due: Math.max(0, earned - gross),
    advance: Math.max(0, gross - earned),
    unassignedPaid: Math.max(0, paid - (allocatedGross - allocatedDiscount)),
    unassignedDiscount: Math.max(0, discount - allocatedDiscount),
    unassignedGross: Math.max(0, gross - allocatedGross),
    market,
    marketComplete:
      estimated.length === approved.length &&
      approved.length > 0 &&
      base === included,
    estimatedCount: estimated.length,
    itemCount: approved.length,
    pendingCount: approved.filter((i) => i.percentual_executado < 100).length,
  };
}
export function allocateContractBudget(
  base: number,
  items: ContractItem[],
): ContractItemDraft[] {
  base = money(base);
  const included = items.filter((i) => !i.arquivado && i.classe === "incluido");
  if (
    !included.length ||
    included.some((i) => !i.valor_estimado || money(i.valor_estimado) <= 0)
  )
    throw new Error(
      "Pesquise ou informe referência para todos os itens incluídos antes de distribuir.",
    );
  const sum = included.reduce(
      (s, i) => s + BigInt(money(i.valor_estimado)),
      0n,
    ),
    parts = included.map((item, index) => {
      const scaled = BigInt(base) * BigInt(money(item.valor_estimado));
      return { item, index, value: scaled / sum, remainder: scaled % sum };
    });
  let remainder = BigInt(base) - parts.reduce((s, i) => s + i.value, 0n);
  for (const part of [...parts].sort((a, b) =>
    a.remainder === b.remainder
      ? a.index - b.index
      : a.remainder > b.remainder
        ? -1
        : 1,
  )) {
    if (remainder <= 0n) break;
    part.value++;
    remainder--;
  }
  return parts.map((p) =>
    draftFromItem(p.item, { valor_cobrado: Number(p.value) }),
  );
}
export function draftFromItem(
  item: ContractItem,
  changes: Partial<ContractItemDraft> = {},
): ContractItemDraft {
  return contractItemInput.parse({
    id: item.id,
    nome: item.nome,
    descricao: item.descricao,
    unidade: item.unidade,
    quantidade: Number(item.quantidade),
    classe: item.classe,
    aprovado: item.aprovado,
    valor_cobrado:
      item.valor_cobrado === null ? null : Number(item.valor_cobrado),
    percentual_executado: item.percentual_executado,
    ...changes,
  });
}
export function researchedItemTotal(
  result: AiEstimateResult,
  item: Pick<ContractItem, "unidade" | "quantidade">,
) {
  if (result.metodo === "diaria") {
    const c = result.diaria?.calculo;
    return c?.total_integral_medio == null
      ? null
      : {
          mean: c.total_integral_medio,
          minimum: c.total_integral_minimo!,
          maximum: c.total_integral_maximo!,
        };
  }
  const c = result.calculo;
  if (!c) return null;
  const quantity =
    result.unidade === item.unidade
      ? Number(item.quantidade)
      : result.quantidade_total;
  if (quantity === null) return null;
  const mean = Math.round(c.mean * quantity),
    minimum = Math.round(c.minimum * quantity),
    maximum = Math.round(c.maximum * quantity);
  if (
    [mean, minimum, maximum].some(
      (n) => !Number.isSafeInteger(n) || n > 100000000000,
    )
  )
    throw new Error("Estimativa excede o limite.");
  return { mean, minimum, maximum };
}
export const textImportResponse = z.object({
  itens: z.array(contractItemInput).min(1).max(60),
  avisos: z.array(z.string().max(500)).max(12),
});
export function safeTextFile(bytes: Uint8Array) {
  if (bytes.byteLength > 65536)
    throw new Error("Arquivo de texto: máximo de 64 KB.");
  const text = new TextDecoder("utf-8", { fatal: true })
    .decode(bytes)
    .replace(/^\uFEFF/, "");
  if (text.includes("\0") || text.length > 16000 || !text.trim())
    throw new Error(
      "Use texto UTF-8, até 16 mil caracteres, sem conteúdo binário.",
    );
  return text;
}

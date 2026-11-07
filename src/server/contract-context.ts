import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContractContext } from "../lib/contract-context";
import {
  contractItemMetrics,
  researchedItemTotal,
  type ContractItem,
  type PaymentAllocation,
} from "../lib/contract-items";
import { execution } from "../lib/finance";
import type { AiEstimateResult } from "../lib/ai-estimates";
import type { Payment, Stage } from "../lib/models";
export async function readContractContext(
  client: SupabaseClient,
  obra: string,
  contractId: string,
  itemId: string | null,
) {
  const { data: contract, error } = await client
    .from("contratos_mao_de_obra")
    .select("id,tipo,valor_geral,plano_ativo,itens_ativo")
    .eq("id", contractId)
    .eq("obra_id", obra)
    .single();
  if (error || !contract || contract.tipo !== "empreitada")
    throw new Error("Empreitada não encontrada nesta obra.");
  const [itemRows, paymentRows, allocationRows, stageRows] = await Promise.all([
    contract.itens_ativo
      ? client
          .from("empreitada_itens")
          .select("*")
          .eq("obra_id", obra)
          .eq("contrato_id", contractId)
          .eq("arquivado", false)
          .limit(501)
      : Promise.resolve({ data: [], error: null }),
    client
      .from("pagamentos")
      .select("*")
      .eq("obra_id", obra)
      .eq("contrato_id", contractId)
      .limit(501),
    contract.itens_ativo
      ? client
          .from("pagamento_itens")
          .select("*")
          .eq("obra_id", obra)
          .eq("contrato_id", contractId)
          .limit(1001)
      : Promise.resolve({ data: [], error: null }),
    !contract.itens_ativo && contract.plano_ativo
      ? client
          .from("servicos")
          .select("*")
          .eq("obra_id", obra)
          .eq("contrato_id", contractId)
          .limit(501)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (
    [itemRows, paymentRows, allocationRows, stageRows].some(
      (r) => r.error || !r.data || r.data.length > 500,
    )
  )
    throw new Error(
      "Não foi possível carregar o contexto completo da empreitada.",
    );
  const items = itemRows.data as ContractItem[],
    payments = paymentRows.data as Payment[],
    allocations = allocationRows.data as PaymentAllocation[];
  const metrics = contractItemMetrics(
    Number(contract.valor_geral),
    items,
    payments,
    allocations,
  );
  if (!contract.itens_ativo && contract.plano_ativo) {
    const legacy = execution(
      Number(contract.valor_geral),
      (stageRows.data as Stage[]).map((s) => ({
        weight: s.peso,
        progress: s.percentual_executado,
      })),
    );
    metrics.progressKnown = true;
    metrics.earned = legacy.earned;
    metrics.progress = legacy.progress;
    metrics.remainingProgress = 100 - legacy.progress;
    metrics.due = Math.max(0, legacy.earned - metrics.gross);
  }
  const item = itemId ? (items.find((i) => i.id === itemId) ?? null) : null;
  if (itemId && !item)
    throw new Error("O serviço não pertence à empreitada selecionada.");
  const row = item ? metrics.rows.find((r) => r.item.id === item.id) : null;
  const context: ContractContext = {
    contrato_id: contractId,
    item_id: item?.id ?? null,
    valor_original: Number(contract.valor_geral),
    extras_aprovados: metrics.extras,
    valor_total: metrics.total,
    pago: metrics.paid,
    descontos: metrics.discount,
    executado_devido: metrics.earned,
    devido_agora: metrics.due,
    saldo_contrato: metrics.remaining,
    percentual_executado: metrics.progressKnown ? metrics.progress : null,
    percentual_restante: metrics.progressKnown
      ? metrics.remainingProgress
      : null,
    saldo_a_distribuir: metrics.unassignedGross,
    item:
      item && row
        ? {
            nome: item.nome,
            classe: item.classe,
            aprovado: item.aprovado,
            valor_cobrado:
              item.valor_cobrado === null ? null : Number(item.valor_cobrado),
            percentual_executado: item.percentual_executado,
            pago_vinculado: row.paid,
            desconto_vinculado: row.discount,
            devido_executado: row.due,
            saldo_item: row.remaining,
            mercado_total:
              item.valor_estimado === null ? null : Number(item.valor_estimado),
            mercado_executado:
              item.valor_estimado === null
                ? null
                : Math.round(
                    (Number(item.valor_estimado) * item.percentual_executado) /
                      100,
                  ),
            diferenca_cobrado_mercado:
              item.valor_cobrado === null || item.valor_estimado === null
                ? null
                : Number(item.valor_cobrado) - Number(item.valor_estimado),
          }
        : null,
  };
  return { context, item, metrics };
}
export function contextWithResearch(
  context: ContractContext,
  item: ContractItem | null,
  result: AiEstimateResult,
) {
  if (!item || !context.item) return context;
  const total = researchedItemTotal(result, item);
  return {
    ...context,
    item: {
      ...context.item,
      mercado_total: total?.mean ?? null,
      mercado_executado: total
        ? Math.round((total.mean * item.percentual_executado) / 100)
        : null,
      diferenca_cobrado_mercado:
        total && item.valor_cobrado !== null
          ? Number(item.valor_cobrado) - total.mean
          : null,
    },
  };
}

"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { access } from "./access";
import { rate } from "./rate";
import { contractItemsInput } from "../lib/contract-items";
import type { Result } from "./actions";
function message(error: unknown) {
  if (error instanceof z.ZodError)
    return error.issues.map((i) => i.message).join("; ");
  return error instanceof Error ? error.message : "Não foi possível concluir.";
}
function databaseError(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (error.code === "23505")
    throw new Error(
      "Já existe um item com esse nome e classificação. Revise a lista.",
    );
  throw new Error(
    error.code === "P0001"
      ? error.message
      : "Não foi possível salvar os dados da empreitada.",
  );
}
export async function adoptContractItems(
  obra: string,
  contract: string,
): Promise<Result> {
  try {
    z.uuid().parse(contract);
    const { client, user } = await access(obra, true);
    await rate("contract-plan", user.id, 30);
    const { data } = await client
      .from("contratos_mao_de_obra")
      .select("id")
      .eq("id", contract)
      .eq("obra_id", obra)
      .single();
    if (!data) throw new Error("Empreitada inválida.");
    const { error } = await client.rpc("adopt_contract_items", {
      p_contrato: contract,
    });
    databaseError(error);
    revalidatePath("/");
    return {
      ok: true,
      message: "Tabela ativada. Plano e pagamentos anteriores preservados.",
    };
  } catch (error) {
    return { ok: false, message: message(error) };
  }
}
export async function saveContractItems(
  obra: string,
  contract: string,
  raw: unknown,
): Promise<Result> {
  try {
    z.uuid().parse(contract);
    const input = contractItemsInput.parse(raw);
    const { client, user } = await access(obra, true);
    await rate("contract-plan", user.id, 30);
    const { data } = await client
      .from("contratos_mao_de_obra")
      .select("id")
      .eq("id", contract)
      .eq("obra_id", obra)
      .single();
    if (!data) throw new Error("Empreitada inválida.");
    const { error } = await client.rpc("save_contract_items", {
      p_contrato: contract,
      p_itens: input.itens,
      p_lote: input.lote,
      p_importar_pagamentos: input.importar_pagamentos,
    });
    databaseError(error);
    revalidatePath("/");
    return {
      ok: true,
      message: input.importar_pagamentos
        ? "Itens e pagamentos históricos revisados foram registrados."
        : "Serviços salvos. Pagamentos não foram criados.",
    };
  } catch (error) {
    return { ok: false, message: message(error) };
  }
}
export async function archiveContractItem(
  obra: string,
  contract: string,
  item: string,
): Promise<Result> {
  try {
    z.uuid().parse(contract);
    z.uuid().parse(item);
    const { client } = await access(obra, true);
    const { data } = await client
      .from("empreitada_itens")
      .select("id")
      .eq("id", item)
      .eq("obra_id", obra)
      .eq("contrato_id", contract)
      .single();
    if (!data) throw new Error("Item inválido.");
    const { error } = await client.rpc("archive_contract_item", {
      p_item: item,
    });
    databaseError(error);
    revalidatePath("/");
    return { ok: true, message: "Item sem histórico arquivado." };
  } catch (error) {
    return { ok: false, message: message(error) };
  }
}
export async function allocateContractPayment(
  obra: string,
  contract: string,
  raw: unknown,
): Promise<Result> {
  try {
    const input = z
      .object({
        pagamento_id: z.uuid(),
        item_id: z.uuid(),
        valor_bruto: z.number().int().min(0).max(1e11),
        desconto: z.number().int().min(0).max(1e11),
      })
      .strict()
      .parse(raw);
    const { client } = await access(obra, true);
    const { data } = await client
      .from("pagamentos")
      .select("id")
      .eq("id", input.pagamento_id)
      .eq("obra_id", obra)
      .eq("contrato_id", contract)
      .single();
    if (!data) throw new Error("Pagamento inválido.");
    const { error } = await client.rpc("allocate_contract_payment", {
      p_pagamento: input.pagamento_id,
      p_item: input.item_id,
      p_bruto: input.valor_bruto,
      p_desconto: input.desconto,
    });
    databaseError(error);
    revalidatePath("/");
    return {
      ok: true,
      message:
        "Pagamento existente distribuído. Nenhum novo pagamento foi criado.",
    };
  } catch (error) {
    return { ok: false, message: message(error) };
  }
}
export async function saveSingleContractItem(
  obra: string,
  contract: string,
  item: unknown,
): Promise<Result> {
  return saveContractItems(obra, contract, {
    itens: [item],
    lote: randomUUID(),
    importar_pagamentos: false,
  });
}

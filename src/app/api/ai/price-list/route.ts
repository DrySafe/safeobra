import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { db } from "@/lib/supabase/server";
import { researchedItemTotal, type ContractItem } from "@/lib/contract-items";
import { isAllowedRequestOrigin } from "@/server/origin";
import { rate } from "@/server/rate";
import { AiProviderError } from "@/server/openai-estimator";
import {
  contextForItem,
  contextWithResearch,
  readContractContext,
} from "@/server/contract-context";
import {
  researchServicePriceList,
  PRICE_LIST_BATCH_SIZE,
} from "@/server/list-price-research";
export const runtime = "nodejs";
export const maxDuration = 120;
export async function POST(request: Request) {
  try {
    if (!isAllowedRequestOrigin(request))
      return NextResponse.json(
        { error: "Origem não autorizada." },
        { status: 403 },
      );
    if (
      request.headers.get("content-type")?.split(";")[0] !== "application/json"
    )
      return NextResponse.json({ error: "Formato inválido." }, { status: 415 });
    const reader = request.body?.getReader();
    if (!reader)
      return NextResponse.json(
        { error: "Selecione os serviços." },
        { status: 400 },
      );
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 4096) {
        await reader.cancel();
        return NextResponse.json(
          { error: "Lista acima do limite." },
          { status: 413 },
        );
      }
      chunks.push(part.value);
    }
    const input = z
      .object({
        obra_id: z.uuid(),
        contrato_id: z.uuid(),
        itens: z.array(z.uuid()).min(1).max(PRICE_LIST_BATCH_SIZE),
      })
      .strict()
      .parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (new Set(input.itens).size !== input.itens.length)
      return NextResponse.json(
        { error: "Há serviços repetidos na seleção." },
        { status: 400 },
      );
    const client = await db();
    const {
      data: { user },
    } = await client.auth.getUser();
    if (!user)
      return NextResponse.json(
        { error: "Entre na sua conta." },
        { status: 401 },
      );
    const { data: member } = await client
      .from("obra_membros")
      .select("role")
      .eq("obra_id", input.obra_id)
      .eq("user_id", user.id)
      .single();
    if (member?.role !== "admin")
      return NextResponse.json(
        { error: "Somente ADM pode calcular e salvar os preços da lista." },
        { status: 403 },
      );
    const { data: contract } = await client
      .from("contratos_mao_de_obra")
      .select("id,tipo,itens_ativo")
      .eq("id", input.contrato_id)
      .eq("obra_id", input.obra_id)
      .single();
    if (!contract || contract.tipo !== "empreitada" || !contract.itens_ativo)
      return NextResponse.json(
        {
          error:
            "Salve os serviços nesta empreitada antes de calcular os preços.",
        },
        { status: 400 },
      );
    const { data, error } = await client
      .from("empreitada_itens")
      .select("*")
      .eq("obra_id", input.obra_id)
      .eq("contrato_id", input.contrato_id)
      .eq("arquivado", false)
      .in("id", input.itens);
    if (error || !data || data.length !== input.itens.length)
      return NextResponse.json(
        { error: "Confira os serviços da empreitada selecionada." },
        { status: 400 },
      );
    const items = input.itens.map((id) =>
      data.find((i) => i.id === id)!,
    ) as ContractItem[];
    const key = process.env.SAFEOBRA_OPENAI_API_KEY,
      serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key || !serviceKey)
      throw new AiProviderError(
        503,
        "A pesquisa de preços ainda não foi configurada.",
      );
    try {
      await rate("ai-list-user", user.id, 4);
      await rate("ai-list-obra", input.obra_id, 12);
    } catch {
      throw new AiProviderError(
        429,
        "Aguarde um minuto para continuar o orçamento.",
        "RATE_LIMIT",
      );
    }
    const results = await researchServicePriceList({
      items,
      key,
      model: process.env.SAFEOBRA_OPENAI_MODEL || "gpt-4.1-mini",
    });
    const live = await readContractContext(
      client,
      input.obra_id,
      input.contrato_id,
      null,
    );
    const storage = createClient(
      (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL)!,
      serviceKey,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const saved = await Promise.all(
      items.map(async (item, index) => {
        const current = live.metrics.rows.find(
          (r) => r.item.id === item.id,
        )?.item;
        if (!current)
          return {
            id: item.id,
            error: "Serviço arquivado durante a pesquisa.",
          };
        const result = {
          ...results[index],
          empreitada: contextWithResearch(
            contextForItem(live.context, live.metrics, current),
            current,
            results[index],
          ),
        };
        const amount = researchedItemTotal(result, current);
        const { error } = await storage.rpc("save_contract_item_estimate", {
          p_item: item.id,
          p_actor: user.id,
          p_mean: amount?.mean ?? null,
          p_min: amount?.minimum ?? null,
          p_max: amount?.maximum ?? null,
          p_result: result,
          p_expected: {
            nome: item.nome,
            descricao: item.descricao,
            unidade: item.unidade,
            quantidade: Number(item.quantidade),
          },
        });
        return error
          ? {
              id: item.id,
              error:
                "O serviço mudou ou a estimativa não pôde ser salva. Recalcule este item.",
            }
          : {
              id: item.id,
              status: result.status,
              tem_preco: result.calculo !== null,
              tem_total: amount !== null,
            };
      }),
    );
    return NextResponse.json(
      { resultados: saved },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof AiProviderError)
      return NextResponse.json(
        { error: error.message, code: error.code },
        {
          status: error.status,
          headers: {
            "Cache-Control": "private, no-store",
            ...(error.code === "RATE_LIMIT" ? { "Retry-After": "60" } : {}),
          },
        },
      );
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return NextResponse.json(
        { error: "Confira a lista e a empreitada selecionada." },
        { status: 400 },
      );
    console.warn("[ai] list research failed");
    return NextResponse.json(
      {
        error:
          "Não foi possível calcular os preços da lista. Resultados anteriores preservados.",
      },
      { status: 503 },
    );
  }
}

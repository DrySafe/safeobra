import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  readContractContext,
  contextWithResearch,
} from "@/server/contract-context";
import { researchedItemTotal } from "@/lib/contract-items";
import { db } from "@/lib/supabase/server";
import { rate } from "@/server/rate";
import {
  AiProviderError,
  researchServicePrices,
} from "@/server/openai-estimator";
import { aiEstimateRequestSchema } from "@/lib/ai-estimates";
import { isAllowedRequestOrigin } from "@/server/origin";
export const runtime = "nodejs";
export const maxDuration = 60;
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
        { error: "Informe o serviço." },
        { status: 400 },
      );
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 8192) {
        await reader.cancel();
        return NextResponse.json(
          { error: "Descrição acima do limite." },
          { status: 413 },
        );
      }
      chunks.push(next.value);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
    }
    const parsed = aiEstimateRequestSchema.safeParse(raw);
    if (!parsed.success)
      return NextResponse.json(
        { error: "Informe uma descrição válida e a região da obra." },
        { status: 400 },
      );
    const input = parsed.data;
    const client = await db();
    const {
      data: { user },
    } = await client.auth.getUser();
    if (!user)
      return NextResponse.json(
        { error: "Entre na sua conta para usar o assistente." },
        { status: 401 },
      );
    const { data: membership, error: memberError } = await client
      .from("obra_membros")
      .select("role")
      .eq("obra_id", input.obra_id)
      .eq("user_id", user.id)
      .single();
    if (memberError || !membership)
      return NextResponse.json(
        { error: "Sem acesso a esta obra." },
        { status: 403 },
      );
    if ((input.item_id || input.salvar_estimativa) && !input.contrato_id)
      return NextResponse.json(
        { error: "Selecione a empreitada para vincular o serviço." },
        { status: 400 },
      );
    if (input.salvar_estimativa && !input.item_id)
      return NextResponse.json(
        { error: "Selecione o serviço para salvar a pesquisa na tabela." },
        { status: 400 },
      );
    if (input.salvar_estimativa && membership.role !== "admin")
      return NextResponse.json(
        { error: "Somente ADM salva pesquisas nos itens." },
        { status: 403 },
      );
    let linked = null;
    if (input.contrato_id) {
      try {
        linked = await readContractContext(
          client,
          input.obra_id,
          input.contrato_id,
          input.item_id,
        );
      } catch {
        return NextResponse.json(
          { error: "Confira a empreitada e o serviço selecionados." },
          { status: 400 },
        );
      }
    }
    const key = process.env.SAFEOBRA_OPENAI_API_KEY;
    if (!key)
      throw new AiProviderError(
        503,
        "O assistente de IA ainda não foi configurado pelo administrador.",
      );
    try {
      await rate("ai-user", user.id, 3);
      await rate("ai-obra", input.obra_id, 10);
    } catch {
      throw new AiProviderError(
        429,
        "Limite de análises atingido. Aguarde um minuto para tentar novamente.",
        "RATE_LIMIT",
      );
    }
    const snapshot = linked?.item ?? null;
    let result = await researchServicePrices({
      key,
      model: process.env.SAFEOBRA_OPENAI_MODEL || "gpt-4.1-mini",
      description: input.descricao,
      region: input.regiao,
      scope: input.escopo,
      method: input.metodo,
      workers: input.pedreiros,
      hoursPerDay: input.jornada_horas,
      contractContext: linked?.context ?? null,
    });
    if (input.contrato_id)
      linked = await readContractContext(
        client,
        input.obra_id,
        input.contrato_id,
        input.item_id,
      );
    if (
      input.salvar_estimativa &&
      snapshot &&
      linked?.item &&
      (snapshot.nome !== linked.item.nome ||
        snapshot.descricao !== linked.item.descricao ||
        snapshot.unidade !== linked.item.unidade ||
        Number(snapshot.quantidade) !== Number(linked.item.quantidade))
    )
      return NextResponse.json(
        {
          error: "O serviço foi alterado durante a pesquisa. Repita a análise.",
        },
        { status: 409 },
      );
    if (linked)
      result = {
        ...result,
        empreitada: contextWithResearch(linked.context, linked.item, result),
      };
    if (input.salvar_estimativa && linked?.item) {
      const amount = researchedItemTotal(result, linked.item);
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!serviceKey)
        throw new AiProviderError(503, "Não foi possível salvar a pesquisa.");
      const storage = createClient(
        (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL)!,
        serviceKey,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const { error } = await storage.rpc("save_contract_item_estimate", {
        p_item: linked.item.id,
        p_actor: user.id,
        p_mean: amount?.mean ?? null,
        p_min: amount?.minimum ?? null,
        p_max: amount?.maximum ?? null,
        p_result: result,
        p_expected: snapshot
          ? {
              nome: snapshot.nome,
              descricao: snapshot.descricao,
              unidade: snapshot.unidade,
              quantidade: Number(snapshot.quantidade),
            }
          : null,
      });
      if (error)
        throw new AiProviderError(
          503,
          "A pesquisa foi concluída, mas não pôde ser salva. Tente novamente.",
        );
    }
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
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
    console.warn("[ai] estimate request failed");
    return NextResponse.json(
      { error: "Não foi possível concluir a análise. Tente novamente." },
      { status: 503 },
    );
  }
}

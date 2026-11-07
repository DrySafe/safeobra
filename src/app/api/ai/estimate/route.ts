import { NextResponse } from "next/server";
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
      );
    }
    const result = await researchServicePrices({
      key,
      model: process.env.SAFEOBRA_OPENAI_MODEL || "gpt-4.1-mini",
      description: input.descricao,
      region: input.regiao,
      scope: input.escopo,
      method: input.metodo,
      workers: input.pedreiros,
      hoursPerDay: input.jornada_horas,
    });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof AiProviderError)
      return NextResponse.json(
        { error: error.message, code: error.code },
        {
          status: error.status,
          headers: { "Cache-Control": "private, no-store" },
        },
      );
    console.warn("[ai] estimate request failed");
    return NextResponse.json(
      { error: "Não foi possível concluir a análise. Tente novamente." },
      { status: 503 },
    );
  }
}

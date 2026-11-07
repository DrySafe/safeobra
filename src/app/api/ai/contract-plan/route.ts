import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/supabase/server";
import { isAllowedRequestOrigin } from "@/server/origin";
import { rate } from "@/server/rate";
import { parseContractText } from "@/server/contract-import";
import { AiProviderError } from "@/server/openai-estimator";
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
      return NextResponse.json({ error: "Texto ausente." }, { status: 400 });
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 73728) {
        await reader.cancel();
        return NextResponse.json(
          { error: "Arquivo acima do limite." },
          { status: 413 },
        );
      }
      chunks.push(next.value);
    }
    const input = z
      .object({
        obra_id: z.uuid(),
        contrato_id: z.uuid(),
        texto: z.string().trim().min(5).max(16000),
      })
      .strict()
      .parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
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
        { error: "Somente ADM pode organizar serviços." },
        { status: 403 },
      );
    const { data: contract } = await client
      .from("contratos_mao_de_obra")
      .select("id,tipo,valor_geral")
      .eq("id", input.contrato_id)
      .eq("obra_id", input.obra_id)
      .single();
    if (!contract || contract.tipo !== "empreitada")
      return NextResponse.json(
        { error: "Empreitada inválida." },
        { status: 400 },
      );
    const key = process.env.SAFEOBRA_OPENAI_API_KEY;
    if (!key)
      throw new AiProviderError(
        503,
        "A organização com IA ainda não foi configurada.",
      );
    try {
      await rate("contract-import", user.id, 3);
    } catch {
      throw new AiProviderError(
        429,
        "Aguarde um minuto para organizar outro texto.",
      );
    }
    const result = await parseContractText({
      text: input.texto,
      contractValue: Number(contract.valor_geral),
      key,
      model: process.env.SAFEOBRA_OPENAI_MODEL || "gpt-4.1-mini",
    });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof AiProviderError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return NextResponse.json(
        { error: "Confira o texto e a empreitada selecionada." },
        { status: 400 },
      );
    return NextResponse.json(
      { error: "Não foi possível organizar os serviços." },
      { status: 503 },
    );
  }
}

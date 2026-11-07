import { NextResponse } from "next/server";
import { db } from "@/lib/supabase/server";
import { rate } from "@/server/rate";
import { AiProviderError, interpretService } from "@/server/openai-estimator";
import {
  aiEstimateRequestSchema,
  buildAiGroups,
  resolveAiEstimate,
} from "@/lib/ai-estimates";
import type { CostSample } from "@/lib/estimates";
export const runtime = "nodejs";
export const maxDuration = 30;
export async function POST(request: Request) {
  try {
    if (
      !process.env.APP_URL ||
      request.headers.get("origin") !== new URL(process.env.APP_URL).origin
    )
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
    const [quotes, stages, contracts] = await Promise.all([
      client
        .from("referencias_servicos")
        .select("id,nome,unidade,valor_unitario,fonte,data_referencia,regiao")
        .eq("obra_id", input.obra_id)
        .limit(501),
      client
        .from("servicos")
        .select("id,nome,unidade,quantidade,peso,contrato_id,criado_em")
        .eq("obra_id", input.obra_id)
        .eq("percentual_executado", 100)
        .limit(501),
      client
        .from("contratos_mao_de_obra")
        .select("id,valor_geral")
        .eq("obra_id", input.obra_id)
        .eq("plano_ativo", true)
        .limit(501),
    ]);
    if (quotes.error || stages.error || contracts.error)
      throw new AiProviderError(
        503,
        "Não foi possível carregar a base de referências. Tente novamente.",
      );
    if ([quotes, stages, contracts].some((result) => result.data!.length > 500))
      throw new AiProviderError(
        400,
        "A base é extensa para esta análise. Use a calculadora de referências.",
      );
    const history: CostSample[] = stages.data!.flatMap((stage) => {
      const contract = contracts.data!.find((c) => c.id === stage.contrato_id);
      if (!contract || !Number(stage.quantidade)) return [];
      const price = Math.round(
        (Number(contract.valor_geral) * stage.peso) /
          10000 /
          Number(stage.quantidade),
      );
      return price > 0
        ? [
            {
              id: "stage-" + stage.id,
              nome: stage.nome,
              unidade: stage.unidade,
              valor_unitario: price,
              fonte: "Etapa concluída — valor previsto no contrato",
              data_referencia: stage.criado_em,
              regiao: "Obra atual",
            },
          ]
        : [];
    });
    let groups;
    try {
      groups = buildAiGroups(
        [...(quotes.data as CostSample[]), ...history],
        input.regiao,
      );
    } catch {
      throw new AiProviderError(
        400,
        "A base é extensa para esta análise. Use a calculadora de referências.",
      );
    }
    const interpreted = groups.length
      ? await interpretService({
          key,
          model: process.env.SAFEOBRA_OPENAI_MODEL || "gpt-4.1-mini",
          description: input.descricao,
          region: input.regiao,
          groups,
        })
      : {
          grupo_id: null,
          unidade: null,
          quantidade_total: null,
          percentual_executado: null,
        };
    let result;
    try {
      result = resolveAiEstimate(interpreted, groups, input.regiao);
    } catch {
      throw new AiProviderError(
        502,
        "A IA não selecionou uma referência válida. Reescreva o pedido.",
      );
    }
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof AiProviderError)
      return NextResponse.json(
        { error: error.message },
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

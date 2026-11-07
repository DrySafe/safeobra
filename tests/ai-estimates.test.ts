import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aiCatalog,
  aiEstimateRequestSchema,
  buildAiGroups,
  resolveAiEstimate,
  aiOutputJsonSchema,
} from "../src/lib/ai-estimates.ts";
import {
  interpretService,
  AiProviderError,
} from "../src/server/openai-estimator.ts";
import type { CostSample } from "../src/lib/estimates.ts";
const sample: CostSample = {
  id: "quote-1",
  nome: "Reboco",
  unidade: "m²",
  valor_unitario: 2000,
  fonte: "Cotação do profissional privado",
  data_referencia: "2026-11-07",
  regiao: "Aracaju/SE",
};
const groups = buildAiGroups(
  [sample, { ...sample, id: "quote-2", valor_unitario: 3000 }],
  "Aracaju/SE",
);
const interpretation = {
  grupo_id: groups[0].id,
  unidade: "m²",
  quantidade_total: 40,
  percentual_executado: 50,
};
const options = {
  key: "test-only-never-real",
  model: "gpt-4.1-mini",
  description: "Reboco de 40 m² no total, 50% concluído",
  region: "Aracaju/SE",
  groups,
};
const completed = (output: unknown) =>
  new Response(
    JSON.stringify({
      status: "completed",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(output) }],
        },
      ],
    }),
  );
test("catálogo da IA omite preços, fontes privadas e IDs internos", () => {
  assert.deepEqual(aiCatalog(groups), [
    { id: "grupo_0", nome: "Reboco", unidade: "m²", regiao: "Aracaju/SE" },
  ]);
  const text = JSON.stringify(aiCatalog(groups));
  for (const privateValue of ["2000", "3000", sample.fonte, sample.id])
    assert.ok(!text.includes(privateValue));
  assert.equal(aiOutputJsonSchema(groups).additionalProperties, false);
});
test("Aracaju/SE filtra regiões, unidades e preserva grupos distintos", () => {
  const result = buildAiGroups(
    [
      sample,
      { ...sample, id: "other", regiao: "Salvador/BA" },
      { ...sample, id: "state", regiao: "Sergipe" },
      { ...sample, id: "local", regiao: "Obra atual" },
      { ...sample, id: "unit", unidade: "m" },
    ],
    "Aracaju/SE",
  );
  assert.equal(result.length, 4);
  assert.ok(
    result.every((group) => group.samples.every((row) => row.id !== "other")),
  );
});
test("estimativa usa todas as cotações do grupo em centavos, sem preço gerado por IA", () => {
  const result = resolveAiEstimate(interpretation, groups, "Aracaju/SE");
  assert.equal(result.status, "estimativa");
  assert.deepEqual(result.calculo, {
    mean: 2500,
    total: 100000,
    completed: 50000,
    remaining: 50000,
    minimum: 40000,
    maximum: 60000,
    samples: 2,
  });
  assert.equal(result.referencias.length, 2);
  assert.equal(result.aviso_regional, null);
});
test("IDs desconhecidos e campos monetários da IA são recusados", () => {
  assert.throws(() =>
    resolveAiEstimate(
      { ...interpretation, grupo_id: "inventado" },
      groups,
      "Aracaju/SE",
    ),
  );
  assert.throws(() =>
    resolveAiEstimate({ ...interpretation, preco: 1 }, groups, "Aracaju/SE"),
  );
  assert.throws(() =>
    resolveAiEstimate(
      { ...interpretation, percentual_executado: 101 },
      groups,
      "Aracaju/SE",
    ),
  );
});
test("sem referências ou medição não há valor presumido", () => {
  const noPrice = resolveAiEstimate(
    { ...interpretation, grupo_id: null },
    [],
    "Aracaju/SE",
  );
  assert.equal(noPrice.status, "faltam_referencias");
  assert.equal(noPrice.calculo, null);
  const noQuantity = resolveAiEstimate(
    { ...interpretation, quantidade_total: null, percentual_executado: null },
    groups,
    "Aracaju/SE",
  );
  assert.equal(noQuantity.status, "faltam_dados");
  assert.equal(noQuantity.calculo, null);
  assert.equal(noQuantity.perguntas.length, 2);
  const mismatch = resolveAiEstimate(
    { ...interpretation, unidade: "un" },
    groups,
    "Aracaju/SE",
  );
  assert.equal(mismatch.calculo, null);
  assert.match(mismatch.perguntas[0], /unidade/);
  assert.equal(mismatch.unidade, "m²");
  assert.equal(
    resolveAiEstimate(
      { ...interpretation, unidade: null },
      groups,
      "Aracaju/SE",
    ).calculo,
    null,
  );
});
test("obra sem localização registrada exige revisão regional", () => {
  const local = buildAiGroups(
    [{ ...sample, regiao: "Obra atual" }],
    "Aracaju/SE",
  );
  assert.match(
    resolveAiEstimate(
      { ...interpretation, grupo_id: local[0].id },
      local,
      "Aracaju/SE",
    ).aviso_regional!,
    /não têm localização/,
  );
});
test("payload da análise é estrito e limitado", () => {
  assert.equal(
    aiEstimateRequestSchema.safeParse({
      obra_id: "a34a8d0e-267a-4f1d-9b19-b35b4824cc58",
      descricao: "x".repeat(1601),
    }).success,
    false,
  );
  assert.equal(
    aiEstimateRequestSchema.safeParse({
      obra_id: "invalid",
      descricao: "Reboco",
    }).success,
    false,
  );
  assert.throws(() =>
    buildAiGroups(
      Array.from({ length: 101 }, (_, i) => ({
        ...sample,
        nome: "Serviço " + i,
      })),
      "Aracaju/SE",
    ),
  );
});
test("Responses API recebe catálogo sem preços e saída estruturada, sem armazenamento", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(init?.method, "POST");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.store, false);
    assert.equal(body.text.format.strict, true);
    assert.equal(body.max_output_tokens, 500);
    assert.deepEqual(JSON.parse(body.input).catalogo, aiCatalog(groups));
    assert.equal(JSON.parse(body.input).regiao, "Aracaju/SE");
    assert.ok(init?.signal);
    return completed(interpretation);
  };
  assert.deepEqual(
    await interpretService({ ...options, fetcher }),
    interpretation,
  );
  assert.equal(calls, 1);
});
test("erros 401 e 429 da OpenAI são traduzidos sem divulgar corpo privado", async () => {
  for (const status of [401, 429])
    await assert.rejects(
      interpretService({
        ...options,
        fetcher: async () =>
          new Response("private credential detail", { status }),
      }),
      (error: unknown) =>
        error instanceof AiProviderError &&
        error.status === (status === 401 ? 503 : 429) &&
        !error.message.includes("private"),
    );
});
test("respostas incompletas, recusa e saída fora do schema são recusadas", async () => {
  for (const response of [
    new Response(JSON.stringify({ status: "incomplete", output: [] })),
    new Response(
      JSON.stringify({
        status: "completed",
        output: [
          { type: "message", content: [{ type: "refusal", refusal: "No" }] },
        ],
      }),
    ),
    completed({ ...interpretation, valor: 10 }),
  ])
    await assert.rejects(
      interpretService({ ...options, fetcher: async () => response }),
      (error: unknown) =>
        error instanceof AiProviderError && error.status === 502,
    );
});
test("falha de conexão e ausência de configuração têm mensagens controladas", async () => {
  await assert.rejects(
    interpretService({
      ...options,
      fetcher: async () => {
        throw new Error("private internal detail");
      },
    }),
    (error: unknown) =>
      error instanceof AiProviderError &&
      error.status === 504 &&
      !error.message.includes("private"),
  );
  await assert.rejects(
    interpretService({ ...options, key: "" }),
    (error: unknown) =>
      error instanceof AiProviderError && error.status === 503,
  );
});

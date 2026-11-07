import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aiEstimateRequestSchema,
  webResearchSchema,
  resolveWebEstimate,
  calculateWebPrices,
  publicSourceUrl,
  type WebReference,
} from "../src/lib/ai-estimates.ts";
import {
  researchServicePrices,
  AiProviderError,
} from "../src/server/openai-estimator.ts";
const source: WebReference = {
  titulo: "Preço de reboco publicado",
  url: "https://precos.example.com/reboco",
  moeda: "BRL",
  valor_minimo: 2000,
  valor_maximo: 3000,
  unidade: "m²",
  escopo: "mao_de_obra",
  regiao: "Brasil",
  abrangencia: "nacional",
  data_preco: null,
  trecho_preco: "Mão de obra de reboco: R$ 20 a R$ 30 por m².",
};
const research = {
  servico: "Reboco",
  unidade: "m²",
  quantidade_total: 40,
  percentual_executado: 50,
  observacoes: "Valores de referência publicados.",
  perguntas: [],
  referencias: [source],
};
const options = {
  key: "test-only-not-real",
  model: "gpt-4.1-mini",
  description:
    "Quanto custa o m² de reboco em Aracaju? São 40 m², 50% concluídos.",
  region: "Aracaju/SE",
  scope: "mao_de_obra" as const,
};
function completed(result: unknown = research, urls: string[] = [source.url]) {
  return new Response(
    JSON.stringify({
      status: "completed",
      output: [
        {
          type: "web_search_call",
          status: "completed",
          action: {
            type: "search",
            sources: urls.map((url) => ({ type: "url", url })),
          },
        },
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify(result),
              annotations: [],
            },
          ],
        },
      ],
    }),
  );
}
test("pesquisa não exige base cadastrada e permite perguntar apenas preço por unidade", () => {
  const parsed = aiEstimateRequestSchema.parse({
    obra_id: "a34a8d0e-267a-4f1d-9b19-b35b4824cc58",
    descricao: "Quanto custa reboco por m²?",
  });
  assert.equal(parsed.escopo, "mao_de_obra");
  assert.equal(parsed.regiao, "Aracaju/SE");
  const result = resolveWebEstimate(
    { ...research, quantidade_total: null, percentual_executado: null },
    [source.url],
    "Aracaju/SE",
    "mao_de_obra",
  );
  assert.equal(result.status, "estimativa");
  assert.equal(result.calculo?.mean, 2500);
  assert.equal(result.calculo?.total, null);
  assert.match(result.aviso_regional!, /nacionais/);
});
test("preços pesquisados calculam faixas e parte executada em centavos", () => {
  assert.deepEqual(calculateWebPrices([source], 40, 50), {
    mean: 2500,
    minimum: 2000,
    maximum: 3000,
    samples: 1,
    total: 100000,
    total_minimum: 80000,
    total_maximum: 120000,
    completed: 50000,
  });
  assert.equal(calculateWebPrices([source], 40, null).completed, null);
  assert.throws(() => calculateWebPrices([source], -1, 50));
  assert.throws(() => calculateWebPrices([source], 40, 101));
  assert.throws(() =>
    calculateWebPrices([source, { ...source, unidade: "m" }], 40, 50),
  );
});
test("URLs não encontradas na pesquisa não sustentam preço", () => {
  const result = resolveWebEstimate(
    research,
    ["https://outro.example.com"],
    "Aracaju/SE",
    "mao_de_obra",
  );
  assert.equal(result.status, "sem_resultados");
  assert.equal(result.calculo, null);
  assert.deepEqual(result.referencias, []);
});
test("escopo e unidade incompatíveis são excluídos, sem misturar custos", () => {
  const refs = [
    source,
    {
      ...source,
      url: "https://materiais.example.com",
      escopo: "material_e_mao_de_obra",
      valor_minimo: 9000,
      valor_maximo: 12000,
    },
    { ...source, url: "https://unidade.example.com", unidade: "m" },
  ];
  const result = resolveWebEstimate(
    { ...research, referencias: refs },
    refs.map((r) => r.url),
    "Aracaju/SE",
    "mao_de_obra",
  );
  assert.equal(result.referencias.length, 1);
  assert.equal(result.calculo?.mean, 2500);
});
test("referência local tem prioridade e páginas do mesmo site não duplicam peso", () => {
  const local = {
    ...source,
    url: "https://aracaju.example.com/preco",
    regiao: "Aracaju/SE",
    abrangencia: "cidade",
    valor_minimo: 3000,
    valor_maximo: 4000,
  };
  const refs = [
    source,
    local,
    { ...local, url: "https://aracaju.example.com/outro" },
  ];
  const result = resolveWebEstimate(
    { ...research, referencias: refs },
    refs.map((r) => r.url),
    "Aracaju/SE",
    "mao_de_obra",
  );
  assert.equal(result.calculo?.samples, 1);
  assert.equal(result.calculo?.mean, 3500);
  assert.equal(result.aviso_regional, null);
});
test("URLs privadas, credenciais e protocolos executáveis são recusados", () => {
  for (const url of [
    "javascript:alert(1)",
    "file:///tmp/key",
    "https://localhost/x",
    "https://127.0.0.1/x",
    "https://2130706433/x",
    "https://[::1]/x",
    "https://user:pass@example.com",
    "https://host.internal/x",
  ])
    assert.equal(publicSourceUrl(url), null, url);
  assert.equal(publicSourceUrl(source.url + "#preco"), source.url);
});
test("valores negativos, faixa invertida e data inventada fora do formato são recusados", () => {
  for (const reference of [
    { ...source, valor_minimo: -1 },
    { ...source, valor_minimo: 4000, valor_maximo: 3000 },
    { ...source, data_preco: "ontem" },
    { ...source, moeda: "USD" },
  ])
    assert.equal(
      webResearchSchema.safeParse({ ...research, referencias: [reference] })
        .success,
      false,
    );
});
test("OpenAI recebe ferramenta web obrigatória e descrição, sem catálogo ou preços privados", async () => {
  const result = await researchServicePrices({
    ...options,
    fetcher: async (url, init) => {
      assert.equal(url, "https://api.openai.com/v1/responses");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.store, false);
      assert.equal(body.tool_choice, "required");
      assert.equal(body.tools[0].type, "web_search");
      assert.equal(body.tools[0].external_web_access, true);
      assert.equal(body.tools[0].user_location.city, "Aracaju");
      assert.ok(body.include.includes("web_search_call.action.sources"));
      assert.equal(body.text.format.strict, true);
      assert.deepEqual(Object.keys(JSON.parse(body.input)).sort(), [
        "data_pesquisa",
        "escopo",
        "pedido",
        "regiao",
      ]);
      assert.ok(init?.signal);
      return completed();
    },
  });
  assert.equal(result.calculo?.completed, 50000);
});
test("não afirma pesquisa quando a API não executou busca ou a interrompeu", async () => {
  for (const body of [
    {
      status: "completed",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(research) }],
        },
      ],
    },
    { status: "incomplete", output: [] },
    {
      status: "completed",
      output: [
        {
          type: "web_search_call",
          status: "failed",
          action: { type: "search" },
        },
      ],
    },
  ])
    await assert.rejects(
      researchServicePrices({
        ...options,
        fetcher: async () => new Response(JSON.stringify(body)),
      }),
      (error: unknown) =>
        error instanceof AiProviderError && error.status === 502,
    );
});
test("sem preço encontrado na web, retorna estado honesto sem pedir cadastro", async () => {
  const result = await researchServicePrices({
    ...options,
    fetcher: async () =>
      completed(
        {
          ...research,
          referencias: [],
          observacoes: "Não encontrei preço publicado comparável.",
        },
        [],
      ),
  });
  assert.equal(result.status, "sem_resultados");
  assert.equal(result.calculo, null);
});
test("erros do provedor e timeout não expõem mensagens privadas", async () => {
  for (const status of [401, 429, 500])
    await assert.rejects(
      researchServicePrices({
        ...options,
        fetcher: async () =>
          new Response("private provider detail", { status }),
      }),
      (error: unknown) =>
        error instanceof AiProviderError &&
        !error.message.includes("private") &&
        error.status === (status === 401 ? 503 : status === 429 ? 429 : 502),
    );
  await assert.rejects(
    researchServicePrices({
      ...options,
      fetcher: async () => {
        throw new Error("private detail");
      },
    }),
    (error: unknown) =>
      error instanceof AiProviderError && error.status === 504,
  );
});

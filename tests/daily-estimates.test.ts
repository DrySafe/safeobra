import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateDailyCost,
  type DailyStage,
} from "../src/lib/daily-estimates.ts";
import {
  aiEstimateRequestSchema,
  resolveWebEstimate,
  type WebReference,
} from "../src/lib/ai-estimates.ts";
const stage = (
  min: number | null,
  max: number | null = min,
  extra: Partial<DailyStage> = {},
): DailyStage => ({
  nome: "Tarefa de teste",
  horas_minimas: min,
  horas_maximas: max,
  base_tempo: min === null ? "faltam_dados" : "estimativa_tecnica",
  fonte_tempo: null,
  justificativa: "Tempo fictício para verificar cálculo.",
  premissas: [],
  pendencias: [],
  ...extra,
});
const rate = { mean: 25000, minimum: 20000, maximum: 30000 };
const ref: WebReference = {
  titulo: "Diária por pedreiro publicada",
  url: "https://diarias.example.com/pedreiro",
  moeda: "BRL",
  valor_minimo: 20000,
  valor_maximo: 30000,
  unidade: "diária",
  escopo: "mao_de_obra",
  regiao: "Brasil",
  abrangencia: "nacional",
  data_preco: null,
  trecho_preco: "Diária individual de pedreiro entre R$ 200 e R$ 300.",
};
const research = {
  servico: "Escavação, treliças e rasgos",
  metodo: "diaria",
  unidade: "diária",
  quantidade_total: null,
  percentual_executado: null,
  observacoes: "Somente mão de obra.",
  perguntas: [],
  referencias: [ref],
  diaria: {
    pedreiros: 2,
    etapas: [stage(2), stage(3), stage(3)],
    premissas: ["Jornada de oito horas e etapas sequenciais."],
  },
};
test("dois pedreiros em um dia são duas diárias individuais, não duas vezes o prazo", () => {
  const result = calculateDailyCost({
    workers: 2,
    hoursPerDay: 8,
    stages: [stage(2), stage(3), stage(3)],
    rate,
  });
  assert.equal(result.horas_minimas, 8);
  assert.equal(result.dias_trabalho_minimos, 1);
  assert.equal(result.diarias_individuais_minimas, 2);
  assert.equal(result.total_integral_medio, 50000);
  assert.equal(result.total_proporcional_medio, 50000);
});
test("três pequenas tarefas no mesmo dia não cobram uma diária inteira por tarefa", () => {
  const result = calculateDailyCost({
    workers: 2,
    hoursPerDay: 8,
    stages: [stage(1), stage(1), stage(1)],
    rate,
  });
  assert.equal(result.dias_cobrados_minimos, 1);
  assert.equal(result.total_integral_medio, 50000);
  assert.equal(result.total_proporcional_medio, 18750);
});
test("doze horas distinguem dois dias inteiros de cobrança proporcional de um dia e meio", () => {
  const result = calculateDailyCost({
    workers: 2,
    hoursPerDay: 8,
    stages: [stage(12)],
    rate,
  });
  assert.equal(result.dias_trabalho_minimos, 1.5);
  assert.equal(result.diarias_individuais_minimas, 4);
  assert.equal(result.total_integral_medio, 100000);
  assert.equal(result.total_proporcional_medio, 75000);
});
test("faixa de duração e diária gera limites coerentes sem valores monetários da IA", () => {
  const result = calculateDailyCost({
    workers: 2,
    hoursPerDay: 8,
    stages: [stage(8, 12)],
    rate,
  });
  assert.equal(result.total_integral_minimo, 40000);
  assert.equal(result.total_integral_maximo, 120000);
  assert.equal(result.total_proporcional_minimo, 40000);
  assert.equal(result.total_proporcional_maximo, 90000);
});
test("medidas ausentes impedem custo total mas preservam referência de preço por dia da equipe", () => {
  const result = calculateDailyCost({
    workers: 2,
    hoursPerDay: 8,
    stages: [
      stage(null, null, { pendencias: ["Qual a profundidade dos rasgos?"] }),
    ],
    rate,
  });
  assert.equal(result.equipe_por_dia_media, 50000);
  assert.equal(result.horas_minimas, null);
  assert.equal(result.total_integral_medio, null);
  const pending = calculateDailyCost({
    workers: 2,
    hoursPerDay: 8,
    stages: [stage(4, 8, { pendencias: ["Falta medida crítica."] })],
    rate,
  });
  assert.equal(pending.total_integral_medio, null);
});
test("soma em minutos evita cobrar outro dia por erro de ponto flutuante", () => {
  const result = calculateDailyCost({
    workers: 2,
    hoursPerDay: 8,
    stages: [stage(0.1), stage(0.2), stage(7.7)],
    rate,
  });
  assert.equal(result.horas_minimas, 8);
  assert.equal(result.dias_cobrados_minimos, 1);
});
test("equipe, jornada, faixa e custo respeitam limites", () => {
  for (const workers of [0, -1, 1.5, 21])
    assert.throws(() =>
      calculateDailyCost({ workers, hoursPerDay: 8, stages: [stage(1)], rate }),
    );
  assert.throws(() =>
    calculateDailyCost({
      workers: 2,
      hoursPerDay: 0,
      stages: [stage(1)],
      rate,
    }),
  );
  assert.throws(() =>
    calculateDailyCost({
      workers: 2,
      hoursPerDay: 8,
      stages: [stage(5, 2)],
      rate,
    }),
  );
  assert.throws(() =>
    calculateDailyCost({
      workers: 20,
      hoursPerDay: 1,
      stages: [stage(10000)],
      rate: { mean: 1e11, minimum: 1e11, maximum: 1e11 },
    }),
  );
});
test("diária pesquisada e planejamento viram custo da equipe; preço unitário não vira diária", () => {
  const result = resolveWebEstimate(
    research,
    [ref.url],
    "Aracaju/SE",
    "mao_de_obra",
  );
  assert.equal(result.metodo, "diaria");
  assert.equal(result.diaria?.pedreiros, 2);
  assert.equal(result.diaria?.calculo?.total_integral_medio, 50000);
  assert.equal(result.calculo?.total, null);
  const mismatch = resolveWebEstimate(
    { ...research, referencias: [{ ...ref, unidade: "m²" }] },
    [ref.url],
    "Aracaju/SE",
    "mao_de_obra",
  );
  assert.equal(mismatch.referencias.length, 0);
  assert.equal(mismatch.diaria?.calculo, null);
});
test("produtividade sem fonte verificável e equipe divergente bloqueiam duração total", () => {
  const result = resolveWebEstimate(
    {
      ...research,
      diaria: {
        ...research.diaria,
        etapas: [
          stage(4, 8, {
            base_tempo: "referencia_publicada",
            fonte_tempo: "https://invented.example.com",
          }),
        ],
      },
    },
    [ref.url],
    "Aracaju/SE",
    "mao_de_obra",
  );
  assert.equal(result.status, "faltam_dados");
  assert.equal(result.diaria?.calculo?.total_integral_medio, null);
  const mismatch = resolveWebEstimate(
    research,
    [ref.url],
    "Aracaju/SE",
    "mao_de_obra",
    {},
    { workers: 3, hoursPerDay: 8 },
  );
  assert.equal(mismatch.diaria?.pedreiros, 3);
  assert.equal(mismatch.diaria?.calculo?.total_integral_medio, null);
});
test("pedido aceita jornada explícita e não aceita materiais como diária de pedreiro", () => {
  const input = {
    obra_id: "a34a8d0e-267a-4f1d-9b19-b35b4824cc58",
    descricao: "Dois pedreiros para três furos",
    metodo: "diaria",
    pedreiros: 2,
    jornada_horas: 8,
  };
  assert.equal(aiEstimateRequestSchema.parse(input).escopo, "mao_de_obra");
  assert.equal(
    aiEstimateRequestSchema.safeParse({ ...input, escopo: "materiais" })
      .success,
    false,
  );
});

test("pesquisa de diária recebe equipe e jornada e retorna planejamento com custo calculado no servidor", async () => {
  const { researchServicePrices } =
    await import("../src/server/openai-estimator.ts");
  let calls = 0;
  const result = await researchServicePrices({
    key: "test-only-not-real",
    model: "gpt-4.1-mini",
    description:
      "2 pedreiros; 3 furos de 60×60 cm e 1 m de profundidade em piso com porcelanato; 3 rasgos de 2 m × 30 cm; posicionar treliças.",
    region: "Aracaju/SE",
    scope: "mao_de_obra",
    method: "diaria",
    workers: 2,
    hoursPerDay: 8,
    fetcher: async (_url, init) => {
      calls++;
      const request = JSON.parse(String(init?.body));
      const input = JSON.parse(request.input);
      assert.equal(input.pedreiros, 2);
      assert.equal(input.jornada_horas, 8);
      assert.equal(input.metodo, "diaria");
      if (calls === 2) {
        assert.deepEqual(request.text.format.schema.properties.metodo.enum, [
          "diaria",
        ]);
        assert.ok(request.text.format.schema.properties.diaria);
      }
      return new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              type: "web_search_call",
              status: "completed",
              action: {
                type: "search",
                sources: [{ type: "url", url: ref.url }],
              },
            },
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify(research),
                  annotations: [],
                },
              ],
            },
          ],
        }),
      );
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.metodo, "diaria");
  assert.equal(result.diaria?.calculo?.total_integral_medio, 50000);
});

test("tarifa por hora ou diária da equipe não é tratada como diária individual publicada", () => {
  for (const trecho of [
    "R$ 25 por hora, convertido em diária de R$ 200.",
    "Diária da equipe por R$ 600.",
    "Salário mensal convertido para diária.",
  ]) {
    const result = resolveWebEstimate(
      { ...research, referencias: [{ ...ref, trecho_preco: trecho }] },
      [ref.url],
      "Aracaju/SE",
      "mao_de_obra",
    );
    assert.equal(result.referencias.length, 0);
    assert.equal(result.diaria?.calculo, null);
  }
});

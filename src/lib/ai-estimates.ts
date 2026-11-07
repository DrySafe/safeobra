import { z } from "zod";
import { serviceUnits } from "./estimates.ts";
import {
  dailyPlanSchema,
  dailyResultSchema,
  dailyPlanJsonSchema,
  calculateDailyCost,
} from "./daily-estimates.ts";
export const DEFAULT_AI_REGION = "Aracaju/SE";
export const priceScopes = [
  "mao_de_obra",
  "material_e_mao_de_obra",
  "materiais",
] as const;
export const scopeLabels = {
  mao_de_obra: "Somente mão de obra",
  material_e_mao_de_obra: "Material e mão de obra",
  materiais: "Somente materiais",
};
export const aiEstimateRequestSchema = z
  .object({
    obra_id: z.uuid(),
    descricao: z.string().trim().min(5).max(1600),
    regiao: z.string().trim().min(2).max(120).default(DEFAULT_AI_REGION),
    escopo: z.enum(priceScopes).default("mao_de_obra"),
    metodo: z.enum(["automatico", "unitario", "diaria"]).default("automatico"),
    pedreiros: z.number().int().min(1).max(20).nullable().default(null),
    jornada_horas: z.number().min(1).max(12).default(8),
  })
  .strict()
  .refine((data) => data.metodo !== "diaria" || data.escopo === "mao_de_obra", {
    path: ["escopo"],
    message: "O cálculo por diária considera somente mão de obra.",
  });
const measure = z.number().positive().max(1000000).nullable();
const progress = z.number().min(0).max(100).nullable();
export function publicSourceUrl(value: string) {
  try {
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port ||
      !url.hostname.includes(".") ||
      url.hostname.includes(":") ||
      /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) ||
      /\.(local|localhost|internal)$/.test(url.hostname)
    )
      return null;
    url.hash = "";
    for (const name of Array.from(url.searchParams.keys())) {
      if (/^utm_/i.test(name) || ["gclid", "fbclid"].includes(name))
        url.searchParams.delete(name);
    }
    return url.href;
  } catch {
    return null;
  }
}
export const webReferenceSchema = z
  .object({
    titulo: z.string().trim().min(1).max(240),
    url: z
      .string()
      .max(2000)
      .refine((value) => !!publicSourceUrl(value)),
    moeda: z.literal("BRL"),
    valor_minimo: z.number().int().positive().max(100000000000),
    valor_maximo: z.number().int().positive().max(100000000000),
    unidade: z.enum(serviceUnits),
    escopo: z.enum(priceScopes),
    regiao: z.string().min(1).max(160),
    abrangencia: z.enum(["cidade", "estado", "nacional", "outra_regiao"]),
    data_preco: z
      .string()
      .regex(/^\d{4}(?:-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?)?$/)
      .nullable(),
    trecho_preco: z.string().trim().min(5).max(600),
  })
  .strict()
  .refine((row) => row.valor_maximo >= row.valor_minimo);
export type WebReference = z.infer<typeof webReferenceSchema>;
export const webResearchSchema = z
  .object({
    servico: z.string().trim().min(1).max(240),
    metodo: z.enum(["unitario", "diaria"]).default("unitario"),
    diaria: dailyPlanSchema.nullable().default(null),
    unidade: z.enum(serviceUnits).nullable(),
    quantidade_total: measure,
    percentual_executado: progress,
    observacoes: z.string().max(1500),
    perguntas: z.array(z.string().max(300)).max(5),
    referencias: z.array(webReferenceSchema).max(8),
  })
  .strict();
export type WebResearch = z.infer<typeof webResearchSchema>;
export function parseWebResearch(raw: unknown): WebResearch {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return webResearchSchema.parse(raw);
  const value = raw as Record<string, unknown>;
  const references = Array.isArray(value.referencias)
    ? value.referencias
        .flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const copy = { ...item };
          const date = z
            .string()
            .regex(/^\d{4}(?:-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?)?$/)
            .nullable();
          if (!date.safeParse(copy.data_preco).success) copy.data_preco = null;
          const parsed = webReferenceSchema.safeParse(copy);
          return parsed.success ? [parsed.data] : [];
        })
        .slice(0, 8)
    : value.referencias;
  return webResearchSchema.parse({ ...value, referencias: references });
}

export const webCalculationInput = z.object({
  quantidade: measure,
  percentual: progress,
});
export function calculateWebPrices(
  references: WebReference[],
  quantity: number | null,
  percent: number | null,
) {
  webCalculationInput.parse({ quantidade: quantity, percentual: percent });
  if (!references.length) throw new Error("Sem preços pesquisados.");
  if (new Set(references.map((r) => r.unidade + "|" + r.escopo)).size !== 1)
    throw new Error("Referências incompatíveis.");
  const mean = Math.round(
      references.reduce(
        (sum, row) => sum + (row.valor_minimo + row.valor_maximo) / 2,
        0,
      ) / references.length,
    ),
    minimum = Math.min(...references.map((r) => r.valor_minimo)),
    maximum = Math.max(...references.map((r) => r.valor_maximo));
  const total = quantity === null ? null : Math.round(mean * quantity);
  if (total !== null && (!Number.isSafeInteger(total) || total > 100000000000))
    throw new Error("Valor acima do limite.");
  return {
    mean,
    minimum,
    maximum,
    samples: references.length,
    total,
    total_minimum: quantity === null ? null : Math.round(minimum * quantity),
    total_maximum: quantity === null ? null : Math.round(maximum * quantity),
    completed:
      total === null || percent === null
        ? null
        : Math.round((total * percent) / 100),
  };
}
const optionalMoney = z.number().int().nonnegative().nullable();
const calculationSchema = z.object({
  mean: z.number().int().positive(),
  minimum: z.number().int().positive(),
  maximum: z.number().int().positive(),
  samples: z.number().int().positive(),
  total: optionalMoney,
  total_minimum: optionalMoney,
  total_maximum: optionalMoney,
  completed: optionalMoney,
});
export const aiEstimateResponseSchema = z.object({
  status: z.enum(["estimativa", "sem_resultados", "faltam_dados"]),
  metodo: z.enum(["unitario", "diaria"]).default("unitario"),
  diaria: dailyResultSchema.nullable().default(null),
  servico: z.string(),
  regiao_contexto: z.string(),
  escopo: z.enum(priceScopes),
  unidade: z.enum(serviceUnits).nullable(),
  quantidade_total: measure,
  percentual_executado: progress,
  observacoes: z.string(),
  perguntas: z.array(z.string()),
  referencias: z.array(webReferenceSchema),
  calculo: calculationSchema.nullable(),
  aviso_regional: z.string().nullable(),
  pesquisado_em: z.string(),
});
export type AiEstimateResult = z.infer<typeof aiEstimateResponseSchema>;
export function regionParts(region: string) {
  const match = region.match(/^(.+?)\s*\/\s*([a-z]{2})$/i);
  return {
    city: match?.[1].trim() ?? region.trim(),
    uf: match?.[2].toUpperCase() ?? null,
  };
}
const locationText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
export function isIndividualDailyQuote(excerpt: string) {
  const daily =
    /\bdi[aá]rias?\b|\bpor dia\b|\/\s*dia\b|\bdia de trabalho\b/i.test(excerpt);
  const otherBasis =
    /\bpor hora\b|\/\s*h(?:ora)?\b|\bmensal\b|\bsal[aá]rio\b|\bpor m[eê]s\b|di[aá]ria (?:da|de uma) equipe|por equipe|di[aá]ria para \d+ pedreiros/i.test(
      excerpt,
    );
  return daily && !otherBasis;
}
export function resolveWebEstimate(
  raw: unknown,
  sourceUrls: string[],
  region: string,
  scope: (typeof priceScopes)[number],
  sourceTitles: Record<string, string> = {},
  dailyOptions: { workers: number | null; hoursPerDay: number } = {
    workers: null,
    hoursPerDay: 8,
  },
): AiEstimateResult {
  const data = webResearchSchema.parse(raw);
  const byDay = data.metodo === "diaria";
  const unit = byDay ? "diária" : data.unidade;
  const sources = new Set(sourceUrls.map(publicSourceUrl).filter(Boolean));
  const domains = new Set<string>();
  const requested = regionParts(region);
  const rank = { cidade: 0, estado: 1, nacional: 2, outra_regiao: 3 };
  let references = data.referencias
    .filter(
      (row) =>
        sources.has(publicSourceUrl(row.url)) &&
        row.escopo === scope &&
        row.unidade === unit &&
        row.abrangencia !== "outra_regiao" &&
        (unit !== "diária" || isIndividualDailyQuote(row.trecho_preco)),
    )
    .filter((row) => {
      if (row.abrangencia === "nacional")
        return locationText(row.regiao) === "brasil";
      const url = publicSourceUrl(row.url)!;
      const parsed = new URL(url);
      const evidence = locationText(
        parsed.hostname +
          " " +
          parsed.pathname +
          " " +
          (sourceTitles[url] ?? ""),
      );
      if (row.abrangencia === "cidade")
        return (
          locationText(row.regiao) === locationText(region) &&
          (" " + evidence + " ").includes(
            " " + locationText(requested.city) + " ",
          )
        );
      if (row.abrangencia === "estado" && requested.uf) {
        const uf = requested.uf.toLowerCase();
        const stateEvidence =
          (
            " " +
            locationText(parsed.hostname + " " + parsed.pathname) +
            " "
          ).includes(" " + uf + " ") ||
          new RegExp("\\b" + requested.uf + "\\b").test(
            sourceTitles[url] ?? "",
          ) ||
          (requested.uf === "SE" && evidence.includes("sergipe"));
        return row.regiao.toUpperCase() === requested.uf && stateEvidence;
      }
      return false;
    })
    .sort((a, b) => rank[a.abrangencia] - rank[b.abrangencia]);
  if (references.length) {
    const best = references[0].abrangencia;
    references = references
      .filter((row) => row.abrangencia === best)
      .filter((row) => {
        const host = new URL(row.url).hostname.replace(/^www\./, "");
        if (domains.has(host)) return false;
        domains.add(host);
        return true;
      })
      .slice(0, 5);
  }
  const questions = [...data.perguntas];
  let calculation = null;
  if (references.length) {
    try {
      calculation = calculateWebPrices(
        references,
        byDay ? null : data.quantidade_total,
        byDay ? null : data.percentual_executado,
      );
    } catch {
      questions.push(
        "Revise a quantidade: o total ultrapassa os limites do calculador.",
      );
      calculation = calculateWebPrices(references, null, null);
    }
  }
  let daily = null;
  if (byDay) {
    const plan = data.diaria ?? { pedreiros: null, etapas: [], premissas: [] };
    const workers = dailyOptions.workers ?? plan.pedreiros;
    const stages = plan.etapas.map((stage) => {
      if (
        dailyOptions.workers &&
        plan.pedreiros &&
        dailyOptions.workers !== plan.pedreiros
      )
        return {
          ...stage,
          horas_minimas: null,
          horas_maximas: null,
          base_tempo: "faltam_dados" as const,
          fonte_tempo: null,
          pendencias: [
            "Os tempos foram estimados para outra quantidade de pedreiros. Repita a pesquisa com a equipe confirmada.",
          ],
        };
      if (
        stage.base_tempo === "referencia_publicada" &&
        (!stage.fonte_tempo || !sources.has(publicSourceUrl(stage.fonte_tempo)))
      )
        return {
          ...stage,
          horas_minimas: null,
          horas_maximas: null,
          base_tempo: "faltam_dados" as const,
          fonte_tempo: null,
          pendencias: [
            ...stage.pendencias,
            "Falta uma fonte verificável para a produtividade informada.",
          ],
        };
      return {
        ...stage,
        fonte_tempo:
          stage.base_tempo === "referencia_publicada"
            ? stage.fonte_tempo
            : null,
      };
    });
    if (!workers)
      questions.push("Quantos pedreiros vão trabalhar nesta equipe?");
    if (!stages.length)
      questions.push("Detalhe as etapas e as medidas para estimar a duração.");
    let dailyCalculation = null;
    if (workers && calculation && scope === "mao_de_obra") {
      try {
        dailyCalculation = calculateDailyCost({
          workers,
          hoursPerDay: dailyOptions.hoursPerDay,
          stages,
          rate: calculation,
        });
      } catch {
        questions.push(
          "Revise os tempos e a equipe: o custo excede os limites.",
        );
      }
    }
    if (scope !== "mao_de_obra")
      questions.push(
        "O cálculo por diária considera apenas mão de obra; selecione essa composição.",
      );
    daily = {
      pedreiros: workers,
      jornada_horas: dailyOptions.hoursPerDay,
      etapas: stages,
      premissas: plan.premissas,
      calculo: dailyCalculation,
    };
  }
  const tier = references[0]?.abrangencia;
  return aiEstimateResponseSchema.parse({
    status: references.length
      ? byDay && daily?.calculo?.total_integral_medio == null
        ? "faltam_dados"
        : "estimativa"
      : "sem_resultados",
    metodo: data.metodo,
    diaria: daily,
    servico: data.servico,
    regiao_contexto: region,
    escopo: scope,
    unidade: unit,
    quantidade_total: byDay ? null : data.quantidade_total,
    percentual_executado: byDay ? null : data.percentual_executado,
    observacoes: references.length
      ? references.length === data.referencias.length
        ? data.observacoes
        : "Foram consideradas apenas referências compatíveis com a unidade, a composição e a abrangência exibidas."
      : "Não foi encontrado preço publicado com fonte e composição comparáveis nesta pesquisa.",
    perguntas: questions,
    referencias: references,
    calculo: calculation,
    aviso_regional:
      tier === "estado"
        ? "Referências estaduais; confirme o preço específico em " +
          region +
          "."
        : tier === "nacional"
          ? "Não foram encontrados preços locais comparáveis. Estes valores são referências nacionais, sem ajuste artificial para " +
            region +
            "."
          : null,
    pesquisado_em: new Date().toISOString(),
  });
}
const nullable = (type: string) => ({ anyOf: [{ type }, { type: "null" }] });
const object = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
export const webResearchJsonSchema = object({
  metodo: { type: "string", enum: ["unitario", "diaria"] },
  diaria: { anyOf: [dailyPlanJsonSchema, { type: "null" }] },
  servico: { type: "string" },
  unidade: {
    anyOf: [{ type: "string", enum: [...serviceUnits] }, { type: "null" }],
  },
  quantidade_total: nullable("number"),
  percentual_executado: nullable("number"),
  observacoes: { type: "string" },
  perguntas: { type: "array", items: { type: "string" } },
  referencias: {
    type: "array",
    items: object({
      titulo: { type: "string" },
      url: { type: "string" },
      moeda: { type: "string", enum: ["BRL"] },
      valor_minimo: { type: "integer" },
      valor_maximo: { type: "integer" },
      unidade: { type: "string", enum: [...serviceUnits] },
      escopo: { type: "string", enum: [...priceScopes] },
      regiao: { type: "string" },
      abrangencia: {
        type: "string",
        enum: ["cidade", "estado", "nacional", "outra_regiao"],
      },
      data_preco: nullable("string"),
      trecho_preco: { type: "string" },
    }),
  },
});

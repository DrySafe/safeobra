import { z } from "zod";
export const dailyStageSchema = z
  .object({
    nome: z.string().trim().min(1).max(180),
    horas_minimas: z.number().positive().max(10000).nullable(),
    horas_maximas: z.number().positive().max(10000).nullable(),
    base_tempo: z.enum([
      "referencia_publicada",
      "estimativa_tecnica",
      "faltam_dados",
    ]),
    fonte_tempo: z.url().nullable(),
    justificativa: z.string().max(700),
    premissas: z.array(z.string().max(300)).max(6),
    pendencias: z.array(z.string().max(300)).max(6),
  })
  .strict()
  .refine(
    (s) =>
      (s.horas_minimas === null && s.horas_maximas === null) ||
      (s.horas_minimas !== null &&
        s.horas_maximas !== null &&
        s.horas_maximas >= s.horas_minimas),
  );
export const dailyPlanSchema = z
  .object({
    pedreiros: z.number().int().min(1).max(20).nullable(),
    etapas: z.array(dailyStageSchema).max(10),
    premissas: z.array(z.string().max(300)).max(8),
  })
  .strict();
export type DailyPlan = z.infer<typeof dailyPlanSchema>;
export type DailyStage = z.infer<typeof dailyStageSchema>;
const maybe = z.number().nonnegative().nullable();
export const dailyCalculationSchema = z.object({
  pedreiros: z.number().int().positive(),
  jornada_horas: z.number().positive(),
  equipe_por_dia_minimo: z.number().int().positive(),
  equipe_por_dia_maximo: z.number().int().positive(),
  equipe_por_dia_media: z.number().int().positive(),
  horas_minimas: maybe,
  horas_maximas: maybe,
  dias_trabalho_minimos: maybe,
  dias_trabalho_maximos: maybe,
  dias_cobrados_minimos: maybe,
  dias_cobrados_maximos: maybe,
  diarias_individuais_minimas: maybe,
  diarias_individuais_maximas: maybe,
  total_integral_minimo: maybe,
  total_integral_maximo: maybe,
  total_integral_medio: maybe,
  total_proporcional_minimo: maybe,
  total_proporcional_maximo: maybe,
  total_proporcional_medio: maybe,
});
export type DailyCalculation = z.infer<typeof dailyCalculationSchema>;
export const dailyResultSchema = dailyPlanSchema.extend({
  jornada_horas: z.number().min(1).max(12),
  calculo: dailyCalculationSchema.nullable(),
});
export type DailyResult = z.infer<typeof dailyResultSchema>;
export function calculateDailyCost({
  workers,
  hoursPerDay,
  stages,
  rate,
}: {
  workers: number;
  hoursPerDay: number;
  stages: DailyStage[];
  rate: { mean: number; minimum: number; maximum: number };
}): DailyCalculation {
  z.number().int().min(1).max(20).parse(workers);
  z.number().min(1).max(12).parse(hoursPerDay);
  for (const price of [rate.mean, rate.minimum, rate.maximum])
    z.number().int().positive().max(100000000000).parse(price);
  if (rate.minimum > rate.mean || rate.mean > rate.maximum)
    throw new Error("Faixa de diária inválida.");
  const result: DailyCalculation = {
    pedreiros: workers,
    jornada_horas: hoursPerDay,
    equipe_por_dia_minimo: rate.minimum * workers,
    equipe_por_dia_maximo: rate.maximum * workers,
    equipe_por_dia_media: rate.mean * workers,
    horas_minimas: null,
    horas_maximas: null,
    dias_trabalho_minimos: null,
    dias_trabalho_maximos: null,
    dias_cobrados_minimos: null,
    dias_cobrados_maximos: null,
    diarias_individuais_minimas: null,
    diarias_individuais_maximas: null,
    total_integral_minimo: null,
    total_integral_maximo: null,
    total_integral_medio: null,
    total_proporcional_minimo: null,
    total_proporcional_maximo: null,
    total_proporcional_medio: null,
  };
  const validated = stages.map((s) => dailyStageSchema.parse(s));
  if (
    validated.length &&
    validated.every(
      (s) =>
        s.horas_minimas !== null &&
        s.horas_maximas !== null &&
        s.base_tempo !== "faltam_dados" &&
        !s.pendencias.length,
    )
  ) {
    const minMinutes = validated.reduce(
        (sum, s) => sum + Math.max(1, Math.round(s.horas_minimas! * 60)),
        0,
      ),
      maxMinutes = validated.reduce(
        (sum, s) => sum + Math.max(1, Math.round(s.horas_maximas! * 60)),
        0,
      ),
      dayMinutes = Math.round(hoursPerDay * 60),
      meanMinutes = (minMinutes + maxMinutes) / 2;
    result.horas_minimas = minMinutes / 60;
    result.horas_maximas = maxMinutes / 60;
    result.dias_trabalho_minimos = minMinutes / dayMinutes;
    result.dias_trabalho_maximos = maxMinutes / dayMinutes;
    result.dias_cobrados_minimos = Math.ceil(minMinutes / dayMinutes);
    result.dias_cobrados_maximos = Math.ceil(maxMinutes / dayMinutes);
    result.diarias_individuais_minimas = result.dias_cobrados_minimos * workers;
    result.diarias_individuais_maximas = result.dias_cobrados_maximos * workers;
    result.total_integral_minimo =
      result.diarias_individuais_minimas * rate.minimum;
    result.total_integral_maximo =
      result.diarias_individuais_maximas * rate.maximum;
    result.total_integral_medio =
      Math.ceil(meanMinutes / dayMinutes) * workers * rate.mean;
    result.total_proporcional_minimo = Math.round(
      (minMinutes / dayMinutes) * workers * rate.minimum,
    );
    result.total_proporcional_maximo = Math.round(
      (maxMinutes / dayMinutes) * workers * rate.maximum,
    );
    result.total_proporcional_medio = Math.round(
      (meanMinutes / dayMinutes) * workers * rate.mean,
    );
  }
  for (const [name, value] of Object.entries(result)) {
    if (
      (name.startsWith("total_") || name.startsWith("equipe_por_dia")) &&
      typeof value === "number" &&
      (!Number.isSafeInteger(value) || value > 100000000000)
    )
      throw new Error("Custo acima dos limites.");
  }
  return dailyCalculationSchema.parse(result);
}
const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const nullable = (type: string) => ({ anyOf: [{ type }, { type: "null" }] });
export const dailyPlanJsonSchema = obj({
  pedreiros: nullable("integer"),
  premissas: { type: "array", items: { type: "string" } },
  etapas: {
    type: "array",
    items: obj({
      nome: { type: "string" },
      horas_minimas: nullable("number"),
      horas_maximas: nullable("number"),
      base_tempo: {
        type: "string",
        enum: ["referencia_publicada", "estimativa_tecnica", "faltam_dados"],
      },
      fonte_tempo: nullable("string"),
      justificativa: { type: "string" },
      premissas: { type: "array", items: { type: "string" } },
      pendencias: { type: "array", items: { type: "string" } },
    }),
  },
});

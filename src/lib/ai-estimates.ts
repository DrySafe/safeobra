import { z } from "zod";
import {
  estimateService,
  serviceKey,
  serviceUnits,
  type CostSample,
} from "./estimates.ts";
export const DEFAULT_AI_REGION = "Aracaju/SE";
export const aiEstimateRequestSchema = z
  .object({
    obra_id: z.uuid(),
    descricao: z.string().trim().min(5).max(1600),
    regiao: z.string().trim().min(2).max(120).default(DEFAULT_AI_REGION),
  })
  .strict();
export const aiInterpretationSchema = z
  .object({
    grupo_id: z.string().max(40).nullable(),
    unidade: z.enum(serviceUnits).nullable(),
    quantidade_total: z.number().positive().max(1000000).nullable(),
    percentual_executado: z.number().min(0).max(100).nullable(),
  })
  .strict();
export type AiInterpretation = z.infer<typeof aiInterpretationSchema>;
export type AiGroup = {
  id: string;
  key: string;
  nome: string;
  unidade: CostSample["unidade"];
  regiao: string;
  samples: CostSample[];
};
const cleanRegion = (value: string) =>
  value
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\bsergipe\b/g, "se")
    .replace(/[^a-z0-9]/g, "");
export function regionMatches(reference: string, requested: string) {
  const ref = cleanRegion(reference),
    region = cleanRegion(requested);
  return (
    ref === "obraatual" ||
    ref === region ||
    (ref === "se" && region === "aracajuse")
  );
}
export function buildAiGroups(
  samples: CostSample[],
  region: string,
): AiGroup[] {
  const groups = new Map<string, AiGroup>();
  for (const sample of samples) {
    if (!regionMatches(sample.regiao, region)) continue;
    const key = serviceKey(sample);
    let group = groups.get(key);
    if (!group) {
      group = {
        id: "grupo_" + groups.size,
        key,
        nome: sample.nome,
        unidade: sample.unidade,
        regiao: sample.regiao,
        samples: [],
      };
      groups.set(key, group);
    }
    group.samples.push(sample);
  }
  if (groups.size > 100)
    throw new Error(
      "Catálogo amplo demais para esta análise. Use a calculadora de referências.",
    );
  return Array.from(groups.values());
}
export function aiCatalog(groups: AiGroup[]) {
  return groups.map((group) => ({
    id: group.id,
    nome: group.nome,
    unidade: group.unidade,
    regiao: group.regiao,
  }));
}
export function aiOutputJsonSchema(groups: AiGroup[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "grupo_id",
      "unidade",
      "quantidade_total",
      "percentual_executado",
    ],
    properties: {
      grupo_id: groups.length
        ? {
            anyOf: [
              { type: "string", enum: groups.map((g) => g.id) },
              { type: "null" },
            ],
          }
        : { type: "null" },
      unidade: {
        anyOf: [{ type: "string", enum: [...serviceUnits] }, { type: "null" }],
      },
      quantidade_total: { anyOf: [{ type: "number" }, { type: "null" }] },
      percentual_executado: { anyOf: [{ type: "number" }, { type: "null" }] },
    },
  };
}
const calculationSchema = z.object({
  mean: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  minimum: z.number().int().nonnegative(),
  maximum: z.number().int().nonnegative(),
  samples: z.number().int().positive(),
});
export const aiEstimateResponseSchema = z.object({
  status: z.enum(["estimativa", "faltam_dados", "faltam_referencias"]),
  regiao_contexto: z.string(),
  grupo_key: z.string().nullable(),
  servico: z.string().nullable(),
  unidade: z.enum(serviceUnits).nullable(),
  quantidade_total: z.number().nullable(),
  percentual_executado: z.number().nullable(),
  calculo: calculationSchema.nullable(),
  perguntas: z.array(z.string()),
  aviso_regional: z.string().nullable(),
  referencias: z.array(
    z.object({
      id: z.string(),
      fonte: z.string(),
      data_referencia: z.string(),
      regiao: z.string(),
      valor_unitario: z.number(),
    }),
  ),
  gerado_em: z.string(),
});
export type AiEstimateResult = z.infer<typeof aiEstimateResponseSchema>;
export function resolveAiEstimate(
  raw: unknown,
  groups: AiGroup[],
  region: string,
): AiEstimateResult {
  const interpreted = aiInterpretationSchema.parse(raw);
  const group = groups.find((g) => g.id === interpreted.grupo_id);
  if (interpreted.grupo_id !== null && !group)
    throw new Error("A IA selecionou uma referência inexistente.");
  const result: AiEstimateResult = {
    status: "faltam_referencias",
    regiao_contexto: region,
    grupo_key: group?.key ?? null,
    servico: group?.nome ?? null,
    unidade: group?.unidade ?? interpreted.unidade,
    quantidade_total: interpreted.quantidade_total,
    percentual_executado: interpreted.percentual_executado,
    calculo: null,
    perguntas: [],
    aviso_regional: null,
    referencias:
      group?.samples.map((s) => ({
        id: s.id,
        fonte: s.fonte,
        data_referencia: s.data_referencia,
        regiao: s.regiao,
        valor_unitario: Number(s.valor_unitario),
      })) ?? [],
    gerado_em: new Date().toISOString(),
  };
  if (!group) {
    result.perguntas = [
      "Cadastre uma cotação ou referência compatível com o serviço, unidade e região. A IA não preenche preços sem uma fonte.",
    ];
    return result;
  }
  if (cleanRegion(group.regiao) === "obraatual")
    result.aviso_regional =
      "As amostras da obra não têm localização geográfica registrada. Confirme a compatibilidade com " +
      region +
      ".";
  else if (cleanRegion(group.regiao) !== cleanRegion(region))
    result.aviso_regional =
      "Referência estadual; não é uma pesquisa específica da cidade.";
  if (interpreted.unidade !== null && interpreted.unidade !== group.unidade) {
    result.status = "faltam_dados";
    result.perguntas = [
      "A unidade descrita difere da referência. Confirme a quantidade em " +
        group.unidade +
        ".",
    ];
    return result;
  }
  if (interpreted.quantidade_total === null)
    result.perguntas.push(
      "Qual é a quantidade total do serviço em " + group.unidade + "?",
    );
  if (interpreted.unidade === null)
    result.perguntas.push(
      "Confirme a unidade da medição: a referência usa " + group.unidade + ".",
    );
  if (interpreted.percentual_executado === null)
    result.perguntas.push(
      "Qual percentual já foi realizado? Informe 100% para serviço totalmente concluído.",
    );
  if (result.perguntas.length) {
    result.status = "faltam_dados";
    return result;
  }
  try {
    result.calculo = estimateService(
      group.samples.map((s) => Number(s.valor_unitario)),
      interpreted.quantidade_total!,
      interpreted.percentual_executado!,
    );
    result.status = "estimativa";
  } catch {
    result.status = "faltam_dados";
    result.perguntas = [
      "A quantidade resulta em valor acima dos limites. Revise as medições.",
    ];
  }
  return aiEstimateResponseSchema.parse(result);
}

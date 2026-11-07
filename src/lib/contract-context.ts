import { z } from "zod";
export const contractContextSchema = z.object({
  contrato_id: z.string(),
  item_id: z.string().nullable(),
  valor_original: z.number(),
  extras_aprovados: z.number(),
  valor_total: z.number(),
  pago: z.number(),
  descontos: z.number(),
  executado_devido: z.number(),
  devido_agora: z.number(),
  saldo_contrato: z.number(),
  percentual_executado: z.number().nullable(),
  percentual_restante: z.number().nullable(),
  saldo_a_distribuir: z.number(),
  item: z
    .object({
      nome: z.string(),
      classe: z.string(),
      aprovado: z.boolean(),
      valor_cobrado: z.number().nullable(),
      percentual_executado: z.number(),
      pago_vinculado: z.number(),
      desconto_vinculado: z.number(),
      devido_executado: z.number(),
      saldo_item: z.number(),
      mercado_total: z.number().nullable(),
      mercado_executado: z.number().nullable(),
      diferenca_cobrado_mercado: z.number().nullable(),
    })
    .nullable(),
});
export type ContractContext = z.infer<typeof contractContextSchema>;

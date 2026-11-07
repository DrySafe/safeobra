import { z } from "zod";
import { serviceUnits } from "./estimates.ts";
export const categories = [
  "Alvenaria",
  "Elétrica",
  "Hidráulica",
  "Transporte",
  "Decoração",
  "Serviço (mão de obra)",
  "Extras",
] as const;
export const id = z.uuid();
const text = z.string().trim().min(1).max(300);
const optional = z.string().trim().max(2000).default("");
const cents = z.coerce.number().int().min(0).max(100000000000);
const day = z.iso.date();
export const loginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(10).max(128),
});
export const obraSchema = z.object({ nome: text, orcamento: cents });
export const expenseSchema = z.object({
  categoria: z.enum(categories),
  descricao: text,
  fornecedor: text,
  quantidade: z.coerce.number().positive().max(1000000),
  valor_unitario: cents,
  data_compra: day,
  data_entrega: day.nullable(),
  forma_pagamento: text,
  observacoes: optional,
  status_entrega: z.enum(["pendente", "entregue"]),
});
export const contractSchema = z.object({
  profissional: text,
  tipo: z.enum(["empreitada", "diaria"]),
  valor_geral: cents,
});
export const stageSchema = z.object({
  unidade: z.enum(serviceUnits).default("serviço"),
  quantidade: z.coerce.number().positive().max(1000000).default(1),
  contrato_id: id,
  nome: text,
  descricao: optional,
  categoria: z.enum(categories),
  peso: z.coerce.number().int().min(0).max(10000),
});
export const executionSchema = z.object({
  servico_id: id,
  data: day,
  percentual: z.coerce.number().int().min(0).max(100),
  observacoes: optional,
});
export const paymentSchema = z
  .object({
    contrato_id: id,
    servico_id: id.nullable(),
    data: day,
    valor_bruto: cents,
    referencia: text,
    forma_pagamento: text,
    modo: z.enum(["servico", "semanal"]),
  })
  .refine((x) => x.modo !== "servico" || !!x.servico_id, {
    message: "Selecione o serviço",
    path: ["servico_id"],
  });
export const discountSchema = z.object({
  contrato_id: id,
  descricao: text,
  valor: cents.refine((x) => x > 0),
  aplicacao: z.enum(["semanal", "final"]),
});
export const occurrenceSchema = z.object({
  titulo: text,
  descricao: optional,
  tipo: z.enum(["problema", "atencao", "mudanca", "andamento"]),
  data: day,
  servico_id: id.nullable(),
  responsavel: optional,
});
export const inviteSchema = z.object({ role: z.enum(["admin", "user"]) });
export const uploadSchema = z.object({
  entity: z.enum([
    "gastos",
    "contratos_mao_de_obra",
    "pagamentos",
    "descontos_profissional",
    "ocorrencias",
  ]),
  entityId: id,
});
export const MAX_UPLOAD = 4 * 1024 * 1024;
export const allowedMime = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
  "application/xml",
  "text/xml",
];

export const serviceReferenceSchema = z.object({
  nome: text,
  categoria: z.enum(categories),
  unidade: z.enum(serviceUnits),
  valor_unitario: cents.refine((n) => n > 0),
  fonte: text,
  data_referencia: day,
  regiao: text,
});
export const estimationSchema = z.object({
  reference: z.string().min(1).max(1000),
  quantidade: z.coerce.number().positive().max(1000000),
  percentual: z.coerce.number().min(0).max(100),
});

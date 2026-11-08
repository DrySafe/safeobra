import { test } from "node:test";
import assert from "node:assert/strict";
import {
  expenseSchema,
  paymentSchema,
  occurrenceSchema,
  MAX_UPLOAD,
} from "../src/lib/schemas.ts";
const expense = {
  categoria: "Extras",
  descricao: "Cimento",
  fornecedor: "Loja",
  quantidade: 2,
  valor_unitario: 2500,
  data_compra: "2026-11-06",
  data_entrega: null,
  forma_pagamento: "Pix",
  observacoes: "",
  status_entrega: "pendente",
};
test("gasto aceita entrega não informada e observações vazias", () => {
  assert.equal(expenseSchema.parse(expense).observacoes, "");
});
test("despesa aceita categoria personalizada e rejeita valor negativo ou categoria vazia", () => {
  assert.equal(
    expenseSchema.parse({ ...expense, categoria: "  Locação de ferramentas  " })
      .categoria,
    "Locação de ferramentas",
  );
  assert.equal(
    expenseSchema.safeParse({ ...expense, valor_unitario: -1 }).success,
    false,
  );
  assert.equal(
    expenseSchema.safeParse({ ...expense, categoria: "   " }).success,
    false,
  );
  assert.equal(
    expenseSchema.safeParse({ ...expense, categoria: "a".repeat(301) }).success,
    false,
  );
});
test("pagamento por serviço exige vínculo mas semanal não exige", () => {
  const p = {
    contrato_id: "10000000-0000-4000-8000-000000000001",
    servico_id: null,
    data: "2026-11-06",
    valor_bruto: 100,
    referencia: "Semana",
    forma_pagamento: "Pix",
    modo: "semanal",
  };
  assert.equal(paymentSchema.safeParse(p).success, true);
  assert.equal(
    paymentSchema.safeParse({ ...p, modo: "servico" }).success,
    false,
  );
});
test("ocorrência aceita campos opcionais sem definir status privilegiado", () => {
  const o = occurrenceSchema.parse({
    titulo: "Andamento",
    tipo: "andamento",
    data: "2026-11-06",
    servico_id: null,
    descricao: "",
    responsavel: "",
    status: "resolvido",
  });
  assert.ok(!("status" in o));
  assert.equal(MAX_UPLOAD, 4194304);
});

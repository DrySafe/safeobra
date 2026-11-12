import { test } from "node:test";
import assert from "node:assert/strict";
import { compareQuotes } from "../src/lib/quotes.ts";
import {
  quoteSchema,
  quoteGroupSchema,
  uploadSchema,
} from "../src/lib/schemas.ts";

test("comparação ordena os preços, preserva empates e soma várias escolhas em centavos", () => {
  const rows = [
    { id: "c", empresa: "Loja C", valor_total: 10001, selecionada: true },
    { id: "b", empresa: "Loja B", valor_total: 9999, selecionada: false },
    { id: "a", empresa: "Loja A", valor_total: 9999, selecionada: true },
  ];
  const result = compareQuotes(rows);
  assert.deepEqual(
    result.ordered.map((r) => r.id),
    ["a", "b", "c"],
  );
  assert.equal(result.lowest, 9999);
  assert.equal(result.selectedTotal, 20000);
  assert.equal(result.selectedCount, 2);
  assert.deepEqual(
    rows.map((r) => r.id),
    ["c", "b", "a"],
  );
  assert.equal(
    compareQuotes(rows.map((r) => ({ ...r, selecionada: false })))
      .selectedTotal,
    0,
  );
  assert.equal(compareQuotes([]).lowest, null);
});
test("orçamento exige valor positivo em centavos e não aceita escolha ou autoria pelo cadastro", () => {
  const raw = {
    grupo_id: "10000000-0000-4000-8000-000000000001",
    empresa: " Loja ",
    itens: "35 m² de telha com frete",
    valor_total: 123456,
    selecionada: true,
    criado_por: "forjado",
  };
  const parsed = quoteSchema.parse(raw);
  assert.equal(parsed.empresa, "Loja");
  assert.equal(parsed.condicoes, "");
  assert.ok(!("selecionada" in parsed));
  assert.ok(!("criado_por" in parsed));
  for (const value of [0, -1, 0.5, 100000000001])
    assert.equal(
      quoteSchema.safeParse({ ...raw, valor_total: value }).success,
      false,
    );
  assert.equal(quoteGroupSchema.safeParse({ nome: "  " }).success, false);
  assert.equal(quoteSchema.safeParse({ ...raw, itens: " " }).success, false);
  assert.equal(
    uploadSchema.parse({
      entity: "orcamento_propostas",
      entityId: raw.grupo_id,
    }).entity,
    "orcamento_propostas",
  );
});

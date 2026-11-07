import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateService, serviceKey } from "../src/lib/estimates.ts";
test("média por unidade calcula a parte realizada sem alterar o valor contratual", () => {
  assert.deepEqual(estimateService([2000, 3000], 10, 50), {
    mean: 2500,
    total: 25000,
    completed: 12500,
    remaining: 12500,
    minimum: 10000,
    maximum: 15000,
    samples: 2,
  });
});
test("estimativa exige referências reais e entradas válidas", () => {
  assert.throws(() => estimateService([], 10, 50));
  assert.throws(() => estimateService([100], -1, 50));
  assert.throws(() => estimateService([100], 10, 101));
  assert.throws(() => estimateService([100000000000], 1000000, 100));
});
test("referências não misturam unidade ou região e toleram acentos no nome", () => {
  const sample = {
    nome: "Instalação",
    unidade: "m²" as const,
    regiao: "Obra atual",
  };
  assert.equal(
    serviceKey(sample),
    serviceKey({ ...sample, nome: " INSTALACAO " }),
  );
  assert.notEqual(serviceKey(sample), serviceKey({ ...sample, unidade: "un" }));
  assert.notEqual(
    serviceKey(sample),
    serviceKey({ ...sample, regiao: "Outra cidade" }),
  );
});

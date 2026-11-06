import { test } from "node:test";
import assert from "node:assert/strict";
import { execution, settlement, balance, csv } from "../src/lib/finance.ts";
test("execução ponderada em centavos", () => {
  assert.deepEqual(
    execution(4000000, [
      { weight: 6000, progress: 100 },
      { weight: 4000, progress: 50 },
    ]),
    { earned: 3200000, progress: 80, remaining: 800000 },
  );
});
test("pesos devem fechar e progresso respeita limites", () => {
  assert.throws(() => execution(100, [{ weight: 9999, progress: 100 }]));
  assert.throws(() => execution(100, [{ weight: 10000, progress: 101 }]));
});
test("descontos excedentes seguem para próximo fechamento", () => {
  assert.deepEqual(settlement(10000, 15000), {
    gross: 10000,
    applied: 10000,
    net: 0,
    carry: 5000,
  });
  assert.equal(settlement(10000, 5000).net, 5000);
});
test("adiantamento e descontos quitam saldo sem confundir execução", () => {
  assert.deepEqual(balance(4000000, 1000000, 1200000, 100000), {
    due: 0,
    advance: 300000,
    remaining: 2700000,
  });
});
test("rejeita valores negativos e frações de centavo", () => {
  assert.throws(() => settlement(-1, 2));
  assert.throws(() => settlement(1.1, 2));
});
test("CSV protege fórmulas e aspas", () => {
  assert.ok(csv([["=SUM(A1)", 'a"b']]).includes("'=SUM(A1)"));
  assert.ok(csv([['a"b']]).includes('a""b'));
});

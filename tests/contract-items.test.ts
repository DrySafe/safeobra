import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contractItemInput,
  contractItemMetrics,
  allocateContractBudget,
  safeTextFile,
  researchedItemTotal,
  type ContractItem,
  type PaymentAllocation,
} from "../src/lib/contract-items.ts";
import { parseContractText } from "../src/server/contract-import.ts";
const contract = "10000000-0000-4000-8000-000000000001";
function item(
  id: string,
  price: number | null,
  progress = 0,
  extra: Partial<ContractItem> = {},
): ContractItem {
  return {
    ...contractItemInput.parse({
      id,
      nome: "Serviço " + id,
      valor_cobrado: price,
      percentual_executado: progress,
    }),
    id,
    obra_id: contract,
    contrato_id: contract,
    arquivado: false,
    valor_estimado: null,
    estimado_minimo: null,
    estimado_maximo: null,
    estimativa_json: null,
    pesquisado_em: null,
    criado_em: "2026-11-07",
    criado_por: contract,
    ...extra,
  };
}
const a = "20000000-0000-4000-8000-000000000001",
  b = "20000000-0000-4000-8000-000000000002",
  e = "20000000-0000-4000-8000-000000000003";
test("preço incluído não duplica empreitada; extra aprovado pondera avanço e restante", () => {
  const rows = [
    item(a, 60000, 100),
    item(b, 40000, 50),
    item(e, 50000, 0, { classe: "extra", aprovado: false }),
  ];
  let m = contractItemMetrics(100000, rows, [], []);
  assert.equal(m.total, 100000);
  assert.equal(m.earned, 80000);
  assert.equal(m.progress, 80);
  rows[2].aprovado = true;
  rows[2].percentual_executado = 50;
  m = contractItemMetrics(100000, rows, [], []);
  assert.equal(m.total, 150000);
  assert.equal(m.earned, 105000);
  assert.equal(m.progress, 70);
  assert.equal(m.remainingProgress, 30);
});
test("adiantamento fica a distribuir sem inventar pagamento por item e sem duplicar dívida geral", () => {
  const items = [item(a, 100000, 50)],
    payments = [
      {
        id: "p",
        contrato_id: contract,
        anulado: false,
        valor_bruto: 30000,
        desconto: 5000,
        valor: 25000,
      },
    ];
  let m = contractItemMetrics(100000, items, payments, []);
  assert.equal(m.rows[0].paid, 0);
  assert.equal(m.unassignedPaid, 25000);
  assert.equal(m.unassignedDiscount, 5000);
  assert.equal(m.due, 20000);
  assert.equal(m.remaining, 70000);
  const allocation: PaymentAllocation = {
    id: "allocation",
    obra_id: contract,
    contrato_id: contract,
    pagamento_id: "p",
    item_id: a,
    valor_bruto: 30000,
    desconto: 5000,
  };
  m = contractItemMetrics(100000, items, payments, [allocation]);
  assert.equal(m.rows[0].paid, 25000);
  assert.equal(m.rows[0].due, 20000);
  assert.equal(m.unassignedGross, 0);
  payments[0].anulado = true;
  m = contractItemMetrics(100000, items, payments, [allocation]);
  assert.equal(m.rows[0].paid, 0);
  assert.equal(m.due, 50000);
});
test("plano incompleto não afirma conclusão quando há valores por alocar", () => {
  const m = contractItemMetrics(
    100000,
    [item(a, 50000, 100), item(b, null, 0)],
    [],
    [],
  );
  assert.equal(m.reserve, 50000);
  assert.equal(m.progressKnown, false);
  assert.equal(m.pendingCount, 1);
  assert.equal(m.earned, 50000);
});
test("distribuição proporcional preserva cada centavo do preço original e não inclui extras", () => {
  const rows = [
    item(a, null, 0, { valor_estimado: 100 }),
    item(b, null, 0, { valor_estimado: 100 }),
    item(e, 5000, 0, { classe: "extra", aprovado: true, valor_estimado: 900 }),
  ];
  const result = allocateContractBudget(100001, rows);
  assert.equal(result.length, 2);
  assert.equal(
    result.reduce((s, i) => s + i.valor_cobrado!, 0),
    100001,
  );
  assert.deepEqual(
    result.map((i) => i.valor_cobrado),
    [50001, 50000],
  );
  assert.throws(() => allocateContractBudget(100000, [item(a, null)]));
});
test("arquivo aceita UTF-8 e rejeita binário, tamanho e codificação inválida", () => {
  assert.equal(
    safeTextFile(new TextEncoder().encode("\uFEFFSapatas feitas")),
    "Sapatas feitas",
  );
  assert.throws(() => safeTextFile(new Uint8Array(65537)));
  assert.throws(() => safeTextFile(new Uint8Array([255])));
  assert.throws(() => safeTextFile(new TextEncoder().encode("abc\0def")));
});
test("organização de texto não aprova extras e preserva pagamentos apenas como dados de prévia", async () => {
  const draft = contractItemInput.parse({
    nome: "Rasgo na parede",
    classe: "extra",
    aprovado: true,
    valor_cobrado: 50000,
    valor_pago_informado: 10000,
    percentual_executado: 100,
  });
  const result = await parseContractText({
    text: "Rasgo feito; extra R$ 500, pago R$ 100.",
    contractValue: 200000,
    key: "test-only-not-real",
    model: "gpt-4.1-mini",
    fetcher: async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      assert.equal(payload.tools, undefined);
      assert.equal(payload.store, false);
      assert.equal(
        JSON.parse(payload.input).valor_original_contrato_centavos,
        200000,
      );
      return new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    excede_limite: false,
                    itens: [draft],
                    avisos: [],
                  }),
                },
              ],
            },
          ],
        }),
      );
    },
  });
  assert.equal(result.itens[0].id, null);
  assert.equal(result.itens[0].aprovado, false);
  assert.equal(result.itens[0].valor_pago_informado, 10000);
  assert.equal(result.itens[0].percentual_executado, 100);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { researchServicePriceList } from "../src/server/list-price-research.ts";
import { researchedItemTotal } from "../src/lib/contract-items.ts";
const urls = [
  "https://custos.example.com/reboco",
  "https://eletrica.example.com/tomadas",
];
const items = [
  {
    nome: "Reboco da parede",
    descricao: "Parede de 9 m de comprimento; área a confirmar",
    unidade: "serviço" as const,
    quantidade: 1,
  },
  {
    nome: "Tomadas do PC",
    descricao: "Dois conjuntos de tomadas duplas",
    unidade: "un" as const,
    quantidade: 2,
  },
];
function result(indice: number, overrides: Record<string, unknown> = {}) {
  const socket = indice === 1;
  return {
    indice,
    pesquisa: {
      servico: items[indice]?.nome ?? "Outro",
      metodo: "unitario",
      diaria: null,
      unidade: socket ? "un" : "m²",
      quantidade_total: socket ? 2 : null,
      percentual_executado: null,
      observacoes: socket
        ? "Unidade: conjunto de tomada dupla."
        : "Área a confirmar.",
      perguntas: socket ? [] : ["Qual a área da parede em m²?"],
      referencias: [
        {
          titulo: socket ? "Preço conjunto tomada dupla" : "Reboco por m²",
          url: urls[indice],
          moeda: "BRL",
          valor_minimo: socket ? 5000 : 2000,
          valor_maximo: socket ? 7000 : 3000,
          unidade: socket ? "un" : "m²",
          escopo: "mao_de_obra",
          regiao: "Brasil",
          abrangencia: "nacional",
          data_preco: null,
          trecho_preco: socket
            ? "Mão de obra de instalação por conjunto de tomada dupla: R$50 a R$70."
            : "Reboco: mão de obra de R$20 a R$30 por m².",
        },
      ],
      ...overrides,
    },
  };
}
function completed(output: unknown, search = false) {
  return new Response(
    JSON.stringify({
      status: "completed",
      output: [
        ...(search
          ? [
              {
                type: "web_search_call",
                status: "completed",
                action: {
                  type: "search",
                  sources: urls.map((url) => ({ url })),
                },
              },
            ]
          : []),
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text:
                typeof output === "string" ? output : JSON.stringify(output),
              annotations: [],
            },
          ],
        },
      ],
    }),
  );
}
const options = { items, key: "test-only-not-real", model: "gpt-4.1-mini" };
test("lista natural recebe preço por serviço; unidade sem medição não vira total e índices preservam associação", async () => {
  let calls = 0;
  const prices = await researchServicePriceList({
    ...options,
    fetcher: async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      calls++;
      assert.equal(payload.store, false);
      assert.ok(!String(payload.input).includes("valor_geral"));
      if (calls === 1) {
        assert.equal(payload.tool_choice, "required");
        assert.equal(payload.tools[0].type, "web_search");
        assert.equal(
          JSON.parse(payload.input).servicos[1].descricao,
          items[1].descricao,
        );
        return completed(
          "0) Reboco R$20 a R$30/m². 1) Tomada dupla R$50 a R$70/conjunto.",
          true,
        );
      }
      return completed({ resultados: [result(1), result(0)] });
    },
  });
  assert.equal(calls, 2);
  assert.equal(prices.length, 2);
  assert.equal(prices[0].calculo?.mean, 2500);
  assert.equal(prices[0].calculo?.total, null);
  assert.equal(researchedItemTotal(prices[0], items[0]), null);
  assert.equal(prices[1].calculo?.total, 12000);
  assert.equal(researchedItemTotal(prices[1], items[1])?.mean, 12000);
  assert.match(prices[0].aviso_regional!, /nacionais/);
});
test("lista recusa índices repetidos ou omitidos para não atribuir preço ao serviço errado", async () => {
  for (const rows of [[result(0), result(0)], [result(1)]]) {
    let calls = 0;
    await assert.rejects(
      researchServicePriceList({
        ...options,
        fetcher: async () =>
          ++calls === 1
            ? completed("Relatório", true)
            : completed({ resultados: rows }),
      }),
      /validar os preços/,
    );
  }
});
test("fonte não pesquisada não sustenta preço da lista; outros itens continuam calculados", async () => {
  const bad = result(0);
  bad.pesquisa.referencias[0].url = "https://inventada.example.com/preco";
  let calls = 0;
  const prices = await researchServicePriceList({
    ...options,
    fetcher: async () =>
      ++calls === 1
        ? completed("Relatório", true)
        : completed({ resultados: [bad, result(1)] }),
  });
  assert.equal(prices[0].calculo, null);
  assert.equal(prices[1].calculo?.total, 12000);
});
test("não apresenta preço pesquisado sem execução de busca e não expõe erro privado da API", async () => {
  await assert.rejects(
    researchServicePriceList({
      ...options,
      fetcher: async () => completed("Sem ferramenta"),
    }),
    /não concluiu a pesquisa/,
  );
  await assert.rejects(
    researchServicePriceList({
      ...options,
      fetcher: async () => new Response("private token error", { status: 429 }),
    }),
    (error: any) => error.status === 429 && !error.message.includes("private"),
  );
});
test("referência por serviço sem quantidade confirmada não vira preço total por causa do cadastro provisório", async () => {
  const data = result(0, { unidade: "serviço" });
  data.pesquisa.referencias[0].unidade = "serviço";
  let calls = 0;
  const prices = await researchServicePriceList({
    ...options,
    items: [items[0]],
    fetcher: async () =>
      ++calls === 1
        ? completed("Relatório", true)
        : completed({ resultados: [data] }),
  });
  assert.equal(prices[0].calculo?.mean, 2500);
  assert.equal(researchedItemTotal(prices[0], items[0]), null);
});

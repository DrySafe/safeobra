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
test("lista natural recebe pesquisa própria por serviço e preserva unidade, total e associação", async () => {
  let calls = 0;
  const prices = await researchServicePriceList({
    ...options,
    fetcher: async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      calls++;
      assert.equal(payload.store, false);
      const request = JSON.parse(payload.input);
      assert.ok(!String(payload.input).includes("valor_geral"));
      const index = request.pedido.includes("Tomadas") ? 1 : 0;
      if (payload.tools) {
        assert.equal(payload.tool_choice, "required");
        assert.equal(payload.tools[0].type, "web_search");
        return completed(
          "Relatório de preço por unidade do serviço solicitado.",
          true,
        );
      }
      return completed(result(index).pesquisa);
    },
  });
  assert.equal(calls, 4);
  assert.equal(prices.length, 2);
  assert.equal(prices[0].result?.calculo?.mean, 2500);
  assert.equal(prices[0].result?.calculo?.total, null);
  assert.equal(researchedItemTotal(prices[0].result!, items[0]), null);
  assert.equal(prices[1].result?.calculo?.total, 12000);
  assert.equal(researchedItemTotal(prices[1].result!, items[1])?.mean, 12000);
  assert.equal(prices[1].result?.servico, items[1].nome);
  assert.match(prices[0].result!.aviso_regional!, /nacionais/);
});
test("falha de um serviço não elimina preços pesquisados dos outros", async () => {
  const prices = await researchServicePriceList({
    ...options,
    fetcher: async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      if (JSON.parse(payload.input).pedido.includes("Tomadas"))
        return new Response("private error", { status: 500 });
      return payload.tools
        ? completed("Relatório", true)
        : completed(result(0).pesquisa);
    },
  });
  assert.equal(prices[0].result?.calculo?.mean, 2500);
  assert.ok(prices[1].error);
  assert.ok(!prices[1].error?.includes("private"));
});
test("fonte não pesquisada não sustenta preço da lista; outros itens continuam calculados", async () => {
  const bad = result(0);
  bad.pesquisa.referencias[0].url = "https://inventada.example.com/preco";
  const prices = await researchServicePriceList({
    ...options,
    fetcher: async (_url, init) => {
      const payload = JSON.parse(String(init?.body)),
        index = JSON.parse(payload.input).pedido.includes("Tomadas") ? 1 : 0;
      return payload.tools
        ? completed("Relatório", true)
        : completed(index ? result(1).pesquisa : bad.pesquisa);
    },
  });
  assert.equal(prices[0].result?.calculo, null);
  assert.equal(prices[1].result?.calculo?.total, 12000);
});
test("não apresenta preço pesquisado sem busca real e não expõe erro privado da API", async () => {
  await assert.rejects(
    researchServicePriceList({
      ...options,
      fetcher: async () => completed("Sem ferramenta"),
    }),
    /fontes válidas/,
  );
  await assert.rejects(
    researchServicePriceList({
      ...options,
      fetcher: async () => new Response("private token error", { status: 429 }),
    }),
    (error: any) => error.status === 429 && !error.message.includes("private"),
  );
});
test("referência por serviço sem quantidade confirmada não vira preço total do cadastro provisório", async () => {
  const data = result(0, { unidade: "serviço" });
  data.pesquisa.referencias[0].unidade = "serviço";
  const prices = await researchServicePriceList({
    ...options,
    items: [items[0]],
    fetcher: async (_url, init) =>
      JSON.parse(String(init?.body)).tools
        ? completed("Relatório", true)
        : completed(data.pesquisa),
  });
  assert.equal(prices[0].result?.calculo?.mean, 2500);
  assert.equal(researchedItemTotal(prices[0].result!, items[0]), null);
});

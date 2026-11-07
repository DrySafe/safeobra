import "server-only";
import { researchServicePrices, AiProviderError } from "./openai-estimator.ts";
import { reviewServicePrices, applyPriceReview } from "./price-review.ts";
import type { AiEstimateResult } from "../lib/ai-estimates.ts";
export const PRICE_LIST_BATCH_SIZE = 8;
export type PriceListItem = {
  nome: string;
  descricao: string;
  unidade: string;
  quantidade: number;
};
export type PriceListOutcome =
  | { result: AiEstimateResult; error?: never }
  | { result?: never; error: string };
export const SERVICE_BUDGET_PROMPT = `Sua finalidade principal é calcular uma referência de PREÇO para o serviço descrito em linguagem natural, não apenas organizar o texto ou fazer perguntas. Interprete o nome informal como o serviço técnico correspondente e procure a composição de mão de obra pertinente. Pesquise fontes publicadas para Aracaju/SE; se não houver fonte local, procure referência estadual ou nacional e identifique a abrangência real. Leia as fontes e preserve os trechos dos preços, sem inventar números ou atribuí-los a links que não os sustentam.
Quantidade ausente impede o TOTAL, não impede o PREÇO POR UNIDADE. Pesquise e entregue R$/m² para alvenaria, revestimentos ou pintura; R$/m para serviços medidos por comprimento; por peça, ponto ou conjunto para instalações. Esses exemplos orientam sua interpretação, não são um catálogo fechado. Explique o que a unidade da referência inclui: uma tomada dupla é um conjunto duplo, e não duas instalações simples. Separe material de mão de obra. Não use visita técnica, deslocamento ou preço genérico de atendimento como execução completa de uma tarefa específica.
A unidade da pesquisa deve ser a unidade comercial da fonte. Todas as referências aproveitadas têm essa mesma unidade. Um cadastro provisório de 1 serviço NÃO informa área nem comprimento. Exemplo de formato: "elevar parede de aproximadamente 9 m, área a confirmar" e fonte de alvenaria a R$40–60/m² devem resultar em unidade=m², quantidade_total=null e referências em m², mínimo=4000, máximo=6000. Não retorne unidade=serviço para esse preço por m². Use os valores reais da pesquisa; os números do exemplo não são uma referência de preço. Não exija altura da parede antes de fornecer o preço por m². Com medidas suficientes, use a quantidade conhecida para calcular o total; sem elas, mostre o preço por unidade e peça somente a medição necessária.
Se não encontrar preço específico por unidade, pesquise a DIÁRIA INDIVIDUAL do profissional adequado à tarefa (pedreiro, eletricista, encanador etc.) como referência alternativa. Nesse caso, metodo=unitario, unidade=diária, quantidade_total=null, diaria=null; explique a profissão e que falta duração/equipe para o custo completo. Não suponha um dia de trabalho nem use diária de outra profissão ou salário mensal. Se o usuário já informou equipe, medidas e condições suficientes, mantenha a lógica de estimativa técnica de duração por equipe do método diaria, com hipóteses explícitas e custo calculado pelo servidor.
Retorne uma faixa útil de preço com fonte sempre que houver evidência compatível. Se não encontrar referência, diga isso, sem inventar. Condições de acesso e variações usuais são premissas de uma estimativa preliminar, não motivos genéricos para recusar todo preço. Pergunte apenas o que falta para o total, sem repetir dados já fornecidos. Não use o orçamento contratado como fonte nem altere valores cobrados ou pagamentos.`;
export async function researchServicePriceList({
  items,
  key,
  model,
  fetcher = fetch,
}: {
  items: PriceListItem[];
  key: string;
  model: string;
  fetcher?: typeof fetch;
}): Promise<PriceListOutcome[]> {
  if (!items.length || items.length > PRICE_LIST_BATCH_SIZE)
    throw new AiProviderError(
      400,
      "Selecione de um a oito serviços por pesquisa.",
    );
  // Independent research preserves scope, units and sources for each service.
  // Promise.allSettled preserves input order and retains successful prices when
  // one provider request fails, without asking the model to associate row IDs.
  const pending = await Promise.allSettled(
    items.map((item) =>
      researchServicePrices({
        key,
        model,
        fetcher,
        region: "Aracaju/SE",
        scope: "mao_de_obra",
        method: "automatico",
        description: (
          item.nome +
          ". " +
          item.descricao.slice(0, 1050) +
          ". " +
          (item.unidade === "serviço"
            ? "O cadastro representa o serviço completo; considere somente as medições explícitas na descrição."
            : `Quantidade cadastrada: ${Number(item.quantidade)} ${item.unidade}.`) +
          " Quero o preço de mão de obra por unidade e o total quando houver medição suficiente."
        ).slice(0, 1600),
        budgetInstructions: SERVICE_BUDGET_PROMPT,
      }),
    ),
  );
  if (pending.every((p) => p.status === "rejected")) {
    const first = pending[0] as PromiseRejectedResult;
    if (first.reason instanceof AiProviderError) throw first.reason;
    throw new AiProviderError(
      503,
      "Não foi possível pesquisar os preços agora. Tente novamente.",
    );
  }
  let prices: PriceListOutcome[] = pending.map((row, index) =>
    row.status === "fulfilled"
      ? { result: { ...row.value, servico: items[index].nome } }
      : {
          error:
            row.reason instanceof AiProviderError
              ? row.reason.message
              : "Não foi possível calcular este preço. Tente novamente.",
        },
  );
  const reviews = await reviewServicePrices({
    items,
    prices,
    key,
    model,
    fetcher,
  });
  prices = prices.map((row, index) =>
    row.result ? { result: applyPriceReview(row.result, reviews[index]) } : row,
  );
  const retry = prices
    .map((row, index) => ({ row, index }))
    .filter(
      ({ row, index }) =>
        row.result && !row.result.calculo && reviews[index].profissional,
    );
  if (retry.length) {
    const alternatives = await Promise.allSettled(
      retry.map(({ index }) =>
        researchServicePrices({
          key,
          model,
          fetcher,
          region: "Aracaju/SE",
          scope: "mao_de_obra",
          method: "unitario",
          description: `Pesquise exclusivamente a diária INDIVIDUAL de ${reviews[index].profissional} para usar como referência de mão de obra de: ${items[index].nome}. Não há duração confirmada. Preciso do preço por dia, não do valor total do serviço, salário mensal ou visita técnica.`,
          budgetInstructions: SERVICE_BUDGET_PROMPT,
        }),
      ),
    );
    const alternativeItems = retry.map(({ index }) => items[index]);
    const alternativePrices: PriceListOutcome[] = alternatives.map(
      (row, index) =>
        row.status === "fulfilled"
          ? {
              result: {
                ...row.value,
                servico: alternativeItems[index].nome,
                quantidade_total: null,
              },
            }
          : {
              error: "Não foi encontrada diária alternativa para este serviço.",
            },
    );
    const alternativeReviews = await reviewServicePrices({
      items: alternativeItems,
      prices: alternativePrices,
      key,
      model,
      fetcher,
    });
    for (let n = 0; n < retry.length; n++) {
      const result = alternativePrices[n].result;
      if (result) {
        const checked = applyPriceReview(result, {
          ...alternativeReviews[n],
          quantidade_confirmada: false,
        });
        if (checked.calculo) {
          checked.observacoes = (
            "Referência alternativa por diária individual de " +
            reviews[retry[n].index].profissional +
            ". O total depende de duração e equipe. " +
            checked.observacoes
          ).slice(0, 1500);
          prices[retry[n].index] = { result: checked };
        }
      }
    }
  }
  return prices;
}

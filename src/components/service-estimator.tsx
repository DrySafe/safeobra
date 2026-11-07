"use client";
import { useMemo, useState } from "react";
import {
  estimateService,
  serviceKey,
  serviceUnits,
  type CostSample,
} from "@/lib/estimates";
import { estimationSchema } from "@/lib/schemas";
import { money, dateBR } from "@/lib/finance";
import { DataForm, DeleteButton, type Field } from "./forms";
import { AiServiceAssistant } from "./ai-service-assistant";
import type { Contract } from "@/lib/models";
import type { ContractItem } from "@/lib/contract-items";
export function ServiceEstimator({
  obra,
  admin,
  samples,
  references,
  categories,
  aiEnabled,
  contracts,
  contractItems,
}: {
  obra: string;
  admin: boolean;
  samples: CostSample[];
  references: CostSample[];
  categories: string[];
  aiEnabled: boolean;
  contracts: Contract[];
  contractItems: ContractItem[];
}) {
  const groups = useMemo(() => {
    const map = new Map<string, CostSample[]>();
    for (const sample of samples) {
      const key = serviceKey(sample);
      const rows = map.get(key);
      if (rows) rows.push(sample);
      else map.set(key, [sample]);
    }
    return map;
  }, [samples]);
  const [selected, setSelected] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [progress, setProgress] = useState("100");
  const key = groups.has(selected)
    ? selected
    : (Array.from(groups.keys())[0] ?? "");
  const current = groups.get(key) ?? [];
  const parsed = estimationSchema.safeParse({
    reference: key,
    quantidade: quantity,
    percentual: progress,
  });
  let result: ReturnType<typeof estimateService> | null = null;
  let calculationError = "";
  if (parsed.success && current.length) {
    try {
      result = estimateService(
        current.map((s) => Number(s.valor_unitario)),
        parsed.data.quantidade,
        parsed.data.percentual,
      );
    } catch {
      calculationError =
        "A quantidade ou o valor excede os limites. Revise os dados.";
    }
  }
  const fields: Field[] = [
    { name: "nome", label: "Serviço (ex.: reboco)" },
    {
      name: "categoria",
      label: "Categoria",
      options: categories.map((value) => ({ value, label: value })),
    },
    {
      name: "unidade",
      label: "Unidade",
      options: serviceUnits.map((value) => ({ value, label: value })),
    },
    {
      name: "valor_unitario",
      label: "Preço por unidade (R$)",
      type: "number",
      scale: 100,
    },
    { name: "fonte", label: "Fonte / profissional / código da composição" },
    { name: "regiao", label: "Cidade / UF ou escopo", value: "Aracaju/SE" },
    {
      name: "data_referencia",
      label: "Data da cotação",
      type: "date",
      value: new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Maceio",
      }).format(new Date()),
    },
  ];
  return (
    <>
      <AiServiceAssistant
        key={obra}
        obra={obra}
        enabled={aiEnabled}
        admin={admin}
        contracts={contracts}
        contractItems={contractItems}
      />
      <details className="manual-estimates">
        <summary className="panel">
          Opcional: calculadora e referências da obra
        </summary>
        <section className="panel">
          <h2>Calculadora com suas referências</h2>
          <p className="muted">
            Opcional: média das cotações e etapas concluídas da obra. Não altera
            contratos nem pagamentos.
          </p>
          {groups.size ? (
            <>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="estimate-reference">
                    Serviço e referência
                  </label>
                  <select
                    id="estimate-reference"
                    value={key}
                    onChange={(event) => setSelected(event.target.value)}
                  >
                    {Array.from(groups).map(([group, rows]) => (
                      <option key={group} value={group}>
                        {rows[0].nome} · {rows[0].unidade} · {rows[0].regiao}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="estimate-quantity">
                    Quantidade total ({current[0]?.unidade})
                  </label>
                  <input
                    id="estimate-quantity"
                    type="number"
                    min="0.0001"
                    max="1000000"
                    step="any"
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="estimate-progress">
                    Percentual realizado (%)
                  </label>
                  <input
                    id="estimate-progress"
                    type="number"
                    min="0"
                    max="100"
                    step="any"
                    value={progress}
                    onChange={(event) => setProgress(event.target.value)}
                  />
                </div>
              </div>
              {result ? (
                <div aria-live="polite">
                  <div className="cards estimate-cards">
                    <article className="card">
                      <span className="muted small">
                        Média por {current[0].unidade}
                      </span>
                      <div className="value">{money(result.mean)}</div>
                      <span className="small muted">
                        {result.samples} referência(s)
                      </span>
                    </article>
                    <article className="card">
                      <span className="muted small">
                        Estimativa do realizado
                      </span>
                      <div className="value">{money(result.completed)}</div>
                      <span className="small muted">
                        {progress}% de {quantity} {current[0].unidade}
                      </span>
                    </article>
                    <article className="card">
                      <span className="muted small">Estimativa total</span>
                      <div className="value">{money(result.total)}</div>
                      <span className="small muted">
                        Falta realizar: {money(result.remaining)}
                      </span>
                    </article>
                  </div>
                  <p className="small muted">
                    Faixa observada para a parte realizada:{" "}
                    {money(result.minimum)} a {money(result.maximum)}. Com uma
                    única referência, a faixa tem um só valor.
                  </p>
                </div>
              ) : (
                <p role="status">
                  {calculationError ||
                    "Informe uma quantidade válida e percentual de 0 a 100."}
                </p>
              )}
              <details>
                <summary>De onde veio essa média?</summary>
                {current.map((sample) => (
                  <p className="small" key={sample.id}>
                    <strong>
                      {money(sample.valor_unitario)} / {sample.unidade}
                    </strong>{" "}
                    · {sample.fonte} · {sample.regiao} ·{" "}
                    {dateBR(sample.data_referencia)}
                  </p>
                ))}
                <p className="small muted">
                  Só são agrupadas amostras do mesmo serviço, unidade e região.
                  O valor de contrato de uma etapa concluída é dividido pela
                  quantidade prevista. Não representa uma pesquisa nacional de
                  preços ou o custo efetivamente pago.
                </p>
              </details>
            </>
          ) : (
            <p className="empty">
              Ainda não há preços de referência. Cadastre uma cotação ou conclua
              uma etapa com quantidade e unidade de medição para começar a
              formar sua base.
            </p>
          )}
        </section>
        {admin && (
          <details className="panel">
            <summary>+ Cadastrar preço de referência</summary>
            <DataForm
              kind="referencias_servicos"
              obra={obra}
              fields={fields}
              title="Salvar referência"
            />
            <p className="small muted">
              Use uma cotação real ou uma composição de custos com fonte e data.
              Referências de regiões e unidades diferentes não são misturadas.
            </p>
          </details>
        )}
        <section className="panel">
          <h2>Base de preços da obra</h2>
          {references.length ? (
            references.map((reference) => (
              <div className="row" key={reference.id}>
                <div>
                  <strong>{reference.nome}</strong>
                  <p className="small muted">
                    {money(reference.valor_unitario)} / {reference.unidade} ·{" "}
                    {reference.regiao}
                    <br />
                    {reference.fonte} · {dateBR(reference.data_referencia)}
                  </p>
                </div>
                {admin && (
                  <DeleteButton
                    obra={obra}
                    entity="referencias_servicos"
                    id={reference.id}
                  />
                )}
              </div>
            ))
          ) : (
            <p className="muted">
              Nenhuma cotação cadastrada. Etapas concluídas entram
              automaticamente na estimativa, com identificação da origem.
            </p>
          )}
        </section>
      </details>
    </>
  );
}

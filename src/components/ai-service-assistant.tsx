"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  aiEstimateRequestSchema,
  aiEstimateResponseSchema,
  DEFAULT_AI_REGION,
  priceScopes,
  scopeLabels,
  calculateWebPrices,
  type AiEstimateResult,
} from "@/lib/ai-estimates";
import { money } from "@/lib/finance";
import { useReading } from "./navigation";
import { DailyEstimate } from "./daily-estimate";
import { ContractContextView } from "./contract-context-view";
import type { Contract } from "@/lib/models";
import type { ContractItem } from "@/lib/contract-items";
export function AiServiceAssistant({
  obra,
  enabled,
  admin,
  contracts,
  contractItems,
}: {
  obra: string;
  enabled: boolean;
  admin: boolean;
  contracts: Contract[];
  contractItems: ContractItem[];
}) {
  const [description, setDescription] = useState(""),
    [region, setRegion] = useState(DEFAULT_AI_REGION),
    [scope, setScope] = useState<(typeof priceScopes)[number]>("mao_de_obra"),
    [method, setMethod] = useState<"automatico" | "unitario" | "diaria">(
      "automatico",
    ),
    [workers, setWorkers] = useState(""),
    [hoursPerDay, setHoursPerDay] = useState("8"),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<AiEstimateResult | null>(null),
    [quantity, setQuantity] = useState(""),
    [progress, setProgress] = useState("");
  const [contractId, setContractId] = useState(""),
    [itemId, setItemId] = useState("");
  const active = useRef<AbortController | null>(null);
  useReading(pending);
  useEffect(() => () => active.current?.abort(), []);
  function invalidate() {
    setResult(null);
    setError("");
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    invalidate();
    const parsed = aiEstimateRequestSchema.safeParse({
      obra_id: obra,
      contrato_id: contractId || null,
      item_id: itemId || null,
      descricao: description,
      regiao: region,
      escopo: scope,
      metodo: method,
      pedreiros: workers === "" ? null : Number(workers),
      jornada_horas: Number(hoursPerDay),
    });
    if (!parsed.success) {
      setError(
        "Confira a descrição (5 a 1.600 caracteres), cidade/UF, equipe (1 a 20) e jornada (1 a 12 h).",
      );
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    const timer = setTimeout(() => controller.abort(), 55000);
    try {
      const response = await fetch("/api/ai/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
        signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok) {
        setError(
          typeof body.error === "string"
            ? body.error
            : "Não foi possível pesquisar o preço. Tente novamente.",
        );
        return;
      }
      const researched = aiEstimateResponseSchema.parse(body);
      setResult(researched);
      setQuantity(
        researched.quantidade_total === null
          ? ""
          : String(researched.quantidade_total),
      );
      setProgress(
        researched.percentual_executado === null
          ? ""
          : String(researched.percentual_executado),
      );
    } catch {
      setError(
        "Não foi possível concluir a pesquisa. Verifique a conexão e tente novamente.",
      );
    } finally {
      clearTimeout(timer);
      active.current = null;
      setPending(false);
    }
  }
  let simulated: ReturnType<typeof calculateWebPrices> | null = null;
  let simulationError = "";
  if (result?.referencias.length && result.metodo !== "diaria") {
    try {
      simulated = calculateWebPrices(
        result.referencias,
        quantity === "" ? null : Number(quantity),
        progress === "" ? null : Number(progress),
      );
    } catch {
      simulationError =
        "Informe uma quantidade válida e percentual de 0 a 100, dentro dos limites do calculador.";
    }
  }
  return (
    <section className="panel" aria-labelledby="ai-title">
      <h2 id="ai-title">Pesquisar preço na internet</h2>
      <p className="muted">
        Pergunte o preço de um serviço. A IA pesquisa fontes na web, prioriza
        sua região e mostra os links e a faixa de valores encontrados. Também
        estima equipe, duração e custo por diária.
      </p>
      {enabled ? (
        <>
          <form method="post" onSubmit={submit}>
            {contracts.length > 0 && (
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="ai-contract">
                    Empreitada para comparar (opcional)
                  </label>
                  <select
                    id="ai-contract"
                    value={contractId}
                    disabled={pending}
                    onChange={(e) => {
                      setContractId(e.target.value);
                      setItemId("");
                      if (e.target.value) setScope("mao_de_obra");
                      invalidate();
                    }}
                  >
                    <option value="">Pesquisa avulsa</option>
                    {contracts
                      .filter((c) => c.tipo === "empreitada")
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.profissional} · original{" "}
                          {money(Number(c.valor_geral))}
                        </option>
                      ))}
                  </select>
                </div>
                {contractId && (
                  <div className="field">
                    <label htmlFor="ai-contract-item">
                      Serviço da empreitada
                    </label>
                    <select
                      id="ai-contract-item"
                      value={itemId}
                      disabled={pending}
                      onChange={(e) => {
                        setItemId(e.target.value);
                        const item = contractItems.find(
                          (i) => i.id === e.target.value,
                        );
                        if (item)
                          setDescription(
                            (
                              item.nome +
                              ". " +
                              item.descricao.slice(0, 1100) +
                              ". Quantidade: " +
                              item.quantidade +
                              " " +
                              item.unidade +
                              ". Executado: " +
                              item.percentual_executado +
                              "%."
                            ).slice(0, 1600),
                          );
                        invalidate();
                      }}
                    >
                      <option value="">
                        Somente contexto geral do contrato
                      </option>
                      {contractItems
                        .filter((i) => i.contrato_id === contractId)
                        .map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.nome}
                          </option>
                        ))}
                    </select>
                  </div>
                )}
              </div>
            )}
            <div className="field">
              <label htmlFor="ai-description">
                Qual preço você quer saber?
              </label>
              <textarea
                id="ai-description"
                required
                minLength={5}
                maxLength={1600}
                rows={4}
                value={description}
                disabled={pending}
                placeholder="Ex.: Quanto custa o m² de reboco? Preciso fazer 40 m²."
                onChange={(e) => {
                  setDescription(e.target.value);
                  invalidate();
                }}
              />
            </div>
            <div className="field">
              <label htmlFor="ai-method">Como estimar</label>
              <select
                id="ai-method"
                value={method}
                disabled={pending}
                onChange={(e) => {
                  const selected = e.target.value as typeof method;
                  setMethod(selected);
                  if (selected === "diaria") setScope("mao_de_obra");
                  invalidate();
                }}
              >
                <option value="automatico">
                  Automático: serviço ou diária
                </option>
                <option value="unitario">Preço por serviço / unidade</option>
                <option value="diaria">
                  Diária da equipe e tempo de execução
                </option>
              </select>
            </div>
            {method !== "unitario" && (
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="ai-workers">Pedreiros (opcional)</label>
                  <input
                    id="ai-workers"
                    type="number"
                    min="1"
                    max="20"
                    step="1"
                    value={workers}
                    disabled={pending}
                    placeholder="Usar quantidade da descrição"
                    onChange={(e) => {
                      setWorkers(e.target.value);
                      invalidate();
                    }}
                  />
                </div>
                <div className="field">
                  <label htmlFor="ai-hours">Jornada (horas por dia)</label>
                  <input
                    id="ai-hours"
                    type="number"
                    min="1"
                    max="12"
                    step="0.5"
                    value={hoursPerDay}
                    disabled={pending}
                    onChange={(e) => {
                      setHoursPerDay(e.target.value);
                      invalidate();
                    }}
                  />
                </div>
              </div>
            )}
            <div className="form-grid">
              <div className="field">
                <label htmlFor="ai-region">Cidade / UF</label>
                <input
                  id="ai-region"
                  required
                  minLength={2}
                  maxLength={120}
                  value={region}
                  disabled={pending}
                  onChange={(e) => {
                    setRegion(e.target.value);
                    invalidate();
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor="ai-scope">O preço deve incluir</label>
                <select
                  id="ai-scope"
                  value={scope}
                  disabled={pending || method === "diaria" || !!contractId}
                  onChange={(e) => {
                    setScope(e.target.value as typeof scope);
                    invalidate();
                  }}
                >
                  {priceScopes.map((value) => (
                    <option key={value} value={value}>
                      {scopeLabels[value]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="small muted">
              Não precisa cadastrar uma base de preços. A descrição, a região e
              o tipo de custo serão enviados à OpenAI para a pesquisa.
            </p>
            <button type="submit" disabled={pending}>
              {pending ? "Pesquisando fontes na internet…" : "Pesquisar preço"}
            </button>
            {pending && (
              <p className="small muted" role="status">
                Buscando preços e conferindo as fontes. Isso pode levar alguns
                segundos.
              </p>
            )}
          </form>
          {error && <p role="alert">{error}</p>}
          <div
            className={result ? "ai-result" : undefined}
            aria-live="polite"
            aria-busy={pending}
          >
            {result && (
              <>
                <h3>{result.servico}</h3>
                <p className="small">
                  {scopeLabels[result.escopo]} · {result.regiao_contexto}
                </p>
                {result.calculo ? (
                  <>
                    <div className="cards estimate-cards">
                      <article className="card">
                        <span className="muted small">
                          {result.metodo === "diaria"
                            ? "Diária média por pedreiro"
                            : "Média indicativa por " + result.unidade}
                        </span>
                        <div className="value">
                          {money(result.calculo.mean)}
                        </div>
                        <span className="small muted">
                          {result.calculo.samples} fonte(s)
                        </span>
                      </article>
                      <article className="card">
                        <span className="muted small">
                          {result.metodo === "diaria"
                            ? "Faixa de diária por pedreiro"
                            : "Faixa por " + result.unidade}
                        </span>
                        <div className="value">
                          {money(result.calculo.minimum)} a{" "}
                          {money(result.calculo.maximum)}
                        </div>
                      </article>
                    </div>
                    {result.metodo !== "diaria" && (
                      <>
                        <div className="form-grid">
                          <div className="field">
                            <label htmlFor="web-quantity">
                              Quantidade para calcular ({result.unidade},
                              opcional)
                            </label>
                            <input
                              id="web-quantity"
                              type="number"
                              min="0.0001"
                              max="1000000"
                              step="any"
                              value={quantity}
                              onChange={(e) => setQuantity(e.target.value)}
                            />
                          </div>
                          <div className="field">
                            <label htmlFor="web-progress">
                              Percentual realizado (%, opcional)
                            </label>
                            <input
                              id="web-progress"
                              type="number"
                              min="0"
                              max="100"
                              step="any"
                              value={progress}
                              onChange={(e) => setProgress(e.target.value)}
                            />
                          </div>
                        </div>
                        {simulationError && (
                          <p role="status">{simulationError}</p>
                        )}
                        {simulated?.total !== null &&
                          simulated?.total !== undefined && (
                            <div className="cards estimate-cards">
                              <article className="card">
                                <span className="muted small">
                                  Estimativa total
                                </span>
                                <div className="value">
                                  {money(simulated.total)}
                                </div>
                                <span className="small muted">
                                  Faixa: {money(simulated.total_minimum!)} a{" "}
                                  {money(simulated.total_maximum!)}
                                </span>
                              </article>
                              {simulated.completed !== null && (
                                <article className="card">
                                  <span className="muted small">
                                    Estimativa do realizado
                                  </span>
                                  <div className="value">
                                    {money(simulated.completed)}
                                  </div>
                                  <span className="small muted">
                                    {progress}% de {quantity} {result.unidade}
                                  </span>
                                </article>
                              )}
                            </div>
                          )}
                      </>
                    )}
                    <p className="small muted">
                      A média usa o ponto médio da faixa de cada fonte
                      comparável. É uma referência de mercado; condições da obra
                      e negociação podem mudar o valor.
                    </p>
                  </>
                ) : (
                  <p role="status">
                    A pesquisa não encontrou preços publicados comparáveis com
                    fonte verificável. Detalhe o tipo de serviço, acabamento e
                    unidade para tentar novamente.
                  </p>
                )}
                {result.diaria && <DailyEstimate result={result.diaria} />}
                {result.empreitada && (
                  <ContractContextView context={result.empreitada} />
                )}
                {result.aviso_regional && (
                  <p className="web-region-note">{result.aviso_regional}</p>
                )}
                {result.observacoes && <p>{result.observacoes}</p>}
                {result.perguntas.map((question) => (
                  <p key={question}>{question}</p>
                ))}
                {result.referencias.length > 0 && (
                  <div className="web-sources">
                    <h3>Fontes e preços encontrados</h3>
                    {result.referencias.map((reference) => (
                      <article className="web-source" key={reference.url}>
                        <a
                          href={reference.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {reference.titulo} ↗
                        </a>
                        <p>
                          <strong>
                            {money(reference.valor_minimo)}
                            {reference.valor_maximo !== reference.valor_minimo
                              ? " a " + money(reference.valor_maximo)
                              : ""}{" "}
                            / {reference.unidade}
                          </strong>
                        </p>
                        <p className="small">
                          {scopeLabels[reference.escopo]} · {reference.regiao}
                        </p>
                        <blockquote className="small">
                          {reference.trecho_preco}
                        </blockquote>
                        <p className="small muted">
                          Data do preço:{" "}
                          {reference.data_preco ?? "não informada pela fonte"}.
                        </p>
                      </article>
                    ))}
                  </div>
                )}
                <p className="small muted">
                  Pesquisado em{" "}
                  {new Intl.DateTimeFormat("pt-BR", {
                    dateStyle: "short",
                    timeStyle: "short",
                    timeZone: "America/Maceio",
                  }).format(new Date(result.pesquisado_em))}
                  . Confirme os preços nos links antes de contratar.
                </p>
              </>
            )}
          </div>
        </>
      ) : (
        <p role="status">
          {admin
            ? "A pesquisa aguarda a configuração da IA pelo administrador."
            : "A pesquisa de preços ainda não está disponível."}
        </p>
      )}
    </section>
  );
}

"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  aiEstimateRequestSchema,
  aiEstimateResponseSchema,
  DEFAULT_AI_REGION,
  type AiEstimateResult,
} from "@/lib/ai-estimates";
import { money, dateBR } from "@/lib/finance";
import { useReading } from "./navigation";

export function AiServiceAssistant({
  obra,
  enabled,
  admin,
  canApply,
  onApply,
}: {
  obra: string;
  enabled: boolean;
  admin: boolean;
  canApply: (result: AiEstimateResult) => boolean;
  onApply: (result: AiEstimateResult) => void;
}) {
  const [description, setDescription] = useState("");
  const [region, setRegion] = useState(DEFAULT_AI_REGION);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AiEstimateResult | null>(null);
  const active = useRef<AbortController | null>(null);
  useReading(pending);
  useEffect(() => () => active.current?.abort(), []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setResult(null);
    setError("");
    const parsed = aiEstimateRequestSchema.safeParse({
      obra_id: obra,
      descricao: description,
      regiao: region,
    });
    if (!parsed.success) {
      setError(
        "Descreva o serviço em 5 a 1.600 caracteres e informe a cidade/UF.",
      );
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    const timer = setTimeout(() => controller.abort(), 30000);
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
            : "Não foi possível analisar o serviço. Tente novamente.",
        );
        return;
      }
      const interpreted = aiEstimateResponseSchema.safeParse(body);
      if (!interpreted.success) throw new Error("Invalid response");
      setResult(interpreted.data);
    } catch {
      setError(
        "Não foi possível concluir a análise. Verifique a conexão ou use a calculadora abaixo.",
      );
    } finally {
      clearTimeout(timer);
      active.current = null;
      setPending(false);
    }
  }
  return (
    <section className="panel" aria-labelledby="ai-title">
      <h2 id="ai-title">Estimar com IA</h2>
      <p className="muted">
        Descreva o serviço, a quantidade total e quanto foi realizado. A IA
        identifica uma referência da sua base; o app calcula a média dos preços
        cadastrados.
      </p>
      {enabled ? (
        <>
          <form method="post" onSubmit={submit}>
            <div className="field">
              <label htmlFor="ai-description">O que foi realizado?</label>
              <textarea
                id="ai-description"
                required
                minLength={5}
                maxLength={1600}
                rows={4}
                value={description}
                disabled={pending}
                placeholder="Ex.: Reboco de 40 m² no total, com 50% já concluído."
                onChange={(event) => {
                  setDescription(event.target.value);
                  setResult(null);
                  setError("");
                }}
              />
            </div>
            <div className="field">
              <label htmlFor="ai-region">Cidade / UF</label>
              <input
                id="ai-region"
                required
                minLength={2}
                maxLength={120}
                value={region}
                disabled={pending}
                onChange={(event) => {
                  setRegion(event.target.value);
                  setResult(null);
                  setError("");
                }}
              />
            </div>
            <p className="small muted">
              Ao analisar, a descrição e os nomes, unidades e regiões do
              catálogo serão enviados à OpenAI. Use apenas informações do
              serviço.
            </p>
            <button type="submit" disabled={pending}>
              {pending ? "Analisando serviço…" : "Analisar serviço"}
            </button>
          </form>
          {error && <p role="alert">{error}</p>}
          <div
            className={result ? "ai-result" : undefined}
            aria-live="polite"
            aria-busy={pending}
          >
            {result && (
              <>
                <h3>{result.servico ?? "Precisamos de uma referência"}</h3>
                {result.quantidade_total !== null && (
                  <p>
                    Quantidade total interpretada: {result.quantidade_total}{" "}
                    {result.unidade}. Execução:{" "}
                    {result.percentual_executado === null
                      ? "não informada"
                      : result.percentual_executado + "%"}
                    .
                  </p>
                )}
                {result.calculo && (
                  <>
                    <div className="cards estimate-cards">
                      <article className="card">
                        <span className="muted small">
                          Média por {result.unidade}
                        </span>
                        <div className="value">
                          {money(result.calculo.mean)}
                        </div>
                        <span className="small muted">
                          {result.calculo.samples} referência(s)
                        </span>
                      </article>
                      <article className="card">
                        <span className="muted small">
                          Estimativa do realizado
                        </span>
                        <div className="value">
                          {money(result.calculo.completed)}
                        </div>
                      </article>
                      <article className="card">
                        <span className="muted small">Estimativa total</span>
                        <div className="value">
                          {money(result.calculo.total)}
                        </div>
                      </article>
                    </div>
                    <p className="small muted">
                      Faixa da parte realizada: {money(result.calculo.minimum)}{" "}
                      a {money(result.calculo.maximum)}. Revise a medição
                      interpretada. Não altera contratos nem pagamentos.
                    </p>
                    {canApply(result) ? (
                      <button
                        className="secondary"
                        type="button"
                        onClick={() => onApply(result)}
                      >
                        Revisar no calculador
                      </button>
                    ) : (
                      <p role="status">
                        A base foi atualizada. Recarregue a página para revisar
                        no calculador.
                      </p>
                    )}
                  </>
                )}
                {result.perguntas.map((question) => (
                  <p key={question}>{question}</p>
                ))}
                {result.aviso_regional && (
                  <p className="small">{result.aviso_regional}</p>
                )}
                {result.referencias.length > 0 && (
                  <details>
                    <summary>Referências usadas</summary>
                    {result.referencias.map((reference) => (
                      <p key={reference.id} className="small">
                        {money(reference.valor_unitario)} / {result.unidade} ·{" "}
                        {reference.fonte} · {reference.regiao} ·{" "}
                        {dateBR(reference.data_referencia)}
                      </p>
                    ))}
                  </details>
                )}
                <p className="small muted">
                  Contexto: {result.regiao_contexto}. Sem consulta automática a
                  preços de mercado.
                </p>
              </>
            )}
          </div>
        </>
      ) : (
        <p role="status">
          {admin
            ? "O assistente aguarda a configuração da IA pelo administrador. A calculadora de referências abaixo já está disponível."
            : "O assistente de IA ainda não está disponível. Use a calculadora de referências abaixo."}
        </p>
      )}
    </section>
  );
}

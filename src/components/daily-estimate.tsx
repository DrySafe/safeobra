"use client";
import type { DailyResult } from "@/lib/daily-estimates";
import { money } from "@/lib/finance";
const number = (value: number) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);
const range = (min: number, max: number) =>
  min === max ? number(min) : number(min) + " a " + number(max);
export function DailyEstimate({ result }: { result: DailyResult }) {
  const cost = result.calculo;
  return (
    <section className="daily-estimate" aria-labelledby="daily-title">
      <h3 id="daily-title">Estimativa por diária da equipe</h3>
      <p>
        {result.pedreiros === null
          ? "Quantidade de pedreiros a confirmar"
          : result.pedreiros + " pedreiro(s)"}{" "}
        · jornada de {number(result.jornada_horas)} h por dia.
      </p>
      {cost && (
        <div className="cards estimate-cards">
          <article className="card">
            <span className="muted small">Equipe por dia de trabalho</span>
            <div className="value">{money(cost.equipe_por_dia_media)}</div>
            <span className="small muted">
              {money(cost.equipe_por_dia_minimo)} a{" "}
              {money(cost.equipe_por_dia_maximo)} · somente mão de obra
            </span>
          </article>
        </div>
      )}
      <h3>Tempo previsto por etapa</h3>
      {result.etapas.length ? (
        result.etapas.map((stage, index) => (
          <article className="web-source" key={index}>
            <strong>
              {index + 1}. {stage.nome}
            </strong>
            <p>
              {stage.horas_minimas !== null &&
              stage.base_tempo !== "faltam_dados" &&
              stage.horas_maximas !== null &&
              !stage.pendencias.length
                ? range(stage.horas_minimas, stage.horas_maximas) +
                  " h da equipe"
                : "Tempo a confirmar"}
            </p>
            <p className="small muted">
              {stage.base_tempo === "referencia_publicada"
                ? "Tempo baseado em produtividade publicada"
                : stage.base_tempo === "estimativa_tecnica"
                  ? "Estimativa técnica aproximada da IA"
                  : "Faltam dados para estimar o tempo"}
            </p>
            {stage.justificativa && (
              <p className="small">{stage.justificativa}</p>
            )}
            {stage.fonte_tempo && (
              <p className="small">
                <a
                  href={stage.fonte_tempo}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Fonte da produtividade ↗
                </a>
              </p>
            )}
            {stage.premissas.length > 0 && (
              <ul className="small">
                {stage.premissas.map((text, i) => (
                  <li key={i}>{text}</li>
                ))}
              </ul>
            )}
            {stage.pendencias.map((text, i) => (
              <p className="small" key={i}>
                A confirmar: {text}
              </p>
            ))}
          </article>
        ))
      ) : (
        <p>Detalhe as etapas para estimar a duração.</p>
      )}
      {cost?.horas_minimas !== null &&
      cost?.horas_minimas !== undefined &&
      cost.horas_maximas !== null ? (
        <>
          <div className="cards estimate-cards">
            <article className="card">
              <span className="muted small">Tempo total da equipe</span>
              <div className="value">
                {range(cost.horas_minimas, cost.horas_maximas)} h
              </div>
              <span className="small muted">
                {range(
                  cost.dias_trabalho_minimos!,
                  cost.dias_trabalho_maximos!,
                )}{" "}
                dia(s) de {number(result.jornada_horas)} h
              </span>
            </article>
            <article className="card">
              <span className="muted small">Custo com diárias inteiras</span>
              <div className="value">{money(cost.total_integral_medio!)}</div>
              <span className="small muted">
                Faixa: {money(cost.total_integral_minimo!)} a{" "}
                {money(cost.total_integral_maximo!)}
              </span>
            </article>
            <article className="card">
              <span className="muted small">
                Se houver cobrança proporcional
              </span>
              <div className="value">
                {money(cost.total_proporcional_medio!)}
              </div>
              <span className="small muted">
                Faixa: {money(cost.total_proporcional_minimo!)} a{" "}
                {money(cost.total_proporcional_maximo!)}
              </span>
            </article>
          </div>
          <p className="small">
            Por dias inteiros:{" "}
            {range(cost.dias_cobrados_minimos!, cost.dias_cobrados_maximos!)}{" "}
            dia(s) para a equipe, equivalentes a{" "}
            {range(
              cost.diarias_individuais_minimas!,
              cost.diarias_individuais_maximas!,
            )}{" "}
            diária(s) individuais. O total usa a soma dos tempos das etapas; não
            cobra uma diária separada para cada tarefa.
          </p>
          <p className="small muted">
            Fórmula: pedreiros × dias cobrados × diária por pessoa. O valor
            central usa o tempo médio do intervalo; a cobrança proporcional
            depende do acordo com os profissionais.
          </p>
        </>
      ) : (
        <p role="status">
          O custo total por duração será calculado quando houver equipe, diária
          pesquisada e tempo estimável para todas as etapas. A diária da equipe,
          quando disponível, serve como referência enquanto faltam medidas.
        </p>
      )}
      {result.premissas.length > 0 && (
        <>
          <h3>Premissas do planejamento</h3>
          <ul className="small">
            {result.premissas.map((text, i) => (
              <li key={i}>{text}</li>
            ))}
          </ul>
        </>
      )}
      <p className="small muted">
        Os tempos consideram esta equipe e etapas sequenciais. Não são divididos
        novamente pelo número de pedreiros. Faixas técnicas são preliminares;
        porcelanato, contrapiso, solo, acesso e ferramentas podem alterar a
        duração. Confirme a jornada e a forma de cobrança antes de contratar.
      </p>
    </section>
  );
}

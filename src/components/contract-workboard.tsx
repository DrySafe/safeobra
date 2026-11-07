"use client";
import { z } from "zod";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  contractItemInput,
  draftFromItem,
  allocateContractBudget,
  contractItemMetrics,
  safeTextFile,
  textImportResponse,
  type ContractItem,
  type ContractItemDraft,
  type PaymentAllocation,
  type ItemExecution,
} from "@/lib/contract-items";
import { serviceUnits } from "@/lib/estimates";
import { money, dateBR } from "@/lib/finance";
import type { Contract, Payment } from "@/lib/models";
import {
  adoptContractItems,
  saveContractItems,
  saveSingleContractItem,
  archiveContractItem,
  allocateContractPayment,
} from "@/server/contract-actions";
import { DataForm, type Field } from "./forms";
import { useReading, useRefresh } from "./navigation";
const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Maceio" }).format(
    new Date(),
  );
const newDraft = (): ContractItemDraft => ({
  id: null,
  nome: "",
  descricao: "",
  unidade: "serviço",
  quantidade: 1,
  classe: "incluido",
  aprovado: false,
  valor_cobrado: null,
  percentual_executado: 0,
  valor_pago_informado: null,
  data_pagamento: null,
});
const numberMoney = (value: string) =>
  value === "" ? null : Math.round(Number(value) * 100);
const quote = (item: ContractItem) => item.estimativa_json;
export function ContractWorkboard({
  obra,
  contract,
  items,
  payments,
  allocations,
  executions,
  admin,
  aiEnabled,
}: {
  obra: string;
  contract: Contract;
  items: ContractItem[];
  payments: Payment[];
  allocations: PaymentAllocation[];
  executions: ItemExecution[];
  admin: boolean;
  aiEnabled: boolean;
}) {
  const active = items.filter((i) => !i.arquivado),
    metrics = contractItemMetrics(
      Number(contract.valor_geral),
      active,
      payments,
      allocations,
    ),
    refresh = useRefresh();
  const [pending, start] = useTransition(),
    [busy, setBusy] = useState(false),
    [researching, setResearching] = useState(false),
    [message, setMessage] = useState(""),
    [filter, setFilter] = useState("todos"),
    [text, setText] = useState(""),
    [drafts, setDrafts] = useState<ContractItemDraft[]>([]),
    [warnings, setWarnings] = useState<string[]>([]),
    [batch, setBatch] = useState(""),
    [importPayments, setImportPayments] = useState(false),
    [paymentDate, setPaymentDate] = useState(today()),
    [wait, setWait] = useState(0),
    [researchStatus, setResearchStatus] = useState<Record<string, string>>({}),
    [selectedPayment, setSelectedPayment] = useState(""),
    [selectedItem, setSelectedItem] = useState(""),
    [allocationGross, setAllocationGross] = useState(""),
    [allocationDiscount, setAllocationDiscount] = useState("0");
  const stop = useRef(false),
    controller = useRef<AbortController | null>(null),
    editor = useRef<HTMLDivElement>(null);
  useReading(pending || busy);
  useEffect(
    () => () => {
      stop.current = true;
      controller.current?.abort();
    },
    [],
  );
  function act(action: () => Promise<{ ok: boolean; message: string }>) {
    setMessage("");
    start(async () => {
      try {
        const result = await action();
        setMessage(result.message);
      } catch {
        setMessage("Não foi possível conectar. Tente novamente.");
      }
    });
  }
  function edit(list: ContractItemDraft[]) {
    setDrafts(list);
    setBatch(crypto.randomUUID());
    setImportPayments(false);
    setWarnings([]);
    setTimeout(
      () =>
        editor.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      0,
    );
  }
  async function parseText() {
    setMessage("");
    setBusy(true);
    try {
      const response = await fetch("/api/ai/contract-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          obra_id: obra,
          contrato_id: contract.id,
          texto: text,
        }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "Não foi possível organizar o texto.");
      const parsed = textImportResponse.parse(body);
      const existing = new Set(
        active.map(
          (i) => i.classe + "|" + i.nome.trim().toLocaleLowerCase("pt-BR"),
        ),
      );
      const fresh = parsed.itens.filter(
        (i) =>
          !existing.has(
            i.classe + "|" + i.nome.trim().toLocaleLowerCase("pt-BR"),
          ),
      );
      edit(fresh);
      setWarnings([
        ...parsed.avisos,
        ...(fresh.length < parsed.itens.length
          ? [
              "Itens com mesmo nome e classificação já existentes foram excluídos desta importação. Edite o nome caso se trate de outro serviço.",
            ]
          : []),
      ]);
      setMessage(
        "Revise itens, preços, execução e pagamentos antes de salvar. A IA não pesquisou mercado nesta organização.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível ler o texto.",
      );
    } finally {
      setBusy(false);
    }
  }
  function saveDrafts() {
    setMessage("");
    start(async () => {
      try {
        const prepared = drafts.map((i) =>
          contractItemInput.parse({
            ...i,
            data_pagamento:
              i.data_pagamento ?? (importPayments ? paymentDate : null),
          }),
        );
        const result = await saveContractItems(obra, contract.id, {
          itens: prepared,
          lote: batch || crypto.randomUUID(),
          importar_pagamentos: importPayments,
        });
        setMessage(result.message);
        if (result.ok) {
          setDrafts([]);
          setWarnings([]);
          setText("");
        }
      } catch (error) {
        setMessage(
          error instanceof z.ZodError
            ? "Confira nomes, quantidades, percentuais e valores dos itens."
            : error instanceof Error
              ? error.message
              : "Confira os valores.",
        );
      }
    });
  }
  async function research(list: ContractItem[]) {
    stop.current = false;
    setResearching(true);
    setBusy(true);
    setMessage("");
    let done = 0;
    try {
      for (const item of list) {
        if (stop.current) break;
        let finished = false;
        while (!finished && !stop.current) {
          controller.current = new AbortController();
          setResearchStatus((s) => ({ ...s, [item.id]: "Pesquisando…" }));
          const response = await fetch("/api/ai/estimate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.current.signal,
            body: JSON.stringify({
              obra_id: obra,
              contrato_id: contract.id,
              item_id: item.id,
              salvar_estimativa: true,
              descricao: (
                item.nome +
                ". " +
                item.descricao.slice(0, 1150) +
                ". Quantidade total prevista: " +
                item.quantidade +
                " " +
                item.unidade +
                ". Percentual executado: " +
                item.percentual_executado +
                "%."
              ).slice(0, 1600),
              regiao: "Aracaju/SE",
              escopo: "mao_de_obra",
              metodo: "automatico",
            }),
          });
          const result = await response.json();
          if (response.status === 429 && result.code === "RATE_LIMIT") {
            for (
              let seconds = Number(response.headers.get("Retry-After")) || 60;
              seconds > 0 && !stop.current;
              seconds--
            ) {
              setWait(seconds);
              await new Promise((r) => setTimeout(r, 1000));
            }
            setWait(0);
            continue;
          }
          if (!response.ok)
            throw new Error(
              result.error || "Não foi possível pesquisar este item.",
            );
          finished = true;
          done++;
          setResearchStatus((s) => ({
            ...s,
            [item.id]:
              result.status === "estimativa"
                ? "Pesquisa salva"
                : "Pesquisa salva; confira medidas/fontes",
          }));
          refresh();
        }
      }
      setMessage(
        stop.current
          ? `Pesquisa interrompida. ${done} resultado(s) já foram salvos.`
          : `${done} pesquisa(s) salva(s) na tabela. O preço combinado não foi alterado.`,
      );
    } catch (error) {
      setMessage(
        stop.current
          ? "Pesquisa interrompida; resultados concluídos preservados."
          : error instanceof Error
            ? error.message
            : "Não foi possível concluir a pesquisa.",
      );
    } finally {
      setBusy(false);
      setResearching(false);
      setWait(0);
      controller.current = null;
    }
  }
  const shown = active.filter(
    (i) =>
      filter === "todos" ||
      (filter === "pendentes" && i.percentual_executado < 100) ||
      (filter === "concluidos" && i.percentual_executado === 100) ||
      (filter === "extras" && i.classe === "extra"),
  );
  const livePayments = payments.filter((p) => !p.anulado),
    pay = livePayments.find((p) => p.id === selectedPayment),
    payAllocations = allocations.filter(
      (a) => a.pagamento_id === selectedPayment,
    ),
    availableGross = pay
      ? Number(pay.valor_bruto) -
        payAllocations.reduce((s, a) => s + Number(a.valor_bruto), 0)
      : 0;
  return (
    <div className="contract-workboard">
      <h3>Serviços, estimativas e saldo da empreitada</h3>
      <p className="small muted">
        A pesquisa compara mercado e preço combinado. Pagamentos e descontos vêm
        dos registros reais; concluir serviço não cria pagamento.
      </p>
      {!contract.itens_ativo ? (
        <p className="notice">
          A tabela preservará o plano anterior como histórico e aproveitará os
          serviços e pagamentos já vinculados.{" "}
          {admin && (
            <button
              type="button"
              className="secondary"
              disabled={pending || busy}
              onClick={() => act(() => adoptContractItems(obra, contract.id))}
            >
              Organizar plano atual nesta tabela
            </button>
          )}
        </p>
      ) : (
        <>
          <div className="cards estimate-cards">
            <article className="card">
              <span className="small muted">
                Preço original + extras aprovados
              </span>
              <div className="value">{money(metrics.total)}</div>
              <span className="small muted">
                Original {money(metrics.base)} · extras {money(metrics.extras)}
              </span>
            </article>
            <article className="card">
              <span className="small muted">Avanço ponderado pelo valor</span>
              <div className="value">
                {metrics.progressKnown
                  ? metrics.progress.toFixed(1) + "%"
                  : "A completar plano"}
              </div>
              <span className="small muted">
                {metrics.progressKnown
                  ? "Faltam " + metrics.remainingProgress.toFixed(1) + "% · "
                  : "Distribua o preço entre os itens · "}{" "}
                {metrics.pendingCount} serviço(s) pendente(s)
              </span>
            </article>
            <article className="card">
              <span className="small muted">Saldo real da empreitada</span>
              <div className="value">{money(metrics.remaining)}</div>
              <span className="small muted">
                Devido pelo executado: {money(metrics.due)} · adiantamento{" "}
                {money(metrics.advance)}
              </span>
            </article>
          </div>
          <p className="small">
            Incluídos distribuídos: {money(metrics.included)} de{" "}
            {money(metrics.base)}.{" "}
            {metrics.reserve > 0 && (
              <strong>
                Falta alocar {money(metrics.reserve)} do preço original.
              </strong>
            )}{" "}
            Referência de mercado: {money(metrics.market)}{" "}
            {metrics.marketComplete
              ? "(escopo completo pesquisado)"
              : `(parcial: ${metrics.estimatedCount}/${metrics.itemCount} itens com estimativa)`}
            .
          </p>
          {metrics.unassignedGross > 0 && (
            <p className="notice">
              Pagamentos a distribuir: {money(metrics.unassignedPaid)} líquidos
              + {money(metrics.unassignedDiscount)} em descontos. Eles já
              reduzem o saldo geral, mas só aparecerão como pagos por item após
              o vínculo. Distribua antes de decidir novo pagamento por serviço.
            </p>
          )}
        </>
      )}
      {admin && (
        <>
          <div className="inline contract-tools">
            <button
              type="button"
              className="secondary"
              disabled={pending || busy}
              onClick={() => edit([newDraft()])}
            >
              + Adicionar item
            </button>
            {contract.itens_ativo && (
              <>
                <button
                  type="button"
                  className="secondary"
                  disabled={
                    pending ||
                    busy ||
                    !aiEnabled ||
                    !active.some((i) => i.valor_estimado === null)
                  }
                  onClick={() =>
                    research(active.filter((i) => i.valor_estimado === null))
                  }
                >
                  Pesquisar valores pendentes com IA
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={
                    pending ||
                    busy ||
                    !active.some((i) => i.classe === "incluido") ||
                    active.some(
                      (i) =>
                        i.classe === "incluido" &&
                        (i.valor_estimado === null ||
                          Number(i.valor_estimado) <= 0),
                    )
                  }
                  title="Pesquise os valores de todos os itens incluídos para sugerir a distribuição."
                  onClick={() => {
                    try {
                      edit(
                        allocateContractBudget(
                          Number(contract.valor_geral),
                          active,
                        ),
                      );
                      setWarnings([
                        "Revise a distribuição do preço original pelas estimativas. Isso altera a ponderação dos serviços, não o total contratado nem os pagamentos.",
                      ]);
                    } catch (error) {
                      setMessage(
                        error instanceof Error
                          ? error.message
                          : "Confira as referências.",
                      );
                    }
                  }}
                >
                  Sugerir distribuição do preço original
                </button>
              </>
            )}
            {researching && (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  stop.current = true;
                  controller.current?.abort();
                }}
              >
                Parar pesquisa
              </button>
            )}
          </div>
          {wait > 0 && (
            <p role="status">
              Limite temporário. A pesquisa continuará em {wait} s. Resultados
              concluídos já estão salvos.
            </p>
          )}
          <details className="contract-import">
            <summary>
              Importar serviços de texto com IA (.txt, .md ou .csv)
            </summary>
            <p className="small muted">
              Texto UTF-8 até 64 KB/16 mil caracteres e 60 serviços por arquivo.
              A descrição e o preço total da empreitada serão enviados à OpenAI
              para organização. Revise a prévia antes de gravar. As pesquisas de
              mercado são feitas depois, nos itens.
            </p>
            <input
              aria-label="Arquivo de serviços"
              type="file"
              accept=".txt,.md,.csv,text/plain,text/markdown,text/csv"
              disabled={busy || pending}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  setText(
                    safeTextFile(new Uint8Array(await file.arrayBuffer())),
                  );
                  setMessage(
                    "Arquivo carregado. Clique em organizar para revisar a prévia.",
                  );
                } catch (error) {
                  setMessage(
                    error instanceof Error
                      ? error.message
                      : "Arquivo inválido.",
                  );
                }
                e.target.value = "";
              }}
            />
            <label>
              Texto dos serviços
              <textarea
                value={text}
                maxLength={16000}
                rows={6}
                disabled={busy || pending}
                onChange={(e) => setText(e.target.value)}
                placeholder="Ex.: Sapatas — incluído — a realizar. Rasgos — feito — cobrado R$ 300 — pago R$ 100. Muro lateral — extra R$ 800."
              />
            </label>
            <button
              type="button"
              disabled={busy || pending || !aiEnabled || text.trim().length < 5}
              onClick={parseText}
            >
              Organizar texto com IA
            </button>
          </details>
          <div ref={editor}>
            {drafts.length > 0 && (
              <section className="panel contract-drafts">
                <h3>Revisar serviços antes de salvar</h3>
                {warnings.map((w, i) => (
                  <p key={i} className="notice">
                    {w}
                  </p>
                ))}
                {drafts.map((item, index) => (
                  <fieldset key={item.id ?? index}>
                    <legend>Item {index + 1}</legend>
                    <div className="form-grid">
                      <label>
                        Serviço
                        <input
                          value={item.nome}
                          maxLength={300}
                          onChange={(e) =>
                            setDrafts((ds) =>
                              ds.map((d, i) =>
                                i === index
                                  ? { ...d, nome: e.target.value }
                                  : d,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        Incluído ou extra
                        <select
                          value={item.classe}
                          onChange={(e) =>
                            setDrafts((ds) =>
                              ds.map((d, i) =>
                                i === index
                                  ? {
                                      ...d,
                                      classe: e.target.value as
                                        "incluido" | "extra",
                                      aprovado: false,
                                    }
                                  : d,
                              ),
                            )
                          }
                        >
                          <option value="incluido">
                            Já incluído no preço original
                          </option>
                          <option value="extra">Extra / aditivo</option>
                        </select>
                      </label>
                      <label>
                        {item.classe === "extra"
                          ? "Valor combinado do extra (R$)"
                          : "Parcela do preço original (R$)"}
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={
                            item.valor_cobrado === null
                              ? ""
                              : item.valor_cobrado / 100
                          }
                          onChange={(e) =>
                            setDrafts((ds) =>
                              ds.map((d, i) =>
                                i === index
                                  ? {
                                      ...d,
                                      valor_cobrado: numberMoney(
                                        e.target.value,
                                      ),
                                    }
                                  : d,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        Execução acumulada (%)
                        <input
                          type="number"
                          min={
                            item.id
                              ? (active.find((i) => i.id === item.id)
                                  ?.percentual_executado ?? 0)
                              : 0
                          }
                          max="100"
                          step="1"
                          value={item.percentual_executado}
                          onChange={(e) =>
                            setDrafts((ds) =>
                              ds.map((d, i) =>
                                i === index
                                  ? {
                                      ...d,
                                      percentual_executado: Number(
                                        e.target.value,
                                      ),
                                    }
                                  : d,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        Quantidade
                        <input
                          type="number"
                          min="0.0001"
                          max="1000000"
                          step="any"
                          value={item.quantidade}
                          onChange={(e) =>
                            setDrafts((ds) =>
                              ds.map((d, i) =>
                                i === index
                                  ? { ...d, quantidade: Number(e.target.value) }
                                  : d,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        Unidade
                        <select
                          value={item.unidade}
                          onChange={(e) =>
                            setDrafts((ds) =>
                              ds.map((d, i) =>
                                i === index
                                  ? {
                                      ...d,
                                      unidade: e.target
                                        .value as typeof d.unidade,
                                    }
                                  : d,
                              ),
                            )
                          }
                        >
                          {serviceUnits.map((u) => (
                            <option key={u}>{u}</option>
                          ))}
                        </select>
                      </label>
                      {!item.id && (
                        <label>
                          Pagamento líquido histórico informado (R$, opcional)
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={
                              item.valor_pago_informado === null
                                ? ""
                                : item.valor_pago_informado / 100
                            }
                            onChange={(e) =>
                              setDrafts((ds) =>
                                ds.map((d, i) =>
                                  i === index
                                    ? {
                                        ...d,
                                        valor_pago_informado: numberMoney(
                                          e.target.value,
                                        ),
                                      }
                                    : d,
                                ),
                              )
                            }
                          />
                        </label>
                      )}
                    </div>
                    <label>
                      Medidas e condições
                      <textarea
                        value={item.descricao}
                        maxLength={4000}
                        rows={3}
                        onChange={(e) =>
                          setDrafts((ds) =>
                            ds.map((d, i) =>
                              i === index
                                ? { ...d, descricao: e.target.value }
                                : d,
                            ),
                          )
                        }
                      />
                    </label>
                    {item.classe === "extra" && (
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={item.aprovado}
                          onChange={(e) =>
                            setDrafts((ds) =>
                              ds.map((d, i) =>
                                i === index
                                  ? { ...d, aprovado: e.target.checked }
                                  : d,
                              ),
                            )
                          }
                        />
                        Extra aprovado: incluir seu valor no contrato e no
                        percentual de execução
                      </label>
                    )}
                    <button
                      type="button"
                      className="secondary"
                      onClick={() =>
                        setDrafts((ds) => ds.filter((_, i) => i !== index))
                      }
                    >
                      Retirar da prévia
                    </button>
                  </fieldset>
                ))}
                {drafts.some((i) => (i.valor_pago_informado ?? 0) > 0) && (
                  <div className="notice">
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={importPayments}
                        onChange={(e) => setImportPayments(e.target.checked)}
                      />
                      Registrar os pagamentos históricos informados, total{" "}
                      {money(
                        drafts.reduce(
                          (s, i) => s + (i.valor_pago_informado ?? 0),
                          0,
                        ),
                      )}
                    </label>
                    <p className="small">
                      Marque apenas se esses pagamentos ainda não estiverem no
                      histórico. Serão registrados como líquidos, sem aplicar
                      descontos pendentes. Sem marcar, nenhum pagamento é
                      criado.
                    </p>
                    {importPayments && (
                      <label>
                        Data para pagamentos sem data no arquivo
                        <input
                          type="date"
                          value={paymentDate}
                          onChange={(e) => setPaymentDate(e.target.value)}
                        />
                      </label>
                    )}
                  </div>
                )}
                <p className="small muted">
                  Incluídos devem caber no preço original. Extras aumentam o
                  total apenas quando aprovados. Alterar parcelas muda o avanço
                  ponderado; os pagamentos existentes são preservados.
                </p>
                <div className="inline">
                  <button
                    type="button"
                    disabled={pending || busy || !drafts.length}
                    onClick={saveDrafts}
                  >
                    Salvar itens revisados
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setDrafts([])}
                  >
                    Cancelar prévia
                  </button>
                </div>
              </section>
            )}
          </div>
        </>
      )}
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      {contract.itens_ativo && (
        <>
          <label className="contract-filter">
            Exibir serviços
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="todos">Todos</option>
              <option value="pendentes">A realizar / em andamento</option>
              <option value="concluidos">Já realizados</option>
              <option value="extras">Extras</option>
            </select>
          </label>
          {shown.length ? (
            <div className="services-table-wrap">
              <table className="services-table">
                <caption>
                  Valores em reais; estimativa de mercado não altera o preço
                  combinado.
                </caption>
                <thead>
                  <tr>
                    {[
                      "Serviço",
                      "Classificação",
                      "Execução",
                      "Estimado (mercado)",
                      "Cobrado / alocado",
                      "Pago líquido",
                      "Falta pagar",
                      "Ações e fontes",
                    ].map((h) => (
                      <th scope="col" key={h}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((item) => {
                    const row = metrics.rows.find(
                      (r) => r.item.id === item.id,
                    )!;
                    const source = quote(item);
                    return (
                      <tr key={item.id}>
                        <td data-label="Serviço">
                          <strong>{item.nome}</strong>
                          <p className="small muted">
                            {item.quantidade} {item.unidade}
                          </p>
                          <p className="small">{item.descricao}</p>
                        </td>
                        <td data-label="Classificação">
                          {item.classe === "incluido"
                            ? "Incluído no preço"
                            : item.aprovado
                              ? "Extra aprovado"
                              : "Extra a aprovar"}
                        </td>
                        <td data-label="Execução">
                          {item.percentual_executado}%
                          <p className="small muted">
                            {item.percentual_executado === 100
                              ? "Concluído"
                              : item.percentual_executado > 0
                                ? "Em andamento"
                                : "A realizar"}
                          </p>
                          {admin && item.percentual_executado < 100 && (
                            <button
                              type="button"
                              className="secondary"
                              disabled={pending || busy}
                              onClick={() =>
                                act(() =>
                                  saveSingleContractItem(
                                    obra,
                                    contract.id,
                                    draftFromItem(item, {
                                      percentual_executado: 100,
                                    }),
                                  ),
                                )
                              }
                            >
                              Concluir
                            </button>
                          )}
                        </td>
                        <td data-label="Estimado (mercado)">
                          {item.valor_estimado === null
                            ? "A pesquisar / faltam dados"
                            : money(Number(item.valor_estimado))}
                          {item.estimado_minimo !== null &&
                            item.estimado_maximo !== null && (
                              <p className="small muted">
                                {money(Number(item.estimado_minimo))} a{" "}
                                {money(Number(item.estimado_maximo))}
                              </p>
                            )}
                          {item.pesquisado_em && (
                            <p className="small muted">
                              {dateBR(item.pesquisado_em)}
                            </p>
                          )}
                        </td>
                        <td data-label="Cobrado / alocado">
                          {item.valor_cobrado === null
                            ? "A definir"
                            : money(Number(item.valor_cobrado))}
                          {item.valor_estimado !== null &&
                            item.valor_cobrado !== null && (
                              <p className="small muted">
                                Diferença para referência:{" "}
                                {money(
                                  Number(item.valor_cobrado) -
                                    Number(item.valor_estimado),
                                )}
                              </p>
                            )}
                        </td>
                        <td data-label="Pago líquido">
                          {money(row.paid)}
                          {row.discount > 0 && (
                            <p className="small muted">
                              Descontos: {money(row.discount)}
                            </p>
                          )}
                        </td>
                        <td data-label="Falta pagar">
                          {item.valor_cobrado === null
                            ? "A definir"
                            : item.classe === "extra" && !item.aprovado
                              ? "A aprovar"
                              : money(row.remaining)}
                          <p className="small muted">
                            Devido pelo executado:{" "}
                            {item.valor_cobrado === null
                              ? "parcela a definir"
                              : item.classe === "extra" && !item.aprovado
                                ? "depende de aprovação"
                                : money(row.due)}
                          </p>
                          {row.advance > 0 && (
                            <p className="small muted">
                              Antecipado ao item: {money(row.advance)}
                            </p>
                          )}
                        </td>
                        <td data-label="Ações e fontes">
                          {admin && (
                            <>
                              <button
                                type="button"
                                className="secondary"
                                disabled={pending || busy}
                                onClick={() => edit([draftFromItem(item)])}
                              >
                                Editar item
                              </button>
                              <button
                                type="button"
                                className="secondary"
                                disabled={pending || busy || !aiEnabled}
                                onClick={() => research([item])}
                              >
                                Pesquisar valor com IA
                              </button>
                              {item.percentual_executado === 0 &&
                                !allocations.some(
                                  (a) => a.item_id === item.id,
                                ) && (
                                  <button
                                    type="button"
                                    className="secondary"
                                    disabled={pending || busy}
                                    onClick={() =>
                                      act(() =>
                                        archiveContractItem(
                                          obra,
                                          contract.id,
                                          item.id,
                                        ),
                                      )
                                    }
                                  >
                                    Arquivar
                                  </button>
                                )}
                              {(item.classe === "incluido" ||
                                item.aprovado) && (
                                <details>
                                  <summary>Pagar / adiantar este item</summary>
                                  <DataForm
                                    kind="payment"
                                    obra={obra}
                                    fields={paymentFields(contract, item)}
                                  />
                                </details>
                              )}
                            </>
                          )}
                          {researchStatus[item.id] && (
                            <p className="small" role="status">
                              {researchStatus[item.id]}
                            </p>
                          )}
                          {source && (
                            <details>
                              <summary>Ver pesquisa e fontes</summary>
                              <p className="small">{source.observacoes}</p>
                              {source.aviso_regional && (
                                <p className="small">{source.aviso_regional}</p>
                              )}
                              {source.perguntas.map((q, i) => (
                                <p className="small" key={i}>
                                  {q}
                                </p>
                              ))}
                              {source.referencias.map((ref) => (
                                <p className="small" key={ref.url}>
                                  <a
                                    href={ref.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    {ref.titulo} ↗
                                  </a>
                                  <br />
                                  {ref.trecho_preco}
                                </p>
                              ))}
                            </details>
                          )}
                          <details>
                            <summary>Histórico do avanço</summary>
                            {executions
                              .filter((e) => e.item_id === item.id)
                              .map((e) => (
                                <p className="small" key={e.id}>
                                  {dateBR(e.data)} · {e.percentual}% ·{" "}
                                  {e.observacoes}
                                </p>
                              ))}
                          </details>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p>
              Nenhum serviço neste filtro. Adicione itens ou importe a lista da
              empreitada.
            </p>
          )}
          {admin && livePayments.length > 0 && (
            <details className="contract-allocation">
              <summary>Distribuir pagamentos existentes entre serviços</summary>
              <p className="small">
                Este controle vincula dinheiro/descontos já registrados. Não
                cria pagamentos nem altera o total pago.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  act(() =>
                    allocateContractPayment(obra, contract.id, {
                      pagamento_id: selectedPayment,
                      item_id: selectedItem,
                      valor_bruto: Math.round(Number(allocationGross) * 100),
                      desconto: Math.round(Number(allocationDiscount) * 100),
                    }),
                  );
                }}
              >
                <div className="form-grid">
                  <label>
                    Pagamento
                    <select
                      required
                      value={selectedPayment}
                      onChange={(e) => setSelectedPayment(e.target.value)}
                    >
                      <option value="">Selecione</option>
                      {livePayments.map((p) => (
                        <option value={p.id} key={p.id}>
                          {p.referencia} · líquido {money(Number(p.valor))}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Serviço
                    <select
                      required
                      value={selectedItem}
                      onChange={(e) => setSelectedItem(e.target.value)}
                    >
                      <option value="">Selecione</option>
                      {active
                        .filter((i) => i.classe === "incluido" || i.aprovado)
                        .map((i) => (
                          <option value={i.id} key={i.id}>
                            {i.nome}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Bruto a vincular (R$)
                    <input
                      required
                      type="number"
                      min="0"
                      step="0.01"
                      value={allocationGross}
                      onChange={(e) => setAllocationGross(e.target.value)}
                    />
                  </label>
                  <label>
                    Desconto já aplicado a vincular (R$)
                    <input
                      required
                      type="number"
                      min="0"
                      step="0.01"
                      value={allocationDiscount}
                      onChange={(e) => setAllocationDiscount(e.target.value)}
                    />
                  </label>
                </div>
                {pay && (
                  <p className="small">
                    Bruto ainda a distribuir neste pagamento:{" "}
                    {money(availableGross)}. Vincule o bruto incluindo eventual
                    desconto; o pago líquido será bruto menos desconto.
                  </p>
                )}
                <button disabled={pending || busy} type="submit">
                  Salvar vínculo do pagamento
                </button>
              </form>
              {allocations
                .filter((a) =>
                  livePayments.some((p) => p.id === a.pagamento_id),
                )
                .map((a) => (
                  <p className="small" key={a.id}>
                    {
                      livePayments.find((p) => p.id === a.pagamento_id)
                        ?.referencia
                    }{" "}
                    →{" "}
                    {active.find((i) => i.id === a.item_id)?.nome ??
                      "Item do histórico"}
                    : {money(Number(a.valor_bruto) - Number(a.desconto))}{" "}
                    líquidos + {money(Number(a.desconto))} desconto{" "}
                    <button
                      type="button"
                      className="secondary"
                      disabled={pending || busy}
                      onClick={() =>
                        act(() =>
                          allocateContractPayment(obra, contract.id, {
                            pagamento_id: a.pagamento_id,
                            item_id: a.item_id,
                            valor_bruto: 0,
                            desconto: 0,
                          }),
                        )
                      }
                    >
                      Desvincular
                    </button>
                  </p>
                ))}
            </details>
          )}
        </>
      )}
    </div>
  );
}
function paymentFields(contract: Contract, item: ContractItem): Field[] {
  return [
    {
      name: "contrato_id",
      label: "Empreitada",
      options: [{ value: contract.id, label: contract.profissional }],
    },
    {
      name: "modo",
      label: "Pagamento",
      options: [
        { value: "servico", label: "Por serviço (permite adiantamento)" },
      ],
    },
    {
      name: "servico_id",
      label: "Serviço",
      options: [{ value: item.id, label: item.nome }],
    },
    { name: "data", label: "Data", type: "date", value: today() },
    {
      name: "valor_bruto",
      label: "Valor bruto a quitar (R$)",
      type: "number",
      scale: 100,
    },
    { name: "referencia", label: "Referência", value: item.nome.slice(0, 280) },
    {
      name: "forma_pagamento",
      label: "Forma de pagamento",
      options: ["Pix", "Dinheiro", "Transferência"].map((v) => ({
        value: v,
        label: v,
      })),
    },
    {
      name: "final",
      label: "Aplicar também descontos finais",
      type: "checkbox",
      optional: true,
    },
  ];
}

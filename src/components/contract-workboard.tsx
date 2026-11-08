"use client";
import { z } from "zod";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
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
import { Dialog, ListPagination, searchKey } from "./simple-ui";
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
  contractDetails,
  obra,
  contract,
  items,
  payments,
  allocations,
  executions,
  admin,
  aiEnabled,
}: {
  contractDetails?: ReactNode;
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
    [search, setSearch] = useState(""),
    [page, setPage] = useState(0),
    [panel, setPanel] = useState<string | null>(null),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [itemMode, setItemMode] = useState("detail"),
    [draftPage, setDraftPage] = useState(0),
    [draftIndex, setDraftIndex] = useState<number | null>(null),
    [calculateAfterSave, setCalculateAfterSave] = useState(true),
    [text, setText] = useState(""),
    [drafts, setDrafts] = useState<ContractItemDraft[]>([]),
    [warnings, setWarnings] = useState<string[]>([]),
    [batch, setBatch] = useState(""),
    [importPayments, setImportPayments] = useState(false),
    [paymentDate, setPaymentDate] = useState(today()),
    [wait, setWait] = useState(0),
    [priceProgress, setPriceProgress] = useState<{
      done: number;
      total: number;
      priced: number;
      failed: number;
    } | null>(null),
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
        if (result.ok) {
          if (panel === "drafts") setDrafts([]);
          setPanel(null);
          setSelectedId(null);
        }
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
    setPanel("drafts");
    setSelectedId(null);
    setDraftPage(0);
    setDraftIndex(list.length === 1 ? 0 : null);
    setCalculateAfterSave(list.some((i) => !i.id) && aiEnabled);
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
        "Revise os serviços e clique em Salvar e calcular preços da lista. A IA pesquisará uma referência de preço para cada item.",
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
  function saveDrafts(calculatePrices = false) {
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
          setPanel(null);
          setWarnings([]);
          setText("");
          if (calculatePrices && result.itens?.length)
            void research(result.itens);
          else if (calculatePrices)
            setMessage(
              "Serviços salvos. Use Calcular preços da lista com IA para continuar a pesquisa.",
            );
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
    const ordered = [...list].sort((a, b) =>
      a.nome.localeCompare(b.nome, "pt-BR", { numeric: true }),
    );
    let done = 0,
      priced = 0,
      failed = 0;
    setPriceProgress({ done, priced, failed, total: list.length });
    try {
      for (let offset = 0; offset < list.length && !stop.current; offset += 8) {
        const group = ordered.slice(offset, offset + 8);
        let finished = false;
        while (!finished && !stop.current) {
          controller.current = new AbortController();
          for (const item of group)
            setResearchStatus((s) => ({
              ...s,
              [item.id]: "Calculando preço…",
            }));
          const response = await fetch("/api/ai/price-list", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.current.signal,
            body: JSON.stringify({
              obra_id: obra,
              contrato_id: contract.id,
              itens: group.map((i) => i.id),
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
              result.error ||
                "Não foi possível calcular os preços deste grupo.",
            );
          const rows = z
            .object({
              resultados: z.array(
                z.object({
                  id: z.uuid(),
                  error: z.string().optional(),
                  tem_preco: z.boolean().optional(),
                  tem_total: z.boolean().optional(),
                }),
              ),
            })
            .parse(result).resultados;
          if (
            rows.length !== group.length ||
            new Set(rows.map((r) => r.id)).size !== group.length ||
            rows.some((r) => !group.some((i) => i.id === r.id))
          )
            throw new Error(
              "A resposta não corresponde aos serviços selecionados.",
            );
          for (const row of rows) {
            done++;
            if (row.tem_preco) priced++;
            if (row.error) failed++;
            setResearchStatus((s) => ({
              ...s,
              [row.id]:
                row.error ||
                (row.tem_preco
                  ? row.tem_total
                    ? "Preço total calculado"
                    : "Preço por unidade encontrado; complete a medição"
                  : "Sem fonte de preço compatível; confira a descrição"),
            }));
          }
          setPriceProgress({ done, priced, failed, total: list.length });
          finished = true;
          refresh();
        }
      }
      setMessage(
        stop.current
          ? `Orçamento interrompido. ${done} serviço(s) processado(s); resultados salvos na tabela.`
          : `Orçamento: ${priced}/${list.length} serviço(s) com preço de referência. ${failed ? failed + " item(ns) não puderam ser salvos. " : ""}Confira unidades, medidas pendentes e fontes na tabela.`,
      );
    } catch (error) {
      setMessage(
        stop.current
          ? "Orçamento interrompido; resultados concluídos preservados."
          : error instanceof Error
            ? error.message
            : "Não foi possível concluir o orçamento.",
      );
    } finally {
      setBusy(false);
      setResearching(false);
      setWait(0);
      controller.current = null;
      refresh();
    }
  }
  const shown = active
    .filter(
      (i) =>
        (filter === "todos" ||
          (filter === "pendentes" && i.percentual_executado < 100) ||
          (filter === "concluidos" && i.percentual_executado === 100) ||
          (filter === "extras" && i.classe === "extra")) &&
        searchKey(`${i.nome} ${i.descricao}`).includes(searchKey(search)),
    )
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { numeric: true }));
  const pages = Math.max(1, Math.ceil(shown.length / 6)),
    currentPage = Math.min(page, pages - 1),
    visible = shown.slice(currentPage * 6, (currentPage + 1) * 6);
  const draftCurrent = Math.min(
    draftPage,
    Math.max(0, Math.ceil(drafts.length / 6) - 1),
  );
  const selected = active.find((i) => i.id === selectedId),
    row = selected ? metrics.rows.find((r) => r.item.id === selected.id) : null,
    source = selected?.estimativa_json;
  const referenced = active.filter((i) => i.estimativa_json?.calculo).length;
  function closePanel() {
    setPanel(null);
    setSelectedId(null);
    setItemMode("detail");
  }
  function suggest() {
    try {
      edit(allocateContractBudget(Number(contract.valor_geral), active));
      setWarnings([
        "A distribuição sugerida mantém o preço original. Revise as parcelas antes de salvar.",
      ]);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Confira as estimativas.",
      );
    }
  }
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
      {contract.itens_ativo ? (
        <>
          <dl className="contract-overview">
            <div>
              <dt>Contrato</dt>
              <dd>{money(metrics.total)}</dd>
            </div>
            <div>
              <dt>Pago líquido</dt>
              <dd>{money(metrics.paid)}</dd>
            </div>
            <div>
              <dt>Falta pagar</dt>
              <dd>{money(metrics.remaining)}</dd>
            </div>
          </dl>
          <div className="work-progress">
            <div className="inline justify-between">
              <strong>
                {metrics.progressKnown
                  ? metrics.progress.toFixed(1).replace(".", ",") +
                    "% concluído"
                  : "Execução a organizar"}
              </strong>
              <span className="small muted">
                {metrics.pendingCount} pendente(s)
              </span>
            </div>
            <progress
              aria-label="Avanço da empreitada"
              max={100}
              value={metrics.progress}
            />
            <span className="small muted">
              {metrics.progressKnown
                ? "Faltam " +
                  metrics.remainingProgress.toFixed(1).replace(".", ",") +
                  "% · "
                : "Informe o valor de cada serviço · "}
              {referenced}/{active.length} preços encontrados
            </span>
          </div>
          {metrics.unassignedGross > 0 && (
            <div className="allocation-notice">
              <div>
                <span className="small muted">Pagamentos sem vínculo</span>
                <strong>{money(metrics.unassignedPaid)}</strong>
                {metrics.unassignedDiscount > 0 && (
                  <span className="small muted">
                    Descontos: {money(metrics.unassignedDiscount)}
                  </span>
                )}
              </div>
              {admin && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setMessage("");
                    setPanel("allocation");
                  }}
                >
                  Vincular
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <p className="notice">
          Organize os serviços e acompanhe valores e execução no mesmo lugar. O
          plano e os pagamentos existentes serão preservados.
          {admin && (
            <button
              type="button"
              onClick={() => act(() => adoptContractItems(obra, contract.id))}
              disabled={pending || busy}
            >
              Organizar serviços
            </button>
          )}
        </p>
      )}
      <div className="board-toolbar">
        {admin && (
          <>
            <button
              type="button"
              aria-label={
                drafts.length ? "Continuar edição" : "Adicionar serviços"
              }
              disabled={pending || busy}
              onClick={() => {
                setMessage("");
                setPanel(drafts.length ? "drafts" : "add");
              }}
            >
              {drafts.length ? "Continuar" : "Adicionar"}
            </button>
            {active.some((i) => !i.estimativa_json?.calculo) && (
              <button
                type="button"
                className="secondary"
                aria-label="Calcular preços da lista"
                disabled={pending || busy || !aiEnabled}
                onClick={() =>
                  research(active.filter((i) => !i.estimativa_json?.calculo))
                }
              >
                Orçar lista
              </button>
            )}
          </>
        )}
        <button
          type="button"
          className="secondary options-toggle"
          aria-label="Opções da empreitada"
          disabled={pending || busy}
          onClick={() => {
            setMessage("");
            setPanel("options");
          }}
        >
          ⋯
        </button>
      </div>
      {researching && (
        <div className="notice" role="status">
          <strong>
            Calculando preços: {priceProgress?.done ?? 0}/
            {priceProgress?.total ?? 0}
          </strong>
          <progress
            aria-label="Serviços com pesquisa processada"
            max={priceProgress?.total ?? 1}
            value={priceProgress?.done ?? 0}
            style={{ width: "100%" }}
          />
          <p className="small">
            {wait > 0
              ? `A pesquisa continua em ${wait} s.`
              : "Os resultados aparecem conforme ficam prontos."}
          </p>
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
        </div>
      )}
      {message && !panel && !selected && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      {contract.itens_ativo && (
        <>
          <div className="list-controls">
            <label>
              Buscar serviço
              <input
                type="search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
                placeholder="Nome ou código"
              />
            </label>
            <label>
              Exibir
              <select
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setPage(0);
                }}
              >
                <option value="todos">Todos</option>
                <option value="pendentes">A realizar</option>
                <option value="concluidos">Concluídos</option>
                <option value="extras">Extras</option>
              </select>
            </label>
          </div>
          <div className="compact-list service-list">
            {visible.map((item) => (
              <button
                key={item.id}
                type="button"
                className="record-card service-card"
                aria-label={`Abrir serviço ${item.nome}`}
                onClick={() => {
                  setSelectedId(item.id);
                  setItemMode("detail");
                  setMessage("");
                }}
              >
                <span className="record-main">
                  <strong>{item.nome}</strong>
                  <span className="record-status">
                    {item.percentual_executado === 100
                      ? "Concluído"
                      : item.percentual_executado > 0
                        ? "Em andamento"
                        : "A realizar"}
                    {item.classe === "extra"
                      ? item.aprovado
                        ? " · Extra aprovado"
                        : " · Extra a aprovar"
                      : ""}
                  </span>
                  <span className="small muted">
                    {item.valor_estimado !== null
                      ? "Estimado: " + money(Number(item.valor_estimado))
                      : item.estimativa_json?.calculo
                        ? money(item.estimativa_json.calculo.mean) +
                          " / " +
                          item.estimativa_json.unidade
                        : "Preço a calcular"}
                  </span>
                </span>
                <span className="record-end">
                  <strong>{item.percentual_executado}%</strong>
                  <span aria-hidden="true">›</span>
                </span>
              </button>
            ))}
          </div>
          {!visible.length && (
            <p className="empty">
              {active.length
                ? "Nenhum serviço encontrado."
                : "Adicione serviços ou cole sua lista para começar."}
            </p>
          )}
          <ListPagination
            page={currentPage}
            pages={pages}
            total={shown.length}
            pageSize={6}
            onPage={setPage}
          />
        </>
      )}
      <Dialog
        open={Boolean(panel || selected)}
        title={
          selected
            ? itemMode === "pay"
              ? "Pagamento do serviço"
              : itemMode === "sources"
                ? "Preço e fontes"
                : itemMode === "history"
                  ? "Histórico do serviço"
                  : selected.nome
            : panel === "add"
              ? "Adicionar serviços"
              : panel === "drafts"
                ? drafts.length > 1 && draftIndex !== null
                  ? "Editar serviço da lista"
                  : "Revisar serviços"
                : panel === "allocation"
                  ? "Vincular pagamentos"
                  : panel === "contract"
                    ? "Dados do contrato"
                    : panel === "warnings"
                      ? "Observações da IA"
                      : "Opções da empreitada"
        }
        onClose={closePanel}
        onBack={
          selected && itemMode !== "detail"
            ? () => setItemMode("detail")
            : panel === "drafts" && drafts.length > 1 && draftIndex !== null
              ? () => setDraftIndex(null)
              : panel === "warnings"
                ? () => setPanel("drafts")
                : panel === "allocation" || panel === "contract"
                  ? () => setPanel("options")
                  : undefined
        }
      >
        {message && (
          <p role="status" className="notice">
            {message}
          </p>
        )}
        {panel === "add" && (
          <section className="contract-import">
            <p>
              Descreva os serviços ou envie um arquivo. A IA prepara a lista
              para você revisar e calcular os preços.
            </p>
            <p className="small muted">
              Texto UTF-8 até 64 KB/16 mil caracteres e 60 serviços por arquivo.
              Cole ou descreva os serviços em linguagem natural. A IA identifica
              os itens e pesquisa o preço de mão de obra em Aracaju/SE após sua
              revisão. Mostra preço por unidade quando falta medição e total
              quando há quantidade suficiente. O texto e as descrições são
              enviados à OpenAI.
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
                    "Arquivo carregado. Clique em Preparar orçamento com IA para revisar os serviços e calcular seus preços.",
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
              Descreva os serviços para calcular os preços
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
              Preparar orçamento com IA
            </button>

            <button
              type="button"
              className="secondary"
              onClick={() => edit([newDraft()])}
            >
              Adicionar manualmente
            </button>
          </section>
        )}
        {panel === "drafts" && drafts.length > 0 && (
          <div ref={editor}>
            <section className="contract-drafts">
              <h3>Revisar serviços antes de salvar</h3>
              {warnings.length > 0 && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setPanel("warnings")}
                >
                  Observações da IA ({warnings.length})
                </button>
              )}
              {drafts.length > 1 && draftIndex === null && (
                <>
                  <p className="small muted">
                    {drafts.length} serviços. Toque em um item para ajustar os
                    dados antes de salvar.
                  </p>
                  <div className="compact-list draft-list">
                    {drafts
                      .slice(draftCurrent * 6, draftCurrent * 6 + 6)
                      .map((d, n) => (
                        <button
                          type="button"
                          className="record-card"
                          key={d.id ?? draftCurrent * 6 + n}
                          onClick={() => setDraftIndex(draftCurrent * 6 + n)}
                          aria-label={`Revisar ${d.nome}`}
                        >
                          <span className="record-main">
                            <strong>{d.nome}</strong>
                            <span className="record-status">
                              {d.classe === "extra"
                                ? d.aprovado
                                  ? "Extra aprovado"
                                  : "Extra a aprovar"
                                : "Incluído"}{" "}
                              · {d.quantidade} {d.unidade}
                            </span>
                          </span>
                          <span className="record-end">
                            <span>
                              {d.valor_cobrado === null
                                ? "A definir"
                                : money(d.valor_cobrado)}
                            </span>
                            <span aria-hidden="true">›</span>
                          </span>
                        </button>
                      ))}
                  </div>
                  <ListPagination
                    page={draftCurrent}
                    pages={Math.max(1, Math.ceil(drafts.length / 6))}
                    total={drafts.length}
                    pageSize={6}
                    onPage={setDraftPage}
                  />
                </>
              )}
              {drafts.map((item, index) =>
                index === (drafts.length === 1 ? 0 : draftIndex) ? (
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
                          aria-label="Incluído ou extra"
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
                          aria-label="Unidade"
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
                      onClick={() => {
                        setDrafts((ds) => ds.filter((_, i) => i !== index));
                        setDraftIndex(null);
                      }}
                    >
                      Retirar da prévia
                    </button>
                  </fieldset>
                ) : null,
              )}
              {drafts.length > 1 && draftIndex !== null ? (
                <button type="button" onClick={() => setDraftIndex(null)}>
                  Concluir edição
                </button>
              ) : (
                <>
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
                    total apenas quando aprovados. Alterar parcelas muda o
                    avanço ponderado; os pagamentos existentes são preservados.
                  </p>

                  {aiEnabled && (
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={calculateAfterSave}
                        onChange={(e) =>
                          setCalculateAfterSave(e.target.checked)
                        }
                      />
                      Calcular preços com IA após salvar
                    </label>
                  )}
                  {drafts.length === 1 &&
                    drafts[0].id &&
                    drafts[0].percentual_executado === 0 &&
                    !allocations.some((a) => a.item_id === drafts[0].id) && (
                      <button
                        type="button"
                        className="secondary"
                        disabled={pending || busy}
                        onClick={() =>
                          act(() =>
                            archiveContractItem(
                              obra,
                              contract.id,
                              drafts[0].id!,
                            ),
                          )
                        }
                      >
                        Arquivar serviço
                      </button>
                    )}
                  <button
                    type="button"
                    disabled={pending || busy || !drafts.length}
                    onClick={() => saveDrafts(calculateAfterSave)}
                  >
                    {calculateAfterSave
                      ? "Salvar e calcular preços"
                      : "Salvar alterações"}
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    disabled={pending || busy}
                    onClick={() => {
                      setDrafts([]);
                      setWarnings([]);
                      setPanel(null);
                      setMessage("");
                    }}
                  >
                    Descartar alterações
                  </button>
                </>
              )}
            </section>
          </div>
        )}
        {panel === "warnings" &&
          warnings.map((w, i) => (
            <p className="notice" key={i}>
              {w}
            </p>
          ))}
        {panel === "options" && (
          <>
            {contractDetails && (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setMessage("");
                  setPanel("contract");
                }}
              >
                Dados do contrato e arquivos
              </button>
            )}
            <dl className="detail-values">
              <div>
                <dt>Preço original</dt>
                <dd>{money(metrics.base)}</dd>
              </div>
              <div>
                <dt>Extras aprovados</dt>
                <dd>{money(metrics.extras)}</dd>
              </div>
              <div>
                <dt>Descontos aplicados</dt>
                <dd>{money(metrics.discount)}</dd>
              </div>
              <div>
                <dt>Devido pelo executado</dt>
                <dd>{money(metrics.due)}</dd>
              </div>
              <div>
                <dt>Adiantamento</dt>
                <dd>{money(metrics.advance)}</dd>
              </div>
              <div>
                <dt>Mercado (totais conhecidos)</dt>
                <dd>{money(metrics.market)}</dd>
              </div>
            </dl>
            <p className="small muted">
              Parcela distribuída: {money(metrics.included)} de{" "}
              {money(metrics.base)}.{" "}
              {metrics.reserve > 0
                ? "Falta distribuir " + money(metrics.reserve) + "."
                : ""}
            </p>
            {admin && (
              <div className="option-actions">
                <button className="secondary" type="button" onClick={suggest}>
                  Sugerir parcelas pelo preço da IA
                </button>
                {livePayments.length > 0 && (
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => setPanel("allocation")}
                  >
                    Vincular pagamentos aos serviços
                  </button>
                )}
              </div>
            )}
            <a
              className="button secondary"
              href={`/?obra=${obra}&tab=pagamentos&contrato=${contract.id}`}
            >
              Abrir financeiro do contrato
            </a>
            <a
              className="button secondary"
              href={`/?obra=${obra}&tab=estimativas`}
            >
              Consultar preço avulso
            </a>
          </>
        )}
        {panel === "contract" && contractDetails}
        {panel === "allocation" && admin && (
          <section className="contract-allocation">
            <p className="small">
              Este controle vincula dinheiro/descontos já registrados. Não cria
              pagamentos nem altera o total pago.
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
                    aria-label="Pagamento"
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
                    aria-label="Serviço para vincular"
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
              .filter((a) => livePayments.some((p) => p.id === a.pagamento_id))
              .map((a) => (
                <p className="small" key={a.id}>
                  {
                    livePayments.find((p) => p.id === a.pagamento_id)
                      ?.referencia
                  }{" "}
                  →{" "}
                  {active.find((i) => i.id === a.item_id)?.nome ??
                    "Item do histórico"}
                  : {money(Number(a.valor_bruto) - Number(a.desconto))} líquidos
                  + {money(Number(a.desconto))} desconto{" "}
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
          </section>
        )}
        {selected && row && itemMode === "detail" && (
          <>
            <p className="record-status">
              {selected.classe === "extra"
                ? selected.aprovado
                  ? "Extra aprovado"
                  : "Extra a aprovar"
                : "Incluído no contrato"}{" "}
              · {selected.percentual_executado}% executado
            </p>
            <p>{selected.descricao}</p>
            <p className="small muted">
              Medição: {selected.quantidade} {selected.unidade}
            </p>
            <dl className="detail-values">
              <div>
                <dt>Estimado pela IA</dt>
                <dd>
                  {selected.valor_estimado !== null
                    ? money(Number(selected.valor_estimado))
                    : source?.calculo
                      ? money(source.calculo.mean) + " / " + source.unidade
                      : "Preço a calcular"}
                </dd>
              </div>
              <div>
                <dt>Cobrado / parcela</dt>
                <dd>
                  {selected.valor_cobrado === null
                    ? "A definir"
                    : money(Number(selected.valor_cobrado))}
                </dd>
              </div>
              <div>
                <dt>Pago líquido</dt>
                <dd>{money(row.paid)}</dd>
              </div>
              <div>
                <dt>Falta pagar</dt>
                <dd>
                  {selected.valor_cobrado === null
                    ? "A definir"
                    : selected.classe === "extra" && !selected.aprovado
                      ? "A aprovar"
                      : money(row.remaining)}
                </dd>
              </div>
              <div>
                <dt>Devido pelo executado</dt>
                <dd>{money(row.due)}</dd>
              </div>
              {row.discount > 0 && (
                <div>
                  <dt>Descontos</dt>
                  <dd>{money(row.discount)}</dd>
                </div>
              )}
              {row.advance > 0 && (
                <div>
                  <dt>Antecipado ao serviço</dt>
                  <dd>{money(row.advance)}</dd>
                </div>
              )}
            </dl>
            <div className="detail-links">
              <button
                type="button"
                className="text-button"
                onClick={() => setItemMode("sources")}
              >
                Preço e fontes
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => setItemMode("history")}
              >
                Histórico
              </button>
            </div>
            {admin && (
              <div className="dialog-actions">
                {selected.percentual_executado < 100 && (
                  <button
                    type="button"
                    disabled={pending || busy}
                    onClick={() =>
                      act(() =>
                        saveSingleContractItem(
                          obra,
                          contract.id,
                          draftFromItem(selected, {
                            percentual_executado: 100,
                          }),
                        ),
                      )
                    }
                  >
                    Marcar concluído
                  </button>
                )}
                {(selected.classe === "incluido" || selected.aprovado) && (
                  <button
                    type="button"
                    className={
                      selected.percentual_executado < 100 ? "secondary" : ""
                    }
                    disabled={pending || busy}
                    onClick={() => setItemMode("pay")}
                  >
                    Registrar pagamento
                  </button>
                )}
                <button
                  className="secondary"
                  type="button"
                  disabled={pending || busy}
                  onClick={() => edit([draftFromItem(selected)])}
                >
                  Editar serviço
                </button>
              </div>
            )}
          </>
        )}
        {selected && itemMode === "pay" && admin && (
          <DataForm
            kind="payment"
            obra={obra}
            fields={paymentFields(contract, selected)}
            title="Registrar pagamento"
            onSaved={() => {
              closePanel();
              setMessage("Pagamento registrado.");
            }}
          />
        )}
        {selected && itemMode === "sources" && (
          <>
            {source ? (
              <>
                <dl className="detail-values">
                  <div>
                    <dt>Preço por unidade</dt>
                    <dd>
                      {source.calculo
                        ? money(source.calculo.mean) + " / " + source.unidade
                        : "Sem referência comparável"}
                    </dd>
                  </div>
                  {source.calculo && (
                    <div>
                      <dt>Faixa por unidade</dt>
                      <dd>
                        {money(source.calculo.minimum)} a{" "}
                        {money(source.calculo.maximum)}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>Total estimado</dt>
                    <dd>
                      {selected.valor_estimado !== null
                        ? money(Number(selected.valor_estimado))
                        : source.unidade === "diária"
                          ? "Informe duração e equipe"
                          : "Informe as medidas para o total"}
                    </dd>
                  </div>
                </dl>
                <p>{source.observacoes}</p>
                {source.aviso_regional && (
                  <p className="notice">{source.aviso_regional}</p>
                )}
                {source.perguntas.map((q, i) => (
                  <p className="small" key={i}>
                    {q}
                  </p>
                ))}
                {source.referencias.map((ref, i) => (
                  <div className="source-row" key={i}>
                    <a href={ref.url} target="_blank" rel="noopener noreferrer">
                      {ref.titulo} ↗
                    </a>
                    <p className="small muted">{ref.trecho_preco}</p>
                  </div>
                ))}
                {selected.pesquisado_em && (
                  <p className="small muted">
                    Consultado em {dateBR(selected.pesquisado_em)}
                  </p>
                )}
              </>
            ) : (
              <p>O preço ainda não foi pesquisado.</p>
            )}
            {admin && (
              <button
                type="button"
                disabled={pending || busy || !aiEnabled}
                onClick={() => {
                  closePanel();
                  void research([selected]);
                }}
              >
                Recalcular preço com IA
              </button>
            )}
          </>
        )}
        {selected && itemMode === "history" && (
          <>
            <h3>Execução</h3>
            {executions
              .filter((e) => e.item_id === selected.id)
              .map((e) => (
                <p className="history-row" key={e.id}>
                  {dateBR(e.data)} · {e.percentual}% · {e.observacoes}
                </p>
              ))}
            {!executions.some((e) => e.item_id === selected.id) && (
              <p className="small muted">Nenhum avanço registrado.</p>
            )}
            <h3>Pagamentos vinculados</h3>
            {allocations
              .filter(
                (a) =>
                  a.item_id === selected.id &&
                  livePayments.some((p) => p.id === a.pagamento_id),
              )
              .map((a) => (
                <p key={a.id}>
                  {
                    livePayments.find((p) => p.id === a.pagamento_id)
                      ?.referencia
                  }{" "}
                  · {money(Number(a.valor_bruto) - Number(a.desconto))} líquidos
                  + {money(Number(a.desconto))} em descontos
                </p>
              ))}
            <a
              className="button secondary"
              href={`/?obra=${obra}&tab=pagamentos&contrato=${contract.id}`}
            >
              Ver pagamentos no financeiro
            </a>
          </>
        )}
      </Dialog>
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

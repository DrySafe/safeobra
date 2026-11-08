export const dynamic = "force-dynamic";
import {
  AppLink as Link,
  MobileMenu,
  QueryForm,
} from "@/components/navigation";
import { ActionSheet, RecordList } from "@/components/simple-ui";
import { mainSections, sectionFor } from "@/lib/app-navigation";
import { AiServiceAssistant } from "@/components/ai-service-assistant";
import { ContractPayments } from "@/components/contract-payments";
import { RecordFiles as Files } from "@/components/record-files";
import { db } from "@/lib/supabase/server";
import { session } from "@/server/access";
import {
  DataForm,
  Theme,
  Photo,
  DeleteButton,
  Upload,
  Attachment,
  ActionButton,
  Print,
  type Field,
} from "@/components/forms";
import {
  logout,
  activate,
  memberAction,
  updateRecord,
  cancelPayment,
} from "@/server/actions";
import { categories } from "@/lib/schemas";
import { money, dateBR, execution, balance } from "@/lib/finance";
import type * as M from "@/lib/models";
import { ExpenseCreateForm } from "@/components/expense-form";
import { ServiceEstimator } from "@/components/service-estimator";
import { ContractWorkboard } from "@/components/contract-workboard";
import {
  contractItemMetrics,
  type ContractItem,
  type PaymentAllocation,
  type ItemExecution,
} from "@/lib/contract-items";
import { serviceUnits, type CostSample } from "@/lib/estimates";
const tabs = [
  ["dashboard", "◫", "Resumo"],
  ["gastos", "↗", "Compras e despesas"],
  ["equipe", "▤", "Serviços"],
  ["diario", "▧", "Diário da obra"],
  ["relatorios", "▥", "Relatórios"],
  ["pagamentos", "↗", "Pagamentos da equipe"],
  ["estimativas", "≈", "Estimativa de serviços"],
  ["membros", "♧", "Equipe e convites"],
];
const opts = (values: readonly string[]) =>
  values.map((value) => ({ value, label: value }));
const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Maceio" }).format(
    new Date(),
  );
const category: Field = {
  name: "categoria",
  label: "Categoria",
  options: opts(categories),
};
const amount = (name: string, label: string): Field => ({
  name,
  label: label + " (R$)",
  type: "number",
  scale: 100,
});
const date = (name: string, label: string): Field => ({
  name,
  label,
  type: "date",
  value: today(),
});
const measurementFields = (stage?: M.Stage): Field[] => [
  {
    name: "unidade",
    label: "Unidade de medição",
    options: opts(serviceUnits),
    value: stage?.unidade ?? "serviço",
  },
  {
    name: "quantidade",
    label: "Quantidade prevista",
    type: "number",
    value: String(stage?.quantidade ?? 1),
  },
];
const expenseFields = (suggestions: string[]): Field[] => [
  { name: "categoria", label: "Categoria", suggestions },
  { name: "descricao", label: "Descrição" },
  { name: "fornecedor", label: "Fornecedor / loja" },
  { name: "quantidade", label: "Quantidade", type: "number", value: "1" },
  amount("valor_unitario", "Valor unitário"),
  date("data_compra", "Compra"),
  {
    name: "data_entrega",
    label: "Entrega prevista",
    type: "date",
    optional: true,
  },
  {
    name: "forma_pagamento",
    label: "Forma de pagamento",
    options: opts(["Pix", "Dinheiro", "Cartão", "Boleto", "Transferência"]),
  },
  {
    name: "status_entrega",
    label: "Entrega",
    options: opts(["pendente", "entregue"]),
  },
  {
    name: "observacoes",
    label: "Observações",
    type: "textarea",
    optional: true,
  },
];
function prefill(fields: Field[], record: object): Field[] {
  const row = record as Record<string, unknown>;
  return fields.map((f) => ({
    ...f,
    value: f.scale
      ? String(Number(row[f.name] ?? 0) / f.scale)
      : String(row[f.name] ?? ""),
  }));
}
function Card({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <article className="card">
      <span className="muted small">{label}</span>
      <div className="value">{value}</div>
      <span className="muted small">{sub}</span>
    </article>
  );
}
function Progress({ value }: { value: number }) {
  return (
    <div
      className="progress"
      role="progressbar"
      aria-label="Percentual executado"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  if (
    !(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL) ||
    !(
      process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )
  )
    return (
      <main className="auth">
        <div className="logo">
          <span className="mark">S</span>SafeObra
        </div>
        <h1>Vamos preparar sua obra.</h1>
        <p>
          Configure o Supabase seguindo o README e preencha as variáveis de
          ambiente. Depois, crie sua conta para começar.
        </p>
        <p className="muted">
          Nenhum dado demonstrativo é apresentado como real.
        </p>
      </main>
    );
  const { client, user } = await session();
  const query = await searchParams;
  const tab = tabs.some((t) => t[0] === query.tab) ? query.tab! : "dashboard";
  const { data: obraRows, error: obraError } = await client
    .from("obras")
    .select("id,nome,orcamento,obra_membros!inner(role)")
    .eq("obra_membros.user_id", user.id)
    .order("criado_em");
  if (obraError) throw new Error("Falha ao listar obras");
  const obras = obraRows ?? [];
  const obra = obras.find((o) => o.id === query.obra) ?? obras[0];
  if (!obra)
    return (
      <main className="auth">
        <div className="logo">
          <span className="mark">S</span>SafeObra
        </div>
        <h1>Sua primeira obra começa aqui.</h1>
        <p>Crie uma obra ou abra o link de convite recebido.</p>
        <DataForm
          kind="obra"
          title="Criar obra"
          fields={[
            { name: "nome", label: "Nome da obra" },
            amount("orcamento", "Orçamento"),
          ]}
        />
        <form action={logout}>
          <button className="secondary">Sair</button>
        </form>
      </main>
    );
  const role = obra.obra_membros?.[0]?.role;
  if (!role) throw new Error("Sem permissão para esta obra");
  const admin = role === "admin";
  const obraId = String(obra.id);
  const needs = {
    gastos: ["dashboard", "gastos", "relatorios"].includes(tab),
    contratos_mao_de_obra: [
      "dashboard",
      "equipe",
      "pagamentos",
      "relatorios",
      "estimativas",
    ].includes(tab),
    servicos: [
      "dashboard",
      "equipe",
      "pagamentos",
      "diario",
      "estimativas",
    ].includes(tab),
    pagamentos: ["dashboard", "equipe", "pagamentos", "relatorios"].includes(
      tab,
    ),
    descontos_profissional: ["equipe", "pagamentos"].includes(tab),
    ocorrencias: ["dashboard", "diario", "relatorios"].includes(tab),
    anexos: ["gastos", "equipe", "pagamentos", "diario"].includes(tab),
    execucoes: tab === "equipe",
    empreitada_itens: [
      "dashboard",
      "equipe",
      "pagamentos",
      "relatorios",
      "estimativas",
    ].includes(tab),
    pagamento_itens: ["equipe", "pagamentos"].includes(tab),
    empreitada_execucoes: tab === "equipe",
  };
  const href = (t: string) => `/?obra=${obraId}&tab=${t}`;
  async function all<T>(table: string, columns = "*"): Promise<T[]> {
    if (table in needs && !needs[table as keyof typeof needs]) return [];
    const result: T[] = [];
    for (let from = 0; ; from += 1000) {
      const latest = table === "ocorrencias" && tab === "dashboard";
      let request = client
        .from(table)
        .select(columns)
        .eq("obra_id", obraId)
        .order(latest ? "criado_em" : "id", { ascending: !latest })
        .range(from, from + (latest ? 4 : 999));
      if (table === "anexos" && tab === "gastos")
        request = request.eq("entidade", "gastos");
      if (table === "anexos" && tab === "diario")
        request = request.eq("entidade", "ocorrencias");
      if (table === "servicos" && tab === "estimativas")
        request = request.eq("percentual_executado", 100);
      const { data, error } = await request;
      if (error) throw new Error("Falha ao carregar " + table);
      result.push(...(data as unknown as T[]));
      if (data.length < 1000) return result;
    }
  }
  const [
    expenses,
    contracts,
    stages,
    allPayments,
    discounts,
    occurrences,
    attachments,
    executions,
  ] = await Promise.all([
    all<M.Expense>("gastos"),
    all<M.Contract>("contratos_mao_de_obra"),
    all<M.Stage>("servicos"),
    all<M.Payment>("pagamentos"),
    all<M.Discount>("descontos_profissional"),
    all<M.Occurrence>("ocorrencias"),
    all<M.Attachment>("anexos"),
    all<M.Execution>("execucoes"),
  ]);
  const [contractItems, paymentAllocations, itemExecutions] = await Promise.all(
    [
      all<ContractItem>("empreitada_itens"),
      all<PaymentAllocation>("pagamento_itens"),
      all<ItemExecution>("empreitada_execucoes"),
    ],
  );
  const references =
    tab === "estimativas" ? await all<CostSample>("referencias_servicos") : [];
  const historicalSamples: CostSample[] =
    tab === "estimativas"
      ? stages
          .filter(
            (stage) =>
              stage.percentual_executado === 100 &&
              !contracts.find((c) => c.id === stage.contrato_id)?.itens_ativo,
          )
          .flatMap((stage) => {
            const contract = contracts.find(
              (item) => item.id === stage.contrato_id && item.plano_ativo,
            );
            if (!contract || !Number(stage.quantidade)) return [];
            const value = Math.round(
              (Number(contract.valor_geral) * stage.peso) /
                10000 /
                Number(stage.quantidade),
            );
            return value > 0
              ? [
                  {
                    id: "stage-" + stage.id,
                    nome: stage.nome,
                    unidade: stage.unidade,
                    valor_unitario: value,
                    fonte: "Etapa concluída — valor previsto no contrato",
                    data_referencia: stage.criado_em,
                    regiao: "Obra atual",
                  },
                ]
              : [];
          })
      : [];
  if (tab === "estimativas")
    for (const item of contractItems.filter(
      (i) =>
        !i.arquivado &&
        i.percentual_executado === 100 &&
        (i.classe === "incluido" || i.aprovado) &&
        i.valor_cobrado !== null &&
        Number(i.valor_cobrado) > 0,
    ))
      historicalSamples.push({
        id: "item-" + item.id,
        nome: item.nome,
        unidade: item.unidade,
        valor_unitario: Math.round(
          Number(item.valor_cobrado) / Number(item.quantidade),
        ),
        fonte: "Serviço concluído — parcela do preço contratado",
        data_referencia: item.criado_em,
        regiao: "Obra atual",
      });
  const payments = allPayments.filter((p) => !p.anulado);
  const total = expenses.reduce((s, x) => s + Number(x.valor_total), 0);
  const stats = new Map(
    contracts.map((c) => {
      if (c.itens_ativo) {
        const m = contractItemMetrics(
          Number(c.valor_geral),
          contractItems.filter((i) => i.contrato_id === c.id),
          payments.filter((p) => p.contrato_id === c.id),
          paymentAllocations.filter((a) => a.contrato_id === c.id),
        );
        return [
          c.id,
          {
            total: m.total,
            earned: m.earned,
            progress: m.progress,
            remaining: m.total - m.earned,
            progressKnown: m.progressKnown,
          },
        ] as const;
      }
      const ex = c.plano_ativo
        ? execution(
            Number(c.valor_geral),
            stages
              .filter((s) => s.contrato_id === c.id)
              .map((s) => ({
                weight: s.peso,
                progress: s.percentual_executado,
              })),
          )
        : { earned: 0, progress: 0, remaining: Number(c.valor_geral) };
      return [
        c.id,
        { ...ex, total: Number(c.valor_geral), progressKnown: c.plano_ativo },
      ] as const;
    }),
  );
  const totalContract = contracts
    .filter((c) => c.tipo === "empreitada")
    .reduce((sum, c) => sum + stats.get(c.id)!.total, 0);
  const paid = payments.reduce((sum, p) => sum + Number(p.valor), 0),
    applied = payments.reduce((sum, p) => sum + Number(p.desconto), 0);
  const earned = contracts.reduce((sum, c) => sum + stats.get(c.id)!.earned, 0);
  const progress = totalContract ? (earned / totalContract) * 100 : 0;
  const progressKnown = contracts
    .filter((c) => c.tipo === "empreitada")
    .every((c) => stats.get(c.id)!.progressKnown);
  const upcomingStages = [
    ...stages.filter(
      (s) => !contracts.find((c) => c.id === s.contrato_id)?.itens_ativo,
    ),
    ...contractItems
      .filter((i) => !i.arquivado && (i.classe === "incluido" || i.aprovado))
      .map((i) => ({
        id: i.id,
        nome: i.nome,
        percentual_executado: i.percentual_executado,
      })),
  ];
  const contractOpts = contracts.map((c) => ({
    value: c.id,
    label: c.profissional + " · " + money(stats.get(c.id)!.total),
  }));
  const stageOpts = stages.map((s) => ({ value: s.id, label: s.nome }));
  const occurrenceFields: Field[] = [
    { name: "titulo", label: "Título" },
    {
      name: "tipo",
      label: "Tipo",
      options: [
        { value: "andamento", label: "Andamento" },
        { value: "atencao", label: "Ponto de atenção" },
        { value: "problema", label: "Problema / erro" },
        { value: "mudanca", label: "Mudança solicitada" },
      ],
    },
    date("data", "Data"),
    {
      name: "servico_id",
      label: "Serviço relacionado",
      optional: true,
      options: stageOpts,
    },
    { name: "responsavel", label: "Responsável", optional: true },
    { name: "descricao", label: "Descrição", type: "textarea", optional: true },
  ];
  const selectedContract =
    contracts.find((c) => c.id === query.contrato) ?? contracts[0];
  const expenseCategories = [
    ...new Set([...categories, ...expenses.map((e) => e.categoria)]),
  ].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const expenseFormFields = expenseFields(expenseCategories);
  const visibleExpenses = expenses.filter(
    (e) =>
      (!query.categoria || e.categoria === query.categoria) &&
      (!query.status || e.status_entrega === query.status) &&
      (!query.inicio || e.data_compra >= query.inicio) &&
      (!query.fim || e.data_compra <= query.fim) &&
      (!query.busca ||
        `${e.descricao} ${e.fornecedor}`
          .toLocaleLowerCase("pt-BR")
          .includes(query.busca.toLocaleLowerCase("pt-BR"))),
  );
  return (
    <div className="shell">
      <MobileMenu tab={tab} obra={obraId} />
      <aside className="sidebar no-print">
        <Link href="/" className="logo">
          <span className="mark">S</span>SafeObra
          <span className="text-emerald-600">.</span>
        </Link>
        <nav aria-label="Módulos">
          {mainSections.map(([key, icon, label]) => (
            <Link
              aria-current={sectionFor(tab) === key ? "page" : undefined}
              className={
                "nav-link " + (sectionFor(tab) === key ? "active" : "")
              }
              key={key}
              href={href(key)}
            >
              <span aria-hidden="true">{icon}　</span>
              {label}
            </Link>
          ))}
        </nav>
        <footer>
          <p className="small muted">
            Feito para acompanhar
            <br />
            cada etapa da sua obra.
          </p>
          <span className="badge">
            {admin ? "Administrador" : "Visualização + diário"}
          </span>
        </footer>
      </aside>
      <div className="workspace">
        <header
          className={
            "topbar no-print" + (obras.length === 1 ? " single-work" : "")
          }
        >
          <Link href={href("dashboard")} className="mobile-wordmark">
            <span className="mark">S</span>SafeObra
          </Link>
          {obras.length > 1 ? (
            <QueryForm className="obra-selector" autoSubmit>
              <input type="hidden" name="tab" value={tab} />
              <label className="sr-only" htmlFor="obra-select">
                Selecionar obra
              </label>
              <select id="obra-select" name="obra" defaultValue={obraId}>
                {obras.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.nome}
                  </option>
                ))}
              </select>
            </QueryForm>
          ) : (
            <span className="topbar-work">{obra.nome}</span>
          )}
          <ActionSheet label="Conta" title="Sua conta">
            <p>{user.email}</p>
            <div className="dialog-actions">
              <Theme />
              <form action={logout}>
                <button className="secondary">Sair da conta</button>
              </form>
            </div>
          </ActionSheet>
        </header>
        <main>
          <div className="heading compact-heading">
            <div>
              <p className="eyebrow">{obra.nome}</p>
              <h1>
                {mainSections.find((t) => t[0] === sectionFor(tab))?.[2] ??
                  "Resumo"}
              </h1>
            </div>
          </div>
          {["gastos", "pagamentos", "relatorios", "diario", "membros"].includes(
            tab,
          ) && (
            <QueryForm className="section-switch no-print" autoSubmit>
              <input type="hidden" name="obra" value={obraId} />
              <label>
                Visualizar
                <select name="tab" defaultValue={tab}>
                  {(sectionFor(tab) === "gastos"
                    ? [
                        ["gastos", "Compras e despesas"],
                        ["pagamentos", "Pagamentos da equipe"],
                        ["relatorios", "Relatórios"],
                      ]
                    : [
                        ["diario", "Diário e fotos"],
                        ["membros", "Pessoas e configurações"],
                      ]
                  ).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </QueryForm>
          )}
          {tab === "dashboard" && (
            <>
              <div className="cards">
                <Card
                  label="Compras e despesas"
                  value={money(total)}
                  sub="Materiais, serviços e outras despesas"
                />
                <Card
                  label="Pago à equipe"
                  value={money(paid)}
                  sub={"Descontos aplicados: " + money(applied)}
                />
                <Card
                  label="Valor das empreitadas"
                  value={money(totalContract)}
                  sub={
                    "Saldo total dos contratos: " +
                    money(
                      Math.max(
                        0,
                        contracts.reduce(
                          (s, c) => s + stats.get(c.id)!.total,
                          0,
                        ) -
                          paid -
                          applied,
                      ),
                    )
                  }
                />
                <Card
                  label="Obra concluída"
                  value={
                    progressKnown
                      ? progress.toFixed(1).replace(".", ",") + "%"
                      : "Plano a completar"
                  }
                  sub={
                    money(earned) +
                    " em serviços executados" +
                    (progressKnown
                      ? " · faltam " + (100 - progress).toFixed(1) + "%"
                      : " · distribua os valores dos serviços")
                  }
                />
              </div>
              <div className="columns">
                <section className="panel">
                  <h2>Gastos por categoria</h2>
                  {total ? (
                    expenseCategories
                      .filter((cat) =>
                        expenses.some((e) => e.categoria === cat),
                      )
                      .sort(
                        (a, b) =>
                          expenses
                            .filter((e) => e.categoria === b)
                            .reduce((n, e) => n + Number(e.valor_total), 0) -
                          expenses
                            .filter((e) => e.categoria === a)
                            .reduce((n, e) => n + Number(e.valor_total), 0),
                      )
                      .slice(0, 3)
                      .map((cat) => {
                        const value = expenses
                          .filter((e) => e.categoria === cat)
                          .reduce((s, e) => s + Number(e.valor_total), 0);
                        return (
                          <div className="chart-bar" key={cat}>
                            <span>{cat}</span>
                            <Progress value={(value / total) * 100} />
                            <strong>{money(value)}</strong>
                          </div>
                        );
                      })
                  ) : (
                    <p className="empty">
                      Os gastos aparecerão aqui após o primeiro lançamento.
                    </p>
                  )}
                </section>
                <section className="panel">
                  <div className="inline justify-between">
                    <h2>O próximo passo da sua obra</h2>
                    <Link className="small underline" href={href("equipe")}>
                      Ver plano ↗
                    </Link>
                  </div>
                  {upcomingStages
                    .filter((s) => s.percentual_executado < 100)
                    .slice(0, 3)
                    .map((s) => (
                      <div className="row" key={s.id}>
                        <div>
                          <h3>{s.nome}</h3>
                          <span className="muted small">
                            {s.percentual_executado === 0
                              ? "A fazer"
                              : "Em andamento"}
                          </span>
                        </div>
                        <strong>{s.percentual_executado}%</strong>
                      </div>
                    ))}
                  {!stages.length && (
                    <p className="empty">
                      Cadastre a empreitada e o plano de serviços.
                    </p>
                  )}
                  {progressKnown && <Progress value={progress} />}
                  <p className="muted small">
                    A execução considera o peso de cada serviço dentro das
                    empreitadas.
                  </p>
                </section>
              </div>
              <section className="panel">
                <h2>Últimos registros</h2>
                {occurrences
                  .slice()
                  .sort((a, b) => b.criado_em.localeCompare(a.criado_em))
                  .slice(0, 3)
                  .map((o) => (
                    <div className="row" key={o.id}>
                      <div>
                        <strong>{o.titulo}</strong>
                        <p className="small muted">
                          {dateBR(o.data)} · {o.tipo}
                        </p>
                      </div>
                      <span className="badge warning">
                        {o.status.replace("_", " ")}
                      </span>
                    </div>
                  ))}
                {!occurrences.length && (
                  <p className="empty">
                    Compartilhe a primeira atualização no diário da obra.
                  </p>
                )}
              </section>
            </>
          )}
          {tab === "gastos" && (
            <>
              <div className="area-actions">
                {admin && (
                  <ActionSheet
                    label="Nova despesa"
                    title="Despesa e comprovantes"
                    primary
                  >
                    <ExpenseCreateForm
                      obra={obraId}
                      fields={expenseFormFields}
                    />
                  </ActionSheet>
                )}
                <ActionSheet label="Filtros" title="Filtrar despesas">
                  <QueryForm>
                    <input type="hidden" name="obra" value={obraId} />
                    <input type="hidden" name="tab" value="gastos" />
                    <label>
                      Descrição ou fornecedor
                      <input name="busca" defaultValue={query.busca} />
                    </label>
                    <label>
                      Categoria
                      <select
                        name="categoria"
                        defaultValue={query.categoria ?? ""}
                      >
                        <option value="">Todas</option>
                        {expenseCategories.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Entrega
                      <select name="status" defaultValue={query.status ?? ""}>
                        <option value="">Todas</option>
                        <option>pendente</option>
                        <option>entregue</option>
                      </select>
                    </label>
                    <div className="form-grid">
                      <label>
                        De
                        <input
                          type="date"
                          name="inicio"
                          defaultValue={query.inicio}
                        />
                      </label>
                      <label>
                        Até
                        <input
                          type="date"
                          name="fim"
                          defaultValue={query.fim}
                        />
                      </label>
                    </div>
                    <button>Aplicar filtros</button>
                    <Link className="button secondary" href={href("gastos")}>
                      Limpar filtros
                    </Link>
                  </QueryForm>
                </ActionSheet>
              </div>
              <section className="panel">
                <div className="section-title">
                  <h2>Compras e despesas</h2>
                  <strong>
                    {money(
                      visibleExpenses.reduce(
                        (n, e) => n + Number(e.valor_total),
                        0,
                      ),
                    )}
                  </strong>
                </div>
                <p className="small muted">
                  {visibleExpenses.length} lançamento(s) no período. Toque para
                  ver detalhes e comprovantes.
                </p>
                <RecordList
                  label="Despesas"
                  empty="Nenhum gasto encontrado para estes filtros."
                  items={visibleExpenses
                    .slice()
                    .sort(
                      (a, b) =>
                        b.data_compra.localeCompare(a.data_compra) ||
                        b.criado_em.localeCompare(a.criado_em),
                    )
                    .map((e) => ({
                      id: e.id,
                      title: e.descricao,
                      subtitle: `${dateBR(e.data_compra)} · ${e.fornecedor}`,
                      amount: money(Number(e.valor_total)),
                      status:
                        e.status_entrega === "pendente"
                          ? "Entrega pendente"
                          : "Entregue",
                      details: (
                        <>
                          <dl className="detail-values">
                            <div>
                              <dt>Total</dt>
                              <dd>{money(Number(e.valor_total))}</dd>
                            </div>
                            <div>
                              <dt>Quantidade × unitário</dt>
                              <dd>
                                {e.quantidade} ×{" "}
                                {money(Number(e.valor_unitario))}
                              </dd>
                            </div>
                            <div>
                              <dt>Categoria</dt>
                              <dd>{e.categoria}</dd>
                            </div>
                            <div>
                              <dt>Fornecedor</dt>
                              <dd>{e.fornecedor}</dd>
                            </div>
                            <div>
                              <dt>Entrega</dt>
                              <dd>
                                {e.data_entrega
                                  ? dateBR(e.data_entrega)
                                  : "Não informada"}
                              </dd>
                            </div>
                            <div>
                              <dt>Pagamento</dt>
                              <dd>{e.forma_pagamento}</dd>
                            </div>
                          </dl>
                          {e.observacoes && <p>{e.observacoes}</p>}
                          <Files
                            rows={attachments}
                            obra={obraId}
                            entity="gastos"
                            id={e.id}
                            canUpload={admin}
                          />
                        </>
                      ),
                      edit: admin ? (
                        <>
                          <DataForm
                            kind="gastos"
                            obra={obraId}
                            record={e.id}
                            fields={prefill(expenseFormFields, e)}
                          />
                          <DeleteButton
                            obra={obraId}
                            entity="gastos"
                            id={e.id}
                          />
                        </>
                      ) : undefined,
                    }))}
                />
              </section>
            </>
          )}
          {["equipe", "pagamentos"].includes(tab) && (
            <>
              {!contracts.length && (
                <p className="empty">
                  Cadastre uma contratação para organizar serviços e pagamentos.
                </p>
              )}
              {contracts.length > 1 && (
                <QueryForm className="contract-picker" autoSubmit>
                  <input type="hidden" name="obra" value={obraId} />
                  <input type="hidden" name="tab" value={tab} />
                  <label>
                    Contrato
                    <select
                      aria-label="Selecionar contrato"
                      name="contrato"
                      defaultValue={selectedContract?.id}
                    >
                      {contracts.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.profissional}
                        </option>
                      ))}
                    </select>
                  </label>
                </QueryForm>
              )}

              {contracts
                .filter((c) => c.id === selectedContract?.id)
                .map((c) => {
                  const ownStages = stages.filter(
                    (s) => s.contrato_id === c.id,
                  );
                  const cp = payments.filter((p) => p.contrato_id === c.id);
                  const cd = discounts.filter((d) => d.contrato_id === c.id);
                  const ownItems = contractItems.filter(
                    (i) => i.contrato_id === c.id,
                  );
                  const paymentServices = c.itens_ativo
                    ? ownItems.filter(
                        (i) =>
                          !i.arquivado &&
                          (i.classe === "incluido" || i.aprovado),
                      )
                    : ownStages;
                  const ex = stats.get(c.id)!;
                  const b = balance(
                    ex.total,
                    ex.earned,
                    cp.reduce((s, p) => s + Number(p.valor), 0),
                    cp.reduce((s, p) => s + Number(p.desconto), 0),
                  );
                  const contractDetails = (
                    <>
                      {" "}
                      {admin ? (
                        <>
                          {" "}
                          <DataForm
                            kind="contratos_mao_de_obra"
                            obra={obraId}
                            record={c.id}
                            fields={[
                              {
                                name: "profissional",
                                label: "Profissional",
                                value: c.profissional,
                              },
                              {
                                name: "tipo",
                                label: "Tipo",
                                type:
                                  c.itens_ativo || c.plano_ativo || cp.length
                                    ? "hidden"
                                    : undefined,
                                options:
                                  c.itens_ativo || c.plano_ativo || cp.length
                                    ? undefined
                                    : opts(["empreitada", "diaria"]),
                                value: c.tipo,
                              },
                              {
                                ...amount("valor_geral", "Valor contratado"),
                                type:
                                  c.itens_ativo || c.plano_ativo || cp.length
                                    ? "hidden"
                                    : "number",
                                value: String(c.valor_geral / 100),
                              },
                            ]}
                          />
                          <p className="small muted">
                            Após ativar o plano ou registrar pagamentos, apenas
                            o nome pode ser alterado para preservar o histórico
                            financeiro.
                          </p>
                        </>
                      ) : (
                        <p className="small">
                          Contrato: {money(ex.total)} ·{" "}
                          {c.tipo === "empreitada"
                            ? "Empreitada"
                            : "Diária / avulso"}
                        </p>
                      )}
                      <Files
                        rows={attachments}
                        obra={obraId}
                        entity="contratos_mao_de_obra"
                        id={c.id}
                        canUpload={admin}
                      />
                    </>
                  );
                  return (
                    <section className="panel" key={c.id}>
                      {(tab === "pagamentos" ||
                        c.tipo !== "empreitada" ||
                        !c.itens_ativo) && (
                        <div className="inline justify-between">
                          <h2>{c.profissional}</h2>
                          {
                            <ActionSheet
                              label="Contrato"
                              title="Dados do contrato"
                            >
                              {contractDetails}
                            </ActionSheet>
                          }
                          <span className="badge">
                            {c.tipo === "empreitada"
                              ? "Empreitada"
                              : "Diária / avulso"}{" "}
                            · {money(ex.total)}
                          </span>
                        </div>
                      )}
                      {(tab === "pagamentos" ||
                        c.tipo !== "empreitada" ||
                        !c.itens_ativo) && (
                        <>
                          <div
                            className={
                              tab === "pagamentos"
                                ? "cards financial-cards"
                                : "cards"
                            }
                          >
                            {tab !== "pagamentos" && (
                              <Card
                                label="Executado / devido"
                                value={money(ex.earned)}
                                sub={
                                  ex.progressKnown
                                    ? ex.progress.toFixed(1) + "% do plano"
                                    : "Distribua o preço entre os serviços"
                                }
                              />
                            )}
                            <Card
                              label="Pago (líquido)"
                              value={money(
                                cp.reduce((s, p) => s + Number(p.valor), 0),
                              )}
                              sub={
                                tab === "pagamentos"
                                  ? "Devido agora: " + money(b.due)
                                  : "Adiantamento: " + money(b.advance)
                              }
                            />
                            {tab !== "pagamentos" && (
                              <Card
                                label="Devido até agora"
                                value={money(b.due)}
                                sub="Executado menos pagamentos e descontos"
                              />
                            )}
                            <Card
                              label="Saldo do contrato"
                              value={money(b.remaining)}
                              sub={
                                "Descontos pendentes: " +
                                money(
                                  cd.reduce(
                                    (s, d) =>
                                      s + Number(d.valor) - Number(d.aplicado),
                                    0,
                                  ),
                                )
                              }
                            />
                          </div>
                          {ex.progressKnown && <Progress value={ex.progress} />}
                        </>
                      )}
                      {tab === "equipe" &&
                        c.itens_ativo &&
                        contracts.length === 1 && (
                          <p className="contract-caption">{c.profissional}</p>
                        )}
                      {tab === "equipe" && c.tipo === "empreitada" && (
                        <ContractWorkboard
                          contractDetails={contractDetails}
                          obra={obraId}
                          contract={c}
                          items={ownItems}
                          payments={cp}
                          allocations={paymentAllocations.filter(
                            (a) => a.contrato_id === c.id,
                          )}
                          executions={itemExecutions.filter((e) =>
                            ownItems.some((i) => i.id === e.item_id),
                          )}
                          admin={admin}
                          aiEnabled={Boolean(
                            process.env.SAFEOBRA_OPENAI_API_KEY,
                          )}
                        />
                      )}
                      {tab === "equipe" &&
                        c.itens_ativo &&
                        ownStages.length > 0 && (
                          <ActionSheet
                            label="Plano anterior"
                            title="Plano anterior preservado"
                          >
                            {ownStages.map((stage) => (
                              <p className="small" key={stage.id}>
                                {stage.nome} · peso original {stage.peso / 100}%
                                · execução antes da adoção{" "}
                                {stage.percentual_executado}%
                              </p>
                            ))}
                          </ActionSheet>
                        )}
                      {tab === "equipe" &&
                        c.tipo === "empreitada" &&
                        !c.itens_ativo && (
                          <>
                            <h3>
                              Plano de serviços · pesos{" "}
                              {ownStages.reduce((s, x) => s + x.peso, 0) / 100}%
                            </h3>
                            {!c.plano_ativo && (
                              <p className="notice">
                                Distribua 100% do valor contratado entre os
                                serviços e ative o plano. Pesos e medições ficam
                                fixos após a ativação.
                              </p>
                            )}
                            {ownStages.map((s) => (
                              <article key={s.id} className="row items-start">
                                <div className="grow">
                                  <div className="inline justify-between">
                                    <strong>{s.nome}</strong>
                                    <span>{s.percentual_executado}%</span>
                                  </div>
                                  <p className="small muted">
                                    {s.categoria} · peso {s.peso / 100}% ·
                                    executado{" "}
                                    {money(
                                      Math.round(
                                        (c.valor_geral *
                                          s.peso *
                                          s.percentual_executado) /
                                          1000000,
                                      ),
                                    )}{" "}
                                    · falta{" "}
                                    {money(
                                      Math.round(
                                        (c.valor_geral *
                                          s.peso *
                                          (100 - s.percentual_executado)) /
                                          1000000,
                                      ),
                                    )}
                                  </p>
                                  <Progress value={s.percentual_executado} />
                                  {admin && c.plano_ativo && (
                                    <details>
                                      <summary>
                                        Registrar avanço acumulado
                                      </summary>
                                      <DataForm
                                        kind="execution"
                                        obra={obraId}
                                        fields={[
                                          {
                                            name: "servico_id",
                                            label: "Serviço",
                                            options: [
                                              { value: s.id, label: s.nome },
                                            ],
                                          },
                                          date("data", "Data"),
                                          {
                                            name: "percentual",
                                            label: "Execução acumulada (%)",
                                            type: "number",
                                            value: String(
                                              s.percentual_executado,
                                            ),
                                          },
                                          {
                                            name: "observacoes",
                                            label: "Observações",
                                            type: "textarea",
                                            optional: true,
                                          },
                                        ]}
                                      />
                                    </details>
                                  )}
                                  {admin && !c.plano_ativo && (
                                    <DeleteButton
                                      obra={obraId}
                                      entity="servicos"
                                      id={s.id}
                                    />
                                  )}
                                  {admin && (
                                    <details>
                                      <summary>Editar etapa</summary>
                                      <DataForm
                                        kind="servicos"
                                        obra={obraId}
                                        record={s.id}
                                        fields={[
                                          {
                                            name: "contrato_id",
                                            label: "Contrato",
                                            options: [
                                              {
                                                value: c.id,
                                                label: c.profissional,
                                              },
                                            ],
                                          },
                                          {
                                            name: "nome",
                                            label: "Nome",
                                            value: s.nome,
                                          },
                                          { ...category, value: s.categoria },
                                          ...measurementFields(s),
                                          {
                                            name: "peso",
                                            label: "Peso (%)",
                                            type: "number",
                                            scale: 100,
                                            value: String(s.peso / 100),
                                          },
                                          {
                                            name: "descricao",
                                            label: "Descrição",
                                            type: "textarea",
                                            optional: true,
                                            value: s.descricao,
                                          },
                                        ]}
                                      />
                                    </details>
                                  )}
                                  <details>
                                    <summary>Histórico de execução</summary>
                                    {executions
                                      .filter((e) => e.servico_id === s.id)
                                      .sort((a, b) =>
                                        a.data.localeCompare(b.data),
                                      )
                                      .map((e) => (
                                        <p key={e.id} className="small">
                                          {dateBR(e.data)} · {e.percentual}%
                                          acumulado · {e.observacoes}
                                        </p>
                                      ))}
                                  </details>
                                </div>
                              </article>
                            ))}
                            {admin && !c.plano_ativo && (
                              <>
                                <details>
                                  <summary>+ Adicionar serviço</summary>
                                  <DataForm
                                    kind="servicos"
                                    obra={obraId}
                                    fields={[
                                      {
                                        name: "contrato_id",
                                        label: "Contrato",
                                        options: [
                                          {
                                            value: c.id,
                                            label: c.profissional,
                                          },
                                        ],
                                      },
                                      {
                                        name: "nome",
                                        label: "Nome do serviço",
                                      },
                                      category,
                                      ...measurementFields(),
                                      {
                                        name: "peso",
                                        label: "Peso na empreitada (%)",
                                        type: "number",
                                        scale: 100,
                                      },
                                      {
                                        name: "descricao",
                                        label: "Descrição",
                                        type: "textarea",
                                        optional: true,
                                      },
                                    ]}
                                  />
                                </details>
                                <ActionButton
                                  label="Ativar plano de 100%"
                                  action={async () => {
                                    "use server";
                                    return activate(obraId, c.id);
                                  }}
                                />
                              </>
                            )}
                          </>
                        )}
                      {tab === "pagamentos" && (
                        <ContractPayments
                          obra={obraId}
                          contract={c}
                          payments={allPayments.filter(
                            (p) => p.contrato_id === c.id,
                          )}
                          discounts={cd}
                          services={paymentServices}
                          attachments={attachments}
                          admin={admin}
                        />
                      )}
                    </section>
                  );
                })}
              {admin && (
                <ActionSheet
                  label="Novo contrato"
                  title="Cadastrar profissional e contratação"
                >
                  <DataForm
                    kind="contratos_mao_de_obra"
                    obra={obraId}
                    fields={[
                      { name: "profissional", label: "Profissional / empresa" },
                      {
                        name: "tipo",
                        label: "Contratação",
                        options: [
                          { value: "empreitada", label: "Empreitada" },
                          { value: "diaria", label: "Diária / serviço avulso" },
                        ],
                      },
                      amount("valor_geral", "Valor contratado"),
                    ]}
                  />
                </ActionSheet>
              )}
            </>
          )}
          {tab === "diario" && (
            <>
              <div className="area-actions">
                <ActionSheet
                  label="Novo registro"
                  title="Registro e fotos da obra"
                  primary
                >
                  <ExpenseCreateForm
                    obra={obraId}
                    fields={occurrenceFields}
                    entity="ocorrencias"
                  />
                </ActionSheet>
                <ActionSheet label="Filtros" title="Filtrar diário">
                  <QueryForm>
                    <input type="hidden" name="obra" value={obraId} />
                    <input type="hidden" name="tab" value="diario" />
                    <label>
                      Data
                      <input type="date" name="dia" defaultValue={query.dia} />
                    </label>
                    <label>
                      Serviço
                      <select name="servico" defaultValue={query.servico ?? ""}>
                        <option value="">Todos</option>
                        {stageOpts.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button>Aplicar filtros</button>
                    <Link className="button secondary" href={href("diario")}>
                      Limpar filtros
                    </Link>
                  </QueryForm>
                </ActionSheet>
              </div>
              <section className="panel">
                <h2>Diário e fotos</h2>
                <RecordList
                  label="Registros do diário"
                  empty="Registre o andamento ou compartilhe fotos da obra."
                  items={occurrences
                    .filter(
                      (o) =>
                        (!query.dia || o.data === query.dia) &&
                        (!query.servico || o.servico_id === query.servico),
                    )
                    .sort(
                      (a, b) =>
                        b.data.localeCompare(a.data) ||
                        b.criado_em.localeCompare(a.criado_em),
                    )
                    .map((o) => ({
                      id: o.id,
                      title: o.titulo,
                      subtitle: `${dateBR(o.data)} · ${o.tipo}`,
                      status: o.status.replaceAll("_", " "),
                      details: (
                        <>
                          <p>{o.descricao}</p>
                          <p className="small muted">
                            Responsável: {o.responsavel || "Não atribuído"}
                          </p>
                          <div className="photo-grid">
                            {attachments
                              .filter(
                                (a) =>
                                  a.entidade === "ocorrencias" &&
                                  a.entidade_id === o.id &&
                                  a.mime.startsWith("image/"),
                              )
                              .map((a) => (
                                <Photo key={a.id} obra={obraId} id={a.id} />
                              ))}
                          </div>
                          <Files
                            rows={attachments}
                            obra={obraId}
                            entity="ocorrencias"
                            id={o.id}
                            canUpload
                          />
                        </>
                      ),
                      edit: admin ? (
                        <>
                          <DataForm
                            kind="ocorrencias-edit"
                            obra={obraId}
                            record={o.id}
                            fields={prefill(
                              [
                                ...occurrenceFields,
                                {
                                  name: "status",
                                  label: "Status",
                                  options: opts([
                                    "aberto",
                                    "em_analise",
                                    "resolvido",
                                  ]),
                                },
                              ],
                              o,
                            )}
                          />
                          <DeleteButton
                            obra={obraId}
                            entity="ocorrencias"
                            id={o.id}
                          />
                        </>
                      ) : undefined,
                    }))}
                />
              </section>
            </>
          )}
          {tab === "relatorios" && (
            <>
              <div className="inline mb-6 no-print">
                <Print />
                <Link
                  className="button secondary"
                  href={"/api/export?obra=" + obraId}
                >
                  Exportar gastos CSV / Excel
                </Link>
              </div>
              <section className="panel">
                <h2>Resumo financeiro · {obra.nome}</h2>
                <div className="cards">
                  <Card
                    label="Orçamento"
                    value={money(obra.orcamento)}
                    sub="Orçamento informado para a obra"
                  />
                  <Card
                    label="Gastos registrados"
                    value={money(total)}
                    sub={"Saldo orçamentário: " + money(obra.orcamento - total)}
                  />
                  <Card
                    label="Contratos de mão de obra"
                    value={money(
                      contracts.reduce((s, c) => s + stats.get(c.id)!.total, 0),
                    )}
                    sub="Empreitadas e diárias"
                  />
                  <Card
                    label="Pagamentos líquidos"
                    value={money(paid)}
                    sub={"Descontos quitados: " + money(applied)}
                  />
                </div>
                <p className="small muted">
                  Gastos e pagamentos são apresentados separadamente. Não some
                  pagamentos já lançados em Serviço (mão de obra) novamente ao
                  total de gastos.
                </p>
                <h3>Últimos 7 dias</h3>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Descrição</th>
                        <th>Categoria</th>
                        <th>Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expenses
                        .filter(
                          (e) =>
                            e.data_compra >=
                            new Date(
                              Date.now() - 6 * 86400000,
                            ).toLocaleDateString("en-CA", {
                              timeZone: "America/Maceio",
                            }),
                        )
                        .sort((a, b) =>
                          a.data_compra.localeCompare(b.data_compra),
                        )
                        .map((e) => (
                          <tr key={e.id}>
                            <td>{dateBR(e.data_compra)}</td>
                            <td>{e.descricao}</td>
                            <td>{e.categoria}</td>
                            <td>{money(e.valor_total)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                <h3 className="mt-6">Registros da semana</h3>
                {occurrences
                  .filter(
                    (o) =>
                      o.data >=
                      new Date(Date.now() - 6 * 86400000).toLocaleDateString(
                        "en-CA",
                        { timeZone: "America/Maceio" },
                      ),
                  )
                  .map((o) => (
                    <p key={o.id}>
                      {dateBR(o.data)} · {o.titulo} · {o.status}
                    </p>
                  ))}
              </section>
              <AuditTrail obra={obraId} />
            </>
          )}
          {tab === "estimativas" && (
            <ServiceEstimator
              obra={obraId}
              admin={admin}
              samples={[...references, ...historicalSamples]}
              references={references}
              categories={[...categories]}
              aiEnabled={Boolean(process.env.SAFEOBRA_OPENAI_API_KEY)}
              contracts={contracts}
              contractItems={contractItems.filter((i) => !i.arquivado)}
            />
          )}
          {tab === "membros" && (
            <>
              <section className="panel">
                <h2>Obras e acesso</h2>
                {admin && (
                  <ActionSheet label="Editar obra">
                    <DataForm
                      kind="obra"
                      record={obraId}
                      fields={[
                        {
                          name: "nome",
                          label: "Nome da obra",
                          value: obra.nome,
                        },
                        {
                          ...amount("orcamento", "Orçamento"),
                          value: String(obra.orcamento / 100),
                        },
                      ]}
                    />
                  </ActionSheet>
                )}
                <p className="muted">
                  ADM gerencia finanças e equipe. USER consulta os dados e
                  contribui no diário.
                </p>
                <ActionSheet label="Criar outra obra">
                  <DataForm
                    kind="obra"
                    fields={[
                      { name: "nome", label: "Nome da obra" },
                      amount("orcamento", "Orçamento"),
                    ]}
                  />
                </ActionSheet>
              </section>
              <Members obra={obraId} admin={admin} viewer={user.id} />
              {admin && (
                <ActionSheet
                  label="Convidar pessoa"
                  title="Convidar para a obra"
                  primary
                >
                  <DataForm
                    kind="invite"
                    obra={obraId}
                    title="Gerar link por 7 dias"
                    fields={[
                      {
                        name: "role",
                        label: "Perfil do convidado",
                        options: [
                          {
                            value: "user",
                            label: "USER · visualização e diário",
                          },
                          { value: "admin", label: "ADM · acesso completo" },
                        ],
                      },
                    ]}
                  />
                  <p className="small muted">
                    O link só aparece uma vez, expira em 7 dias e aceita um
                    único usuário.
                  </p>
                </ActionSheet>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
async function Members({
  obra,
  admin,
  viewer,
}: {
  obra: string;
  admin: boolean;
  viewer: string;
}) {
  const client = await db();
  const [{ data: members, error }, { data: invites, error: inviteError }] =
    await Promise.all([
      client.from("obra_membros").select("user_id,role").eq("obra_id", obra),
      admin
        ? client
            .from("convites")
            .select("id,role,expira_em,usado_em,revogado")
            .eq("obra_id", obra)
        : Promise.resolve({ data: [], error: null }),
    ]);
  if (error || inviteError) throw new Error("Falha ao carregar membros");
  return (
    <>
      <section className="panel">
        <h2>Pessoas da obra</h2>
        <RecordList
          label="Pessoas"
          items={(members ?? []).map((m) => ({
            id: m.user_id,
            title:
              m.user_id === viewer
                ? "Você"
                : `Participante · ${m.user_id.slice(0, 8)}`,
            subtitle:
              m.role === "admin" ? "Administrador" : "Visualização e diário",
            details: (
              <>
                <p>
                  {m.role === "admin"
                    ? "Pode gerenciar serviços, finanças e acessos."
                    : "Pode consultar os dados e contribuir no diário."}
                </p>
                {admin && (
                  <ActionButton
                    confirm
                    label="Remover da obra"
                    action={async () => {
                      "use server";
                      return memberAction(obra, m.user_id, "remove");
                    }}
                  />
                )}
              </>
            ),
          }))}
        />
      </section>
      {admin && (
        <section className="panel">
          <h2>Convites</h2>
          <RecordList
            label="Convites"
            empty="Nenhum convite gerado."
            items={((invites as M.Invite[]) ?? []).map((i) => ({
              id: i.id,
              title:
                i.role === "admin"
                  ? "Convite para administrador"
                  : "Convite para participante",
              subtitle: `Válido até ${dateBR(i.expira_em)}`,
              status: i.revogado
                ? "Revogado"
                : i.usado_em
                  ? "Utilizado"
                  : new Date(i.expira_em) < new Date()
                    ? "Expirado"
                    : "Pendente",
              details: (
                <>
                  <p>
                    O link é válido para uma pessoa e expira em{" "}
                    {dateBR(i.expira_em)}.
                  </p>
                  {!i.revogado && !i.usado_em && (
                    <ActionButton
                      confirm
                      label="Revogar convite"
                      action={async () => {
                        "use server";
                        return memberAction(obra, i.id, "revoke");
                      }}
                    />
                  )}
                </>
              ),
            }))}
          />
        </section>
      )}
    </>
  );
}

async function AuditTrail({ obra }: { obra: string }) {
  const c = await db();
  const { data, error } = await c
    .from("audit_logs")
    .select("id,tabela,acao,user_id,criado_em")
    .eq("obra_id", obra)
    .order("id", { ascending: false })
    .limit(50);
  if (error) throw new Error("Falha ao carregar auditoria");
  return (
    <ActionSheet label="Histórico de alterações" title="Últimas 50 alterações">
      {(data as M.Audit[])?.map((a) => (
        <p className="small" key={a.id}>
          {dateBR(a.criado_em)} · {a.acao} · {a.tabela} ·{" "}
          {a.user_id?.slice(0, 8)}
        </p>
      ))}
      {!data?.length && <p className="muted">Nenhum evento registrado.</p>}
    </ActionSheet>
  );
}

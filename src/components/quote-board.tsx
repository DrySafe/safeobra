"use client";
import {
  useState,
  useTransition,
  useOptimistic,
  type CSSProperties,
} from "react";
import { useRouter } from "next/navigation";
import { compareQuotes, type Quote, type QuoteGroup } from "@/lib/quotes";
import type { Attachment } from "@/lib/models";
import { money } from "@/lib/finance";
import { chooseQuote, signedAttachment } from "@/server/actions";
import { ActionSheet, Dialog, useCloseDialog } from "./simple-ui";
import { DataForm, Upload, type Field } from "./forms";
import { ExpenseCreateForm } from "./expense-form";
import { QueryForm, useNotice, useReading } from "./navigation";

const groupFields = (group?: QuoteGroup): Field[] => [
  { name: "nome", label: "Nome do grupo", value: group?.nome },
  {
    name: "descricao",
    label: "O que você pretende comprar ou contratar (opcional)",
    type: "textarea",
    optional: true,
    value: group?.descricao,
  },
];
const quoteFields = (group: string, quote?: Quote): Field[] => [
  { name: "grupo_id", label: "Grupo", type: "hidden", value: group },
  { name: "empresa", label: "Empresa / loja", value: quote?.empresa },
  {
    name: "itens",
    label: "Itens, quantidades e o que está incluso",
    type: "textarea",
    value: quote?.itens,
  },
  {
    name: "valor_total",
    label: "Valor total com frete e taxas (R$)",
    type: "number",
    scale: 100,
    value: quote ? String(Number(quote.valor_total) / 100) : undefined,
  },
  {
    name: "prazo",
    label: "Prazo de entrega / execução (opcional)",
    optional: true,
    value: quote?.prazo,
  },
  {
    name: "condicoes",
    label: "Condições de pagamento (opcional)",
    type: "textarea",
    optional: true,
    value: quote?.condicoes,
  },
  {
    name: "observacoes",
    label: "Observações / itens não inclusos (opcional)",
    type: "textarea",
    optional: true,
    value: quote?.observacoes,
  },
];
function NewGroup({ obra }: { obra: string }) {
  const close = useCloseDialog(),
    router = useRouter();
  return (
    <DataForm
      kind="orcamento_grupos"
      obra={obra}
      fields={groupFields()}
      title="Criar grupo"
      onSaved={(result) => {
        close?.();
        if (result.recordId)
          router.push(`/?obra=${obra}&tab=orcamentos&grupo=${result.recordId}`);
      }}
    />
  );
}
function QuoteChoice({ obra, quote }: { obra: string; quote: Quote }) {
  const [pending, start] = useTransition(),
    [error, setError] = useState("");
  const [chosen, setChosen] = useOptimistic(quote.selecionada);
  const announce = useNotice();
  useReading(pending);
  return (
    <div>
      <label className={"quote-choice" + (chosen ? " is-chosen" : "")}>
        <input
          type="checkbox"
          checked={chosen}
          disabled={pending}
          aria-label={`Escolher proposta de ${quote.empresa}`}
          onChange={(event) => {
            const selected = event.target.checked;
            setError("");
            start(async () => {
              setChosen(selected);
              try {
                const result = await chooseQuote(obra, quote.id, selected);
                if (result.ok) announce(result.message);
                else setError(result.message);
              } catch {
                setError("Não foi possível salvar a escolha. Tente novamente.");
              }
            });
          }}
        />
        <span>
          {pending ? "Salvando…" : chosen ? "Escolhida" : "Escolher proposta"}
        </span>
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
function QuoteFile({
  obra,
  file,
  index,
}: {
  obra: string;
  file: Attachment;
  index: number;
}) {
  const [pending, start] = useTransition(),
    [error, setError] = useState(""),
    [link, setLink] = useState("");
  useReading(pending);
  const label =
    (file.mime.startsWith("image/") ? "Foto " : "Documento ") + (index + 1);
  return (
    <div className="quote-file">
      <button
        type="button"
        className="secondary"
        disabled={pending}
        onClick={() => {
          // Open on the user gesture, then load the private, short-lived URL.
          const preview = window.open("about:blank", "_blank");
          if (preview) preview.opener = null;
          setError("");
          setLink("");
          start(async () => {
            try {
              const result = await signedAttachment(obra, file.id, false);
              if (!result.ok || !result.link) throw new Error(result.message);
              if (preview && !preview.closed)
                preview.location.replace(result.link);
              else setLink(result.link);
            } catch {
              preview?.close();
              setError("Não foi possível abrir o arquivo. Tente novamente.");
            }
          });
        }}
      >
        {pending ? "Abrindo…" : `${label} ↗`}
      </button>
      {link && (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          Abrir {label.toLocaleLowerCase("pt-BR")}
        </a>
      )}
      {error && (
        <p className="small" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
export function QuoteBoard({
  obra,
  groups,
  quotes,
  files,
  activeGroup,
  admin,
}: {
  obra: string;
  groups: QuoteGroup[];
  quotes: Quote[];
  files: Attachment[];
  activeGroup?: string;
  admin: boolean;
}) {
  const group = groups.find((g) => g.id === activeGroup) ?? groups[0];
  const [editing, setEditing] = useState<string | null>(null);
  const editQuote = quotes.find(
    (q) => q.id === editing && q.grupo_id === group?.id,
  );
  const comparison = compareQuotes(
    quotes.filter((q) => q.grupo_id === group?.id),
  );
  const { ordered, lowest, selectedCount, selectedTotal } = comparison;
  const proposalFiles = (id: string) =>
    files.filter(
      (f) => f.entidade === "orcamento_propostas" && f.entidade_id === id,
    );
  return (
    <section className="quote-board" aria-label="Comparar orçamentos">
      <p className="muted">
        Reúna propostas para o mesmo item e escolha uma ou mais opções em cada
        grupo.
      </p>
      <div className="quote-toolbar no-print">
        {groups.length > 0 && (
          <QueryForm autoSubmit>
            <input type="hidden" name="obra" value={obra} />
            <input type="hidden" name="tab" value="orcamentos" />
            <label>
              Grupo de orçamentos
              <select name="grupo" defaultValue={group.id} key={group.id}>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.nome}
                  </option>
                ))}
              </select>
            </label>
          </QueryForm>
        )}
        {admin && (
          <ActionSheet label="Novo grupo" primary={!groups.length}>
            <p className="muted">
              Ex.: Telhado, Piso ou Tintas. Depois, adicione as propostas
              recebidas.
            </p>
            <NewGroup obra={obra} />
          </ActionSheet>
        )}
      </div>
      {!group ? (
        <div className="panel quote-empty">
          <h2>Compare antes de escolher</h2>
          <p>
            Crie um grupo, como Telhado, e reúna os orçamentos de diferentes
            empresas.
          </p>
          {!admin && (
            <p className="muted">
              O administrador pode cadastrar os grupos e as propostas.
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="quote-group-heading">
            <div>
              <h2>
                {group.nome}{" "}
                <span className="badge">
                  {ordered.length}{" "}
                  {ordered.length === 1 ? "proposta" : "propostas"}
                </span>
              </h2>
              {group.descricao && (
                <p className="muted quote-text">{group.descricao}</p>
              )}
            </div>
            {admin && (
              <div className="quote-group-actions no-print">
                <ActionSheet
                  label="Editar grupo"
                  title={`Editar grupo · ${group.nome}`}
                >
                  <DataForm
                    kind="orcamento_grupos"
                    obra={obra}
                    record={group.id}
                    fields={groupFields(group)}
                    title="Salvar grupo"
                  />
                </ActionSheet>
                <ActionSheet
                  label="Adicionar proposta"
                  title={`Nova proposta · ${group.nome}`}
                  primary
                >
                  <ExpenseCreateForm
                    key={group.id}
                    obra={obra}
                    entity="orcamento_propostas"
                    fields={quoteFields(group.id)}
                  />
                </ActionSheet>
              </div>
            )}
          </div>
          <div className="quote-summary">
            <div>
              <span>Menor valor total</span>
              <strong>{lowest === null ? "—" : money(lowest)}</strong>
            </div>
            <div>
              <span>Escolhidas · {selectedCount}</span>
              <strong>{money(selectedTotal)}</strong>
              <small>Soma das propostas escolhidas</small>
            </div>
          </div>
          {ordered.length === 0 ? (
            <div className="panel quote-empty">
              <h3>Adicione a primeira proposta de {group.nome}</h3>
              <p className="muted">
                Informe empresa, itens e valor. Você pode anexar fotos ou
                documentos ao salvar.
              </p>
            </div>
          ) : (
            <>
              <p className="small muted">
                Do menor para o maior valor. Confira itens, quantidades, frete e
                condições antes de escolher.
              </p>
              {ordered.length > 1 && (
                <p className="quote-scroll-hint small">
                  ↔ Deslize a tabela para comparar as empresas
                </p>
              )}
              <div
                className="quote-comparison"
                role="region"
                aria-label={`Comparação de propostas de ${group.nome}`}
                tabIndex={0}
                style={{ "--quotes": ordered.length } as CSSProperties}
              >
                <table>
                  <caption className="sr-only">
                    Propostas de {group.nome}, do menor para o maior valor
                  </caption>
                  <colgroup>
                    <col className="quote-label-column" />
                    {ordered.map((q) => (
                      <col key={q.id} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr>
                      <th scope="col">Comparar</th>
                      {ordered.map((q) => (
                        <th
                          scope="col"
                          key={q.id}
                          className={q.selecionada ? "quote-chosen-column" : ""}
                        >
                          <span className="small muted">Empresa / loja</span>
                          <h3>{q.empresa}</h3>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="quote-prices">
                      <th scope="row">Valor total</th>
                      {ordered.map((q) => (
                        <td
                          key={q.id}
                          className={q.selecionada ? "quote-chosen-column" : ""}
                        >
                          <strong>{money(Number(q.valor_total))}</strong>
                          <span
                            className={
                              Number(q.valor_total) === lowest
                                ? "badge"
                                : "small muted"
                            }
                          >
                            {Number(q.valor_total) === lowest
                              ? "Menor preço"
                              : `+ ${money(Number(q.valor_total) - lowest!)} sobre o menor`}
                          </span>
                        </td>
                      ))}
                    </tr>
                    {(
                      [
                        ["itens", "Itens inclusos"],
                        ["prazo", "Prazo"],
                        ["condicoes", "Pagamento"],
                        ["observacoes", "Observações"],
                      ] as const
                    ).map(([field, label]) => (
                      <tr key={field}>
                        <th scope="row">{label}</th>
                        {ordered.map((q) => (
                          <td
                            key={q.id}
                            className={
                              q.selecionada ? "quote-chosen-column" : ""
                            }
                          >
                            <span className="quote-text">
                              {q[field] || "Não informado"}
                            </span>
                          </td>
                        ))}
                      </tr>
                    ))}
                    <tr>
                      <th scope="row">Fotos e documentos</th>
                      {ordered.map((q) => (
                        <td
                          key={q.id}
                          className={q.selecionada ? "quote-chosen-column" : ""}
                        >
                          <div className="quote-files">
                            {proposalFiles(q.id).length ? (
                              proposalFiles(q.id).map((f, i) => (
                                <QuoteFile
                                  key={f.id}
                                  obra={obra}
                                  file={f}
                                  index={i}
                                />
                              ))
                            ) : (
                              <span className="small muted">Sem anexos</span>
                            )}
                          </div>
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <th scope="row">Sua escolha</th>
                      {ordered.map((q) => (
                        <td
                          key={q.id}
                          className={q.selecionada ? "quote-chosen-column" : ""}
                        >
                          {admin ? (
                            <QuoteChoice obra={obra} quote={q} />
                          ) : (
                            <span className={q.selecionada ? "badge" : "muted"}>
                              {q.selecionada ? "Escolhida" : "Não escolhida"}
                            </span>
                          )}
                        </td>
                      ))}
                    </tr>
                    {admin && (
                      <tr className="no-print">
                        <th scope="row">Atualizar</th>
                        {ordered.map((q) => (
                          <td
                            key={q.id}
                            className={
                              q.selecionada ? "quote-chosen-column" : ""
                            }
                          >
                            <button
                              type="button"
                              className="secondary"
                              aria-label={`Editar proposta de ${q.empresa}`}
                              onClick={() => setEditing(q.id)}
                            >
                              Editar / anexar
                            </button>
                          </td>
                        ))}
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <p className="small muted">
            Escolher uma proposta não lança uma despesa nem registra um
            pagamento.
          </p>
        </>
      )}
      <Dialog
        open={Boolean(editQuote)}
        title={`Editar proposta · ${editQuote?.empresa ?? ""}`}
        onClose={() => setEditing(null)}
      >
        {editQuote && (
          <>
            <DataForm
              kind="orcamento_propostas"
              obra={obra}
              record={editQuote.id}
              fields={quoteFields(editQuote.grupo_id, editQuote)}
              title="Salvar proposta"
            />
            <section className="record-files">
              <h3>Fotos e documentos · {proposalFiles(editQuote.id).length}</h3>
              <div className="quote-files">
                {proposalFiles(editQuote.id).map((f, i) => (
                  <QuoteFile key={f.id} obra={obra} file={f} index={i} />
                ))}
              </div>
              <Upload
                obra={obra}
                entity="orcamento_propostas"
                id={editQuote.id}
              />
            </section>
          </>
        )}
      </Dialog>
    </section>
  );
}

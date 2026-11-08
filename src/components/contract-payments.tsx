import type { Attachment, Contract, Discount, Payment } from "@/lib/models";
import { money, dateBR } from "@/lib/finance";
import { DataForm, ActionButton, type Field } from "./forms";
import { ActionSheet, RecordList } from "./simple-ui";
import { RecordFiles } from "./record-files";
import { cancelPayment } from "@/server/actions";
const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Maceio" }).format(
    new Date(),
  );
export function ContractPayments({
  obra,
  contract,
  payments,
  discounts,
  services,
  attachments,
  admin,
}: {
  obra: string;
  contract: Contract;
  payments: Payment[];
  discounts: Discount[];
  services: { id: string; nome: string }[];
  attachments: Attachment[];
  admin: boolean;
}) {
  function fields(p?: Payment): Field[] {
    return [
      {
        name: "contrato_id",
        label: "Contrato",
        type: "hidden",
        value: contract.id,
      },
      {
        name: "modo",
        label: "Pagamento",
        options: [
          { value: "semanal", label: "Semanal / adiantamento" },
          { value: "servico", label: "Por serviço" },
        ],
        value: p?.modo,
      },
      {
        name: "servico_id",
        label: "Serviço (opcional)",
        options: services.map((s) => ({ value: s.id, label: s.nome })),
        optional: true,
        value: p?.item_id ?? p?.servico_id ?? "",
      },
      { name: "data", label: "Data", type: "date", value: p?.data ?? today() },
      {
        name: "valor_bruto",
        label: "Valor bruto a quitar (R$)",
        type: "number",
        scale: 100,
        value: p ? String(Number(p.valor_bruto) / 100) : "",
      },
      {
        name: "referencia",
        label: "Referência / semana",
        value: p?.referencia,
      },
      {
        name: "forma_pagamento",
        label: "Forma de pagamento",
        options: [
          ...new Set([
            "Pix",
            "Dinheiro",
            "Transferência",
            ...(p?.forma_pagamento ? [p.forma_pagamento] : []),
          ]),
        ].map((value) => ({
          value,
          label: value,
        })),
        value: p?.forma_pagamento,
      },
      {
        name: "final",
        label: "Fechamento final: incluir descontos finais",
        type: "checkbox",
        optional: true,
      },
    ];
  }
  function discountFields(d?: Discount): Field[] {
    return [
      {
        name: "contrato_id",
        label: "Contrato",
        type: "hidden",
        value: contract.id,
      },
      {
        name: "descricao",
        label: "Descrição do desconto",
        value: d?.descricao,
      },
      {
        name: "valor",
        label: "Valor total do desconto (R$)",
        type: "number",
        scale: 100,
        value: d ? String(Number(d.valor) / 100) : "",
      },
      {
        name: "aplicacao",
        label: "Fechamento de destino",
        value: d?.aplicacao,
        options: [
          { value: "semanal", label: "Próximo fechamento semanal" },
          { value: "final", label: "Fechamento final" },
        ],
      },
    ];
  }
  return (
    <div className="contract-payments">
      <div className="section-title">
        <h3>Pagamentos</h3>
        {admin && (
          <ActionSheet
            label="Registrar pagamento"
            title="Pagamento ou adiantamento"
            primary
          >
            <p className="small muted">
              Descontos pendentes são aplicados ao bruto. O excedente fica para
              o próximo fechamento.
            </p>
            <DataForm
              kind="payment"
              obra={obra}
              fields={fields()}
              title="Registrar pagamento"
            />
          </ActionSheet>
        )}
      </div>
      <RecordList
        label="Pagamentos"
        items={[...payments]
          .sort(
            (a, b) =>
              b.data.localeCompare(a.data) ||
              b.criado_em.localeCompare(a.criado_em),
          )
          .map((p) => ({
            id: p.id,
            title: p.referencia,
            subtitle: `${dateBR(p.data)} · ${p.forma_pagamento}`,
            amount: money(Number(p.valor)),
            status: p.anulado
              ? "Estornado"
              : p.item_id || p.servico_id
                ? (services.find((s) => s.id === (p.item_id ?? p.servico_id))
                    ?.nome ?? "Vinculado a serviço")
                : "Pagamento do contrato",
            details: (
              <>
                <dl className="detail-values">
                  <div>
                    <dt>Bruto quitado</dt>
                    <dd>{money(Number(p.valor_bruto))}</dd>
                  </div>
                  <div>
                    <dt>Descontos</dt>
                    <dd>{money(Number(p.desconto))}</dd>
                  </div>
                  <div>
                    <dt>Pago líquido</dt>
                    <dd>{money(Number(p.valor))}</dd>
                  </div>
                </dl>
                <RecordFiles
                  rows={attachments}
                  obra={obra}
                  entity="pagamentos"
                  id={p.id}
                  canUpload={admin && !p.anulado}
                />
                {admin && !p.anulado && (
                  <ActionButton
                    confirm
                    label="Estornar pagamento"
                    action={async () => {
                      "use server";
                      return cancelPayment(obra, p.id);
                    }}
                  />
                )}
              </>
            ),
            edit:
              admin && !p.anulado ? (
                <DataForm
                  kind="payment"
                  obra={obra}
                  record={p.id}
                  fields={fields(p)}
                  title="Corrigir pagamento"
                />
              ) : undefined,
          }))}
      />
      <div className="section-title">
        <h3>Descontos do profissional</h3>
        {admin && (
          <ActionSheet label="Adicionar desconto">
            <DataForm
              kind="descontos_profissional"
              obra={obra}
              fields={discountFields()}
            />
          </ActionSheet>
        )}
      </div>
      <RecordList
        label="Descontos"
        items={discounts.map((d) => ({
          id: d.id,
          title: d.descricao,
          subtitle:
            d.aplicacao === "final"
              ? "Fechamento final"
              : "Próximo fechamento semanal",
          amount: money(Number(d.valor)),
          status: `Pendente: ${money(Number(d.valor) - Number(d.aplicado))}`,
          details: (
            <>
              <dl className="detail-values">
                <div>
                  <dt>Fechamento de destino</dt>
                  <dd>
                    {d.aplicacao === "final"
                      ? "Fechamento final"
                      : "Próximo fechamento semanal"}
                  </dd>
                </div>
                <div>
                  <dt>Valor</dt>
                  <dd>{money(Number(d.valor))}</dd>
                </div>
                <div>
                  <dt>Já aplicado</dt>
                  <dd>{money(Number(d.aplicado))}</dd>
                </div>
                <div>
                  <dt>Pendente</dt>
                  <dd>{money(Number(d.valor) - Number(d.aplicado))}</dd>
                </div>
              </dl>
              <RecordFiles
                rows={attachments}
                obra={obra}
                entity="descontos_profissional"
                id={d.id}
                canUpload={admin}
              />
            </>
          ),
          edit: admin ? (
            <>
              <p className="small muted">
                Já aplicado: {money(Number(d.aplicado))}. O valor total não pode
                ser menor que esse valor. A mudança de fechamento vale para o
                saldo pendente.
              </p>
              <DataForm
                kind="descontos_profissional"
                obra={obra}
                record={d.id}
                fields={discountFields(d)}
                title="Salvar desconto"
              />
            </>
          ) : undefined,
        }))}
      />
    </div>
  );
}

"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import * as S from "@/lib/schemas";
import * as A from "@/server/actions";
export type Field = {
  name: string;
  label: string;
  type?: string;
  options?: { value: string; label: string }[];
  optional?: boolean;
  scale?: number;
  value?: string;
};
export function Theme() {
  return (
    <button
      className="theme-toggle"
      aria-label="Alternar tema"
      onClick={() => {
        const el = document.documentElement;
        el.dataset.theme = el.dataset.theme === "dark" ? "light" : "dark";
      }}
    >
      ◐
    </button>
  );
}
function schema(kind: string) {
  switch (kind) {
    case "obra":
      return S.obraSchema;
    case "login":
    case "signup":
      return S.loginSchema;
    case "gastos":
      return S.expenseSchema;
    case "contratos_mao_de_obra":
      return S.contractSchema;
    case "servicos":
      return S.stageSchema;
    case "descontos_profissional":
      return S.discountSchema;
    case "ocorrencias":
      return S.occurrenceSchema;
    case "ocorrencias-edit":
      return S.occurrenceSchema.extend({
        status: z.enum(["aberto", "em_analise", "resolvido"]),
      });
    case "execution":
      return S.executionSchema;
    case "payment":
      return S.paymentSchema.safeExtend({ final: z.boolean() });
    case "invite":
      return S.inviteSchema;
    default:
      throw new Error("Formulário inválido");
  }
}
export function DataForm({
  kind,
  obra = "",
  fields,
  title = "Salvar",
  record,
}: {
  kind: string;
  obra?: string;
  fields: Field[];
  title?: string;
  record?: string;
}) {
  const [result, setResult] = useState<A.Result>();
  const [pending, start] = useTransition();
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  return (
    <form
      ref={ref}
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        const raw: Record<string, unknown> = {};
        for (const f of fields) {
          const v = form.get(f.name);
          raw[f.name] =
            f.type === "checkbox"
              ? v === "on"
              : f.scale
                ? Math.round(Number(String(v).replace(",", ".")) * f.scale)
                : v === "" && ["data_entrega", "servico_id"].includes(f.name)
                  ? null
                  : v;
        }
        const parsed = schema(kind).safeParse(raw);
        if (!parsed.success) {
          setResult({
            ok: false,
            message: parsed.error.issues.map((i) => i.message).join("; "),
          });
          return;
        }
        start(async () => {
          let res: A.Result;
          try {
            if (kind === "obra") res = await A.createObra(parsed.data, record);
            else if (kind === "login" || kind === "signup")
              res = await A.authAction(kind, parsed.data);
            else if (kind === "invite") res = await A.invite(obra, parsed.data);
            else if (kind === "execution")
              res = await A.recordExecution(obra, parsed.data);
            else if (kind === "payment")
              res = await A.recordPayment(obra, parsed.data, record);
            else if (record)
              res = await A.updateRecord(
                obra,
                kind.replace("-edit", ""),
                record,
                parsed.data,
              );
            else res = await A.createRecord(obra, kind, parsed.data);
            setResult(res);
            if (res.ok) {
              if (kind === "login") router.push("/");
              else {
                ref.current?.reset();
                router.refresh();
              }
            }
          } catch {
            setResult({
              ok: false,
              message: "Não foi possível conectar. Tente novamente.",
            });
          }
        });
      }}
    >
      <div className="form-grid">
        {fields.map((f) => (
          <label key={f.name}>
            {f.label}
            {f.options ? (
              <select
                name={f.name}
                defaultValue={f.value ?? ""}
                required={!f.optional}
              >
                {f.optional && <option value="">Nenhum</option>}
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : f.type === "textarea" ? (
              <textarea
                name={f.name}
                defaultValue={f.value ?? ""}
                maxLength={2000}
              />
            ) : (
              <input
                name={f.name}
                type={f.type ?? "text"}
                defaultValue={f.value ?? ""}
                required={!f.optional && f.type !== "checkbox"}
                step={f.type === "number" ? "any" : undefined}
                min={f.type === "number" ? 0 : undefined}
                maxLength={f.type === "password" ? 128 : 300}
                autoComplete={
                  f.type === "password"
                    ? kind === "signup"
                      ? "new-password"
                      : "current-password"
                    : f.type === "email"
                      ? "email"
                      : undefined
                }
              />
            )}
          </label>
        ))}
      </div>
      <div>
        <button disabled={pending}>{pending ? "Salvando…" : title}</button>
      </div>
      {result && (
        <div role="status" className={"notice " + (!result.ok ? "error" : "")}>
          {result.message}
          {result.link && (
            <p>
              <a className="underline" href={result.link}>
                {result.link}
              </a>
            </p>
          )}
        </div>
      )}
    </form>
  );
}
export function ActionButton({
  label,
  action,
  confirm = false,
}: {
  label: string;
  action: () => Promise<A.Result>;
  confirm?: boolean;
}) {
  const [result, setResult] = useState<A.Result>();
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <span>
      <button
        className="secondary"
        disabled={pending}
        onClick={() => {
          if (confirm && !window.confirm("Confirma esta operação?")) return;
          start(async () => {
            try {
              const r = await action();
              setResult(r);
              if (r.ok) router.refresh();
            } catch {
              setResult({ ok: false, message: "Falha de conexão" });
            }
          });
        }}
      >
        {pending ? "Aguarde…" : label}
      </button>
      {result && (
        <span role="status" className="small">
          {" "}
          {result.message}{" "}
          {result.link && (
            <a href={result.link} className="underline">
              Abrir
            </a>
          )}
        </span>
      )}
    </span>
  );
}
export function DeleteButton({
  obra,
  entity,
  id,
}: {
  obra: string;
  entity: string;
  id: string;
}) {
  return (
    <ActionButton
      label="Excluir"
      confirm
      action={() => A.removeRecord(obra, entity, id)}
    />
  );
}
export function Attachment({ obra, id }: { obra: string; id: string }) {
  return (
    <ActionButton
      label="Baixar anexo ↗"
      action={() => A.signedAttachment(obra, id)}
    />
  );
}
export function Upload({
  obra,
  entity,
  id,
}: {
  obra: string;
  entity: string;
  id: string;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <form
      className="no-print"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        const files = form.getAll("files");
        for (const file of files) {
          if (
            !(file instanceof File) ||
            !file.size ||
            file.size > S.MAX_UPLOAD ||
            !S.allowedMime.includes(file.type)
          ) {
            setMessage(
              "Selecione JPG, PNG, WEBP, HEIC, PDF ou XML de até 4 MB.",
            );
            return;
          }
        }
        setBusy(true);
        try {
          for (const file of files) {
            const body = new FormData();
            body.set("obra", obra);
            body.set("entity", entity);
            body.set("entityId", id);
            body.set("file", file);
            const res = await fetch("/api/upload", { method: "POST", body });
            if (!res.ok)
              throw new Error(
                "Falha no envio; confira o formato, tamanho e limite da hospedagem.",
              );
          }
          setMessage("Anexos enviados");
          router.refresh();
        } catch (e) {
          setMessage(e instanceof Error ? e.message : "Falha no envio");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Fotos ou documentos
        <input
          type="file"
          name="files"
          multiple
          required
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,application/xml,text/xml"
        />
      </label>
      <label>
        Foto pela câmera
        <input
          type="file"
          name="camera"
          capture="environment"
          accept="image/jpeg,image/png,image/webp"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) {
              const form = e.target.form;
              const target = form?.elements.namedItem(
                "files",
              ) as HTMLInputElement | null;
              if (target) {
                const dt = new DataTransfer();
                dt.items.add(f);
                target.files = dt.files;
              }
            }
          }}
        />
      </label>
      <button className="secondary" disabled={busy}>
        {busy ? "Enviando…" : "Enviar anexos"}
      </button>
      <span role="status">{message}</span>
    </form>
  );
}
export function Print() {
  return (
    <button className="secondary" onClick={() => window.print()}>
      Imprimir / PDF
    </button>
  );
}
export function LoginForm() {
  const [signup, setSignup] = useState(false);
  return (
    <>
      <DataForm
        key={String(signup)}
        kind={signup ? "signup" : "login"}
        title={signup ? "Criar minha conta" : "Entrar"}
        fields={[
          { name: "email", label: "E-mail", type: "email" },
          {
            name: "password",
            label: "Senha (mínimo 10 caracteres)",
            type: "password",
          },
        ]}
      />
      <button className="secondary" onClick={() => setSignup(!signup)}>
        {signup ? "Já tenho conta" : "Criar conta"}
      </button>
    </>
  );
}

export function Photo({ obra, id }: { obra: string; id: string }) {
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState("");
  return (
    <div>
      {url ? (
        <img
          src={url}
          alt="Foto do andamento da obra"
          loading="lazy"
          style={{ maxWidth: "100%", maxHeight: 320, borderRadius: 10 }}
          onError={() => {
            setUrl("");
            setMessage("Link expirado. Abra a foto novamente.");
          }}
        />
      ) : (
        <button
          className="secondary"
          onClick={async () => {
            const r = await A.signedAttachment(obra, id, false);
            if (r.ok && r.link) setUrl(r.link);
            else setMessage(r.message);
          }}
        >
          Ver foto
        </button>
      )}
      <span role="status">{message}</span>
    </div>
  );
}

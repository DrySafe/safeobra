"use client";
import { useRef, useState, useTransition, useId, type ReactNode } from "react";
import { useCloseDialog } from "./simple-ui";
import { useRememberedForm } from "./dialog-drafts";
import { PasswordInput } from "./password-input";
import { AppLink, useNotice, useReading, useRefresh } from "./navigation";
import { useRouter } from "next/navigation";
import { z } from "zod";
import * as S from "@/lib/schemas";
import * as A from "@/server/actions";
export type Field = {
  name: string;
  label: string;
  type?: string;
  options?: { value: string; label: string }[];
  suggestions?: string[];
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
        const dark = el.dataset.theme
          ? el.dataset.theme === "dark"
          : window.matchMedia("(prefers-color-scheme: dark)").matches;
        el.dataset.theme = dark ? "light" : "dark";
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
    case "referencias_servicos":
      return S.serviceReferenceSchema;
    case "gastos":
      return S.expenseSchema;
    case "contratos_mao_de_obra":
      return S.contractSchema;
    case "servicos":
      return S.stageSchema;
    case "descontos_profissional":
      return S.discountSchema;
    case "descontos_profissional-edit":
      return S.discountEditSchema;
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
  children,
  onSaved,
}: {
  kind: string;
  obra?: string;
  fields: Field[];
  title?: string;
  record?: string;
  children?: ReactNode;
  onSaved?: (result: A.Result) => void | Promise<void>;
}) {
  const [result, setResult] = useState<A.Result>();
  const [pending, start] = useTransition();
  useReading(pending);
  const ref = useRef<HTMLFormElement>(null);
  const draft = useRememberedForm(
    JSON.stringify([
      kind,
      obra,
      record ?? "new",
      fields
        .filter((f) => f.type === "hidden" || f.name === "servico_id")
        .map((f) => [f.name, f.value ?? ""]),
    ]),
  );
  const formId = useId();
  const router = useRouter();
  const close = useCloseDialog(),
    announce = useNotice();
  return (
    <form
      method="post"
      ref={(form) => {
        ref.current = form;
        draft.restore(form);
      }}
      onChangeCapture={draft.remember}
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
              draft.clear();
              await onSaved?.(res);
              if (!res.link && kind !== "login" && kind !== "signup") {
                announce(res.message);
                if (!onSaved) close?.();
              }
              if (kind === "login") router.push("/");
              else if (
                !record &&
                res.recordId &&
                kind === "contratos_mao_de_obra"
              )
                router.push(
                  `/?obra=${obra}&tab=equipe&contrato=${res.recordId}`,
                );
              else if (!record && res.recordId && kind === "obra")
                router.push(`/?obra=${res.recordId}`);
              else {
                ref.current?.reset();
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
          <div className="field" key={f.name} hidden={f.type === "hidden"}>
            <label htmlFor={formId + f.name}>{f.label}</label>
            {f.options ? (
              <select
                id={formId + f.name}
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
            ) : f.type === "password" ? (
              <PasswordInput
                id={formId + f.name}
                name={f.name}
                defaultValue={f.value}
                autoComplete={
                  kind === "signup" ? "new-password" : "current-password"
                }
                required={!f.optional}
              />
            ) : f.type === "textarea" ? (
              <textarea
                id={formId + f.name}
                name={f.name}
                defaultValue={f.value ?? ""}
                maxLength={2000}
              />
            ) : (
              <input
                id={formId + f.name}
                name={f.name}
                type={f.type ?? "text"}
                list={
                  f.suggestions ? formId + f.name + "-suggestions" : undefined
                }
                placeholder={
                  f.suggestions ? "Escolha ou digite uma categoria" : undefined
                }
                defaultValue={f.type === "checkbox" ? "on" : (f.value ?? "")}
                required={!f.optional && f.type !== "checkbox"}
                step={f.type === "number" ? "any" : undefined}
                min={f.type === "number" ? 0 : undefined}
                maxLength={300}
                autoComplete={f.type === "email" ? "email" : undefined}
              />
            )}
            {f.suggestions && (
              <datalist id={formId + f.name + "-suggestions"}>
                {f.suggestions.map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
            )}
          </div>
        ))}
      </div>
      {children}
      <div>
        <button type="submit" disabled={pending}>
          {pending ? "Salvando…" : title}
        </button>
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
  useReading(pending);
  const close = useCloseDialog(),
    announce = useNotice();
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
              if (r.ok && !r.link) {
                announce(r.message);
                close?.();
              }
              // Server mutations already return the revalidated RSC tree.
              // Signed URL reads must not refresh every dataset.
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
  useReading(busy);
  const refresh = useRefresh();
  const draft = useRememberedForm(`upload:${obra}:${entity}:${id}`);
  return (
    <form
      method="post"
      className="no-print"
      ref={draft.restore}
      onChangeCapture={draft.remember}
      onSubmit={async (e) => {
        e.preventDefault();
        const element = e.currentTarget;
        const form = new FormData(element);
        const files = form.getAll("files");
        for (const file of files) {
          if (
            !(file instanceof File) ||
            !file.size ||
            file.size > S.MAX_UPLOAD ||
            (file.type && !S.allowedMime.includes(file.type))
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
          draft.clear();
          element.reset();
          refresh();
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
export function LoginForm({ signup = false }: { signup?: boolean }) {
  return (
    <div className="auth-screen" data-mode={signup ? "signup" : "login"}>
      <header className="auth-intro">
        <span className="auth-mode-badge">
          {signup ? "Primeiro acesso" : "Já sou cadastrado"}
        </span>
        <h1>{signup ? "Crie sua conta" : "Entrar na sua conta"}</h1>
        <p className="muted">
          {signup
            ? "Cadastre seu e-mail e escolha uma senha para começar a acompanhar sua obra."
            : "Acesse com o e-mail e a senha que você já cadastrou."}
        </p>
      </header>
      <section
        className="panel auth-card auth-actions"
        aria-label={signup ? "Cadastro de usuário" : "Acesso à conta"}
      >
        {signup && (
          <ol className="auth-flow" aria-label="Etapas do cadastro">
            <li aria-current="step">
              <span>1</span> Cadastro
            </li>
            <li>
              <span>2</span> Confirmação por e-mail
            </li>
          </ol>
        )}
        <DataForm
          key={String(signup)}
          kind={signup ? "signup" : "login"}
          title={signup ? "Criar minha conta" : "Entrar"}
          fields={[
            {
              name: "email",
              label: signup ? "Seu e-mail" : "E-mail cadastrado",
              type: "email",
            },
            {
              name: "password",
              label: signup
                ? "Crie uma senha (mínimo 6 caracteres)"
                : "Senha (mínimo 6 caracteres)",
              type: "password",
            },
          ]}
        />
        <p className="small muted auth-help">
          {signup
            ? "Após criar sua conta, abra o link enviado ao seu e-mail para confirmar o cadastro."
            : "Use seu e-mail já confirmado para acessar a obra."}
        </p>
      </section>
      <div className="auth-alternative">
        <p>
          {signup
            ? "Já tem uma conta no SafeObra?"
            : "É a sua primeira vez aqui?"}
        </p>
        <AppLink
          href={signup ? "/login" : "/cadastro"}
          className="button secondary auth-switch"
        >
          {signup ? "Já tenho conta" : "Criar conta"}
        </AppLink>
      </div>
    </div>
  );
}

export function Photo({ obra, id }: { obra: string; id: string }) {
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  useReading(loading);
  return (
    <div>
      {url ? (
        <img
          src={url}
          alt="Foto do andamento da obra"
          loading="eager"
          onLoad={() => setLoading(false)}
          style={{ maxWidth: "100%", maxHeight: 320, borderRadius: 10 }}
          onError={() => {
            setLoading(false);
            setUrl("");
            setMessage("Link expirado. Abra a foto novamente.");
          }}
        />
      ) : (
        <button
          className="secondary"
          disabled={loading}
          onClick={async () => {
            setLoading(true);
            setMessage("");
            try {
              const r = await A.signedAttachment(obra, id, false);
              if (r.ok && r.link) setUrl(r.link);
              else {
                setMessage(r.message);
                setLoading(false);
              }
            } catch {
              setMessage("Não foi possível carregar a foto. Tente novamente.");
              setLoading(false);
            }
          }}
        >
          Ver foto
        </button>
      )}
      <span role="status">{message}</span>
    </div>
  );
}

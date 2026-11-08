"use client";
import { useCloseDialog } from "./simple-ui";
import { useRef, useState } from "react";
import { DataForm, type Field } from "./forms";
import { useNotice, useReading, useRefresh } from "./navigation";
import { MAX_UPLOAD, allowedMime } from "@/lib/schemas";
export function ExpenseCreateForm({
  obra,
  fields,
  entity = "gastos",
}: {
  obra: string;
  fields: Field[];
  entity?: "gastos" | "ocorrencias";
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [savedId, setSavedId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const queue = useRef<File[]>([]);
  const refresh = useRefresh();
  const close = useCloseDialog();
  const announce = useNotice();
  useReading(busy);
  async function upload(id: string) {
    setBusy(true);
    setMessage("Enviando arquivos…");
    try {
      while (queue.current.length) {
        const body = new FormData();
        body.set("obra", obra);
        body.set("entity", entity);
        body.set("entityId", id);
        body.set("file", queue.current[0]);
        const response = await fetch("/api/upload", { method: "POST", body });
        if (!response.ok)
          throw new Error(
            "O registro foi salvo, mas um arquivo não foi enviado. Tente enviar novamente.",
          );
        queue.current.shift();
      }
      setMessage("Registro salvo e arquivos enviados.");
      announce("Registro salvo e arquivos enviados.");
      refresh();
      close?.();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível enviar o arquivo.",
      );
      refresh();
    } finally {
      setBusy(false);
    }
  }
  if (savedId)
    return (
      <div className="receipt-box">
        <p role="status">{message}</p>
        {queue.current.length > 0 ? (
          <div className="field">
            <p className="small muted">
              O gasto já está salvo. Reenvie apenas as notas pendentes, sem
              registrar outro gasto.
            </p>
            <label>
              Substituir notas pendentes
              <input
                type="file"
                multiple
                disabled={busy}
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,application/xml,text/xml"
                onChange={(event) => {
                  const selected = Array.from(event.target.files ?? []);
                  if (
                    !selected.length ||
                    selected.some(
                      (file) =>
                        !file.size ||
                        file.size > MAX_UPLOAD ||
                        (file.type && !allowedMime.includes(file.type)),
                    )
                  ) {
                    setMessage(
                      "Escolha fotos, PDF ou XML de até 4 MB por arquivo.",
                    );
                    event.target.value = "";
                    return;
                  }
                  queue.current = selected;
                  setMessage("Novas notas selecionadas. Clique em reenviar.");
                }}
              />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => upload(savedId)}
            >
              {busy ? "Enviando…" : "Reenviar notas pendentes"}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                queue.current = [];
                setSavedId(undefined);
                setFiles([]);
                setMessage("");
              }}
            >
              Enviar depois
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => {
              setSavedId(undefined);
              setFiles([]);
              setMessage("");
            }}
          >
            Adicionar outro gasto
          </button>
        )}
      </div>
    );
  return (
    <DataForm
      kind={entity}
      obra={obra}
      fields={fields}
      title={files.length ? "Salvar e enviar arquivos" : "Salvar registro"}
      onSaved={async (result) => {
        if (files.length && result.recordId) {
          queue.current = [...files];
          setSavedId(result.recordId);
          await upload(result.recordId);
        } else setFiles([]);
        if (queue.current.length === 0) close?.();
      }}
    >
      <div className="receipt-picker">
        <label>
          Notas fiscais e comprovantes (opcional)
          <input
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,application/xml,text/xml"
            onChange={(event) => {
              const selected = Array.from(event.target.files ?? []);
              if (
                selected.some(
                  (file) =>
                    !file.size ||
                    file.size > MAX_UPLOAD ||
                    (file.type && !allowedMime.includes(file.type)),
                )
              ) {
                setMessage(
                  "Escolha fotos, PDF ou XML de até 4 MB por arquivo.",
                );
                setFiles([]);
                event.target.value = "";
                return;
              }
              setFiles(selected);
              setMessage(
                selected.length
                  ? `${selected.length} arquivo(s) serão enviados ao salvar o gasto.`
                  : "",
              );
            }}
          />
        </label>
        <p className="small muted">
          Foto da câmera ou galeria, PDF ou XML. Até 4 MB por arquivo.
        </p>
        {message && <p role="status">{message}</p>}
      </div>
    </DataForm>
  );
}

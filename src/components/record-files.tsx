import { Attachment, Upload } from "./forms";
import type { Attachment as FileRow } from "@/lib/models";
export function RecordFiles({
  rows,
  obra,
  entity,
  id,
  canUpload = false,
}: {
  rows: FileRow[];
  obra: string;
  entity: string;
  id: string;
  canUpload?: boolean;
}) {
  const files = rows.filter(
    (a) => a.entidade_id === id && a.entidade === entity,
  );
  return (
    <section className="record-files no-print">
      <h3>
        {entity === "gastos" ? "Notas fiscais e comprovantes" : "Arquivos"} ·{" "}
        {files.length}
      </h3>
      <div className="attachments">
        {files.map((a) => (
          <Attachment key={a.id} obra={obra} id={a.id} />
        ))}
      </div>
      {canUpload && <Upload obra={obra} entity={entity} id={id} />}
    </section>
  );
}

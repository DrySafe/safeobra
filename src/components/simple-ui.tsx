"use client";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { DialogDraftsContext } from "./dialog-drafts";
export function searchKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}
const CloseContext = createContext<(() => void) | null>(null);
export const useCloseDialog = () => useContext(CloseContext);
export function Dialog({
  open,
  title,
  onClose,
  onBack,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onBack?: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    label = useId();
  const drafts = useRef(new Map<string, { current: unknown }>());
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [open]);
  useEffect(() => {
    if (open)
      ref.current
        ?.querySelector<HTMLElement>("h2")
        ?.focus({ preventScroll: true });
  }, [open, title]);
  return (
    <dialog
      ref={ref}
      className="app-dialog"
      aria-labelledby={label}
      onCancel={(event) => {
        event.preventDefault();
        close.current();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          close.current();
      }}
    >
      <DialogDraftsContext.Provider value={drafts.current}>
        {open && (
          <CloseContext.Provider value={onClose}>
            <header className="dialog-heading">
              {onBack && (
                <button type="button" className="secondary" onClick={onBack}>
                  ← Voltar
                </button>
              )}
              <h2 id={label} tabIndex={-1}>
                {title}
              </h2>
              <button
                type="button"
                className="secondary dialog-close"
                aria-label="Fechar painel"
                onClick={onClose}
              >
                Fechar ✕
              </button>
            </header>
            <div className="dialog-content">{children}</div>
          </CloseContext.Provider>
        )}
      </DialogDraftsContext.Provider>
    </dialog>
  );
}
export function ActionSheet({
  label,
  title = label,
  children,
  primary = false,
}: {
  label: string;
  title?: string;
  children: ReactNode;
  primary?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={primary ? "" : "secondary"}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
      <Dialog open={open} title={title} onClose={() => setOpen(false)}>
        {children}
      </Dialog>
    </>
  );
}
export type CompactRecord = {
  id: string;
  title: string;
  subtitle?: string;
  amount?: string;
  status?: string;
  details: ReactNode;
  edit?: ReactNode;
};
export function RecordList({
  items,
  label,
  empty = "Nenhum registro encontrado.",
  pageSize = 6,
}: {
  items: CompactRecord[];
  label: string;
  empty?: string;
  pageSize?: number;
}) {
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(0),
    [selection, setSelection] = useState<string | null>(null),
    [editing, setEditing] = useState(false);
  const filtered = items.filter((i) =>
    searchKey(`${i.title} ${i.subtitle ?? ""} ${i.status ?? ""}`).includes(
      searchKey(search),
    ),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize)),
    current = Math.min(page, pages - 1),
    shown = filtered.slice(current * pageSize, (current + 1) * pageSize),
    selected = items.find((i) => i.id === selection);
  function close() {
    setSelection(null);
    setEditing(false);
  }
  return (
    <section className="record-list" aria-label={label}>
      {items.length > 6 && (
        <label className="list-search">
          Buscar {label.toLocaleLowerCase("pt-BR")}
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Digite para encontrar"
          />
        </label>
      )}
      <div className="compact-list">
        {shown.map((item) => (
          <button
            type="button"
            key={item.id}
            className="record-card"
            onClick={() => {
              setSelection(item.id);
              setEditing(false);
            }}
            aria-label={`Abrir ${item.title}`}
          >
            <span className="record-main">
              <strong>{item.title}</strong>
              {item.subtitle && <span className="muted">{item.subtitle}</span>}
              {item.status && (
                <span className="record-status">{item.status}</span>
              )}
            </span>
            <span className="record-end">
              {item.amount && <strong>{item.amount}</strong>}
              <span aria-hidden="true">›</span>
            </span>
          </button>
        ))}
      </div>
      {!shown.length && <p className="empty">{empty}</p>}
      <ListPagination
        page={current}
        pages={pages}
        total={filtered.length}
        pageSize={pageSize}
        onPage={setPage}
      />
      <Dialog
        open={Boolean(selected)}
        title={
          editing ? `Editar ${selected?.title}` : (selected?.title ?? label)
        }
        onClose={close}
        onBack={editing ? () => setEditing(false) : undefined}
      >
        {selected &&
          (editing ? (
            selected.edit
          ) : (
            <>
              {selected.details}
              {selected.edit && (
                <div className="dialog-actions">
                  <button type="button" onClick={() => setEditing(true)}>
                    Editar
                  </button>
                </div>
              )}
            </>
          ))}
      </Dialog>
    </section>
  );
}
export function ListPagination({
  page,
  pages,
  total,
  pageSize,
  onPage,
}: {
  page: number;
  pages: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
}) {
  if (total <= pageSize)
    return total ? (
      <p className="small muted list-count">{total} registro(s)</p>
    ) : null;
  return (
    <nav className="list-pagination" aria-label="Páginas da lista">
      <button
        type="button"
        className="secondary"
        disabled={page === 0}
        onClick={() => onPage(page - 1)}
      >
        ← Anterior
      </button>
      <span className="small">
        {page * pageSize + 1}–{Math.min(total, (page + 1) * pageSize)} de{" "}
        {total}
        <br />
        Página {page + 1} de {pages}
      </span>
      <button
        type="button"
        className="secondary"
        disabled={page + 1 >= pages}
        onClick={() => onPage(page + 1)}
      >
        Próxima →
      </button>
    </nav>
  );
}

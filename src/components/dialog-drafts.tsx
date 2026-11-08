"use client";
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type FormEvent,
  type SetStateAction,
} from "react";

// Drafts live only in the current dialog's memory, never in browser storage.
export const DialogDraftsContext = createContext<Map<
  string,
  { current: unknown }
> | null>(null);

export function useDialogDraftRef<T>(key: string, initial: T): { current: T } {
  const cache = useContext(DialogDraftsContext);
  const local = useRef(initial);
  if (!cache) return local;
  if (!cache.has(key)) cache.set(key, local);
  return cache.get(key) as { current: T };
}

export function useDialogDraftState<T>(key: string, initial: T) {
  const draft = useDialogDraftRef("state:" + key, initial);
  const [value, update] = useState(draft.current);
  const setValue = useCallback(
    (next: SetStateAction<T>) => {
      draft.current =
        typeof next === "function"
          ? (next as (previous: T) => T)(draft.current)
          : next;
      update(draft.current);
    },
    [draft],
  );
  return [value, setValue] as const;
}

type Entry = {
  name: string;
  type: string;
  index: number;
  value: string;
  checked?: boolean;
  selected?: string[];
  files?: File[];
};
function controls(form: HTMLFormElement) {
  return Array.from(form.elements).filter(
    (
      element,
    ): element is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
      (element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement) &&
      !!element.name &&
      !["hidden", "password", "submit", "button"].includes(element.type),
  );
}

export function useRememberedForm(key: string) {
  const enabled = useContext(DialogDraftsContext) !== null;
  const draft = useDialogDraftRef<Entry[] | null>("form:" + key, null);
  const remember = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      if (!enabled) return;
      draft.current = controls(event.currentTarget).map((element, index) => ({
        name: element.name,
        type: element.type,
        index,
        value: element.type === "file" ? "" : element.value,
        ...(element instanceof HTMLInputElement
          ? {
              checked: element.checked,
              ...(element.type === "file"
                ? { files: Array.from(element.files ?? []) }
                : {}),
            }
          : {}),
        ...(element instanceof HTMLSelectElement && element.multiple
          ? {
              selected: Array.from(element.selectedOptions).map(
                (option) => option.value,
              ),
            }
          : {}),
      }));
    },
    [draft, enabled],
  );
  const restore = useCallback(
    (form: HTMLFormElement | null) => {
      if (!form || !enabled || !draft.current) return;
      const fields = controls(form);
      for (const saved of draft.current) {
        const element = fields[saved.index];
        if (
          !element ||
          element.name !== saved.name ||
          element.type !== saved.type
        )
          continue;
        if (element instanceof HTMLInputElement && element.type === "file") {
          const data = new DataTransfer();
          for (const file of saved.files ?? []) data.items.add(file);
          element.files = data.files;
        } else if (
          element instanceof HTMLInputElement &&
          ["checkbox", "radio"].includes(element.type)
        )
          element.checked = Boolean(saved.checked);
        else if (element instanceof HTMLSelectElement && element.multiple)
          for (const option of element.options)
            option.selected = saved.selected?.includes(option.value) ?? false;
        else if (element.value !== saved.value) element.value = saved.value;
      }
    },
    [draft, enabled],
  );
  const clear = useCallback(() => {
    draft.current = null;
  }, [draft]);
  return { remember, restore, clear };
}

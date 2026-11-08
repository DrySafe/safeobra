"use client";
import Link from "next/link";
import { useCloseDialog } from "./simple-ui";
import { useRememberedForm } from "./dialog-drafts";
import { mainSections, sectionFor } from "@/lib/app-navigation";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
  type ComponentProps,
} from "react";
const ReadingContext = createContext<{
  begin: () => () => void;
  navigate: (href: string) => void;
  refresh: () => void;
  announce: (message: string) => void;
}>({
  begin: () => () => {},
  navigate: () => {},
  refresh: () => {},
  announce: () => {},
});
export function LoadingBar() {
  return (
    <div className="reading-bar" role="status" aria-live="polite">
      <span className="sr-only">Carregando dados…</span>
      <span className="reading-bar-fill" />
    </div>
  );
}
export function ReadingProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [reads, setReads] = useState(0);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(""), 5000);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  const [pending, start] = useTransition();
  const begin = useCallback(() => {
    let ended = false;
    setReads((n) => n + 1);
    return () => {
      if (!ended) {
        ended = true;
        setReads((n) => Math.max(0, n - 1));
      }
    };
  }, []);
  const navigate = useCallback(
    (href: string) => start(() => router.push(href)),
    [router],
  );
  const refresh = useCallback(() => start(() => router.refresh()), [router]);
  return (
    <ReadingContext.Provider
      value={{ begin, navigate, refresh, announce: setNotice }}
    >
      {(pending || reads > 0) && <LoadingBar />}
      {children}
      {notice && (
        <div className="app-toast" role="status">
          {notice}
          <button
            type="button"
            className="secondary"
            aria-label="Fechar aviso"
            onClick={() => setNotice("")}
          >
            ✕
          </button>
        </div>
      )}
    </ReadingContext.Provider>
  );
}
export function useNotice() {
  return useContext(ReadingContext).announce;
}
export function useRefresh() {
  return useContext(ReadingContext).refresh;
}
export function useReading(active: boolean) {
  const { begin } = useContext(ReadingContext);
  useEffect(() => {
    if (active) return begin();
  }, [active, begin]);
}
export function AppLink({
  href,
  onNavigate,
  ...props
}: ComponentProps<typeof Link>) {
  const { navigate } = useContext(ReadingContext);
  return (
    <Link
      {...props}
      href={href}
      prefetch={props.prefetch ?? false}
      onNavigate={(event) => {
        let canceled = false;
        onNavigate?.({
          preventDefault: () => {
            canceled = true;
            event.preventDefault();
          },
        });
        if (canceled) return;
        if (
          typeof href === "string" &&
          href.startsWith("/") &&
          !href.startsWith("/api/")
        ) {
          event.preventDefault();
          navigate(href);
        }
      }}
    />
  );
}
export function QueryForm({
  children,
  className,
  autoSubmit = false,
}: {
  children: ReactNode;
  className?: string;
  autoSubmit?: boolean;
}) {
  const { navigate } = useContext(ReadingContext);
  const close = useCloseDialog();
  const draft = useRememberedForm("query");
  return (
    <form
      action="/"
      className={className}
      ref={draft.restore}
      onChangeCapture={draft.remember}
      onChange={
        autoSubmit ? (event) => event.currentTarget.requestSubmit() : undefined
      }
      onSubmit={(event) => {
        event.preventDefault();
        const params = new URLSearchParams();
        new FormData(event.currentTarget).forEach((value, key) => {
          if (typeof value === "string" && value) params.append(key, value);
        });
        navigate("/?" + params.toString());
        draft.clear();
        close?.();
      }}
    >
      {children}
    </form>
  );
}
export function MobileMenu({ tab, obra }: { tab: string; obra: string }) {
  return (
    <nav
      className="bottom-navigation no-print"
      aria-label="Navegação principal"
    >
      {mainSections.map(([key, icon, label]) => (
        <AppLink
          key={key}
          href={`/?obra=${obra}&tab=${key}`}
          className={
            sectionFor(tab) === key ? "bottom-link active" : "bottom-link"
          }
          aria-current={sectionFor(tab) === key ? "page" : undefined}
        >
          <span aria-hidden="true">{icon}</span>
          {label}
        </AppLink>
      ))}
    </nav>
  );
}

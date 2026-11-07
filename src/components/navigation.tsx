"use client";
import Link from "next/link";
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
}>({ begin: () => () => {}, navigate: () => {}, refresh: () => {} });
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
    <ReadingContext.Provider value={{ begin, navigate, refresh }}>
      {(pending || reads > 0) && <LoadingBar />}
      {children}
    </ReadingContext.Provider>
  );
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
}: {
  children: ReactNode;
  className?: string;
}) {
  const { navigate } = useContext(ReadingContext);
  return (
    <form
      action="/"
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        const params = new URLSearchParams();
        new FormData(event.currentTarget).forEach((value, key) => {
          if (typeof value === "string" && value) params.append(key, value);
        });
        navigate("/?" + params.toString());
      }}
    >
      {children}
    </form>
  );
}
export function MobileMenu({
  tabs,
  tab,
  obra,
  obraNome,
  children,
}: {
  children?: ReactNode;
  tabs: string[][];
  tab: string;
  obra: string;
  obraNome: string;
}) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLElement>(null);
  const { navigate } = useContext(ReadingContext);
  useEffect(() => {
    setOpen(false);
  }, [tab, obra]);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector("a")?.focus();
    const wide = window.matchMedia("(min-width:768px)");
    const resize = () => {
      if (wide.matches) setOpen(false);
    };
    wide.addEventListener("change", resize);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", key);
      wide.removeEventListener("change", resize);
    };
  }, [open]);
  return (
    <div className="mobile-navigation no-print">
      <div className="mobile-brand">
        <span className="mark">S</span>
        <div>
          <strong>SafeObra</strong>
          <span>{obraNome}</span>
        </div>
      </div>
      <button
        ref={toggle}
        type="button"
        className="secondary menu-toggle"
        aria-label={open ? "Fechar menu" : "Abrir menu"}
        aria-expanded={open}
        aria-controls="mobile-menu"
        onClick={() => setOpen(!open)}
      >
        {open ? "✕" : "☰"}
      </button>
      {open && (
        <>
          <button
            className="menu-backdrop"
            aria-label="Fechar navegação"
            onClick={() => setOpen(false)}
          />
          <nav
            ref={menu}
            id="mobile-menu"
            className="mobile-menu"
            aria-label="Menu principal"
          >
            <div className="eyebrow">Sua obra</div>
            {tabs.map(([key, icon, label]) => (
              <Link
                key={key}
                prefetch={false}
                className={"nav-link " + (tab === key ? "active" : "")}
                aria-current={tab === key ? "page" : undefined}
                href={`/?obra=${obra}&tab=${key}`}
                onNavigate={(event) => {
                  event.preventDefault();
                  setOpen(false);
                  navigate(`/?obra=${obra}&tab=${key}`);
                }}
              >
                <span aria-hidden="true">{icon}</span>
                {label}
              </Link>
            ))}
            <p className="small muted">Selecione a obra no cabeçalho abaixo.</p>
            <div className="mobile-menu-account">{children}</div>
          </nav>
        </>
      )}
    </div>
  );
}

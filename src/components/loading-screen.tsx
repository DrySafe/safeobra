export function LoadingScreen({
  title = "Carregando sua obra",
}: {
  title?: string;
}) {
  return (
    <div
      className="route-loading no-print"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="route-loading-card">
        <div className="route-loading-symbol" aria-hidden="true">
          <svg className="route-loading-ring" viewBox="0 0 80 80" fill="none">
            <circle
              cx="40"
              cy="40"
              r="36"
              className="route-loading-ring-track"
            />
            <circle cx="40" cy="40" r="36" className="route-loading-ring-tip" />
          </svg>
          <svg className="route-loading-home" viewBox="0 0 32 32" fill="none">
            <path d="m5 14 11-9 11 9M8 12v15h16V12M13 27V17h6v10" />
          </svg>
        </div>
        <span className="route-loading-brand">SafeObra</span>
        <h2>{title}</h2>
        <p>Só um instante. Estamos preparando tudo para você.</p>
        <div className="route-loading-progress" aria-hidden="true">
          <span />
        </div>
      </div>
    </div>
  );
}

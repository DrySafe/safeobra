import { LoadingBar } from "@/components/navigation";
export default function Loading() {
  return (
    <main role="status" aria-live="polite">
      <LoadingBar />
      <p>Carregando sua obra…</p>
    </main>
  );
}

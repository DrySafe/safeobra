"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main>
      <h1>Não foi possível carregar</h1>
      <p>Verifique sua conexão e a configuração do Supabase.</p>
      <button onClick={reset}>Tentar novamente</button>
    </main>
  );
}

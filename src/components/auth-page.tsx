import { LoginForm } from "./forms";

export function AuthPage({ signup = false }: { signup?: boolean }) {
  return (
    <main className="auth">
      <div className="logo">
        <span className="mark">S</span>SafeObra
      </div>
      <LoginForm signup={signup} />
      <p className="small muted auth-privacy">
        Seus dados são compartilhados apenas com os membros de cada obra.
      </p>
    </main>
  );
}

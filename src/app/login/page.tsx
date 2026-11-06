import { LoginForm } from "@/components/forms";
export default function Login() {
  return (
    <main className="auth">
      <div className="logo">
        <span className="mark">S</span>SafeObra
      </div>
      <span className="eyebrow">Do projeto à conquista</span>
      <h1>Sua obra, sob controle.</h1>
      <p className="muted">
        Acompanhe custos, pagamentos e cada etapa da sua construção.
      </p>
      <section className="panel">
        <LoginForm />
      </section>
      <p className="small muted">
        Confirme seu e-mail antes de entrar. Seus dados são compartilhados
        apenas com os membros de cada obra.
      </p>
    </main>
  );
}

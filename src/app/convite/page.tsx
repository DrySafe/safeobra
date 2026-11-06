import { acceptInvite } from "@/server/actions";
import { ActionButton } from "@/components/forms";
import Link from "next/link";
import { db } from "@/lib/supabase/server";
export default async function Invite({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const c = await db();
  const {
    data: { user },
  } = await c.auth.getUser();
  return (
    <main className="auth">
      <h1>Convite para a obra</h1>
      <p>
        Entre com sua conta e aceite o convite. O perfil é definido pelo
        administrador da obra.
      </p>
      {!token || !/^[a-f0-9]{64}$/.test(token) ? (
        <p>Convite inválido.</p>
      ) : user ? (
        <ActionButton
          label="Aceitar convite"
          action={async () => {
            "use server";
            return acceptInvite(token);
          }}
        />
      ) : (
        <>
          <Link className="button" href="/login">
            Entrar ou criar conta
          </Link>
          <p>
            Depois de confirmar seu e-mail, abra este link de convite novamente.
          </p>
        </>
      )}
    </main>
  );
}

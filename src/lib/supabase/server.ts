import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
export async function db() {
  const store = await cookies();
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Configure o Supabase em .env.local");
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(values) {
        try {
          values.forEach(({ name, value, options }) =>
            store.set(name, value, options),
          );
        } catch {
          // Server Components não gravam cookies; proxy renova a sessão.
        }
      },
    },
  });
}

import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { db } from "@/lib/supabase/server";
import { id } from "@/lib/schemas";
// React cache is request-scoped; no sessions are shared between users.
export const session = cache(async function session() {
  const client = await db();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) redirect("/login");
  return { client, user };
});
export async function access(obra: string, admin = false) {
  id.parse(obra);
  const { client, user } = await session();
  const { data, error } = await client
    .from("obra_membros")
    .select("role")
    .eq("obra_id", obra)
    .eq("user_id", user.id)
    .single();
  if (error || !data || (admin && data.role !== "admin"))
    throw new Error("Sem permissão para esta operação");
  return { client, user, role: data.role as "admin" | "user" };
}

import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";
export async function rate(scope: string, identity: string, limit = 20) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY,
    salt = process.env.RATE_LIMIT_SALT;
  if (!url || !key || !salt)
    throw new Error("Proteção de requisições não configurada");
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const bucket = createHmac("sha256", salt)
    .update(scope + ":" + identity)
    .digest("hex");
  const { data, error } = await client.rpc("consume_rate", {
    p_bucket: bucket,
    p_limit: limit,
  });
  if (error || data !== true)
    throw new Error("Limite de tentativas atingido. Aguarde um minuto.");
}

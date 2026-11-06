import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fileTypeFromBuffer } from "file-type";
import { randomUUID } from "node:crypto";
import { access, session } from "@/server/access";
import { rate } from "@/server/rate";
import { uploadSchema, MAX_UPLOAD, allowedMime, id } from "@/lib/schemas";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    if (
      !process.env.APP_URL ||
      request.headers.get("origin") !== new URL(process.env.APP_URL).origin
    )
      return NextResponse.json({ error: "Origem inválida" }, { status: 403 });
    const current = await session();
    await rate("upload", current.user.id, 15);
    // Bound the body while reading, rather than trusting Content-Length.
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Arquivo ausente");
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > MAX_UPLOAD + 65536) {
        await reader.cancel();
        return NextResponse.json({ error: "Limite de 4 MB" }, { status: 413 });
      }
      chunks.push(part.value);
    }
    const buffer = Buffer.concat(chunks);
    const form = await new Response(buffer, {
      headers: { "Content-Type": request.headers.get("content-type") ?? "" },
    }).formData();
    const obra = id.parse(form.get("obra"));
    const data = uploadSchema.parse({
      entity: form.get("entity"),
      entityId: form.get("entityId"),
    });
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > MAX_UPLOAD)
      throw new Error("Arquivo inválido ou maior que 4 MB");
    const { client } = await access(obra, data.entity !== "ocorrencias");
    const { data: allowed, error: permissionError } = await client.rpc(
      "can_attach",
      { p_obra: obra, p_entity: data.entity, p_id: data.entityId },
    );
    if (permissionError || !allowed) throw new Error("Registro inválido");
    const bytes = Buffer.from(await file.arrayBuffer());
    const type = await fileTypeFromBuffer(bytes);
    let mime = type?.mime;
    if (!mime) {
      const text = new TextDecoder("utf-8", { fatal: true })
        .decode(bytes)
        .trim();
      if (!text.startsWith("<?xml") || /<!DOCTYPE|<!ENTITY/i.test(text))
        throw new Error("Tipo de arquivo não reconhecido");
      mime = "application/xml";
    }
    if (!allowedMime.includes(mime)) throw new Error("Formato não permitido");
    const attachment = randomUUID();
    const path = `${obra}/${data.entity}/${data.entityId}/${attachment}`;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw new Error("Storage não configurado");
    // Service role is indispensable here: browsers cannot bypass byte validation with direct Storage writes.
    const storage = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    }).storage.from("obra-anexos");
    const { error: uploadError } = await storage.upload(path, bytes, {
      contentType: mime,
      upsert: false,
    });
    if (uploadError) throw new Error("Falha ao enviar arquivo");
    const { error } = await client.from("anexos").insert({
      id: attachment,
      obra_id: obra,
      entidade: data.entity,
      entidade_id: data.entityId,
      path,
      mime,
      tamanho: file.size,
    });
    if (error) {
      await storage.remove([path]);
      throw new Error("Falha ao registrar anexo");
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      {
        error:
          "Não foi possível enviar. Verifique formato, tamanho e permissões.",
      },
      { status: 400 },
    );
  }
}

"use server";
import { randomBytes, createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/supabase/server";
import { access, session } from "./access";
import { rate } from "./rate";
import * as S from "@/lib/schemas";
import { authErrorMessage, type AuthFailure } from "@/lib/auth-errors";
export type Result = {
  ok: boolean;
  message: string;
  link?: string;
  recordId?: string;
};
const fail = (error: unknown): Result => ({
  ok: false,
  message:
    error instanceof z.ZodError
      ? error.issues.map((x) => x.message).join("; ")
      : error instanceof Error
        ? error.message
        : "Não foi possível concluir a operação",
});
// Log only safe diagnostic fields; no email, password, token or provider message.
function logAuthFailure(operation: "signup" | "login", error: AuthFailure) {
  const code =
    typeof error.code === "string" && /^[a-z0-9_]+$/i.test(error.code)
      ? error.code
      : "unknown";
  console.warn("[auth] request failed", {
    operation,
    code,
    status: error.status,
  });
}
export async function authAction(kind: string, raw: unknown): Promise<Result> {
  try {
    const data = S.loginSchema.parse(raw);
    const h = await headers();
    // Vercel overwrites this header. Outside Vercel all clients share a safe global bucket.
    const ip = process.env.VERCEL
      ? (h.get("x-vercel-forwarded-for") ?? "global")
      : "global";
    await rate("auth-ip", ip, 20);
    await rate("auth-email", data.email.toLowerCase(), 8);
    const client = await db();
    if (kind === "signup") {
      const url = z.url().parse(process.env.APP_URL);
      const { error } = await client.auth.signUp({
        ...data,
        options: { emailRedirectTo: url + "/auth/callback" },
      });
      if (error) {
        logAuthFailure("signup", error);
        return { ok: false, message: authErrorMessage("signup", error) };
      }
      return {
        ok: true,
        message: "Confira seu e-mail para confirmar o cadastro.",
      };
    }
    if (kind !== "login") throw new Error("Operação inválida");
    const { error } = await client.auth.signInWithPassword(data);
    if (error) {
      logAuthFailure("login", error);
      return { ok: false, message: authErrorMessage("login", error) };
    }
    return { ok: true, message: "Acesso autorizado" };
  } catch (e) {
    return fail(e);
  }
}
export async function logout() {
  const c = await db();
  await c.auth.signOut();
  redirect("/login");
}
export async function createObra(
  raw: unknown,
  record?: string,
): Promise<Result> {
  try {
    const data = S.obraSchema.parse(raw);
    const { client } = record
      ? await access(S.id.parse(record), true)
      : await session();
    const { error } = record
      ? await client.from("obras").update(data).eq("id", record)
      : await client.from("obras").insert(data);
    if (error) throw new Error("Não foi possível criar a obra");
    revalidatePath("/");
    return { ok: true, message: record ? "Obra atualizada" : "Obra criada" };
  } catch (e) {
    return fail(e);
  }
}
const schemas = {
  gastos: S.expenseSchema,
  contratos_mao_de_obra: S.contractSchema,
  servicos: S.stageSchema,
  descontos_profissional: S.discountSchema,
  ocorrencias: S.occurrenceSchema,
  referencias_servicos: S.serviceReferenceSchema,
};
export async function createRecord(
  obra: string,
  entity: string,
  raw: unknown,
): Promise<Result> {
  try {
    const { client, user } = await access(obra, entity !== "ocorrencias");
    if (!(entity in schemas)) throw new Error("Módulo inválido");
    const data = schemas[entity as keyof typeof schemas].parse(raw);
    await rate("create", user.id, 40);
    const { error, data: saved } = await client
      .from(entity)
      .insert({ ...data, obra_id: obra })
      .select("id")
      .single();
    if (error)
      throw new Error("Falha ao salvar. Confira os dados e vínculos da obra.");
    revalidatePath("/");
    return { ok: true, message: "Registro salvo", recordId: saved?.id };
  } catch (e) {
    return fail(e);
  }
}
export async function updateRecord(
  obra: string,
  entity: string,
  record: string,
  raw: unknown,
): Promise<Result> {
  try {
    const { client } = await access(obra, true);
    S.id.parse(record);
    let data: Record<string, unknown>;
    if (entity === "gastos") data = S.expenseSchema.parse(raw);
    else if (entity === "contratos_mao_de_obra")
      data = S.contractSchema.parse(raw);
    else if (entity === "servicos") {
      const parsed = S.stageSchema.parse(raw);
      const { contrato_id: _, ...changes } = parsed;
      data = changes;
    } else if (entity === "ocorrencias")
      data = S.occurrenceSchema
        .extend({ status: z.enum(["aberto", "em_analise", "resolvido"]) })
        .parse(raw);
    else throw new Error("Edição indisponível neste módulo");
    const { error, data: rows } = await client
      .from(entity)
      .update(data)
      .eq("obra_id", obra)
      .eq("id", record)
      .select("id");
    if (error || !rows?.length) throw new Error("Não foi possível editar");
    revalidatePath("/");
    return { ok: true, message: "Registro atualizado" };
  } catch (e) {
    return fail(e);
  }
}
export async function removeRecord(
  obra: string,
  entity: string,
  record: string,
): Promise<Result> {
  try {
    const { client } = await access(obra, true);
    S.id.parse(record);
    if (
      !["gastos", "servicos", "ocorrencias", "referencias_servicos"].includes(
        entity,
      )
    )
      throw new Error("Exclusão indisponível");
    const { error, data } = await client
      .from(entity)
      .delete()
      .eq("obra_id", obra)
      .eq("id", record)
      .select("id");
    if (error || !data?.length)
      throw new Error("Registro possui vínculos ou não pode ser excluído");
    revalidatePath("/");
    return { ok: true, message: "Registro excluído" };
  } catch (e) {
    return fail(e);
  }
}
export async function invite(obra: string, raw: unknown): Promise<Result> {
  try {
    const data = S.inviteSchema.parse(raw);
    const { client, user } = await access(obra, true);
    await rate("invite", user.id, 10);
    const token = randomBytes(32).toString("hex");
    const { error } = await client.from("convites").insert({
      obra_id: obra,
      role: data.role,
      token_hash: createHash("sha256").update(token).digest("hex"),
    });
    if (error) throw new Error("Não foi possível gerar o convite");
    const base = z.url().parse(process.env.APP_URL);
    revalidatePath("/");
    return {
      ok: true,
      message: "Copie o link agora; ele não será exibido novamente.",
      link: base + "/convite?token=" + token,
    };
  } catch (e) {
    return fail(e);
  }
}
export async function acceptInvite(token: string): Promise<Result> {
  try {
    z.string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(token);
    const { client, user } = await session();
    await rate("accept", user.id, 10);
    const { data, error } = await client.rpc("accept_invite", {
      p_token: token,
    });
    if (error)
      throw new Error(
        "Convite inválido, expirado ou utilizado. Confirme seu e-mail.",
      );
    revalidatePath("/");
    return { ok: true, message: "Você entrou na obra", link: "/?obra=" + data };
  } catch (e) {
    return fail(e);
  }
}
export async function memberAction(
  obra: string,
  target: string,
  kind: string,
): Promise<Result> {
  try {
    S.id.parse(target);
    const { client } = await access(obra, true);
    let error;
    if (kind === "revoke")
      ({ error } = await client
        .from("convites")
        .update({ revogado: true })
        .eq("id", target)
        .eq("obra_id", obra));
    else if (kind === "remove")
      ({ error } = await client.rpc("remove_member", {
        p_obra: obra,
        p_user: target,
      }));
    else throw new Error("Operação inválida");
    if (error)
      throw new Error("Não foi possível alterar; mantenha ao menos um ADM.");
    revalidatePath("/");
    return { ok: true, message: "Atualizado" };
  } catch (e) {
    return fail(e);
  }
}
export async function activate(
  obra: string,
  contract: string,
): Promise<Result> {
  try {
    S.id.parse(contract);
    const { client } = await access(obra, true);
    const { data: found } = await client
      .from("contratos_mao_de_obra")
      .select("id")
      .eq("obra_id", obra)
      .eq("id", contract)
      .single();
    if (!found) throw new Error("Contrato inválido");
    const { error } = await client.rpc("activate_plan", {
      p_contrato: contract,
    });
    if (error) throw new Error("Os pesos devem somar 100% para ativar o plano");
    revalidatePath("/");
    return { ok: true, message: "Plano ativado; pesos fixados" };
  } catch (e) {
    return fail(e);
  }
}
export async function recordExecution(
  obra: string,
  raw: unknown,
): Promise<Result> {
  try {
    const d = S.executionSchema.parse(raw);
    const { client } = await access(obra, true);
    const { data: s } = await client
      .from("servicos")
      .select("id")
      .eq("id", d.servico_id)
      .eq("obra_id", obra)
      .single();
    if (!s) throw new Error("Serviço inválido");
    const { error } = await client.rpc("record_execution", {
      p_servico: d.servico_id,
      p_data: d.data,
      p_percentual: d.percentual,
      p_observacoes: d.observacoes,
    });
    if (error)
      throw new Error(
        "Ative o plano e informe um percentual acumulado maior ou igual ao atual",
      );
    revalidatePath("/");
    return { ok: true, message: "Execução registrada" };
  } catch (e) {
    return fail(e);
  }
}
export async function recordPayment(
  obra: string,
  raw: unknown,
  record?: string,
): Promise<Result> {
  try {
    const d = S.paymentSchema.safeExtend({ final: z.boolean() }).parse(raw);
    const { client, user } = await access(obra, true);
    await rate("payment", user.id, 20);
    const { data: c } = await client
      .from("contratos_mao_de_obra")
      .select("id")
      .eq("id", d.contrato_id)
      .eq("obra_id", obra)
      .single();
    if (!c) throw new Error("Contrato inválido");
    if (record) S.id.parse(record);
    const { error } = await client.rpc(
      record ? "revise_payment" : "record_payment",
      {
        ...(record ? { p_id: record } : { p_contrato: d.contrato_id }),
        p_servico: d.servico_id,
        p_data: d.data,
        p_bruto: d.valor_bruto,
        p_referencia: d.referencia,
        p_forma: d.forma_pagamento,
        p_modo: d.modo,
        p_final: d.final,
      },
    );
    if (error)
      throw new Error("Pagamento inválido ou maior que o saldo da empreitada");
    revalidatePath("/");
    return {
      ok: true,
      message: "Pagamento registrado com descontos e saldo atualizados",
    };
  } catch (e) {
    return fail(e);
  }
}
export async function signedAttachment(
  obra: string,
  record: string,
  download = true,
): Promise<Result> {
  try {
    S.id.parse(record);
    const { client } = await access(obra);
    const { data } = await client
      .from("anexos")
      .select("path")
      .eq("obra_id", obra)
      .eq("id", record)
      .single();
    if (!data) throw new Error("Anexo não encontrado");
    const { data: url, error } = await client.storage
      .from("obra-anexos")
      .createSignedUrl(data.path, 60, { download });
    if (error) throw new Error("Não foi possível abrir o arquivo");
    return {
      ok: true,
      message: "Link válido por 60 segundos",
      link: url.signedUrl,
    };
  } catch (e) {
    return fail(e);
  }
}

export async function cancelPayment(
  obra: string,
  record: string,
): Promise<Result> {
  try {
    S.id.parse(record);
    const { client } = await access(obra, true);
    const { data: p } = await client
      .from("pagamentos")
      .select("id")
      .eq("id", record)
      .eq("obra_id", obra)
      .single();
    if (!p) throw new Error("Pagamento inválido");
    const { error } = await client.rpc("cancel_payment", { p_id: record });
    if (error) throw new Error("Não foi possível estornar");
    revalidatePath("/");
    return {
      ok: true,
      message: "Pagamento estornado; descontos e saldo restaurados",
    };
  } catch (e) {
    return fail(e);
  }
}

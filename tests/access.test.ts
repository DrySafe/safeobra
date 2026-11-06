/** Real PostgreSQL, isolated synthetic Auth/Storage schemas; no production connection. */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import EmbeddedPostgres from "embedded-postgres";
const server = new EmbeddedPostgres({
  databaseDir: "/tmp/safeobra-pg-" + randomBytes(6).toString("hex"),
  user: "postgres",
  password: randomBytes(24).toString("hex"),
  port: 55439,
  persistent: false,
  autoRehydrateSymlinks: true,
  onLog: () => {},
  onError: () => {},
});
await server.initialise();
await server.start();
const client = server.getPgClient();
await client.connect();
after(async () => {
  await client.end();
  await server.stop();
});
await client.query(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema storage; create schema extensions;
create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema public,auth,storage to anon,authenticated,service_role;
grant execute on function auth.uid() to anon,authenticated,service_role;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
grant select,insert,update,delete on storage.objects to authenticated;
`);
await client.query(
  await readFile(
    new URL("../supabase/migrations/202611060001_base.sql", import.meta.url),
    "utf8",
  ),
);
const admin = "00000000-0000-4000-8000-000000000001",
  user = "00000000-0000-4000-8000-000000000002",
  outsider = "00000000-0000-4000-8000-000000000003";
const obra = "10000000-0000-4000-8000-000000000001";
await client.query(
  `insert into auth.users values($1,now()),($2,now()),($3,now());`,
  [admin, user, outsider],
);
await client.query(
  `insert into public.obras(id,nome,criado_por) values($1,'Obra teste',$2)`,
  [obra, admin],
);
await client.query(
  `insert into public.obra_membros(obra_id,user_id,role) values($1,$2,'user')`,
  [obra, user],
);
async function asUser<T>(uid: string, fn: () => Promise<T>) {
  await client.query("begin");
  try {
    await client.query("select set_config('request.jwt.claim.sub',$1,true)", [
      uid,
    ]);
    await client.query("set local role authenticated");
    return await fn();
  } finally {
    await client.query("rollback");
  }
}
const expense = `insert into public.gastos(obra_id,categoria,descricao,fornecedor,quantidade,valor_unitario,data_compra,forma_pagamento,status_entrega) values($1,'Extras','Cimento','Loja',2,2500,current_date,'Pix','pendente') returning id,valor_total`;
test("ADM insere gasto e total é calculado no banco", async () =>
  asUser(admin, async () => {
    const { rows } = await client.query(expense, [obra]);
    assert.equal(Number(rows[0].valor_total), 5000);
    assert.equal(
      (await client.query("select count(*) from public.audit_logs")).rows[0]
        .count,
      "1",
    );
  }));
test("USER lê obra mas não insere gasto", async () =>
  asUser(user, async () => {
    assert.equal(
      (await client.query("select * from public.obras")).rowCount,
      1,
    );
    await assert.rejects(client.query(expense, [obra]), /row-level security/);
  }));
test("não membro não enxerga obra nem dados financeiros", async () =>
  asUser(outsider, async () => {
    assert.equal(
      (await client.query("select * from public.obras")).rowCount,
      0,
    );
    assert.equal(
      (await client.query("select * from public.gastos")).rowCount,
      0,
    );
  }));
test("USER cria ocorrência e não altera status", async () =>
  asUser(user, async () => {
    const { rows } = await client.query(
      "insert into public.ocorrencias(obra_id,titulo,tipo,data) values($1,'Parede','problema',current_date) returning id",
      [obra],
    );
    const result = await client.query(
      "update public.ocorrencias set status='resolvido' where id=$1",
      [rows[0].id],
    );
    assert.equal(result.rowCount, 0);
  }));
test("USER não pode forjar autor de ocorrência", async () =>
  asUser(user, async () => {
    await assert.rejects(
      client.query(
        "insert into public.ocorrencias(obra_id,titulo,tipo,data,criado_por) values($1,'Fraude','problema',current_date,$2)",
        [obra, admin],
      ),
      /permission denied/,
    );
  }));
test("USER não promove perfil nem altera finanças via RPC", async () =>
  asUser(user, async () => {
    await assert.rejects(
      client.query(
        "update public.obra_membros set role='admin' where user_id=$1",
        [user],
      ),
      /permission denied/,
    );
  }));
test("ADM não remove último administrador", async () =>
  asUser(admin, async () => {
    await assert.rejects(
      client.query("select public.remove_member($1,$2)", [obra, admin]),
      /precisa de um ADM/,
    );
  }));
test("plano exige pesos completos; desconto excedente permanece; adiantamento permitido", async () =>
  asUser(admin, async () => {
    const contract = (
      await client.query(
        "insert into public.contratos_mao_de_obra(obra_id,profissional,tipo,valor_geral) values($1,'Pedreiro','empreitada',4000000) returning id",
        [obra],
      )
    ).rows[0].id;
    const stage = (
      await client.query(
        "insert into public.servicos(obra_id,contrato_id,nome,categoria,peso) values($1,$2,'Paredes','Alvenaria',10000) returning id",
        [obra, contract],
      )
    ).rows[0].id;
    await client.query("select public.activate_plan($1)", [contract]);
    await client.query(
      "insert into public.descontos_profissional(obra_id,contrato_id,descricao,valor,aplicacao) values($1,$2,'Ferramentas',15000,'semanal')",
      [obra, contract],
    );
    await client.query(
      "select public.record_payment($1,$2,current_date,10000,'Semana 1','Pix','servico',false)",
      [contract, stage],
    );
    const p = (
      await client.query(
        "select * from public.pagamentos where contrato_id=$1",
        [contract],
      )
    ).rows[0];
    assert.equal(Number(p.valor), 0);
    assert.equal(Number(p.desconto), 10000);
    const d = (
      await client.query(
        "select * from public.descontos_profissional where contrato_id=$1",
        [contract],
      )
    ).rows[0];
    assert.equal(Number(d.valor) - Number(d.aplicado), 5000);
    assert.equal(
      (
        await client.query(
          "select percentual_executado from public.servicos where id=$1",
          [stage],
        )
      ).rows[0].percentual_executado,
      0,
    );
  }));
test("storage privado não aceita upload direto de USER", async () =>
  asUser(user, async () => {
    await assert.rejects(
      client.query(
        "insert into storage.objects(bucket_id,name) values('obra-anexos','forjado')",
      ),
      /row-level security/,
    );
  }));
test("rate limit não pode ser chamado por usuário", async () =>
  asUser(user, async () => {
    await assert.rejects(
      client.query("select public.consume_rate('forjado',100)"),
      /permission denied/,
    );
  }));
test("todas as tabelas públicas têm RLS", async () => {
  const { rows } = await client.query(
    "select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity",
  );
  assert.deepEqual(rows, []);
});

test("USER não chama RPC financeira privilegiada", async () =>
  asUser(user, async () => {
    await assert.rejects(
      client.query(
        "select public.record_payment(null,null,current_date,100,'Teste','Pix','semanal',false)",
      ),
      /Sem permissão/,
    );
  }));
test("convite é de uso único e não revela token em texto puro", async () =>
  asUser(outsider, async () => {
    await client.query("reset role");
    await client.query(
      "insert into public.convites(obra_id,token_hash,role,criado_por) values($1,encode(extensions.digest(repeat('a',64),'sha256'),'hex'),'user',$2)",
      [obra, admin],
    );
    await client.query("set local role authenticated");
    assert.equal(
      (
        await client.query(
          "select public.accept_invite(repeat('a',64)) as obra",
        )
      ).rows[0].obra,
      obra,
    );
    await assert.rejects(
      client.query("select public.accept_invite(repeat('a',64))"),
      /inválido ou expirado/,
    );
  }));
test("peso incompleto não ativa plano", async () =>
  asUser(admin, async () => {
    const c = (
      await client.query(
        "insert into public.contratos_mao_de_obra(obra_id,profissional,tipo,valor_geral) values($1,'Teste','empreitada',10000) returning id",
        [obra],
      )
    ).rows[0].id;
    await assert.rejects(
      client.query("select public.activate_plan($1)", [c]),
      /pesos devem somar/,
    );
  }));
test("estorno restaura descontos e permite corrigir pagamento com auditoria", async () =>
  asUser(admin, async () => {
    const c = (
      await client.query(
        "insert into public.contratos_mao_de_obra(obra_id,profissional,tipo,valor_geral) values($1,'Teste','empreitada',100000) returning id",
        [obra],
      )
    ).rows[0].id;
    await client.query(
      "insert into public.descontos_profissional(obra_id,contrato_id,descricao,valor,aplicacao) values($1,$2,'Serra',15000,'semanal')",
      [obra, c],
    );
    const p = (
      await client.query(
        "select public.record_payment($1,null,current_date,10000,'Semana','Pix','semanal',false) as id",
        [c],
      )
    ).rows[0].id;
    const revised = (
      await client.query(
        "select public.revise_payment($1,null,current_date,20000,'Semana corrigida','Pix','semanal',false) as id",
        [p],
      )
    ).rows[0].id;
    assert.equal(
      (
        await client.query(
          "select anulado from public.pagamentos where id=$1",
          [p],
        )
      ).rows[0].anulado,
      true,
    );
    const current = (
      await client.query(
        "select valor,desconto from public.pagamentos where id=$1",
        [revised],
      )
    ).rows[0];
    assert.equal(Number(current.valor), 5000);
    assert.equal(Number(current.desconto), 15000);
    await client.query("select public.cancel_payment($1)", [revised]);
    assert.equal(
      Number(
        (
          await client.query(
            "select aplicado from public.descontos_profissional where contrato_id=$1",
            [c],
          )
        ).rows[0].aplicado,
      ),
      0,
    );
    assert.ok(
      Number(
        (
          await client.query(
            "select count(*) from public.audit_logs where tabela='pagamentos'",
          )
        ).rows[0].count,
      ) > 0,
    );
  }));

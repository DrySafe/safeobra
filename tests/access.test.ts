/** Real PostgreSQL, isolated synthetic Auth/Storage schemas; no production connection. */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
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
for (const name of (
  await readdir(new URL("../supabase/migrations/", import.meta.url))
)
  .filter((name) => name.endsWith(".sql"))
  .sort()) {
  await client.query(
    await readFile(
      new URL("../supabase/migrations/" + name, import.meta.url),
      "utf8",
    ),
  );
}

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
async function quoteFixture() {
  const group = (
    await client.query(
      "insert into public.orcamento_grupos(obra_id,nome) values($1,'Telhado') returning id",
      [obra],
    )
  ).rows[0].id;
  const quotes = (
    await client.query(
      "insert into public.orcamento_propostas(obra_id,grupo_id,empresa,itens,valor_total) values($1,$2,'Loja A','35 m² com frete',10001),($1,$2,'Loja B','35 m² com frete',9999) returning id",
      [obra, group],
    )
  ).rows;
  return { group, quotes };
}
test("orçamentos permitem escolher várias propostas sem criar despesas ou pagamentos", async () =>
  asUser(admin, async () => {
    const { group } = await quoteFixture();
    await client.query(
      "update public.orcamento_propostas set selecionada=true where grupo_id=$1",
      [group],
    );
    const totals = (
      await client.query(
        "select count(*) n,sum(valor_total) total from public.orcamento_propostas where selecionada",
      )
    ).rows[0];
    assert.equal(Number(totals.n), 2);
    assert.equal(Number(totals.total), 20000);
    assert.equal(
      (await client.query("select count(*) n from public.gastos")).rows[0].n,
      "0",
    );
    assert.equal(
      (await client.query("select count(*) n from public.pagamentos")).rows[0]
        .n,
      "0",
    );
    await client.query(
      "update public.orcamento_propostas set selecionada=false,valor_total=9000 where empresa='Loja A'",
    );
    assert.equal(
      (
        await client.query(
          "select sum(valor_total) total from public.orcamento_propostas where selecionada",
        )
      ).rows[0].total,
      "9999",
    );
    assert.equal(
      (
        await client.query(
          "select count(*) n from public.audit_logs where tabela='orcamento_propostas' and acao='UPDATE'",
        )
      ).rows[0].n,
      "3",
    );
  }));
test("membro visualiza propostas, mas não escolhe, edita ou cadastra", async () =>
  asUser(admin, async () => {
    const { group } = await quoteFixture();
    await client.query("select set_config('request.jwt.claim.sub',$1,true)", [
      user,
    ]);
    assert.equal(
      (await client.query("select * from public.orcamento_grupos")).rowCount,
      1,
    );
    assert.equal(
      (await client.query("select * from public.orcamento_propostas")).rowCount,
      2,
    );
    assert.equal(
      (
        await client.query(
          "update public.orcamento_propostas set selecionada=true,valor_total=1",
        )
      ).rowCount,
      0,
    );
    assert.equal(
      (await client.query("update public.orcamento_grupos set nome='Outro'"))
        .rowCount,
      0,
    );
    await assert.rejects(
      client.query(
        "insert into public.orcamento_propostas(obra_id,grupo_id,empresa,itens,valor_total) values($1,$2,'Loja','Item',100)",
        [obra, group],
      ),
      /row-level security/,
    );
  }));
test("não membro não vê os orçamentos nem pode anexar arquivos", async () =>
  asUser(admin, async () => {
    const { quotes } = await quoteFixture();
    await client.query("select set_config('request.jwt.claim.sub',$1,true)", [
      outsider,
    ]);
    assert.equal(
      (await client.query("select * from public.orcamento_grupos")).rowCount,
      0,
    );
    assert.equal(
      (await client.query("select * from public.orcamento_propostas")).rowCount,
      0,
    );
    assert.equal(
      (
        await client.query(
          "select public.can_attach($1,'orcamento_propostas',$2) allowed",
          [obra, quotes[0].id],
        )
      ).rows[0].allowed,
      false,
    );
  }));
test("proposta não pode usar um grupo pertencente a outra obra", async () =>
  asUser(admin, async () => {
    const { group } = await quoteFixture();
    // Creation adds membership in an AFTER trigger, so no SELECT/RETURNING here.
    await client.query(
      "insert into public.obras(nome) values('Outra obra de teste')",
    );
    await client.query("reset role");
    const created = (
      await client.query(
        "select id from public.obras where nome='Outra obra de teste'",
      )
    ).rows[0].id;
    await client.query("set local role authenticated");
    await assert.rejects(
      client.query(
        "insert into public.orcamento_propostas(obra_id,grupo_id,empresa,itens,valor_total) values($1,$2,'Loja','Item',100)",
        [created, group],
      ),
      /foreign key/,
    );
  }));
test("ADM anexa documento ao orçamento; membro apenas lê e não pode enviar", async () =>
  asUser(admin, async () => {
    const { quotes } = await quoteFixture();
    const q = quotes[0].id;
    assert.equal(
      (
        await client.query(
          "select public.can_attach($1,'orcamento_propostas',$2) allowed",
          [obra, q],
        )
      ).rows[0].allowed,
      true,
    );
    await client.query(
      "insert into public.anexos(id,obra_id,entidade,entidade_id,path,mime,tamanho) values('70000000-0000-4000-8000-000000000001',$1,'orcamento_propostas',$2,$3,'application/pdf',100)",
      [
        obra,
        q,
        `${obra}/orcamento_propostas/${q}/70000000-0000-4000-8000-000000000001`,
      ],
    );
    await client.query("select set_config('request.jwt.claim.sub',$1,true)", [
      user,
    ]);
    assert.equal(
      (
        await client.query(
          "select * from public.anexos where entidade='orcamento_propostas'",
        )
      ).rowCount,
      1,
    );
    assert.equal(
      (
        await client.query(
          "select public.can_attach($1,'orcamento_propostas',$2) allowed",
          [obra, q],
        )
      ).rows[0].allowed,
      false,
    );
    await assert.rejects(
      client.query(
        "update public.orcamento_propostas set grupo_id=$1 where id=$2",
        [q, q],
      ),
      /permission denied/,
    );
  }));
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
test("ADM cadastra e edita categoria personalizada mantendo o total do gasto", async () =>
  asUser(admin, async () => {
    const { rows } = await client.query(
      expense.replace("'Extras'", "'Locação de ferramentas'"),
      [obra],
    );
    const result = await client.query(
      "update public.gastos set categoria=$1 where id=$2 returning categoria,valor_total",
      ["Aluguel de equipamentos", rows[0].id],
    );
    assert.equal(result.rows[0].categoria, "Aluguel de equipamentos");
    assert.equal(Number(result.rows[0].valor_total), 5000);
    await assert.rejects(
      client.query("update public.gastos set categoria='   ' where id=$1", [
        rows[0].id,
      ]),
      /check constraint/,
    );
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

test("USER consulta referências mas não cadastra cotações", async () =>
  asUser(user, async () => {
    assert.equal(
      (await client.query("select * from public.referencias_servicos"))
        .rowCount,
      0,
    );
    await assert.rejects(
      client.query(
        "insert into public.referencias_servicos(obra_id,nome,categoria,unidade,valor_unitario,fonte,data_referencia) values($1,'Reboco','Alvenaria','m²',2000,'Cotação',current_date)",
        [obra],
      ),
      /row-level security/,
    );
  }));
test("ADM cadastra referência auditada com unidade e fonte", async () =>
  asUser(admin, async () => {
    const { rows } = await client.query(
      "insert into public.referencias_servicos(obra_id,nome,categoria,unidade,valor_unitario,fonte,data_referencia) values($1,'Reboco','Alvenaria','m²',2000,'Cotação',current_date) returning valor_unitario",
      [obra],
    );
    assert.equal(Number(rows[0].valor_unitario), 2000);
    assert.equal(
      Number(
        (
          await client.query(
            "select count(*) from public.audit_logs where tabela='referencias_servicos'",
          )
        ).rows[0].count,
      ),
      1,
    );
  }));

test("medições da etapa ficam fixas após ativar o plano", async () =>
  asUser(admin, async () => {
    const c = (
      await client.query(
        "insert into public.contratos_mao_de_obra(obra_id,profissional,tipo,valor_geral) values($1,'Teste','empreitada',100000) returning id",
        [obra],
      )
    ).rows[0].id;
    const stage = (
      await client.query(
        "insert into public.servicos(obra_id,contrato_id,nome,categoria,peso,unidade,quantidade) values($1,$2,'Reboco','Alvenaria',10000,'m²',100) returning id",
        [obra, c],
      )
    ).rows[0].id;
    await client.query("select public.activate_plan($1)", [c]);
    await assert.rejects(
      client.query("update public.servicos set quantidade=200 where id=$1", [
        stage,
      ]),
      /medições imutáveis/,
    );
  }));

async function rejectWithSavepoint(
  query: string,
  params: unknown[],
  pattern: RegExp,
) {
  await client.query("savepoint expected_error");
  await assert.rejects(client.query(query, params), pattern);
  await client.query("rollback to savepoint expected_error");
}
async function itemContract(value = 100000) {
  return (
    await client.query(
      "insert into public.contratos_mao_de_obra(obra_id,profissional,tipo,valor_geral) values($1,'Empreitada itens','empreitada',$2) returning id",
      [obra, value],
    )
  ).rows[0].id;
}
async function saveItems(
  contract: string,
  items: unknown[],
  batch = crypto.randomUUID(),
  payments = false,
) {
  await client.query("select public.save_contract_items($1,$2::jsonb,$3,$4)", [
    contract,
    JSON.stringify(items),
    batch,
    payments,
  ]);
}
const itemInput = (
  name: string,
  value: number | null,
  extra: Record<string, unknown> = {},
) => ({
  nome: name,
  descricao: "",
  unidade: "serviço",
  quantidade: 1,
  classe: "incluido",
  aprovado: false,
  valor_cobrado: value,
  percentual_executado: 0,
  ...extra,
});
test("nova tabela preserva plano anterior, valores e pagamentos ao adotar", async () =>
  asUser(admin, async () => {
    const c = await itemContract(100001);
    const stages = (
      await client.query(
        "insert into public.servicos(obra_id,contrato_id,nome,categoria,peso) values($1,$2,'Fundações','Alvenaria',5000),($1,$2,'Paredes','Alvenaria',5000) returning id",
        [obra, c],
      )
    ).rows;
    await client.query("select public.activate_plan($1)", [c]);
    await client.query(
      "select public.record_execution($1,current_date,100,'Concluído')",
      [stages[0].id],
    );
    await client.query(
      "select public.record_payment($1,$2,current_date,20000,'Existente','Pix','servico',false)",
      [c, stages[0].id],
    );
    await client.query("select public.adopt_contract_items($1)", [c]);
    const items = (
      await client.query(
        "select * from public.empreitada_itens where contrato_id=$1",
        [c],
      )
    ).rows;
    assert.equal(items.length, 2);
    assert.equal(
      items.reduce(
        (s: number, i: { valor_cobrado: string }) =>
          s + Number(i.valor_cobrado),
        0,
      ),
      100001,
    );
    assert.equal(
      items.find(
        (i: { id: string; percentual_executado: number }) =>
          i.id === stages[0].id,
      ).percentual_executado,
      100,
    );
    const p = (
      await client.query(
        "select * from public.pagamentos where contrato_id=$1",
        [c],
      )
    ).rows[0];
    assert.equal(Number(p.valor), 20000);
    assert.equal(p.item_id, stages[0].id);
    assert.equal(
      (
        await client.query(
          "select count(*) from public.pagamento_itens where contrato_id=$1",
          [c],
        )
      ).rows[0].count,
      "1",
    );
    await rejectWithSavepoint(
      "update public.servicos set nome='Alterado' where id=$1",
      [stages[0].id],
      /Plano antigo preservado/,
    );
  }));
test("incluídos não duplicam preço; extras só ampliam saldo depois de aprovados", async () =>
  asUser(admin, async () => {
    const c = await itemContract();
    await saveItems(c, [
      itemInput("Base", 100000),
      itemInput("Extra", 50000, { classe: "extra" }),
    ]);
    const extra = (
      await client.query(
        "select id from public.empreitada_itens where contrato_id=$1 and classe='extra'",
        [c],
      )
    ).rows[0].id;
    await rejectWithSavepoint(
      "select public.record_payment($1,$2,current_date,1000,'Extra','Pix','servico',false)",
      [c, extra],
      /Item inválido/,
    );
    await saveItems(c, [
      itemInput("Extra", 50000, { id: extra, classe: "extra", aprovado: true }),
    ]);
    await client.query(
      "select public.record_payment($1,$2,current_date,120000,'Adiantamento','Pix','servico',false)",
      [c, extra],
    );
    assert.equal(
      Number(
        (
          await client.query(
            "select sum(valor_bruto) n from public.pagamentos where contrato_id=$1",
            [c],
          )
        ).rows[0].n,
      ),
      120000,
    );
    await rejectWithSavepoint(
      "select public.archive_contract_item($1)",
      [extra],
      /Preserve item/,
    );
  }));
test("lote inválido reverte itens, adoção e pagamento; lote repetido não duplica dinheiro", async () =>
  asUser(admin, async () => {
    const c = await itemContract();
    await rejectWithSavepoint(
      "select public.save_contract_items($1,$2::jsonb,$3,true)",
      [
        c,
        JSON.stringify([
          itemInput("Inválido", 100001, { valor_pago_informado: 100 }),
        ]),
        crypto.randomUUID(),
      ],
      /excedem/,
    );
    assert.equal(
      (
        await client.query(
          "select itens_ativo from public.contratos_mao_de_obra where id=$1",
          [c],
        )
      ).rows[0].itens_ativo,
      false,
    );
    assert.equal(
      (
        await client.query(
          "select count(*) from public.empreitada_itens where contrato_id=$1",
          [c],
        )
      ).rows[0].count,
      "0",
    );
    await client.query(
      "insert into public.descontos_profissional(obra_id,contrato_id,descricao,valor,aplicacao) values($1,$2,'Pendente',1000,'semanal')",
      [obra, c],
    );
    const batch = crypto.randomUUID(),
      items = [
        itemInput("Pago histórico", 100000, {
          percentual_executado: 100,
          valor_pago_informado: 30000,
        }),
      ];
    await saveItems(c, items, batch, true);
    await saveItems(c, items, batch, true);
    const p = (
      await client.query(
        "select * from public.pagamentos where contrato_id=$1",
        [c],
      )
    ).rows;
    assert.equal(p.length, 1);
    assert.equal(Number(p[0].valor), 30000);
    assert.equal(Number(p[0].desconto), 0);
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
  }));
test("distribuição respeita bruto, desconto e líquido reais e não cria pagamento", async () =>
  asUser(admin, async () => {
    const c = await itemContract();
    await saveItems(c, [itemInput("A", 50000), itemInput("B", 50000)]);
    const items = (
      await client.query(
        "select id from public.empreitada_itens where contrato_id=$1 order by nome",
        [c],
      )
    ).rows;
    await client.query(
      "insert into public.descontos_profissional(obra_id,contrato_id,descricao,valor,aplicacao) values($1,$2,'Desconto',5000,'semanal')",
      [obra, c],
    );
    const p = (
      await client.query(
        "select public.record_payment($1,null,current_date,30000,'Semana','Pix','semanal',false) id",
        [c],
      )
    ).rows[0].id;
    await rejectWithSavepoint(
      "select public.allocate_contract_payment($1,$2,30000,0)",
      [p, items[0].id],
      /excede/,
    );
    await client.query(
      "select public.allocate_contract_payment($1,$2,10000,3000)",
      [p, items[0].id],
    );
    await client.query(
      "select public.allocate_contract_payment($1,$2,20000,2000)",
      [p, items[1].id],
    );
    const sums = (
      await client.query(
        "select sum(valor_bruto) b,sum(desconto) d,sum(valor_bruto-desconto) n from public.pagamento_itens where pagamento_id=$1",
        [p],
      )
    ).rows[0];
    assert.deepEqual(
      [Number(sums.b), Number(sums.d), Number(sums.n)],
      [30000, 5000, 25000],
    );
    assert.equal(
      (
        await client.query(
          "select count(*) from public.pagamentos where contrato_id=$1",
          [c],
        )
      ).rows[0].count,
      "1",
    );
    await client.query("select public.cancel_payment($1)", [p]);
    assert.equal(
      (
        await client.query(
          "select anulado from public.pagamentos where id=$1",
          [p],
        )
      ).rows[0].anulado,
      true,
    );
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
  }));
test("item de outro contrato não recebe pagamento ou distribuição", async () =>
  asUser(admin, async () => {
    const a = await itemContract(),
      b = await itemContract();
    await saveItems(a, [itemInput("A", 100000)]);
    await saveItems(b, [itemInput("B", 100000)]);
    const foreign = (
      await client.query(
        "select id from public.empreitada_itens where contrato_id=$1",
        [b],
      )
    ).rows[0].id;
    await rejectWithSavepoint(
      "select public.record_payment($1,$2,current_date,1000,'Inválido','Pix','servico',false)",
      [a, foreign],
      /Item inválido/,
    );
    const payment = (
      await client.query(
        "select public.record_payment($1,null,current_date,1000,'Geral','Pix','semanal',false) id",
        [a],
      )
    ).rows[0].id;
    await rejectWithSavepoint(
      "select public.allocate_contract_payment($1,$2,1000,0)",
      [payment, foreign],
      /Distribuição inválida/,
    );
  }));
test("USER lê tabela, mas não altera orçamento, aprovação, avanço ou pesquisas salvas", async () =>
  asUser(admin, async () => {
    const c = await itemContract();
    await saveItems(c, [itemInput("Serviço", 100000)]);
    const item = (
      await client.query(
        "select id from public.empreitada_itens where contrato_id=$1",
        [c],
      )
    ).rows[0].id;
    await client.query("select set_config('request.jwt.claim.sub',$1,true)", [
      user,
    ]);
    assert.equal(
      (
        await client.query(
          "select * from public.empreitada_itens where id=$1",
          [item],
        )
      ).rowCount,
      1,
    );
    await rejectWithSavepoint(
      "select public.adopt_contract_items($1)",
      [c],
      /Sem permissão/,
    );
    await rejectWithSavepoint(
      "select public.save_contract_items($1,$2::jsonb,$3,false)",
      [c, JSON.stringify([itemInput("Fraude", 1)]), crypto.randomUUID()],
      /Sem permissão/,
    );
    await rejectWithSavepoint(
      "update public.empreitada_itens set percentual_executado=100 where id=$1",
      [item],
      /permission denied/,
    );
    await rejectWithSavepoint(
      "select public.save_contract_item_estimate($1,$2,1,1,1,'{}'::jsonb)",
      [item, user],
      /permission denied/,
    );
  }));
test("redução de orçamento por arquivamento não invalida pagamento já registrado", async () =>
  asUser(admin, async () => {
    const c = await itemContract();
    await saveItems(c, [
      itemInput("Base", 100000),
      itemInput("Extra livre", 50000, { classe: "extra", aprovado: true }),
    ]);
    const extra = (
      await client.query(
        "select id from public.empreitada_itens where contrato_id=$1 and classe='extra'",
        [c],
      )
    ).rows[0].id;
    await client.query(
      "select public.record_payment($1,null,current_date,130000,'Adiantado','Pix','semanal',false)",
      [c],
    );
    await rejectWithSavepoint(
      "select public.archive_contract_item($1)",
      [extra],
      /Saldo comprometido/,
    );
    assert.equal(
      (
        await client.query(
          "select arquivado from public.empreitada_itens where id=$1",
          [extra],
        )
      ).rows[0].arquivado,
      false,
    );
  }));

test("pesquisa só é salva pelo servidor; alteração de escopo invalida cache e impede pesquisa atrasada", async () =>
  asUser(admin, async () => {
    const c = await itemContract();
    await saveItems(c, [itemInput("Pintura", 100000)]);
    const i = (
      await client.query(
        "select * from public.empreitada_itens where contrato_id=$1",
        [c],
      )
    ).rows[0];
    await client.query("set local role service_role");
    await client.query(
      "select public.save_contract_item_estimate($1,$2,80000,70000,90000,'{}'::jsonb,$3::jsonb)",
      [
        i.id,
        admin,
        JSON.stringify({
          nome: i.nome,
          descricao: i.descricao,
          unidade: i.unidade,
          quantidade: 1,
        }),
      ],
    );
    await client.query("set local role authenticated");
    assert.equal(
      Number(
        (
          await client.query(
            "select valor_estimado from public.empreitada_itens where id=$1",
            [i.id],
          )
        ).rows[0].valor_estimado,
      ),
      80000,
    );
    await saveItems(c, [
      itemInput("Pintura", 100000, { id: i.id, descricao: "Área alterada" }),
    ]);
    const changed = (
      await client.query(
        "select valor_estimado,estimado_minimo,estimado_maximo,pesquisado_em,estimativa_json from public.empreitada_itens where id=$1",
        [i.id],
      )
    ).rows[0];
    assert.ok(Object.values(changed).every((value) => value === null));
    await client.query("set local role service_role");
    await rejectWithSavepoint(
      "select public.save_contract_item_estimate($1,$2,80000,70000,90000,'{}'::jsonb,$3::jsonb)",
      [
        i.id,
        admin,
        JSON.stringify({
          nome: i.nome,
          descricao: i.descricao,
          unidade: i.unidade,
          quantidade: 1,
        }),
      ],
      /alterado durante/,
    );
  }));

test("editar desconto move apenas o saldo pendente entre fechamentos e preserva pagamentos", async () =>
  asUser(admin, async () => {
    const c = (
      await client.query(
        "insert into public.contratos_mao_de_obra(obra_id,profissional,tipo,valor_geral) values($1,'Teste de desconto','empreitada',100000) returning id",
        [obra],
      )
    ).rows[0].id;
    const d = (
      await client.query(
        "insert into public.descontos_profissional(obra_id,contrato_id,descricao,valor,aplicacao) values($1,$2,'Ferramentas',15000,'semanal') returning id",
        [obra, c],
      )
    ).rows[0].id;
    async function pay(amount: number, final = false) {
      const p = (
        await client.query(
          "select public.record_payment($1,null,current_date,$2,'Teste','Pix','semanal',$3) id",
          [c, amount, final],
        )
      ).rows[0].id;
      return (
        await client.query(
          "select id,valor_bruto,desconto,valor from public.pagamentos where id=$1",
          [p],
        )
      ).rows[0];
    }
    async function edit(amount: number, closing: string) {
      await client.query(
        "select public.update_discount($1,$2,'Ferramentas revisadas',$3,$4)",
        [obra, d, amount, closing],
      );
    }
    const original = await pay(5000);
    await edit(20000, "final");
    assert.equal(Number((await pay(10000)).desconto), 0);
    await edit(20000, "semanal");
    assert.equal(Number((await pay(10000)).desconto), 10000);
    await edit(20000, "final");
    assert.equal(Number((await pay(10000, true)).desconto), 5000);
    assert.deepEqual(
      (
        await client.query(
          "select id,valor_bruto,desconto,valor from public.pagamentos where id=$1",
          [original.id],
        )
      ).rows[0],
      original,
    );
    const discount = (
      await client.query(
        "select valor,aplicado,aplicacao from public.descontos_profissional where id=$1",
        [d],
      )
    ).rows[0];
    assert.equal(Number(discount.valor), 20000);
    assert.equal(Number(discount.aplicado), 20000);
    assert.equal(discount.aplicacao, "final");
    await client.query("savepoint invalid_edit");
    await assert.rejects(edit(19999, "semanal"), /já aplicado/);
    await client.query("rollback to savepoint invalid_edit");
    assert.equal(
      Number(
        (
          await client.query(
            "select count(*) n from public.audit_logs where registro_id=$1 and acao='UPDATE' and depois->>'descricao'='Ferramentas revisadas'",
            [d],
          )
        ).rows[0].n,
      ) >= 3,
      true,
    );
  }));

test("edição de desconto impede USER, terceiro, obra incorreta e alteração direta do aplicado", async () =>
  asUser(admin, async () => {
    const c = (
      await client.query(
        "insert into public.contratos_mao_de_obra(obra_id,profissional,tipo,valor_geral) values($1,'Teste de permissão','empreitada',100000) returning id",
        [obra],
      )
    ).rows[0].id;
    const d = (
      await client.query(
        "insert into public.descontos_profissional(obra_id,contrato_id,descricao,valor,aplicacao) values($1,$2,'Ferramentas',15000,'semanal') returning id",
        [obra, c],
      )
    ).rows[0].id;
    for (const uid of [user, outsider]) {
      await client.query("savepoint unauthorized_edit");
      await client.query("select set_config('request.jwt.claim.sub',$1,true)", [
        uid,
      ]);
      await assert.rejects(
        client.query(
          "select public.update_discount($1,$2,'Alterado',20000,'final')",
          [obra, d],
        ),
        /Sem permissão/,
      );
      await client.query("rollback to savepoint unauthorized_edit");
    }
    await client.query(
      "insert into public.obras(nome) values('Outra obra de teste')",
    );
    const other = (
      await client.query(
        "select id from public.obras where nome='Outra obra de teste'",
      )
    ).rows[0].id;
    await client.query("savepoint wrong_scope");
    await assert.rejects(
      client.query(
        "select public.update_discount($1,$2,'Alterado',20000,'final')",
        [other, d],
      ),
      /não encontrado/,
    );
    await client.query("rollback to savepoint wrong_scope");
    await client.query("savepoint direct_edit");
    await assert.rejects(
      client.query(
        "update public.descontos_profissional set aplicado=100 where id=$1",
        [d],
      ),
      /permission denied/,
    );
    await client.query("rollback to savepoint direct_edit");
    assert.equal(
      (
        await client.query(
          "select has_function_privilege('anon','public.update_discount(uuid,uuid,text,bigint,text)','EXECUTE') allowed",
        )
      ).rows[0].allowed,
      false,
    );
  }));

test("transferir desconto semanal para final corrige 1820 para 2000 sem duplicar pagamentos", async () =>
  asUser(admin, async () => {
    const c = await itemContract(1000000);
    const d = (
      await client.query(
        "insert into public.descontos_profissional(obra_id,contrato_id,descricao,valor,aplicacao) values($1,$2,'Carrinho',18000,'semanal') returning id",
        [obra, c],
      )
    ).rows[0].id;
    const p = (
      await client.query(
        "select public.record_payment($1,null,current_date,200000,'Inicial','Pix','semanal',false) id",
        [c],
      )
    ).rows[0].id;
    assert.equal(
      Number(
        (
          await client.query(
            "select valor from public.pagamentos where id=$1",
            [p],
          )
        ).rows[0].valor,
      ),
      182000,
    );
    const result = (
      await client.query(
        "select public.revise_discount($1,$2,'Carrinho',18000,'final',false) amount",
        [obra, d],
      )
    ).rows[0];
    assert.equal(Number(result.amount), 18000);
    const corrected = (
      await client.query(
        "select valor_bruto,desconto,valor from public.pagamentos where id=$1",
        [p],
      )
    ).rows[0];
    assert.deepEqual(Object.values(corrected).map(Number), [200000, 0, 200000]);
    assert.equal(
      (
        await client.query(
          "select count(*) n from public.pagamentos where contrato_id=$1",
          [c],
        )
      ).rows[0].n,
      "1",
    );
    assert.equal(
      Number(
        (
          await client.query(
            "select aplicado from public.descontos_profissional where id=$1",
            [d],
          )
        ).rows[0].aplicado,
      ),
      0,
    );
    await client.query(
      "select public.revise_discount($1,$2,'Carrinho',18000,'final',true)",
      [obra, d],
    );
    assert.equal(
      Number(
        (
          await client.query(
            "select valor from public.pagamentos where id=$1",
            [p],
          )
        ).rows[0].valor,
      ),
      200000,
    );
    const final = (
      await client.query(
        "select public.record_payment($1,null,current_date,20000,'Final','Pix','semanal',true) id",
        [c],
      )
    ).rows[0].id;
    assert.equal(
      Number(
        (
          await client.query(
            "select desconto from public.pagamentos where id=$1",
            [final],
          )
        ).rows[0].desconto,
      ),
      18000,
    );
    await client.query("select public.cancel_payment($1)", [p]);
    assert.equal(
      Number(
        (
          await client.query(
            "select aplicado from public.descontos_profissional where id=$1",
            [d],
          )
        ).rows[0].aplicado,
      ),
      18000,
    );
    await client.query("select public.cancel_payment($1)", [final]);
    assert.equal(
      Number(
        (
          await client.query(
            "select aplicado from public.descontos_profissional where id=$1",
            [d],
          )
        ).rows[0].aplicado,
      ),
      0,
    );
  }));

test("correção explícita de desconto já final é atômica e preserva outros descontos e centavos dos vínculos", async () =>
  asUser(admin, async () => {
    const c = await itemContract(100000);
    await saveItems(c, [itemInput("A", 50000), itemInput("B", 50000)]);
    const items = (
      await client.query(
        "select id from public.empreitada_itens where contrato_id=$1 order by nome",
        [c],
      )
    ).rows;
    const ds = (
      await client.query(
        "insert into public.descontos_profissional(obra_id,contrato_id,descricao,valor,aplicacao) values($1,$2,'Devolver',333,'semanal'),($1,$2,'Manter',667,'semanal') returning id,descricao",
        [obra, c],
      )
    ).rows;
    const d = ds.find(
      (d: { descricao: string }) => d.descricao === "Devolver",
    ).id;
    const p = (
      await client.query(
        "select public.record_payment($1,null,current_date,3001,'Pagamento','Pix','semanal',false) id",
        [c],
      )
    ).rows[0].id;
    await client.query(
      "select public.allocate_contract_payment($1,$2,1000,333)",
      [p, items[0].id],
    );
    await client.query(
      "select public.allocate_contract_payment($1,$2,1000,334)",
      [p, items[1].id],
    );
    await client.query(
      "select public.update_discount($1,$2,'Devolver',333,'final')",
      [obra, d],
    );
    assert.equal(
      Number(
        (
          await client.query(
            "select public.revise_discount($1,$2,'Devolver',333,'final',false) amount",
            [obra, d],
          )
        ).rows[0].amount,
      ),
      0,
    );
    await rejectWithSavepoint(
      "select public.revise_discount($1,$2,'Devolver',0,'final',true)",
      [obra, d],
      /Confira/,
    );
    assert.equal(
      Number(
        (
          await client.query(
            "select desconto from public.pagamentos where id=$1",
            [p],
          )
        ).rows[0].desconto,
      ),
      1000,
    );
    await client.query(
      "select public.revise_discount($1,$2,'Devolver',333,'final',true)",
      [obra, d],
    );
    const payment = (
      await client.query(
        "select valor_bruto,desconto,valor from public.pagamentos where id=$1",
        [p],
      )
    ).rows[0];
    assert.deepEqual(Object.values(payment).map(Number), [3001, 667, 2334]);
    const allocations = (
      await client.query(
        "select valor_bruto,desconto from public.pagamento_itens where pagamento_id=$1",
        [p],
      )
    ).rows;
    assert.equal(
      allocations.reduce(
        (n: number, a: { valor_bruto: string }) => n + Number(a.valor_bruto),
        0,
      ),
      2000,
    );
    const discount = allocations.reduce(
      (n: number, a: { desconto: string }) => n + Number(a.desconto),
      0,
    );
    assert.equal(discount, 445);
    assert.equal(2000 - discount, 1555);
    assert.equal(
      Number(
        (
          await client.query(
            "select sum(valor) amount from public.pagamento_descontos where pagamento_id=$1",
            [p],
          )
        ).rows[0].amount,
      ),
      667,
    );
    assert.equal(
      Number(
        (
          await client.query(
            "select aplicado from public.descontos_profissional where descricao='Manter' and contrato_id=$1",
            [c],
          )
        ).rows[0].aplicado,
      ),
      667,
    );
    await client.query("select public.cancel_payment($1)", [p]);
    assert.equal(
      Number(
        (
          await client.query(
            "select sum(aplicado) amount from public.descontos_profissional where contrato_id=$1",
            [c],
          )
        ).rows[0].amount,
      ),
      0,
    );
  }));

test("devolução de desconto mantém função interna privada e nega usuário e terceiro", async () =>
  asUser(admin, async () => {
    for (const uid of [user, outsider]) {
      await client.query("savepoint unauthorized_refund");
      await client.query("select set_config('request.jwt.claim.sub',$1,true)", [
        uid,
      ]);
      await assert.rejects(
        client.query(
          "select public.revise_discount($1,gen_random_uuid(),'Teste',18000,'final',true)",
          [obra],
        ),
        /Sem permissão/,
      );
      await client.query("rollback to savepoint unauthorized_refund");
    }
    for (const role of ["anon", "authenticated"])
      assert.equal(
        (
          await client.query(
            "select has_function_privilege($1,'public.defer_applied_discount(uuid,uuid)','EXECUTE') allowed",
            [role],
          )
        ).rows[0].allowed,
        false,
      );
  }));

test("despesa anterior mantém Pago por padrão; quitar pendência mantém o mesmo valor e registro", async () =>
  asUser(admin, async () => {
    const row = (await client.query(expense, [obra])).rows[0];
    assert.equal(
      (
        await client.query(
          "select status_pagamento from public.gastos where id=$1",
          [row.id],
        )
      ).rows[0].status_pagamento,
      "pago",
    );
    const before = (
      await client.query(
        "select quantidade,valor_unitario,valor_total from public.gastos where id=$1",
        [row.id],
      )
    ).rows[0];
    await client.query(
      "update public.gastos set status_pagamento='a_pagar',status_entrega='entregue' where id=$1",
      [row.id],
    );
    assert.equal(
      Number(
        (
          await client.query(
            "select sum(valor_total) amount from public.gastos where obra_id=$1 and status_pagamento='a_pagar'",
            [obra],
          )
        ).rows[0].amount,
      ),
      5000,
    );
    for (let n = 0; n < 2; n++)
      await client.query(
        "update public.gastos set status_pagamento='pago' where id=$1",
        [row.id],
      );
    assert.deepEqual(
      (
        await client.query(
          "select quantidade,valor_unitario,valor_total from public.gastos where id=$1",
          [row.id],
        )
      ).rows[0],
      before,
    );
    assert.equal(
      (
        await client.query(
          "select count(*) n from public.gastos where obra_id=$1",
          [obra],
        )
      ).rows[0].n,
      "1",
    );
    assert.equal(
      (
        await client.query(
          "select count(*) n from public.pagamentos where obra_id=$1",
          [obra],
        )
      ).rows[0].n,
      "0",
    );
    assert.equal(
      (
        await client.query(
          "select status_entrega from public.gastos where id=$1",
          [row.id],
        )
      ).rows[0].status_entrega,
      "entregue",
    );
    await rejectWithSavepoint(
      "update public.gastos set status_pagamento='quitado' where id=$1",
      [row.id],
      /check constraint/,
    );
  }));

test("USER e terceiro não podem quitar despesas diretamente no banco", async () =>
  asUser(admin, async () => {
    const row = (await client.query(expense, [obra])).rows[0];
    await client.query(
      "update public.gastos set status_pagamento='a_pagar' where id=$1",
      [row.id],
    );
    for (const uid of [user, outsider]) {
      await client.query("savepoint unauthorized_expense_payment");
      await client.query("select set_config('request.jwt.claim.sub',$1,true)", [
        uid,
      ]);
      assert.equal(
        (
          await client.query(
            "update public.gastos set status_pagamento='pago' where id=$1",
            [row.id],
          )
        ).rowCount,
        0,
      );
      await client.query("rollback to savepoint unauthorized_expense_payment");
    }
    assert.equal(
      (
        await client.query(
          "select status_pagamento from public.gastos where id=$1",
          [row.id],
        )
      ).rows[0].status_pagamento,
      "a_pagar",
    );
  }));

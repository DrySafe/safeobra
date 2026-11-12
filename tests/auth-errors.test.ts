import { test } from "node:test";
import assert from "node:assert/strict";
import { authErrorMessage } from "../src/lib/auth-errors.ts";
test("cadastro duplicado orienta a entrar na conta existente sem exibir dados do provedor", () => {
  for (const code of ["user_already_exists", "email_exists"]) {
    const message = authErrorMessage("signup", {
      code,
      status: 422,
      message: "provider detail containing a private email",
    });
    assert.match(message, /já possui uma conta/);
    assert.match(message, /Entre com a senha/);
    assert.ok(!message.includes("private email"));
  }
  assert.doesNotMatch(
    authErrorMessage("login", { code: "user_already_exists" }),
    /já possui uma conta/,
  );
});
test("cadastro informa limite de e-mails no formato atual do Supabase", () => {
  assert.match(
    authErrorMessage("signup", {
      code: "over_email_send_rate_limit",
      status: 429,
    }),
    /limite de envio de e-mails/,
  );
});
test("cadastro reconhece a resposta legada de limite de e-mails", () => {
  assert.match(
    authErrorMessage("signup", {
      status: 429,
      message: "Email rate limit exceeded",
    }),
    /limite de envio de e-mails/,
  );
});
test("limite genérico não é confundido com limite de e-mail", () => {
  assert.match(
    authErrorMessage("signup", {
      status: 429,
      code: "over_request_rate_limit",
    }),
    /Muitas tentativas/,
  );
});
test("falha de entrega e confirmação pendente possuem ações claras", () => {
  assert.match(
    authErrorMessage("signup", { code: "email_address_not_authorized" }),
    /responsável/,
  );
  assert.match(
    authErrorMessage("login", { code: "email_not_confirmed" }),
    /Confirme seu e-mail/,
  );
});
test("mensagem bruta do provedor nunca é enviada ao cliente", () => {
  const message = authErrorMessage("signup", {
    status: 500,
    message: "internal detail with smtp credential",
  });
  assert.ok(!message.includes("smtp credential"));
  assert.ok(!message.includes("internal detail"));
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { isAllowedRequestOrigin } from "../src/server/origin.ts";

const config = {
  APP_URL: "https://safeobra.vercel.app/",
  VERCEL: "1",
  VERCEL_URL: "safeobra-deploy123-team.vercel.app",
  VERCEL_BRANCH_URL: "safeobra-git-work-team.vercel.app",
  VERCEL_PROJECT_PRODUCTION_URL: "safeobra-team.vercel.app",
};
function request(origin?: string, headers: Record<string, string> = {}) {
  return new Request("https://safeobra.vercel.app/api/ai/estimate", {
    method: "POST",
    headers: { ...(origin === undefined ? {} : { origin }), ...headers },
  });
}

test("origem canônica e desenvolvimento local continuam autorizados", () => {
  assert.equal(
    isAllowedRequestOrigin(request("https://safeobra.vercel.app"), config),
    true,
  );
  assert.equal(
    isAllowedRequestOrigin(request("http://localhost:3000"), {
      APP_URL: "http://localhost:3000",
    }),
    true,
  );
});
test("origens exatas do deploy, branch e produção informadas pela Vercel são autorizadas", () => {
  for (const hostname of [
    config.VERCEL_URL,
    config.VERCEL_BRANCH_URL,
    config.VERCEL_PROJECT_PRODUCTION_URL,
  ])
    assert.equal(
      isAllowedRequestOrigin(request("https://" + hostname), config),
      true,
    );
});
test("outros projetos Vercel, subdomínios semelhantes, portas e HTTP são recusados", () => {
  for (const origin of [
    "https://attacker.vercel.app",
    "https://safeobra-deploy123-team.vercel.app.evil.example",
    "https://evil.safeobra.vercel.app",
    "https://safeobra.vercel.app:444",
    "http://" + config.VERCEL_URL,
  ])
    assert.equal(
      isAllowedRequestOrigin(request(origin), config),
      false,
      origin,
    );
});
test("origem ausente, opaca ou não serializada é recusada", () => {
  for (const origin of [
    undefined,
    "null",
    "invalid",
    "https://safeobra.vercel.app/path",
    "https://safeobra.vercel.app/",
    "https://user:password@safeobra.vercel.app",
  ])
    assert.equal(isAllowedRequestOrigin(request(origin), config), false);
});
test("Host, URL da requisição e cabeçalhos encaminhados não ampliam as origens confiáveis", () => {
  const origin = "https://attacker.vercel.app";
  assert.equal(
    isAllowedRequestOrigin(
      request(origin, {
        host: "attacker.vercel.app",
        "x-forwarded-host": "attacker.vercel.app",
      }),
      config,
    ),
    false,
  );
  assert.equal(
    isAllowedRequestOrigin(
      new Request(origin, { headers: { origin } }),
      config,
    ),
    false,
  );
});
test("sem ambiente Vercel, os metadados de deploy não ampliam a origem canônica", () => {
  assert.equal(
    isAllowedRequestOrigin(request("https://" + config.VERCEL_URL), {
      ...config,
      VERCEL: undefined,
    }),
    false,
  );
  assert.equal(
    isAllowedRequestOrigin(request("https://safeobra.vercel.app"), {
      ...config,
      APP_URL: undefined,
    }),
    false,
  );
});
test("configuração inválida não abre origens nem aceita curingas", () => {
  for (const hostname of [
    "*.vercel.app",
    "https://attacker.vercel.app",
    "attacker.vercel.app/path",
    "user@attacker.vercel.app",
  ])
    assert.equal(
      isAllowedRequestOrigin(request("https://attacker.vercel.app"), {
        ...config,
        VERCEL_URL: hostname,
      }),
      false,
    );
  assert.equal(
    isAllowedRequestOrigin(request("https://safeobra.vercel.app"), {
      APP_URL: "file:///tmp/app",
    }),
    false,
  );
});
test("requisição identificada pelo navegador como cross-site permanece bloqueada", () => {
  assert.equal(
    isAllowedRequestOrigin(
      request("https://safeobra.vercel.app", {
        "sec-fetch-site": "cross-site",
      }),
      config,
    ),
    false,
  );
  assert.equal(
    isAllowedRequestOrigin(
      request("https://" + config.VERCEL_URL, {
        "sec-fetch-site": "same-origin",
      }),
      config,
    ),
    true,
  );
});

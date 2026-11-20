import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/carteira.js";

const preview = {
  WALLET_PREVIEW: "true",
  WALLET_PUBLIC_ORIGIN: "https://wallet-staging.example.test",
  SUPABASE_URL: "https://staging.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_staging",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-secret",
  RESEND_API_KEY: "test-resend-secret",
  EMAIL_FROM: "acesso@example.test"
};

const managerId = "70000000-0000-4000-8000-000000000001";
const sellerId = "70000000-0000-4000-8000-000000000010";
const invitedUserId = "70000000-0000-4000-8000-000000000011";
const png = "data:image/png;base64,iVBORw0KGgo=";

function setupAPI(t, target, directory) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method || "GET";
    let body = null;
    if (init.body) {
      try { body = JSON.parse(init.body); } catch { body = init.body; }
    }
    calls.push({ url, method, body });
    if (url.hostname === "api.resend.com") return Response.json({ id: "email-test" });
    if (url.pathname === "/auth/v1/user") return Response.json({ id: managerId });
    if (url.pathname === "/auth/v1/admin/generate_link") {
      return Response.json({ properties: { action_link: "https://auth.example.test/invite" }, user: { id: invitedUserId } });
    }
    if (url.pathname === "/auth/v1/admin/users/page") return Response.json({ users: [] });
    if (url.pathname === "/rest/v1/user_roles") {
      if (method === "POST") return Response.json([]);
      return Response.json([{ user_id: managerId, role: "GERENTE" }]);
    }
    if (url.pathname === "/rest/v1/sellers") {
      if (url.searchParams.has("id")) return Response.json([target]);
      if (method === "PATCH") return Response.json([{ ...target, ...body }]);
      return Response.json(directory);
    }
    if (url.pathname === "/rest/v1/seller_onboarding") return Response.json([]);
    return Response.json([]);
  });
  return calls;
}

function linkRequest() {
  return new Request("https://wallet-staging.example.test/api/sellers/" + sellerId + "/link", {
    method: "POST",
    headers: { authorization: "Bearer test-token", "content-type": "application/json" },
    body: JSON.stringify({ email: "seller@example.test", qrPng: png })
  });
}

const targetRow = (extra = {}) => ({
  id: sellerId, slug: "josi-misael", name: "Josi Misael", phone: "11900000000", region: "Santos",
  active: true, seller_user_id: null, executive_user_id: null, supervisor_user_id: null, ...extra
});

test("manager legacy link blocks a normalized duplicate name before creating an invite", async t => {
  const target = targetRow();
  const duplicate = targetRow({ id: "70000000-0000-4000-8000-000000000012", name: "JÓSI MISAEL", phone: "11911111111" });
  const calls = setupAPI(t, target, [target, duplicate]);

  const response = await worker.fetch(linkRequest(), preview);

  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /mesmo nome ou telefone/);
  assert.equal(calls.some(call => call.url.pathname === "/auth/v1/admin/generate_link"), false);
  assert.equal(calls.some(call => call.url.pathname === "/rest/v1/sellers" && call.method === "PATCH"), false);
});

test("manager legacy link updates the existing seller row and sends its invitation", async t => {
  const target = targetRow();
  const calls = setupAPI(t, target, [target]);

  const response = await worker.fetch(linkRequest(), preview);
  const result = await response.json();

  assert.equal(response.status, 201);
  assert.equal(result.emailStatus, "sent");
  assert.equal(calls.some(call => call.url.pathname === "/rest/v1/sellers" && call.method === "POST"), false);
  const linkUpdate = calls.find(call => call.url.pathname === "/rest/v1/sellers" && call.method === "PATCH");
  assert.equal(linkUpdate.body.seller_user_id, invitedUserId);
  assert.equal(calls.some(call => call.url.hostname === "api.resend.com"), true);
});

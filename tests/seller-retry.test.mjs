import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/carteira.js";

const managerId = "70000000-0000-4000-8000-000000000001";
const executiveId = "70000000-0000-4000-8000-000000000002";
const sellerId = "80000000-0000-4000-8000-000000000001";
const accountId = "70000000-0000-4000-8000-000000000003";
const email = "Rafarocha.bio@gmail.com";
const target = {
  id: sellerId, slug: "rafael-rocha", name: "Rafael Antonio Gonçalves da Rocha", phone: "13912345678",
  active: true, seller_user_id: accountId, executive_user_id: null, supervisor_user_id: null
};

test("manager resends an invite to an unconfirmed executive account marked as sent", async t => {
  const calls = [];
  const generatedLinks = [];
  let outboundEmail;
  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, method, body });

    if (url.hostname === "api.resend.com") {
      outboundEmail = body;
      return Response.json({ id: "email-resend-test" });
    }
    if (url.pathname === "/auth/v1/user") return Response.json({ id: managerId });
    if (url.pathname === "/rest/v1/user_roles") {
      const query = url.searchParams.get("user_id") || "";
      if (query === "eq." + managerId) return Response.json([{ role: "GERENTE" }]);
      if (query.includes(accountId)) return Response.json([{ user_id: accountId, role: "EXECUTIVO" }]);
      return Response.json([]);
    }
    if (url.pathname === "/rest/v1/sellers") return Response.json([target]);
    if (url.pathname === "/rest/v1/seller_onboarding" && method === "GET") {
      return Response.json([{ email_status: "sent", whatsapp_status: "pending", attempt_count: 1 }]);
    }
    if (url.pathname === "/rest/v1/seller_onboarding" && method === "PATCH") return new Response(null, { status: 204 });
    if (url.pathname === "/auth/v1/admin/users/" + accountId) {
      return Response.json({ user: { id: accountId, email, confirmed_at: null, invited_at: "2026-11-17T22:51:13Z" } });
    }
    if (url.pathname === "/auth/v1/admin/generate_link") {
      generatedLinks.push(body.type);
      if (body.type === "invite") return Response.json({ message: "User already registered" }, { status: 422 });
      return Response.json({ properties: { action_link: "https://auth.example.test/recovery" } });
    }
    if (url.pathname === "/auth/v1/admin/users" && url.searchParams.has("page")) {
      return Response.json({ users: [{ id: accountId, email, confirmed_at: null, invited_at: "2026-11-17T22:51:13Z" }] });
    }
    return Response.json([]);
  });

  const response = await worker.fetch(new Request("https://wallet.example.test/api/sellers/" + sellerId + "/retry", {
    method: "POST",
    headers: { authorization: "Bearer manager-session", "content-type": "application/json" },
    body: JSON.stringify({ qrPng: "data:image/png;base64,iVBORw0KGgo=" })
  }), {
    WALLET_PUBLIC_ORIGIN: "https://wallet.example.test", SUPABASE_URL: "https://staging.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_staging", SUPABASE_SERVICE_ROLE_KEY: "test-service-secret",
    RESEND_API_KEY: "test-resend-secret", EMAIL_FROM: "acesso@example.test", WALLET_PREVIEW: "true"
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.emailStatus, "sent");
  assert.deepEqual(generatedLinks, ["invite", "recovery"]);
  assert.deepEqual(outboundEmail.to, [email]);
  assert.match(outboundEmail.text, /https:\/\/auth\.example\.test\/recovery/);
  const update = calls.find(call => call.url.pathname === "/rest/v1/seller_onboarding" && call.method === "PATCH");
  assert.equal(update.body.attempt_count, 2);
  assert.match(payload.message, /Convite reenviado e aceito/);
});

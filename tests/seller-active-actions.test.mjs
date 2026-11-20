import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/carteira.js";

const preview = {
  WALLET_PREVIEW: "true",
  WALLET_PUBLIC_ORIGIN: "https://wallet-staging.example.test",
  SUPABASE_URL: "https://staging.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_staging",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-secret"
};

const managerId = "70000000-0000-4000-8000-000000000001";
const sellerId = "70000000-0000-4000-8000-000000000002";

async function toggleSeller(t, { activeBefore = true, activeAfter = false, hasAccount = false, updateRows = null } = {}) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    const url = new URL(input);
    calls.push({ url, method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null });
    if (url.hostname !== "staging.supabase.co") throw new Error("Unexpected host " + url.hostname);
    if (url.pathname === "/auth/v1/user") return Response.json({ id: managerId });
    if (url.pathname === "/rest/v1/user_roles") {
      const filter = url.searchParams.get("user_id") || "";
      if (filter === "eq." + managerId) return Response.json([{ user_id: managerId, role: "GERENTE" }]);
      const ids = filter.match(/in\.\((.*)\)/)?.[1]?.split(",") || [];
      return Response.json(hasAccount
        ? ids.filter(id => id === "70000000-0000-4000-8000-000000000003").map(user_id => ({ user_id, role: "VENDEDOR" }))
        : []);
    }
    if (url.pathname === "/rest/v1/sellers" && !init.method && url.searchParams.has("id")) {
      return Response.json([{
        id: sellerId, slug: "ana-paula", name: "Ana Paula", phone: "13991464370",
        active: activeBefore, seller_user_id: hasAccount ? "70000000-0000-4000-8000-000000000003" : null,
        executive_user_id: null, supervisor_user_id: null
      }]);
    }
    if (url.pathname === "/rest/v1/seller_onboarding") {
      return Response.json(hasAccount ? [{ email_status: "sent" }] : []);
    }
    if (url.pathname === "/rest/v1/sellers" && init.method === "PATCH") {
      return Response.json(updateRows ?? [{ active: JSON.parse(init.body).active }]);
    }
    return Response.json([]);
  });

  const response = await worker.fetch(new Request("https://wallet-staging.example.test/api/sellers/" + sellerId, {
    method: "PATCH",
    headers: { authorization: "Bearer manager-token", "content-type": "application/json" },
    body: JSON.stringify({ active: activeAfter })
  }), preview);
  return { response, calls };
}

test("manager can deactivate a legacy seller without an email or linked login", async t => {
  const { response, calls } = await toggleSeller(t);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, active: false, role: "VENDEDOR" });
  const update = calls.find(call => call.method === "PATCH");
  assert.ok(update, "the database update must be sent");
  assert.deepEqual(update.body, { active: false });
});

test("manager can deactivate and reactivate a linked seller", async t => {
  for (const activeAfter of [false, true]) {
    const { response, calls } = await toggleSeller(t, {
      activeBefore: !activeAfter, activeAfter, hasAccount: true
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).active, activeAfter);
    assert.ok(calls.some(call => call.method === "PATCH" && call.body.active === activeAfter));
  }
});

test("a missing seller update is reported as a failure instead of false success", async t => {
  const { response, calls } = await toggleSeller(t, { updateRows: [] });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /não foi alterado/i);
  assert.ok(calls.some(call => call.method === "PATCH"));
});

test("an unlinked seller cannot be reactivated without an access account", async t => {
  const { response, calls } = await toggleSeller(t, { activeBefore: false, activeAfter: true });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /não possui conta vinculada/i);
  assert.equal(calls.some(call => call.method === "PATCH"), false);
});

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

const ownSellerId = "70000000-0000-4000-8000-000000000010";
const otherSellerId = "70000000-0000-4000-8000-000000000011";

async function exerciseLeaderScope(t, role) {
  const leaderId = role === "EXECUTIVO"
    ? "70000000-0000-4000-8000-000000000020"
    : "70000000-0000-4000-8000-000000000021";
  const otherLeaderId = "70000000-0000-4000-8000-000000000022";
  const executiveId = role === "EXECUTIVO" ? leaderId : "70000000-0000-4000-8000-000000000023";
  const supervisorId = role === "SUPERVISOR" ? leaderId : "70000000-0000-4000-8000-000000000024";
  const ownSeller = {
    id: ownSellerId, slug: "seller-own", name: "Vendedor da equipe",
    phone: "11900000000", region: "Teste", active: true,
    seller_user_id: "70000000-0000-4000-8000-000000000030",
    executive_user_id: executiveId, supervisor_user_id: supervisorId
  };
  const otherSeller = {
    ...ownSeller, id: otherSellerId, slug: "seller-other", name: "Vendedor de outra equipe",
    executive_user_id: role === "EXECUTIVO" ? otherLeaderId : executiveId,
    supervisor_user_id: role === "SUPERVISOR" ? otherLeaderId : supervisorId
  };
  const requests = [];

  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    const url = new URL(input);
    requests.push({ url, method: init.method || "GET" });
    if (url.hostname !== "staging.supabase.co") throw new Error("Unexpected host " + url.hostname);
    if (url.pathname === "/auth/v1/user") return Response.json({ id: leaderId });
    if (url.pathname === "/rest/v1/user_roles") {
      const userFilter = url.searchParams.get("user_id") || "";
      if (userFilter.startsWith("eq.")) {
        const id = userFilter.slice(3);
        return Response.json(id === leaderId ? [{ user_id: id, role }] : [{ user_id: id, role: "VENDEDOR" }]);
      }
      const ids = userFilter.match(/in\.\((.*)\)/)?.[1]?.split(",") || [];
      return Response.json(ids.map(id => ({ user_id: id, role: id === leaderId ? role : id === ownSeller.seller_user_id ? "VENDEDOR" : id === otherLeaderId ? "EXECUTIVO" : id === executiveId ? "EXECUTIVO" : id === supervisorId ? "SUPERVISOR" : "VENDEDOR" })));
    }
    if (url.pathname === "/auth/v1/admin/users/" + executiveId) {
      return Response.json({ user_metadata: { name: "Executivo teste" } });
    }
    if (url.pathname === "/auth/v1/admin/users/" + supervisorId) {
      return Response.json({ user_metadata: { name: "Supervisor teste" } });
    }
    if (url.pathname === "/rest/v1/seller_onboarding") {
      return Response.json([{ seller_id: ownSellerId, email_status: "sent", whatsapp_status: "pending" }]);
    }
    if (url.pathname === "/rest/v1/sellers" && init.method === "PATCH") {
      return Response.json([{ active: false }]);
    }
    if (url.pathname === "/rest/v1/sellers") {
      const idFilter = url.searchParams.get("id");
      if (idFilter === "eq." + ownSellerId) return Response.json([ownSeller]);
      if (idFilter === "eq." + otherSellerId) return Response.json([otherSeller]);
      if (url.searchParams.has("executive_user_id") || url.searchParams.has("supervisor_user_id")) {
        return Response.json([ownSeller]);
      }
      return Response.json([]);
    }
    return Response.json([]);
  });

  const getResponse = await worker.fetch(new Request("https://wallet-staging.example.test/api/sellers", {
    headers: { authorization: "Bearer test-leader-token" }
  }), preview);
  assert.equal(getResponse.status, 200);
  const team = await getResponse.json();
  assert.deepEqual(team.sellers.map(seller => seller.id), [ownSellerId]);
  assert.ok(requests.some(({ url }) =>
    url.searchParams.get(role === "EXECUTIVO" ? "executive_user_id" : "supervisor_user_id") === "eq." + leaderId
  ));

  const inScopeResponse = await worker.fetch(new Request("https://wallet-staging.example.test/api/sellers/" + ownSellerId, {
    method: "PATCH",
    headers: { authorization: "Bearer test-leader-token", "content-type": "application/json" },
    body: JSON.stringify({ active: false })
  }), preview);
  assert.equal(inScopeResponse.status, 200);
  assert.equal((await inScopeResponse.json()).active, false);

  const beforeOutOfScope = requests.filter(({ method }) => method === "PATCH").length;
  const outOfScopeResponse = await worker.fetch(new Request("https://wallet-staging.example.test/api/sellers/" + otherSellerId, {
    method: "PATCH",
    headers: { authorization: "Bearer test-leader-token", "content-type": "application/json" },
    body: JSON.stringify({ active: false })
  }), preview);
  assert.equal(outOfScopeResponse.status, 403);
  assert.equal(requests.filter(({ method }) => method === "PATCH").length, beforeOutOfScope);
}

test("executives only list and manage sellers assigned to their team", async t => {
  await exerciseLeaderScope(t, "EXECUTIVO");
});

test("supervisors only list and manage sellers assigned to their team", async t => {
  await exerciseLeaderScope(t, "SUPERVISOR");
});

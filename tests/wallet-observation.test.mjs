import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import worker from "../src/carteira.js";

const preview = {
  WALLET_PREVIEW: "true",
  SUPABASE_URL: "https://staging.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_staging"
};

test("wallet preview embeds only its configured public Supabase credentials", async () => {
  const request = new Request("https://example.test/carteira");
  const production = await (await worker.fetch(request, {})).text();
  const html = await (await worker.fetch(request, {
    ...preview, SUPABASE_SERVICE_ROLE_KEY: "test-service-secret"
  })).text();
  assert.match(production, /xmipdjjdtruutcumhrzb\.supabase\.co/);
  assert.match(html, /https:\/\/staging\.supabase\.co/);
  assert.match(html, /sb_publishable_staging/);
  assert.doesNotMatch(html, /xmipdjjdtruutcumhrzb|test-service-secret/);
});

test("incomplete preview config blocks the wallet and seller API without contacting Supabase", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 500 }));
  for (const env of [
    { WALLET_PREVIEW: "true" },
    { ...preview, SUPABASE_PUBLISHABLE_KEY: undefined },
    { ...preview, SUPABASE_URL: undefined },
    { ...preview, SUPABASE_URL: "https://xmipdjjdtruutcumhrzb.supabase.co" }
  ]) {
    for (const path of ["/carteira", "/api/sellers"]) {
      const request = new Request("https://example.test" + path, {
        headers: { authorization: "Bearer test-token" }
      });
      const response = await worker.fetch(request, { ...env, SUPABASE_SERVICE_ROLE_KEY: "test-key" });
      assert.equal(response.status, 503);
    }
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("seller API validates the session on the configured preview Supabase", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 401 }));
  const request = new Request("https://example.test/api/sellers", {
    headers: { authorization: "Bearer test-token" }
  });
  const response = await worker.fetch(request, { ...preview, SUPABASE_SERVICE_ROLE_KEY: "test-key" });
  assert.equal(response.status, 401);
  assert.equal(fetch.mock.callCount(), 1);
  const [url, options] = fetch.mock.calls[0].arguments;
  assert.equal(url, "https://staging.supabase.co/auth/v1/user");
  assert.equal(options.headers.apikey, preview.SUPABASE_PUBLISHABLE_KEY);
});

async function wallet({ manager = true, privateFieldsError = null, saveError = null,
  callbackHash = "", session = null, passwordReady = true, loadWallet = true } = {}) {
  const html = await (await worker.fetch(new Request("https://example.test/carteira"), {})).text();
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) {
      const classes = new Set(["hidden"]);
      elements.set(id, {
        value: "",
        handlers: {},
        classList: {
          add: name => classes.add(name),
          remove: name => classes.delete(name),
          contains: name => classes.has(name)
        },
        addEventListener(event, handler) { this.handlers[event] = handler; },
        showModal() { this.open = true; },
        close() { this.open = false; this.handlers.close(); }
      });
    }
    return elements.get(id);
  };
  const lead = { id: "lead-1", name: "Lead de teste", status: "NOVO" };
  const calls = [];
  const client = {
    auth: {
      onAuthStateChange() {},
      async getSession() { return { data: { session } }; },
      async getUser() { return { data: { user: session?.user } }; }
    },
    from() {
      return { select: () => ({ order: async () => ({ data: [lead] }) }) };
    },
    async rpc(name, args) {
      calls.push([name, args === undefined ? undefined : JSON.parse(JSON.stringify(args))]);
      if (name === "wallet_password_ready") return { data: passwordReady };
      if (name === "manager_lead_private_fields") {
        return {
          error: privateFieldsError,
          data: [{ lead_id: lead.id, observation: null, crm_external_id: "CRM-123" }]
        };
      }
      assert.equal(name, "manager_update_lead_observation");
      return { data: args.p_observation, error: saveError };
    }
  };
  const context = vm.createContext({
    document: { getElementById: element },
    window: { location: { hash: callbackHash } },
    URLSearchParams,
    supabase: { createClient: () => {
      context.window.location.hash = "";
      return client;
    } },
    console: { error() {} }
  });
  await vm.runInContext(script, context);
  if (loadWallet) await vm.runInContext("isManager = " + manager + "; loadLeads()", context);

  const edit = () => element("rows").handlers.click({
    target: { closest: () => ({ dataset: { observationLead: lead.id } }) }
  });
  const submit = () => element("observationForm").handlers.submit({ preventDefault() {} });
  return { element, calls, edit, submit };
}

test("invite and recovery links show password setup before loading any wallet data", async () => {
  for (const type of ["invite", "recovery"]) {
    const { element, calls } = await wallet({
      callbackHash: "#access_token=test&type=" + type,
      session: { user: { id: "invited-user" } }, loadWallet: false
    });
    assert.equal(element("passwordPanel").classList.contains("hidden"), false);
    assert.equal(element("app").classList.contains("hidden"), true);
    assert.equal(calls.length, 0);
  }
});

test("reopening the wallet without the invite fragment still requires password setup", async () => {
  const { element, calls } = await wallet({
    session: { user: { id: "invited-user" } }, passwordReady: false, loadWallet: false
  });
  assert.equal(element("passwordPanel").classList.contains("hidden"), false);
  assert.equal(element("app").classList.contains("hidden"), true);
  assert.deepEqual(calls.map(([name]) => name), ["wallet_password_ready"]);
});

test("expired invitation does not open the password form", async () => {
  const { element } = await wallet({ callbackHash: "#type=invite", loadWallet: false });
  assert.equal(element("passwordPanel").classList.contains("hidden"), true);
  assert.match(element("loginError").textContent, /expirado/);
});

test("manager can edit and clear a note without changing the read-only CRM ID", async () => {
  const { element, calls, edit, submit } = await wallet();
  assert.match(element("rows").innerHTML, /data-observation-lead="lead-1"/);
  assert.match(element("rows").innerHTML, /<td>CRM-123<\/td>/);
  edit();
  assert.equal(element("observationDialog").open, true);
  element("observationInput").value = "  <b>Nota</b>  ";
  await submit();
  assert.deepEqual(calls[1], ["manager_update_lead_observation", {
    p_lead_id: "lead-1", p_expected_observation: null, p_observation: "<b>Nota</b>"
  }]);
  assert.match(element("rows").innerHTML, /&lt;b&gt;Nota&lt;\/b&gt;/);
  assert.match(element("rows").innerHTML, /<td>CRM-123<\/td>/);
  edit();
  element("observationInput").value = "   ";
  await submit();
  assert.equal(calls[2][1].p_observation, null);
  assert.equal(calls[2][1].p_expected_observation, "<b>Nota</b>");
});

test("oversized notes do not make a save request", async () => {
  const { element, calls, edit, submit } = await wallet();
  edit();
  element("observationInput").value = "😀".repeat(2001);
  await submit();
  assert.equal(calls.length, 1);
  assert.match(element("observationError").textContent, /2.000/);
  assert.equal(element("observationDialog").open, true);
});

test("non-managers retain the lead list without private fields or an editor", async () => {
  const { element, calls, edit, submit } = await wallet({ manager: false });
  assert.match(element("rows").innerHTML, /Lead de teste/);
  assert.doesNotMatch(element("rows").innerHTML, /data-observation-lead|CRM-123/);
  edit();
  await submit();
  assert.equal(calls.length, 0);
});

test("failed private read cannot overwrite an observation with an unloaded value", async () => {
  const { element, calls, edit, submit } = await wallet({ privateFieldsError: new Error() });
  assert.match(element("rows").innerHTML, /Lead de teste/);
  assert.doesNotMatch(element("rows").innerHTML, /data-observation-lead/);
  edit();
  await submit();
  assert.equal(calls.length, 1);
});

test("stale edit reloads the wallet without displaying the rejected value", async () => {
  const { element, calls, edit, submit } = await wallet({ saveError: { code: "PT409" } });
  edit();
  element("observationInput").value = "Edição desatualizada";
  await submit();
  assert.equal(element("observationDialog").open, false);
  assert.equal(calls[2][0], "manager_lead_private_fields");
  assert.doesNotMatch(element("rows").innerHTML, /Edição desatualizada/);
  assert.match(element("managerMessage").textContent, /Confira o valor atual/);
});

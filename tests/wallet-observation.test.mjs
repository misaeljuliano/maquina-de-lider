import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import worker from "../src/carteira.js";

const preview = {
  WALLET_PREVIEW: "true",
  WALLET_PUBLIC_ORIGIN: "https://wallet-staging.example.test",
  SUPABASE_URL: "https://staging.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_staging"
};

test("preview seller onboarding sends a staging invitation and the matching QR attachment", async t => {
  const id = "70000000-0000-4000-8000-000000000001";
  const qr = "iVBORw0KGgo=";
  const invite = "https://staging.supabase.co/auth/v1/verify?type=invite";
  let email;
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(input);
    if (url.hostname === "api.resend.com") {
      email = JSON.parse(init.body);
      return Response.json({ id: "email-test" });
    }
    assert.equal(url.hostname, "staging.supabase.co");
    if (url.pathname === "/auth/v1/user") return Response.json({ id });
    if (url.pathname === "/auth/v1/admin/generate_link") {
      assert.equal(url.searchParams.get("redirect_to"), preview.WALLET_PUBLIC_ORIGIN + "/carteira");
      assert.equal(JSON.parse(init.body).data.role, "VENDEDOR");
      return Response.json({ id, action_link: invite });
    }
    if (url.pathname === "/rest/v1/user_roles" && !init.method) {
      return Response.json([{ role: "GERENTE" }]);
    }
    return Response.json([]);
  });
  const response = await worker.fetch(new Request("https://wallet-staging.example.test/api/sellers", {
    method: "POST",
    headers: { authorization: "Bearer test-token" },
    body: JSON.stringify({
      sellerId: id, name: "Vendedor Teste", email: "seller@example.test",
      phone: "11900000000", region: "Teste", qrPng: "data:image/png;base64," + qr
    })
  }), {
    ...preview, SUPABASE_SERVICE_ROLE_KEY: "test-secret",
    RESEND_API_KEY: "test-email-secret", EMAIL_FROM: "test@example.test"
  });
  assert.equal((await response.json()).emailStatus, "sent");
  assert.ok(email.text.includes(invite));
  assert.ok(email.text.includes(preview.WALLET_PUBLIC_ORIGIN + "/?vendedor=" + id));
  assert.equal(email.attachments[0].content, qr);
});

test("wallet preview embeds only its configured public Supabase credentials", async () => {
  const request = new Request("https://example.test/carteira");
  const production = await (await worker.fetch(request, {})).text();
  const html = await (await worker.fetch(request, {
    ...preview, SUPABASE_SERVICE_ROLE_KEY: "test-service-secret"
  })).text();
  assert.match(production, /xmipdjjdtruutcumhrzb\.supabase\.co/);
  assert.match(html, /https:\/\/staging\.supabase\.co/);
  assert.match(html, /sb_publishable_staging/);
  assert.match(html, /https:\/\/wallet-staging\.example\.test/);
  assert.match(html, /<option value="PENDENTE_INSTALACAO">/);
  assert.match(html, /<option value="CONECTADO">/);
  assert.match(html, /th,td\s*\{[^}]*overflow-wrap:anywhere/s);
  assert.match(html, /\.table-wrap\s*\{\s*max-width:100%/s);
  assert.match(html, /\.table-wrap tbody tr,.team-table-wrap tbody tr\{display:block/);
  assert.match(html, /\.icon-button\{/);
  assert.match(html, /--wallet-control-height:40px/);
  assert.match(html, /\.btn\{[^}]*height:var\(--wallet-control-height\)/s);
  assert.match(html, /button\{min-height:var\(--wallet-control-height\)\}/);
  assert.match(html, /\.team-table \.danger-icon\{[^}]*height:var\(--wallet-control-height\)/s);
  assert.match(html, /\.team-table td:nth-child\(7\)\{width:36%\}/);
  assert.match(html, /\.team-table \.transfer-controls select\{flex:0 0 96px;width:96px;min-width:96px;max-width:96px/);
  assert.match(html, /<input id="sellerPhone" type="tel" class="seller-phone-field" placeholder="WhatsApp" aria-label="WhatsApp" required>/);
  assert.doesNotMatch(html, /<th>Envios<\/th>/);
  assert.match(html, /\.whatsapp-icon\{background:#31bd68!important;color:#fff!important/);
  assert.match(html, /moveTeam\.setAttribute\("aria-label", "Levar vendedores da equipe junto com o supervisor"\)/);
  assert.doesNotMatch(html, /createTextNode\("Levar equipe junto"\)/);
  assert.match(html, /group\.append\(transfer, select\)/);
  assert.match(html, /\.lead-toolbar\{display:grid;grid-template-columns:minmax\(0,3fr\) minmax\(0,1\.5fr\)/);
  assert.match(html, /move-team-symbol/);
  assert.match(html, /actionCell\.append\(group\);\s*if \(seller\.role === "SUPERVISOR"\) actionCell\.append\(moveTeamLabel\);/);
  assert.match(html, /aria-label", "Transferir " \+ seller\.name/);
  assert.match(html, /aria-label", "Abrir WhatsApp para " \+ seller\.name/);
  assert.doesNotMatch(html, /min-width:\s*900px/);
  assert.doesNotMatch(html, /Executivo \/ Coordenador/);
  assert.doesNotMatch(html, /xmipdjjdtruutcumhrzb|test-service-secret/);
});

test("incomplete preview config blocks the wallet and seller API without contacting Supabase", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 500 }));
  for (const env of [
    { WALLET_PREVIEW: "true" },
    { ...preview, SUPABASE_PUBLISHABLE_KEY: undefined },
    { ...preview, SUPABASE_URL: undefined },
    { ...preview, WALLET_PUBLIC_ORIGIN: undefined },
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

async function wallet({ manager = true, privateFieldsError = null, saveError = null, status = "NOVO",
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
  const lead = { id: "lead-1", name: "Lead de teste", status };
  const calls = [];
  const leadUpdates = [];
  const client = {
    auth: {
      onAuthStateChange() {},
      async getSession() { return { data: { session } }; },
      async getUser() { return { data: { user: session?.user } }; }
    },
    from(table) {
      return {
        select: () => ({ order: async () => ({ data: [lead] }) }),
        update(values) {
          return { eq(column, value) {
            leadUpdates.push([table, values, column, value]);
            return { select: () => ({ maybeSingle: async () => ({ data: { id: value }, error: saveError }) }) };
          } };
        }
      };
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
    console: { error() {} },
    TextEncoder, Blob, Uint8Array, Uint32Array, DataView, ArrayBuffer
  });
  await vm.runInContext(script, context);
  if (loadWallet) await vm.runInContext("isManager = " + manager + "; loadLeads()", context);

  const edit = () => element("rows").handlers.click({
    target: { closest: () => ({ dataset: { observationLead: lead.id } }) }
  });
  const submit = () => element("observationForm").handlers.submit({ preventDefault() {} });
  const setSellerMode = () => vm.runInContext("canUpdateLeadStatus = true; render()", context);
  const changeStatus = (value) => {
    const control = { value, disabled: false, isConnected: true, dataset: { leadStatus: lead.id } };
    return element("rows").handlers.change({ target: { closest: () => control } });
  };
  const workbook = () => vm.runInContext('createXlsx([["Cliente"], ["Nome de teste"]], "Clientes")', context);
  return { element, calls, edit, submit, leadUpdates, setSellerMode, changeStatus, workbook };
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
  assert.match(element("rows").innerHTML, /<td data-label="ID no CRM">CRM-123<\/td>/);
  edit();
  assert.equal(element("observationDialog").open, true);
  element("observationInput").value = "  <b>Nota</b>  ";
  await submit();
  assert.deepEqual(calls[1], ["manager_update_lead_observation", {
    p_lead_id: "lead-1", p_expected_observation: null, p_observation: "<b>Nota</b>"
  }]);
  assert.match(element("rows").innerHTML, /&lt;b&gt;Nota&lt;\/b&gt;/);
  assert.match(element("rows").innerHTML, /<td data-label="ID no CRM">CRM-123<\/td>/);
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

test("seller can change a lead status and the wallet recalculates totals", async () => {
  const walletState = await wallet({ manager: false });
  await walletState.setSellerMode();
  assert.match(walletState.element("rows").innerHTML, /data-lead-status="lead-1"/);
  await walletState.changeStatus("PROPOSTA");
  assert.deepEqual(JSON.parse(JSON.stringify(walletState.leadUpdates)), [["leads", { status: "PROPOSTA" }, "id", "lead-1"]]);
  assert.equal(walletState.element("propostas").textContent, 1);
  assert.match(walletState.element("rows").innerHTML, /<option value="PROPOSTA" selected>PROPOSTA<\/option>/);
  assert.doesNotMatch(walletState.element("rows").innerHTML, /<option value="NOVO"/);
  assert.doesNotMatch(walletState.element("rows").innerHTML, /<option value="VENDA"/);

  for (const status of ["PENDENTE_INSTALACAO", "CONECTADO"]) {
    await walletState.changeStatus(status);
    assert.equal(walletState.element("vendas").textContent, 1);
    assert.match(walletState.element("rows").innerHTML, new RegExp('<option value="' + status + '" selected>'));
  }
});

test("legacy NOVO and VENDA statuses remain visible but cannot be selected", async () => {
  for (const status of ["NOVO", "VENDA"]) {
    const walletState = await wallet({ manager: false, status });
    await walletState.setSellerMode();
    assert.match(walletState.element("rows").innerHTML, new RegExp('<option value="' + status + '" selected disabled>'));
  }
});

test("wallet exports a valid Excel workbook with the customer sheet", async () => {
  const walletState = await wallet({ manager: false });
  const workbook = walletState.workbook();
  assert.equal(workbook.type, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const bytes = Buffer.from(await workbook.arrayBuffer());
  assert.equal(bytes.readUInt32LE(0), 0x04034B50);
  assert.ok(bytes.includes(Buffer.from("xl/workbook.xml")));
  assert.ok(bytes.includes(Buffer.from("Nome de teste")));
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

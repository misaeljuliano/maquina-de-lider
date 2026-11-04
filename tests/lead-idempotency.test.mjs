import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const submissionId = "8d6f5b8e-a5d1-4e78-9ab0-3ff0185d9c12";
const payload = {
  vendor: "josi-misael",
  name: "Maria Silva",
  customer_phone: "11987654321",
  address: "Rua Um, 10",
  hasClaro: "Internet",
  product_searched: "Internet",
  submission_id: submissionId
};

function request(data = payload) {
  return new Request("https://example.test/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data)
  });
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function mockFetch(leadTable) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/sellers?")) {
      return jsonResponse([{
        id: "seller-1",
        slug: "josi-misael",
        name: "Josi Misael",
        region: "SP",
        phone: "11999990000"
      }]);
    }
    if (init.method === "POST") {
      const lead = JSON.parse(init.body);
      if (leadTable.current) return jsonResponse([]);
      leadTable.current = { ...lead, id: "lead-1" };
      return jsonResponse([leadTable.current]);
    }
    if (String(url).includes("/leads?submission_id=")) {
      return jsonResponse(leadTable.current ? [leadTable.current] : []);
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  return calls;
}

test("first submission writes caller UUID and returns saved lead", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const table = { current: null };
  const calls = mockFetch(table);

  const response = await worker.fetch(request(), { SUPABASE_SERVICE_ROLE_KEY: "test-key" });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.lead_id, "lead-1");
  assert.equal(table.current.submission_id, submissionId);
  assert.equal(calls[1].url, "https://xmipdjjdtruutcumhrzb.supabase.co/rest/v1/leads?on_conflict=submission_id");
  assert.match(calls[1].init.headers.Prefer, /resolution=ignore-duplicates/);
  assert.match(body.whatsapp_url, /^https:\/\/wa\.me\/5511999990000\?/);
});

test("identical retry returns existing lead without inserting a duplicate", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const table = { current: null };
  const calls = mockFetch(table);
  const options = { SUPABASE_SERVICE_ROLE_KEY: "test-key" };

  const first = await worker.fetch(request(), options);
  const retry = await worker.fetch(request(), options);
  const retryBody = await retry.json();

  assert.equal(first.status, 200);
  assert.equal(retry.status, 200);
  assert.equal(retryBody.lead_id, "lead-1");
  assert.equal(calls.filter(call => call.init.method === "POST").length, 2);
  assert.equal(calls.filter(call => call.url.includes("/leads?submission_id=")).length, 1);
  assert.equal(table.current.id, "lead-1");
});

test("reusing a UUID with a different payload returns 409 and preserves original lead", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const table = { current: null };
  mockFetch(table);
  const options = { SUPABASE_SERVICE_ROLE_KEY: "test-key" };

  await worker.fetch(request(), options);
  const changed = { ...payload, address: "Rua Dois, 20" };
  const response = await worker.fetch(request(changed), options);
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.match(body.error, /dados diferentes/);
  assert.equal(table.current.address, payload.address);
});

test("invalid or missing UUID is rejected before any Supabase request", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let callCount = 0;
  globalThis.fetch = async () => { callCount += 1; throw new Error("unexpected request"); };

  const missing = { ...payload };
  delete missing.submission_id;
  const malformed = { ...payload, submission_id: "not-a-uuid" };
  const first = await worker.fetch(request(missing), { SUPABASE_SERVICE_ROLE_KEY: "test-key" });
  const second = await worker.fetch(request(malformed), { SUPABASE_SERVICE_ROLE_KEY: "test-key" });

  assert.equal(first.status, 400);
  assert.equal(second.status, 400);
  assert.equal(callCount, 0);
});

test("public form creates a submission UUID once and keeps it through failed retries", async () => {
  const response = await worker.fetch(new Request("https://example.test/?vendedor=josi-misael"), {});
  const html = await response.text();
  const keyCreation = html.indexOf("pendingSubmissionId = crypto.randomUUID()");
  const payloadAssignment = html.indexOf("payload.submission_id = pendingSubmissionId");
  const fetchCall = html.indexOf("await fetch(", payloadAssignment);
  const clearAfterSuccess = html.lastIndexOf("pendingSubmissionId = null");
  const catchBlock = html.indexOf("} catch (error) {", fetchCall);

  assert.equal(response.status, 200);
  assert.ok(keyCreation >= 0);
  assert.ok(payloadAssignment > keyCreation);
  assert.ok(fetchCall > payloadAssignment);
  assert.ok(clearAfterSuccess > fetchCall);
  assert.ok(catchBlock > clearAfterSuccess);
  assert.equal(html.slice(catchBlock).includes("pendingSubmissionId = null"), false);
});

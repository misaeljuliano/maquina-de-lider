import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/carteira.js";

const userId = "70000000-0000-4000-8000-000000000001";
const env = {
  WALLET_PREVIEW:"true", WALLET_PUBLIC_ORIGIN:"https://wallet-staging.example.test",
  SUPABASE_URL:"https://staging.supabase.co", SUPABASE_PUBLISHABLE_KEY:"sb_publishable_staging",
  SUPABASE_SERVICE_ROLE_KEY:"test-secret"
};
for (const role of ["GERENTE","VENDEDOR"]) {
  test("history access for " + role, async t => {
    let historyReads = 0;
    t.mock.method(globalThis,"fetch",async (input,init={}) => {
      const url = new URL(input);
      if (url.pathname === "/auth/v1/user") return Response.json({id:userId});
      if (url.pathname === "/rest/v1/user_roles") return Response.json([{role}]);
      if (url.pathname === "/rest/v1/audit_log") {
        historyReads++;
        assert.equal(url.searchParams.get("limit"),"100");
        assert.equal(init.headers["x-wallet-actor"],userId);
        return Response.json([{id:"event",action:"UPDATE",metadata:{changes:{active:{before:true,after:false}}}}]);
      }
      throw new Error("Unexpected request");
    });
    const response = await worker.fetch(new Request("https://wallet-staging.example.test/api/sellers/history",{
      headers:{authorization:"Bearer session"}
    }),env);
    assert.equal(response.status,role === "GERENTE" ? 200 : 403);
    assert.equal(historyReads,role === "GERENTE" ? 1 : 0);
  });
}

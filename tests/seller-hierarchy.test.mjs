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

const ids = {
  manager: "70000000-0000-4000-8000-000000000001",
  executive: "70000000-0000-4000-8000-000000000002",
  executive2: "70000000-0000-4000-8000-000000000003",
  supervisor: "70000000-0000-4000-8000-000000000004",
  supervisor2: "70000000-0000-4000-8000-000000000005",
  seller: "70000000-0000-4000-8000-000000000006",
  invited: "70000000-0000-4000-8000-000000000007"
};

function json(data, status = 200) {
  return Response.json(data, { status });
}

function installAPI(t, { role, userId, team = [], profiles = [], roleMap = {}, target = null, onCall = () => {} }) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method || "GET";
    let body = null;
    if (init.body) {
      try { body = JSON.parse(init.body); } catch { body = init.body; }
    }
    calls.push({ url, method, body });
    onCall({ url, method, body });
    if (url.hostname === "api.resend.com") return json({ id: "email-test" });
    if (url.pathname === "/auth/v1/user") return json({ id: userId });
    if (url.pathname === "/auth/v1/admin/generate_link") {
      return json({ properties: { action_link: "https://auth.example.test/invite" }, user: { id: ids.invited } });
    }
    if (url.pathname.startsWith("/auth/v1/admin/users/")) {
      const id = url.pathname.split("/").pop();
      const profile = profiles.find(item => item.seller_user_id === id);
      return json({ user_metadata: { name: profile?.name || "Perfil de teste" } });
    }
    if (url.pathname === "/rest/v1/user_roles") {
      const exact = url.searchParams.get("user_id");
      if (exact?.startsWith("eq.")) return json([{ role }]);
      const foundIds = (exact?.match(/in\.\((.*)\)/)?.[1] || "").split(",");
      return json(foundIds.filter(id => roleMap[id]).map(id => ({ user_id: id, role: roleMap[id] })));
    }
    if (url.pathname === "/rest/v1/sellers") {
      if (method === "POST") return json([body]);
      if (method === "PATCH") return json([{ ...target, ...body }]);
      if (url.searchParams.has("id")) return json(target ? [target] : []);
      if (url.searchParams.has("seller_user_id")) {
        const sellerUserId = url.searchParams.get("seller_user_id").slice(3);
        return json(profiles.filter(item => item.seller_user_id === sellerUserId));
      }
      return json(team);
    }
    if (url.pathname === "/rest/v1/seller_onboarding") return json([]);
    if (url.pathname === "/rest/v1/rpc/transfer_seller_hierarchy") return json({ ok: true });
    return json([]);
  });
  return calls;
}

function createRequest(userId, payload) {
  return new Request("https://wallet-staging.example.test/api/sellers", {
    method: "POST",
    headers: { authorization: "Bearer test-token", "content-type": "application/json" },
    body: JSON.stringify({
      sellerId: "70000000-0000-4000-8000-000000000099",
      name: "Pessoa de teste",
      email: "person@example.test",
      phone: "11900000000",
      region: "Santos",
      qrPng: "data:image/png;base64,iVBORw0KGgo=",
      ...payload
    })
  });
}

test("manager can create an active hierarchy member under an executive", async t => {
  const executiveProfile = {
    id: "80000000-0000-4000-8000-000000000001", seller_user_id: ids.executive,
    name: "Executivo A", active: true, executive_user_id: null, supervisor_user_id: null
  };
  const calls = installAPI(t, {
    role: "GERENTE", userId: ids.manager, team: [executiveProfile],
    roleMap: { [ids.manager]: "GERENTE", [ids.executive]: "EXECUTIVO" }
  });

  const response = await worker.fetch(createRequest(ids.manager, {
    memberRole: "SUPERVISOR", executiveUserId: ids.executive
  }), preview);

  assert.equal(response.status, 201);
  const invite = calls.find(call => call.url.pathname === "/auth/v1/admin/generate_link");
  assert.equal(invite.body.data.role, "SUPERVISOR");
  const insertedSeller = calls.find(call => call.url.pathname === "/rest/v1/sellers" && call.method === "POST");
  assert.equal(insertedSeller.body.executive_user_id, ids.executive);
  assert.equal(insertedSeller.body.supervisor_user_id, null);
  const insertedRole = calls.find(call => call.url.pathname === "/rest/v1/user_roles" && call.method === "POST");
  assert.equal(insertedRole.body.role, "SUPERVISOR");
});

test("supervisor-created sellers inherit both direct parent assignments", async t => {
  const ownProfile = {
    id: "80000000-0000-4000-8000-000000000002", seller_user_id: ids.supervisor,
    name: "Supervisor A", active: true, executive_user_id: ids.executive, supervisor_user_id: null
  };
  const executiveProfile = {
    id: "80000000-0000-4000-8000-000000000018", seller_user_id: ids.executive,
    name: "Executivo A", active: true, executive_user_id: null, supervisor_user_id: null
  };
  const calls = installAPI(t, {
    role: "SUPERVISOR", userId: ids.supervisor, profiles: [ownProfile, executiveProfile], team: [],
    roleMap: { [ids.supervisor]: "SUPERVISOR", [ids.executive]: "EXECUTIVO" }
  });

  const response = await worker.fetch(createRequest(ids.supervisor, {}), preview);

  assert.equal(response.status, 201);
  const insertedSeller = calls.find(call => call.url.pathname === "/rest/v1/sellers" && call.method === "POST");
  assert.equal(insertedSeller.body.executive_user_id, ids.executive);
  assert.equal(insertedSeller.body.supervisor_user_id, ids.supervisor);
});

for (const moveTeam of [true, false]) {
  test("manager transfer passes the explicit team-carry choice atomically (moveTeam=" + moveTeam + ")", async t => {
    const target = {
      id: "80000000-0000-4000-8000-000000000003", seller_user_id: ids.supervisor,
      active: true, executive_user_id: ids.executive, supervisor_user_id: null
    };
    const profiles = [
      { ...target, name: "Supervisor A" },
      { id: "80000000-0000-4000-8000-000000000004", seller_user_id: ids.executive, name: "Executivo A", active: true },
      { id: "80000000-0000-4000-8000-000000000005", seller_user_id: ids.executive2, name: "Executivo B", active: true }
    ];
    const calls = installAPI(t, {
      role: "GERENTE", userId: ids.manager, team: profiles, profiles, target,
      roleMap: { [ids.manager]: "GERENTE", [ids.supervisor]: "SUPERVISOR", [ids.executive]: "EXECUTIVO", [ids.executive2]: "EXECUTIVO" }
    });

    const response = await worker.fetch(new Request("https://wallet-staging.example.test/api/sellers/" + target.id, {
      method: "PATCH", headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: JSON.stringify({ transfer: { executiveUserId: ids.executive2, moveTeam } })
    }), preview);

    assert.equal(response.status, 200);
    const transfer = calls.find(call => call.url.pathname === "/rest/v1/rpc/transfer_seller_hierarchy");
    assert.ok(transfer);
    assert.equal(transfer.body.p_new_executive_user_id, ids.executive2);
    assert.equal(transfer.body.p_move_team, moveTeam);
    assert.equal(transfer.body.p_expected_executive_user_id, ids.executive);
  });
}

test("executive cannot transfer a seller into another executive's supervisor", async t => {
  const target = {
    id: "80000000-0000-4000-8000-000000000006", seller_user_id: ids.seller,
    active: true, executive_user_id: ids.executive, supervisor_user_id: null
  };
  const destinationSupervisor = {
    id: "80000000-0000-4000-8000-000000000007", seller_user_id: ids.supervisor2,
    active: true, executive_user_id: ids.executive2, supervisor_user_id: null
  };
  const calls = installAPI(t, {
    role: "EXECUTIVO", userId: ids.executive, target,
    team: [destinationSupervisor],
    roleMap: { [ids.executive]: "EXECUTIVO", [ids.seller]: "VENDEDOR", [ids.supervisor2]: "SUPERVISOR", [ids.executive2]: "EXECUTIVO" }
  });

  const response = await worker.fetch(new Request("https://wallet-staging.example.test/api/sellers/" + target.id, {
    method: "PATCH", headers: { authorization: "Bearer test-token", "content-type": "application/json" },
    body: JSON.stringify({ transfer: { supervisorUserId: ids.supervisor2 } })
  }), preview);

  assert.equal(response.status, 403);
  assert.equal(calls.some(call => call.url.pathname === "/rest/v1/rpc/transfer_seller_hierarchy"), false);
});

test("executive can reassign a seller to a supervisor in the same team", async t => {
  const target = {
    id: "80000000-0000-4000-8000-000000000008", seller_user_id: ids.seller,
    active: true, executive_user_id: ids.executive, supervisor_user_id: null
  };
  const supervisorProfile = {
    id: "80000000-0000-4000-8000-000000000009", seller_user_id: ids.supervisor,
    active: true, executive_user_id: ids.executive, supervisor_user_id: null
  };
  const ownExecutiveProfile = {
    id: "80000000-0000-4000-8000-000000000019", seller_user_id: ids.executive,
    active: true, executive_user_id: null, supervisor_user_id: null
  };
  const calls = installAPI(t, {
    role: "EXECUTIVO", userId: ids.executive, target,
    team: [target, supervisorProfile],
    profiles: [ownExecutiveProfile],
    roleMap: { [ids.executive]: "EXECUTIVO", [ids.seller]: "VENDEDOR", [ids.supervisor]: "SUPERVISOR" }
  });

  const response = await worker.fetch(new Request("https://wallet-staging.example.test/api/sellers/" + target.id, {
    method: "PATCH", headers: { authorization: "Bearer test-token", "content-type": "application/json" },
    body: JSON.stringify({ transfer: { supervisorUserId: ids.supervisor } })
  }), preview);

  assert.equal(response.status, 200);
  const transfer = calls.find(call => call.url.pathname === "/rest/v1/rpc/transfer_seller_hierarchy");
  assert.equal(transfer.body.p_new_executive_user_id, ids.executive);
  assert.equal(transfer.body.p_new_supervisor_user_id, ids.supervisor);
});

test("supervisor can return a direct seller to its own executive", async t => {
  const target = {
    id: "80000000-0000-4000-8000-000000000010", seller_user_id: ids.seller,
    active: true, executive_user_id: ids.executive, supervisor_user_id: ids.supervisor
  };
  const ownProfile = {
    id: "80000000-0000-4000-8000-000000000011", seller_user_id: ids.supervisor,
    active: true, executive_user_id: ids.executive, supervisor_user_id: null
  };
  const executiveProfile = {
    id: "80000000-0000-4000-8000-000000000020", seller_user_id: ids.executive,
    name: "Executivo A", active: true, executive_user_id: null, supervisor_user_id: null
  };
  const calls = installAPI(t, {
    role: "SUPERVISOR", userId: ids.supervisor, target, team: [target], profiles: [ownProfile, executiveProfile],
    roleMap: { [ids.supervisor]: "SUPERVISOR", [ids.executive]: "EXECUTIVO", [ids.seller]: "VENDEDOR" }
  });

  const response = await worker.fetch(new Request("https://wallet-staging.example.test/api/sellers/" + target.id, {
    method: "PATCH", headers: { authorization: "Bearer test-token", "content-type": "application/json" },
    body: JSON.stringify({ transfer: { executiveUserId: ids.executive } })
  }), preview);

  assert.equal(response.status, 200);
  const transfer = calls.find(call => call.url.pathname === "/rest/v1/rpc/transfer_seller_hierarchy");
  assert.equal(transfer.body.p_new_executive_user_id, ids.executive);
  assert.equal(transfer.body.p_new_supervisor_user_id, null);
});

test("manager can deactivate an executive profile", async t => {
  const target = {
    id: "80000000-0000-4000-8000-000000000012", seller_user_id: ids.executive,
    name: "Executivo A", active: true, executive_user_id: null, supervisor_user_id: null
  };
  const calls = installAPI(t, {
    role: "GERENTE", userId: ids.manager, team: [target], profiles: [target],
    target, roleMap: { [ids.manager]: "GERENTE", [ids.executive]: "EXECUTIVO" }
  });

  const response = await worker.fetch(new Request("https://wallet-staging.example.test/api/sellers/" + target.id, {
    method: "PATCH", headers: { authorization: "Bearer test-token", "content-type": "application/json" },
    body: JSON.stringify({ active: false })
  }), preview);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, active: false, role: "EXECUTIVO" });
  const update = calls.find(call => call.url.pathname === "/rest/v1/sellers" && call.method === "PATCH");
  assert.deepEqual(update.body, { active: false });
});

test("manager can deactivate a supervisor profile", async t => {
  const target = {
    id: "80000000-0000-4000-8000-000000000021", seller_user_id: ids.supervisor,
    name: "Supervisor A", active: true, executive_user_id: ids.executive, supervisor_user_id: null
  };
  const calls = installAPI(t, {
    role: "GERENTE", userId: ids.manager, team: [target], profiles: [target],
    target, roleMap: { [ids.manager]: "GERENTE", [ids.supervisor]: "SUPERVISOR" }
  });

  const response = await worker.fetch(new Request("https://wallet-staging.example.test/api/sellers/" + target.id, {
    method: "PATCH", headers: { authorization: "Bearer test-token", "content-type": "application/json" },
    body: JSON.stringify({ active: false })
  }), preview);

  assert.equal(response.status, 200);
  assert.equal((await response.json()).role, "SUPERVISOR");
  assert.equal(calls.some(call => call.method === "PATCH" && call.body.active === false), true);
});

test("an executive cannot deactivate a supervisor", async t => {
  const ownProfile = { id: "80000000-0000-4000-8000-000000000013", seller_user_id: ids.executive, active: true };
  const target = {
    id: "80000000-0000-4000-8000-000000000014", seller_user_id: ids.supervisor,
    name: "Supervisor A", active: true, executive_user_id: ids.executive, supervisor_user_id: null
  };
  const calls = installAPI(t, {
    role: "EXECUTIVO", userId: ids.executive, team: [target], profiles: [ownProfile, target], target,
    roleMap: { [ids.executive]: "EXECUTIVO", [ids.supervisor]: "SUPERVISOR" }
  });

  const response = await worker.fetch(new Request("https://wallet-staging.example.test/api/sellers/" + target.id, {
    method: "PATCH", headers: { authorization: "Bearer test-token", "content-type": "application/json" },
    body: JSON.stringify({ active: false })
  }), preview);

  assert.equal(response.status, 403);
  assert.equal(calls.some(call => call.url.pathname === "/rest/v1/sellers" && call.method === "PATCH"), false);
});

test("a deactivated leader cannot manage the team", async t => {
  const ownProfile = { id: "80000000-0000-4000-8000-000000000015", seller_user_id: ids.executive, active: false };
  installAPI(t, {
    role: "EXECUTIVO", userId: ids.executive, profiles: [ownProfile],
    roleMap: { [ids.executive]: "EXECUTIVO" }
  });

  const response = await worker.fetch(new Request("https://wallet-staging.example.test/api/sellers", {
    headers: { authorization: "Bearer test-token" }
  }), preview);

  assert.equal(response.status, 403);
});

test("a supervisor cannot manage the team while its executive is inactive", async t => {
  const supervisorProfile = {
    id: "80000000-0000-4000-8000-000000000016", seller_user_id: ids.supervisor,
    active: true, executive_user_id: ids.executive
  };
  const executiveProfile = {
    id: "80000000-0000-4000-8000-000000000017", seller_user_id: ids.executive,
    active: false, executive_user_id: null
  };
  installAPI(t, {
    role: "SUPERVISOR", userId: ids.supervisor, profiles: [supervisorProfile, executiveProfile],
    roleMap: { [ids.supervisor]: "SUPERVISOR", [ids.executive]: "EXECUTIVO" }
  });

  const response = await worker.fetch(new Request("https://wallet-staging.example.test/api/sellers", {
    headers: { authorization: "Bearer test-token" }
  }), preview);

  assert.equal(response.status, 403);
});

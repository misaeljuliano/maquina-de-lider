import publicWorker from "./index.js";

const SUPABASE_URL = "https://xmipdjjdtruutcumhrzb.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_OtxakS5UtVe_2bxg0JckGg_bliWJdaG";
const QR_PRODUCTION_ORIGIN = "https://maquina-de-lider.juliano-misael.workers.dev";

const LEADER_ROLES = ["GERENTE", "EXECUTIVO", "SUPERVISOR"];
const SELLER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=UTF-8", "cache-control": "no-store" }
  });
}

function serviceHeaders(env, extra = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY || "",
    Authorization: "Bearer " + (env.SUPABASE_SERVICE_ROLE_KEY || ""),
    ...extra
  };
}

async function serviceRequest(env, endpoint, options = {}) {
  const response = await fetch(SUPABASE_URL + endpoint, {
    ...options,
    headers: serviceHeaders(env, options.headers || {})
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  return { ok: response.ok, status: response.status, data };
}

async function requireLeader(request, env) {
  const authorization = request.headers.get("authorization") || "";
  if (!/^Bearer\s+\S+$/i.test(authorization)) return { error: jsonResponse({ error: "Sessão expirada. Entre novamente." }, 401) };
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return { error: jsonResponse({ error: "Gestão de vendedores indisponível." }, 503) };
  let userResponse;
  try {
    userResponse = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: authorization }
    });
  } catch {
    return { error: jsonResponse({ error: "Não foi possível validar a sessão." }, 503) };
  }
  if (!userResponse.ok) return { error: jsonResponse({ error: "Sessão expirada. Entre novamente." }, 401) };
  const user = await userResponse.json();
  if (!SELLER_ID_RE.test(user?.id || "")) return { error: jsonResponse({ error: "Acesso não autorizado." }, 403) };
  const result = await serviceRequest(env, "/rest/v1/user_roles?user_id=eq." + user.id + "&select=role");
  if (!result.ok) return { error: jsonResponse({ error: "Não foi possível confirmar seu perfil." }, 503) };
  const roles = (result.data || []).map(row => row.role);
  const role = LEADER_ROLES.find(item => roles.includes(item));
  if (!role) return { error: jsonResponse({ error: "Somente gerente, executivo ou supervisor pode gerir vendedores." }, 403) };
  return { user, role };
}

function communicationReadiness(env) {
  const emailReady = !!(env.RESEND_API_KEY && env.EMAIL_FROM);
  return { email: emailReady, whatsapp: false, whatsappMode: "manual", ready: emailReady };
}

function qrBase64(value) {
  if (typeof value !== "string" || !value.startsWith("data:image/png;base64,")) return "";
  const encoded = value.slice("data:image/png;base64,".length);
  if (!encoded || encoded.length > 180000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return "";
  try {
    const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
    const pngHeader = [137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.length < pngHeader.length || !pngHeader.every((value, index) => bytes[index] === value)) return "";
    return encoded;
  } catch { return ""; }
}

function safeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}

function phoneDigits(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length > 11) digits = digits.slice(2);
  return digits;
}

function slugify(value) {
  return String(value || "")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 48) || "vendedor";
}

async function sendSellerEmail(env, email, name, qrUrl, qrPng, inviteUrl, slug) {
  // qrBase64() already returns the validated base64 payload, without a data URL prefix.
  const png = qrPng;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [email],
      subject: "Seu acesso e QR Code da Máquina de Líder",
      text: "Olá " + name + ". Acesse sua carteira pelo convite e use o QR Code em anexo. Link do QR: " + qrUrl + "\nAtive seu acesso: " + inviteUrl,
      html: "<p>Olá " + safeHtml(name) + ".</p><p>Seu acesso à Minha Carteira está pronto. Abra o convite para definir sua senha.</p><p><a href=\"" + safeHtml(inviteUrl) + "\">Ativar meu acesso</a></p><p>Este é seu QR Code oficial. O link permanente é <a href=\"" + safeHtml(qrUrl) + "\">" + safeHtml(qrUrl) + "</a>.</p><p>O arquivo PNG do QR Code está anexado.</p>",
      attachments: [{ filename: "qr-" + slug + ".png", content: png }]
    })
  });
  let errorMessage = "";
  if (!response.ok) {
    try {
      const payload = await response.json();
      errorMessage = String(payload?.message || payload?.name || "");
    } catch { /* Keep provider errors optional and never log credentials. */ }
  }
  return { ok: response.ok, status: response.status, errorMessage };
}

async function createInviteLink(env, email, name, role = "VENDEDOR", requestOrigin = "") {
  return serviceRequest(env, "/auth/v1/admin/generate_link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "invite", email,
      data: { name, role },
      redirect_to: walletPublicOrigin(env, requestOrigin) + "/carteira"
    })
  });
}

function generatedActionLink(result) {
  return result?.data?.properties?.action_link || result?.data?.action_link;
}

function generatedUserId(result) {
  return result?.data?.user?.id || result?.data?.user_id || result?.data?.id;
}

async function findPendingAuthUser(env, email) {
  const result = await serviceRequest(env, "/auth/v1/admin/users?page=1&per_page=1000");
  const users = Array.isArray(result.data?.users) ? result.data.users : Array.isArray(result.data) ? result.data : [];
  if (!result.ok) return null;
  const user = users.find(item => String(item.email || "").toLowerCase() === email.toLowerCase());
  if (!user || user.confirmed_at || !user.invited_at || !SELLER_ID_RE.test(user.id || "")) return null;
  return user;
}

async function createRecoveryLink(env, email, requestOrigin = "") {
  return serviceRequest(env, "/auth/v1/admin/generate_link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "recovery", email,
      redirect_to: walletPublicOrigin(env, requestOrigin) + "/carteira"
    })
  });
}

async function createSellerAuthLink(env, email, name, requestOrigin = "") {
  const invite = await createInviteLink(env, email, name, "VENDEDOR", requestOrigin);
  const inviteUrl = generatedActionLink(invite);
  const userId = generatedUserId(invite);
  if (invite.ok && SELLER_ID_RE.test(userId || "") && typeof inviteUrl === "string") {
    return { ...invite, userId, inviteUrl };
  }
  if (invite.status !== 422) return { ...invite, userId, inviteUrl };

  const pendingUser = await findPendingAuthUser(env, email);
  if (!pendingUser) return { ...invite, userId, inviteUrl };
  const recovery = await createRecoveryLink(env, email, requestOrigin);
  return {
    ...recovery,
    userId: pendingUser.id,
    inviteUrl: generatedActionLink(recovery)
  };
}

function walletPublicOrigin(env, requestOrigin = "") {
  if (env.WALLET_PREVIEW === "true") {
    try {
      const request = new URL(String(requestOrigin || ""));
      if (request.protocol === "https:" && request.origin === requestOrigin && request.hostname.endsWith(".workers.dev")) return request.origin;
    } catch { /* Preview must never fall back to production. */ }
    try {
      const configured = new URL(String(env.WALLET_PUBLIC_ORIGIN || ""));
      if (configured.protocol === "https:" && configured.origin === env.WALLET_PUBLIC_ORIGIN && configured.hostname.endsWith(".workers.dev")) return configured.origin;
    } catch { /* Preview must never fall back to production. */ }
    return "";
  }
  return QR_PRODUCTION_ORIGIN;
}

async function createLeaderAuthLink(env, email, name, role, requestOrigin = "") {
  const invite = await createInviteLink(env, email, name, role, requestOrigin);
  const inviteUrl = generatedActionLink(invite);
  const userId = generatedUserId(invite);
  if (invite.ok && SELLER_ID_RE.test(userId || "") && typeof inviteUrl === "string") {
    return { ...invite, userId, inviteUrl };
  }
  // Do not reuse an existing account or alter its role when inviting a leader.
  return { ...invite, userId, inviteUrl };
}

async function sendLeaderInviteEmail(env, email, name, role, inviteUrl) {
  const roleLabel = role === "EXECUTIVO" ? "Executivo/Coordenador" : "Supervisor";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [email],
      subject: "Seu acesso de " + roleLabel + " à Máquina de Líder",
      text: "Olá " + name + ". Seu perfil de " + roleLabel + " está pronto. Abra o convite para definir sua senha: " + inviteUrl,
      html: "<p>Olá " + safeHtml(name) + ".</p><p>Seu perfil de " + safeHtml(roleLabel) + " na Máquina de Líder está pronto.</p><p><a href=\"" + safeHtml(inviteUrl) + "\">Ativar meu acesso e definir senha</a></p>"
    })
  });
  let errorMessage = "";
  if (!response.ok) {
    try {
      const payload = await response.json();
      errorMessage = String(payload?.message || payload?.name || "");
    } catch { /* Keep provider errors optional and never log credentials. */ }
  }
  return { ok: response.ok, status: response.status, errorMessage };
}

async function getLeaderHierarchyRows(env) {
  const response = await serviceRequest(env,
    "/rest/v1/leader_hierarchy?select=user_id,role,executive_user_id,created_by_user_id,invite_email_status,invite_email_error,invite_attempt_count,created_at&order=created_at.asc"
  );
  return response.ok && Array.isArray(response.data) ? response.data : null;
}

async function getRoleRows(env, roles = ["EXECUTIVO", "SUPERVISOR"]) {
  const response = await serviceRequest(env,
    "/rest/v1/user_roles?role=in.(" + roles.join(",") + ")&select=user_id,role"
  );
  return response.ok && Array.isArray(response.data) ? response.data : null;
}

async function getTeamRows(env, leader) {
  const params = new URLSearchParams({
    select: "id,slug,name,phone,region,active,seller_user_id,supervisor_user_id,executive_user_id",
    order: "name.asc"
  });
  if (leader.role === "EXECUTIVO") {
    const hierarchy = await getLeaderHierarchyRows(env);
    if (!hierarchy) return null;
    const supervisorIds = hierarchy
      .filter(item => item.role === "SUPERVISOR" && item.executive_user_id === leader.user.id)
      .map(item => item.user_id);
    if (supervisorIds.length) {
      params.set("or", "(executive_user_id.eq." + leader.user.id
        + ",supervisor_user_id.in.(" + supervisorIds.join(",") + "))");
    } else {
      params.set("executive_user_id", "eq." + leader.user.id);
    }
  }
  if (leader.role === "SUPERVISOR") params.set("supervisor_user_id", "eq." + leader.user.id);
  const result = await serviceRequest(env, "/rest/v1/sellers?" + params.toString());
  return result.ok && Array.isArray(result.data) ? result.data : null;
}

async function getAdminUserLabel(env, userId) {
  if (!SELLER_ID_RE.test(userId || "")) return "";
  const result = await serviceRequest(env, "/auth/v1/admin/users/" + userId);
  if (!result.ok) return "";
  return result.data?.user_metadata?.name || "Usuário " + userId.slice(0, 8);
}

async function getSellerRoles(env, userIds) {
  const ids = [...new Set(userIds.filter(id => SELLER_ID_RE.test(id || "")))];
  if (!ids.length) return {};
  const response = await serviceRequest(env, "/rest/v1/user_roles?user_id=in.(" + ids.join(",") + ")&select=user_id,role");
  if (!response.ok) return {};
  return Object.fromEntries((response.data || []).map(item => [item.user_id, item.role]));
}

async function getAdminUserLabels(env, userIds) {
  const ids = [...new Set(userIds.filter(id => SELLER_ID_RE.test(id || "")))];
  if (!ids.length) return {};
  const result = await serviceRequest(env, "/auth/v1/admin/users?page=1&per_page=1000");
  const users = Array.isArray(result.data?.users) ? result.data.users : Array.isArray(result.data) ? result.data : [];
  if (!result.ok) return Object.fromEntries(ids.map(id => [id, "Usuário " + id.slice(0, 8)]));
  const wanted = new Set(ids);
  return Object.fromEntries(users
    .filter(user => wanted.has(user.id))
    .map(user => [user.id, user.user_metadata?.name || "Usuário " + user.id.slice(0, 8)]));
}

async function getLeaderDirectory(env, leader) {
  const [roleRows, hierarchyRows] = await Promise.all([
    getRoleRows(env),
    getLeaderHierarchyRows(env)
  ]);
  if (!roleRows || !hierarchyRows) return null;
  const executives = roleRows.filter(row => row.role === "EXECUTIVO");
  const executiveIds = new Set(executives.map(row => row.user_id));
  const supervisors = hierarchyRows
    .filter(row => row.role === "SUPERVISOR" && roleRows.some(role => role.user_id === row.user_id && role.role === "SUPERVISOR"));
  const labels = await getAdminUserLabels(env, [
    ...executives.map(row => row.user_id),
    ...supervisors.map(row => row.user_id)
  ]);
  const execHierarchy = hierarchyRows.filter(row => row.role === "EXECUTIVO" && executiveIds.has(row.user_id));
  const visibleLeaders = leader.role === "GERENTE"
    ? [
        ...execHierarchy.map(row => ({ userId: row.user_id, role: row.role, executiveUserId: null, createdByUserId: row.created_by_user_id, inviteEmailStatus: row.invite_email_status })),
        ...supervisors.map(row => ({ userId: row.user_id, role: row.role, executiveUserId: row.executive_user_id, createdByUserId: row.created_by_user_id, inviteEmailStatus: row.invite_email_status }))
      ]
    : leader.role === "EXECUTIVO"
      ? supervisors.filter(row => row.executive_user_id === leader.user.id).map(row => ({
          userId: row.user_id, role: row.role, executiveUserId: row.executive_user_id,
          createdByUserId: row.created_by_user_id, inviteEmailStatus: row.invite_email_status
        }))
      : [];

  const assignableExecutives = leader.role === "GERENTE"
    ? executives.map(row => ({ id: row.user_id, label: labels[row.user_id] || "Usuário " + row.user_id.slice(0, 8) }))
    : leader.role === "SUPERVISOR"
      ? supervisors.filter(row => row.user_id === leader.user.id && row.executive_user_id)
          .map(row => ({ id: row.executive_user_id, label: labels[row.executive_user_id] || "Executivo/Coordenador" }))
      : [];
  const assignableSupervisors = leader.role === "GERENTE"
    ? supervisors.map(row => ({
        id: row.user_id, executiveUserId: row.executive_user_id,
        label: labels[row.user_id] || "Usuário " + row.user_id.slice(0, 8)
      }))
    : leader.role === "EXECUTIVO"
      ? supervisors.filter(row => row.executive_user_id === leader.user.id).map(row => ({
          id: row.user_id, executiveUserId: row.executive_user_id,
          label: labels[row.user_id] || "Usuário " + row.user_id.slice(0, 8)
        }))
      : supervisors.filter(row => row.executive_user_id && row.executive_user_id === assignableExecutives[0]?.id
          && row.user_id !== leader.user.id).map(row => ({
            id: row.user_id, executiveUserId: row.executive_user_id,
            label: labels[row.user_id] || "Usuário " + row.user_id.slice(0, 8)
          }));

  const transferTargets = [];
  const addTarget = (executiveUserId, supervisorUserId, label) => {
    const key = (executiveUserId || "") + "|" + (supervisorUserId || "");
    if (!transferTargets.some(item => item.key === key)) transferTargets.push({ key, executiveUserId, supervisorUserId, label });
  };
  if (leader.role === "GERENTE") {
    addTarget(null, null, "Carteira do Gerente");
    executives.forEach(row => addTarget(row.user_id, null, "Direto para " + (labels[row.user_id] || "Executivo/Coordenador")));
    supervisors.forEach(row => addTarget(row.executive_user_id, row.user_id,
      "Supervisor: " + (labels[row.user_id] || "Usuário " + row.user_id.slice(0, 8))));
  } else if (leader.role === "EXECUTIVO") {
    addTarget(leader.user.id, null, "Carteira do Executivo/Coordenador");
    assignableSupervisors.forEach(row => addTarget(leader.user.id, row.id, "Supervisor: " + row.label));
  } else if (leader.role === "SUPERVISOR") {
    if (assignableExecutives.length) {
      addTarget(assignableExecutives[0].id, null, "Carteira do Executivo/Coordenador");
      assignableSupervisors.forEach(row => addTarget(row.executiveUserId, row.id, "Supervisor: " + row.label));
    } else {
      addTarget(null, null, "Carteira do Gerente");
    }
  }

  return {
    visibleLeaders: visibleLeaders.map(item => ({
      ...item,
      label: labels[item.userId] || "Usuário " + item.userId.slice(0, 8),
      executiveLabel: item.executiveUserId ? labels[item.executiveUserId] || "Executivo/Coordenador" : "Gerência"
    })),
    assignableExecutives,
    assignableSupervisors,
    transferTargets,
    executiveChoices: leader.role === "GERENTE" ? executives.map(row => ({
      id: row.user_id, label: labels[row.user_id] || "Usuário " + row.user_id.slice(0, 8)
    })) : []
  };
}

async function getOnboardingMap(env, sellers) {
  if (!sellers.length) return new Map();
  const ids = sellers.map(seller => seller.id).filter(id => SELLER_ID_RE.test(id || ""));
  if (!ids.length) return new Map();
  const response = await serviceRequest(env, "/rest/v1/seller_onboarding?seller_id=in.(" + ids.join(",") + ")&select=seller_id,email_status,whatsapp_status,email_error,whatsapp_error,attempt_count");
  if (!response.ok) return new Map();
  return new Map((response.data || []).map(item => [item.seller_id, item]));
}

async function leaderHierarchyApi(request, env, url) {
  const leader = await requireLeader(request, env);
  if (leader.error) return leader.error;
  const route = url.pathname.match(/^\/api\/leaders\/([0-9a-f-]+)(?:\/retry)?$/i);

  if (request.method === "GET" && url.pathname === "/api/leaders") {
    const directory = await getLeaderDirectory(env, leader);
    if (!directory) return jsonResponse({ error: "Não foi possível carregar a hierarquia." }, 503);
    return jsonResponse({ role: leader.role, ...directory });
  }

  if (request.method === "POST" && url.pathname === "/api/leaders") {
    if (!communicationReadiness(env).ready) return jsonResponse({ error: "O envio automático de e-mail ainda não está configurado." }, 503);
    const body = await request.json().catch(() => null);
    if (!body) return jsonResponse({ error: "Dados do líder inválidos." }, 400);
    const role = String(body.role || "");
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const executiveUserId = body.executiveUserId || null;
    const mayCreate = (leader.role === "GERENTE" && ["EXECUTIVO", "SUPERVISOR"].includes(role))
      || (leader.role === "EXECUTIVO" && role === "SUPERVISOR");
    if (!mayCreate) return jsonResponse({ error: "Seu perfil não pode cadastrar esse nível." }, 403);
    if (name.length < 2 || name.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return jsonResponse({ error: "Confira o nome e o e-mail." }, 400);
    }
    const parentId = role === "EXECUTIVO" ? null : leader.role === "EXECUTIVO" ? leader.user.id : executiveUserId;
    if (role === "SUPERVISOR" && parentId && !SELLER_ID_RE.test(parentId)) return jsonResponse({ error: "Executivo inválido." }, 400);
    if (role === "SUPERVISOR" && leader.role === "GERENTE" && parentId) {
      const roles = await getSellerRoles(env, [parentId]);
      if (roles[parentId] !== "EXECUTIVO") return jsonResponse({ error: "Selecione um Executivo/Coordenador válido." }, 400);
    }
    const invite = await createLeaderAuthLink(env, email, name, role, url.origin);
    const userId = invite.userId;
    if (!invite.ok || !SELLER_ID_RE.test(userId || "") || !invite.inviteUrl) {
      return jsonResponse({ error: invite.status === 422 ? "Já existe uma conta com esse e-mail; use um e-mail ainda não cadastrado." : "Não foi possível gerar o convite." }, invite.status === 422 ? 409 : 502);
    }
    const roleInsert = await serviceRequest(env, "/rest/v1/user_roles", {
      method: "POST", headers: { "content-type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ user_id: userId, role })
    });
    const hierarchyInsert = roleInsert.ok ? await serviceRequest(env, "/rest/v1/leader_hierarchy", {
      method: "POST", headers: { "content-type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ user_id: userId, role, executive_user_id: parentId, created_by_user_id: leader.user.id, invite_email_status: "pending" })
    }) : { ok: false };
    if (!roleInsert.ok || !hierarchyInsert.ok) {
      if (roleInsert.ok) await serviceRequest(env, "/rest/v1/user_roles?user_id=eq." + userId + "&role=eq." + role, { method: "DELETE" });
      await serviceRequest(env, "/auth/v1/admin/users/" + userId, { method: "DELETE" });
      return jsonResponse({ error: "Não foi possível salvar o novo perfil." }, 503);
    }
    const emailResult = await sendLeaderInviteEmail(env, email, name, role, invite.inviteUrl).catch(() => ({ ok: false, status: 502 }));
    const detail = emailResult.ok ? null : "Falha no provedor de e-mail (HTTP " + emailResult.status + ")";
    await serviceRequest(env, "/rest/v1/leader_hierarchy?user_id=eq." + userId, {
      method: "PATCH", headers: { "content-type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ invite_email_status: emailResult.ok ? "sent" : "failed", invite_email_error: detail, invite_attempt_count: 1, updated_at: new Date().toISOString() })
    });
    if (!emailResult.ok) return jsonResponse({ created: true, userId, role, emailStatus: "failed", message: "Perfil criado, mas o e-mail falhou. Use Reenviar convite na lista." }, 201);
    return jsonResponse({ created: true, userId, role, emailStatus: "sent", message: "Convite enviado por e-mail." }, 201);
  }

  if (request.method === "POST" && route && url.pathname.endsWith("/retry")) {
    const rowResponse = await serviceRequest(env, "/rest/v1/leader_hierarchy?user_id=eq." + route[1] + "&select=user_id,role,executive_user_id,invite_attempt_count");
    const target = rowResponse.data?.[0];
    if (!target) return jsonResponse({ error: "Líder não encontrado." }, 404);
    const inScope = leader.role === "GERENTE"
      || (leader.role === "EXECUTIVO" && target.role === "SUPERVISOR" && target.executive_user_id === leader.user.id);
    if (!inScope) return jsonResponse({ error: "Esse líder não pertence à sua equipe." }, 403);
    const authUser = await serviceRequest(env, "/auth/v1/admin/users/" + target.user_id);
    const email = authUser.data?.email;
    const name = authUser.data?.user_metadata?.name || "Líder";
    if (!email) return jsonResponse({ error: "Não foi possível localizar o e-mail do convite." }, 503);
    const recovery = await createRecoveryLink(env, email, url.origin);
    const inviteUrl = generatedActionLink(recovery);
    if (!recovery.ok || !inviteUrl) return jsonResponse({ error: "Não foi possível recriar o link de acesso." }, 502);
    const emailResult = await sendLeaderInviteEmail(env, email, name, target.role, inviteUrl).catch(() => ({ ok: false, status: 502 }));
    await serviceRequest(env, "/rest/v1/leader_hierarchy?user_id=eq." + target.user_id, {
      method: "PATCH", headers: { "content-type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ invite_email_status: emailResult.ok ? "sent" : "failed", invite_email_error: emailResult.ok ? null : "Falha no provedor de e-mail (HTTP " + emailResult.status + ")", invite_attempt_count: (target.invite_attempt_count || 0) + 1, updated_at: new Date().toISOString() })
    });
    if (!emailResult.ok) return jsonResponse({ error: "O provedor de e-mail não confirmou o envio." }, 502);
    return jsonResponse({ ok: true, message: "Convite reenviado." });
  }

  if (request.method === "PATCH" && route) {
    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: "Dados de transferência inválidos." }, 400); }
    if (leader.role !== "GERENTE") return jsonResponse({ error: "Somente a Gerência pode transferir Supervisores entre Executivos." }, 403);
    if (body.executiveUserId && !SELLER_ID_RE.test(body.executiveUserId)) return jsonResponse({ error: "Executivo inválido." }, 400);
    const result = await serviceRequest(env, "/rest/v1/rpc/transfer_supervisor_wallet", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        p_actor_user_id: leader.user.id, p_supervisor_user_id: route[1],
        p_target_executive_user_id: body.executiveUserId || null, p_carry_sellers: body.carrySellers === true
      })
    });
    if (!result.ok) return jsonResponse({ error: "Não foi possível transferir o Supervisor. Confira a equipe de destino." }, result.status === 403 ? 403 : 409);
    return jsonResponse({ ok: true, result: result.data });
  }
  return jsonResponse({ error: "Ação não permitida." }, 405);
}

async function transferSellerApi(request, env, url, leader) {
  const route = url.pathname.match(/^\/api\/sellers\/([0-9a-f-]+)\/transfer$/i);
  if (request.method !== "POST" || !route) return null;
  if (leader.error) return leader.error;
  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: "Dados de transferência inválidos." }, 400); }
  const directory = await getLeaderDirectory(env, leader);
  if (!directory) return jsonResponse({ error: "Não foi possível validar a hierarquia." }, 503);
  const target = directory.transferTargets.find(item => item.key === String(body.targetKey || ""));
  if (!target) return jsonResponse({ error: "Escolha uma carteira de destino permitida." }, 400);
  const result = await serviceRequest(env, "/rest/v1/rpc/transfer_seller_wallet", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ p_actor_user_id: leader.user.id, p_seller_id: route[1], p_target_executive_user_id: target.executiveUserId, p_target_supervisor_user_id: target.supervisorUserId })
  });
  if (!result.ok) return jsonResponse({ error: "Não foi possível transferir o vendedor para essa carteira." }, result.status === 403 ? 403 : 409);
  return jsonResponse({ ok: true, result: result.data });
}

async function leaderSellersApi(request, env, url) {
  const leader = await requireLeader(request, env);
  if (leader.error) return leader.error;
  if (url.pathname.endsWith("/transfer")) return transferSellerApi(request, env, url, leader);
  const readiness = communicationReadiness(env);
  const onboardingRoute = url.pathname.match(/^\/api\/sellers\/([0-9a-f-]+)\/retry$/i);
  const sellerRoute = url.pathname.match(/^\/api\/sellers\/([0-9a-f-]+)$/i);

  if (request.method === "GET" && url.pathname === "/api/sellers") {
    const sellers = await getTeamRows(env, leader);
    if (!sellers) return jsonResponse({ error: "Não foi possível carregar sua equipe." }, 503);
    const onboarding = await getOnboardingMap(env, sellers);
    const directory = await getLeaderDirectory(env, leader);
    if (!directory) return jsonResponse({ error: "Não foi possível carregar a hierarquia." }, 503);
    return jsonResponse({
      role: leader.role,
      readiness,
      assignableExecutives: directory.assignableExecutives,
      assignableSupervisors: directory.assignableSupervisors,
      transferTargets: directory.transferTargets,
      sellers: sellers.map(seller => ({
        ...seller,
        onboarding: onboarding.get(seller.id) || null
      }))
    });
  }

  if (request.method === "POST" && url.pathname === "/api/sellers") {
    if (!readiness.ready) return jsonResponse({ error: "O envio automático de e-mail ainda não está configurado.", readiness }, 503);
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 220000) return jsonResponse({ error: "Imagem QR muito grande." }, 413);
    let body;
    try {
      const raw = await request.text();
      if (raw.length > 220000) return jsonResponse({ error: "Imagem QR muito grande." }, 413);
      body = JSON.parse(raw);
    } catch { return jsonResponse({ error: "Dados do vendedor inválidos." }, 400); }
    const id = String(body.sellerId || "");
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const digits = phoneDigits(body.phone);
    const region = String(body.region || "Santos").trim();
    const qrPng = qrBase64(body.qrPng);
    if (!SELLER_ID_RE.test(id) || name.length < 2 || name.length > 120
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254
      || ![10, 11].includes(digits.length) || region.length < 2 || region.length > 80 || !qrPng) {
      return jsonResponse({ error: "Confira nome, e-mail, telefone e região do vendedor." }, 400);
    }

    let executiveUserId = null;
    let supervisorUserId = null;
    const team = await getTeamRows(env, leader);
    if (!team) return jsonResponse({ error: "Não foi possível validar os limites da equipe." }, 503);
    const directory = await getLeaderDirectory(env, leader);
    if (!directory) return jsonResponse({ error: "Não foi possível validar a hierarquia." }, 503);
    if (leader.role === "GERENTE") {
      executiveUserId = body.executiveUserId || null;
      supervisorUserId = body.supervisorUserId || null;
      if (supervisorUserId) {
        const assignedSupervisor = directory.assignableSupervisors.find(item => item.id === supervisorUserId);
        if (!assignedSupervisor || (executiveUserId && assignedSupervisor.executiveUserId !== executiveUserId)) {
          return jsonResponse({ error: "O Executivo/Coordenador deve corresponder ao Supervisor escolhido." }, 400);
        }
        executiveUserId = assignedSupervisor.executiveUserId || null;
      }
      if (executiveUserId && !SELLER_ID_RE.test(executiveUserId)) return jsonResponse({ error: "Executivo inválido." }, 400);
      if (supervisorUserId && !SELLER_ID_RE.test(supervisorUserId)) return jsonResponse({ error: "Supervisor inválido." }, 400);
    } else if (leader.role === "EXECUTIVO") {
      executiveUserId = leader.user.id;
      supervisorUserId = body.supervisorUserId || null;
      if (supervisorUserId && !directory.assignableSupervisors.some(item => item.id === supervisorUserId)) return jsonResponse({ error: "Esse supervisor não pertence à sua equipe." }, 403);
    } else {
      supervisorUserId = leader.user.id;
      executiveUserId = directory.assignableExecutives[0]?.id || null;
      if (body.executiveUserId && body.executiveUserId !== executiveUserId) return jsonResponse({ error: "Esse executivo não pertence à sua hierarquia." }, 403);
    }

    const roleIds = [executiveUserId, supervisorUserId].filter(Boolean);
    const roleMap = await getSellerRoles(env, roleIds);
    if ((executiveUserId && roleMap[executiveUserId] !== "EXECUTIVO")
      || (supervisorUserId && roleMap[supervisorUserId] !== "SUPERVISOR")) {
      return jsonResponse({ error: "A atribuição precisa apontar para contas já cadastradas no perfil correspondente." }, 400);
    }

    const invite = await createSellerAuthLink(env, email, name, url.origin);
    const inviteUrl = invite.inviteUrl;
    const userId = invite.userId;
    if (!invite.ok || !SELLER_ID_RE.test(userId || "") || typeof inviteUrl !== "string") {
      return jsonResponse({ error: invite.status === 422 ? "Já existe uma conta com esse e-mail." : "Não foi possível criar o convite de acesso." }, invite.status === 422 ? 409 : 502);
    }

    const sellerSlug = slugify(name) + "-" + id.slice(0, 8);
    const sellerInsert = await serviceRequest(env, "/rest/v1/sellers", {
      method: "POST",
      headers: { "content-type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({
        id, slug: sellerSlug, name, phone: digits, region, active: false,
        seller_user_id: userId, executive_user_id: executiveUserId, supervisor_user_id: supervisorUserId
      })
    });
    if (!sellerInsert.ok) {
      await serviceRequest(env, "/auth/v1/admin/users/" + userId, { method: "DELETE" });
      return jsonResponse({ error: sellerInsert.status === 409 ? "Já existe um vendedor com esse identificador." : "Não foi possível salvar o vendedor." }, 409);
    }

    const roleInsert = await serviceRequest(env, "/rest/v1/user_roles", {
      method: "POST", headers: { "content-type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ user_id: userId, role: "VENDEDOR" })
    });
    const onboardingInsert = roleInsert.ok ? await serviceRequest(env, "/rest/v1/seller_onboarding", {
      method: "POST", headers: { "content-type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ seller_id: id, email_status: "pending", whatsapp_status: "pending", attempt_count: 0 })
    }) : { ok: false };
    if (!roleInsert.ok || !onboardingInsert.ok) {
      await serviceRequest(env, "/rest/v1/sellers?id=eq." + id, { method: "DELETE" });
      await serviceRequest(env, "/auth/v1/admin/users/" + userId, { method: "DELETE" });
      return jsonResponse({ error: "Não foi possível concluir o cadastro. Nenhum vendedor foi ativado." }, 503);
    }

    return await deliverSellerOnboarding(env, {
      id, slug: sellerSlug, name, email, phone: digits, userId, inviteUrl, qrPng, retry: false
    });
  }

  if ((request.method === "PATCH" && sellerRoute) || (request.method === "POST" && onboardingRoute)) {
    const id = sellerRoute?.[1] || onboardingRoute?.[1];
    if (!SELLER_ID_RE.test(id || "")) return jsonResponse({ error: "Vendedor inválido." }, 400);
    const targetResult = await serviceRequest(env, "/rest/v1/sellers?id=eq." + id + "&select=id,slug,name,phone,active,seller_user_id,supervisor_user_id,executive_user_id");
    const target = targetResult.data?.[0];
    if (!target) return jsonResponse({ error: "Vendedor não encontrado." }, 404);
    const inScope = leader.role === "GERENTE"
      || (leader.role === "EXECUTIVO" && target.executive_user_id === leader.user.id)
      || (leader.role === "SUPERVISOR" && target.supervisor_user_id === leader.user.id);
    if (!inScope) return jsonResponse({ error: "Esse vendedor não pertence à sua equipe." }, 403);

    if (request.method === "PATCH") {
      let body;
      try { body = await request.json(); } catch { return jsonResponse({ error: "Ação inválida." }, 400); }
      if (typeof body.active !== "boolean") return jsonResponse({ error: "Informe o novo estado do vendedor." }, 400);
      if (body.active) {
        const onboarding = await serviceRequest(env, "/rest/v1/seller_onboarding?seller_id=eq." + id + "&select=email_status,whatsapp_status");
        const state = onboarding.data?.[0];
        if (state && state.email_status !== "sent") return jsonResponse({ error: "O vendedor só pode ser reativado depois que o convite por e-mail for confirmado." }, 409);
        if (!target.seller_user_id) return jsonResponse({ error: "Este vendedor ainda não possui conta vinculada." }, 409);
      }
      const update = await serviceRequest(env, "/rest/v1/sellers?id=eq." + id, {
        method: "PATCH", headers: { "content-type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify({ active: body.active })
      });
      if (!update.ok) return jsonResponse({ error: "Não foi possível alterar o acesso do vendedor." }, 503);
      return jsonResponse({ ok: true, active: body.active });
    }

    if (!readiness.ready) return jsonResponse({ error: "O envio automático de e-mail ainda não está configurado.", readiness }, 503);
    const raw = await request.text();
    if (raw.length > 220000) return jsonResponse({ error: "Imagem QR muito grande." }, 413);
    let body;
    try { body = JSON.parse(raw); } catch { return jsonResponse({ error: "Imagem QR inválida." }, 400); }
    const qrPng = qrBase64(body.qrPng);
    if (!qrPng) return jsonResponse({ error: "Imagem QR inválida." }, 400);
    const onboarding = await serviceRequest(env, "/rest/v1/seller_onboarding?seller_id=eq." + id + "&select=email_status,whatsapp_status");
    if (!onboarding.data?.length) return jsonResponse({ error: "Não há envios pendentes para esse vendedor." }, 409);
    const authUser = await serviceRequest(env, "/auth/v1/admin/users/" + target.seller_user_id);
    const email = authUser.data?.email;
    if (!email) return jsonResponse({ error: "Não foi possível localizar o e-mail de convite." }, 503);
    const invite = onboarding.data[0].email_status === "sent" ? null : await createSellerAuthLink(env, email, target.name, url.origin);
    const inviteUrl = invite?.inviteUrl;
    if (invite && (!invite.ok || typeof inviteUrl !== "string")) return jsonResponse({ error: "Não foi possível recriar o convite por e-mail." }, 502);
    return await deliverSellerOnboarding(env, {
      id, slug: target.slug, name: target.name, email, phone: target.phone, userId: target.seller_user_id, active: target.active,
      inviteUrl, qrPng, retry: true, onboarding: onboarding.data[0]
    });
  }

  return jsonResponse({ error: "Ação não permitida." }, 405);
}

async function deliverSellerOnboarding(env, seller) {
  const qrUrl = QR_PRODUCTION_ORIGIN + "/?vendedor=" + encodeURIComponent(seller.id);
  const emailStatus = seller.retry ? seller.onboarding.email_status : "pending";
  let emailResult = { ok: emailStatus === "sent", status: 200 };
  if (emailStatus !== "sent") {
    try { emailResult = await sendSellerEmail(env, seller.email, seller.name, qrUrl, seller.qrPng, seller.inviteUrl, seller.slug); }
    catch { emailResult = { ok: false, status: 502 }; }
  }
  const nextEmail = emailResult.ok ? "sent" : "failed";
  const providerDetail = String(emailResult.errorMessage || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/re_[A-Za-z0-9_-]{10,}/g, "[redigido]")
    .slice(0, 180);
  // WhatsApp stays manual so seller onboarding cannot trigger Meta message charges.
  const nextWhatsapp = seller.onboarding?.whatsapp_status || "pending";
  await serviceRequest(env, "/rest/v1/seller_onboarding?seller_id=eq." + seller.id, {
    method: "PATCH", headers: { "content-type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({
      email_status: nextEmail, whatsapp_status: nextWhatsapp,
      email_error: emailResult.ok ? null : "Falha no provedor de e-mail (HTTP " + emailResult.status + ")" + (providerDetail ? ": " + providerDetail : ""),
      whatsapp_error: null,
      attempt_count: (seller.onboarding?.attempt_count || 0) + 1,
      updated_at: new Date().toISOString()
    })
  });
  const active = seller.retry ? !!seller.active : nextEmail === "sent";
  if (!seller.retry && active) {
    await serviceRequest(env, "/rest/v1/sellers?id=eq." + seller.id, {
      method: "PATCH", headers: { "content-type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ active: true })
    });
  }
  return jsonResponse({
    created: !seller.retry, id: seller.id, active,
    emailStatus: nextEmail, whatsappStatus: "manual",
    whatsappUrl: buildWhatsappInviteUrl(seller.phone, seller.name, qrUrl),
    message: nextEmail !== "sent"
      ? "Cadastro salvo, mas o e-mail não foi confirmado. O acesso continua bloqueado; reenvie o e-mail após corrigir o problema."
      : active
        ? "Convite e QR enviados por e-mail. O acesso foi liberado. O WhatsApp pode ser enviado manualmente, sem custo da Meta."
        : "E-mail confirmado. O vendedor continua desligado; você pode reativá-lo e enviar a mensagem pronta pelo WhatsApp, sem custo da Meta."
  }, seller.retry ? 200 : 201);
}

function buildWhatsappInviteUrl(phone, name, qrUrl) {
  const digits = phoneDigits(phone);
  if (![10, 11].includes(digits.length)) return "";
  const recipient = "55" + digits;
  const message = "Olá, " + name + "! Seu QR Code oficial da Máquina de Líder está pronto: " + qrUrl + "\n\nO convite para acessar sua carteira foi enviado para seu e-mail.";
  return "https://wa.me/" + recipient + "?text=" + encodeURIComponent(message);
}

async function routeLeaderSellers(request, env, url) {
  if (url.pathname === "/api/leaders" || url.pathname.startsWith("/api/leaders/")) {
    return leaderHierarchyApi(request, env, url);
  }
  if (url.pathname === "/api/sellers" || url.pathname.startsWith("/api/sellers/")) {
    return leaderSellersApi(request, env, url);
  }
  return null;
}

function html(body) {
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=UTF-8"
    }
  });
}

function page() {
  return html(`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Minha Carteira | Máquina de Líder</title>

<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.105.4/dist/umd/supabase.js"></script>
<script src="https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js"></script>

<style>
*{box-sizing:border-box}

body{
  margin:0;
  background:#f5f5f5;
  font-family:Arial,sans-serif;
  color:#222
}

.top{
  background:#d50000;
  color:#fff;
  padding:18px 20px
}

.brand{
  font-size:26px;
  font-weight:800
}

.sub{
  font-size:13px;
  margin-top:3px
}

.wrap{
  max-width:1180px;
  margin:24px auto;
  padding:0 16px
}

.card{
  background:#fff;
  border-radius:14px;
  padding:20px;
  box-shadow:0 2px 12px rgba(0,0,0,.08);
  margin-bottom:18px
}

.hidden{
  display:none
}

.login{
  max-width:430px;
  margin:50px auto
}

.h{
  font-size:22px;
  font-weight:800;
  margin:0 0 14px
}

.muted{
  color:#666;
  font-size:13px
}

.field{
  margin:10px 0
}

.field label{
  display:block;
  font-size:13px;
  font-weight:700;
  margin-bottom:6px
}

.field input,
.field select{
  width:100%;
  padding:12px;
  border:1px solid #ccc;
  border-radius:9px;
  font-size:15px
}

.btn{
  border:0;
  border-radius:9px;
  padding:12px 16px;
  background:#d50000;
  color:#fff;
  font-weight:800;
  cursor:pointer
}

.btn.secondary{
  background:#333
}

.error{
  color:#b00020;
  margin-top:10px;
  font-size:13px
}

.link-button{
  border:0;
  padding:0;
  margin-top:14px;
  background:transparent;
  color:#b00000;
  font:inherit;
  font-weight:700;
  text-decoration:underline;
  cursor:pointer
}

.auth-panel{
  margin-top:18px;
  padding-top:16px;
  border-top:1px solid #eee
}

.stats{
  display:grid;
  grid-template-columns:repeat(4,1fr);
  gap:10px
}

.stat{
  background:#fafafa;
  border:1px solid #eee;
  border-radius:10px;
  padding:14px
}

.stat b{
  display:block;
  font-size:24px;
  margin-top:4px
}

.bar{
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:12px;
  flex-wrap:wrap
}

.filters{
  display:grid;
  grid-template-columns:2fr 1fr 1fr;
  gap:10px;
  margin-top:16px
}

.filters input,
.filters select{
  padding:12px;
  border:1px solid #ccc;
  border-radius:9px;
  font-size:14px
}

.table-wrap{
  overflow:auto;
  margin-top:14px
}

table{
  width:100%;
  border-collapse:collapse;
  min-width:900px
}

th,td{
  padding:11px 9px;
  border-bottom:1px solid #eee;
  text-align:left;
  font-size:13px;
  vertical-align:top
}

th{
  font-size:12px;
  background:#fafafa;
  position:sticky;
  top:0
}

.pill{
  display:inline-block;
  padding:5px 8px;
  border-radius:20px;
  background:#eee;
  font-size:11px;
  font-weight:700
}

.empty{
  padding:35px;
  text-align:center;
  color:#777
}

.qr-grid{
  display:grid;
  grid-template-columns:repeat(auto-fill,minmax(220px,1fr));
  gap:12px
}

.qr-card{
  border:1px solid #eee;
  border-radius:10px;
  padding:14px;
  min-width:0
}

.qr-card img{
  display:block;
  width:160px;
  height:160px;
  max-width:100%;
  margin:10px auto
}

.qr-url{
  overflow-wrap:anywhere;
  color:#555;
  font-size:12px
}

@media print{
  body.qr-printing *{visibility:hidden!important}
  body.qr-printing #managerQrPanel,
  body.qr-printing #managerQrPanel *{visibility:visible!important}
  body.qr-printing #managerQrPanel{position:absolute;left:0;top:0;width:100%;box-shadow:none}
  body.qr-printing .qr-grid{grid-template-columns:repeat(3,1fr)}
  body.qr-printing .qr-card{break-inside:avoid}
  body.qr-printing .qr-actions{display:none!important}
}

@media(max-width:700px){
  .stats{
    grid-template-columns:repeat(2,1fr)
  }

  .filters{
    grid-template-columns:1fr
  }

  .wrap{
    padding:0 10px
  }

  .card{
    padding:14px
  }
}
</style>
</head>

<body>

<div class="top">
  <div class="brand">Claro</div>
  <div class="sub">Máquina de Líder · Minha Carteira</div>
</div>

<div class="wrap">

<section id="login" class="card login hidden">

  <h1 class="h">Acesso à Minha Carteira</h1>

  <div class="muted">
    Entre com seu usuário corporativo.
  </div>

  <div id="loginForm">
  <div class="field">
    <label for="email">E-mail</label>
    <input
      id="email"
      type="email"
      autocomplete="username"
    >
  </div>

  <div class="field">
    <label for="password">Senha</label>
    <input
      id="password"
      type="password"
      autocomplete="current-password"
    >
  </div>

  <button class="btn" id="loginBtn">
    Entrar
  </button>

  <div>
    <button class="link-button" id="showResetBtn" type="button">
      Primeiro acesso ou esqueci minha senha
    </button>
  </div>
  </div>

  <div id="resetPanel" class="auth-panel hidden">
    <h2 class="h">Criar ou recuperar senha</h2>
    <div class="field">
      <label for="resetEmail">E-mail corporativo</label>
      <input id="resetEmail" type="email" autocomplete="username">
    </div>
    <p class="muted">Enviaremos um link para o e-mail informado. Abra o link neste dispositivo para cadastrar uma nova senha.</p>
    <button class="btn" id="resetBtn" type="button">Enviar link por e-mail</button>
    <div id="resetMessage" class="muted" role="status" aria-live="polite"></div>
    <div id="resetError" class="error" role="alert"></div>
    <button class="link-button" id="cancelResetBtn" type="button">Voltar para entrar</button>
  </div>

  <div id="passwordPanel" class="auth-panel hidden">
    <h2 class="h">Defina sua nova senha</h2>
    <div class="field">
      <label for="newPassword">Nova senha</label>
      <input id="newPassword" type="password" autocomplete="new-password" minlength="8">
    </div>
    <div class="field">
      <label for="confirmPassword">Confirme a nova senha</label>
      <input id="confirmPassword" type="password" autocomplete="new-password" minlength="8">
    </div>
    <button class="btn" id="savePasswordBtn" type="button">Salvar senha</button>
    <div id="passwordError" class="error" role="alert"></div>
  </div>

  <div id="loginError" class="error"></div>

</section>


<section id="app" class="hidden">

  <div class="card">

    <div class="bar">

      <div>
        <h1 class="h">
          Minha Carteira
        </h1>

        <div id="scope" class="muted"></div>
      </div>

      <button
        class="btn secondary"
        id="logoutBtn"
      >
        Sair
      </button>

    </div>

    <div id="logoutError" class="error" role="alert"></div>

  </div>


  <div class="stats">

    <div class="stat">
      Total
      <b id="total">0</b>
    </div>

    <div class="stat">
      Novos
      <b id="novos">0</b>
    </div>

    <div class="stat">
      Propostas
      <b id="propostas">0</b>
    </div>

    <div class="stat">
      Vendas
      <b id="vendas">0</b>
    </div>

  </div>

  <section id="managerQrPanel" class="card hidden" style="margin-top:18px">
    <div class="bar">
      <div>
        <h2 class="h">QR Codes oficiais dos vendedores</h2>
        <div class="muted">Os códigos usam o identificador permanente do cadastro. Leads enviados por esses links entram diretamente na Carteira.</div>
      </div>
      <div class="qr-actions" style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="generateQrBtn" class="btn" type="button">Gerar QR Codes</button>
        <button id="printQrBtn" class="btn secondary hidden" type="button">Imprimir todos</button>
      </div>
    </div>
    <div id="qrStatus" class="muted" role="status" aria-live="polite" style="margin:12px 0"></div>
    <div id="qrGrid" class="qr-grid"></div>
  </section>

  <section id="sellerManagementPanel" class="card hidden" style="margin-top:18px">
    <h2 class="h">Equipe de vendedores</h2>
    <p class="muted">O convite e o QR Code são enviados automaticamente por e-mail. O botão do WhatsApp abre uma mensagem pronta para envio manual, sem cobrança da Meta.</p>
    <p id="sellerSetupStatus" class="muted" role="status" aria-live="polite"></p>
    <form id="sellerForm" class="filters" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr));margin:14px 0">
      <input id="sellerName" placeholder="Nome do vendedor" required maxlength="120">
      <input id="sellerEmail" type="email" placeholder="E-mail" required maxlength="254">
      <input id="sellerPhone" type="tel" placeholder="WhatsApp com DDD" required>
      <input id="sellerRegion" placeholder="Região" value="Santos" required maxlength="80">
      <select id="sellerExecutive" class="hidden"><option value="">Selecione o executivo</option></select>
      <select id="sellerSupervisor" class="hidden"><option value="">Selecione o supervisor</option></select>
      <button id="sellerCreateBtn" class="btn" type="submit">Cadastrar vendedor</button>
    </form>
    <div id="sellerManagementStatus" class="muted" role="status" aria-live="polite"></div>
    <div style="overflow:auto;margin-top:12px">
      <table style="width:100%;border-collapse:collapse">
        <thead><tr><th>Vendedor</th><th>Região</th><th>Estado</th><th>Envios</th><th>Ação</th></tr></thead>
        <tbody id="sellerManagementRows"></tbody>
      </table>
    </div>
  </section>

  <section id="leaderManagementPanel" class="card hidden" style="margin-top:18px">
    <h2 class="h">Equipe de liderança</h2>
    <p class="muted">Gerentes cadastram Executivos/Coordenadores e Supervisores. Executivos/Coordenadores cadastram Supervisores da própria equipe.</p>
    <form id="leaderForm" class="filters" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr));margin:14px 0">
      <select id="leaderRole"><option value="EXECUTIVO">Executivo/Coordenador</option><option value="SUPERVISOR">Supervisor</option></select>
      <input id="leaderName" placeholder="Nome" required maxlength="120">
      <input id="leaderEmail" type="email" placeholder="E-mail" required maxlength="254">
      <select id="leaderExecutive"><option value="">Vincular direto à Gerência</option></select>
      <button id="leaderCreateBtn" class="btn" type="submit">Cadastrar líder e enviar convite</button>
    </form>
    <div id="leaderManagementStatus" class="muted" role="status" aria-live="polite"></div>
    <div style="overflow:auto;margin-top:12px">
      <table style="width:100%;border-collapse:collapse">
        <thead><tr><th>Líder</th><th>Perfil</th><th>Executivo/Coordenador responsável</th><th>Convite</th><th>Transferência</th></tr></thead>
        <tbody id="leaderManagementRows"></tbody>
      </table>
    </div>
  </section>


  <div
    class="card"
    style="margin-top:18px"
  >

    <div class="filters">

      <input
        id="search"
        placeholder="Buscar cliente, telefone ou endereço"
      >

      <select id="product">

        <option value="">
          Todos os produtos
        </option>

        <option>Internet</option>
        <option>Celular</option>
        <option>TV</option>
        <option>Combo</option>

      </select>


      <select id="status">

        <option value="">
          Todos os status
        </option>

        <option value="NOVO">
          NOVO
        </option>

        <option value="CONTATO_REALIZADO">
          CONTATO REALIZADO
        </option>

        <option value="PROPOSTA">
          PROPOSTA
        </option>

        <option value="NEGOCIACAO">
          NEGOCIAÇÃO
        </option>

        <option value="VENDA">
          VENDA
        </option>

        <option value="NAO_VENDA">
          NÃO VENDA
        </option>

      </select>

    </div>

    <div
      id="message"
      class="error"
    ></div>

    <div id="managerMessage" class="muted" role="status" aria-live="polite"></div>


    <div class="table-wrap">

      <table>

        <thead>

          <tr>

            <th>Cliente</th>
            <th>Telefone</th>
            <th>Endereço</th>
            <th>Possui Claro</th>
            <th>Produto de interesse</th>
            <th>Data/Hora</th>
            <th>Status</th>
            <th id="managerObservationHeader" class="hidden">Observação</th>
            <th id="managerCrmHeader" class="hidden">ID no CRM</th>

          </tr>

        </thead>

        <tbody id="rows"></tbody>

      </table>

    </div>

  </div>

</section>

</div>


<script>

// Keep the recovery panel usable even if the external SDK fails to load.
document.getElementById("showResetBtn").addEventListener("click", () => {
  document.getElementById("resetEmail").value =
    document.getElementById("email").value.trim();
  document.getElementById("loginForm").classList.add("hidden");
  document.getElementById("resetPanel").classList.remove("hidden");
  document.getElementById("resetError").textContent = "";
  document.getElementById("resetMessage").textContent = "";
  document.getElementById("resetEmail").focus();
});

const {
  createClient
} = supabase;


const client = createClient(
  ${JSON.stringify(SUPABASE_URL)},
  ${JSON.stringify(SUPABASE_PUBLISHABLE_KEY)}
);


let leads = [];
let isManager = false;
let leaderRole = "";
let sellerTeamData = null;
const QR_PRODUCTION_ORIGIN = "https://maquina-de-lider.juliano-misael.workers.dev";


const $ = id =>
  document.getElementById(id);


function escapeHtml(value) {

  return String(value ?? "")
    .replace(
      /[&<>"']/g,
      character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      }[character])
    );

}


function formatPhone(value) {

  const digits =
    String(value ?? "")
      .replace(/\\D/g, "");

  if (digits.length === 11) {

    return (
      "(" +
      digits.slice(0,2) +
      ") " +
      digits.slice(2,7) +
      "-" +
      digits.slice(7)
    );

  }

  if (digits.length === 10) {

    return (
      "(" +
      digits.slice(0,2) +
      ") " +
      digits.slice(2,6) +
      "-" +
      digits.slice(6)
    );

  }

  if (digits.length === 9) {

    return (
      digits.slice(0,5) +
      "-" +
      digits.slice(5)
    );

  }

  if (digits.length === 8) {

    return (
      digits.slice(0,4) +
      "-" +
      digits.slice(4)
    );

  }

  return digits;

}


function formatDate(value) {

  if (!value) {
    return "";
  }

  return new Date(value)
    .toLocaleString(
      "pt-BR",
      {
        dateStyle:"short",
        timeStyle:"short"
      }
    );

}


async function loadLeads() {
  let data;
  let error;
  try {
    ({ data, error } = await client
      .from("leads")
      .select(
        "id,name,customer_phone,address,has_claro,product_searched,status,created_at,seller_id"
      )
      .order(
        "created_at",
        {
          ascending:false
        }
      ));
  } catch (requestError) {
    error = requestError;
  }

  if (error) {
    $("message").textContent =
      "Não foi possível carregar sua carteira.";
    console.error(error);
    return;
  }

  leads = data || [];

  $("managerMessage").textContent = "";
  if (isManager && leads.length) {
    let privateFields;
    let privateFieldsError;
    try {
      ({ data: privateFields, error: privateFieldsError } = await client.rpc(
        "manager_lead_private_fields",
        { p_lead_ids: leads.map(lead => lead.id) }
      ));
    } catch (requestError) {
      privateFieldsError = requestError;
    }

    if (privateFieldsError) {
      $("managerMessage").textContent =
        "Não foi possível carregar observações e IDs do CRM.";
      console.error(privateFieldsError);
    } else {
      const fieldsByLead = new Map(
        (privateFields || []).map(fields => [fields.lead_id, fields])
      );
      leads = leads.map(lead => ({
        ...lead,
        observation: fieldsByLead.get(lead.id)?.observation ?? "",
        crm_external_id: fieldsByLead.get(lead.id)?.crm_external_id ?? ""
      }));
    }
  }

  $("message").textContent = "";
  render();
}


function render() {

  const query =
    $("search")
      .value
      .trim()
      .toLowerCase();

  const product =
    $("product").value;

  const status =
    $("status").value;


  const filtered =
    leads.filter(lead => {

      const matchesSearch =
        !query ||
        [
          lead.name,
          lead.customer_phone,
          lead.address
        ]
        .some(value =>
          String(value ?? "")
            .toLowerCase()
            .includes(query)
        );


      const matchesProduct =
        !product ||
        lead.product_searched === product;


      const matchesStatus =
        !status ||
        lead.status === status;


      return (
        matchesSearch &&
        matchesProduct &&
        matchesStatus
      );

    });


  $("total").textContent =
    leads.length;

  $("novos").textContent =
    leads.filter(
      lead =>
        lead.status === "NOVO"
    ).length;

  $("propostas").textContent =
    leads.filter(
      lead =>
        [
          "PROPOSTA",
          "NEGOCIACAO"
        ].includes(lead.status)
    ).length;

  $("vendas").textContent =
    leads.filter(
      lead =>
        lead.status === "VENDA"
    ).length;


  /*
   * CORREÇÃO:
   * Não utilizamos template literals dentro
   * do template literal principal de page().
   * Isso evita o erro:
   * "Unterminated regular expression".
   */

  if (!filtered.length) {

    $("rows").innerHTML =
      "<tr>" +
      "<td colspan=\\\"" + (isManager ? "9" : "7") + "\\\" class=\\\"empty\\\">" +
      "Nenhum lead encontrado na sua carteira." +
      "</td>" +
      "</tr>";

    return;

  }


  $("rows").innerHTML =
    filtered.map(lead =>
      "<tr>" +

        "<td><b>" +
          escapeHtml(lead.name) +
        "</b></td>" +

        "<td>" +
          escapeHtml(
            formatPhone(
              lead.customer_phone
            )
          ) +
        "</td>" +

        "<td>" +
          escapeHtml(
            lead.address
          ) +
        "</td>" +

        "<td>" +
          escapeHtml(
            lead.has_claro
          ) +
        "</td>" +

        "<td>" +
          "<span class=\\\"pill\\\">" +
            escapeHtml(
              lead.product_searched
            ) +
          "</span>" +
        "</td>" +

        "<td>" +
          escapeHtml(
            formatDate(
              lead.created_at
            )
          ) +
        "</td>" +

        "<td>" +
          escapeHtml(
            lead.status
          ) +
        "</td>" +

        (isManager ?
          "<td>" + escapeHtml(lead.observation) + "</td>" +
          "<td>" + escapeHtml(lead.crm_external_id) + "</td>" : "") +

      "</tr>"
    ).join("");

}


async function login() {

  $("loginError").textContent = "";

  $("loginBtn").disabled = true;

  $("loginBtn").textContent =
    "Entrando...";


  try {
    const { error } = await client.auth.signInWithPassword({
      email: $("email").value.trim(),
      password: $("password").value
    });

    if (error) {
      $("loginError").textContent =
        "Login ou senha incorreto.";
      return;
    }

    await showApp();
  } catch (requestError) {
    $("loginError").textContent =
      "Não foi possível entrar agora. Verifique sua conexão e tente novamente.";
    console.error(requestError);
  } finally {
    $("loginBtn").disabled = false;
    $("loginBtn").textContent = "Entrar";
  }
}


function showPasswordPanel() {
  $("login").classList.remove("hidden");
  $("loginForm").classList.add("hidden");
  $("resetPanel").classList.add("hidden");
  $("passwordPanel").classList.remove("hidden");
  $("loginError").textContent = "";
  $("passwordError").textContent = "";
}


async function sendPasswordLink() {
  $("resetError").textContent = "";
  $("resetMessage").textContent = "";

  const email = $("resetEmail").value.trim();
  if (!email) {
    $("resetError").textContent = "Informe seu e-mail corporativo para receber o link.";
    $("resetEmail").focus();
    return;
  }

  $("resetBtn").disabled = true;
  $("resetBtn").textContent = "Enviando...";

  let error;
  try {
    ({ error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + "/carteira"
    }));
  } catch (requestError) {
    error = requestError;
  }

  $("resetBtn").disabled = false;
  $("resetBtn").textContent = "Enviar link por e-mail";

  if (error) {
    $("resetError").textContent = "Não foi possível enviar o link. Confira o e-mail e tente novamente.";
    console.error(error);
    return;
  }

  $("resetMessage").textContent = "Se houver uma conta para esse e-mail, enviaremos um link para criar ou redefinir a senha.";
}


async function savePassword() {
  const password = $("newPassword").value;
  const confirmation = $("confirmPassword").value;
  $("passwordError").textContent = "";

  if (password.length < 8) {
    $("passwordError").textContent = "A senha deve ter pelo menos 8 caracteres.";
    return;
  }

  if (password !== confirmation) {
    $("passwordError").textContent = "As senhas não conferem.";
    return;
  }

  $("savePasswordBtn").disabled = true;
  $("savePasswordBtn").textContent = "Salvando...";

  let error;
  try {
    ({ error } = await client.auth.updateUser({ password }));
  } catch (requestError) {
    error = requestError;
  }

  $("savePasswordBtn").disabled = false;
  $("savePasswordBtn").textContent = "Salvar senha";

  if (error) {
    $("passwordError").textContent = "Não foi possível salvar a senha. Confirme os requisitos e, se necessário, solicite outro link.";
    console.error(error);
    return;
  }

  window.history.replaceState({}, document.title, window.location.pathname);
  await showApp();
}


async function showApp() {

  let user;
  try {
    const { data, error } = await client.auth.getUser();
    if (error) throw error;
    user = data?.user;
  } catch (error) {
    $("loginError").textContent =
      "Não foi possível confirmar sua sessão. Verifique sua conexão e tente novamente.";
    console.error(error);
    return;
  }


  if (!user) {
    $("loginError").textContent =
      "Sua sessão não está ativa. Entre novamente ou solicite outro link de recuperação.";
    return;
  }

  isManager = false;
  leaderRole = "";
  const { data: roles, error: rolesError } = await client
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);

  if (rolesError) {
    console.error(rolesError);
  } else {
    isManager = (roles || []).some(role => role.role === "GERENTE");
    leaderRole = (roles || []).map(role => role.role).find(role => ["GERENTE", "EXECUTIVO", "SUPERVISOR"].includes(role)) || "";
  }

  $("managerObservationHeader").classList.toggle("hidden", !isManager);
  $("managerCrmHeader").classList.toggle("hidden", !isManager);
  $("managerQrPanel").classList.toggle("hidden", !isManager);
  $("sellerManagementPanel").classList.toggle("hidden", !leaderRole);
  $("leaderManagementPanel").classList.toggle("hidden", !["GERENTE", "EXECUTIVO"].includes(leaderRole));


  $("scope").textContent =
    "Usuário: " +
    user.email +
    (leaderRole ? " · Perfil " + leaderRole.toLowerCase() : " · Acesso controlado pelo RLS do Supabase");


  await loadLeads();

  if (isManager) {
    await loadManagerQrSellers();
  }
  if (leaderRole) await loadSellerManagement();
  if (["GERENTE", "EXECUTIVO"].includes(leaderRole)) await loadLeaderManagement();

  $("login").classList.add("hidden");
  $("app").classList.remove("hidden");

}

function sellerApiHeaders() {
  return client.auth.getSession().then(({ data }) => ({
    "content-type": "application/json",
    Authorization: "Bearer " + (data?.session?.access_token || "")
  }));
}

function buildWhatsappInviteUrl(phone, name, qrUrl) {
  const digits = String(phone || "").replace(/\\D/g, "").replace(/^55(?=\\d{10,11}$)/, "");
  if (![10, 11].includes(digits.length)) return "";
  const message = "Olá, " + name + "! Seu QR Code oficial da Máquina de Líder está pronto: " + qrUrl + "\\n\\nO convite para acessar sua carteira foi enviado para seu e-mail.";
  return "https://wa.me/55" + digits + "?text=" + encodeURIComponent(message);
}

async function loadSellerManagement() {
  const status = $("sellerSetupStatus");
  const rows = $("sellerManagementRows");
  status.textContent = "Carregando equipe…";
  try {
    const headers = await sellerApiHeaders();
    const response = await fetch("/api/sellers", { headers });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Não foi possível carregar a equipe.");
    sellerTeamData = payload;
    status.textContent = payload.readiness?.email
      ? "E-mail automático pronto. O WhatsApp será enviado manualmente, sem custo da Meta."
      : "Envio automático de e-mail ainda não configurado. Novos cadastros ficam indisponíveis até configurá-lo.";
    $("sellerCreateBtn").disabled = !payload.readiness?.ready;
    const execSelect = $("sellerExecutive");
    const supSelect = $("sellerSupervisor");
    execSelect.classList.toggle("hidden", payload.role !== "GERENTE" && payload.role !== "SUPERVISOR");
    supSelect.classList.toggle("hidden", payload.role === "SUPERVISOR");
    for (const [select, choices, label] of [[execSelect, payload.assignableExecutives, "Selecione o executivo"], [supSelect, payload.assignableSupervisors, "Selecione o supervisor"]]) {
      select.replaceChildren(new Option(label, ""));
      (choices || []).forEach(choice => {
        const option = new Option(choice.label, choice.id);
        if (choice.executiveUserId) option.dataset.executiveUserId = choice.executiveUserId;
        select.add(option);
      });
      if (!choices?.length) select.classList.add("hidden");
    }
    supSelect.onchange = () => {
      const executiveId = supSelect.selectedOptions[0]?.dataset.executiveUserId;
      if (payload.role === "GERENTE" && executiveId) execSelect.value = executiveId;
    };
    rows.replaceChildren();
    (payload.sellers || []).forEach(seller => {
      const tr = document.createElement("tr");
      const state = seller.active ? "Ativo" : "Desligado";
      const emailStatus = seller.onboarding?.email_status;
      const emailLabel = emailStatus === "sent" ? "enviado" : emailStatus === "failed" ? "falhou" : "pendente";
      const delivery = seller.onboarding
        ? "E-mail: " + emailLabel + " · WhatsApp: " + (emailStatus === "sent" ? "manual (sem custo)" : "após confirmar o e-mail")
        : "Sem controle de envio";
      const name = document.createElement("td"); name.textContent = seller.name;
      const region = document.createElement("td"); region.textContent = seller.region || "—";
      const active = document.createElement("td"); active.textContent = state;
      const sends = document.createElement("td"); sends.textContent = delivery;
      const actionCell = document.createElement("td");
      const action = document.createElement("button"); action.type = "button"; action.className = "btn secondary";
      action.textContent = seller.active ? "Desligar" : "Reativar";
      action.addEventListener("click", () => setSellerActive(seller, !seller.active));
      actionCell.append(action);
      if (seller.onboarding && seller.onboarding.email_status !== "sent") {
        const retry = document.createElement("button"); retry.type = "button"; retry.className = "btn secondary"; retry.style.marginLeft = "6px"; retry.textContent = "Reenviar e-mail";
        retry.addEventListener("click", () => retrySellerDelivery(seller)); actionCell.append(retry);
      }
      if (seller.onboarding && seller.onboarding.email_status === "sent" && seller.phone) {
        const qrUrl = new URL("/", QR_PRODUCTION_ORIGIN); qrUrl.searchParams.set("vendedor", seller.id);
        const whatsapp = document.createElement("a"); whatsapp.className = "btn secondary"; whatsapp.style.marginLeft = "6px";
        whatsapp.textContent = "Abrir WhatsApp"; whatsapp.href = buildWhatsappInviteUrl(seller.phone, seller.name, qrUrl.href);
        whatsapp.target = "_blank"; whatsapp.rel = "noopener noreferrer"; actionCell.append(whatsapp);
      }
      if ((payload.transferTargets || []).length > 0) {
        const transferSelect = document.createElement("select");
        transferSelect.setAttribute("aria-label", "Carteira de destino para " + seller.name);
        transferSelect.style.marginLeft = "6px";
        transferSelect.add(new Option("Transferir para…", ""));
        payload.transferTargets.forEach(target => transferSelect.add(new Option(target.label, target.key)));
        const transfer = document.createElement("button"); transfer.type = "button"; transfer.className = "btn secondary";
        transfer.textContent = "Transferir"; transfer.style.marginLeft = "6px";
        transfer.addEventListener("click", () => transferSeller(seller, transferSelect.value));
        actionCell.append(transferSelect, transfer);
      }
      tr.append(name, region, active, sends, actionCell); rows.append(tr);
    });
  } catch (error) {
    status.textContent = error.message;
  }
}

async function transferSeller(seller, targetKey) {
  const status = $("sellerManagementStatus");
  if (!targetKey) { status.textContent = "Selecione a carteira de destino."; return; }
  status.textContent = "Transferindo vendedor…";
  try {
    const headers = await sellerApiHeaders();
    const response = await fetch("/api/sellers/" + encodeURIComponent(seller.id) + "/transfer", {
      method: "POST", headers, body: JSON.stringify({ targetKey })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Não foi possível transferir.");
    status.textContent = "Vendedor transferido. Os leads continuam vinculados à carteira dele.";
    await loadSellerManagement();
  } catch (error) { status.textContent = error.message; }
}

async function loadLeaderManagement() {
  const status = $("leaderManagementStatus");
  status.textContent = "Carregando hierarquia…";
  try {
    const headers = await sellerApiHeaders();
    const response = await fetch("/api/leaders", { headers });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Não foi possível carregar a hierarquia.");
    leaderDirectoryData = payload;
    const roleSelect = $("leaderRole");
    if (payload.role === "EXECUTIVO") {
      roleSelect.replaceChildren(new Option("Supervisor", "SUPERVISOR"));
      $("leaderExecutive").classList.add("hidden");
    } else {
      roleSelect.replaceChildren(new Option("Executivo/Coordenador", "EXECUTIVO"), new Option("Supervisor", "SUPERVISOR"));
      $("leaderExecutive").classList.remove("hidden");
    }
    const parentSelect = $("leaderExecutive");
    parentSelect.replaceChildren(new Option("Vincular direto à Gerência", ""));
    (payload.executiveChoices || []).forEach(item => parentSelect.add(new Option(item.label, item.id)));
    roleSelect.onchange = () => parentSelect.classList.toggle("hidden", payload.role !== "GERENTE" || roleSelect.value === "EXECUTIVO");
    roleSelect.onchange();
    const rows = $("leaderManagementRows"); rows.replaceChildren();
    (payload.visibleLeaders || []).forEach(item => {
      const tr = document.createElement("tr");
      const name = document.createElement("td"); name.textContent = item.label;
      const role = document.createElement("td"); role.textContent = item.role === "EXECUTIVO" ? "Executivo/Coordenador" : "Supervisor";
      const parent = document.createElement("td"); parent.textContent = item.executiveLabel;
      const invite = document.createElement("td"); invite.textContent = item.inviteEmailStatus === "sent" ? "Enviado" : item.inviteEmailStatus === "failed" ? "Falhou" : "Pendente";
      const action = document.createElement("td");
      if (item.inviteEmailStatus !== "sent") {
        const retry = document.createElement("button"); retry.type = "button"; retry.className = "btn secondary";
        retry.textContent = "Reenviar convite";
        retry.addEventListener("click", () => retryLeaderInvite(item));
        action.append(retry);
      }
      if (payload.role === "GERENTE" && item.role === "SUPERVISOR") {
        const select = document.createElement("select");
        if (item.executiveUserId) select.add(new Option("Gerência", ""));
        (payload.executiveChoices || []).filter(choice => choice.id !== item.executiveUserId)
          .forEach(choice => select.add(new Option(choice.label, choice.id)));
        const carryLabel = document.createElement("label"); carryLabel.style.marginLeft = "8px";
        const carry = document.createElement("input"); carry.type = "checkbox"; carry.checked = true;
        carryLabel.append(carry, document.createTextNode(" Levar vendedores"));
        const button = document.createElement("button"); button.type = "button"; button.className = "btn secondary";
        button.textContent = "Transferir"; button.style.marginLeft = "8px";
        button.addEventListener("click", () => transferSupervisor(item, select.value, carry.checked));
        if (select.options.length) action.append(select, carryLabel, button);
        else action.textContent = "Sem destino alternativo";
      }
      tr.append(name, role, parent, invite, action); rows.append(tr);
    });
    status.textContent = payload.role === "GERENTE" ? "Gerencie Executivos/Coordenadores e Supervisores." : "Supervisores vinculados à sua equipe.";
  } catch (error) { status.textContent = error.message; }
}

async function transferSupervisor(supervisor, executiveUserId, carrySellers) {
  const status = $("leaderManagementStatus");
  status.textContent = "Transferindo Supervisor…";
  try {
    const headers = await sellerApiHeaders();
    const response = await fetch("/api/leaders/" + encodeURIComponent(supervisor.userId), {
      method: "PATCH", headers, body: JSON.stringify({ executiveUserId: executiveUserId || null, carrySellers })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Não foi possível transferir.");
    status.textContent = carrySellers
      ? "Supervisor e vendedores transferidos; leads permanecem nas carteiras dos mesmos vendedores."
      : "Supervisor transferido. Os vendedores continuam com o Executivo anterior ou na Gerência.";
    await loadLeaderManagement(); await loadSellerManagement();
  } catch (error) { status.textContent = error.message; }
}

async function retryLeaderInvite(item) {
  const status = $("leaderManagementStatus"); status.textContent = "Reenviando convite…";
  try {
    const headers = await sellerApiHeaders();
    const response = await fetch("/api/leaders/" + encodeURIComponent(item.userId) + "/retry", { method: "POST", headers });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Não foi possível reenviar o convite.");
    status.textContent = result.message || "Convite reenviado.";
    await loadLeaderManagement();
  } catch (error) { status.textContent = error.message; }
}

async function createLeader(event) {
  event.preventDefault();
  const button = $("leaderCreateBtn"); const status = $("leaderManagementStatus");
  button.disabled = true; status.textContent = "Criando perfil e enviando convite…";
  try {
    const headers = await sellerApiHeaders();
    const response = await fetch("/api/leaders", { method: "POST", headers, body: JSON.stringify({
      role: $("leaderRole").value, name: $("leaderName").value.trim(), email: $("leaderEmail").value.trim(),
      executiveUserId: $("leaderExecutive").value || null
    }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Não foi possível cadastrar o líder.");
    status.textContent = result.message || "Convite enviado.";
    $("leaderForm").reset();
    await loadLeaderManagement();
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
}

let leaderDirectoryData = null;
$("leaderForm").addEventListener("submit", createLeader);

async function setSellerActive(seller, active) {
  const status = $("sellerManagementStatus"); status.textContent = "Salvando…";
  try {
    const headers = await sellerApiHeaders();
    const response = await fetch("/api/sellers/" + encodeURIComponent(seller.id), { method: "PATCH", headers, body: JSON.stringify({ active }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || "Não foi possível alterar o acesso.");
    status.textContent = active ? "Vendedor reativado." : "Vendedor desligado; o acesso foi bloqueado.";
    await loadSellerManagement();
  } catch (error) { status.textContent = error.message; }
}

function qrPngDataUrl(qr, cellSize = 8, margin = 4) {
  const gifDataUrl = qr.createDataURL(cellSize, margin);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context || !canvas.width || !canvas.height) {
        reject(new Error("Não foi possível preparar a imagem do QR Code."));
        return;
      }
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0);
      try { resolve(canvas.toDataURL("image/png")); }
      catch { reject(new Error("Não foi possível preparar a imagem do QR Code.")); }
    };
    image.onerror = () => reject(new Error("Não foi possível preparar a imagem do QR Code."));
    image.src = gifDataUrl;
  });
}

async function createSeller(event) {
  event.preventDefault();
  const button = $("sellerCreateBtn"); const status = $("sellerManagementStatus");
  if (typeof window.qrcode !== "function") { status.textContent = "Gerador de QR indisponível. Atualize a página."; return; }
  button.disabled = true; button.textContent = "Criando e enviando e-mail…"; status.textContent = "";
  try {
    const id = crypto.randomUUID();
    const canonical = new URL("/", QR_PRODUCTION_ORIGIN); canonical.searchParams.set("vendedor", id);
    const qr = qrcode(0, "M"); qr.addData(canonical.href); qr.make();
    const qrPng = await qrPngDataUrl(qr, 8, 4);
    const headers = await sellerApiHeaders();
    const response = await fetch("/api/sellers", { method: "POST", headers, body: JSON.stringify({
      sellerId: id, name: $("sellerName").value.trim(), email: $("sellerEmail").value.trim(),
      phone: $("sellerPhone").value.trim(), region: $("sellerRegion").value.trim(),
      executiveUserId: $("sellerExecutive").value || null, supervisorUserId: $("sellerSupervisor").value || null,
      qrPng
    }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || "Não foi possível cadastrar.");
    status.textContent = result.message || "Cadastro processado.";
    if (result.created) $("sellerForm").reset();
    await loadSellerManagement();
    if (isManager) await loadManagerQrSellers();
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = !sellerTeamData?.readiness?.email; button.textContent = "Cadastrar vendedor"; }
}

async function retrySellerDelivery(seller) {
  const status = $("sellerManagementStatus"); status.textContent = "Reenviando convite por e-mail…";
  try {
    const canonical = new URL("/", QR_PRODUCTION_ORIGIN); canonical.searchParams.set("vendedor", seller.id);
    const qr = qrcode(0, "M"); qr.addData(canonical.href); qr.make();
    const headers = await sellerApiHeaders();
    const response = await fetch("/api/sellers/" + encodeURIComponent(seller.id) + "/retry", { method: "POST", headers, body: JSON.stringify({ qrPng: await qrPngDataUrl(qr, 8, 4) }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || "Não foi possível reenviar.");
    status.textContent = result.message || "Reenvio processado."; await loadSellerManagement();
  } catch (error) { status.textContent = error.message; }
}

$("sellerForm").addEventListener("submit", createSeller);


let qrSellers = [];

async function loadManagerQrSellers() {
  $("qrStatus").textContent = "Carregando vendedores ativos…";
  const { data, error } = await client
    .from("sellers")
    .select("id,slug,name,active")
    .eq("active", true)
    .order("name");

  if (error) {
    $("qrStatus").textContent = "Não foi possível carregar os vendedores para gerar os QR Codes.";
    console.error(error);
    return;
  }

  qrSellers = data || [];
  $("qrStatus").textContent = qrSellers.length
    ? qrSellers.length + " vendedor(es) ativo(s). Os links não mudam se o nome do vendedor for atualizado."
    : "Nenhum vendedor ativo encontrado.";
}


async function generateManagerQrs() {
  const button = $("generateQrBtn");
  const grid = $("qrGrid");
  const origin = window.location.origin;
  if (origin !== QR_PRODUCTION_ORIGIN) {
    $("qrStatus").textContent = "QR Codes bloqueados: abra a Carteira pelo endereço oficial de produção.";
    return;
  }
  if (typeof window.qrcode !== "function") {
    $("qrStatus").textContent = "Não foi possível carregar o gerador de QR Codes. Atualize a página e tente novamente.";
    return;
  }
  if (!qrSellers.length) {
    await loadManagerQrSellers();
    if (!qrSellers.length) return;
  }

  button.disabled = true;
  button.textContent = "Gerando…";
  grid.replaceChildren();
  $("printQrBtn").classList.add("hidden");
  let generated = 0;

  try {
    for (const seller of qrSellers) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(seller.id || "")) continue;
      const url = new URL("/", QR_PRODUCTION_ORIGIN);
      url.searchParams.set("vendedor", seller.id);
      const card = document.createElement("article");
      card.className = "qr-card";
      const title = document.createElement("strong");
      title.textContent = seller.name || seller.slug;
      const qrImage = document.createElement("img");
      qrImage.alt = "QR Code de captura para " + (seller.name || seller.slug);
      qrImage.width = 480;
      qrImage.height = 480;
      const link = document.createElement("a");
      link.className = "qr-url";
      link.href = url.href;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = url.href;
      link.setAttribute("aria-label", "Abrir link de captura de " + (seller.name || seller.slug));
      const download = document.createElement("button");
      download.type = "button";
      download.className = "btn secondary qr-actions";
      download.textContent = "Baixar QR";
      download.addEventListener("click", () => {
        const a = document.createElement("a");
        a.download = "qr-" + seller.slug + ".png";
        a.href = qrImage.src;
        a.click();
      });
      card.append(title, qrImage, link, download);
      grid.append(card);
      const qr = qrcode(0, "M");
      qr.addData(url.href);
      qr.make();
      qrImage.src = qr.createDataURL(8, 4);
      generated++;
      $("qrStatus").textContent = "Gerando QR Codes… " + generated + " de " + qrSellers.length;
    }
    $("qrStatus").textContent = generated + " QR Code(s) oficial(is) gerado(s). Baixe cada imagem ou imprima a lista completa.";
    $("printQrBtn").classList.toggle("hidden", generated === 0);
  } catch (error) {
    $("qrStatus").textContent = "A geração foi interrompida. Tente novamente; os códigos já gerados continuam disponíveis.";
    console.error(error);
  } finally {
    button.disabled = false;
    button.textContent = "Gerar QR Codes";
  }
}


$("loginBtn")
  .onclick = login;

$("generateQrBtn").onclick = generateManagerQrs;
$("printQrBtn").onclick = () => {
  document.body.classList.add("qr-printing");
  window.print();
  setTimeout(() => document.body.classList.remove("qr-printing"), 1000);
};


$("cancelResetBtn").onclick = () => {
  $("email").value = $("resetEmail").value.trim();
  $("resetPanel").classList.add("hidden");
  $("loginForm").classList.remove("hidden");
  $("resetError").textContent = "";
  $("resetMessage").textContent = "";
};


$("resetBtn").onclick = sendPasswordLink;
$("savePasswordBtn").onclick = savePassword;


$("email").addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    login();
  }
});


$("resetEmail").addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    sendPasswordLink();
  }
});


client.auth.onAuthStateChange((event) => {
  if (event === "PASSWORD_RECOVERY") {
    showPasswordPanel();
  }
});


$("password")
  .addEventListener(
    "keydown",
    event => {

      if (
        event.key === "Enter"
      ) {
        event.preventDefault();
        login();
      }

    }
  );


$("search")
  .oninput = render;


$("product")
  .onchange = render;


$("status")
  .onchange = render;


$("logoutBtn")
  .onclick =
    async () => {

      const button = $("logoutBtn");
      $("logoutError").textContent = "";
      button.disabled = true;
      button.textContent = "Saindo...";

      try {
        const { error } = await client.auth.signOut();
        if (error) throw error;

        $("app").classList.add("hidden");
        $("login").classList.remove("hidden");
      } catch (error) {
        $("logoutError").textContent =
          "Não foi possível encerrar a sessão. Tente novamente.";
        console.error(error);
      } finally {
        button.disabled = false;
        button.textContent = "Sair";
      }

    };


(async () => {
  try {
    const recovery = new URLSearchParams(window.location.hash.slice(1)).get("type") === "recovery";
    const { data, error } = await client.auth.getSession();
    if (error) throw error;

    if (recovery) {
      showPasswordPanel();
    } else if (data.session) {
      await showApp();
      if ($("app").classList.contains("hidden")) {
        $("login").classList.remove("hidden");
      }
    } else {
      $("login").classList.remove("hidden");
    }
  } catch (error) {
    $("login").classList.remove("hidden");
    $("loginError").textContent =
      "Não foi possível verificar sua sessão. Atualize a página e tente novamente.";
    console.error(error);
  }
})();

</script>

</body>
</html>`);
}


export default {

  async fetch(
    request,
    env,
    ctx
  ) {

    const url =
      new URL(request.url);

    const apiResponse = await routeLeaderSellers(request, env, url);
    if (apiResponse) return apiResponse;


    if (
      url.pathname === "/carteira" ||
      url.pathname === "/carteira/"
    ) {

      return page();

    }


    return publicWorker.fetch(
      request,
      env,
      ctx
    );

  }

};


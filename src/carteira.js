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

function walletSupabaseConfig(env) {
  const preview = env.WALLET_PREVIEW === "true";
  if (!preview && env.SUPABASE_URL === undefined && env.SUPABASE_PUBLISHABLE_KEY === undefined) {
    return { url: SUPABASE_URL, key: SUPABASE_PUBLISHABLE_KEY };
  }

  const url = env.SUPABASE_URL?.trim().replace(/\/$/, "");
  const key = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(url ?? "") ||
      !/^sb_publishable_[a-z0-9_-]+$/i.test(key ?? "")) return null;

  const productionUrl = url.toLowerCase() === SUPABASE_URL;
  if (productionUrl !== (key === SUPABASE_PUBLISHABLE_KEY) || (preview && productionUrl)) return null;
  return { url, key };
}

function serviceHeaders(env, extra = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY || "",
    Authorization: "Bearer " + (env.SUPABASE_SERVICE_ROLE_KEY || ""),
    ...extra
  };
}

async function serviceRequest(env, endpoint, options = {}) {
  const response = await fetch(env.SUPABASE_URL + endpoint, {
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
    userResponse = await fetch(env.SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: authorization }
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
  if (role !== "GERENTE") {
    const profile = await getLeaderProfile(env, user.id);
    if (!profile?.active) return { error: jsonResponse({ error: "Seu acesso de liderança está desativado. Fale com o gerente." }, 403) };
    if (role === "SUPERVISOR" && profile.executive_user_id) {
      const executive = await getLeaderProfile(env, profile.executive_user_id);
      const executiveRoles = await getSellerRoles(env, [profile.executive_user_id]);
      if (!executive?.active || executiveRoles?.[profile.executive_user_id] !== "EXECUTIVO") {
        return { error: jsonResponse({ error: "O acesso da equipe está suspenso porque o executivo responsável está desativado." }, 403) };
      }
    }
  }
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

async function createInviteLink(env, email, name, role = "VENDEDOR") {
  const redirect = encodeURIComponent(env.WALLET_PUBLIC_ORIGIN + "/carteira");
  return serviceRequest(env, "/auth/v1/admin/generate_link?redirect_to=" + redirect, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "invite", email,
      data: { name, role }

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

async function createRecoveryLink(env, email) {
  return serviceRequest(env, "/auth/v1/admin/generate_link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "recovery", email,
      redirect_to: env.WALLET_PUBLIC_ORIGIN + "/carteira"
    })
  });
}

async function createSellerAuthLink(env, email, name, role = "VENDEDOR") {
  const invite = await createInviteLink(env, email, name, role);
  const inviteUrl = generatedActionLink(invite);
  const userId = generatedUserId(invite);
  if (invite.ok && SELLER_ID_RE.test(userId || "") && typeof inviteUrl === "string") {
    return { ...invite, userId, inviteUrl };
  }
  if (invite.status !== 422) return { ...invite, userId, inviteUrl };

  const pendingUser = await findPendingAuthUser(env, email);
  if (!pendingUser) return { ...invite, userId, inviteUrl };
  const recovery = await createRecoveryLink(env, email);
  return {
    ...recovery,
    userId: pendingUser.id,
    inviteUrl: generatedActionLink(recovery)
  };
}

async function getTeamRows(env, leader) {
  const params = new URLSearchParams({
    select: "id,slug,name,phone,region,active,seller_user_id,supervisor_user_id,executive_user_id",
    order: "name.asc"
  });
  if (leader.role === "EXECUTIVO") params.set("executive_user_id", "eq." + leader.user.id);
  if (leader.role === "SUPERVISOR") params.set("supervisor_user_id", "eq." + leader.user.id);
  const result = await serviceRequest(env, "/rest/v1/sellers?" + params.toString());
  return result.ok && Array.isArray(result.data) ? result.data : null;
}

async function getLeaderProfile(env, userId) {
  if (!SELLER_ID_RE.test(userId || "")) return null;
  const result = await serviceRequest(env, "/rest/v1/sellers?seller_user_id=eq." + userId +
    "&select=id,slug,name,active,seller_user_id,supervisor_user_id,executive_user_id&limit=1");
  return result.ok && Array.isArray(result.data) ? result.data[0] || null : null;
}

async function getAdminUserLabel(env, userId) {
  if (!SELLER_ID_RE.test(userId || "")) return "";
  const result = await serviceRequest(env, "/auth/v1/admin/users/" + userId);
  if (!result.ok) return "";
  return result.data?.user_metadata?.name || "Usuário " + userId.slice(0, 8);
}

async function getAdminUserEmails(env, userIds) {
  const wanted = new Set(userIds.filter(id => SELLER_ID_RE.test(id || "")));
  if (!wanted.size) return new Map();
  const result = await serviceRequest(env, "/auth/v1/admin/users?page=1&per_page=1000");
  if (!result.ok) return null;
  const users = Array.isArray(result.data?.users)
    ? result.data.users
    : Array.isArray(result.data) ? result.data : [];
  return new Map(users
    .filter(user => wanted.has(user.id))
    .map(user => [user.id, String(user.email || "")]));
}

async function getSellerRoles(env, userIds) {
  const ids = [...new Set(userIds.filter(id => SELLER_ID_RE.test(id || "")))];
  if (!ids.length) return {};
  const response = await serviceRequest(env, "/rest/v1/user_roles?user_id=in.(" + ids.join(",") + ")&select=user_id,role");
  if (!response.ok || !Array.isArray(response.data)) return null;
  return Object.fromEntries((response.data || []).map(item => [item.user_id, item.role]));
}

async function getOnboardingMap(env, sellers) {
  if (!sellers.length) return new Map();
  const ids = sellers.map(seller => seller.id).filter(id => SELLER_ID_RE.test(id || ""));
  if (!ids.length) return new Map();
  const response = await serviceRequest(env, "/rest/v1/seller_onboarding?seller_id=in.(" + ids.join(",") + ")&select=seller_id,email_status,whatsapp_status,email_error,whatsapp_error,attempt_count");
  if (!response.ok) return new Map();
  return new Map((response.data || []).map(item => [item.seller_id, item]));
}

async function transferTeamMember(env, leader, target, targetRole, body) {
  const team = await getTeamRows(env, leader);
  if (!team) return jsonResponse({ error: "Não foi possível validar os limites da equipe." }, 503);
  const leaderProfile = leader.role === "SUPERVISOR" ? await getLeaderProfile(env, leader.user.id) : null;
  const roleMap = await getSellerRoles(env, [
    ...team.map(item => item.seller_user_id),
    ...team.map(item => item.executive_user_id),
    ...team.map(item => item.supervisor_user_id),
    leaderProfile?.executive_user_id
  ]);
  if (!roleMap) return jsonResponse({ error: "Não foi possível confirmar os perfis da equipe." }, 503);
  const destinationExecutive = String(body.executiveUserId || "") || null;
  const destinationSupervisor = String(body.supervisorUserId || "") || null;
  let executiveUserId = null;
  let supervisorUserId = null;
  let moveTeam = false;

  if (targetRole === "EXECUTIVO") {
    return jsonResponse({ error: "Um executivo não pode ser transferido para outra carteira." }, 400);
  }

  if (targetRole === "SUPERVISOR") {
    if (leader.role !== "GERENTE") return jsonResponse({ error: "Somente o gerente pode transferir um supervisor." }, 403);
    if (destinationSupervisor) return jsonResponse({ error: "Selecione o executivo de destino do supervisor." }, 400);
    if (destinationExecutive && (roleMap[destinationExecutive] !== "EXECUTIVO" ||
        !team.some(item => item.seller_user_id === destinationExecutive && item.active))) {
      return jsonResponse({ error: "O executivo de destino não está ativo na equipe." }, 400);
    }
    executiveUserId = destinationExecutive;
    moveTeam = body.moveTeam === true;
    if (body.moveTeam !== true && body.moveTeam !== false) {
      return jsonResponse({ error: "Escolha se os vendedores da equipe acompanham o supervisor." }, 400);
    }
  } else if (targetRole === "VENDEDOR") {
    const inScope = leader.role === "GERENTE"
      || (leader.role === "EXECUTIVO" && target.executive_user_id === leader.user.id)
      || (leader.role === "SUPERVISOR" && target.supervisor_user_id === leader.user.id);
    if (!inScope) return jsonResponse({ error: "Esse vendedor não pertence à sua equipe." }, 403);

    if (destinationSupervisor) {
      const supervisor = team.find(item => item.seller_user_id === destinationSupervisor && item.active);
      if (!supervisor || roleMap[destinationSupervisor] !== "SUPERVISOR") {
        return jsonResponse({ error: "O supervisor de destino não está ativo na sua equipe." }, 400);
      }
      if (leader.role === "SUPERVISOR") return jsonResponse({ error: "Supervisor só pode retirar vendedores da própria equipe." }, 403);
      executiveUserId = supervisor.executive_user_id || null;
      supervisorUserId = destinationSupervisor;
      if (leader.role === "EXECUTIVO" && executiveUserId !== leader.user.id) {
        return jsonResponse({ error: "O supervisor de destino pertence a outro executivo." }, 403);
      }
    } else if (leader.role === "SUPERVISOR") {
      if (!leaderProfile?.active || !leaderProfile.executive_user_id) {
        return jsonResponse({ error: "Não foi possível confirmar o executivo responsável pelo supervisor." }, 409);
      }
      if (destinationExecutive !== leaderProfile.executive_user_id) {
        return jsonResponse({ error: "Supervisor só pode devolver um vendedor à carteira do próprio executivo." }, 403);
      }
      executiveUserId = leaderProfile.executive_user_id;
    } else if (leader.role === "EXECUTIVO") {
      if (destinationExecutive && destinationExecutive !== leader.user.id) {
        return jsonResponse({ error: "O vendedor só pode permanecer nesta equipe executiva." }, 403);
      }
      executiveUserId = leader.user.id;
    } else {
      executiveUserId = destinationExecutive;
      if (executiveUserId && (roleMap[executiveUserId] !== "EXECUTIVO" ||
          !team.some(item => item.seller_user_id === executiveUserId && item.active))) {
        return jsonResponse({ error: "O executivo de destino não está ativo na equipe." }, 400);
      }
    }
  } else {
    return jsonResponse({ error: "Perfil sem transferência disponível." }, 400);
  }

  const response = await serviceRequest(env, "/rest/v1/rpc/transfer_seller_hierarchy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      p_seller_id: target.id,
      p_expected_supervisor_user_id: target.supervisor_user_id || null,
      p_expected_executive_user_id: target.executive_user_id || null,
      p_new_supervisor_user_id: supervisorUserId,
      p_new_executive_user_id: executiveUserId,
      p_move_team: moveTeam
    })
  });
  if (!response.ok) {
    return jsonResponse({ error: response.status === 409
      ? "A equipe mudou durante a transferência. Atualize a carteira e tente novamente."
      : "Não foi possível concluir a transferência da equipe." }, response.status === 409 ? 409 : 503);
  }
  return jsonResponse({ ok: true, role: targetRole, executiveUserId, supervisorUserId, moveTeam });
}

async function leaderSellersApi(request, env, url) {
  const leader = await requireLeader(request, env);
  if (leader.error) return leader.error;
  const readiness = communicationReadiness(env);
  const onboardingRoute = url.pathname.match(/^\/api\/sellers\/([0-9a-f-]+)\/retry$/i);
  const sellerRoute = url.pathname.match(/^\/api\/sellers\/([0-9a-f-]+)$/i);

  if (request.method === "GET" && url.pathname === "/api/sellers") {
    const sellers = await getTeamRows(env, leader);
    if (!sellers) return jsonResponse({ error: "Não foi possível carregar sua equipe." }, 503);
    const onboarding = await getOnboardingMap(env, sellers);
    const emails = await getAdminUserEmails(env, sellers.map(item => item.seller_user_id));
    if (!emails) return jsonResponse({ error: "Não foi possível carregar os contatos da equipe." }, 503);
    const leaderProfile = leader.role === "SUPERVISOR" ? await getLeaderProfile(env, leader.user.id) : null;
    const roleMap = await getSellerRoles(env, [
      ...sellers.map(item => item.seller_user_id),
      ...sellers.map(item => item.executive_user_id),
      ...sellers.map(item => item.supervisor_user_id),
      leaderProfile?.executive_user_id, leader.user.id
    ]);
    if (!roleMap) return jsonResponse({ error: "Não foi possível confirmar os perfis da equipe." }, 503);
    const executiveProfiles = sellers.filter(item => item.active && roleMap[item.seller_user_id] === "EXECUTIVO");
    if (leaderProfile?.executive_user_id && !executiveProfiles.some(item => item.seller_user_id === leaderProfile.executive_user_id)) {
      const parentExecutive = await getLeaderProfile(env, leaderProfile.executive_user_id);
      if (parentExecutive?.active && roleMap[parentExecutive.seller_user_id] === "EXECUTIVO") executiveProfiles.push(parentExecutive);
    }
    const executives = [...new Set(executiveProfiles.map(item => item.seller_user_id).filter(Boolean))];
    const supervisors = [...new Set(sellers
      .filter(item => item.active && roleMap[item.seller_user_id] === "SUPERVISOR")
      .map(item => item.seller_user_id).filter(Boolean))];
    const [executiveLabels, supervisorLabels] = await Promise.all([
      Promise.all(executives.map(async id => [id, await getAdminUserLabel(env, id)])),
      Promise.all(supervisors.map(async id => [id, await getAdminUserLabel(env, id)]))
    ]);
    return jsonResponse({
      role: leader.role,
      readiness,
      currentExecutiveUserId: leader.role === "EXECUTIVO" ? leader.user.id : leaderProfile?.executive_user_id || null,
      assignableExecutives: executiveLabels.filter(([, label]) => label).map(([id, label]) => ({ id, label })),
      assignableSupervisors: supervisorLabels.filter(([, label]) => label).map(([id, label]) => ({ id, label })),
      sellers: sellers.map(seller => ({
        ...seller,
        email: emails.get(seller.seller_user_id) || "",
        role: seller.seller_user_id ? roleMap[seller.seller_user_id] || "SEM PERFIL" : "VENDEDOR",
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
    const memberRole = String(body.memberRole || "VENDEDOR").toUpperCase();
    const digits = phoneDigits(body.phone);
    const region = String(body.region || "Santos").trim();
    const qrPng = qrBase64(body.qrPng);
    if (!SELLER_ID_RE.test(id) || name.length < 2 || name.length > 120
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254
      || ![10, 11].includes(digits.length) || region.length < 2 || region.length > 80 || !qrPng
      || !["VENDEDOR", "SUPERVISOR", "EXECUTIVO"].includes(memberRole)) {
      return jsonResponse({ error: "Confira nome, e-mail, telefone e região do vendedor." }, 400);
    }
    if ((memberRole === "EXECUTIVO" && leader.role !== "GERENTE")
      || (memberRole === "SUPERVISOR" && leader.role === "SUPERVISOR")) {
      return jsonResponse({ error: "Seu perfil não pode cadastrar este nível da equipe." }, 403);
    }

    let executiveUserId = null;
    let supervisorUserId = null;
    const team = await getTeamRows(env, leader);
    if (!team) return jsonResponse({ error: "Não foi possível validar os limites da equipe." }, 503);
    const ownLeaderProfile = leader.role === "SUPERVISOR" ? await getLeaderProfile(env, leader.user.id) : null;
    const teamRoleMap = await getSellerRoles(env, [
      ...team.map(item => item.seller_user_id), ...team.map(item => item.executive_user_id),
      ...team.map(item => item.supervisor_user_id), leader.user.id, ownLeaderProfile?.executive_user_id
    ]);
    if (!teamRoleMap) return jsonResponse({ error: "Não foi possível confirmar os perfis da equipe." }, 503);
    const selectedExecutive = String(body.executiveUserId || "") || null;
    const selectedSupervisor = String(body.supervisorUserId || "") || null;
    if (memberRole === "SUPERVISOR") {
      if (leader.role === "EXECUTIVO") executiveUserId = leader.user.id;
      else executiveUserId = selectedExecutive;
    } else if (memberRole === "VENDEDOR") {
      if (leader.role === "SUPERVISOR") {
        if (!ownLeaderProfile?.active) return jsonResponse({ error: "O supervisor precisa estar ativo e vinculado a um executivo antes de cadastrar vendedores." }, 409);
        supervisorUserId = leader.user.id;
        executiveUserId = ownLeaderProfile.executive_user_id || null;
      } else if (leader.role === "EXECUTIVO") {
        executiveUserId = leader.user.id;
        supervisorUserId = selectedSupervisor;
      } else {
        executiveUserId = selectedExecutive;
        supervisorUserId = selectedSupervisor;
      }
    }

    if (executiveUserId && !SELLER_ID_RE.test(executiveUserId)) return jsonResponse({ error: "Executivo inválido." }, 400);
    if (supervisorUserId && !SELLER_ID_RE.test(supervisorUserId)) return jsonResponse({ error: "Supervisor inválido." }, 400);
    const supervisorProfile = supervisorUserId ? team.find(item =>
      item.seller_user_id === supervisorUserId && teamRoleMap[supervisorUserId] === "SUPERVISOR" && item.active
    ) || (supervisorUserId === leader.user.id && ownLeaderProfile?.active ? ownLeaderProfile : null) : null;
    if (supervisorUserId && !supervisorProfile) {
      return jsonResponse({ error: "O supervisor selecionado não está ativo dentro da sua equipe." }, 403);
    }
    if (supervisorProfile) {
      if (executiveUserId && supervisorProfile.executive_user_id !== executiveUserId) {
        return jsonResponse({ error: "O supervisor selecionado pertence a outro executivo." }, 403);
      }
      executiveUserId = supervisorProfile.executive_user_id || executiveUserId;
    }
    if (executiveUserId && teamRoleMap[executiveUserId] !== "EXECUTIVO"
      && !(leader.role === "EXECUTIVO" && executiveUserId === leader.user.id)) {
      return jsonResponse({ error: "A atribuição precisa apontar para contas já cadastradas no perfil correspondente." }, 400);
    }
    if (executiveUserId && leader.role === "GERENTE" &&
        !team.some(item => item.seller_user_id === executiveUserId && item.active)) {
      return jsonResponse({ error: "O executivo selecionado precisa estar ativo." }, 400);
    }
    if (supervisorUserId && teamRoleMap[supervisorUserId] !== "SUPERVISOR") {
      return jsonResponse({ error: "A atribuição precisa apontar para uma conta já cadastrada como supervisor." }, 400);
    }

    const invite = await createSellerAuthLink(env, email, name, memberRole);
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
      body: JSON.stringify({ user_id: userId, role: memberRole })
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
    const targetRoles = await getSellerRoles(env, [target.seller_user_id]);
    if (!targetRoles) return jsonResponse({ error: "Não foi possível confirmar o perfil deste integrante." }, 503);
    const targetRole = target.seller_user_id ? targetRoles[target.seller_user_id] : "";
    if (!targetRole || !["GERENTE", "EXECUTIVO", "SUPERVISOR", "VENDEDOR"].includes(targetRole)) {
      return jsonResponse({ error: "O perfil deste integrante não está configurado corretamente." }, 409);
    }
    const inScope = leader.role === "GERENTE"
      || (leader.role === "EXECUTIVO" && target.executive_user_id === leader.user.id)
      || (leader.role === "SUPERVISOR" && target.supervisor_user_id === leader.user.id && targetRole === "VENDEDOR");
    if (!inScope) return jsonResponse({ error: "Esse vendedor não pertence à sua equipe." }, 403);

    if (request.method === "PATCH") {
      let body;
      try { body = await request.json(); } catch { return jsonResponse({ error: "Ação inválida." }, 400); }
      if (body.transfer && typeof body.transfer === "object") {
        return transferTeamMember(env, leader, target, targetRole, body.transfer);
      }
      if (typeof body.active !== "boolean") return jsonResponse({ error: "Informe o novo estado do vendedor." }, 400);
      if (targetRole !== "VENDEDOR" && !(leader.role === "GERENTE" && ["EXECUTIVO", "SUPERVISOR"].includes(targetRole))) {
        return jsonResponse({ error: "Seu perfil não pode alterar o acesso deste integrante." }, 403);
      }
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
      return jsonResponse({ ok: true, active: body.active, role: targetRole });
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
    const invite = onboarding.data[0].email_status === "sent" ? null : await createSellerAuthLink(env, email, target.name);
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
  const qrUrl = env.WALLET_PUBLIC_ORIGIN + "/?vendedor=" + encodeURIComponent(seller.id);
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

function html(body) {
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=UTF-8"
    }
  });
}

function page(config, publicOrigin) {
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

html{color-scheme:light}

body{
  margin:0;
  background:#f3f4f6;
  font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  color:#17191d;
  line-height:1.5
}

.top{
  background:linear-gradient(110deg,#c9000b,#ed1b2f);
  color:#fff;
  padding:18px max(20px,calc((100vw - 1440px)/2));
  box-shadow:0 4px 18px rgba(103,0,7,.18)
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
  max-width:1480px;
  margin:24px auto;
  padding:0 22px
}

.card{
  background:#fff;
  border:1px solid #e6e8ec;
  border-radius:18px;
  padding:22px;
  box-shadow:0 8px 28px rgba(25,31,42,.06);
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
  font-size:24px;
  font-weight:800;
  margin:0 0 14px;
  letter-spacing:-.025em
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
  min-height:48px;
  padding:12px 14px;
  border:1px solid #cfd2d8;
  border-radius:11px;
  font-size:15px;
  background:#fff;
  transition:border-color .15s,box-shadow .15s
}

.field input:focus,.field select:focus,.filters input:focus,.filters select:focus{
  outline:none;border-color:#d50000;box-shadow:0 0 0 4px rgba(213,0,0,.11)
}

.btn{
  border:0;
  border-radius:11px;
  padding:12px 17px;
  background:#d50000;
  color:#fff;
  font-weight:800;
  cursor:pointer;
  transition:transform .15s,background .15s,box-shadow .15s
}

.btn:hover:not(:disabled){background:#b90000;box-shadow:0 6px 14px rgba(213,0,0,.16)}
.btn:focus-visible,.link-button:focus-visible{outline:3px solid #25282e;outline-offset:3px}

.btn.secondary{
  background:#333
}

.btn:disabled{
  background:#666;
  cursor:not-allowed
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
  background:linear-gradient(145deg,#fff,#f8f9fb);
  border:1px solid #e6e8ec;
  border-radius:14px;
  padding:17px
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
  min-height:48px;
  padding:12px 14px;
  border:1px solid #cfd2d8;
  border-radius:11px;
  font-size:14px;
  background:#fff
}

.team-actions,.transfer-controls{
  display:flex;
  align-items:center;
  gap:7px;
  flex-wrap:wrap
}

.transfer-controls select{
  min-height:42px;
  max-width:240px;
  padding:8px 10px;
  border:1px solid #cfd2d8;
  border-radius:9px;
  background:#fff
}

.move-team-option{
  display:inline-flex;
  align-items:center;
  gap:6px;
  color:#444;
  font-size:13px;
  white-space:nowrap
}

.move-team-option input{accent-color:#d50000}

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
  padding:13px 11px;
  border-bottom:1px solid #e9ebef;
  text-align:left;
  font-size:13px;
  vertical-align:top
}

th{
  font-size:12px;
  background:#f7f8fa;
  color:#434852;
  font-weight:750;
  position:sticky;
  top:0
}

.pill{
  display:inline-block;
  padding:5px 8px;
  border-radius:20px;
  background:#f0f1f3;
  color:#292c32;
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
    padding:0 12px
  }

  .card{
    padding:16px;
    border-radius:15px
  }

  .top{padding:16px 18px}
  .wrap{margin:16px auto}
  .table-wrap{border:1px solid #e8eaee;border-radius:12px}
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
    <h2 class="h">Equipe</h2>
    <p class="muted">O convite e o QR Code são enviados automaticamente por e-mail. O botão do WhatsApp abre uma mensagem pronta para envio manual, sem cobrança da Meta.</p>
    <p id="sellerSetupStatus" class="muted" role="status" aria-live="polite"></p>
    <form id="sellerForm" class="filters" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr));margin:14px 0">
      <select id="sellerRole" aria-label="Perfil da equipe">
        <option value="VENDEDOR">Vendedor</option>
        <option value="SUPERVISOR">Supervisor</option>
        <option value="EXECUTIVO">Executivo / Coordenador</option>
      </select>
      <input id="sellerName" placeholder="Nome completo" required maxlength="120">
      <input id="sellerEmail" type="email" placeholder="E-mail" required maxlength="254">
      <input id="sellerPhone" type="tel" placeholder="WhatsApp com DDD (obrigatório)" aria-label="WhatsApp com DDD (obrigatório)" required>
      <input id="sellerRegion" placeholder="Região" value="Santos" required maxlength="80">
      <select id="sellerExecutive" class="hidden"><option value="">Selecione o executivo</option></select>
      <select id="sellerSupervisor" class="hidden"><option value="">Selecione o supervisor</option></select>
      <button id="sellerCreateBtn" class="btn" type="submit" aria-describedby="sellerSetupStatus" disabled>Cadastrar vendedor</button>
    </form>
    <div id="sellerManagementStatus" class="muted" role="status" aria-live="polite"></div>
    <div style="overflow:auto;margin-top:12px">
      <table style="width:100%;border-collapse:collapse">
        <thead><tr><th>Integrante</th><th>Perfil</th><th>Região</th><th>E-mail</th><th>Telefone</th><th>Estado</th><th>Envios</th><th>Ação</th></tr></thead>
        <tbody id="sellerManagementRows"></tbody>
      </table>
    </div>
  </section>


  <div
    class="card"
    style="margin-top:18px"
  >

    <div class="export-actions" style="display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-bottom:14px">
      <button id="exportMailingBtn" class="btn secondary hidden" type="button">Exportar mailing da equipe (Excel)</button>
      <button id="exportLeadsBtn" class="btn secondary" type="button">Exportar clientes (Excel)</button>
    </div>

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


<dialog id="observationDialog" aria-labelledby="observationTitle">
  <form id="observationForm">
    <h2 id="observationTitle">Editar observação</h2>
    <label for="observationInput">Observação (até 2.000 caracteres)</label>
    <textarea id="observationInput" rows="5" autofocus></textarea>
    <p id="observationError" role="alert"></p>
    <button type="button" id="cancelObservation">Cancelar</button>
    <button type="submit" id="saveObservation">Salvar</button>
  </form>
</dialog>

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

// Capture the callback before the SDK consumes and clears its fragment.
const passwordLinkType = new URLSearchParams(window.location.hash.slice(1)).get("type");
let passwordSetupPending = ["invite", "recovery"].includes(passwordLinkType);

const client = createClient(
  ${JSON.stringify(config.url)},
  ${JSON.stringify(config.key)}
);


let leads = [];
let isManager = false;
let canUpdateLeadStatus = false;
let editingObservation = null;
let leaderRole = "";
let sellerTeamData = null;
let sellerAccessGuardUserId = "";
let sellerAccessGuardBusy = false;
let sellerAccessVisibilityHandler = null;
let sellerAccessFocusHandler = null;
const QR_PRODUCTION_ORIGIN = ${JSON.stringify(publicOrigin)};
const LEAD_STATUS_OPTIONS = [
  ["NOVO", "NOVO"],
  ["CONTATO_REALIZADO", "CONTATO REALIZADO"],
  ["PROPOSTA", "PROPOSTA"],
  ["NEGOCIACAO", "NEGOCIAÇÃO"],
  ["VENDA", "VENDA"],
  ["NAO_VENDA", "NÃO VENDA"]
];


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

function visibleLeads() {
  const query = $("search").value.trim().toLowerCase();
  const product = $("product").value;
  const status = $("status").value;
  return leads.filter(lead => {
    const matchesSearch = !query || [lead.name, lead.customer_phone, lead.address]
      .some(value => String(value ?? "").toLowerCase().includes(query));
    return matchesSearch && (!product || lead.product_searched === product)
      && (!status || lead.status === status);
  });
}

function xmlSafe(value) {
  const clean = Array.from(String(value ?? ""))
    .filter(character => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || code >= 32;
    }).join("");
  return escapeHtml(clean);
}

function excelColumn(index) {
  let number = index + 1;
  let label = "";
  while (number > 0) {
    const digit = (number - 1) % 26;
    label = String.fromCharCode(65 + digit) + label;
    number = Math.floor((number - 1) / 26);
  }
  return label;
}

function createXlsx(rows, sheetName) {
  const encoder = new TextEncoder();
  const xmlRows = rows.map((row, rowIndex) => {
    const rowNumber = rowIndex + 1;
    const cells = row.map((value, columnIndex) => {
      const reference = excelColumn(columnIndex) + rowNumber;
      return '<c r="' + reference + '" t="inlineStr"><is><t xml:space="preserve">'
        + xmlSafe(value) + '</t></is></c>';
    }).join("");
    return '<row r="' + rowNumber + '">' + cells + '</row>';
  }).join("");
  const files = [
    ["[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
    ["_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ["xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' + xmlSafe(sheetName) + '" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ["xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
    ["xl/worksheets/sheet1.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + xmlRows + '</sheetData></worksheet>']
  ];
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let value = n;
    for (let bit = 0; bit < 8; bit++) value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
    crcTable[n] = value >>> 0;
  }
  const crc32 = bytes => {
    let crc = 0xFFFFFFFF;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  };
  const write16 = (view, offset, value) => view.setUint16(offset, value, true);
  const write32 = (view, offset, value) => view.setUint32(offset, value >>> 0, true);
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const [name, xml] of files) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(xml);
    const checksum = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    write32(localView, 0, 0x04034B50); write16(localView, 4, 20); write16(localView, 6, 0);
    write16(localView, 8, 0); write16(localView, 10, 0); write16(localView, 12, 0);
    write32(localView, 14, checksum); write32(localView, 18, data.length); write32(localView, 22, data.length);
    write16(localView, 26, nameBytes.length); write16(localView, 28, 0); local.set(nameBytes, 30);
    localParts.push(local, data);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    write32(centralView, 0, 0x02014B50); write16(centralView, 4, 20); write16(centralView, 6, 20);
    write16(centralView, 8, 0); write16(centralView, 10, 0); write16(centralView, 12, 0); write16(centralView, 14, 0);
    write32(centralView, 16, checksum); write32(centralView, 20, data.length); write32(centralView, 24, data.length);
    write16(centralView, 28, nameBytes.length); write16(centralView, 30, 0); write16(centralView, 32, 0);
    write16(centralView, 34, 0); write16(centralView, 36, 0); write32(centralView, 38, 0);
    write32(centralView, 42, localOffset); central.set(nameBytes, 46); centralParts.push(central);
    localOffset += local.length + data.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  write32(endView, 0, 0x06054B50); write16(endView, 4, 0); write16(endView, 6, 0);
  write16(endView, 8, files.length); write16(endView, 10, files.length);
  write32(endView, 12, centralSize); write32(endView, 16, localOffset); write16(endView, 20, 0);
  return new Blob([...localParts, ...centralParts, end], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function downloadXlsx(rows, sheetName, filename) {
  const url = URL.createObjectURL(createXlsx(rows, sheetName));
  const link = document.createElement("a");
  link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
      leads = leads.map(lead => {
        const fields = fieldsByLead.get(lead.id);
        return fields ? {
          ...lead,
          observation: fields.observation,
          crm_external_id: fields.crm_external_id
        } : lead;
      });
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

        "<td>" + (canUpdateLeadStatus
          ? '<select class="lead-status-select" data-lead-status="' + escapeHtml(lead.id) + '" aria-label="Status de ' + escapeHtml(lead.name) + '">' +
            LEAD_STATUS_OPTIONS.map(([value, label]) => '<option value="' + value + '"' + (lead.status === value ? " selected" : "") + '>' + label + '</option>').join("") +
            '</select>'
          : escapeHtml(lead.status)) +
        "</td>" +

        (isManager ?
          "<td>" + escapeHtml(lead.observation) +
          (lead.observation !== undefined ? '<br><button type="button" data-observation-lead="' +
            escapeHtml(lead.id) + '">Editar observação</button>' : "") + "</td>" +
          "<td>" + escapeHtml(lead.crm_external_id) + "</td>" : "") +

      "</tr>"
    ).join("");

}


$("rows").addEventListener("change", async event => {
  const select = event.target.closest("[data-lead-status]");
  if (!canUpdateLeadStatus || !select) return;
  const lead = leads.find(item => item.id === select.dataset.leadStatus);
  const previousStatus = lead?.status;
  const nextStatus = select.value;
  if (!lead || previousStatus === nextStatus) return;
  select.disabled = true;
  try {
    const { data, error } = await client.from("leads").update({ status: nextStatus })
      .eq("id", lead.id).select("id").maybeSingle();
    if (error) throw error;
    if (!data?.id) throw new Error("Lead não encontrado ou sem permissão para atualizar.");
    lead.status = nextStatus;
    render();
  } catch (error) {
    select.value = previousStatus;
    $("message").textContent = "Não foi possível atualizar o status. Tente novamente.";
    console.error(error);
  } finally {
    if (select.isConnected) select.disabled = false;
  }
});


$("rows").addEventListener("click", event => {
  const button = event.target.closest("[data-observation-lead]");
  if (!isManager || !button) return;
  const lead = leads.find(item =>
    item.id === button.dataset.observationLead && item.observation !== undefined
  );
  if (!lead) return;

  editingObservation = lead;
  $("observationInput").value = lead.observation ?? "";
  $("observationError").textContent = "";
  $("observationDialog").showModal();
});

$("cancelObservation").onclick = () => $("observationDialog").close();
$("observationDialog").addEventListener("cancel", event => {
  if ($("saveObservation").disabled) event.preventDefault();
});
$("observationDialog").addEventListener("close", () => {
  $("observationInput").value = "";
  editingObservation = null;
});

$("observationForm").addEventListener("submit", async event => {
  event.preventDefault();
  const lead = editingObservation;
  const save = $("saveObservation");
  if (!isManager || !lead || save.disabled) return;

  const input = $("observationInput");
  const observation = input.value.trim() || null;
  const errorMessage = $("observationError");
  if (observation && Array.from(observation).length > 2000) {
    errorMessage.textContent = "Use até 2.000 caracteres.";
    return;
  }

  errorMessage.textContent = "";
  save.disabled = $("cancelObservation").disabled = input.disabled = true;
  try {
    const { data, error } = await client.rpc("manager_update_lead_observation", {
      p_lead_id: lead.id,
      p_expected_observation: lead.observation,
      p_observation: observation
    });
    if (error?.code === "PT409") {
      $("observationDialog").close();
      await loadLeads();
      $("managerMessage").textContent = "A observação mudou. Confira o valor atual antes de editar novamente.";
      return;
    }
    if (error) throw error;

    lead.observation = data;
    $("observationDialog").close();
    render();
    $("managerMessage").textContent = "Observação salva.";
  } catch (error) {
    errorMessage.textContent = error.code === "42501"
      ? "Seu perfil não tem permissão para editar observações."
      : "Não foi possível salvar a observação. Tente novamente.";
  } finally {
    save.disabled = $("cancelObservation").disabled = input.disabled = false;
  }
});

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
  passwordSetupPending = true;
  $("app").classList.add("hidden");
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

  passwordSetupPending = false;
  window.history.replaceState({}, document.title, window.location.pathname);
  await showApp();
}


function clearSellerWalletData() {
  leads = [];
  $("total").textContent = "0";
  $("novos").textContent = "0";
  $("propostas").textContent = "0";
  $("vendas").textContent = "0";
  $("rows").replaceChildren();
}

function stopSellerAccessGuard() {
  if (sellerAccessVisibilityHandler) {
    document.removeEventListener("visibilitychange", sellerAccessVisibilityHandler);
  }
  if (sellerAccessFocusHandler) {
    window.removeEventListener("focus", sellerAccessFocusHandler);
  }
  sellerAccessVisibilityHandler = null;
  sellerAccessFocusHandler = null;
  sellerAccessGuardUserId = "";
}

async function verifySellerAccessOnResume() {
  const expectedUserId = sellerAccessGuardUserId;
  if (!expectedUserId || sellerAccessGuardBusy || document.visibilityState === "hidden") return;

  sellerAccessGuardBusy = true;
  try {
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError) throw userError;
    if (userData?.user?.id !== expectedUserId) {
      stopSellerAccessGuard();
      return;
    }

    const { data: activeSeller, error: sellerAccessError } = await client
      .from("sellers")
      .select("id")
      .eq("seller_user_id", expectedUserId)
      .eq("active", true)
      .maybeSingle();

    if (sellerAccessError) throw sellerAccessError;
    if (!activeSeller) {
      stopSellerAccessGuard();
      clearSellerWalletData();
      $("app").classList.add("hidden");
      $("login").classList.remove("hidden");
      $("loginForm").classList.remove("hidden");
      $("loginError").textContent = "Seu acesso à carteira está desativado. Fale com seu gerente para reativá-lo.";
      const { error: signOutError } = await client.auth.signOut();
      if (signOutError) console.error(signOutError);
      return;
    }

    await loadLeads();
  } catch (error) {
    clearSellerWalletData();
    $("message").textContent = "Não foi possível confirmar seu acesso. Atualize a página para tentar novamente.";
    console.error(error);
  } finally {
    sellerAccessGuardBusy = false;
  }
}

function startSellerAccessGuard(userId) {
  stopSellerAccessGuard();
  sellerAccessGuardUserId = userId;
  sellerAccessVisibilityHandler = () => {
    if (document.visibilityState === "hidden") {
      clearSellerWalletData();
      return;
    }
    void verifySellerAccessOnResume();
  };
  sellerAccessFocusHandler = () => void verifySellerAccessOnResume();
  document.addEventListener("visibilitychange", sellerAccessVisibilityHandler);
  window.addEventListener("focus", sellerAccessFocusHandler);
}

async function showApp() {
  if (passwordSetupPending) return;

  let user;
  try {
    const { data, error } = await client.auth.getUser();
    if (error) throw error;
    user = data?.user;
    if (user) {
      const { data: ready, error: readinessError } = await client.rpc("wallet_password_ready");
      if (readinessError) throw readinessError;
      if (ready !== true) {
        showPasswordPanel();
        return;
      }
    }
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
    $("loginError").textContent = "Não foi possível confirmar seu perfil. Tente novamente.";
    console.error(rolesError);
    return;
  }

  const roleRows = roles || [];
  isManager = roleRows.some(role => role.role === "GERENTE");
  canUpdateLeadStatus = roleRows.some(role => role.role === "VENDEDOR");
  leaderRole = roleRows.map(role => role.role).find(role => ["GERENTE", "EXECUTIVO", "SUPERVISOR"].includes(role)) || "";

  if (roleRows.some(role => role.role === "VENDEDOR") || (!isManager && ["EXECUTIVO", "SUPERVISOR"].includes(leaderRole))) {
    const { data: activeSeller, error: sellerAccessError } = await client
      .from("sellers")
      .select("id")
      .eq("seller_user_id", user.id)
      .eq("active", true)
      .maybeSingle();

    if (sellerAccessError || !activeSeller) {
      stopSellerAccessGuard();
      clearSellerWalletData();
      await client.auth.signOut();
      $("app").classList.add("hidden");
      $("login").classList.remove("hidden");
      $("loginForm").classList.remove("hidden");
      $("loginError").textContent = sellerAccessError
        ? "Não foi possível confirmar se seu acesso está ativo. Tente novamente."
        : "Seu acesso à carteira está desativado. Fale com seu gerente para reativá-lo.";
      if (sellerAccessError) console.error(sellerAccessError);
      return;
    }
    startSellerAccessGuard(user.id);
  } else {
    stopSellerAccessGuard();
  }

  $("managerObservationHeader").classList.toggle("hidden", !isManager);
  $("managerCrmHeader").classList.toggle("hidden", !isManager);
  $("managerQrPanel").classList.toggle("hidden", !isManager);
  $("sellerManagementPanel").classList.toggle("hidden", !leaderRole);
  $("exportMailingBtn").classList.toggle("hidden", !leaderRole);


  $("scope").textContent =
    "Usuário: " +
    user.email +
    (leaderRole ? " · Perfil " + (leaderRole === "EXECUTIVO" ? "Executivo / Coordenador" : leaderRole.toLowerCase()) : " · Acesso controlado pelo RLS do Supabase");


  await loadLeads();

  if (leaderRole) await loadSellerManagement();
  if (isManager) await loadManagerQrSellers();

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
  $("sellerCreateBtn").disabled = true;
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
    const roleSelect = $("sellerRole");
    const roleOptions = payload.role === "GERENTE"
      ? [["VENDEDOR", "Vendedor"], ["SUPERVISOR", "Supervisor"], ["EXECUTIVO", "Executivo / Coordenador"]]
      : payload.role === "EXECUTIVO"
        ? [["VENDEDOR", "Vendedor"], ["SUPERVISOR", "Supervisor"]]
        : [["VENDEDOR", "Vendedor"]];
    roleSelect.replaceChildren(...roleOptions.map(([value, label]) => new Option(label, value)));
    const execSelect = $("sellerExecutive");
    const supSelect = $("sellerSupervisor");
    for (const [select, choices, label] of [[execSelect, payload.assignableExecutives, "Sem executivo vinculado"], [supSelect, payload.assignableSupervisors, "Sem supervisor vinculado"]]) {
      select.replaceChildren(new Option(label, ""));
      (choices || []).forEach(choice => select.add(new Option(choice.label, choice.id)));
    }
    updateSellerAssignmentFields();
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
      const role = document.createElement("td"); role.textContent = seller.role === "EXECUTIVO" ? "Executivo / Coordenador" : seller.role === "SUPERVISOR" ? "Supervisor" : "Vendedor";
      const region = document.createElement("td"); region.textContent = seller.region || "—";
      const email = document.createElement("td"); email.textContent = seller.email || "—";
      const phone = document.createElement("td"); phone.textContent = seller.phone ? formatPhone(seller.phone) : "—";
      const active = document.createElement("td"); active.textContent = state;
      const sends = document.createElement("td"); sends.textContent = delivery;
      const actionCell = document.createElement("td");
      actionCell.className = "team-actions";
      if (seller.role === "VENDEDOR" || (payload.role === "GERENTE" && ["EXECUTIVO", "SUPERVISOR"].includes(seller.role))) {
        const action = document.createElement("button"); action.type = "button"; action.className = "btn secondary";
        action.textContent = seller.active ? "Desligar" : "Reativar";
        action.addEventListener("click", () => setSellerActive(seller, !seller.active));
        actionCell.append(action);
      }
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
      if (seller.role === "SUPERVISOR" && payload.role === "GERENTE" || seller.role === "VENDEDOR") {
        appendTransferControls(actionCell, seller, payload);
      }
      tr.append(name, role, region, email, phone, active, sends, actionCell); rows.append(tr);
    });
  } catch (error) {
    status.textContent = error.message;
  }
}

function updateSellerAssignmentFields() {
  if (!sellerTeamData) return;
  const role = $("sellerRole").value;
  const showExecutive = sellerTeamData.role === "GERENTE" && role !== "EXECUTIVO";
  const showSupervisor = role === "VENDEDOR" && sellerTeamData.role !== "SUPERVISOR";
  $("sellerExecutive").classList.toggle("hidden", !showExecutive || !sellerTeamData.assignableExecutives?.length);
  $("sellerSupervisor").classList.toggle("hidden", !showSupervisor || !sellerTeamData.assignableSupervisors?.length);
  $("sellerExecutive").required = showExecutive && sellerTeamData.assignableExecutives?.length > 0 && role === "SUPERVISOR";
}

$("sellerRole").addEventListener("change", updateSellerAssignmentFields);

function appendTransferControls(actionCell, seller, payload) {
  const group = document.createElement("span"); group.className = "transfer-controls";
  const select = document.createElement("select"); select.setAttribute("aria-label", "Transferir " + seller.name + " para");
  const add = (label, value, selected = false) => {
    const option = new Option(label, value); option.selected = selected; select.add(option);
  };
  add("Transferir para…", "");
  if (seller.role === "SUPERVISOR") {
    add("Sem executivo", "manager");
    (payload.assignableExecutives || []).forEach(item => add("Executivo: " + item.label, "executive:" + item.id));
  } else if (payload.role === "GERENTE") {
    add("Carteira do gerente", "manager");
    (payload.assignableExecutives || []).forEach(item => add("Executivo: " + item.label, "executive:" + item.id));
    (payload.assignableSupervisors || []).forEach(item => add("Supervisor: " + item.label, "supervisor:" + item.id));
  } else if (payload.role === "EXECUTIVO") {
    add("Direto nesta equipe", "executive:" + payload.currentExecutiveUserId);
    (payload.assignableSupervisors || []).forEach(item => add("Supervisor: " + item.label, "supervisor:" + item.id));
  } else if (payload.role === "SUPERVISOR" && payload.currentExecutiveUserId) {
    add("Carteira do executivo", "executive:" + payload.currentExecutiveUserId);
  }
  const moveTeam = document.createElement("input");
  moveTeam.type = "checkbox"; moveTeam.checked = true;
  const moveTeamLabel = document.createElement("label");
  moveTeamLabel.className = "move-team-option";
  moveTeamLabel.append(moveTeam, document.createTextNode("Levar vendedores da equipe"));
  if (seller.role === "SUPERVISOR") group.append(select, moveTeamLabel);
  else group.append(select);
  const transfer = document.createElement("button"); transfer.type = "button"; transfer.className = "btn secondary";
  transfer.textContent = "Transferir";
  transfer.addEventListener("click", () => submitSellerTransfer(seller, select, moveTeam));
  group.append(transfer);
  actionCell.append(group);
}

async function submitSellerTransfer(seller, select, moveTeam) {
  const selected = select.value;
  if (!selected) {
    $("sellerManagementStatus").textContent = "Selecione o destino da transferência.";
    return;
  }
  let transfer = { executiveUserId: null, supervisorUserId: null, moveTeam: moveTeam.checked };
  if (selected.startsWith("executive:")) transfer.executiveUserId = selected.slice("executive:".length) || null;
  else if (selected.startsWith("supervisor:")) transfer.supervisorUserId = selected.slice("supervisor:".length);
  else if (selected !== "manager") return;

  const message = seller.role === "SUPERVISOR"
    ? moveTeam.checked
      ? "O supervisor e seus vendedores serão transferidos para o executivo escolhido. Os leads continuarão nas carteiras dos mesmos vendedores. Continuar?"
      : "O supervisor será transferido sem levar os vendedores. Eles permanecerão com o executivo atual e deixarão de pertencer a este supervisor. Continuar?"
    : "A transferência muda quais supervisores e executivos podem acessar os leads de " + seller.name + ". Os leads permanecem na carteira do vendedor. Continuar?";
  if (!window.confirm(message)) return;

  const status = $("sellerManagementStatus"); status.textContent = "Transferindo…";
  const button = select.parentElement.querySelector("button"); button.disabled = true;
  try {
    const headers = await sellerApiHeaders();
    const response = await fetch("/api/sellers/" + encodeURIComponent(seller.id), {
      method: "PATCH", headers, body: JSON.stringify({ transfer })
    });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || "Não foi possível transferir.");
    status.textContent = seller.role === "SUPERVISOR" && !transfer.moveTeam
      ? "Supervisor transferido. Os vendedores permaneceram com o executivo anterior."
      : "Transferência concluída. Os leads continuam nas carteiras dos mesmos vendedores.";
    await loadLeads();
    await loadSellerManagement();
    if (isManager) await loadManagerQrSellers();
  } catch (error) {
    status.textContent = error.message;
    button.disabled = false;
  }
}

async function setSellerActive(seller, active) {
  if (!active && seller.role === "EXECUTIVO" &&
      !window.confirm("Desativar este executivo suspende o acesso dele e dos supervisores da equipe aos dados da equipe. As contas dos vendedores e seus leads permanecem ativos. Continuar?")) return;
  if (!active && seller.role === "SUPERVISOR" &&
      !window.confirm("Desativar este supervisor bloqueia o acesso dele à equipe. Os vendedores e seus leads permanecem ativos; o executivo responsável mantém o acesso. Continuar?")) return;
  const status = $("sellerManagementStatus"); status.textContent = "Salvando…";
  try {
    const headers = await sellerApiHeaders();
    const response = await fetch("/api/sellers/" + encodeURIComponent(seller.id), { method: "PATCH", headers, body: JSON.stringify({ active }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || "Não foi possível alterar o acesso.");
    status.textContent = active
      ? (seller.role === "VENDEDOR" ? "Vendedor reativado." : "Gestor reativado.")
      : (seller.role === "VENDEDOR" ? "Vendedor desligado; o acesso foi bloqueado." : "Gestor desligado; o acesso dele e da equipe ficou suspenso.");
    await loadSellerManagement();
  } catch (error) { status.textContent = error.message; }
}

function sellerQrPng(url) {
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  const canvas = document.createElement("canvas");
  const modules = qr.getModuleCount();
  const cell = 8;
  const quietZone = 4;
  canvas.width = canvas.height = (modules + quietZone * 2) * cell;
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#000";
  for (let row = 0; row < modules; row++) {
    for (let column = 0; column < modules; column++) {
      if (qr.isDark(row, column)) {
        context.fillRect((column + quietZone) * cell, (row + quietZone) * cell, cell, cell);
      }
    }
  }
  return canvas.toDataURL("image/png");

}

async function createSeller(event) {
  event.preventDefault();
  const button = $("sellerCreateBtn"); const status = $("sellerManagementStatus");
  if (!sellerTeamData?.readiness?.ready) {
    status.textContent = "Cadastro indisponível até o envio de e-mail ser configurado.";
    return;
  }
  if (typeof window.qrcode !== "function") { status.textContent = "Gerador de QR indisponível. Atualize a página."; return; }
  button.disabled = true; button.textContent = "Criando e enviando e-mail…"; status.textContent = "";
  try {
    const id = crypto.randomUUID();
    const canonical = new URL("/", QR_PRODUCTION_ORIGIN); canonical.searchParams.set("vendedor", id);
    const qrPng = sellerQrPng(canonical.href);

    const headers = await sellerApiHeaders();
    const response = await fetch("/api/sellers", { method: "POST", headers, body: JSON.stringify({
      sellerId: id, memberRole: $("sellerRole").value, name: $("sellerName").value.trim(), email: $("sellerEmail").value.trim(),
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
    const headers = await sellerApiHeaders();
    const response = await fetch("/api/sellers/" + encodeURIComponent(seller.id) + "/retry", { method: "POST", headers, body: JSON.stringify({ qrPng: sellerQrPng(canonical.href) }) });

    const result = await response.json(); if (!response.ok) throw new Error(result.error || "Não foi possível reenviar.");
    status.textContent = result.message || "Reenvio processado."; await loadSellerManagement();
  } catch (error) { status.textContent = error.message; }
}

$("sellerForm").addEventListener("submit", createSeller);


let qrSellers = [];

async function loadManagerQrSellers() {
  $("qrStatus").textContent = "Carregando vendedores ativos…";
  if (!sellerTeamData?.sellers) {
    $("qrStatus").textContent = "Não foi possível carregar os vendedores para gerar os QR Codes.";
    return;
  }

  qrSellers = sellerTeamData.sellers
    .filter(item => item.active && item.role === "VENDEDOR")
    .map(({ id, slug, name, active }) => ({ id, slug, name, active }));
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
  if (event === "SIGNED_OUT") {
    stopSellerAccessGuard();
    clearSellerWalletData();
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


$("exportLeadsBtn").addEventListener("click", () => {
  const headers = ["Cliente", "Telefone", "Endereço", "Possui Claro", "Produto de interesse", "Data/Hora", "Status"];
  if (isManager) headers.push("Observação", "ID no CRM");
  const rows = [headers, ...visibleLeads().map(lead => {
    const row = [lead.name, lead.customer_phone, lead.address, lead.has_claro, lead.product_searched, formatDate(lead.created_at), lead.status];
    if (isManager) row.push(lead.observation, lead.crm_external_id);
    return row;
  })];
  downloadXlsx(rows, "Clientes", "carteira-clientes.xlsx");
});


$("exportMailingBtn").addEventListener("click", () => {
  const sellers = sellerTeamData?.sellers || [];
  if (!leaderRole || !sellerTeamData) {
    $("sellerSetupStatus").textContent = "Carregue a equipe antes de exportar o mailing.";
    return;
  }
  const rows = [["Integrante", "Perfil", "Região", "E-mail", "Telefone", "Estado"], ...sellers.map(seller => [
    seller.name,
    seller.role === "EXECUTIVO" ? "Executivo / Coordenador" : seller.role === "SUPERVISOR" ? "Supervisor" : "Vendedor",
    seller.region,
    seller.email,
    seller.phone,
    seller.active ? "Ativo" : "Desligado"
  ])];
  downloadXlsx(rows, "Equipe", "mailing-equipe.xlsx");
});


$("logoutBtn")
  .onclick =
    async () => {

      const button = $("logoutBtn");
      $("logoutError").textContent = "";
      button.disabled = true;
      button.textContent = "Saindo...";

      try {
        stopSellerAccessGuard();
        clearSellerWalletData();
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
    const { data, error } = await client.auth.getSession();
    if (error) throw error;

    if (passwordSetupPending && data.session) {
      showPasswordPanel();
    } else if (passwordSetupPending) {
      passwordSetupPending = false;
      $("login").classList.remove("hidden");
      $("loginError").textContent = "Link inválido ou expirado. Solicite um novo link de primeiro acesso.";
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

    const isWallet = url.pathname === "/carteira" || url.pathname === "/carteira/";
    const isSellerApi = url.pathname === "/api/sellers" || url.pathname.startsWith("/api/sellers/");
    if (isWallet || isSellerApi) {
      const config = walletSupabaseConfig(env);
      if (!config) return jsonResponse({ error: "Configuração da carteira indisponível." }, 503);
      const publicOrigin = env.WALLET_PREVIEW === "true" ? env.WALLET_PUBLIC_ORIGIN : QR_PRODUCTION_ORIGIN;
      if (!/^https:\/\/[a-z0-9.-]+$/i.test(publicOrigin ?? "") ||
          (env.WALLET_PREVIEW === "true" && publicOrigin.toLowerCase() === QR_PRODUCTION_ORIGIN)) {
        return jsonResponse({ error: "Endereço público da carteira indisponível." }, 503);
      }
      if (isWallet) return page(config, publicOrigin);
      return leaderSellersApi(request, {
        ...env,
        WALLET_PUBLIC_ORIGIN: publicOrigin,
        SUPABASE_URL: config.url,
        SUPABASE_PUBLISHABLE_KEY: config.key
      }, url);
    }


    return publicWorker.fetch(
      request,
      env,
      ctx
    );

  }

};

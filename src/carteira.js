import publicWorker from "./index.js";

const SUPABASE_URL = "https://xmipdjjdtruutcumhrzb.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_OtxakS5UtVe_2bxg0JckGg_bliWJdaG";

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
  const { data: roles, error: rolesError } = await client
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);

  if (rolesError) {
    console.error(rolesError);
  } else {
    isManager = (roles || []).some(role => role.role === "GERENTE");
  }

  $("managerObservationHeader").classList.toggle("hidden", !isManager);
  $("managerCrmHeader").classList.toggle("hidden", !isManager);
  $("managerQrPanel").classList.toggle("hidden", !isManager);


  $("scope").textContent =
    "Usuário: " +
    user.email +
    (isManager ?
      " · Perfil gerente" :
      " · Acesso controlado pelo RLS do Supabase");


  await loadLeads();

  if (isManager) {
    await loadManagerQrSellers();
  }

  $("login").classList.add("hidden");
  $("app").classList.remove("hidden");

}


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

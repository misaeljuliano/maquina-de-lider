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

<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>

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

<section id="login" class="card login">

  <h1 class="h">Acesso à Minha Carteira</h1>

  <div class="muted">
    Entre com seu usuário corporativo.
  </div>

  <div class="field">
    <label>E-mail</label>
    <input
      id="email"
      type="email"
      autocomplete="username"
    >
  </div>

  <div class="field">
    <label>Senha</label>
    <input
      id="password"
      type="password"
      autocomplete="current-password"
    >
  </div>

  <button class="btn" id="loginBtn">
    Entrar
  </button>

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

          </tr>

        </thead>

        <tbody id="rows"></tbody>

      </table>

    </div>

  </div>

</section>

</div>


<script>

const {
  createClient
} = supabase;


const client = createClient(
  ${JSON.stringify(SUPABASE_URL)},
  ${JSON.stringify(SUPABASE_PUBLISHABLE_KEY)}
);


let leads = [];


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

  $("message").textContent =
    "Carregando...";


  const {
    data,
    error
  } =
    await client
      .from("leads")
      .select(
        "id,name,customer_phone,address,has_claro,product_searched,status,created_at,seller_id"
      )
      .order(
        "created_at",
        {
          ascending:false
        }
      );


  if (error) {

    $("message").textContent =
      "Não foi possível carregar sua carteira.";

    console.error(error);

    return;

  }


  leads = data || [];

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
      "<td colspan=\"7\" class=\"empty\">" +
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
          "<span class=\"pill\">" +
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

      "</tr>"
    ).join("");

}


async function login() {

  $("loginError").textContent = "";

  $("loginBtn").disabled = true;

  $("loginBtn").textContent =
    "Entrando...";


  const {
    error
  } =
    await client.auth.signInWithPassword({

      email:
        $("email").value.trim(),

      password:
        $("password").value

    });


  $("loginBtn").disabled = false;

  $("loginBtn").textContent =
    "Entrar";


  if (error) {

    $("loginError").textContent =
      "Acesso não autorizado. Verifique e-mail e senha.";

    return;

  }


  showApp();

}


async function showApp() {

  const {
    data
  } =
    await client.auth.getUser();


  const user =
    data?.user;


  if (!user) {
    return;
  }


  $("login")
    .classList
    .add("hidden");


  $("app")
    .classList
    .remove("hidden");


  $("scope").textContent =
    "Usuário: " +
    user.email +
    " · Acesso controlado pelo RLS do Supabase";


  await loadLeads();

}


$("loginBtn")
  .onclick = login;


$("password")
  .addEventListener(
    "keydown",
    event => {

      if (
        event.key === "Enter"
      ) {

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

      await client.auth.signOut();

      $("app")
        .classList
        .add("hidden");

      $("login")
        .classList
        .remove("hidden");

    };


(async () => {

  const {
    data
  } =
    await client.auth.getSession();


  if (data.session) {

    showApp();

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

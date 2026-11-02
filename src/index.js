export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ============================================================
    // SUPABASE
    // ============================================================

    const supabaseUrl = "https://xmipdjjdtruutcumhrzb.supabase.co";
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

    if (!serviceKey) {
      return new Response(
        "SUPABASE_SERVICE_ROLE_KEY não configurada no Worker.",
        { status: 500 }
      );
    }

    // ============================================================
    // FUNÇÕES AUXILIARES
    // ============================================================

    function jsonResponse(data, status = 200) {
      return new Response(JSON.stringify(data), {
        status,
        headers: {
          "Content-Type": "application/json; charset=utf-8"
        }
      });
    }

    function normalizePhone(value) {
      return String(value || "").replace(/\D/g, "");
    }

    function formatPhone(phone) {
      const digits = normalizePhone(phone);

      if (digits.length === 11) {
        return (
          "(" +
          digits.substring(0, 2) +
          ") " +
          digits.substring(2, 7) +
          "-" +
          digits.substring(7)
        );
      }

      if (digits.length === 10) {
        return (
          "(" +
          digits.substring(0, 2) +
          ") " +
          digits.substring(2, 6) +
          "-" +
          digits.substring(6)
        );
      }

      if (digits.length === 9) {
        return (
          digits.substring(0, 5) +
          "-" +
          digits.substring(5)
        );
      }

      if (digits.length === 8) {
        return (
          digits.substring(0, 4) +
          "-" +
          digits.substring(4)
        );
      }

      return digits;
    }

    function escapeHtml(value) {
      return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    // ============================================================
    // POST — REGISTRO DO LEAD
    // ============================================================

    if (request.method === "POST") {
      try {
        const body = await request.json();

        const vendedor = String(body.vendedor || "").trim();
        const name = String(body.name || "").trim();
        const address = String(body.address || "").trim();
        const hasClaro = String(body.has_claro || "").trim();
        const productSearched = String(
          body.product_searched || ""
        ).trim();

        const customerPhone = normalizePhone(
          body.customer_phone
        );

        const validProducts = [
          "Internet",
          "Celular",
          "TV",
          "Combo"
        ];

        // --------------------------------------------------------
        // VALIDAÇÕES
        // --------------------------------------------------------

        if (!vendedor) {
          return jsonResponse(
            { error: "Vendedor não informado." },
            400
          );
        }

        if (!name) {
          return jsonResponse(
            { error: "Nome não informado." },
            400
          );
        }

        if (!address) {
          return jsonResponse(
            { error: "Endereço não informado." },
            400
          );
        }

        if (!customerPhone) {
          return jsonResponse(
            { error: "Telefone não informado." },
            400
          );
        }

        // Aceita:
        // 8 ou 9 dígitos sem DDD
        // 10 ou 11 dígitos com DDD
        if (
          customerPhone.length < 8 ||
          customerPhone.length > 11
        ) {
          return jsonResponse(
            {
              error:
                "Telefone inválido. Informe de 8 a 11 dígitos."
            },
            400
          );
        }

        if (!validProducts.includes(productSearched)) {
          return jsonResponse(
            { error: "Produto pesquisado inválido." },
            400
          );
        }

        // --------------------------------------------------------
        // BUSCA VENDEDOR
        // --------------------------------------------------------

        const sellerResponse = await fetch(
          `${supabaseUrl}/rest/v1/sellers?slug=eq.${encodeURIComponent(
            vendedor
          )}&active=eq.true&select=*`,
          {
            headers: {
              apikey: serviceKey,
              Authorization: `Bearer ${serviceKey}`
            }
          }
        );

        if (!sellerResponse.ok) {
          return jsonResponse(
            { error: "Erro ao consultar vendedor." },
            500
          );
        }

        const sellers = await sellerResponse.json();

        if (!sellers || sellers.length === 0) {
          return jsonResponse(
            { error: "Vendedor não encontrado ou inativo." },
            404
          );
        }

        const seller = sellers[0];

        // --------------------------------------------------------
        // REGISTRA LEAD
        // --------------------------------------------------------

        const leadPayload = {
          seller_id: seller.id,
          seller_slug: seller.slug,
          seller_name: seller.name,
          region: seller.region,
          customer_name: name,
          customer_phone: customerPhone,
          address: address,
          has_claro: hasClaro || null,
          product_searched: productSearched,
          status: "NOVO"
        };

        const leadResponse = await fetch(
          `${supabaseUrl}/rest/v1/leads`,
          {
            method: "POST",
            headers: {
              apikey: serviceKey,
              Authorization: `Bearer ${serviceKey}`,
              "Content-Type": "application/json",
              Prefer: "return=representation"
            },
            body: JSON.stringify(leadPayload)
          }
        );

        if (!leadResponse.ok) {
          const errorText = await leadResponse.text();

          return jsonResponse(
            {
              error: "Erro ao registrar lead.",
              details: errorText
            },
            500
          );
        }

        // --------------------------------------------------------
        // WHATSAPP DO VENDEDOR
        // --------------------------------------------------------

        const sellerPhone = normalizePhone(
          seller.phone
        );

        if (!sellerPhone) {
          return jsonResponse({
            success: true,
            message: "Lead registrado com sucesso!",
            whatsapp_url: null
          });
        }

        const formattedCustomerPhone =
          formatPhone(customerPhone);

        const whatsappMessage =
`Nome: ${name}
Telefone: ${formattedCustomerPhone}
Endereço: ${address}
Possui Claro? ${hasClaro || "Não informado"}
Produto Pesquisado: ${productSearched}`;

        const whatsappUrl =
          `https://wa.me/${sellerPhone}?text=${encodeURIComponent(
            whatsappMessage
          )}`;

        return jsonResponse({
          success: true,
          message: "Lead registrado com sucesso!",
          whatsapp_url: whatsappUrl
        });

      } catch (error) {
        return jsonResponse(
          {
            error: "Erro interno.",
            details: error.message
          },
          500
        );
      }
    }

    // ============================================================
    // GET — FORMULÁRIO
    // ============================================================

    const vendedor =
      url.searchParams.get("vendedor") || "";

    let sellerName = "";

    if (vendedor) {
      try {
        const sellerResponse = await fetch(
          `${supabaseUrl}/rest/v1/sellers?slug=eq.${encodeURIComponent(
            vendedor
          )}&active=eq.true&select=name`,
          {
            headers: {
              apikey: serviceKey,
              Authorization: `Bearer ${serviceKey}`
            }
          }
        );

        if (sellerResponse.ok) {
          const sellers = await sellerResponse.json();

          if (sellers.length > 0) {
            sellerName = sellers[0].name || "";
          }
        }
      } catch (error) {
        sellerName = "";
      }
    }

    const safeSellerName = escapeHtml(sellerName);

    return new Response(
      `<!DOCTYPE html>
<html lang="pt-BR">

<head>

  <meta charset="UTF-8">

  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  >

  <title>Claro | Porta a Porta</title>

  <style>

    * {
      box-sizing: border-box;
    }

    html,
    body {
      margin: 0;
      padding: 0;
      min-height: 100%;
    }

    body {
      background: #f4f4f4;
      font-family:
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        Arial,
        Helvetica,
        sans-serif;
      color: #222;
    }

    .page {
      width: 100%;
      max-width: 760px;
      margin: 0 auto;
      padding: 34px 28px 50px;
    }

    /* ==========================================================
       CARD PRINCIPAL — REFERÊNCIA VISUAL
       ========================================================== */

    .card {
      background: #ffffff;
      border-radius: 30px;
      padding: 48px 46px 46px;
      box-shadow:
        0 14px 40px rgba(0, 0, 0, 0.08);
    }

    /* ==========================================================
       CABEÇALHO
       ========================================================== */

    .logo {
      color: #e30613;
      font-size: 58px;
      line-height: 1;
      font-weight: 800;
      letter-spacing: -2px;
      margin-bottom: 20px;
    }

    .subtitle {
      color: #666666;
      font-size: 31px;
      line-height: 1.15;
      font-weight: 400;
      margin-bottom: 42px;
    }

    /* ==========================================================
       VENDEDOR
       ========================================================== */

    .seller-box {
      width: 100%;
      background: #eeeeee;
      border-radius: 18px;
      padding: 21px 24px;
      margin-bottom: 38px;
      font-size: 25px;
      line-height: 1.25;
      color: #222222;
    }

    .seller-label {
      font-weight: 400;
    }

    .seller-name {
      font-weight: 800;
    }

    /* ==========================================================
       CAMPOS
       ========================================================== */

    .field {
      margin-bottom: 31px;
    }

    label {
      display: block;
      margin-bottom: 13px;
      color: #252525;
      font-size: 26px;
      line-height: 1.15;
      font-weight: 700;
    }

    .required {
      color: #e30613;
    }

    input,
    select {
      width: 100%;
      height: 64px;
      border: 2px solid #cccccc;
      border-radius: 16px;
      background: #ffffff;
      padding: 0 27px;
      color: #171717;
      font-size: 25px;
      font-family: inherit;
      outline: none;
      appearance: auto;
    }

    input::placeholder {
      color: #9a9a9a;
      opacity: 1;
    }

    input:focus,
    select:focus {
      border-color: #bdbdbd;
      box-shadow: none;
    }

    .phone-input {
      letter-spacing: 0.2px;
    }

    /* ==========================================================
       BOTÃO
       ========================================================== */

    button {
      width: 100%;
      height: 72px;
      margin-top: 4px;
      border: 0;
      border-radius: 16px;
      background: #ed0010;
      color: #ffffff;
      font-family: inherit;
      font-size: 27px;
      font-weight: 800;
      cursor: pointer;
      box-shadow: none;
    }

    button:disabled {
      opacity: 0.65;
      cursor: not-allowed;
    }

    /* ==========================================================
       RESPONSIVO
       ========================================================== */

    @media (max-width: 600px) {

      .page {
        max-width: 100%;
        padding: 28px 18px 40px;
      }

      .card {
        border-radius: 28px;
        padding: 34px 28px 32px;
      }

      .logo {
        font-size: 48px;
      }

      .subtitle {
        font-size: 27px;
        margin-bottom: 34px;
      }

      .seller-box {
        font-size: 21px;
        padding: 18px 20px;
        border-radius: 16px;
        margin-bottom: 31px;
      }

      .field {
        margin-bottom: 25px;
      }

      label {
        font-size: 21px;
        margin-bottom: 11px;
      }

      input,
      select {
        height: 60px;
        border-radius: 15px;
        padding: 0 20px;
        font-size: 20px;
      }

      button {
        height: 62px;
        border-radius: 15px;
        font-size: 23px;
      }
    }

  </style>

</head>

<body>

  <main class="page">

    <section class="card">

      <div class="logo">
        Claro
      </div>

      <div class="subtitle">
        Porta a Porta
      </div>

      ${
        sellerName
          ? `
      <div class="seller-box">
        <span class="seller-label">Vendedor: </span>
        <span class="seller-name">${safeSellerName}</span>
      </div>
      `
          : ""
      }

      <form id="leadForm">

        <!-- NOME -->

        <div class="field">

          <label for="nome">
            Nome <span class="required">*</span>
          </label>

          <input
            id="nome"
            type="text"
            required
            autocomplete="name"
            placeholder="Digite seu nome"
          >

        </div>

        <!-- TELEFONE -->

        <div class="field">

          <label for="telefone">
            Telefone <span class="required">*</span>
          </label>

          <input
            id="telefone"
            class="phone-input"
            type="tel"
            required
            inputmode="numeric"
            autocomplete="tel"
            placeholder="(   ) 99999-9999"
            maxlength="15"
          >

        </div>

        <!-- ENDEREÇO -->

        <div class="field">

          <label for="endereco">
            Endereço <span class="required">*</span>
          </label>

          <input
            id="endereco"
            type="text"
            required
            autocomplete="street-address"
            placeholder="Digite seu endereço"
          >

        </div>

        <!-- POSSUI CLARO -->

        <div class="field">

          <label for="claro">
            Você possui Claro?
          </label>

          <select id="claro">

            <option value="">
              Selecione
            </option>

            <option value="Não">
              Não
            </option>

            <option value="Internet">
              Internet
            </option>

            <option value="Celular">
              Celular
            </option>

            <option value="TV">
              TV
            </option>

            <option value="Combo">
              Combo
            </option>

          </select>

        </div>

        <!-- PRODUTO PESQUISADO -->

        <div class="field">

          <label for="produto">
            Produto pesquisado
            <span class="required">*</span>
          </label>

          <select
            id="produto"
            required
          >

            <option value="">
              Selecione
            </option>

            <option value="Internet">
              Internet
            </option>

            <option value="Celular">
              Celular
            </option>

            <option value="TV">
              TV
            </option>

            <option value="Combo">
              Combo
            </option>

          </select>

        </div>

        <!-- BOTÃO -->

        <button
          id="submitButton"
          type="submit"
        >
          Enviar
        </button>

      </form>

    </section>

  </main>

<script>

  // ============================================================
  // MÁSCARA DE TELEFONE
  //
  // DDD OPCIONAL.
  //
  // 8 dígitos:
  // 9999-9999
  //
  // 9 dígitos:
  // 99999-9999
  //
  // 10 dígitos:
  // (99) 9999-9999
  //
  // 11 dígitos:
  // (99) 99999-9999
  // ============================================================

  const telefoneInput =
    document.getElementById("telefone");

  telefoneInput.addEventListener(
    "input",
    function () {

      let value =
        this.value.replace(/\D/g, "");

      if (value.length > 11) {
        value = value.substring(0, 11);
      }

      // 0 a 8 dígitos — sem DDD
      if (value.length <= 8) {

        if (value.length <= 4) {
          this.value = value;
        } else {
          this.value =
            value.substring(0, 4) +
            "-" +
            value.substring(4);
        }

        return;
      }

      // 9 dígitos — celular sem DDD
      if (value.length === 9) {

        this.value =
          value.substring(0, 5) +
          "-" +
          value.substring(5);

        return;
      }

      // 10 dígitos — telefone com DDD
      if (value.length === 10) {

        this.value =
          "(" +
          value.substring(0, 2) +
          ") " +
          value.substring(2, 6) +
          "-" +
          value.substring(6);

        return;
      }

      // 11 dígitos — celular com DDD
      this.value =
        "(" +
        value.substring(0, 2) +
        ") " +
        value.substring(2, 7) +
        "-" +
        value.substring(7);
    }
  );

  // ============================================================
  // ENVIO DO FORMULÁRIO
  // ============================================================

  document
    .getElementById("leadForm")
    .addEventListener(
      "submit",
      async function (event) {

        event.preventDefault();

        const button =
          document.getElementById(
            "submitButton"
          );

        button.disabled = true;
        button.textContent = "Enviando...";

        const name =
          document
            .getElementById("nome")
            .value
            .trim();

        const customerPhone =
          document
            .getElementById("telefone")
            .value
            .replace(/\D/g, "");

        const address =
          document
            .getElementById("endereco")
            .value
            .trim();

        const hasClaro =
          document
            .getElementById("claro")
            .value;

        const productSearched =
          document
            .getElementById("produto")
            .value;

        // --------------------------------------------------------
        // TELEFONE
        // --------------------------------------------------------

        if (
          customerPhone.length < 8 ||
          customerPhone.length > 11
        ) {

          alert(
            "Informe um telefone válido com 8 a 11 dígitos."
          );

          button.disabled = false;
          button.textContent = "Enviar";

          return;
        }

        // --------------------------------------------------------
        // POST
        // --------------------------------------------------------

        try {

          const response =
            await fetch(
              window.location.href,
              {
                method: "POST",

                headers: {
                  "Content-Type":
                    "application/json"
                },

                body: JSON.stringify({

                  vendedor:
                    new URLSearchParams(
                      window.location.search
                    ).get("vendedor") || "",

                  name: name,

                  customer_phone:
                    customerPhone,

                  address: address,

                  has_claro:
                    hasClaro,

                  product_searched:
                    productSearched

                })
              }
            );

          const result =
            await response.json();

          if (!response.ok) {

            throw new Error(
              result.error ||
              "Não foi possível registrar o lead."
            );

          }

          // O lead já foi salvo.
          alert(
            "Lead registrado com sucesso!"
          );

          // Agora abre o WhatsApp.
          if (result.whatsapp_url) {

            window.location.href =
              result.whatsapp_url;

            return;
          }

          document
            .getElementById("leadForm")
            .reset();

        } catch (error) {

          alert(
            error.message ||
            "Ocorreu um erro ao registrar o lead."
          );

        } finally {

          button.disabled = false;
          button.textContent = "Enviar";

        }

      }
    );

</script>

</body>

</html>`,
      {
        headers: {
          "Content-Type":
            "text/html; charset=utf-8"
        }
      }
    );
  }
};

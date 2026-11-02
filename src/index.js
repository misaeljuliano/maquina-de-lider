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
    // AUXILIARES
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

        // ========================================================
        // BUSCA VENDEDOR
        // ========================================================

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

        // ========================================================
        // REGISTRA LEAD
        // ========================================================

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

        // ========================================================
        // WHATSAPP
        // ========================================================

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

    body {
      margin: 0;
      padding: 0;
      min-height: 100vh;
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
      max-width: 480px;
      margin: 0 auto;
      padding: 28px 18px 40px;
    }

    .header {
      text-align: center;
      margin-bottom: 22px;
    }

    .logo {
      color: #e30613;
      font-size: 40px;
      font-weight: 800;
      line-height: 1;
      letter-spacing: -1.5px;
    }

    .subtitle {
      margin-top: 6px;
      color: #333;
      font-size: 16px;
      font-weight: 600;
    }

    .card {
      background: #fff;
      border-radius: 18px;
      padding: 24px;
      box-shadow:
        0 8px 30px rgba(0, 0, 0, 0.08);
    }

    .seller-box {
      background: #f7f7f7;
      border: 1px solid #e5e5e5;
      border-radius: 10px;
      padding: 12px 14px;
      margin-bottom: 22px;
    }

    .seller-label {
      display: block;
      font-size: 12px;
      color: #777;
      font-weight: 600;
      margin-bottom: 3px;
    }

    .seller-name {
      display: block;
      font-size: 16px;
      color: #222;
      font-weight: 700;
    }

    label {
      display: block;
      margin-bottom: 7px;
      font-size: 14px;
      font-weight: 700;
    }

    .required {
      color: #e30613;
    }

    input,
    select {
      width: 100%;
      height: 48px;
      border: 1px solid #d0d0d0;
      border-radius: 10px;
      background: #fff;
      padding: 0 14px;
      font-size: 16px;
      color: #222;
      outline: none;
      margin-bottom: 18px;
    }

    input:focus,
    select:focus {
      border-color: #e30613;
      box-shadow:
        0 0 0 3px rgba(227, 6, 19, 0.08);
    }

    input::placeholder {
      color: #999;
    }

    .phone-input {
      letter-spacing: 0.2px;
    }

    button {
      width: 100%;
      height: 50px;
      margin-top: 2px;
      border: 0;
      border-radius: 10px;
      background: #e30613;
      color: #fff;
      font-size: 17px;
      font-weight: 700;
      cursor: pointer;
      box-shadow:
        0 4px 10px rgba(227, 6, 19, 0.18);
    }

    button:active {
      transform: translateY(1px);
    }

    button:disabled {
      opacity: 0.65;
      cursor: not-allowed;
    }

    .footer {
      text-align: center;
      margin-top: 18px;
      color: #888;
      font-size: 12px;
    }

  </style>

</head>

<body>

  <div class="page">

    <div class="header">

      <div class="logo">
        Claro
      </div>

      <div class="subtitle">
        Porta a Porta
      </div>

    </div>

    <div class="card">

      ${
        sellerName
          ? `
      <div class="seller-box">

        <span class="seller-label">
          Vendedor
        </span>

        <span class="seller-name">
          ${sellerName}
        </span>

      </div>
      `
          : ""
      }

      <form id="leadForm">

        <label for="nome">
          Nome
          <span class="required">*</span>
        </label>

        <input
          id="nome"
          type="text"
          required
          autocomplete="name"
          placeholder="Digite seu nome"
        >

        <label for="telefone">
          Telefone
          <span class="required">*</span>
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

        <label for="endereco">
          Endereço
          <span class="required">*</span>
        </label>

        <input
          id="endereco"
          type="text"
          required
          autocomplete="street-address"
          placeholder="Digite seu endereço"
        >

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

        <label for="produto">
          Produto pesquisado
          <span class="required">*</span>
        </label>

        <select id="produto" required>

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

        <button
          id="submitButton"
          type="submit"
        >
          Enviar
        </button>

      </form>

    </div>

    <div class="footer">
      Claro | Porta a Porta
    </div>

  </div>

<script>

  const telefoneInput =
    document.getElementById("telefone");

  // ============================================================
  // MÁSCARA
  //
  // 8 dígitos  -> 9999-9999
  // 9 dígitos  -> 99999-9999
  // 10 dígitos -> (99) 9999-9999
  // 11 dígitos -> (99) 99999-9999
  //
  // DDD NÃO É INSERIDO AUTOMATICAMENTE.
  // ============================================================

  telefoneInput.addEventListener(
    "input",
    function () {

      let value =
        this.value.replace(/\D/g, "");

      if (value.length > 11) {
        value = value.substring(0, 11);
      }

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

      if (value.length === 9) {

        this.value =
          value.substring(0, 5) +
          "-" +
          value.substring(5);

        return;
      }

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
  // ENVIO
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

                  name,

                  customer_phone:
                    customerPhone,

                  address,

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

          // Lead salvo primeiro.
          alert(
            "Lead registrado com sucesso!"
          );

          // Depois abre o WhatsApp.
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

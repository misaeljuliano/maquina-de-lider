const supabaseUrl = "https://xmipdjjdtruutcumhrzb.supabase.co";
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function formatPhone(value) {
  const digits = normalizePhone(value);

  if (!digits) return "";

  if (digits.length <= 8) {
    return digits.replace(/(\d{4})(\d{0,4})/, "$1-$2").replace(/-$/, "");
  }

  if (digits.length === 9) {
    return digits.replace(/(\d{5})(\d{0,4})/, "$1-$2");
  }

  if (digits.length === 10) {
    return digits.replace(/(\d{2})(\d{4})(\d{0,4})/, "($1) $2-$3");
  }

  return digits
    .slice(0, 11)
    .replace(/(\d{2})(\d{5})(\d{0,4})/, "($1) $2-$3")
    .replace(/-$/, "");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function supabaseRequest(path, options = {}) {
  return fetch(`${supabaseUrl}${path}`, {
    ...options,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    /*
     * =========================
     * POST — REGISTRO DO LEAD
     * =========================
     */

    if (request.method === "POST") {
      try {
        const body = await request.json();

        const vendedor = String(body.vendedor || "").trim();
        const name = String(body.name || "").trim();
        const address = String(body.address || "").trim();
        const hasClaro = String(body.hasClaro || "").trim();
        const productSearched = String(body.productSearched || "").trim();

        const customerPhone = normalizePhone(body.customerPhone);

        if (!vendedor) {
          return jsonResponse(
            { error: "Vendedor não identificado." },
            400
          );
        }

        if (!name) {
          return jsonResponse(
            { error: "Informe o nome." },
            400
          );
        }

        if (!customerPhone) {
          return jsonResponse(
            { error: "Informe o telefone." },
            400
          );
        }

        if (customerPhone.length < 8 || customerPhone.length > 11) {
          return jsonResponse(
            { error: "Informe um telefone válido." },
            400
          );
        }

        if (!address) {
          return jsonResponse(
            { error: "Informe o endereço." },
            400
          );
        }

        if (!productSearched) {
          return jsonResponse(
            { error: "Selecione o produto pesquisado." },
            400
          );
        }

        /*
         * Localiza o vendedor pelo slug do QR Code.
         */
        const sellerResponse = await supabaseRequest(
          `/rest/v1/sellers?slug=eq.${encodeURIComponent(vendedor)}&active=eq.true&select=*`
        );

        if (!sellerResponse.ok) {
          return jsonResponse(
            { error: "Não foi possível localizar o vendedor." },
            500
          );
        }

        const sellers = await sellerResponse.json();

        if (!sellers.length) {
          return jsonResponse(
            { error: "Vendedor não encontrado ou inativo." },
            404
          );
        }

        const seller = sellers[0];

        /*
         * Salva o lead ANTES de abrir o WhatsApp.
         */
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

        const leadResponse = await supabaseRequest(
          "/rest/v1/leads",
          {
            method: "POST",
            headers: {
              Prefer: "return=minimal"
            },
            body: JSON.stringify(leadPayload)
          }
        );

        if (!leadResponse.ok) {
          const errorText = await leadResponse.text();

          return jsonResponse(
            {
              error: "Não foi possível registrar o lead.",
              details: errorText
            },
            500
          );
        }

        /*
         * Telefone do vendedor = destino do WhatsApp.
         */
        const sellerPhone = normalizePhone(seller.phone);

        const formattedCustomerPhone = formatPhone(customerPhone);

        const whatsappMessage =
`Nome: ${name}
Telefone: ${formattedCustomerPhone}
Endereço: ${address}
Possui Claro? ${hasClaro || ""}
Produto Pesquisado: ${productSearched}`;

        const whatsappUrl =
          `https://wa.me/${sellerPhone}?text=${encodeURIComponent(whatsappMessage)}`;

        return jsonResponse({
          success: true,
          whatsapp_url: whatsappUrl
        });

      } catch (error) {
        return jsonResponse(
          {
            error: "Erro interno ao registrar o lead.",
            details: error.message
          },
          500
        );
      }
    }

    /*
     * =========================
     * GET — FORMULÁRIO
     * =========================
     */

    if (request.method === "GET") {
      const vendedor = String(
        url.searchParams.get("vendedor") || ""
      ).trim();

      if (!vendedor) {
        return new Response(
          "Vendedor não identificado.",
          {
            status: 400,
            headers: {
              "Content-Type": "text/plain; charset=utf-8"
            }
          }
        );
      }

      const sellerResponse = await supabaseRequest(
        `/rest/v1/sellers?slug=eq.${encodeURIComponent(vendedor)}&active=eq.true&select=name`
      );

      if (!sellerResponse.ok) {
        return new Response(
          "Não foi possível carregar o vendedor.",
          { status: 500 }
        );
      }

      const sellers = await sellerResponse.json();

      if (!sellers.length) {
        return new Response(
          "Vendedor não encontrado.",
          { status: 404 }
        );
      }

      const sellerName = escapeHtml(sellers[0].name);

      const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Claro | Porta a Porta</title>

<style>
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: #f2f2f2;
  font-family: Arial, Helvetica, sans-serif;
  color: #222;
}

.page {
  width: 100%;
  max-width: 760px;
  margin: 0 auto;
  padding: 34px 28px 50px;
}

.card {
  background: #fff;
  border-radius: 30px;
  padding: 48px 46px 46px;
  box-shadow: 0 8px 30px rgba(0,0,0,0.08);
}

.logo {
  color: #e30613;
  font-size: 58px;
  font-weight: 700;
  line-height: 1;
  margin-bottom: 24px;
}

.subtitle {
  color: #666;
  font-size: 31px;
  line-height: 1.1;
  margin-bottom: 50px;
}

.seller-box {
  background: #eeeeee;
  border-radius: 18px;
  padding: 21px 24px;
  font-size: 25px;
  margin-bottom: 42px;
}

.seller-box strong {
  font-weight: 700;
}

.field {
  margin-bottom: 34px;
}

label {
  display: block;
  font-size: 29px;
  font-weight: 700;
  margin-bottom: 16px;
}

.required {
  color: #e30613;
}

input,
select {
  width: 100%;
  height: 74px;
  border: 2px solid #c9c9c9;
  border-radius: 17px;
  padding: 0 24px;
  font-size: 25px;
  background: #fff;
  color: #111;
  outline: none;
}

input:focus,
select:focus {
  border-color: #999;
}

input::placeholder {
  color: #888;
  opacity: 1;
}

button {
  width: 100%;
  height: 74px;
  border: none;
  border-radius: 17px;
  background: #e30613;
  color: #fff;
  font-size: 26px;
  font-weight: 700;
  cursor: pointer;
}

button:disabled {
  opacity: 0.65;
}

.footer {
  text-align: center;
  margin-top: 34px;
  color: #777;
  font-size: 17px;
}

@media (max-width: 600px) {
  .page {
    padding: 18px 12px 30px;
  }

  .card {
    border-radius: 26px;
    padding: 34px 28px 32px;
  }

  .logo {
    font-size: 52px;
  }

  .subtitle {
    font-size: 28px;
    margin-bottom: 42px;
  }

  .seller-box {
    font-size: 23px;
    margin-bottom: 36px;
  }

  label {
    font-size: 26px;
  }

  input,
  select,
  button {
    height: 68px;
    font-size: 22px;
  }
}
</style>
</head>

<body>

<div class="page">

  <div class="card">

    <div class="logo">Claro</div>

    <div class="subtitle">
      Porta a Porta
    </div>

    <div class="seller-box">
      Vendedor: <strong>${sellerName}</strong>
    </div>

    <form id="leadForm">

      <div class="field">
        <label for="name">
          Nome <span class="required">*</span>
        </label>

        <input
          id="name"
          name="name"
          type="text"
          required
          autocomplete="name"
        >
      </div>

      <div class="field">
        <label for="customerPhone">
          Telefone <span class="required">*</span>
        </label>

        <input
          id="customerPhone"
          name="customerPhone"
          type="tel"
          required
          inputmode="numeric"
          autocomplete="tel"
          placeholder="(   ) 99999-9999"
          maxlength="15"
        >
      </div>

      <div class="field">
        <label for="address">
          Endereço <span class="required">*</span>
        </label>

        <input
          id="address"
          name="address"
          type="text"
          required
          autocomplete="street-address"
        >
      </div>

      <div class="field">
        <label for="hasClaro">
          Você possui Claro?
        </label>

        <select id="hasClaro" name="hasClaro">
          <option value="">Selecione</option>
          <option value="Não">Não</option>
          <option value="Internet">Internet</option>
          <option value="Celular">Celular</option>
          <option value="TV">TV</option>
          <option value="Combo">Combo</option>
        </select>
      </div>

      <div class="field">
        <label for="productSearched">
          Produto pesquisado <span class="required">*</span>
        </label>

        <select
          id="productSearched"
          name="productSearched"
          required
        >
          <option value="">Selecione</option>
          <option value="Internet">Internet</option>
          <option value="Celular">Celular</option>
          <option value="TV">TV</option>
          <option value="Combo">Combo</option>
        </select>
      </div>

      <button id="submitButton" type="submit">
        Enviar
      </button>

    </form>

    <div class="footer">
      Claro | Porta a Porta
    </div>

  </div>

</div>

<script>

const vendedor = ${JSON.stringify(vendedor)};

const phoneInput =
  document.getElementById("customerPhone");

/*
 * MÁSCARA CORRIGIDA
 *
 * Importante:
 * Não cria caracteres quando o campo está vazio.
 * Não insere DDD.
 * Só aplica máscara depois que o usuário digitar.
 */
phoneInput.addEventListener("input", function () {

  let digits = this.value.replace(/\\D/g, "");

  /*
   * Limita a 11 dígitos.
   */
  digits = digits.slice(0, 11);

  /*
   * Campo realmente vazio.
   */
  if (digits.length === 0) {
    this.value = "";
    return;
  }

  /*
   * 1 a 8 dígitos
   */
  if (digits.length <= 8) {

    if (digits.length <= 4) {
      this.value = digits;
    } else {
      this.value =
        digits.slice(0, 4) +
        "-" +
        digits.slice(4);
    }

    return;
  }

  /*
   * 9 dígitos
   * 99999-9999
   */
  if (digits.length === 9) {

    this.value =
      digits.slice(0, 5) +
      "-" +
      digits.slice(5);

    return;
  }

  /*
   * 10 dígitos
   * (99) 9999-9999
   */
  if (digits.length === 10) {

    this.value =
      "(" +
      digits.slice(0, 2) +
      ") " +
      digits.slice(2, 6) +
      "-" +
      digits.slice(6);

    return;
  }

  /*
   * 11 dígitos
   * (99) 99999-9999
   */
  this.value =
    "(" +
    digits.slice(0, 2) +
    ") " +
    digits.slice(2, 7) +
    "-" +
    digits.slice(7);

});


const form =
  document.getElementById("leadForm");

const submitButton =
  document.getElementById("submitButton");


form.addEventListener("submit", async function(event) {

  event.preventDefault();

  const name =
    document.getElementById("name").value.trim();

  const address =
    document.getElementById("address").value.trim();

  const hasClaro =
    document.getElementById("hasClaro").value;

  const productSearched =
    document.getElementById("productSearched").value;

  /*
   * Remove máscara para validação e banco.
   */
  const customerPhone =
    phoneInput.value.replace(/\\D/g, "");

  /*
   * Validação obrigatória.
   */
  if (!name) {
    alert("Informe o nome.");
    return;
  }

  if (!customerPhone) {
    alert("Informe o telefone.");
    phoneInput.focus();
    return;
  }

  if (
    customerPhone.length < 8 ||
    customerPhone.length > 11
  ) {
    alert("Informe um telefone válido.");
    phoneInput.focus();
    return;
  }

  if (!address) {
    alert("Informe o endereço.");
    return;
  }

  if (!productSearched) {
    alert("Selecione o produto pesquisado.");
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = "Enviando...";

  try {

    const response = await fetch(
      window.location.pathname,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          vendedor,
          name,
          customerPhone,
          address,
          hasClaro,
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

    alert("Lead registrado com sucesso!");

    if (result.whatsapp_url) {
      window.location.href =
        result.whatsapp_url;
    }

  } catch (error) {

    alert(
      error.message ||
      "Ocorreu um erro. Tente novamente."
    );

    submitButton.disabled = false;
    submitButton.textContent = "Enviar";
  }

});

</script>

</body>
</html>`;

      return new Response(html, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store"
        }
      });
    }

    return new Response(
      "Método não permitido.",
      { status: 405 }
    );
  }
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    /*
     * ============================================================
     * SUPABASE CONFIGURATION
     * ============================================================
     */

    const supabaseUrl =
      "https://xmipdjjdtruutcumhrzb.supabase.co";

    const serviceKey =
      env.SUPABASE_SERVICE_ROLE_KEY;

    /*
     * ============================================================
     * PHONE HELPERS
     * Aproximadamente linhas 20-65
     * ============================================================
     */

    function normalizePhone(value) {
      let digits = String(value || "").replace(/\D/g, "");

      /*
       * Remove código do país +55 caso o navegador/autocomplete
       * tenha inserido automaticamente.
       */
      if (digits.length > 11 && digits.startsWith("55")) {
        digits = digits.substring(2);
      }

      return digits;
    }

    function formatPhone(value) {
      const digits = normalizePhone(value);

      if (digits.length === 8) {
        return digits.replace(
          /^(\d{4})(\d{4})$/,
          "$1-$2"
        );
      }

      if (digits.length === 9) {
        return digits.replace(
          /^(\d{5})(\d{4})$/,
          "$1-$2"
        );
      }

      if (digits.length === 10) {
        return digits.replace(
          /^(\d{2})(\d{4})(\d{4})$/,
          "($1) $2-$3"
        );
      }

      if (digits.length === 11) {
        return digits.replace(
          /^(\d{2})(\d{5})(\d{4})$/,
          "($1) $2-$3"
        );
      }

      return digits;
    }

    /*
     * ============================================================
     * POST - RECEIVE AND SAVE LEAD
     * ============================================================
     */

    if (request.method === "POST") {
      try {
        if (!serviceKey) {
          return new Response(
            JSON.stringify({
              success: false,
              error:
                "SUPABASE_SERVICE_ROLE_KEY não configurada no Worker."
            }),
            {
              status: 500,
              headers: {
                "content-type":
                  "application/json; charset=UTF-8"
              }
            }
          );
        }

        /*
         * ========================================================
         * READ REQUEST
         * ========================================================
         */

        const data =
          await request.json();

        const vendor =
          String(data.vendor || "").trim();

        const name =
          String(data.name || "").trim();

        const customerPhone =
          normalizePhone(
            data.customer_phone
          );

        const address =
          String(data.address || "").trim();

        const hasClaro =
          String(data.hasClaro || "").trim();

        const productSearched =
          String(
            data.product_searched || ""
          ).trim();

        /*
         * ========================================================
         * VALIDATE PHONE
         * ========================================================
         */

        if (
          customerPhone.length < 8 ||
          customerPhone.length > 11
        ) {
          return new Response(
            JSON.stringify({
              success: false,
              error:
                "Digite um telefone válido com 8 a 11 dígitos."
            }),
            {
              status: 400,
              headers: {
                "content-type":
                  "application/json; charset=UTF-8"
              }
            }
          );
        }

        /*
         * ========================================================
         * VALIDATE PRODUCT
         * ========================================================
         */

        const validProducts = [
          "Internet",
          "Celular",
          "TV",
          "Combo"
        ];

        if (
          !validProducts.includes(
            productSearched
          )
        ) {
          return new Response(
            JSON.stringify({
              success: false,
              error:
                "Selecione o produto pesquisado."
            }),
            {
              status: 400,
              headers: {
                "content-type":
                  "application/json; charset=UTF-8"
              }
            }
          );
        }

        /*
         * ========================================================
         * VALIDATE REQUIRED FIELDS
         * ========================================================
         */

        if (
          !vendor ||
          !name ||
          !address ||
          !customerPhone
        ) {
          return new Response(
            JSON.stringify({
              success: false,
              error:
                "Preencha todos os campos obrigatórios."
            }),
            {
              status: 400,
              headers: {
                "content-type":
                  "application/json; charset=UTF-8"
              }
            }
          );
        }

        /*
         * ========================================================
         * FIND SELLER
         * ========================================================
         */

        const sellerUrl =
          supabaseUrl +
          "/rest/v1/sellers?slug=eq." +
          encodeURIComponent(vendor) +
          "&active=eq.true&select=id,slug,name,region,phone";

        const sellerResponse =
          await fetch(
            sellerUrl,
            {
              method: "GET",
              headers: {
                apikey: serviceKey,
                Authorization:
                  "Bearer " + serviceKey
              }
            }
          );

        if (!sellerResponse.ok) {
          const sellerError =
            await sellerResponse.text();

          console.error(
            "Error querying seller:",
            sellerError
          );

          return new Response(
            JSON.stringify({
              success: false,
              error:
                "Não foi possível validar o vendedor.",
              details:
                sellerError
            }),
            {
              status: 500,
              headers: {
                "content-type":
                  "application/json; charset=UTF-8"
              }
            }
          );
        }

        const sellers =
          await sellerResponse.json();

        if (
          !Array.isArray(sellers) ||
          sellers.length === 0
        ) {
          return new Response(
            JSON.stringify({
              success: false,
              error:
                "Vendedor não encontrado ou inativo."
            }),
            {
              status: 404,
              headers: {
                "content-type":
                  "application/json; charset=UTF-8"
              }
            }
          );
        }

        const seller =
          sellers[0];

        /*
         * ========================================================
         * CREATE LEAD
         * ========================================================
         */

        const lead = {
          seller_id:
            seller.id,

          region:
            seller.region,

          name:
            name,

          customer_phone:
            customerPhone,

          address:
            address,

          has_claro:
            hasClaro ||
            "Não informado",

          product_searched:
            productSearched,

          status:
            "NOVO",

          submission_id:
            crypto.randomUUID()
        };

        /*
         * ========================================================
         * INSERT LEAD INTO SUPABASE
         * ========================================================
         */

        const insertResponse =
          await fetch(
            supabaseUrl +
              "/rest/v1/leads",
            {
              method: "POST",

              headers: {
                apikey:
                  serviceKey,

                Authorization:
                  "Bearer " +
                  serviceKey,

                "Content-Type":
                  "application/json",

                Prefer:
                  "return=representation"
              },

              body:
                JSON.stringify(
                  lead
                )
            }
          );

        const responseText =
          await insertResponse.text();

        /*
         * ========================================================
         * HANDLE INSERT ERROR
         * ========================================================
         */

        if (!insertResponse.ok) {
          console.error(
            "Supabase lead insert error:",
            responseText
          );

          return new Response(
            JSON.stringify({
              success: false,
              error:
                "Erro ao gravar lead.",
              details:
                responseText
            }),
            {
              status: 500,
              headers: {
                "content-type":
                  "application/json; charset=UTF-8"
              }
            }
          );
        }

        /*
         * ========================================================
         * PARSE SUPABASE RESPONSE
         * ========================================================
         */

        let savedLead = [];

        if (
          responseText.trim()
        ) {
          try {
            savedLead =
              JSON.parse(
                responseText
              );
          } catch (parseError) {
            console.error(
              "Could not parse Supabase response:",
              parseError
            );
          }
        }

        /*
         * ========================================================
         * PREPARE WHATSAPP
         * ========================================================
         */

        const sellerPhone =
          String(
            seller.phone || ""
          ).replace(
            /\D/g,
            ""
          );

        let whatsappUrl =
          "";

        if (sellerPhone) {
          const whatsappPhone =
            sellerPhone.startsWith("55")
              ? sellerPhone
              : "55" + sellerPhone;

          const whatsappMessage =
            `Nome: ${name}\n` +
            `Telefone: ${formatPhone(customerPhone)}\n` +
            `Endereço: ${address}\n` +
            `Possui Claro? ${hasClaro || "Não informado"}\n` +
            `Produto Pesquisado: ${productSearched}`;

          whatsappUrl =
            "https://wa.me/" +
            whatsappPhone +
            "?text=" +
            encodeURIComponent(
              whatsappMessage
            );
        }

        /*
         * ========================================================
         * SUCCESS
         * ========================================================
         */

        return new Response(
          JSON.stringify({
            success:
              true,

            lead_id:
              Array.isArray(
                savedLead
              ) &&
              savedLead[0] &&
              savedLead[0].id
                ? savedLead[0].id
                : null,

            seller:
              seller.name,

            whatsapp_url:
              whatsappUrl
          }),
          {
            status: 200,
            headers: {
              "content-type":
                "application/json; charset=UTF-8"
            }
          }
        );

      } catch (error) {
        console.error(
          "Internal error:",
          error
        );

        return new Response(
          JSON.stringify({
            success:
              false,

            error:
              "Erro interno.",

            details:
              String(
                error &&
                error.message
                  ? error.message
                  : error
              )
          }),
          {
            status: 500,
            headers: {
              "content-type":
                "application/json; charset=UTF-8"
            }
          }
        );
      }
    }

    /*
     * ============================================================
     * GET - FORM
     * ============================================================
     */

    if (request.method === "GET") {
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
  font-family: Arial, sans-serif;
  background: #f5f5f5;
  color: #222;
}

.container {
  width: 100%;
  max-width: 480px;
  margin: auto;
  padding: 20px;
}

.card {
  background: white;
  border-radius: 18px;
  padding: 24px;
  margin-top: 20px;
  box-shadow: 0 4px 20px rgba(0,0,0,.10);
}

h1 {
  margin: 0 0 8px;
  font-size: 30px;
  color: #e30613;
}

.subtitle {
  color: #666;
  margin-bottom: 24px;
  font-size: 16px;
}

label {
  display: block;
  font-weight: bold;
  margin-top: 18px;
  margin-bottom: 7px;
}

input,
select {
  width: 100%;
  padding: 14px;
  border: 1px solid #ccc;
  border-radius: 10px;
  font-size: 16px;
  background: white;
}

button {
  width: 100%;
  margin-top: 24px;
  padding: 16px;
  border: 0;
  border-radius: 10px;
  background: #e30613;
  color: white;
  font-size: 17px;
  font-weight: bold;
  cursor: pointer;
}

button:active {
  transform: scale(.99);
}

button:disabled {
  opacity: .6;
}

.seller {
  background: #f0f0f0;
  padding: 12px;
  border-radius: 10px;
  margin-bottom: 18px;
  font-size: 14px;
}

.required {
  color: #d00;
}

</style>

</head>

<body>

<div class="container">

  <div class="card">

    <h1>
      Claro
    </h1>

    <div class="subtitle">
      Porta a Porta
    </div>

    <div class="seller">

      Vendedor:

      <strong id="seller">
        Identificando...
      </strong>

    </div>

    <form id="leadForm">

      <input
        type="hidden"
        id="vendedor"
        name="vendedor"
      >

      <label>
        Nome
        <span class="required">*</span>
      </label>

      <input
        id="nome"
        required
        autocomplete="name"
        placeholder="Digite seu nome"
      >

      <!-- TELEFONE — NOVO CAMPO -->
      <!-- Aproximadamente linha 390 -->

      <label>
        Telefone
        <span class="required">*</span>
      </label>

      <input
        id="telefone"
        type="tel"
        inputmode="numeric"
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        maxlength="18"
        required
        placeholder="(   ) 99999-9999"
      >

      <label>
        Endereço
        <span class="required">*</span>
      </label>

      <input
        id="endereco"
        required
        autocomplete="street-address"
        placeholder="Rua, número e bairro"
      >

      <label>
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

      <label>

        Produto pesquisado

        <span class="required">
          *
        </span>

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

      <button
        id="submitButton"
        type="submit"
      >
        Enviar
      </button>

    </form>

  </div>

</div>

<script>

const vendedores = {

  "josi-misael":
    "Josi Misael",

  "mauricio-fuertes":
    "Maurício Fuertes",

  "monique-gomes":
    "Monique Gomes",

  "juliana-da-silva":
    "Juliana Da Silva",

  "marcela-cristina":
    "Marcela Cristina",

  "sandra-da-silva":
    "Sandra da Silva",

  "patricia-goncalves":
    "Patrícia Gonçalves",

  "janelle":
    "Janelle",

  "ana-paula":
    "Ana Paula",

  "guilherme-santos":
    "Guilherme Santos"

};

const params =
  new URLSearchParams(
    window.location.search
  );

const vendedor =
  params.get("vendedor");

const sellerElement =
  document.getElementById(
    "seller"
  );

const vendedorInput =
  document.getElementById(
    "vendedor"
  );

const telefoneInput =
  document.getElementById(
    "telefone"
  );

const form =
  document.getElementById(
    "leadForm"
  );

const submitButton =
  document.getElementById(
    "submitButton"
  );

if (
  vendedor &&
  vendedores[vendedor]
) {

  sellerElement.textContent =
    vendedores[vendedor];

  vendedorInput.value =
    vendedor;

} else {

  sellerElement.textContent =
    "Vendedor não identificado";

}

/*
 * ==============================================================
 * PHONE MASK
 * Aproximadamente linhas 500-540
 * ==============================================================
 */

telefoneInput.addEventListener(
  "input",
  function() {

    let digits =
      this.value.replace(
        /\D/g,
        ""
      );

    /*
     * Se o navegador inserir +55,
     * remove somente o código do país.
     */
    if (
      digits.length > 11 &&
      digits.startsWith("55")
    ) {
      digits =
        digits.substring(2);
    }

    /*
     * Limita a 11 dígitos.
     */
    digits =
      digits.substring(
        0,
        11
      );

    if (
      digits.length <= 8
    ) {

      this.value =
        digits;

      return;

    }

    if (
      digits.length === 9
    ) {

      this.value =
        digits.replace(
          /^(\d{5})(\d{4})$/,
          "$1-$2"
        );

      return;

    }

    if (
      digits.length === 10
    ) {

      this.value =
        digits.replace(
          /^(\d{2})(\d{4})(\d{4})$/,
          "($1) $2-$3"
        );

      return;

    }

    this.value =
      digits.replace(
        /^(\d{2})(\d{5})(\d{4})$/,
        "($1) $2-$3"
      );

  }
);

form.addEventListener(
  "submit",
  async function(event) {

    event.preventDefault();

    if (
      !vendedor ||
      !vendedores[vendedor]
    ) {

      alert(
        "Vendedor não identificado. " +
        "Utilize o QR Code correto."
      );

      return;

    }

    /*
     * ==========================================================
     * NORMALIZE CUSTOMER PHONE
     * ==========================================================
     */

    let customerPhone =
      telefoneInput.value.replace(
        /\D/g,
        ""
      );

    if (
      customerPhone.length > 11 &&
      customerPhone.startsWith("55")
    ) {

      customerPhone =
        customerPhone.substring(2);

    }

    if (
      customerPhone.length < 8 ||
      customerPhone.length > 11
    ) {

      alert(
        "Digite um telefone válido com 8 a 11 dígitos."
      );

      telefoneInput.focus();

      return;

    }

    const payload = {

      vendor:
        vendedorInput.value,

      name:
        document
          .getElementById("nome")
          .value
          .trim(),

      customer_phone:
        customerPhone,

      address:
        document
          .getElementById("endereco")
          .value
          .trim(),

      hasClaro:
        document
          .getElementById("claro")
          .value,

      product_searched:
        document
          .getElementById("produto")
          .value

    };

    if (
      !payload.vendor ||
      !payload.name ||
      !payload.customer_phone ||
      !payload.address ||
      !payload.product_searched
    ) {

      alert(
        "Preencha os campos obrigatórios."
      );

      return;

    }

    submitButton.disabled =
      true;

    submitButton.textContent =
      "Enviando...";

    try {

      const response =
        await fetch(
          window.location.pathname,
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify(
                payload
              )
          }
        );

      const result =
        await response.json();

      if (
        !response.ok ||
        !result.success
      ) {

        throw new Error(

          result.details

            ? (
                result.error ||
                "Erro"
              ) +
              ": " +
              result.details

            : result.error ||
              "Erro ao gravar lead."

        );

      }

      /*
       * ========================================================
       * LEAD JÁ FOI SALVO
       * Agora limpamos o formulário antes do WhatsApp.
       * ========================================================
       */

      form.reset();

      vendedorInput.value =
        vendedor;

      sellerElement.textContent =
        vendedores[vendedor];

      /*
       * ========================================================
       * OPEN SELLER WHATSAPP
       * ========================================================
       */

      if (
        result.whatsapp_url
      ) {

        window.location.href =
          result.whatsapp_url;

      } else {

        alert(
          "Lead registrado com sucesso!"
        );

      }

    } catch (error) {

      console.error(
        "Lead submission error:",
        error
      );

      alert(
        error.message ||
        "Erro ao registrar lead."
      );

    } finally {

      submitButton.disabled =
        false;

      submitButton.textContent =
        "Enviar";

    }

  }
);

</script>

</body>

</html>`,
        {
          status: 200,

          headers: {
            "content-type":
              "text/html; charset=UTF-8"
          }
        }
      );
    }

    /*
     * ============================================================
     * OTHER METHODS
     * ============================================================
     */

    return new Response(
      "Método não permitido.",
      {
        status: 405,

        headers: {
          "content-type":
            "text/plain; charset=UTF-8"
        }
      }
    );

  }
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const supabaseUrl = env.SUPABASE_URL;
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

    /*
     * ============================================================
     * POST — RECEBER E GRAVAR LEAD
     * ============================================================
     */
    if (request.method === "POST") {
      try {
        const data = await request.json();

        const vendor = String(data.vendor || "").trim();
        const name = String(data.name || "").trim();
        const address = String(data.address || "").trim();
        const hasClaro = String(data.hasClaro || "").trim();
        const interestRaw = String(data.interest || "").trim();

// Converte o texto do formulário para o ENUM aceito pelo Supabase
const interest =
  interestRaw === "Agora"
    ? "AGORA"
    : interestRaw === "Depois"
      ? "DEPOIS"
      : interestRaw === "Só quero consultar"
        ? "CONSULTA"
        : "";
        // Validação dos campos obrigatórios
        if (!vendor || !name || !address || !interest) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "Preencha todos os campos obrigatórios."
            }),
            {
              status: 400,
              headers: {
                "content-type": "application/json; charset=UTF-8"
              }
            }
          );
        }

        /*
         * Busca o vendedor pelo slug.
         * O telefone não é enviado para o navegador.
         */
        const sellerResponse = await fetch(
          `${supabaseUrl}/rest/v1/sellers?slug=eq.${encodeURIComponent(
            vendor
          )}&active=eq.true&select=id,slug,name,region,phone`,
          {
            headers: {
              apikey: serviceKey,
              Authorization: `Bearer ${serviceKey}`
            }
          }
        );

        if (!sellerResponse.ok) {
          const sellerError = await sellerResponse.text();

          console.error("Erro ao consultar vendedor:", sellerError);

          return new Response(
            JSON.stringify({
              success: false,
              error: "Não foi possível validar o vendedor."
            }),
            {
              status: 500,
              headers: {
                "content-type": "application/json; charset=UTF-8"
              }
            }
          );
        }

        const sellers = await sellerResponse.json();

        if (!sellers.length) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "Vendedor não encontrado ou inativo."
            }),
            {
              status: 404,
              headers: {
                "content-type": "application/json; charset=UTF-8"
              }
            }
          );
        }

        const seller = sellers[0];

        /*
         * Classificação da temperatura
         */
        const temperature =
  interest === "AGORA"
    ? "HOT"
    : interest === "DEPOIS"
      ? "WARM"
      : "CONSULTA";
        /*
         * ========================================================
         * LEAD
         *
         * Mantemos somente os campos estruturais já existentes
         * na tabela leads para evitar erro por coluna inexistente.
         * ========================================================
         */
        const lead = {
          seller_id: seller.id,
          region: seller.region,
          name: name,
          address: address,
          has_claro: hasClaro || "Não informado",
          interest: interest,
          temperature: temperature,
          status: "NOVO",
          submission_id: crypto.randomUUID()
        };

        /*
         * Gravação no Supabase
         */
        const insertResponse = await fetch(
          `${supabaseUrl}/rest/v1/leads`,
          {
            method: "POST",
            headers: {
              apikey: serviceKey,
              Authorization: `Bearer ${serviceKey}`,
              "Content-Type": "application/json",
              Prefer: "return=representation"
            },
            body: JSON.stringify(lead)
          }
        );

        if (!insertResponse.ok) {
          const errorText = await insertResponse.text();

          console.error("Erro Supabase ao gravar lead:", errorText);

          return new Response(
            JSON.stringify({
              success: false,
              error: "Erro ao gravar lead.",
              details: errorText
            }),
            {
              status: 500,
              headers: {
                "content-type": "application/json; charset=UTF-8"
              }
            }
          );
        }

        const responseText = await insertResponse.text();
let savedLead = [];

if (responseText.trim()) {
  try {
    savedLead = JSON.parse(responseText);
  } catch {
    savedLead = [];
  }
}

        /*
         * Resposta de sucesso
         */
        return new Response(
          JSON.stringify({
            success: true,
            lead_id: savedLead?.[0]?.id || null,
            seller: seller.name
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json; charset=UTF-8"
            }
          }
        );
      } catch (error) {
        console.error("Erro interno:", error);

        return new Response(
  JSON.stringify({
    success: false,
    error: "Erro interno.",
    details: String(error?.message || error)
  }),
          {
            status: 500,
            headers: {
              "content-type": "application/json; charset=UTF-8"
            }
          }
        );
      }
    }

    /*
     * ============================================================
     * GET — FORMULÁRIO
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

<title>Máquina de Líder</title>

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
  font-size: 28px;
}

.subtitle {
  color: #666;
  margin-bottom: 24px;
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
  background: #111;
  color: white;
  font-size: 17px;
  font-weight: bold;
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

    <h1>Máquina de Líder</h1>

    <div class="subtitle">
      Atendimento Claro
    </div>

    <div class="seller">
      Vendedor:
      <strong id="seller">Identificando...</strong>
    </div>

    <form id="leadForm">

      <input
        type="hidden"
        id="vendedor"
        name="vendedor"
      >

      <label>
        Nome <span class="required">*</span>
      </label>

      <input
        id="nome"
        required
        placeholder="Digite seu nome"
      >

      <label>
        Endereço <span class="required">*</span>
      </label>

      <input
        id="endereco"
        required
        placeholder="Rua, número e bairro"
      >

      <label>
        Você possui Claro?
      </label>

      <select id="claro">

        <option value="">Selecione</option>
        <option value="Não">Não</option>
        <option value="Internet">Internet</option>
        <option value="Celular">Celular</option>
        <option value="TV">TV</option>
        <option value="Combo">Combo</option>

      </select>

      <label>
        Qual seu interesse?
        <span class="required">*</span>
      </label>

      <select id="interesse" required>

        <option value="">Selecione</option>
        <option value="Agora">Agora</option>
        <option value="Depois">Depois</option>
        <option value="Só quero consultar">
          Só quero consultar
        </option>

      </select>

      <button
        id="submitButton"
        type="submit"
      >
        Quero saber mais
      </button>

    </form>

  </div>

</div>

<script>

/*
 * ============================================================
 * VENDEDORES DO PILOTO — SANTOS
 * ============================================================
 */

const vendedores = {
  "josi-misael": "Josi Misael",
  "mauricio-fuertes": "Maurício Fuertes",
  "monique-gomes": "Monique Gomes",
  "juliana-da-silva": "Juliana Da Silva",
  "marcela-cristina": "Marcela Cristina",
  "sandra-da-silva": "Sandra da Silva",
  "patricia-goncalves": "Patrícia Gonçalves",
  "janelle": "Janelle",
  "ana-paula": "Ana Paula",
  "guilherme-santos": "Guilherme Santos"
};

/*
 * ============================================================
 * IDENTIFICAÇÃO DO VENDEDOR PELO QR CODE
 * Exemplo:
 *
 * https://maquinadelider.com.br/?vendedor=josi-misael
 * ============================================================
 */

const params = new URLSearchParams(
  window.location.search
);

const vendedor = params.get("vendedor");

const sellerElement =
  document.getElementById("seller");

const vendedorInput =
  document.getElementById("vendedor");

const form =
  document.getElementById("leadForm");

const submitButton =
  document.getElementById("submitButton");


/*
 * Validação do vendedor
 */

if (vendedor && vendedores[vendedor]) {

  sellerElement.textContent =
    vendedores[vendedor];

  vendedorInput.value =
    vendedor;

} else {

  sellerElement.textContent =
    "Vendedor não identificado";

}


/*
 * ============================================================
 * ENVIO DO LEAD
 * ============================================================
 */

form.addEventListener(
  "submit",
  async function(event) {

    event.preventDefault();

    /*
     * O vendedor precisa estar identificado
     */
    if (!vendedor || !vendedores[vendedor]) {

      alert(
        "Vendedor não identificado. " +
        "Utilize o QR Code correto."
      );

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

      address:
        document
          .getElementById("endereco")
          .value
          .trim(),

      hasClaro:
        document
          .getElementById("claro")
          .value,

      interest:
        document
          .getElementById("interesse")
          .value

    };


    /*
     * Validação no navegador
     */

    if (
      !payload.vendor ||
      !payload.name ||
      !payload.address ||
      !payload.interest
    ) {

      alert(
        "Preencha os campos obrigatórios."
      );

      return;
    }


    /*
     * Evita duplo clique
     */

    submitButton.disabled = true;

    submitButton.textContent =
      "Registrando...";


    try {

      const response = await fetch(
        window.location.pathname,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify(payload)
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
    ? `${result.error || "Erro"}: ${result.details}`
    : result.error || "Erro ao gravar lead."
);

      }


      /*
       * Sucesso
       */

      alert(
        "Lead registrado com sucesso!"
      );


      form.reset();


      /*
       * Mantém o vendedor identificado
       */

      vendedorInput.value =
        vendedor;


      sellerElement.textContent =
        vendedores[vendedor];


    } catch (error) {

      console.error(error);

      alert(
        error.message ||
        "Erro ao registrar lead."
      );

    } finally {

      submitButton.disabled = false;

      submitButton.textContent =
        "Quero saber mais";

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
     * OUTROS MÉTODOS
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

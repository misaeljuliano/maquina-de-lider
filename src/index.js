export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const supabaseUrl = env.SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
        if (request.method === "POST") {
      try {
        const data = await request.json();

        const vendor = data.vendor;
        const name = data.name;
        const address = data.address;
        const hasClaro = data.hasClaro;
        const interest = data.interest;

        if (!vendor || !name || !address || !interest) {
          return new Response(
            JSON.stringify({ success: false, error: "Dados obrigatórios não preenchidos." }),
            {
              status: 400,
              headers: { "content-type": "application/json;charset=UTF-8" }
            }
          );
        }

        const sellerResponse = await fetch(
          `${supabaseUrl}/rest/v1/sellers?slug=eq.${encodeURIComponent(vendor)}&active=eq.true&select=id,region`,
          {
            headers: {
              "apikey": serviceKey,
              "Authorization": `Bearer ${serviceKey}`
            }
          }
        );

        const sellers = await sellerResponse.json();

        if (!sellers.length) {
          return new Response(
            JSON.stringify({ success: false, error: "Vendedor não encontrado." }),
            {
              status: 404,
              headers: { "content-type": "application/json;charset=UTF-8" }
            }
          );
        }

        const seller = sellers[0];

        const temperature =
          interest === "Agora"
            ? "HOT"
            : interest === "Depois"
              ? "WARM"
              : "CONSULTA";

        const lead = {
          seller_id: seller.id,
          region: seller.region,
          name,
          address,
          has_claro: hasClaro || "Não informado",
          interest,
          best_time: null,
          origin: "QR",
          temperature,
          status: "NOVO",
          next_step: "Realizar contato",
          submission_id: crypto.randomUUID()
        };

        const insertResponse = await fetch(
          `${supabaseUrl}/rest/v1/leads`,
          {
            method: "POST",
            headers: {
              "apikey": serviceKey,
              "Authorization": `Bearer ${serviceKey}`,
              "Content-Type": "application/json",
              "Prefer": "return=representation"
            },
            body: JSON.stringify(lead)
          }
        );

        if (!insertResponse.ok) {
          const errorText = await insertResponse.text();

          return new Response(
            JSON.stringify({
              success: false,
              error: "Erro ao gravar lead.",
              details: errorText
            }),
            {
              status: 500,
              headers: { "content-type": "application/json;charset=UTF-8" }
            }
          );
        }

        const savedLead = await insertResponse.json();

        return new Response(
          JSON.stringify({
            success: true,
            lead_id: savedLead[0].id
          }),
          {
            status: 200,
            headers: { "content-type": "application/json;charset=UTF-8" }
          }
        );

      } catch (error) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Erro interno.",
            details: error.message
          }),
          {
            status: 500,
            headers: { "content-type": "application/json;charset=UTF-8" }
          }
        );
      }
    }

    if (request.method === "GET") {
      return new Response(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
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

input, select {
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
      Vendedor: <strong id="seller">Identificando...</strong>
    </div>

    <form id="leadForm">
<input type="hidden" id="vendedor" name="vendedor">
      <label>
        Nome <span class="required">*</span>
      </label>
      <input id="nome" required placeholder="Digite seu nome">

      <label>
        Endereço <span class="required">*</span>
      </label>
      <input id="endereco" required placeholder="Rua, número e bairro">

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
      </label>
      <select id="interesse">
  <option value="">Selecione</option>
  <option value="Agora">Agora</option>
  <option value="Depois">Depois</option>
  <option value="Só quero consultar">Só quero consultar</option>
</select>

<button type="submit">Quero saber mais</button>
</form>

</div>
</div>
<script>
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

const params = new URLSearchParams(window.location.search);
const vendedor = params.get("vendedor");

if (vendedor && vendedores[vendedor]) {
  document.getElementById("seller").textContent = vendedores[vendedor];
  document.getElementById("vendedor").value = vendedor;
}

document.getElementById("leadForm").addEventListener("submit", async function(event) {
  event.preventDefault();

  const payload = {
    vendor: document.getElementById("vendedor").value,
    name: document.getElementById("nome").value.trim(),
    address: document.getElementById("endereco").value.trim(),
    hasClaro: document.getElementById("claro").value,
    interest: document.getElementById("interesse").value
  };

  if (!payload.vendor || !payload.name || !payload.address || !payload.interest) {
    alert("Preencha os campos obrigatórios.");
    return;
  }

  try {
    const response = await fetch(window.location.pathname, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || "Erro ao gravar lead.");
    }

    alert("Lead registrado com sucesso!");
    document.getElementById("leadForm").reset();
    document.getElementById("vendedor").value = vendedor || "";
  } catch (error) {
    alert(error.message || "Erro ao registrar lead.");
  }
});
</script>
</body>
</html>
`, {
  headers: {
    "content-type": "text/html;charset=UTF-8"
  }
});
}

return new Response("Página não encontrada", {
  status: 404,
  headers: {
    "content-type": "text/plain;charset=UTF-8"
  }
});
}
}

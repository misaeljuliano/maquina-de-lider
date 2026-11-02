export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const supabaseUrl = env.SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

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

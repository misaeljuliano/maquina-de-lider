export default {
  async fetch(request) {
    const url = new URL(request.url);

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
        <option value="">Sele

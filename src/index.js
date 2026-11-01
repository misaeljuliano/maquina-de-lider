export default {
  async fetch(request) {
    return new Response(`
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Máquina de Líder</title>
        <style>
          body {
            margin: 0;
            font-family: Arial, sans-serif;
            background: #f5f5f5;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
          }
          .card {
            background: white;
            width: 90%;
            max-width: 420px;
            padding: 32px;
            border-radius: 18px;
            box-shadow: 0 4px 20px rgba(0,0,0,.12);
            text-align: center;
          }
          h1 {
            margin-bottom: 10px;
          }
          p {
            color: #666;
          }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>Máquina de Líder</h1>
          <p>Lead Machine D2D 2.0</p>
          <p>Sistema em construção.</p>
        </div>
      </body>
      </html>
    `, {
      headers: {
        "content-type": "text/html;charset=UTF-8"
      }
    });
  }
};

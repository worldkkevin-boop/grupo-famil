# Grupo FAMIl — Assinaturas

Gerenciador de assinaturas compartilhadas com rateio automático e geração de **Pix Copia e Cola + QR Code**.

| Assinatura | Valor |
|---|---|
| Google One 2TB | R$ 49,99/mês |
| YouTube Premium Família | R$ 53,90/mês |
| **Total** | **R$ 103,89/mês** |

---

## Setup Local

```bash
npm install
cp .env.example .env
# Edite o .env: ajuste PIX_CITY com a sua cidade
npm run dev
```

Acesse: **http://localhost:4001**

> **Nota:** O `--experimental-sqlite` no script é necessário no Node 22 LTS.
> No Node 23+ ele é ignorado sem efeito.

---

## Deploy — KS Studio Infra

### 1. Subir no GitHub

```bash
git init
git add .
git commit -m "feat: initial commit"
git remote add origin https://github.com/SEU_USER/grupo-famil.git
git push -u origin main
```

### 2. DNS

No painel Hostinger: criar registro `A` com nome **`famil`** apontando para `2.25.207.133`.

### 3. Clonar e configurar no VPS

```bash
ssh root@2.25.207.133
cd /opt && git clone https://github.com/SEU_USER/grupo-famil.git grupo-famil
cd grupo-famil
cp .env.example .env && nano .env
# Preencher: PORT=4001, PIX_CITY=Sua Cidade
npm install --omit=dev
pm2 start server.js --name grupo-famil --node-args="--experimental-sqlite"
pm2 save
```

### 4. Nginx

Criar `/etc/nginx/sites-available/grupo-famil`:

```nginx
server {
    server_name famil.ksstudio.cloud;

    location / {
        proxy_pass         http://127.0.0.1:4001;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/grupo-famil /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

### 5. HTTPS

```bash
certbot --nginx -d famil.ksstudio.cloud
```

### Atualizar depois

```bash
cd /opt/grupo-famil && git pull && npm install --omit=dev && pm2 restart grupo-famil
```

---

## Membros

Editáveis diretamente no banco. Para adicionar via SQLite CLI no VPS:

```bash
cd /opt/grupo-famil
node --experimental-sqlite -e "
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync('./grupo-famil.db');
  db.prepare(\"INSERT INTO membros (nome) VALUES (?)\").run('Nome Aqui');
  console.log('Membro adicionado!');
"
pm2 restart grupo-famil
```

---

## Stack

- **Runtime:** Node.js 22+ (sem transpilação)
- **Web:** Express 4
- **Banco:** `node:sqlite` — `DatabaseSync` (nativo, sem dependência)
- **QR Code:** biblioteca `qrcode`
- **Pix EMV:** implementação pura em JS (sem lib extra)
- **Front:** HTML + CSS + JS simples, servido pelo Express

'use strict';
try { process.loadEnvFile(); } catch {}

const express  = require('express');
const { DatabaseSync } = require('node:sqlite');
const crypto   = require('node:crypto');
const path     = require('path');
const QRCode   = require('qrcode');
const webpush  = require('web-push');

const app      = express();
const PORT            = process.env.PORT             || 4001;
const BASE_URL        = process.env.BASE_URL         || `http://localhost:${PORT}`;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const ADMIN_EMAIL     = 'worldkkevin@gmail.com';
const PIX_KEY  = process.env.PIX_KEY  || '01749132222';
const PIX_NAME = process.env.PIX_NAME || 'KEVIN SCHWNAKE';
const PIX_CITY = process.env.PIX_CITY || 'LARANJAL DO JARI';

// ── Banco de Dados e Migrations ───────────────────────────────────────────────
const db = new DatabaseSync(path.join(__dirname, 'grupo-famil.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS membros (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    nome  TEXT    NOT NULL,
    ativo INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS pagamentos (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    membro_id      INTEGER NOT NULL,
    mes_referencia TEXT    NOT NULL,
    pago           INTEGER DEFAULT 0,
    data_pagamento TEXT,
    FOREIGN KEY(membro_id) REFERENCES membros(id)
  );
  CREATE TABLE IF NOT EXISTS assinaturas (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    nome           TEXT NOT NULL,
    valor_centavos INTEGER NOT NULL,
    ativo          INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS config (
    chave          TEXT PRIMARY KEY,
    valor          TEXT NOT NULL
  );
`);

// Migrations seguras
for (const col of [
  'ALTER TABLE membros ADD COLUMN email TEXT',
  'ALTER TABLE membros ADD COLUMN convite_token TEXT',
  'ALTER TABLE membros ADD COLUMN convite_usado INTEGER DEFAULT 0',
  'ALTER TABLE membros ADD COLUMN foto_url TEXT',
  'ALTER TABLE membros ADD COLUMN google_sub TEXT',
]) { try { db.exec(col); } catch {} }

// Seed inicial: membros
const { cntMembros } = db.prepare('SELECT COUNT(*) as cnt FROM membros').get();
if (cntMembros === 0) {
  const ins = db.prepare('INSERT INTO membros (nome, ativo) VALUES (?, ?)');
  [['Kevin',1],['Gaby',1],['Membro 3',0],['Membro 4',0],['Membro 5',0],['Membro 6',0]]
    .forEach(([n, a]) => ins.run(n, a));
  console.log('✅  Membros iniciais inseridos.');
}

// Seed inicial: assinaturas
const { cntAssinaturas } = db.prepare('SELECT COUNT(*) as cnt FROM assinaturas').get();
if (cntAssinaturas === 0) {
  const ins = db.prepare('INSERT INTO assinaturas (nome, valor_centavos, ativo) VALUES (?, ?, 1)');
  ins.run('Google AI Pro 5TB', 4849);
  ins.run('YouTube Premium Família', 5390);
  console.log('✅  Assinaturas iniciais inseridas.');
}

// Seed inicial: config
const { cntConfig } = db.prepare('SELECT COUNT(*) as cnt FROM config').get();
if (cntConfig === 0) {
  const ins = db.prepare('INSERT INTO config (chave, valor) VALUES (?, ?)');
  ins.run('dia_vencimento', '10');
  ins.run('modo_pagamento', 'rateio'); // 'rateio' ou ID do membro (ex: '3')
  console.log('✅  Configurações iniciais inseridas.');
}

// Configurar Web Push
function getConfig(chave, padrao) {
  const row = db.prepare('SELECT valor FROM config WHERE chave=?').get(chave);
  return row ? row.valor : padrao;
}

let vapidPublic = getConfig('vapid_public', null);
let vapidPrivate = getConfig('vapid_private', null);
if (!vapidPublic || !vapidPrivate) {
  const vapidKeys = webpush.generateVAPIDKeys();
  const ins = db.prepare('INSERT INTO config (chave, valor) VALUES (?, ?)');
  ins.run('vapid_public', vapidKeys.publicKey);
  ins.run('vapid_private', vapidKeys.privateKey);
  vapidPublic = vapidKeys.publicKey;
  vapidPrivate = vapidKeys.privateKey;
  console.log('✅  VAPID Keys geradas e inseridas.');
}

webpush.setVapidDetails(
  `mailto:${ADMIN_EMAIL || 'admin@localhost'}`,
  vapidPublic,
  vapidPrivate
);

// ── Estado Compartilhado ──────────────────────────────────────────────────────
function getAssinaturas() {
  return db.prepare('SELECT id, nome, valor_centavos as valor, ativo FROM assinaturas ORDER BY id').all();
}
function getTotalCentavos() {
  return db.prepare('SELECT SUM(valor_centavos) as total FROM assinaturas WHERE ativo=1').get().total || 0;
}

// ── Pix EMV ───────────────────────────────────────────────────────────────────
function crc16(str) {
  let crc = 0xFFFF;
  for (const ch of str) {
    crc ^= ch.charCodeAt(0) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
function tlv(id, v) { return `${id}${String(v.length).padStart(2,'0')}${v}`; }
function semAcentos(s) { return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase(); }
function gerarPix(centavos) {
  const v = (centavos/100).toFixed(2);
  const n = semAcentos(PIX_NAME).substring(0,25);
  const c = semAcentos(PIX_CITY).substring(0,15);
  const info = tlv('00','br.gov.bcb.pix')+tlv('01',PIX_KEY)+tlv('02','Assinaturas FAMIl');
  const body = tlv('00','01')+tlv('26',info)+tlv('52','0000')+tlv('53','986')+tlv('54',v)+tlv('58','BR')+tlv('59',n)+tlv('60',c)+tlv('62',tlv('05','***'));
  return body + tlv('63', crc16(body+'6304'));
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function mesAtual() { return new Date().toISOString().slice(0, 7); }
function calcularCotas(membros) {
  const total = getTotalCentavos();
  const modo = getConfig('modo_pagamento', 'rateio');

  if (modo !== 'rateio') {
    // Modo "Mês Cheio" - Alguém paga tudo sozinho
    const pagadorId = parseInt(modo, 10);
    return membros.map(m => {
      if (!m.ativo) return { ...m, cota: 0 };
      if (m.id === pagadorId) return { ...m, cota: total };
      return { ...m, cota: 0 };
    });
  }

  // Modo Rateio (Divide pelo número de ativos)
  const ativos = membros.filter(m => m.ativo);
  const n = ativos.length;
  if (!n) return membros.map(m => ({ ...m, cota: 0 }));
  const base = Math.floor(total / n);
  const extra = total % n;
  let idx = 0;
  return membros.map(m => {
    if (!m.ativo) return { ...m, cota: 0 };
    return { ...m, cota: base + (idx++ < extra ? 1 : 0) };
  });
}

// Verificar ID token Google via tokeninfo (sem dependência extra — fetch nativo Node 18+)
async function verificarTokenGoogle(id_token) {
  const res  = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(id_token)}`);
  const info = await res.json();
  if (!res.ok || info.error_description) throw new Error(info.error_description || 'Token Google inválido');
  if (GOOGLE_CLIENT_ID && info.aud !== GOOGLE_CLIENT_ID) throw new Error('Token não pertence a este app');
  return info; // { sub, name, email, picture, ... }
}

const adminTokens = new Set();
function extractAdminToken(req) {
  const auth = req.headers.authorization;
  return (auth && auth.startsWith('Bearer ')) ? auth.split(' ')[1] : null;
}


// ── Middlewares ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/convite/:token', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'convite.html'))
);

// ── API: Config pública (client_id não é segredo) ─────────────────────────────
app.get('/api/config', (_req, res) => {
  res.json({ google_client_id: GOOGLE_CLIENT_ID });
});

// ── API: Status ───────────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  const mes = mesAtual();
  const membros    = db.prepare('SELECT * FROM membros ORDER BY id').all();
  const pagamentos = db.prepare('SELECT * FROM pagamentos WHERE mes_referencia=?').all(mes);
  const token = extractAdminToken(req);
  const isAdmin = adminTokens.has(token);

  const comCotas   = calcularCotas(membros).map(m => {
    const isPaid = pagamentos.some(p => p.membro_id === m.id && p.pago === 1);
    if (!isAdmin) delete m.email; // Privacidade: Oculta email para não admins
    return { ...m, pago: isPaid };
  });

  const total = getTotalCentavos();
  const assinaturas = getAssinaturas();
  const diaVencimento = getConfig('dia_vencimento', '10');
  const modoPagamento = getConfig('modo_pagamento', 'rateio');

  res.json({
    mes,
    total_centavos: total,
    assinaturas,
    dia_vencimento: diaVencimento,
    modo_pagamento: modoPagamento,
    vapid_public: getConfig('vapid_public', ''),
    membros: comCotas,
    isAdmin
  });
});

// ── API: Pix ──────────────────────────────────────────────────────────────────
app.post('/api/pix', async (req, res) => {
  const { valor_centavos } = req.body;
  if (!Number.isInteger(valor_centavos) || valor_centavos <= 0)
    return res.status(400).json({ erro: 'valor_centavos inválido' });
  const payload = gerarPix(valor_centavos);
  try {
    const qr_base64 = await QRCode.toDataURL(payload, { width:280, margin:2, color:{dark:'#12122a',light:'#ffffff'} });
    res.json({ payload, qr_base64 });
  } catch { res.status(500).json({ erro: 'Erro ao gerar QR Code' }); }
});

// ── API: Pagamentos ───────────────────────────────────────────────────────────
app.post('/api/pagar', (req, res) => {
  const token = extractAdminToken(req);
  if (!adminTokens.has(token)) return res.status(401).json({ erro: 'Não autorizado' });

  const { membro_id } = req.body;
  const mes = mesAtual();
  const row = db.prepare('SELECT id FROM pagamentos WHERE membro_id=? AND mes_referencia=?').get(membro_id, mes);
  if (row) {
    db.prepare('UPDATE pagamentos SET pago=1, data_pagamento=? WHERE id=?').run(new Date().toISOString(), row.id);
  } else {
    db.prepare('INSERT INTO pagamentos (membro_id,mes_referencia,pago,data_pagamento) VALUES(?,?,1,?)').run(membro_id, mes, new Date().toISOString());
  }
  res.json({ ok: true });
});

app.post('/api/despagar', (req, res) => {
  const token = extractAdminToken(req);
  if (!adminTokens.has(token)) return res.status(401).json({ erro: 'Não autorizado' });

  const { membro_id } = req.body;
  const mes = mesAtual();
  db.prepare('UPDATE pagamentos SET pago=0, data_pagamento=NULL WHERE membro_id=? AND mes_referencia=?').run(membro_id, mes);
  res.json({ ok: true });
});

// ── API: Push Notifications ───────────────────────────────────────────────────
app.post('/api/push/subscribe', (req, res) => {
  const { membro_id, sub } = req.body;
  if (!membro_id || !sub) return res.status(400).json({ erro: 'Dados inválidos' });
  db.prepare('UPDATE membros SET push_sub=? WHERE id=?').run(JSON.stringify(sub), membro_id);
  res.json({ ok: true });
});

app.post('/api/admin/push/disparar', async (req, res) => {
  const token = extractAdminToken(req);
  if (!adminTokens.has(token)) return res.status(401).json({ erro: 'Não autorizado' });

  const membros = db.prepare('SELECT id, nome, push_sub FROM membros WHERE ativo=1').all();
  // Pega quem não pagou ainda (ou todos, se precisarmos recalcular)
  const mes = mesAtual();
  const pagamentos = new Set(
    db.prepare('SELECT membro_id FROM pagamentos WHERE mes_referencia=? AND pago=1').all().map(p => p.membro_id)
  );

  let enviados = 0;
  for (const m of membros) {
    if (pagamentos.has(m.id)) continue; // Já pagou
    if (!m.push_sub) continue; // Não tem celular cadastrado

    const payload = JSON.stringify({
      title: 'Fatura do Grupo FAMIl',
      body: `Oi ${m.nome}, a fatura de ${mes} já fechou! Abra o app para gerar o Pix.`,
      icon: '/icon.svg'
    });

    try {
      await webpush.sendNotification(JSON.parse(m.push_sub), payload);
      enviados++;
    } catch (err) {
      console.error(`Erro ao enviar push para ${m.nome}:`, err);
      if (err.statusCode === 410) {
        db.prepare('UPDATE membros SET push_sub=NULL WHERE id=?').run(m.id);
      }
    }
  }

  res.json({ ok: true, enviados });
});

// Cron Job: Disparo Automático no dia do vencimento (Roda a cada 6 horas)
setInterval(async () => {
  const diaVencimento = parseInt(getConfig('dia_vencimento', '10'), 10);
  const hoje = new Date().getDate();
  if (hoje !== diaVencimento) return;

  const membros = db.prepare('SELECT id, nome, push_sub FROM membros WHERE ativo=1 AND push_sub IS NOT NULL').all();
  if (!membros.length) return;

  const mes = mesAtual();
  const pagamentos = new Set(
    db.prepare('SELECT membro_id FROM pagamentos WHERE mes_referencia=? AND pago=1').all().map(p => p.membro_id)
  );

  const payload = JSON.stringify({
    title: 'Fatura do Grupo FAMIl',
    body: `Sua fatura de ${mes} vence hoje! Abra o app para pagar.`,
    icon: '/icon.svg'
  });

  for (const m of membros) {
    if (pagamentos.has(m.id)) continue;
    try {
      await webpush.sendNotification(JSON.parse(m.push_sub), payload);
    } catch (err) {
      if (err.statusCode === 410) {
        db.prepare('UPDATE membros SET push_sub=NULL WHERE id=?').run(m.id);
      }
    }
  }
}, 6 * 60 * 60 * 1000);

// ── API: Convites ─────────────────────────────────────────────────────────────
app.post('/api/convite/gerar', (req, res) => {
  const { membro_id } = req.body;
  const membro = db.prepare('SELECT * FROM membros WHERE id=?').get(membro_id);
  if (!membro || membro.ativo) return res.status(400).json({ erro: 'Slot inválido ou já ocupado' });
  const token = crypto.randomBytes(16).toString('hex');
  db.prepare('UPDATE membros SET convite_token=?, convite_usado=0 WHERE id=?').run(token, membro_id);
  res.json({ link: `${BASE_URL}/convite/${token}` });
});

app.get('/api/convite/:token', (req, res) => {
  const m = db.prepare('SELECT id, convite_usado, ativo FROM membros WHERE convite_token=?').get(req.params.token);
  if (!m) return res.status(404).json({ erro: 'Convite inválido ou expirado' });
  if (m.convite_usado || m.ativo) return res.json({ usado: true });
  res.json({ valido: true });
});

// Aceitar convite — suporta Google OAuth OU form manual (fallback)
app.post('/api/convite/aceitar', async (req, res) => {
  const { token, google_id_token, nome: nomeManual, email: emailManual } = req.body;

  const membro = db.prepare('SELECT * FROM membros WHERE convite_token=?').get(token);
  if (!membro)              return res.status(404).json({ erro: 'Convite inválido ou expirado' });
  if (membro.convite_usado || membro.ativo) return res.status(400).json({ erro: 'Convite já utilizado' });

  let nome, email, foto_url = null, google_sub = null;

  if (google_id_token) {
    // Fluxo Google
    try {
      const info = await verificarTokenGoogle(google_id_token);
      nome       = info.name  || info.email.split('@')[0];
      email      = info.email;
      foto_url   = info.picture || null;
      google_sub = info.sub;
    } catch (e) {
      return res.status(401).json({ erro: `Autenticação Google falhou: ${e.message}` });
    }
  } else if (nomeManual?.trim() && emailManual?.trim()) {
    // Fallback manual (sem Client ID configurado)
    nome  = nomeManual.trim();
    email = emailManual.trim().toLowerCase();
  } else {
    return res.status(400).json({ erro: 'Autenticação necessária' });
  }

  db.prepare('UPDATE membros SET nome=?, email=?, foto_url=?, google_sub=?, ativo=1, convite_usado=1 WHERE id=?')
    .run(nome, email, foto_url, google_sub, membro.id);

  res.json({ ok: true, nome, foto_url, membro_id: membro.id });
});

// ── API: Admin ────────────────────────────────────────────────────────────────
app.post('/api/admin/login', async (req, res) => {
  try {
    const info = await verificarTokenGoogle(req.body.google_id_token);
    if (info.email !== ADMIN_EMAIL) {
      return res.status(403).json({ erro: 'Acesso negado. Apenas o administrador pode logar aqui.' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    adminTokens.add(token);
    res.json({ token, nome: info.name });
  } catch (e) {
    res.status(401).json({ erro: 'Login falhou' });
  }
});

app.post('/api/admin/remover', (req, res) => {
  const token = extractAdminToken(req);
  if (!adminTokens.has(token)) return res.status(401).json({ erro: 'Não autorizado' });

  const { membro_id } = req.body;
  db.prepare("UPDATE membros SET ativo=0, nome='Membro ' || id, email=NULL, foto_url=NULL, google_sub=NULL, convite_usado=0 WHERE id=?")
    .run(membro_id);
  res.json({ ok: true });
});

app.post('/api/admin/assinaturas', (req, res) => {
  const token = extractAdminToken(req);
  if (!adminTokens.has(token)) return res.status(401).json({ erro: 'Não autorizado' });

  const { id, nome, valor_centavos } = req.body;
  if (!nome || !valor_centavos) return res.status(400).json({ erro: 'Dados inválidos' });

  if (id) {
    db.prepare('UPDATE assinaturas SET nome=?, valor_centavos=? WHERE id=?').run(nome, valor_centavos, id);
  } else {
    db.prepare('INSERT INTO assinaturas (nome, valor_centavos, ativo) VALUES (?, ?, 1)').run(nome, valor_centavos);
  }
  res.json({ ok: true });
});

app.delete('/api/admin/assinaturas/:id', (req, res) => {
  const token = extractAdminToken(req);
  if (!adminTokens.has(token)) return res.status(401).json({ erro: 'Não autorizado' });

  db.prepare('UPDATE assinaturas SET ativo=0 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/admin/config', (req, res) => {
  const token = extractAdminToken(req);
  if (!adminTokens.has(token)) return res.status(401).json({ erro: 'Não autorizado' });

  const { dia_vencimento, modo_pagamento } = req.body;
  const upd = db.prepare('INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor');
  
  if (dia_vencimento !== undefined) upd.run('dia_vencimento', dia_vencimento);
  if (modo_pagamento !== undefined) upd.run('modo_pagamento', modo_pagamento);

  res.json({ ok: true });
});

// ── Fallback ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () =>
  console.log(`✅  Grupo-FAMIl → ${BASE_URL}  |  mês: ${mesAtual()}`)
);

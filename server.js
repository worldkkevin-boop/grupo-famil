'use strict';
try { process.loadEnvFile(); } catch {}

const express  = require('express');
const { DatabaseSync } = require('node:sqlite');
const crypto   = require('node:crypto');
const path     = require('path');
const QRCode   = require('qrcode');

const app      = express();
const PORT            = process.env.PORT             || 4001;
const BASE_URL        = process.env.BASE_URL         || `http://localhost:${PORT}`;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const ADMIN_EMAIL     = 'worldkkevin@gmail.com';
const PIX_KEY  = process.env.PIX_KEY  || '01749132222';
const PIX_NAME = process.env.PIX_NAME || 'KEVIN SCHWNAKE';
const PIX_CITY = process.env.PIX_CITY || 'LARANJAL DO JARI';

// ── Assinaturas (centavos) ────────────────────────────────────────────────────
const ASSINATURAS = [
  { nome: 'Google AI Pro 5TB',       valor: 4849 },
  { nome: 'YouTube Premium Família', valor: 5390 },
];
const TOTAL_CENTAVOS = ASSINATURAS.reduce((s, a) => s + a.valor, 0);

// ── Banco de Dados ────────────────────────────────────────────────────────────
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
`);

// Migrations seguras
for (const col of [
  'ALTER TABLE membros ADD COLUMN email TEXT',
  'ALTER TABLE membros ADD COLUMN convite_token TEXT',
  'ALTER TABLE membros ADD COLUMN convite_usado INTEGER DEFAULT 0',
  'ALTER TABLE membros ADD COLUMN foto_url TEXT',
  'ALTER TABLE membros ADD COLUMN google_sub TEXT',
]) { try { db.exec(col); } catch {} }

// Seed inicial
const { cnt } = db.prepare('SELECT COUNT(*) as cnt FROM membros').get();
if (cnt === 0) {
  const ins = db.prepare('INSERT INTO membros (nome, ativo) VALUES (?, ?)');
  [['Kevin',1],['Gaby',1],['Membro 3',0],['Membro 4',0],['Membro 5',0],['Membro 6',0]]
    .forEach(([n, a]) => ins.run(n, a));
  console.log('✅  Membros iniciais inseridos.');
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
  const ativos = membros.filter(m => m.ativo);
  const n = ativos.length;
  if (!n) return membros.map(m => ({ ...m, cota: 0 }));
  const base = Math.floor(TOTAL_CENTAVOS / n);
  const extra = TOTAL_CENTAVOS % n;
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

  res.json({ mes, total_centavos: TOTAL_CENTAVOS, assinaturas: ASSINATURAS, membros: comCotas, isAdmin });
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

  res.json({ ok: true, nome, foto_url });
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

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () =>
  console.log(`✅  Grupo-FAMIl → ${BASE_URL}  |  mês: ${mesAtual()}`)
);

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
  CREATE TABLE IF NOT EXISTS grupos (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    nome           TEXT NOT NULL,
    dono_email     TEXT NOT NULL,
    pix_key        TEXT,
    pix_name       TEXT,
    pix_city       TEXT,
    ativo          INTEGER DEFAULT 1,
    data_criacao   TEXT
  );
  CREATE TABLE IF NOT EXISTS membros (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    grupo_id  INTEGER NOT NULL DEFAULT 1,
    nome      TEXT    NOT NULL,
    ativo     INTEGER DEFAULT 1,
    FOREIGN KEY(grupo_id) REFERENCES grupos(id)
  );
  CREATE TABLE IF NOT EXISTS pagamentos (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    grupo_id       INTEGER NOT NULL DEFAULT 1,
    membro_id      INTEGER NOT NULL,
    mes_referencia TEXT    NOT NULL,
    pago           INTEGER DEFAULT 0,
    data_pagamento TEXT,
    FOREIGN KEY(grupo_id) REFERENCES grupos(id),
    FOREIGN KEY(membro_id) REFERENCES membros(id)
  );
  CREATE TABLE IF NOT EXISTS assinaturas (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    grupo_id       INTEGER NOT NULL DEFAULT 1,
    nome           TEXT NOT NULL,
    valor_centavos INTEGER NOT NULL,
    ativo          INTEGER DEFAULT 1,
    FOREIGN KEY(grupo_id) REFERENCES grupos(id)
  );
  CREATE TABLE IF NOT EXISTS config (
    chave          TEXT,
    valor          TEXT NOT NULL,
    grupo_id       INTEGER DEFAULT 1,
    PRIMARY KEY (chave, grupo_id)
  );
`);

// Migrations seguras
for (const col of [
  'ALTER TABLE membros ADD COLUMN email TEXT',
  'ALTER TABLE membros ADD COLUMN convite_token TEXT',
  'ALTER TABLE membros ADD COLUMN convite_usado INTEGER DEFAULT 0',
  'ALTER TABLE membros ADD COLUMN foto_url TEXT',
  'ALTER TABLE membros ADD COLUMN google_sub TEXT',
  'ALTER TABLE membros ADD COLUMN grupo_id INTEGER NOT NULL DEFAULT 1',
  'ALTER TABLE pagamentos ADD COLUMN grupo_id INTEGER NOT NULL DEFAULT 1',
  'ALTER TABLE assinaturas ADD COLUMN grupo_id INTEGER NOT NULL DEFAULT 1',
  'ALTER TABLE config ADD COLUMN grupo_id INTEGER DEFAULT 1',
]) { try { db.exec(col); } catch {} }

// Fix do Schema do Config (Migrations)
try {
  const tableInfo = db.prepare("PRAGMA table_info(config)").all();
  const pkColumns = tableInfo.filter(c => c.pk > 0);
  if (pkColumns.length === 1 && pkColumns[0].name === 'chave') {
    db.exec(`
      CREATE TABLE config_new (chave TEXT, valor TEXT NOT NULL, grupo_id INTEGER DEFAULT 1, PRIMARY KEY (chave, grupo_id));
      INSERT INTO config_new SELECT * FROM config;
      DROP TABLE config;
      ALTER TABLE config_new RENAME TO config;
    `);
    console.log('✅  Tabela config migrada para Primary Key composta.');
  }
} catch (err) {
  console.error("Erro ao migrar config:", err);
}

// Seed inicial: Grupo 1 (O grupo legadado do Admin principal)
const { cntGrupos } = db.prepare('SELECT COUNT(*) as cnt FROM grupos').get();
if (cntGrupos === 0) {
  const ins = db.prepare('INSERT INTO grupos (id, nome, dono_email, pix_key, pix_name, pix_city, data_criacao) VALUES (?, ?, ?, ?, ?, ?, ?)');
  ins.run(1, 'Grupo FAMIl Principal', ADMIN_EMAIL, PIX_KEY, PIX_NAME, PIX_CITY, new Date().toISOString());
  console.log('✅  Grupo inicial (SaaS) criado para o dono:', ADMIN_EMAIL);
}

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
function getConfig(chave, padrao, grupo_id = 1) {
  const row = db.prepare('SELECT valor FROM config WHERE chave=? AND grupo_id=?').get(chave, grupo_id);
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
function getAssinaturas(grupo_id) {
  return db.prepare('SELECT id, nome, valor_centavos as valor, ativo FROM assinaturas WHERE ativo=1 AND grupo_id=? ORDER BY id').all(grupo_id);
}
function getTotalCentavos(grupo_id) {
  return db.prepare('SELECT SUM(valor_centavos) as total FROM assinaturas WHERE ativo=1 AND grupo_id=?').get(grupo_id).total || 0;
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
function gerarPix(centavos, grupo) {
  const v = (centavos/100).toFixed(2);
  const n = semAcentos(grupo.pix_name || '').substring(0,25);
  const c = semAcentos(grupo.pix_city || '').substring(0,15);
  const info = tlv('00','br.gov.bcb.pix')+tlv('01',grupo.pix_key || '')+tlv('02','Assinaturas FAMIl');
  const body = tlv('00','01')+tlv('26',info)+tlv('52','0000')+tlv('53','986')+tlv('54',v)+tlv('58','BR')+tlv('59',n)+tlv('60',c)+tlv('62',tlv('05','***'));
  return body + tlv('63', crc16(body+'6304'));
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function mesAtual() { return new Date().toISOString().slice(0, 7); }
function calcularCotas(membros, grupo_id) {
  const total = getTotalCentavos(grupo_id);
  const modo = getConfig('modo_pagamento', 'rateio', grupo_id);

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

const sessionTokens = new Map(); // token -> { role: 'admin'|'member', membro_id: number|null }
function getSession(req) {
  const auth = req.headers.authorization;
  if (!auth) return null;
  return sessionTokens.get(auth.split(' ')[1]) || null;
}

// ── Middlewares ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.get('/convite/:token', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'convite.html'))
);

// ── API: Config pública (client_id não é segredo) ─────────────────────────────
app.get('/api/config', (_req, res) => {
  res.json({ google_client_id: GOOGLE_CLIENT_ID });
});

// ── API: Status ───────────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ erro: 'Não autorizado' });

  const isAdmin = session.role === 'admin';
  const grupo_id = session.grupo_id;
  const mes = mesAtual();
  const membros = db.prepare('SELECT id, nome, email, foto_url, ativo FROM membros WHERE grupo_id=?').all(grupo_id);
  const comCotas = calcularCotas(membros, grupo_id);

  const pagamentos = db.prepare('SELECT membro_id FROM pagamentos WHERE mes_referencia=? AND pago=1 AND grupo_id=?').all(mes, grupo_id);
  const pagos = new Set(pagamentos.map(p => p.membro_id));

  comCotas.forEach(m => {
    const isPaid = pagos.has(m.id);
    if (!isAdmin) delete m.email; // Oculta emails para não-admins
    m.pago = isPaid;
  });

  const total = getTotalCentavos(grupo_id);
  const assinaturas = getAssinaturas(grupo_id);
  const diaVencimento = getConfig('dia_vencimento', '10', grupo_id);
  const modoPagamento = getConfig('modo_pagamento', 'rateio', grupo_id);

  res.json({
    mes,
    total_centavos: total,
    assinaturas,
    dia_vencimento: diaVencimento,
    modo_pagamento: modoPagamento,
    vapid_public: getConfig('vapid_public', '', 1), // Vapid é global (grupo 1)
    membros: comCotas,
    isAdmin
  });
});

// ── API: Super Admin ────────────────────────────────────────────────────────
app.get('/api/superadmin/grupos', (req, res) => {
  const session = getSession(req);
  if (!session || !session.is_superadmin) return res.status(403).json({ erro: 'Não autorizado' });

  const grupos = db.prepare(`
    SELECT g.*, 
           (SELECT COUNT(*) FROM membros m WHERE m.grupo_id = g.id AND m.ativo = 1) as qte_membros 
    FROM grupos g ORDER BY g.id DESC
  `).all();
  
  res.json(grupos);
});

app.delete('/api/superadmin/grupos/:id', (req, res) => {
  const session = getSession(req);
  if (!session || !session.is_superadmin) return res.status(403).json({ erro: 'Não autorizado' });

  const id = req.params.id;
  
  // Apaga dados atrelados ao grupo para manter a integridade (Cascata manual)
  db.prepare('DELETE FROM config WHERE grupo_id=?').run(id);
  db.prepare('DELETE FROM assinaturas WHERE grupo_id=?').run(id);
  db.prepare('DELETE FROM pagamentos WHERE grupo_id=?').run(id);
  db.prepare('DELETE FROM membros WHERE grupo_id=?').run(id);
  
  // Por fim, apaga o grupo
  db.prepare('DELETE FROM grupos WHERE id=?').run(id);

  res.json({ ok: true });
});

// ── API: Admin ──────────────────────────────────────────────────────────────────
app.post('/api/pix', async (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ erro: 'Não autorizado' });

  const { valor_centavos } = req.body;
  if (!Number.isInteger(valor_centavos) || valor_centavos <= 0)
    return res.status(400).json({ erro: 'valor_centavos inválido' });

  const grupo = db.prepare('SELECT pix_key, pix_name, pix_city FROM grupos WHERE id=?').get(session.grupo_id);
  const payload = gerarPix(valor_centavos, grupo || {});
  try {
    const qr_base64 = await QRCode.toDataURL(payload, { width:280, margin:2, color:{dark:'#12122a',light:'#ffffff'} });
    res.json({ payload, qr_base64 });
  } catch { res.status(500).json({ erro: 'Erro ao gerar QR Code' }); }
});

// ── API: Pagamentos ───────────────────────────────────────────────────────────
app.post('/api/pagar', (req, res) => {
  const session = getSession(req);
  if (!session || session.role !== 'admin') return res.status(401).json({ erro: 'Não autorizado' });

  const { membro_id } = req.body;
  const mes = mesAtual();
  const grupo_id = session.grupo_id;
  const row = db.prepare('SELECT id FROM pagamentos WHERE membro_id=? AND mes_referencia=? AND grupo_id=?').get(membro_id, mes, grupo_id);
  if (row) {
    db.prepare('UPDATE pagamentos SET pago=1, data_pagamento=? WHERE id=?').run(new Date().toISOString(), row.id);
  } else {
    db.prepare('INSERT INTO pagamentos (membro_id,mes_referencia,pago,data_pagamento,grupo_id) VALUES(?,?,1,?,?)').run(membro_id, mes, new Date().toISOString(), grupo_id);
  }
  res.json({ ok: true });
});

app.post('/api/despagar', (req, res) => {
  const session = getSession(req);
  if (!session || session.role !== 'admin') return res.status(401).json({ erro: 'Não autorizado' });

  const { membro_id } = req.body;
  const mes = mesAtual();
  const grupo_id = session.grupo_id;
  db.prepare('UPDATE pagamentos SET pago=0, data_pagamento=NULL WHERE membro_id=? AND mes_referencia=? AND grupo_id=?').run(membro_id, mes, grupo_id);
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
  const session = getSession(req);
  if (!session || session.role !== 'admin') return res.status(401).json({ erro: 'Não autorizado' });

  const membros = db.prepare('SELECT id, nome, push_sub FROM membros WHERE ativo=1 AND grupo_id=?').all(session.grupo_id);
  // Pega quem não pagou ainda (ou todos, se precisarmos recalcular)
  const mes = mesAtual();
  const pagamentos = new Set(
    db.prepare('SELECT membro_id FROM pagamentos WHERE mes_referencia=? AND pago=1 AND grupo_id=?').all(mes, session.grupo_id).map(p => p.membro_id)
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
  const session = getSession(req);
  if (!session || session.role !== 'admin') return res.status(401).json({ erro: 'Não autorizado' });

  const { membro_id } = req.body;
  const membro = db.prepare('SELECT * FROM membros WHERE id=? AND grupo_id=?').get(membro_id, session.grupo_id);
  if (!membro || membro.ativo) return res.status(400).json({ erro: 'Slot inválido ou já ocupado' });
  const token = crypto.randomBytes(16).toString('hex');
  db.prepare('UPDATE membros SET convite_token=?, convite_usado=0 WHERE id=? AND grupo_id=?').run(token, membro_id, session.grupo_id);
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

// ── API: Auth (Universal Login) ────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  try {
    const info = await verificarTokenGoogle(req.body.google_id_token);
    let role = null;
    let membroId = null;
    let grupoId = null;

    // Tenta achar se é dono de algum grupo
    const donoGrupo = db.prepare('SELECT id FROM grupos WHERE dono_email=? AND ativo=1').get(info.email);
    if (donoGrupo) {
      role = 'admin';
      grupoId = donoGrupo.id;
    }

    // Se não for dono (ou mesmo se for, se ele estiver logando como membro convidado, ele é membro do grupo que o convidou. Mas por enquanto, se ele é dono, loga como admin).
    if (!role) {
      const membro = db.prepare('SELECT id, grupo_id FROM membros WHERE email=? AND ativo=1').get(info.email);
      if (membro) {
        role = 'member';
        membroId = membro.id;
        grupoId = membro.grupo_id;
      }
    }

    if (!role) {
      return res.status(403).json({ erro: 'Acesso negado. Você não possui grupo cadastrado ou convite.' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const isSuperadmin = (info.email === 'worldkkevin@gmail.com');
    
    sessionTokens.set(token, { role, membro_id: membroId, grupo_id: grupoId, nome: info.name, is_superadmin: isSuperadmin });
    
    res.json({ token, role, nome: info.name, is_superadmin: isSuperadmin });
  } catch (e) {
    res.status(401).json({ erro: 'Login falhou: ' + e.message });
  }
});

app.post('/api/admin/remover', (req, res) => {
  const session = getSession(req);
  if (!session || session.role !== 'admin') return res.status(401).json({ erro: 'Não autorizado' });

  const { membro_id } = req.body;
  db.prepare("UPDATE membros SET ativo=0, nome='Membro ' || id, email=NULL, foto_url=NULL, google_sub=NULL, convite_usado=0 WHERE id=? AND grupo_id=?")
    .run(membro_id, session.grupo_id);
  res.json({ ok: true });
});

app.post('/api/admin/assinaturas', (req, res) => {
  const session = getSession(req);
  if (!session || session.role !== 'admin') return res.status(401).json({ erro: 'Não autorizado' });

  const { id, nome, valor_centavos } = req.body;
  if (!nome || !valor_centavos) return res.status(400).json({ erro: 'Dados inválidos' });

  if (id) {
    db.prepare('UPDATE assinaturas SET nome=?, valor_centavos=? WHERE id=? AND grupo_id=?').run(nome, valor_centavos, id, session.grupo_id);
  } else {
    db.prepare('INSERT INTO assinaturas (nome, valor_centavos, ativo, grupo_id) VALUES (?, ?, 1, ?)').run(nome, valor_centavos, session.grupo_id);
  }
  res.json({ ok: true });
});

app.delete('/api/admin/assinaturas/:id', (req, res) => {
  const session = getSession(req);
  if (!session || session.role !== 'admin') return res.status(401).json({ erro: 'Não autorizado' });

  db.prepare('UPDATE assinaturas SET ativo=0 WHERE id=? AND grupo_id=?').run(req.params.id, session.grupo_id);
  res.json({ ok: true });
});

app.post('/api/admin/config', (req, res) => {
  const session = getSession(req);
  if (!session || session.role !== 'admin') return res.status(401).json({ erro: 'Não autorizado' });

  const { dia_vencimento, modo_pagamento } = req.body;
  
  // Como config tinha PRIMARY KEY na chave, precisamos usar delete + insert para lidar com grupo_id
  const upsert = (k, v) => {
    db.prepare('DELETE FROM config WHERE chave=? AND grupo_id=?').run(k, session.grupo_id);
    db.prepare('INSERT INTO config (chave, valor, grupo_id) VALUES (?, ?, ?)').run(k, v, session.grupo_id);
  };
  
  if (dia_vencimento !== undefined) upsert('dia_vencimento', dia_vencimento);
  if (modo_pagamento !== undefined) upsert('modo_pagamento', modo_pagamento);

  res.json({ ok: true });
});

// ── API: SaaS Onboarding (Simulação de Checkout) ──────────────────────────────
app.post('/api/checkout', (req, res) => {
  try {
    const { nome_grupo, dono_email, pix_key, pix_name, pix_city } = req.body;
    
    if (!nome_grupo || !dono_email || !pix_key || !pix_name || !pix_city) {
      return res.status(400).json({ erro: 'Preencha todos os campos do seu grupo e dados Pix' });
    }

    // Verifica se o e-mail já é dono de algum grupo
    const existe = db.prepare('SELECT id FROM grupos WHERE dono_email=?').get(dono_email);
    if (existe) return res.status(400).json({ erro: 'Este e-mail já possui um grupo' });

    // Cria o grupo
    const ins = db.prepare('INSERT INTO grupos (nome, dono_email, pix_key, pix_name, pix_city, data_criacao) VALUES (?, ?, ?, ?, ?, ?)');
    const info = ins.run(nome_grupo, dono_email, pix_key, pix_name, pix_city, new Date().toISOString());
    const grupoId = info.lastInsertRowid;

    // Insere configurações padrão
    db.prepare('INSERT INTO config (chave, valor, grupo_id) VALUES (?, ?, ?)').run('dia_vencimento', '10', grupoId);
    db.prepare('INSERT INTO config (chave, valor, grupo_id) VALUES (?, ?, ?)').run('modo_pagamento', 'rateio', grupoId);

    // Insere alguns slots vazios de membros para o grupo
    const insMembro = db.prepare('INSERT INTO membros (nome, ativo, grupo_id) VALUES (?, 0, ?)');
    ['Membro 1', 'Membro 2', 'Membro 3', 'Membro 4', 'Membro 5'].forEach(n => insMembro.run(n, grupoId));

    res.json({ ok: true, grupo_id: grupoId });
  } catch (err) {
    console.error("Erro no checkout:", err);
    res.status(500).json({ erro: 'Ocorreu um erro interno: ' + err.message });
  }
});

// ── Rotas do Front-End ────────────────────────────────────────────────────────
app.get('/app', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));

// ── Fallback ──────────────────────────────────────────────────────────────────
app.listen(PORT, () =>
  console.log(`✅  Grupo-FAMIl → ${BASE_URL}  |  mês: ${mesAtual()}`)
);

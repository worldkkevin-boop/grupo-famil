'use strict';

const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');

let sock = null;
let qrCodeBase64 = null;
let connectionStatus = 'disconnected'; // 'disconnected', 'connecting', 'qr_ready', 'connected'
let connectedPhone = null;

const sessionDir = path.join(__dirname, 'whatsapp_session');

async function startWhatsApp(reconnect = false) {
  if (sock && connectionStatus === 'connected' && !reconnect) return;

  connectionStatus = 'connecting';
  qrCodeBase64 = null;

  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] }));

    sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      auth: state,
      browser: ['Grupo FAMIl', 'Chrome', '1.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        if (!msg.message || msg.key.fromMe) continue;
        const remoteJid = msg.key.remoteJid;
        if (!remoteJid || remoteJid.endsWith('@g.us')) continue;

        if (onMessageReceivedCallback) {
          try {
            await onMessageReceivedCallback(msg, remoteJid);
          } catch (e) {
            console.error('Erro no processamento de mensagem recebida:', e);
          }
        }
      }
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          qrCodeBase64 = await QRCode.toDataURL(qr, { width: 260, margin: 2 });
          connectionStatus = 'qr_ready';
          console.log('📱 WhatsApp: QR Code pronto para leitura no painel.');
        } catch (e) {
          console.error('Erro ao gerar QR Code WhatsApp:', e);
        }
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.log(`📱 WhatsApp desconectado (código: ${statusCode || 'n/a'}). Reconectar: ${shouldReconnect}`);
        connectionStatus = 'disconnected';
        qrCodeBase64 = null;
        connectedPhone = null;

        if (shouldReconnect) {
          setTimeout(() => startWhatsApp(true), 5000);
        } else {
          try {
            fs.rmSync(sessionDir, { recursive: true, force: true });
          } catch {}
        }
      } else if (connection === 'open') {
        connectionStatus = 'connected';
        qrCodeBase64 = null;
        connectedPhone = sock.user?.id ? sock.user.id.split(':')[0] : 'Conectado';
        console.log(`✅ WhatsApp conectado com sucesso! Número: ${connectedPhone}`);
      }
    });

  } catch (err) {
    console.error('Erro ao inicializar WhatsApp:', err);
    connectionStatus = 'disconnected';
  }
}

function getWhatsAppStatus() {
  return {
    status: connectionStatus,
    qr_base64: qrCodeBase64,
    phone: connectedPhone
  };
}

async function resolveWhatsAppJid(numero) {
  if (!sock || connectionStatus !== 'connected') {
    throw new Error('WhatsApp não está conectado.');
  }

  let digits = String(numero).replace(/\D/g, '');
  if (!digits) throw new Error('Número de telefone inválido.');

  if (!digits.startsWith('55') && (digits.length === 10 || digits.length === 11)) {
    digits = '55' + digits;
  }

  // Monta candidatos de JID para números do Brasil (55 + DDD + 8 ou 9 dígitos)
  const candidates = [digits];

  if (digits.startsWith('55')) {
    if (digits.length === 13) {
      // Formato com o nono dígito (55 + DDD + 9 + 8 dígitos) -> adiciona alternativa sem o 9 (12 dígitos)
      const sem9 = digits.slice(0, 4) + digits.slice(5);
      candidates.push(sem9);
    } else if (digits.length === 12) {
      // Formato sem o nono dígito (55 + DDD + 8 dígitos) -> adiciona alternativa com o 9 (13 dígitos)
      const com9 = digits.slice(0, 4) + '9' + digits.slice(4);
      candidates.push(com9);
    }
  }

  console.log(`🔍 [WhatsApp] Verificando existência na rede para candidatos:`, candidates);

  // Consulta o WhatsApp server para cada candidato
  for (const cand of candidates) {
    try {
      const results = await sock.onWhatsApp(cand);
      console.log(`[WhatsApp] Consulta onWhatsApp(${cand}):`, JSON.stringify(results));
      if (results && results.length > 0 && results[0].exists) {
        console.log(`✅ [WhatsApp] JID oficial confirmado na rede: ${results[0].jid} (candidato: ${cand})`);
        return results[0].jid;
      }
    } catch (err) {
      console.warn(`⚠️ [WhatsApp] Erro ao consultar onWhatsApp para ${cand}:`, err.message);
    }
  }

  const fallback = `${candidates[0]}@s.whatsapp.net`;
  console.warn(`⚠️ [WhatsApp] Nenhum JID confirmado via onWhatsApp, usando fallback: ${fallback}`);
  return fallback;
}

let onMessageReceivedCallback = null;

function setMessageReceivedCallback(cb) {
  onMessageReceivedCallback = cb;
}

async function sendWhatsAppMessage(numero, texto) {
  if (connectionStatus !== 'connected' || !sock) {
    throw new Error('WhatsApp não está conectado.');
  }

  const targetJid = await resolveWhatsAppJid(numero);
  console.log(`📤 [WhatsApp] Enviando mensagem para: ${targetJid}`);

  const sent = await sock.sendMessage(targetJid, { text: texto });
  console.log(`📬 [WhatsApp] Mensagem despachada com sucesso! ID: ${sent?.key?.id}`);
  return { ok: true, jid: targetJid, keyId: sent?.key?.id };
}

async function sendWhatsAppMessages(numero, textos = []) {
  if (connectionStatus !== 'connected' || !sock) {
    throw new Error('WhatsApp não está conectado.');
  }

  const targetJid = await resolveWhatsAppJid(numero);
  console.log(`📤 [WhatsApp] Enviando sequência de ${textos.length} mensagens para: ${targetJid}`);

  const keys = [];
  for (let i = 0; i < textos.length; i++) {
    const texto = textos[i];
    if (!texto || !String(texto).trim()) continue;
    const sent = await sock.sendMessage(targetJid, { text: String(texto).trim() });
    keys.push(sent?.key?.id);
    if (i < textos.length - 1) {
      await new Promise(r => setTimeout(r, 600)); // Pequena pausa para garantir ordem correta de entrega
    }
  }

  return { ok: true, jid: targetJid, count: keys.length, keys };
}

async function disconnectWhatsApp() {
  try {
    if (sock) {
      await sock.logout().catch(() => {});
      sock = null;
    }
    connectionStatus = 'disconnected';
    qrCodeBase64 = null;
    connectedPhone = null;
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.error('Erro ao desconectar WhatsApp:', err);
  }
}

module.exports = {
  startWhatsApp,
  getWhatsAppStatus,
  sendWhatsAppMessage,
  sendWhatsAppMessages,
  setMessageReceivedCallback,
  disconnectWhatsApp
};

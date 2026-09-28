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

async function sendWhatsAppMessage(numero, texto) {
  if (connectionStatus !== 'connected' || !sock) {
    throw new Error('WhatsApp não está conectado.');
  }

  let digits = String(numero).replace(/\D/g, '');
  if (!digits) throw new Error('Número de telefone inválido.');

  if (!digits.startsWith('55') && digits.length >= 10 && digits.length <= 11) {
    digits = '55' + digits;
  }

  const jid = `${digits}@s.whatsapp.net`;
  await sock.sendMessage(jid, { text: texto });
  return { ok: true, jid };
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
  disconnectWhatsApp
};

'use strict';

const $ = id => document.getElementById(id);
const token = location.pathname.split('/').pop();
let googleClientId  = '';
let deferredPrompt  = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
});

// ── Trocar de state ───────────────────────────────────────────────────────────
function showState(id) {
  document.querySelectorAll('.state').forEach(el => el.classList.remove('active'));
  $(id).classList.add('active');
}

// ── Aguardar Google GSI carregar ──────────────────────────────────────────────
function waitForGoogle(ms = 6000) {
  return new Promise(resolve => {
    if (window.google?.accounts) { resolve(true); return; }
    const start = Date.now();
    const check = setInterval(() => {
      if (window.google?.accounts) { clearInterval(check); resolve(true); }
      else if (Date.now() - start > ms) { clearInterval(check); resolve(false); }
    }, 100);
  });
}

// ── Renderizar botão Google ───────────────────────────────────────────────────
async function renderGoogleBtn() {
  const loaded = await waitForGoogle();
  if (!loaded || !googleClientId) {
    // Sem GSI ou sem Client ID → form manual
    $('google-btn-wrap').classList.add('hidden');
    $('convite-form').classList.remove('hidden');
    setupManualForm();
    return;
  }

  google.accounts.id.initialize({
    client_id:   googleClientId,
    callback:    handleGoogleCredential,
    auto_select: false,
    context:     'signin',
  });

  google.accounts.id.renderButton($('g-signin-btn'), {
    theme:  'filled_dark',
    size:   'large',
    shape:  'pill',
    text:   'signin_with',
    locale: 'pt-BR',
    width:  Math.min(window.innerWidth - 80, 300),
  });
}

// ── Callback do Google Sign-In ────────────────────────────────────────────────
async function handleGoogleCredential(response) {
  showState('state-processing');

  try {
    const res  = await fetch('/api/convite/aceitar', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token, google_id_token: response.credential }),
    });
    const data = await res.json();

    if (!res.ok || data.erro) {
      showState('state-form');
      alert(data.erro || 'Erro ao entrar no grupo. Tente novamente.');
      return;
    }

    localStorage.setItem('meuMembroId', data.membro_id);
    showSuccess(data.nome, data.foto_url);
    askForPush();
  } catch {
    showState('state-form');
    alert('Erro de conexão. Tente novamente.');
  }
}

// ── Formulário manual (fallback) ──────────────────────────────────────────────
function setupManualForm() {
  $('convite-form').addEventListener('submit', async e => {
    e.preventDefault();
    const nome  = $('input-nome').value.trim();
    const email = $('input-email').value.trim();
    const senha = $('input-senha').value.trim();
    const err   = $('form-error');

    err.classList.add('hidden');
    if (!nome)  { err.textContent = 'Informe seu nome.'; err.classList.remove('hidden'); return; }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      err.textContent = 'Informe um e-mail válido.'; err.classList.remove('hidden'); return;
    }
    if (senha.length < 6) {
      err.textContent = 'A senha deve ter no mínimo 6 caracteres.'; err.classList.remove('hidden'); return;
    }

    $('btn-submit').disabled    = true;
    $('btn-submit').textContent = 'Confirmando...';
    showState('state-processing');

    try {
      const res = await fetch('/api/convite/aceitar', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token, nome, email, senha }),
      });
      const data = await res.json();

      if (!res.ok || data.erro) {
        showState('state-form');
        $('form-error').textContent = data.erro || 'Erro ao entrar.';
        $('form-error').classList.remove('hidden');
        $('btn-submit').disabled    = false;
        $('btn-submit').textContent = 'Entrar no grupo →';
        return;
      }
      localStorage.setItem('meuMembroId', data.membro_id);
      showSuccess(data.nome, null);
      askForPush();
    } catch {
      showState('state-form');
      $('btn-submit').disabled    = false;
      $('btn-submit').textContent = 'Entrar no grupo →';
    }
  });
}

// ── Exibir sucesso ────────────────────────────────────────────────────────────
function showSuccess(nome, fotoUrl) {
  $('success-name').textContent = `Bem-vindo(a), ${nome}!`;

  if (fotoUrl) {
    const img   = $('success-photo');
    img.src     = fotoUrl;
    img.classList.remove('hidden');
    $('success-emoji').classList.add('hidden');
  }

  showState('state-success');
  setupInstallUI();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

// ── Notificações Push ─────────────────────────────────────────────────────────
async function askForPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return;

  const sw = await navigator.serviceWorker.ready;
  const res = await fetch('/api/config');
  const { vapid_public } = await res.json();
  if (!vapid_public) return;

  const sub = await sw.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: vapid_public
  });

  const membro_id = localStorage.getItem('meuMembroId');
  if (membro_id) {
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ membro_id, sub })
    });
  }
}

// ── UI de instalação ──────────────────────────────────────────────────────────
function setupInstallUI() {
  const isIOS        = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isStandalone = window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;

  if (isStandalone) { $('install-done').classList.remove('hidden'); return; }

  if (isIOS) { $('install-ios').classList.remove('hidden'); return; }

  if (deferredPrompt) {
    $('install-android').classList.remove('hidden');
    $('btn-install-pwa').addEventListener('click', async () => {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      $('install-android').innerHTML =
        outcome === 'accepted'
          ? '<p style="font-size:.82rem;color:#10b981;text-align:center">✅ App instalado!</p>'
          : '<p style="font-size:.82rem;color:var(--text-muted);text-align:center">Pode instalar depois pelo menu do browser.</p>';
    });
    return;
  }

  $('install-done').classList.remove('hidden');
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  if (!token || token === 'convite') {
    showState('state-invalid');
    return;
  }

  try {
    // Buscar config e validar convite em paralelo
    const [configRes, conviteRes] = await Promise.all([
      fetch('/api/config'),
      fetch(`/api/convite/${token}`),
    ]);

    const config  = await configRes.json();
    const convite = await conviteRes.json();

    googleClientId = config.google_client_id || '';

    if (!conviteRes.ok || convite.erro) {
      $('error-detail').textContent = convite.erro || 'Convite inválido.';
      showState('state-invalid');
      return;
    }
    if (convite.usado) {
      $('error-detail').textContent = 'Este convite já foi usado. Peça um novo ao administrador.';
      showState('state-invalid');
      return;
    }

    showState('state-form');
    renderGoogleBtn(); // não aguarda — renderiza em paralelo
  } catch {
    $('error-detail').textContent = 'Erro de conexão. Tente novamente.';
    showState('state-invalid');
  }
}

init();

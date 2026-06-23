'use strict';

// ── Helpers ───────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const token = location.pathname.split('/').pop();

function showState(id) {
  document.querySelectorAll('.state').forEach(el => el.classList.remove('active'));
  $(id).classList.add('active');
}

// ── PWA Install ───────────────────────────────────────────────────────────────
let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
});

function setupInstallUI() {
  const isIOS        = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isAndroid    = /Android/i.test(navigator.userAgent);
  const isStandalone = window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;

  if (isStandalone) {
    $('install-done').classList.remove('hidden');
    return;
  }

  if (isIOS) {
    $('install-ios').classList.remove('hidden');
    return;
  }

  if (deferredPrompt || isAndroid) {
    $('install-android').classList.remove('hidden');
    $('btn-install-pwa').addEventListener('click', async () => {
      if (!deferredPrompt) {
        // Android sem prompt ainda — mostra instrução
        $('install-android').innerHTML = '<p style="font-size:.85rem;color:var(--text-muted)">Abra o menu do Chrome (⋮) e toque em <strong>"Adicionar à tela inicial"</strong>.</p>';
        return;
      }
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      $('install-android').innerHTML = '<p style="font-size:.85rem;color:#10b981;text-align:center">✅ App instalado! Procure pelo ícone FAMIl na sua tela.</p>';
    });
    return;
  }

  // Desktop ou outro
  $('install-done').classList.remove('hidden');
}

// ── Validar token ─────────────────────────────────────────────────────────────
async function init() {
  if (!token || token === 'convite') {
    showState('state-invalid');
    return;
  }

  try {
    const res  = await fetch(`/api/convite/${token}`);
    const data = await res.json();

    if (!res.ok || data.erro) {
      $('error-detail').textContent = data.erro || 'Convite inválido ou expirado.';
      showState('state-invalid');
      return;
    }

    if (data.usado) {
      $('error-detail').textContent = 'Este convite já foi usado. Peça um novo ao administrador.';
      showState('state-invalid');
      return;
    }

    showState('state-form');
  } catch {
    $('error-detail').textContent = 'Erro de conexão. Tente novamente.';
    showState('state-invalid');
  }
}

// ── Submeter formulário ───────────────────────────────────────────────────────
$('convite-form').addEventListener('submit', async e => {
  e.preventDefault();
  const nome  = $('input-nome').value.trim();
  const email = $('input-email').value.trim();
  const errEl = $('form-error');

  errEl.classList.add('hidden');
  errEl.textContent = '';

  if (!nome) {
    errEl.textContent = 'Informe seu nome.';
    errEl.classList.remove('hidden');
    $('input-nome').classList.add('error');
    $('input-nome').focus();
    return;
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errEl.textContent = 'Informe um e-mail válido.';
    errEl.classList.remove('hidden');
    $('input-email').classList.add('error');
    $('input-email').focus();
    return;
  }

  const btn = $('btn-submit');
  btn.disabled = true;
  btn.textContent = 'Entrando...';

  try {
    const res  = await fetch('/api/convite/aceitar', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token, nome, email }),
    });
    const data = await res.json();

    if (!res.ok || data.erro) {
      errEl.textContent = data.erro || 'Erro ao entrar no grupo.';
      errEl.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Entrar no grupo →';
      return;
    }

    // Sucesso!
    $('success-name').textContent = `Bem-vindo(a), ${data.nome}!`;
    $('btn-go-dashboard').href = '/';
    showState('state-success');
    setupInstallUI();

    // Registrar SW
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

  } catch {
    errEl.textContent = 'Erro de conexão. Tente novamente.';
    errEl.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Entrar no grupo →';
  }
});

// Limpar erro ao digitar
['input-nome', 'input-email'].forEach(id => {
  $(id)?.addEventListener('input', () => $(id).classList.remove('error'));
});

// ── Init ──────────────────────────────────────────────────────────────────────
init();

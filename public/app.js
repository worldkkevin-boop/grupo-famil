'use strict';

// ── Formatadores ─────────────────────────────────────────────────────────────
const fmt = centavos =>
  (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const mesLabel = mes => {
  const [ano, m] = mes.split('-');
  const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                 'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  return `${MESES[parseInt(m, 10) - 1]} ${ano}`;
};

// ── Estado ────────────────────────────────────────────────────────────────────
let state = { membros: [], mes: '', total: 0, selectedMembro: null };

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── Service Worker ────────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () =>
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  );
}

// ── PWA Install prompt ────────────────────────────────────────────────────────
let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  if (!sessionStorage.getItem('install-dismissed')) {
    setTimeout(() => $('install-banner')?.classList.add('visible'), 4000);
  }
});

window.addEventListener('appinstalled', () => {
  $('install-banner')?.classList.remove('visible');
  deferredPrompt = null;
});

$('btn-install')?.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $('install-banner').classList.remove('visible');
});

$('install-dismiss')?.addEventListener('click', () => {
  $('install-banner').classList.remove('visible');
  sessionStorage.setItem('install-dismissed', '1');
});

// ── Carregar status ───────────────────────────────────────────────────────────
async function loadStatus() {
  try {
    const data = await fetch('/api/status').then(r => r.json());
    state.membros = data.membros;
    state.mes     = data.mes;
    state.total   = data.total_centavos;
    render(data);
  } catch (err) {
    console.error('Erro ao carregar status:', err);
  }
}

// ── Render ────────────────────────────────────────────────────────────────────
function render(data) {
  $('mes-ref').textContent   = mesLabel(data.mes);
  $('total-val').textContent = fmt(data.total_centavos);

  const ativos = data.membros.filter(m => m.ativo);
  const pagos  = ativos.filter(m => m.pago);
  const pct    = ativos.length ? Math.round(pagos.length / ativos.length * 100) : 0;

  $('progress-text').textContent   = `${pagos.length} de ${ativos.length} pagaram`;
  $('progress-percent').textContent = `${pct}%`;
  $('progress-fill').style.width    = `${pct}%`;
  $('progress-fill').parentElement.setAttribute('aria-valuenow', pct);

  $('subscriptions-list').innerHTML = data.assinaturas.map(a => `
    <span class="sub-chip"><span>${a.nome}</span><strong>${fmt(a.valor)}</strong></span>
  `).join('');

  $('members-grid').innerHTML = data.membros.map(buildCard).join('');
}

// ── Construir card ────────────────────────────────────────────────────────────
function buildCard(m) {
  const isPaid   = Boolean(m.pago);
  const isActive = Boolean(m.ativo);

  // Slot vazio
  if (!isActive) {
    return `
      <div class="member-card slot-vazio" id="card-${m.id}">
        <div class="card-top">
          <div class="member-avatar slot-avatar" aria-hidden="true">＋</div>
          <div class="member-info">
            <span class="member-name slot-label">Slot disponível</span>
            <span class="slot-sub">Nenhum membro ainda</span>
          </div>
        </div>
        <button class="btn-convidar" data-action="convidar" data-membro-id="${m.id}" aria-label="Convidar membro para este slot">
          🔗 Convidar
        </button>
      </div>`;
  }

  // Membro ativo
  const hue     = (m.id * 47) % 360;
  const classes = ['member-card', isPaid ? 'paid' : ''].filter(Boolean).join(' ');

  // Avatar: foto Google ou inicial
  const avatarHtml = m.foto_url
    ? `<img src="${m.foto_url}" alt="${m.nome}" class="member-photo" loading="lazy" />`
    : `<div class="member-avatar" style="--hue:${hue}" aria-hidden="true">${m.nome.charAt(0).toUpperCase()}</div>`;

  const actionBtn = !isPaid
    ? `<button class="btn-pix" data-action="pix" data-membro-id="${m.id}" aria-label="Gerar Pix para ${m.nome}">
         <span aria-hidden="true">⚡</span> Gerar Pix
       </button>`
    : `<button class="btn-unpay" data-action="despagar" data-membro-id="${m.id}" aria-label="Desfazer pagamento de ${m.nome}">
         Desfazer pagamento
       </button>`;

  return `
    <div class="${classes}" id="card-${m.id}">
      <div class="card-top">
        ${avatarHtml}
        <div class="member-info">
          <span class="member-name">${m.nome}</span>
          ${isPaid ? '<span class="paid-badge">✓ Pago</span>' : ''}
        </div>
      </div>
      <div class="member-cota" aria-label="Cota de ${m.nome}: ${fmt(m.cota)}">${fmt(m.cota)}</div>
      ${actionBtn}
    </div>`;
}

// ── Delegação de eventos no grid ──────────────────────────────────────────────
$('members-grid').addEventListener('click', e => {
  const pix     = e.target.closest('[data-action="pix"]');
  const unpay   = e.target.closest('[data-action="despagar"]');
  const convite = e.target.closest('[data-action="convidar"]');

  if (pix) {
    const m = state.membros.find(m => m.id === parseInt(pix.dataset.membroId, 10));
    if (m) openPixModal(m);
  }
  if (unpay)   despagar(parseInt(unpay.dataset.membroId, 10));
  if (convite) gerarConvite(parseInt(convite.dataset.membroId, 10));
});

// ── Modal Pix ─────────────────────────────────────────────────────────────────
async function openPixModal(membro) {
  state.selectedMembro = membro;
  $('modal-member-name').textContent  = membro.nome;
  $('modal-amount').textContent       = fmt(membro.cota);
  $('qr-loading').classList.remove('hidden');
  $('qr-img').classList.add('hidden');
  $('qr-img').src = '';
  $('pix-code').value = '';
  $('btn-copy').textContent = 'Copiar';
  $('btn-copy').classList.remove('copied');
  openModal('modal-overlay');

  try {
    const res  = await fetch('/api/pix', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ valor_centavos: membro.cota }),
    });
    const data = await res.json();
    $('qr-loading').classList.add('hidden');
    $('qr-img').src = data.qr_base64;
    $('qr-img').classList.remove('hidden');
    $('pix-code').value = data.payload;
  } catch {
    $('qr-loading').innerHTML = '<p style="color:#555">Erro ao gerar QR Code 😕</p>';
  }
}

// ── Modal Convite ─────────────────────────────────────────────────────────────
async function gerarConvite(membro_id) {
  const btn = document.querySelector(`[data-action="convidar"][data-membro-id="${membro_id}"]`);
  if (btn) { btn.disabled = true; btn.textContent = 'Gerando...'; }

  try {
    const res  = await fetch('/api/convite/gerar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ membro_id }),
    });
    const data = await res.json();

    if (btn) { btn.disabled = false; btn.innerHTML = '🔗 Convidar'; }

    if (data.link) {
      $('invite-link-input').value = data.link;
      const waText = encodeURIComponent(`Você foi convidado para o Grupo FAMIl! Acesse: ${data.link}`);
      $('btn-whatsapp').href = `https://api.whatsapp.com/send?text=${waText}`;
      $('btn-copy-invite').textContent = 'Copiar';
      $('btn-copy-invite').classList.remove('copied');
      openModal('invite-overlay');
    }
  } catch {
    if (btn) { btn.disabled = false; btn.innerHTML = '🔗 Convidar'; }
  }
}

// ── Copiar Pix ────────────────────────────────────────────────────────────────
async function copyText(inputId, btnId) {
  const val = $(inputId).value;
  if (!val) return;
  try {
    await navigator.clipboard.writeText(val);
  } catch {
    $(inputId).select();
    document.execCommand('copy');
  }
  const btn = $(btnId);
  btn.textContent = '✓ Copiado!';
  btn.classList.add('copied');
  setTimeout(() => { btn.textContent = 'Copiar'; btn.classList.remove('copied'); }, 2500);
}

$('btn-copy').addEventListener('click', () => copyText('pix-code', 'btn-copy'));
$('btn-copy-invite').addEventListener('click', () => copyText('invite-link-input', 'btn-copy-invite'));

// ── Marcar pago ───────────────────────────────────────────────────────────────
async function markPaid() {
  if (!state.selectedMembro) return;
  await fetch('/api/pagar', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ membro_id: state.selectedMembro.id }),
  });
  closeModal('modal-overlay');
  await loadStatus();
}

async function despagar(membro_id) {
  const m = state.membros.find(m => m.id === membro_id);
  if (!confirm(`Desfazer pagamento de ${m?.nome ?? 'membro'}?`)) return;
  await fetch('/api/despagar', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ membro_id }),
  });
  await loadStatus();
}

// ── Modal helpers ─────────────────────────────────────────────────────────────
function openModal(id) {
  $(id).classList.add('active');
  document.body.style.overflow = 'hidden';
}
function closeModal(id) {
  $(id).classList.remove('active');
  document.body.style.overflow = '';
  if (id === 'modal-overlay') state.selectedMembro = null;
}

$('modal-close').addEventListener('click', () => closeModal('modal-overlay'));
$('invite-close').addEventListener('click', () => closeModal('invite-overlay'));
$('btn-mark-paid').addEventListener('click', markPaid);

['modal-overlay', 'invite-overlay'].forEach(id =>
  $(id).addEventListener('click', e => { if (e.target === $(id)) closeModal(id); })
);

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if ($('modal-overlay').classList.contains('active'))  closeModal('modal-overlay');
  if ($('invite-overlay').classList.contains('active')) closeModal('invite-overlay');
});

// ── Init ──────────────────────────────────────────────────────────────────────
loadStatus();
setInterval(loadStatus, 30_000);

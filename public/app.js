'use strict';

// ── Formatadores ─────────────────────────────────────────────────────────────
const fmt = (centavos) =>
  (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const mesLabel = (mes) => {
  const [ano, m] = mes.split('-');
  const MESES = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
  ];
  return `${MESES[parseInt(m, 10) - 1]} ${ano}`;
};

// ── Estado global ─────────────────────────────────────────────────────────────
let state = { membros: [], mes: '', total: 0, selectedMembro: null };

// ── Referências DOM ───────────────────────────────────────────────────────────
const $  = (id) => document.getElementById(id);
const elMesRef         = $('mes-ref');
const elTotalVal       = $('total-val');
const elProgressText   = $('progress-text');
const elProgressPct    = $('progress-percent');
const elProgressFill   = $('progress-fill');
const elProgressBar    = elProgressFill.parentElement;
const elSubsList       = $('subscriptions-list');
const elGrid           = $('members-grid');
const elModalOverlay   = $('modal-overlay');
const elModalName      = $('modal-member-name');
const elModalAmount    = $('modal-amount');
const elQrLoading      = $('qr-loading');
const elQrImg          = $('qr-img');
const elPixCode        = $('pix-code');
const elBtnCopy        = $('btn-copy');
const elBtnMarkPaid    = $('btn-mark-paid');
const elBtnModalClose  = $('modal-close');

// ── Carregar status da API ────────────────────────────────────────────────────
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

// ── Renderização principal ────────────────────────────────────────────────────
function render(data) {
  // Header
  elMesRef.textContent  = mesLabel(data.mes);
  elTotalVal.textContent = fmt(data.total_centavos);

  // Progresso
  const ativos = data.membros.filter(m => m.ativo);
  const pagos  = ativos.filter(m => m.pago);
  const pct    = ativos.length ? Math.round((pagos.length / ativos.length) * 100) : 0;

  elProgressText.textContent = `${pagos.length} de ${ativos.length} pagaram`;
  elProgressPct.textContent  = `${pct}%`;
  elProgressFill.style.width = `${pct}%`;
  elProgressBar.setAttribute('aria-valuenow', pct);

  // Chips de assinaturas
  elSubsList.innerHTML = data.assinaturas.map(a => `
    <span class="sub-chip">
      <span>${a.nome}</span>
      <strong>${fmt(a.valor)}</strong>
    </span>
  `).join('');

  // Cards de membros
  elGrid.innerHTML = data.membros.map(m => buildCard(m)).join('');
}

function buildCard(m) {
  const initials = m.nome.charAt(0).toUpperCase();
  const hue      = (m.id * 47) % 360;
  const isPaid   = Boolean(m.pago);
  const isActive = Boolean(m.ativo);

  const classes = ['member-card', isPaid ? 'paid' : '', !isActive ? 'inactive' : '']
    .filter(Boolean).join(' ');

  const actionBtn = isActive && !isPaid
    ? `<button class="btn-pix" data-action="pix" data-membro-id="${m.id}" aria-label="Gerar Pix para ${m.nome}">
         <span aria-hidden="true">⚡</span> Gerar Pix
       </button>`
    : isPaid
    ? `<button class="btn-unpay" data-action="despagar" data-membro-id="${m.id}" aria-label="Desfazer pagamento de ${m.nome}">
         Desfazer pagamento
       </button>`
    : '';

  return `
    <div class="${classes}" id="card-${m.id}">
      <div class="card-top">
        <div class="member-avatar" style="--hue: ${hue}" aria-hidden="true">
          ${initials}
        </div>
        <div class="member-info">
          <span class="member-name">${m.nome}</span>
          ${isPaid ? '<span class="paid-badge">✓ Pago</span>' : ''}
        </div>
      </div>
      <div class="member-cota" aria-label="Cota de ${m.nome}: ${fmt(m.cota)}">
        ${fmt(m.cota)}
      </div>
      ${actionBtn}
    </div>
  `;
}

// ── Delegação de eventos no grid ──────────────────────────────────────────────
elGrid.addEventListener('click', (e) => {
  const pixBtn    = e.target.closest('[data-action="pix"]');
  const unpayBtn  = e.target.closest('[data-action="despagar"]');

  if (pixBtn) {
    const id = parseInt(pixBtn.dataset.membroId, 10);
    const membro = state.membros.find(m => m.id === id);
    if (membro) openPixModal(membro);
  }

  if (unpayBtn) {
    const id = parseInt(unpayBtn.dataset.membroId, 10);
    despagar(id);
  }
});

// ── Modal Pix ─────────────────────────────────────────────────────────────────
async function openPixModal(membro) {
  state.selectedMembro = membro;

  // Resetar modal
  elModalName.textContent    = membro.nome;
  elModalAmount.textContent  = fmt(membro.cota);
  elQrLoading.classList.remove('hidden');
  elQrImg.classList.add('hidden');
  elQrImg.src = '';
  elPixCode.value = '';
  elBtnCopy.textContent = 'Copiar';
  elBtnCopy.classList.remove('copied');

  elModalOverlay.classList.add('active');
  document.body.style.overflow = 'hidden';

  // Buscar QR Code
  try {
    const res  = await fetch('/api/pix', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ valor_centavos: membro.cota }),
    });
    const data = await res.json();

    elQrLoading.classList.add('hidden');
    elQrImg.src = data.qr_base64;
    elQrImg.classList.remove('hidden');
    elPixCode.value = data.payload;
  } catch {
    elQrLoading.innerHTML = '<p style="color:#555">Erro ao gerar QR Code 😕</p>';
  }
}

function closeModal() {
  elModalOverlay.classList.remove('active');
  document.body.style.overflow = '';
  state.selectedMembro = null;
}

// ── Copiar código Pix ─────────────────────────────────────────────────────────
async function copyPixCode() {
  const code = elPixCode.value;
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
  } catch {
    // Fallback para iOS < 13.4
    elPixCode.select();
    document.execCommand('copy');
  }
  elBtnCopy.textContent = '✓ Copiado!';
  elBtnCopy.classList.add('copied');
  setTimeout(() => {
    elBtnCopy.textContent = 'Copiar';
    elBtnCopy.classList.remove('copied');
  }, 2500);
}

// ── Marcar como pago ──────────────────────────────────────────────────────────
async function markPaid() {
  if (!state.selectedMembro) return;
  try {
    await fetch('/api/pagar', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ membro_id: state.selectedMembro.id }),
    });
    closeModal();
    await loadStatus();
  } catch (err) {
    console.error('Erro ao marcar como pago:', err);
  }
}

// ── Desfazer pagamento ────────────────────────────────────────────────────────
async function despagar(membro_id) {
  const membro = state.membros.find(m => m.id === membro_id);
  if (!confirm(`Desfazer pagamento de ${membro?.nome ?? 'membro'}?`)) return;
  try {
    await fetch('/api/despagar', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ membro_id }),
    });
    await loadStatus();
  } catch (err) {
    console.error('Erro ao desfazer pagamento:', err);
  }
}

// ── Eventos ───────────────────────────────────────────────────────────────────
elBtnModalClose.addEventListener('click', closeModal);
elBtnCopy.addEventListener('click', copyPixCode);
elBtnMarkPaid.addEventListener('click', markPaid);

// Fechar modal ao clicar no overlay
elModalOverlay.addEventListener('click', (e) => {
  if (e.target === elModalOverlay) closeModal();
});

// Fechar modal com Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && elModalOverlay.classList.contains('active')) closeModal();
});

// ── Init ──────────────────────────────────────────────────────────────────────
loadStatus();
setInterval(loadStatus, 30_000); // Atualiza a cada 30 segundos

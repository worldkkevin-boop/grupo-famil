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
let state = { membros: [], mes: '', total: 0, selectedMembro: null, isAdmin: false };
const getAuthHeaders = () => {
  const token = localStorage.getItem('userToken');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
};

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── Service Worker ────────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () =>
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  );
}

// ── PWA Strict Blocker ──────────────────────────────────────────────────────
let deferredPrompt = null;

function checkStandalone() {
  // Ignora o bloqueio se for o admin logado acessando pelo PC para gerenciar, ou se já estiver standalone
  // Na verdade, a regra pediu obrigatoriedade, vamos aplicar a todos:
  const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  
  if (!isStandalone) {
    $('pwa-strict-blocker').classList.remove('hidden');
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    if (isIOS) {
      $('pwa-blocker-ios').classList.remove('hidden');
      $('pwa-blocker-android').classList.add('hidden');
    } else {
      $('pwa-blocker-android').classList.remove('hidden');
      $('pwa-blocker-ios').classList.add('hidden');
    }
  } else {
    $('pwa-strict-blocker').classList.add('hidden');
  }
}

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  checkStandalone(); // Re-avalia
});

$('btn-strict-install')?.addEventListener('click', async () => {
  if (!deferredPrompt) {
    alert('A instalação não está disponível ou já foi concluída. Tente abrir pelo menu do navegador (Adicionar à Tela Inicial).');
    return;
  }
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
});

// Checa no carregamento e se a tela mudar de modo
window.addEventListener('DOMContentLoaded', checkStandalone);
window.matchMedia('(display-mode: standalone)').addEventListener('change', checkStandalone);

// ── Universal Login ───────────────────────────────────────────────────────────
let gsiInitialized = false;
async function initGoogleSignIn() {
  if (gsiInitialized) return;
  try {
    const res = await fetch('/api/config');
    const { google_client_id } = await res.json();
    if (google_client_id && window.google) {
      google.accounts.id.initialize({
        client_id: google_client_id,
        callback: window.handleUniversalLogin,
      });
      google.accounts.id.renderButton($('universal-gsi-btn'), {
        theme: 'filled_dark', size: 'large', shape: 'pill'
      });
      gsiInitialized = true;
    }
  } catch (err) { console.error('Erro GSI:', err); }
}

window.handleUniversalLogin = async (response) => {
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ google_id_token: response.credential })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.erro || 'Falha no login');

    localStorage.setItem('userToken', data.token);
    localStorage.setItem('userRole', data.role);
    localStorage.setItem('isSuperadmin', data.is_superadmin ? 'true' : 'false');
    $('login-error').classList.add('hidden');
    loadStatus();
  } catch (err) {
    $('login-error').textContent = err.message;
    $('login-error').classList.remove('hidden');
  }
};

async function fazerLoginEmail() {
  const email = $('login-email').value.trim();
  const senha = $('login-senha').value.trim();
  if (!email || !senha) return;

  const btn = event.target;
  const oldText = btn.textContent;
  btn.textContent = 'Carregando...';
  btn.disabled = true;

  try {
    const res = await fetch('/api/login/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, senha })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.erro || 'Falha no login');

    localStorage.setItem('userToken', data.token);
    localStorage.setItem('userRole', data.role);
    localStorage.setItem('isSuperadmin', data.is_superadmin ? 'true' : 'false');
    $('login-error').classList.add('hidden');
    loadStatus();
  } catch (err) {
    $('login-error').textContent = err.message;
    $('login-error').classList.remove('hidden');
  } finally {
    btn.textContent = oldText;
    btn.disabled = false;
  }
}

$('btn-logout')?.addEventListener('click', () => {
  localStorage.removeItem('userToken');
  localStorage.removeItem('userRole');
  loadStatus();
});

// ── Carregar status ───────────────────────────────────────────────────────────
async function loadStatus() {
  try {
    const res = await fetch('/api/status', { headers: getAuthHeaders() });
    const data = await res.json();
    
    if (res.status === 401 || data.loggedIn === false) {
      localStorage.removeItem('userToken');
      localStorage.removeItem('userRole');
      $('login-view').classList.remove('hidden');
      $('dashboard-view').classList.add('hidden');
      initGoogleSignIn();
      return;
    }
    
    if (data.saas_bloqueado) {
      $('login-view').classList.add('hidden');
      $('dashboard-view').classList.add('hidden');
      if (data.isAdmin) {
        $('saas-billing-info').classList.remove('hidden');
      } else {
        $('saas-billing-info').classList.add('hidden');
      }
      $('saas-blocked-view').classList.remove('hidden');
      return;
    }
    
    $('login-view').classList.add('hidden');
    $('saas-blocked-view').classList.add('hidden');
    $('dashboard-view').classList.remove('hidden');



    state.membros = data.membros;
    state.mes     = data.mes;
    state.total   = data.total_centavos;
    state.isAdmin = data.isAdmin || false;
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

  if (state.isAdmin) {
    $('btn-admin-panel').classList.remove('hidden');

    // Popular configs
    $('config-dia-vencimento').value = data.dia_vencimento || 10;
    
    // Select de pagador
    let opts = `<option value="rateio" ${data.modo_pagamento === 'rateio' ? 'selected' : ''}>Todos (Rateio)</option>`;
    ativos.forEach(m => {
      opts += `<option value="${m.id}" ${String(data.modo_pagamento) === String(m.id) ? 'selected' : ''}>${m.nome} paga tudo</option>`;
    });
    $('config-modo-pagamento').innerHTML = opts;

    // Lista de assinaturas
    $('admin-assinaturas-list').innerHTML = data.assinaturas.map(a => `
      <li style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.05); padding:8px 12px; border-radius:8px;">
        <span style="font-size:0.85rem; color:var(--text);">${a.nome} - <strong style="color:var(--primary);">${fmt(a.valor)}</strong></span>
        <button class="btn-del-assinatura" data-id="${a.id}" style="background:none; border:none; color:var(--danger); cursor:pointer;">🗑️</button>
      </li>
    `).join('');
  }
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

  let actionBtn = '';
  if (!isPaid) {
    if (state.isAdmin) {
      actionBtn = `
        <button class="btn-pix" data-action="cobrar" data-membro-id="${m.id}" style="background:var(--secondary); font-size: 0.8rem; padding: 10px 5px;" aria-label="Cobrar ${m.nome}">
          💬 Cobrar
        </button>
        <button class="btn-pix" data-action="marcar-pago" data-membro-id="${m.id}" style="background:var(--success); font-size: 0.8rem; padding: 10px 5px;" aria-label="Marcar pago">
          ✓ Pago
        </button>
      `;
    } else {
      actionBtn = `
        <button class="btn-pix" data-action="pix" data-membro-id="${m.id}" aria-label="Gerar Pix para ${m.nome}">
          <span aria-hidden="true">⚡</span> Gerar Pix
        </button>
      `;
    }
  } else {
    actionBtn = state.isAdmin 
      ? `<button class="btn-unpay" data-action="despagar" data-membro-id="${m.id}" aria-label="Desfazer pagamento de ${m.nome}">
           Desfazer pagamento
         </button>` 
      : `<div style="flex:1;text-align:center;color:var(--success);font-weight:600;padding:10px;border:1px dashed var(--success);border-radius:var(--radius-sm);">✅ Já Pago</div>`;
  }

  const adminBtn = state.isAdmin ? `
    <button class="btn-remove" data-action="remover" data-membro-id="${m.id}" aria-label="Remover ${m.nome}">
      ❌ Remover
    </button>` : '';

  return `
    <div class="${classes}" id="card-${m.id}">
      <div class="card-top">
        ${avatarHtml}
        <div class="member-info">
          <span class="member-name">${m.nome}</span>
          ${state.isAdmin && m.email ? `<span style="font-size:0.65rem;color:var(--text-muted);user-select:all;">${m.email}</span>` : ''}
          ${isPaid ? '<span class="paid-badge">✓ Pago</span>' : ''}
        </div>
      </div>
      <div class="member-cota" aria-label="Cota de ${m.nome}: ${fmt(m.cota)}">${fmt(m.cota)}</div>
      <div style="display:flex;gap:8px;">${actionBtn}${adminBtn}</div>
    </div>`;
}

// ── Delegação de eventos no grid ──────────────────────────────────────────────
$('members-grid').addEventListener('click', async e => {
  const pix        = e.target.closest('[data-action="pix"]');
  const cobrar     = e.target.closest('[data-action="cobrar"]');
  const marcarPago = e.target.closest('[data-action="marcar-pago"]');
  const unpay      = e.target.closest('[data-action="despagar"]');
  const convite    = e.target.closest('[data-action="convidar"]');
  const remover    = e.target.closest('[data-action="remover"]');

  if (pix) {
    const m = state.membros.find(m => m.id === parseInt(pix.dataset.membroId, 10));
    if (m) openPixModal(m);
  }
  
  if (marcarPago) {
    setPago(parseInt(marcarPago.dataset.membroId, 10));
  }
  
  if (cobrar) {
    const id = parseInt(cobrar.dataset.membroId, 10);
    const m = state.membros.find(x => x.id === id);
    if (!m) return;
    
    cobrar.disabled = true;
    cobrar.textContent = 'Gerando...';
    
    try {
      const res = await fetch('/api/pix', {
        method: 'POST', headers: getAuthHeaders(),
        body: JSON.stringify({ valor_centavos: m.cota }),
      });
      const data = await res.json();
      if (!data.payload) throw new Error('Erro ao gerar Pix');
      
      const msg = `Oi ${m.nome}! A sua parte da assinatura familiar (R$ ${fmt(m.cota)}) já fechou neste mês.\n\nPix Copia e Cola:\n${data.payload}`;
      const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
      window.open(url, '_blank');
      
      cobrar.textContent = '💬 Cobrar';
      cobrar.disabled = false;
    } catch (err) {
      alert('Erro ao gerar cobrança: ' + err.message);
      cobrar.textContent = '💬 Cobrar';
      cobrar.disabled = false;
    }
  }

  if (unpay)   despagar(parseInt(unpay.dataset.membroId, 10));
  if (convite) gerarConvite(parseInt(convite.dataset.membroId, 10));
  if (remover) removerMembro(parseInt(remover.dataset.membroId, 10));
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

  if (state.isAdmin) {
    $('btn-mark-paid').classList.remove('hidden');
    $('btn-send-receipt').classList.add('hidden');
  } else {
    $('btn-mark-paid').classList.add('hidden');
    $('btn-send-receipt').classList.remove('hidden');
    const waText = encodeURIComponent(`Oi Kevin, segue o comprovante do FAMIl (referente a ${mesLabel(state.mes)}). Meu nome é ${membro.nome}.`);
    $('btn-send-receipt').href = `https://api.whatsapp.com/send?phone=5596991767788&text=${waText}`;
  }

  openModal('modal-overlay');

  try {
    const res  = await fetch('/api/pix', {
      method: 'POST', headers: getAuthHeaders(),
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
      method: 'POST', headers: getAuthHeaders(),
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
$('btn-copy-saas-pix')?.addEventListener('click', () => {
  const t = $('saas-pix-code');
  if (t && t.value) {
    navigator.clipboard.writeText(t.value);
    const b = $('btn-copy-saas-pix');
    b.textContent = '✓ Copiado!';
    setTimeout(() => b.textContent = 'Copiar Chave Pix', 2000);
  }
});

$('btn-saas-gerar-pix')?.addEventListener('click', async () => {
  const btn = $('btn-saas-gerar-pix');
  btn.disabled = true;
  btn.textContent = 'Gerando Pix...';
  
  try {
    const res = await fetch('/api/saas/pagar', {
      method: 'POST',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    
    if (!res.ok) throw new Error(data.erro || 'Erro ao gerar Pix');
    
    $('saas-qr-img').src = `data:image/png;base64,${data.qr_code_base64}`;
    $('saas-pix-code').value = data.qr_code;
    
    btn.classList.add('hidden');
    $('saas-pix-result').classList.remove('hidden');
    
    // Iniciar polling
    let pollingTries = 0;
    const interval = setInterval(async () => {
      try {
        const check = await fetch(`/api/saas/verificar/${data.payment_id}`, { headers: getAuthHeaders() });
        const checkData = await check.json();
        
        if (checkData.status === 'approved') {
          clearInterval(interval);
          alert('Pagamento aprovado! O seu grupo foi desbloqueado.');
          location.reload();
        } else {
          pollingTries++;
          if (pollingTries > 60) { // 3 minutos de timeout
            clearInterval(interval);
          }
        }
      } catch (e) { console.error('Erro no polling', e); }
    }, 3000);
    
  } catch (err) {
    alert(err.message);
    btn.disabled = false;
    btn.textContent = '⚡ Gerar Pix (R$ 4,90)';
  }
});

// ── Marcar pago ───────────────────────────────────────────────────────────────
async function markPaid() {
  if (!state.selectedMembro) return;
  await fetch('/api/pagar', {
    method: 'POST', headers: getAuthHeaders(),
    body: JSON.stringify({ membro_id: state.selectedMembro.id })
  });
  closeModal('modal-overlay');
  await loadStatus();
}

async function despagar(membro_id) {
  const m = state.membros.find(m => m.id === membro_id);
  if (!confirm(`Desfazer pagamento de ${m?.nome ?? 'membro'}?`)) return;
  await fetch('/api/despagar', {
    method: 'POST', headers: getAuthHeaders(),
    body: JSON.stringify({ membro_id }),
  });
  await loadStatus();
}

// ── Admin ─────────────────────────────────────────────────────────────────────
async function removerMembro(membro_id) {
  const m = state.membros.find(m => m.id === membro_id);
  if (!confirm(`Deseja realmente remover ${m?.nome ?? 'este membro'} da família? O slot ficará vazio.`)) return;
  try {
    const res = await fetch('/api/admin/remover', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ membro_id })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.erro);
    await loadStatus();
  } catch (err) {
    alert(err.message || 'Erro ao remover membro');
  }
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
$('admin-close')?.addEventListener('click', () => $('admin-overlay').classList.remove('active'));
$('admin-settings-close')?.addEventListener('click', () => $('admin-settings-overlay').classList.remove('active'));

// Open admin settings
$('btn-admin-panel')?.addEventListener('click', (e) => {
  e.preventDefault();
  $('admin-settings-overlay').classList.add('active');
});

// Add assinatura
$('btn-add-assinatura')?.addEventListener('click', async () => {
  const nome = $('nova-assinatura-nome').value.trim();
  const valor = parseFloat($('nova-assinatura-valor').value);
  if (!nome || !valor) return alert('Preencha nome e valor');
  const valor_centavos = Math.round(valor * 100);
  $('btn-add-assinatura').disabled = true;
  await fetch('/api/admin/assinaturas', {
    method: 'POST', headers: getAuthHeaders(),
    body: JSON.stringify({ nome, valor_centavos })
  });
  $('btn-add-assinatura').disabled = false;
  $('nova-assinatura-nome').value = '';
  $('nova-assinatura-valor').value = '';
  loadStatus();
});

$('btn-add-saas-fee')?.addEventListener('click', async () => {
  const btn = $('btn-add-saas-fee');
  btn.disabled = true;
  btn.textContent = 'Adicionando...';
  
  await fetch('/api/admin/assinaturas', {
    method: 'POST', headers: getAuthHeaders(),
    body: JSON.stringify({ nome: 'Mensalidade do App', valor_centavos: 490 })
  });
  
  btn.disabled = false;
  btn.textContent = '+ Adicionar Mensalidade do App FAMIl (R$ 4,90)';
  loadStatus();
});

// Delete assinatura
$('admin-assinaturas-list')?.addEventListener('click', async (e) => {
  if (e.target.closest('.btn-del-assinatura')) {
    const id = e.target.closest('.btn-del-assinatura').dataset.id;
    if (confirm('Remover essa assinatura?')) {
      await fetch(`/api/admin/assinaturas/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
      loadStatus();
    }
  }
});

// Save configs
$('btn-save-config')?.addEventListener('click', async () => {
  const dia_vencimento = $('config-dia-vencimento').value;
  const modo_pagamento = $('config-modo-pagamento').value;
  const btn = $('btn-save-config');
  btn.textContent = 'Salvando...';
  await fetch('/api/admin/config', {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ dia_vencimento, modo_pagamento })
  });
  alert('Configurações salvas!');
  btn.textContent = 'Salvar';
  loadStatus();
});

// Disparar Push
$('btn-disparar-push')?.addEventListener('click', async () => {
  if (!confirm('Disparar notificação de cobrança para quem ainda não pagou?')) return;
  const btn = $('btn-disparar-push');
  btn.disabled = true;
  btn.textContent = 'Enviando...';
  
  try {
    const res = await fetch('/api/admin/push/disparar', { method: 'POST', headers: getAuthHeaders() });
    const data = await res.json();
    alert(`Enviado para ${data.enviados} membro(s).`);
  } catch {
    alert('Erro ao enviar push');
  }
  
  btn.disabled = false;
  btn.textContent = '🔔 Disparar Cobrança Agora';
});

// Setup Inicial
$('btn-mark-paid')?.addEventListener('click', markPaid);

['modal-overlay', 'invite-overlay', 'admin-overlay'].forEach(id => {
  const el = $(id);
  if (el) el.addEventListener('click', e => { if (e.target === el) closeModal(id); });
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if ($('modal-overlay').classList.contains('active'))  closeModal('modal-overlay');
  if ($('invite-overlay').classList.contains('active')) closeModal('invite-overlay');
});

// ── Init ──────────────────────────────────────────────────────────────────────
loadStatus();

setInterval(() => {
  if (localStorage.getItem('userToken')) {
    loadStatus();
  }
}, 30_000);

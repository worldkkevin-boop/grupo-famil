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
  const isDesktop = !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  const skipPwa = localStorage.getItem('skip_pwa_blocker') === 'true';

  if (isDesktop || isStandalone || skipPwa) {
    $('pwa-strict-blocker').classList.add('hidden');
    return;
  }

  $('pwa-strict-blocker').classList.remove('hidden');
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  if (isIOS) {
    $('pwa-blocker-ios').classList.remove('hidden');
    $('pwa-blocker-android').classList.add('hidden');
  } else {
    $('pwa-blocker-android').classList.remove('hidden');
    $('pwa-blocker-ios').classList.add('hidden');
  }
}

$('btn-skip-pwa')?.addEventListener('click', () => {
  localStorage.setItem('skip_pwa_blocker', 'true');
  $('pwa-strict-blocker').classList.add('hidden');
});

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

$('btn-logout')?.addEventListener('click', async () => {
  try {
    await fetch('/api/logout', { method: 'POST', headers: getAuthHeaders() });
  } catch (e) {}
  localStorage.removeItem('userToken');
  localStorage.removeItem('userRole');
  localStorage.removeItem('isSuperadmin');
  loadStatus();
});

$('btn-force-update')?.addEventListener('click', async () => {
  const btn = $('btn-force-update');
  btn.textContent = '⏳...';
  
  // Limpa todos os caches do Service Worker
  if ('caches' in window) {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    } catch (e) {}
  }
  
  // Desregistra os Service Workers
  if ('serviceWorker' in navigator) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    } catch (e) {}
  }
  
  // Recarrega a página forçando o servidor
  window.location.reload(true);
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
    state.me_id   = data.me_id;
    
    // Configura datas do SaaS
    if (data.saas_pago_ate || data.saas_data_criacao) {
      let dataFinal;
      if (data.saas_pago_ate) {
        dataFinal = new Date(data.saas_pago_ate);
      } else {
        // Se for trial, são 7 dias após a criação
        dataFinal = new Date(data.saas_data_criacao);
        dataFinal.setDate(dataFinal.getDate() + 7);
      }
      
      const strData = dataFinal.toLocaleDateString('pt-BR');
      $('saas-badge').textContent = `Ativo até ${strData}`;
      $('saas-badge').classList.remove('hidden');
      
      const p = $('plano-ativo-ate');
      if (p) p.textContent = strData;
    }
    
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
    $('btn-copy-pix').classList.remove('hidden');
    
    // Adiciona funcionalidade de copiar a chave PIX
    $('btn-copy-pix').onclick = async () => {
      try {
        await navigator.clipboard.writeText(data.pix_key);
        const originalText = $('btn-copy-pix').innerHTML;
        $('btn-copy-pix').innerHTML = '✅ Copiado!';
        setTimeout(() => $('btn-copy-pix').innerHTML = originalText, 2000);
      } catch (err) {
        alert('Chave Pix: ' + data.pix_key);
      }
    };

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

    // Telefones dos Membros (WhatsApp)
    const telContainer = $('admin-telefones-list');
    if (telContainer) {
      telContainer.innerHTML = ativos.map(m => `
        <div style="display:flex; gap:8px; align-items:center; background:rgba(255,255,255,0.03); padding:8px 10px; border-radius:8px;">
          <span style="flex:1; font-size:0.85rem; font-weight:600; color:var(--text);">${m.nome}</span>
          <input type="tel" id="tel-membro-${m.id}" value="${m.telefone || ''}" placeholder="Ex: 96991234567" style="width:140px; padding:6px 8px; border-radius:6px; background:var(--bg); border:1px solid var(--border); color:#fff; font-size:0.8rem;">
          <button class="btn-salvar-tel" data-id="${m.id}" style="padding:6px 12px; border-radius:6px; background:var(--primary); color:#fff; border:none; cursor:pointer; font-size:0.75rem; font-weight:600;">Salvar</button>
        </div>
      `).join('');

      telContainer.querySelectorAll('.btn-salvar-tel').forEach(btn => {
        btn.onclick = async () => {
          const mId = btn.dataset.id;
          const input = $(`tel-membro-${mId}`);
          const tel = input ? input.value.trim() : '';
          const originalText = btn.textContent;
          btn.textContent = 'Salvando...';
          try {
            await fetch('/api/admin/membro/telefone', {
              method: 'POST',
              headers: getAuthHeaders(),
              body: JSON.stringify({ membro_id: parseInt(mId, 10), telefone: tel })
            });
            btn.textContent = '✅ Salvo!';
            setTimeout(() => btn.textContent = originalText, 2000);
            const membro = state.membros.find(x => x.id === parseInt(mId, 10));
            if (membro) membro.telefone = tel;
          } catch (e) {
            alert('Erro ao salvar telefone: ' + e.message);
            btn.textContent = originalText;
          }
        };
      });
    }
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
        <button class="btn-pix" data-action="pix" data-membro-id="${m.id}" style="padding: 10px 8px; font-size: 0.8rem;" aria-label="Ver Pix de ${m.nome}">
          ⚡ Pix
        </button>
        <button class="btn-pix" data-action="cobrar" data-membro-id="${m.id}" style="background:var(--secondary); font-size: 0.8rem; padding: 10px 8px;" aria-label="Cobrar ${m.nome} no WhatsApp">
          💬 Cobrar
        </button>
        <button class="btn-pix" data-action="marcar-pago" data-membro-id="${m.id}" style="background:var(--success); font-size: 0.8rem; padding: 10px 8px;" aria-label="Marcar pago">
          ✓ Pago
        </button>
      `;
    } else {
      if (m.id === state.me_id) {
        actionBtn = `
          <button class="btn-pix" data-action="pix" data-membro-id="${m.id}" aria-label="Gerar Pix para ${m.nome}">
            <span aria-hidden="true">⚡</span> Gerar Pix
          </button>
        `;
      } else {
        actionBtn = `<div style="flex:1;text-align:center;color:var(--text-muted);font-weight:600;padding:10px;font-size:0.8rem;">Pendente</div>`;
      }
    }
  } else {
    if (state.isAdmin) {
      actionBtn = `<button class="btn-unpay" data-action="despagar" data-membro-id="${m.id}" aria-label="Desfazer pagamento de ${m.nome}">
                     Desfazer pagamento
                   </button>`;
    } else {
      actionBtn = `<div style="flex:1;text-align:center;color:var(--success);font-weight:600;padding:10px;border:1px dashed var(--success);border-radius:var(--radius-sm);font-size:0.85rem;">✅ Já Pago</div>`;
    }
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
          ${state.isAdmin && m.telefone ? `<span style="font-size:0.65rem;color:var(--primary-light);">📱 ${m.telefone}</span>` : ''}
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
    cobrar.textContent = 'Enviando...';

    // Se WhatsApp automático estiver conectado e membro tiver telefone:
    if (state.whatsapp && state.whatsapp.status === 'connected' && m.telefone) {
      try {
        const resAuto = await fetch('/api/admin/cobrar-automatico', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ membro_id: m.id })
        });
        const dataAuto = await resAuto.json();
        if (!resAuto.ok) throw new Error(dataAuto.erro || 'Falha no disparo');
        
        cobrar.textContent = '✅ Enviado!';
        cobrar.style.background = 'var(--success)';
        setTimeout(() => {
          cobrar.textContent = '💬 Cobrar';
          cobrar.style.background = 'var(--secondary)';
          cobrar.disabled = false;
        }, 3000);
        return;
      } catch (err) {
        console.warn('Envio automático falhou, usando fallback:', err);
        alert(`Aviso do Bot WhatsApp: ${err.message}\nAbrindo WhatsApp Web como alternativa.`);
      }
    }
    
    // Fallback manual (abre o link do WhatsApp com mensagem pronta):
    try {
      const res = await fetch('/api/pix', {
        method: 'POST', headers: getAuthHeaders(),
        body: JSON.stringify({ valor_centavos: m.cota }),
      });
      const data = await res.json();
      if (!data.payload) throw new Error('Erro ao gerar Pix');
      
      const valorStr = fmt(m.cota);
      const chavePix = state.pix_key || '01749132222';
      const msg = `Olá, ${m.nome}! 👋\n\nA sua fatura da assinatura familiar deste mês (${mesLabel(state.mes)}) está disponível no valor de *${valorStr}*.\n\n🔑 *Chave Pix:*\n${chavePix}\n\n⚡ *Pix Copia e Cola:*\n\`\`\`${data.payload}\`\`\`\n\nAssim que efetuar o pagamento, me confirma por aqui! Obrigado! 🙌`;
      
      let url = '';
      if (m.telefone && m.telefone.replace(/\D/g, '').length >= 10) {
        const cleanTel = m.telefone.replace(/\D/g, '');
        const ddiTel = cleanTel.startsWith('55') ? cleanTel : `55${cleanTel}`;
        url = `https://wa.me/${ddiTel}?text=${encodeURIComponent(msg)}`;
      } else {
        url = `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
      }
      
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

// Upgrade Pix Copy
$('btn-copy-upgrade-pix')?.addEventListener('click', () => {
  const t = $('upgrade-pix-code');
  if (t && t.value) {
    navigator.clipboard.writeText(t.value);
    const b = $('btn-copy-upgrade-pix');
    b.textContent = '✓ Copiado!';
    setTimeout(() => b.textContent = 'Copiar Chave', 2000);
  }
});

// Botões de Plano
document.querySelectorAll('.btn-renovar-plano').forEach(btn => {
  btn.addEventListener('click', async (e) => {
    const plano = e.currentTarget.dataset.plano;
    const allBtns = document.querySelectorAll('.btn-renovar-plano');
    allBtns.forEach(b => b.disabled = true);
    
    try {
      const res = await fetch('/api/saas/pagar', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ plano })
      });
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.erro || 'Erro ao gerar Pix');
      
      $('upgrade-qr-img').src = `data:image/png;base64,${data.qr_code_base64}`;
      $('upgrade-pix-code').value = data.qr_code;
      $('upgrade-pix-result').classList.remove('hidden');
      
      // Esconder botões de plano
      allBtns.forEach(b => b.classList.add('hidden'));
      
      // Polling
      let pollingTries = 0;
      const interval = setInterval(async () => {
        try {
          const check = await fetch(`/api/saas/verificar/${data.payment_id}`, { headers: getAuthHeaders() });
          const checkData = await check.json();
          
          if (checkData.status === 'approved') {
            clearInterval(interval);
            alert('Pagamento aprovado! Plano renovado com sucesso.');
            location.reload();
          } else {
            pollingTries++;
            if (pollingTries > 60) clearInterval(interval);
          }
        } catch(e) {}
      }, 3000);
      
    } catch(err) {
      alert(err.message);
      allBtns.forEach(b => b.disabled = false);
    }
  });
});

// ── Marcar pago ───────────────────────────────────────────────────────────────
async function markPaid() {
  if (!state.selectedMembro) return;
  await setPago(state.selectedMembro.id);
  closeModal('modal-overlay');
}

async function setPago(membro_id) {
  await fetch('/api/pagar', {
    method: 'POST', headers: getAuthHeaders(),
    body: JSON.stringify({ membro_id })
  });
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
  checkWhatsAppStatus();
  if (!waPollTimer) {
    waPollTimer = setInterval(checkWhatsAppStatus, 2500);
  }
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

// Alterar Senha Admin
$('btn-salvar-nova-senha')?.addEventListener('click', async () => {
  const input = $('nova-senha-admin');
  const msg = $('msg-senha-status');
  const novaSenha = input ? input.value.trim() : '';
  if (!novaSenha || novaSenha.length < 4) {
    if (msg) {
      msg.textContent = 'A senha deve ter no mínimo 4 caracteres.';
      msg.style.color = 'var(--danger)';
      msg.style.display = 'block';
    }
    return;
  }
  const btn = $('btn-salvar-nova-senha');
  const oldText = btn.textContent;
  btn.textContent = 'Salvando...';
  try {
    const res = await fetch('/api/admin/alterar-senha', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ nova_senha: novaSenha })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.erro || 'Erro ao alterar senha');
    if (msg) {
      msg.textContent = '✅ Senha alterada com sucesso!';
      msg.style.color = 'var(--success)';
      msg.style.display = 'block';
    }
    input.value = '';
    setTimeout(() => { if (msg) msg.style.display = 'none'; }, 3000);
  } catch (err) {
    if (msg) {
      msg.textContent = '❌ ' + err.message;
      msg.style.color = 'var(--danger)';
      msg.style.display = 'block';
    }
  } finally {
    btn.textContent = oldText;
  }
});

// ── WhatsApp Bot UI & Status Polling ──────────────────────────────────────────
let waPollTimer = null;

async function checkWhatsAppStatus() {
  if (!state.isAdmin) return;
  try {
    const res = await fetch('/api/admin/whatsapp/status', { headers: getAuthHeaders() });
    const data = await res.json();
    state.whatsapp = data;
    renderWhatsAppStatus(data);
  } catch (err) {}
}

function renderWhatsAppStatus(data) {
  const badge = $('wa-status-badge');
  const qrContainer = $('wa-qr-container');
  const qrImg = $('wa-qr-img');
  const connectedContainer = $('wa-connected-container');
  const connectedPhone = $('wa-connected-phone');
  const disconnectedActions = $('wa-disconnected-actions');

  if (!badge) return;

  if (data.status === 'connected') {
    badge.textContent = '🟢 Conectado';
    badge.style.background = 'rgba(16,185,129,0.2)';
    badge.style.color = 'var(--success)';
    if (connectedContainer) connectedContainer.classList.remove('hidden');
    if (connectedPhone) connectedPhone.textContent = `Número: +${data.phone}`;
    if (qrContainer) qrContainer.classList.add('hidden');
    if (disconnectedActions) disconnectedActions.classList.add('hidden');
    if (waPollTimer) { clearInterval(waPollTimer); waPollTimer = null; }
    carregarGruposWhatsApp();
  } else if (data.status === 'qr_ready' && data.qr_base64) {
    badge.textContent = '🟡 Aguardando Leitura';
    badge.style.background = 'rgba(234,179,8,0.2)';
    badge.style.color = '#eab308';
    if (qrContainer) qrContainer.classList.remove('hidden');
    if (qrImg) qrImg.src = data.qr_base64;
    if (connectedContainer) connectedContainer.classList.add('hidden');
    if (disconnectedActions) disconnectedActions.classList.add('hidden');
  } else if (data.status === 'connecting') {
    badge.textContent = '⏳ Conectando...';
    badge.style.background = 'rgba(124,58,237,0.2)';
    badge.style.color = 'var(--primary-light)';
    if (connectedContainer) connectedContainer.classList.add('hidden');
  } else {
    badge.textContent = '⚪ Desconectado';
    badge.style.background = 'rgba(255,255,255,0.1)';
    badge.style.color = 'var(--text-muted)';
    if (qrContainer) qrContainer.classList.add('hidden');
    if (connectedContainer) connectedContainer.classList.add('hidden');
    if (disconnectedActions) disconnectedActions.classList.remove('hidden');
  }
}

$('btn-wa-conectar')?.addEventListener('click', async () => {
  const btn = $('btn-wa-conectar');
  const oldText = btn.textContent;
  btn.textContent = 'Iniciando WhatsApp...';
  btn.disabled = true;
  try {
    await fetch('/api/admin/whatsapp/conectar', { method: 'POST', headers: getAuthHeaders() });
    await checkWhatsAppStatus();
    if (!waPollTimer) {
      waPollTimer = setInterval(checkWhatsAppStatus, 2500);
    }
  } catch (err) {
    alert('Erro ao iniciar WhatsApp: ' + err.message);
  } finally {
    btn.textContent = oldText;
    btn.disabled = false;
  }
});

$('btn-wa-desconectar')?.addEventListener('click', async () => {
  if (!confirm('Deseja realmente desconectar o WhatsApp?')) return;
  try {
    await fetch('/api/admin/whatsapp/desconectar', { method: 'POST', headers: getAuthHeaders() });
    checkWhatsAppStatus();
  } catch (err) {}
});

$('btn-wa-testar')?.addEventListener('click', async () => {
  const btn = $('btn-wa-testar');
  const input = $('wa-test-num');
  const statusDiv = $('wa-test-status');
  const numero = input?.value.trim();

  if (!numero) {
    alert('Digite o DDD e o número para testar (ex: 96991767788)');
    input?.focus();
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Enviando...';
  if (statusDiv) {
    statusDiv.style.display = 'block';
    statusDiv.style.color = 'var(--text-muted)';
    statusDiv.textContent = 'Validando número e despachando pelo WhatsApp...';
  }

  try {
    const res = await fetch('/api/admin/whatsapp/enviar-teste', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        numero,
        texto: '🤖 *Grupo FAMIl - Teste do Robô*\n\nSeu robô de cobrança automática do WhatsApp está conectado e funcionando perfeitamente! 🚀'
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.erro || 'Falha ao enviar teste');

    if (statusDiv) {
      statusDiv.style.color = 'var(--success)';
      statusDiv.textContent = `✅ Mensagem enviada com sucesso! JID: ${data.result?.jid || 'OK'}`;
    }
  } catch (err) {
    if (statusDiv) {
      statusDiv.style.color = 'var(--danger)';
      statusDiv.textContent = `❌ ${err.message}`;
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Testar';
  }
});

// Gerenciamento de Grupo de WhatsApp da Família
async function carregarGruposWhatsApp() {
  const select = $('sel-wa-grupo');
  if (!select) return;

  try {
    const res = await fetch('/api/admin/whatsapp/grupos', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.erro || 'Falha ao carregar grupos');

    select.innerHTML = '<option value="">-- Selecione o grupo da família --</option>';

    if (!data.grupos || data.grupos.length === 0) {
      select.innerHTML += '<option value="" disabled>Nenhum grupo encontrado (adicione o bot no grupo primeiro)</option>';
    } else {
      data.grupos.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g.id;
        opt.textContent = `${g.name} (${g.participantsCount} participantes)`;
        if (data.grupo_vinculado && data.grupo_vinculado === g.id) {
          opt.selected = true;
        }
        select.appendChild(opt);
      });
    }

    if (data.grupo_vinculado && (!data.grupos || !data.grupos.some(g => g.id === data.grupo_vinculado))) {
      const opt = document.createElement('option');
      opt.value = data.grupo_vinculado;
      opt.textContent = `Grupo Vinculado (${data.grupo_vinculado.slice(0, 15)}...)`;
      opt.selected = true;
      select.appendChild(opt);
    }
  } catch (err) {
    console.warn('Erro ao carregar grupos:', err);
    select.innerHTML = '<option value="">Erro ao carregar grupos</option>';
  }
}

$('btn-wa-atualizar-grupos')?.addEventListener('click', carregarGruposWhatsApp);

$('btn-wa-salvar-grupo')?.addEventListener('click', async () => {
  const select = $('sel-wa-grupo');
  const statusDiv = $('wa-grupo-status');
  const grupoJid = select?.value;

  if (!grupoJid) {
    alert('Selecione um grupo da lista primeiro.');
    return;
  }

  try {
    const res = await fetch('/api/admin/whatsapp/salvar-grupo', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ whatsapp_group_jid: grupoJid })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.erro || 'Falha ao salvar');

    if (statusDiv) {
      statusDiv.style.display = 'block';
      statusDiv.style.color = 'var(--success)';
      statusDiv.textContent = '✅ Grupo da família vinculado com sucesso!';
      setTimeout(() => { statusDiv.style.display = 'none'; }, 4000);
    }
  } catch (err) {
    if (statusDiv) {
      statusDiv.style.display = 'block';
      statusDiv.style.color = 'var(--danger)';
      statusDiv.textContent = `❌ ${err.message}`;
    }
  }
});

$('btn-wa-cobrar-grupo')?.addEventListener('click', async () => {
  const btn = $('btn-wa-cobrar-grupo');
  const statusDiv = $('wa-grupo-status');

  if (!confirm('Deseja disparar a cobrança coletiva de assinaturas no grupo da família no WhatsApp agora?')) return;

  btn.disabled = true;
  btn.textContent = 'Enviando cobrança no grupo...';
  if (statusDiv) {
    statusDiv.style.display = 'block';
    statusDiv.style.color = 'var(--text-muted)';
    statusDiv.textContent = 'Enviando Pix e informações no grupo...';
  }

  try {
    const res = await fetch('/api/admin/whatsapp/cobrar-grupo', {
      method: 'POST',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.erro || 'Falha no disparo');

    if (statusDiv) {
      statusDiv.style.color = 'var(--success)';
      statusDiv.textContent = '✅ Cobrança enviada com sucesso no grupo da família!';
    }
  } catch (err) {
    if (statusDiv) {
      statusDiv.style.color = 'var(--danger)';
      statusDiv.textContent = `❌ ${err.message}`;
    }
  } finally {
    btn.disabled = false;
    btn.textContent = '📢 Disparar Cobrança no Grupo da Família';
  }
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

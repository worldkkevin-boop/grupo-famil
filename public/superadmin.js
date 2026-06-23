const $ = id => document.getElementById(id);

let userToken = localStorage.getItem('saasToken') || null;

// ── Funções Auxiliares ────────────────────────────────────────────────────────
function getAuthHeaders() {
  return { 'Authorization': 'Bearer ' + userToken };
}

function showView(view) {
  $('login-view').style.display = view === 'login' ? 'flex' : 'none';
  $('dashboard-view').style.display = view === 'dashboard' ? 'flex' : 'none';
}

function showError(msg) {
  const err = $('error-msg');
  err.textContent = msg;
  err.classList.remove('hidden');
}

// ── Google Sign In ────────────────────────────────────────────────────────────
window.onload = async () => {
  try {
    const res = await fetch('/api/config');
    const { google_client_id } = await res.json();
    
    if (google_client_id) {
      google.accounts.id.initialize({
        client_id: google_client_id,
        callback: handleGoogleCredential
      });
      google.accounts.id.renderButton($('google-btn'), {
        theme: 'filled_dark', size: 'large', shape: 'pill'
      });
    }
  } catch (err) {
    console.error('Erro ao buscar config', err);
  }

  if (userToken) {
    checkToken();
  } else {
    showView('login');
  }
};

async function handleGoogleCredential(response) {
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ google_id_token: response.credential })
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.erro || 'Falha no login');
    if (!data.is_superadmin) throw new Error('Acesso negado: Você não é Super Admin.');

    userToken = data.token;
    localStorage.setItem('saasToken', userToken);
    loadDashboard();
  } catch (err) {
    showError(err.message);
  }
}

async function checkToken() {
  // Faz uma requisição de teste para ver se o token é válido
  try {
    const res = await fetch('/api/superadmin/grupos', { headers: getAuthHeaders() });
    if (res.ok) {
      loadDashboard();
    } else {
      logout();
    }
  } catch {
    logout();
  }
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
async function loadDashboard() {
  showView('dashboard');
  const tbody = $('table-body');
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Carregando...</td></tr>';

  try {
    const res = await fetch('/api/superadmin/grupos', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Falha ao carregar grupos');
    const grupos = await res.json();
    
    tbody.innerHTML = '';
    
    if (grupos.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">Nenhum cliente encontrado.</td></tr>';
      return;
    }

    grupos.forEach(g => {
      const dataCriacao = new Date(g.data_criacao).toLocaleDateString('pt-BR');
      
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="color:var(--text-muted);">#${g.id}</td>
        <td style="font-weight:600;">${g.nome}</td>
        <td>${g.dono_email}</td>
        <td>${g.qte_membros}</td>
        <td>
          <div style="font-size:0.85rem; color:var(--text-muted);">
            <div>${g.pix_key}</div>
            <div>${g.pix_name}</div>
          </div>
        </td>
        <td>${dataCriacao}</td>
        <td style="text-align:right;">
          <button class="btn-delete" onclick="excluirGrupo(${g.id})">Deletar</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--danger);">${err.message}</td></tr>`;
  }
}

async function excluirGrupo(id) {
  if (id === 1) {
    alert("O Grupo #1 é o seu grupo original e não pode ser apagado por segurança!");
    return;
  }
  if (!confirm(`Tem certeza ABSOLUTA que deseja deletar o Grupo #${id}?\n\nIsso apagará permanentemente o grupo, todos os membros, pagamentos e configurações deste cliente.`)) return;
  
  try {
    const res = await fetch(`/api/superadmin/grupos/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.erro || 'Erro ao excluir grupo');
    
    // Recarrega a tabela
    loadDashboard();
  } catch (err) {
    alert(err.message);
  }
}

function logout() {
  userToken = null;
  localStorage.removeItem('saasToken');
  showView('login');
}

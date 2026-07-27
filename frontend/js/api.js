// Frontend indi backend-in özündən paylandığı üçün nisbi (relative) ünvan kifayətdir.
// Əgər frontend-i ayrıca portda saxlamaq istəsəniz, buraya tam backend ünvanını yazın
// (məs. 'http://localhost:4000/api').
const API_BASE = '/api';

async function apiRequest(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include', // httpOnly cookie göndərmək üçün vacibdir
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      // ngrok pulsuz planında brauzer xəbərdarlıq səhifəsini (interstitial) keçmək üçün
      'ngrok-skip-browser-warning': 'true',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try { data = await res.json(); } catch (_) { /* boş cavab ola bilər */ }

  if (!res.ok) {
    const message = data?.error || `Xəta baş verdi (${res.status})`;
    throw new Error(message);
  }
  return data;
}

// Fayl yükləmə (məs. Excel import) üçün - FormData ilə, JSON-a çevirmədən
async function apiUpload(path, formData) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'ngrok-skip-browser-warning': 'true' },
    body: formData,
  });

  let data = null;
  try { data = await res.json(); } catch (_) { /* boş cavab ola bilər */ }

  if (!res.ok) {
    const message = data?.error || `Xəta baş verdi (${res.status})`;
    throw new Error(message);
  }
  return data;
}

const api = {
  get: (path) => apiRequest(path),
  post: (path, body) => apiRequest(path, { method: 'POST', body }),
  put: (path, body) => apiRequest(path, { method: 'PUT', body }),
  patch: (path, body) => apiRequest(path, { method: 'PATCH', body }),
  delete: (path) => apiRequest(path, { method: 'DELETE' }),
  upload: (path, formData) => apiUpload(path, formData),
};

// --------- Toast bildirişləri ---------
function showToast(message, type = 'default') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// --------- Rola görə əsas panel ünvanı ---------
function homeForRole(role) {
  if (role === 'superadmin') return '/superadmin/inventory.html';
  if (role === 'admin') return '/admin/inventory.html';
  return '/user/inventory.html';
}

// --------- Auth guard: səhifə yüklənəndə rolu yoxlayır ---------
// requiredRoles: undefined (hər hansı rol keçər) və ya rol adı/array
async function requireAuth(requiredRoles) {
  try {
    const { user } = await api.get('/auth/me');
    if (requiredRoles) {
      const allowed = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];
      if (!allowed.includes(user.role)) {
        window.location.href = homeForRole(user.role);
        return null;
      }
    }
    return user;
  } catch (err) {
    window.location.href = '/login.html';
    return null;
  }
}

async function logout() {
  try { await api.post('/auth/logout'); } catch (_) {}
  window.location.href = '/login.html';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('az-AZ', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit' });
}

const STATUS_LABELS = {
  pending: 'Anbardar baxışı gözlənilir',
  pending_agreement: 'Razılıq gözlənilir',
  pending_superadmin: 'Superadmin təsdiqi gözlənilir',
  pending_delivery: 'Təhvilə hazırdır',
  completed: 'Təhvil verildi',
  rejected: 'Rədd edildi',
  approved: 'Qəbul edilib', // wishlist üçün
};

// --------- Admin üçün "Tam inventar" nav linkini toggle vəziyyətinə görə göstər/gizlət ---------
// Yalnız admin rolunda mənalıdır (superadmin öz ayrıca səhifəsindən istifadə edir).
// socket ötürülübsə, canlı (real-time) yenilənmə də qoşulur.
async function applyFullInventoryNavToggle(user, socket) {
  const navLink = document.getElementById('fullInventoryNavLink');
  if (!navLink) return;

  if (user.role !== 'admin') {
    navLink.remove();
    return;
  }

  try {
    const settings = await api.get('/settings');
    navLink.style.display = settings.admin_full_inventory_visible ? 'flex' : 'none';
  } catch (_) { /* səssiz */ }

  if (socket) {
    socket.on('settings:updated', (settings) => {
      navLink.style.display = settings.admin_full_inventory_visible ? 'flex' : 'none';
    });
  }
}

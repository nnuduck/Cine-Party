// Cinema Party - Client Application (Mobile-first, dark theme)

const tg = window.Telegram?.WebApp;
if (tg) {
  try {
    tg.ready();
    tg.expand();
    if (typeof tg.requestFullscreen === 'function') {
      try { tg.requestFullscreen(); } catch {}
    }
    tg.setHeaderColor?.('#000000');
    tg.setBackgroundColor?.('#000000');
    tg.setBottomBarColor?.('#000000');
    tg.disableVerticalSwipes?.();
  } catch {}
}

function updateSafeArea() {
  const root = document.documentElement;

  if (!tg) {
    root.style.setProperty('--tg-safe-area-inset-top', '0px');
    root.style.setProperty('--tg-content-safe-area-inset-top', '0px');
    root.style.setProperty('--tg-content-safe-area-inset-bottom', '0px');
    root.style.setProperty('--tg-total-top-inset', '16px');
    return;
  }

  const sTop = Number(tg.safeAreaInset?.top) || 0;
  const cTop = Number(tg.contentSafeAreaInset?.top) || 0;
  const sBottom = Number(tg.safeAreaInset?.bottom) || 0;
  const cBottom = Number(tg.contentSafeAreaInset?.bottom) || 0;

  root.style.setProperty('--tg-safe-area-inset-top', `${sTop}px`);
  root.style.setProperty('--tg-content-safe-area-inset-top', `${cTop}px`);
  root.style.setProperty('--tg-content-safe-area-inset-bottom', `${Math.max(sBottom, cBottom)}px`);

  let resolvedTop;
  if (tg.isFullscreen && cTop < 40) {
    // Старый клиент: fullscreen есть, contentSafeAreaInset не отдаёт.
    // Резервируем 60px под нативные кнопки Telegram.
    resolvedTop = sTop + 60;
  } else {
    // Современный клиент: cTop уже включает кнопки, +8px воздуха.
    resolvedTop = sTop + cTop + 8;
  }
  resolvedTop = Math.max(resolvedTop, 12);

  root.style.setProperty('--tg-total-top-inset', `${resolvedTop}px`);

  // Диагностика через нативный Telegram-алерт (работает без DevTools).
  // Активируется только когда пользователь попросит.
  if (localStorage.getItem('cinema_safearea_debug') === '1') {
    try {
      tg.showAlert?.(
        `sTop=${sTop}\ncTop=${cTop}\nisFullscreen=${!!tg.isFullscreen}\nresolvedTop=${resolvedTop}`
      );
    } catch {}
  }
}
updateSafeArea();
try { tg?.onEvent?.('safeAreaChanged', updateSafeArea); } catch {}
try { tg?.onEvent?.('contentSafeAreaChanged', updateSafeArea); } catch {}
try { tg?.onEvent?.('fullscreenChanged', updateSafeArea); } catch {}
try { tg?.onEvent?.('viewportChanged', updateSafeArea); } catch {}
window.addEventListener('resize', updateSafeArea);

const $app = document.getElementById('app');

let suppressNextClickUntil = 0;
let longPressState = null;

function cancelLongPress() {
  if (!longPressState) return;
  clearTimeout(longPressState.timer);
  longPressState = null;
}

function triggerLongPressAction(target) {
  if (target.classList.contains('folder-tile')) {
    const folderId = Number(target.dataset.folderId);
    const folder = state.folders.find((f) => f.id === folderId);
    if (!folder) return false;
    haptic('medium');
    openFolderContextSheet(folder);
    return true;
  }
  if (target.classList.contains('card')) {
    if (state.tab === 'others') return false;
    const id = Number(target.dataset.id);
    const movie = state.movies.find((m) => m.id === id);
    if (!movie) return false;
    const canEdit = movie.kind === 'together' || movie.added_by === state.me?.id;
    if (!canEdit) return false;
    haptic('medium');
    openMoveToFolderSheet(movie);
    return true;
  }
  return false;
}

document.body.addEventListener('pointerdown', (e) => {
  if (!e.isPrimary) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (e.target.closest('.overlay')) return;
  const target = e.target.closest('.folder-tile, .card');
  if (!target) return;

  cancelLongPress();
  const startX = e.clientX;
  const startY = e.clientY;
  const timer = setTimeout(() => {
    longPressState = null;
    if (triggerLongPressAction(target)) {
      suppressNextClickUntil = Date.now() + 500;
    }
  }, 500);

  longPressState = { target, startX, startY, timer };
});

document.body.addEventListener('pointermove', (e) => {
  if (!longPressState) return;
  const dx = e.clientX - longPressState.startX;
  const dy = e.clientY - longPressState.startY;
  if (Math.hypot(dx, dy) > 8) cancelLongPress();
});

document.body.addEventListener('pointerup', cancelLongPress);
document.body.addEventListener('pointercancel', cancelLongPress);
window.addEventListener('scroll', cancelLongPress, { passive: true });

document.body.addEventListener('contextmenu', (e) => {
  if (e.target.closest('.overlay')) return;
  const target = e.target.closest('.folder-tile, .card');
  if (!target) return;
  e.preventDefault();
  cancelLongPress();
  if (Date.now() < suppressNextClickUntil || currentOverlay) return;
  triggerLongPressAction(target);
});

document.body.addEventListener('click', (e) => {
  const fabMenu = $app.querySelector('#fabMenu');
  if (fabMenu && !fabMenu.classList.contains('hidden') && !e.target.closest('#fabContainer')) {
    fabMenu.classList.add('hidden');
    $app.querySelector('#fabBtn')?.classList.remove('open');
  }
  const sortDrop = $app.querySelector('#sortDropdown');
  if (sortDrop && !sortDrop.classList.contains('hidden') && !e.target.closest('#sortWrap')) {
    sortDrop.classList.add('hidden');
  }

  if (Date.now() < suppressNextClickUntil) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  const backBtn = e.target.closest('#folderBackBtn');
  if (backBtn) {
    state.selectedFolder = null;
    haptic('light');
    render();
    return;
  }

  const tile = e.target.closest('.folder-tile');
  if (tile && tile.dataset.folderId) {
    const folderId = Number(tile.dataset.folderId);
    if (!Number.isFinite(folderId) || folderId <= 0) return;
    state.selectedFolder = folderId;
    const availableTags = partyTags().map(([t]) => t);
    if (state.selectedTag && !availableTags.includes(state.selectedTag)) {
      state.selectedTag = null;
    }
    haptic('light');
    render();
    return;
  }

  const card = e.target.closest('.card');
  if (!card || !card.dataset.id) return;
  const id = Number(card.dataset.id);
  if (!Number.isFinite(id) || id <= 0) return;
  haptic('light');
  openMovieDetail(id);
});

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function haptic(type = 'light') {
  try { tg?.HapticFeedback?.impactOccurred?.(type); } catch {}
}

function hapticNotice(type = 'success') {
  try { tg?.HapticFeedback?.notificationOccurred?.(type); } catch {}
}

function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    el.hidden = true;
  }, 2400);
}

// ---------- Home Screen & PWA Integration ----------
let homeScreenStatus = 'unknown';

function initHomeScreen() {
  if (tg && typeof tg.checkHomeScreenStatus === 'function') {
    try {
      tg.checkHomeScreenStatus((status) => {
        homeScreenStatus = status;
      });
      tg.onEvent?.('homeScreenAdded', () => {
        homeScreenStatus = 'added';
        toast('Added to Home Screen!');
      });
      tg.onEvent?.('homeScreenChecked', (status) => {
        homeScreenStatus = status;
      });
    } catch {}
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    window.deferredInstallPrompt = e;
  });

  window.addEventListener('appinstalled', () => {
    homeScreenStatus = 'added';
    window.deferredInstallPrompt = null;
    toast('Cinema Party added to Home Screen');
  });
}

initHomeScreen();

function openAddToHomeGuideSheet() {
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  openSheet(`
    <h2 class="sheet-title display">Add to Home Screen</h2>
    <div style="display:flex; align-items:center; gap:16px; margin-bottom:20px;">
      <img src="/icon-512.png" alt="Cinema Party Icon" style="width:60px; height:60px; border-radius:16px; border:1px solid var(--border); box-shadow:0 4px 16px rgba(0,0,0,0.5);">
      <div>
        <div style="font-weight:700; font-size:16px;">Cinema Party</div>
        <div style="color:var(--muted); font-size:13px;">Full-screen phone shortcut</div>
      </div>
    </div>

    <div style="background:var(--surface-2); border:1px solid var(--border); border-radius:16px; padding:16px; margin-bottom:14px;">
      <div style="font-weight:600; font-size:14px; margin-bottom:8px; color:var(--text);">In Telegram:</div>
      <ol style="margin-left:18px; color:var(--muted); font-size:13px; line-height:1.6;">
        <li>Tap the three dots (<strong>⋮</strong>) in the top-right corner of this screen.</li>
        <li>Select <strong>Add to Home screen</strong>.</li>
        <li>Tap <strong>Add</strong> to pin the icon directly to your phone screen.</li>
      </ol>
      <div style="margin-top:10px; font-size:12px; color:var(--muted); line-height:1.4;">
        Note: If you don't see this option in the menu, open the bot via its direct Mini App link <code>t.me/cine_party_bot/cinema</code>.
      </div>
    </div>

    <div style="background:var(--surface-2); border:1px solid var(--border); border-radius:16px; padding:16px; margin-bottom:18px;">
      <div style="font-weight:600; font-size:14px; margin-bottom:8px; color:var(--text);">In Browser:</div>
      <div style="color:var(--muted); font-size:13px; line-height:1.6;">
        ${
          isIos
            ? 'Tap the <strong>Share</strong> button at the bottom (box with upward arrow) &rarr; select <strong>Add to Home Screen</strong>.'
            : 'Tap the <strong>Menu (⋮)</strong> &rarr; select <strong>Add to Home screen</strong> or <strong>Install App</strong>.'
        }
      </div>
    </div>

    <div class="action-stack" style="justify-content:center;">
      <button type="button" class="btn primary" id="openDirectBotLinkBtn">Open via t.me/cine_party_bot/cinema</button>
      <button type="button" class="btn" id="gotItGuideBtn">Close</button>
    </div>
  `);

  document.querySelector('#openDirectBotLinkBtn')?.addEventListener('click', () => {
    if (tg?.openTelegramLink) {
      tg.openTelegramLink('https://t.me/cine_party_bot/cinema');
    } else {
      window.open('https://t.me/cine_party_bot/cinema', '_blank');
    }
  });

  document.querySelector('#gotItGuideBtn')?.addEventListener('click', closeSheet);
}

function requestAddToHomeScreen() {
  haptic('medium');

  if (tg && typeof tg.addToHomeScreen === 'function') {
    try {
      tg.addToHomeScreen();
      return;
    } catch (e) {
      console.warn('Telegram addToHomeScreen call failed', e);
    }
  }

  if (window.deferredInstallPrompt) {
    window.deferredInstallPrompt.prompt();
    window.deferredInstallPrompt.userChoice?.then((choice) => {
      if (choice.outcome === 'accepted') {
        homeScreenStatus = 'added';
        hapticNotice('success');
        toast('Added to Home Screen');
      }
      window.deferredInstallPrompt = null;
    });
    return;
  }

  if (tg?.showAlert) {
    tg.showAlert(
      'Add to Home Screen:\n\n' +
      '1. Tap ⋮ in top-right\n' +
      '2. Choose "Add to Home Screen"\n' +
      '3. Confirm\n\n' +
      'If this option is missing, open the bot via t.me/cine_party_bot/cinema'
    );
  } else {
    openAddToHomeGuideSheet();
  }
}

// ---------- Accent Customization ----------
const DEFAULT_ACCENT = '#D71921';
const PRESET_SWATCHES = [
  '#D71921', // Crimson Red
  '#FFFFFF', // White
  '#3B82F6', // Blue
  '#10B981', // Green
  '#F59E0B', // Yellow
  '#F97316', // Orange
  '#8B5CF6', // Purple
  '#EC4899', // Pink
];

function getContrastColor(hex) {
  if (!hex || hex.length !== 7) return '#FFFFFF';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#000000' : '#FFFFFF';
}

function hexToRgba(hex, alpha = 0.35) {
  if (!hex || hex.length !== 7) return `rgba(215, 25, 33, ${alpha})`;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function applyAccent(color, saveToServer = false) {
  const hex = color && /^#[0-9A-Fa-f]{6}$/.test(color) ? color : DEFAULT_ACCENT;
  document.documentElement.style.setProperty('--accent', hex);
  document.documentElement.style.setProperty('--accent-contrast', getContrastColor(hex));
  document.documentElement.style.setProperty('--accent-glow', hexToRgba(hex, 0.35));
  document.documentElement.style.setProperty('--accent-glow-strong', hexToRgba(hex, 0.5));
  localStorage.setItem('cinema_accent', hex);

  if (saveToServer && state.me) {
    api('/me/accent', { method: 'PATCH', body: { accent: hex } }).catch(() => {});
  }
}

// Initial accent load
applyAccent(localStorage.getItem('cinema_accent') || DEFAULT_ACCENT);

// ---------- Auth & API ----------
function authHeader() {
  if (tg?.initData) {
    return 'tma ' + tg.initData;
  }
  // Local automated/browser testing only
  let id = localStorage.getItem('cinema_dev_id');
  if (!id) {
    id = String(Math.floor(Math.random() * 899999 + 100000));
    localStorage.setItem('cinema_dev_id', id);
  }
  let name = localStorage.getItem('cinema_dev_name') || 'Guest';
  return `dev ${id}:${encodeURIComponent(name)}`;
}

let pendingMutationsCount = 0;

async function api(path, { method = 'GET', body } = {}) {
  const isMutation = method !== 'GET';
  if (isMutation) pendingMutationsCount++;
  try {
    const headers = { Authorization: authHeader() };
    if (body && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    const res = await fetch('/api' + path, { method, headers, body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
  } finally {
    if (isMutation) pendingMutationsCount--;
  }
}

// ---------- Bottom Sheet Helpers ----------
let currentOverlay = null;
let backButtonBound = false;
let onSheetClose = null;

function openSheet(contentHtml) {
  closeSheet();
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `<div class="sheet"><div class="drag-handle"></div>${contentHtml}</div>`;

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeSheet();
  });

  document.body.appendChild(overlay);
  currentOverlay = overlay;

  if (tg?.BackButton) {
    tg.BackButton.show();
    if (!backButtonBound) {
      tg.BackButton.onClick(closeSheet);
      backButtonBound = true;
    }
  }
  return overlay.querySelector('.sheet');
}

function closeSheet() {
  if (activePosterViewer) {
    closePosterViewer();
  }
  if (currentOverlay) {
    currentOverlay.remove();
    currentOverlay = null;
  }
  if (tg?.BackButton) {
    tg.BackButton.hide();
    if (backButtonBound) {
      tg.BackButton.offClick(closeSheet);
      backButtonBound = false;
    }
  }
  if (onSheetClose) {
    const cb = onSheetClose;
    onSheetClose = null;
    cb();
  }
}

function confirmSheet({ title, message, confirmText = 'Delete', cancelText = 'Cancel' }) {
  return new Promise((resolve) => {
    const s = openSheet(`
      <h2 class="sheet-title display">${esc(title)}</h2>
      <div style="color:var(--muted); font-size:14px; line-height:1.5; margin-bottom:20px;">
        ${esc(message)}
      </div>
      <div class="action-stack" style="justify-content:center;">
        <button type="button" class="btn danger" id="confirmYes">${esc(confirmText)}</button>
        <button type="button" class="btn" id="confirmNo">${esc(cancelText)}</button>
      </div>
    `);
    let resolved = false;
    const finish = (val) => {
      if (resolved) return;
      resolved = true;
      onSheetClose = null;
      closeSheet();
      resolve(val);
    };
    s.querySelector('#confirmYes').onclick = () => finish(true);
    s.querySelector('#confirmNo').onclick = () => finish(false);
    onSheetClose = () => {
      if (!resolved) {
        resolved = true;
        resolve(false);
      }
    };
  });
}

function promptSheet({ title, message, placeholder = '', initialValue = '' }) {
  return new Promise((resolve) => {
    const s = openSheet(`
      <h2 class="sheet-title display">${esc(title)}</h2>
      <div style="color:var(--muted); font-size:14px; line-height:1.4; margin-bottom:16px;">
        ${esc(message || '')}
      </div>
      <input type="text" id="promptInput" value="${esc(initialValue)}" placeholder="${esc(placeholder)}" maxlength="40" style="width:100%; margin-bottom:16px;">
      <div class="action-stack" style="justify-content:center;">
        <button type="button" class="btn primary" id="promptOk">OK</button>
        <button type="button" class="btn" id="promptCancel">Cancel</button>
      </div>
    `);
    let resolved = false;
    const finish = (val) => {
      if (resolved) return;
      resolved = true;
      onSheetClose = null;
      closeSheet();
      resolve(val);
    };
    const inp = s.querySelector('#promptInput');
    setTimeout(() => inp?.focus(), 100);
    s.querySelector('#promptOk').onclick = () => finish(inp.value);
    s.querySelector('#promptCancel').onclick = () => finish(null);
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(inp.value);
      if (e.key === 'Escape') finish(null);
    });
    onSheetClose = () => {
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
    };
  });
}

// ---------- Application State ----------
const state = {
  me: null,
  parties: [],
  partyId: Number(localStorage.getItem('cinema_party_id')) || null,
  movies: [],
  folders: [],
  customTags: [],
  inviteBase: '',
  tab: 'together', // 'together' | 'mine' | 'others'
  status: 'want', // 'want' | 'watched'
  selectedTag: null, // active hashtag filter
  selectedFolder: null, // active folder ID or null
  sortBy: 'date', // 'date' | 'alpha_asc' | 'alpha_desc'
  searchQuery: '', // active text search query
  loading: true,
};

function parseTags(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    const set = new Set();
    for (const t of raw) {
      const s = String(t || '').trim().toLowerCase();
      if (s) set.add(s.startsWith('#') ? s : '#' + s);
    }
    return Array.from(set);
  }
  const str = String(raw);
  const matches = str.match(/#[a-zA-Z0-9а-яА-ЯёЁ_-]+/g);
  if (matches) {
    const set = new Set();
    matches.forEach((t) => set.add(t.toLowerCase()));
    return Array.from(set);
  }
  return str
    .split(/[\s,]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .map((t) => (t.startsWith('#') ? t : `#${t}`));
}

function tabMovies() {
  const myId = state.me?.id;
  return state.movies.filter((m) => {
    if (m.status !== state.status) return false;
    if (state.tab === 'together') return m.kind === 'together';
    if (state.tab === 'mine') {
      if (state.status === 'watched') {
        return (m.kind === 'personal' && m.added_by === myId) || m.kind === 'together';
      }
      return m.kind === 'personal' && m.added_by === myId;
    }
    return m.kind === 'personal' && m.added_by !== myId;
  });
}

function partyTags() {
  const counts = new Map();
  let candidates = tabMovies();
  if (state.selectedFolder) {
    candidates = candidates.filter((m) => m.folder_id === state.selectedFolder);
  }
  for (const m of candidates) {
    const tags = parseTags(m.tags);
    for (const t of tags) {
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
}

const currentParty = () => state.parties.find((p) => p.id === state.partyId);

const otherMemberName = () => {
  const p = currentParty();
  if (!p) return 'Friend';
  const others = (p.members || []).filter((m) => m.id !== state.me.id);
  if (others.length === 1) {
    return others[0].first_name || 'Friend';
  }
  return 'Others';
};

async function loadInitialData() {
  const data = await api('/me');
  state.me = data.user;
  state.parties = data.parties;
  state.inviteBase = data.invite_base;
  state.customTags = Array.isArray(data.user?.custom_tags) ? data.user.custom_tags : [];

  if (data.user?.accent) {
    applyAccent(data.user.accent);
  }

  if (!currentParty()) {
    state.partyId = state.parties[0]?.id || null;
    if (state.partyId) localStorage.setItem('cinema_party_id', state.partyId);
  }
}

async function saveCustomTags(tags) {
  try {
    const res = await api('/me/custom-tags', {
      method: 'PATCH',
      body: { tags },
    });
    state.customTags = res.tags || [];
    return state.customTags;
  } catch (e) {
    toast(e.message || 'Failed to save tag');
    return state.customTags;
  }
}

async function loadPartyFolders() {
  if (!state.partyId) {
    state.folders = [];
    state.selectedFolder = null;
    return;
  }
  const data = await api(
    `/parties/${state.partyId}/folders?tab=${encodeURIComponent(state.tab)}&status=${encodeURIComponent(state.status)}`
  );
  state.folders = data.folders || [];
  if (state.selectedFolder && !state.folders.some((f) => f.id === state.selectedFolder)) {
    state.selectedFolder = null;
  }
}

async function loadPartyMovies() {
  if (!state.partyId) {
    state.movies = [];
    state.folders = [];
    state.selectedFolder = null;
    return;
  }
  const [data] = await Promise.all([
    api(`/parties/${state.partyId}/movies`),
    loadPartyFolders(),
  ]);
  state.movies = data.movies || [];
}

async function refreshAll() {
  await loadInitialData();
  await loadPartyMovies();
  state.loading = false;
  render();
}

// ---------- UI Rendering ----------
function parseDbDate(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
    s = s.replace(' ', 'T') + 'Z';
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(s)) {
    s += 'Z';
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatShortDate(raw) {
  const d = parseDbDate(raw);
  if (!d) return '';
  try {
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString(
      'en-US',
      sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }
    );
  } catch {
    return '';
  }
}

function darkenHex(hex, amount = 0.3) {
  const clean = /^#[0-9A-Fa-f]{6}$/.test(hex || '') ? hex : '#D71921';
  const n = parseInt(clean.slice(1), 16);
  const r = Math.max(0, Math.round(((n >> 16) & 255) * (1 - amount)));
  const g = Math.max(0, Math.round(((n >> 8) & 255) * (1 - amount)));
  const b = Math.max(0, Math.round((n & 255) * (1 - amount)));
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function renderFolderIcon(color = '#D71921', size = 64) {
  const front = /^#[0-9A-Fa-f]{6}$/.test(color || '') ? color : '#D71921';
  const back = darkenHex(front, 0.3);
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <path d="M8 17C8 13.6863 10.6863 11 14 11H24.6C26.4 11 28.1 11.8 29.2 13.2L31.4 16H50C53.3137 16 56 18.6863 56 22V26H8V17Z" fill="${esc(back)}"/>
      <rect x="6" y="21" width="52" height="33" rx="7" fill="${esc(front)}" fill-opacity="0.92"/>
      <rect x="6" y="21" width="52" height="33" rx="7" stroke="rgba(255,255,255,0.22)" stroke-width="1"/>
    </svg>
  `;
}

function renderFolderTile(folder) {
  const count = Number(folder.movie_count || 0);
  const countLabel = `${count} ${count === 1 ? 'movie' : 'movies'}`;
  const ownerSub = state.tab === 'others' && folder.owner_name
    ? `<div class="folder-owner-sub">${esc(folder.owner_name)}</div>`
    : '';
  return `
    <button type="button" class="folder-tile" data-folder-id="${folder.id}">
      <div class="folder-icon-wrap">${renderFolderIcon(folder.color, 64)}</div>
      <div class="folder-name">${esc(folder.name)}</div>
      <div class="folder-count">${countLabel}</div>
      ${ownerSub}
    </button>
  `;
}

function visibleMovies() {
  const sq = (state.searchQuery || '').trim().toLowerCase();
  const selectedTag = state.selectedTag ? state.selectedTag.toLowerCase() : null;
  const shownFolderIds = new Set(state.folders.map((f) => f.id));

  const filtered = tabMovies().filter((m) => {
    if (state.selectedFolder) {
      if (m.folder_id !== state.selectedFolder) return false;
    } else if (!sq && !selectedTag) {
      if (m.folder_id && shownFolderIds.has(m.folder_id)) return false;
    }

    if (selectedTag) {
      const mTags = parseTags(m.tags);
      if (!mTags.includes(selectedTag)) return false;
    }

    if (sq) {
      const titleMatch = (m.title || '').toLowerCase().includes(sq);
      const noteMatch = (m.note || '').toLowerCase().includes(sq);
      const tagsMatch = (m.tags || '').toLowerCase().includes(sq);
      const yearMatch = String(m.year || '').includes(sq);
      if (!titleMatch && !noteMatch && !tagsMatch && !yearMatch) return false;
    }

    return true;
  });

  if (state.sortBy === 'alpha_asc') {
    return [...filtered].sort((a, b) =>
      (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' })
    );
  }
  if (state.sortBy === 'alpha_desc') {
    return [...filtered].sort((a, b) =>
      (b.title || '').localeCompare(a.title || '', undefined, { sensitivity: 'base' })
    );
  }
  return filtered;
}

function hashString(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
  }
  return h >>> 0;
}

function hashMovie(m) {
  return [
    m.title || '',
    m.poster || '',
    m.status || '',
    m.rating || '',
    m.tags || '',
    m.year || '',
    m.note ? hashString(String(m.note)) : 0,
    m.kind || '',
    m.added_by_name || '',
    m.folder_id || '',
    m.created_at || '',
    m.watched_at || '',
  ].join('|');
}

function renderCard(m) {
  const tagBadge =
    m.kind === 'together' && state.tab !== 'together'
      ? `<span class="tag-badge accent">Together</span>`
      : '';
  const ratingBadge =
    m.status === 'watched' && m.rating
      ? `<span class="rating-badge">${m.rating}/5</span>`
      : '';

  const posterHtml = m.poster
    ? `<img src="${esc(m.poster)}" alt="${esc(m.title)}" loading="lazy" onerror="this.onerror=null;this.replaceWith(Object.assign(document.createElement('div'),{className:'poster-ph',textContent:'${esc(m.title)}'}))">`
    : `<div class="poster-ph">${esc(m.title)}</div>`;

  let meta = '';
  if (state.tab === 'others') {
    meta = esc(m.added_by_name || 'Friend');
  } else if (state.tab === 'together') {
    const parts = [];
    if (m.year) parts.push(esc(m.year));
    parts.push(`Added by ${esc(m.added_by_name || 'Friend')}`);
    meta = parts.join(' · ');
  } else if (m.year) {
    meta = esc(m.year);
  }

  const dateRaw = m.status === 'watched' && m.watched_at ? m.watched_at : m.created_at;
  const dateText = formatShortDate(dateRaw);
  const dateLabel = dateText
    ? (m.status === 'watched' && m.watched_at ? `Watched ${dateText}` : `Added ${dateText}`)
    : '';

  const tags = parseTags(m.tags);
  const tagsHtml = tags.length
    ? `<div class="card-tags">${tags.slice(0, 2).map((t) => `<span class="movie-tag">${esc(t)}</span>`).join('')}${tags.length > 2 ? `<span class="movie-tag more">+${tags.length - 2}</span>` : ''}</div>`
    : '';

  return `
    <button class="card" data-id="${m.id}" data-hash="${esc(hashMovie(m))}">
      <div class="poster-box">
        ${posterHtml}
        ${tagBadge}
        ${ratingBadge}
      </div>
      <div class="card-title">${esc(m.title)}</div>
      ${meta ? `<div class="card-meta">${meta}</div>` : ''}
      ${dateLabel ? `<div class="card-date">${esc(dateLabel)}</div>` : ''}
      ${tagsHtml}
    </button>
  `;
}

function emptyMessage() {
  if (state.searchQuery || state.selectedTag) {
    return 'No movies match current filter or search.';
  }
  if (state.selectedFolder) {
    return state.status === 'watched'
      ? 'No watched movies in this folder yet.'
      : 'No movies in this folder yet.';
  }
  if (state.status === 'watched') {
    return state.tab === 'together'
      ? 'No watched movies together yet.'
      : 'No movies marked as watched in this list.';
  }
  if (state.tab === 'together') return 'Add movies to watch together with friends.';
  if (state.tab === 'mine') return 'Your personal watchlist.';
  return `${esc(otherMemberName())} has not added any personal movies yet.`;
}

function emptyStateHtml() {
  return `
    <div class="empty-box">
      <div class="dotted-illustration">
        <span></span><span></span><span></span><span></span>
        <span></span><span class="active"></span><span></span><span></span>
        <span></span><span></span><span class="active"></span><span></span>
        <span></span><span></span><span></span><span></span>
      </div>
      <div class="empty-text">${emptyMessage()}</div>
    </div>
  `;
}

function createCardEl(m) {
  const tpl = document.createElement('template');
  tpl.innerHTML = renderCard(m).trim();
  return tpl.content.firstElementChild;
}

let filterSearchTimer = null;

const SORT_OPTIONS = [
  { value: 'date', label: 'Date added (newest first)', shortLabel: 'Newest' },
  { value: 'alpha_asc', label: 'A → Z', shortLabel: 'A → Z' },
  { value: 'alpha_desc', label: 'Z → A', shortLabel: 'Z → A' },
];

function refreshMoviesContainer() {
  const container = $app.querySelector('#moviesContainer');
  if (!container) return;

  const breadcrumbEl = container.querySelector('#folderBreadcrumb');
  const foldersEl = container.querySelector('#foldersContainer');
  const gridContainer = container.querySelector('#gridContainer') || container;

  const activeFolder = state.selectedFolder
    ? state.folders.find((f) => f.id === state.selectedFolder)
    : null;
  if (state.selectedFolder && !activeFolder) {
    state.selectedFolder = null;
  }

  if (breadcrumbEl) {
    breadcrumbEl.innerHTML = activeFolder
      ? `
        <div class="folder-breadcrumb">
          <button type="button" class="folder-back-btn" id="folderBackBtn">
            <svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"></polyline></svg>
            Back to all
          </button>
          <div class="folder-crumb-title">
            <span class="folder-crumb-dot" style="background:${esc(activeFolder.color)}"></span>
            <span>${esc(activeFolder.name)}</span>
          </div>
        </div>
      `
      : '';
  }

  const showFolders = !state.selectedFolder
    && !(state.searchQuery || '').trim()
    && !state.selectedTag
    && state.folders.length > 0;

  if (foldersEl) {
    if (showFolders) {
      foldersEl.className = 'folders-grid';
      foldersEl.innerHTML = state.folders.map(renderFolderTile).join('');
    } else {
      foldersEl.className = '';
      foldersEl.innerHTML = '';
    }
  }

  const list = visibleMovies();

  // Empty state
  if (list.length === 0) {
    if (showFolders) {
      gridContainer.innerHTML = '';
    } else if (!gridContainer.querySelector('.empty-box')) {
      gridContainer.innerHTML = emptyStateHtml();
    } else {
      const txt = gridContainer.querySelector('.empty-text');
      if (txt) txt.textContent = emptyMessage();
    }
    return;
  }

  // Ensure grid exists
  let grid = gridContainer.querySelector('.grid');
  if (!grid) {
    gridContainer.innerHTML = '<div class="grid"></div>';
    grid = gridContainer.querySelector('.grid');
  }

  const wantedIds = new Set(list.map((m) => m.id));

  // Remove cards not in list
  grid.querySelectorAll('.card').forEach((card) => {
    if (!wantedIds.has(Number(card.dataset.id))) card.remove();
  });

  // Build lookup of existing cards
  const existing = new Map();
  grid.querySelectorAll('.card').forEach((c) => existing.set(Number(c.dataset.id), c));

  // Insert/reorder in place
  list.forEach((m, index) => {
    let card = existing.get(m.id);
    const newHash = hashMovie(m);
    if (!card) {
      card = createCardEl(m);
      existing.set(m.id, card);
    } else if (card.dataset.hash !== newHash) {
      const newCard = createCardEl(m);
      card.replaceWith(newCard);
      card = newCard;
      existing.set(m.id, card);
    }
    const current = grid.children[index];
    if (current !== card) {
      grid.insertBefore(card, current || null);
    }
  });

  // Remove any extra trailing cards (safety)
  while (grid.children.length > list.length) {
    grid.lastElementChild.remove();
  }
}

function renderFilterSection() {
  const tagsList = partyTags();
  const activeSort = SORT_OPTIONS.find((o) => o.value === state.sortBy) || SORT_OPTIONS[0];
  return `
    <div class="filter-section">
      <div class="filter-search-row">
        <div class="list-search-wrap">
          <svg class="list-search-icon" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input type="text" class="list-search-input" id="listSearchInput" placeholder="Search title, year, #tag..." value="${esc(state.searchQuery)}">
          ${state.searchQuery ? `<button type="button" class="list-search-clear" id="listSearchClear">&times;</button>` : ''}
        </div>
        <div class="sort-wrap" id="sortWrap">
          <button type="button" class="sort-btn ${state.sortBy !== 'date' ? 'active' : ''}" id="sortBtn" aria-label="Sort movies">
            <svg viewBox="0 0 24 24">
              <line x1="4" y1="6" x2="14" y2="6"></line>
              <line x1="4" y1="12" x2="11" y2="12"></line>
              <line x1="4" y1="18" x2="8" y2="18"></line>
              <polyline points="15 15 18 18 21 15"></polyline>
              <line x1="18" y1="6" x2="18" y2="18"></line>
            </svg>
            <span id="sortBtnLabel">${esc(activeSort.shortLabel)}</span>
          </button>
          <div class="sort-dropdown hidden" id="sortDropdown">
            ${SORT_OPTIONS.map((opt) => `
              <button type="button" class="sort-option ${state.sortBy === opt.value ? 'active' : ''}" data-sort="${opt.value}">
                <span>${esc(opt.label)}</span>
                ${state.sortBy === opt.value ? '<span>✓</span>' : ''}
              </button>
            `).join('')}
          </div>
        </div>
      </div>
      ${
        tagsList.length
          ? `
            <div class="tag-filter-bar" id="tagFilterBar">
              <button type="button" class="tag-filter-chip ${!state.selectedTag ? 'active' : ''}" data-tag="">All</button>
              ${tagsList
                .map(
                  ([t, count]) => `
                    <button type="button" class="tag-filter-chip ${state.selectedTag === t ? 'active' : ''}" data-tag="${esc(t)}">
                      ${esc(t)} <span class="tag-chip-count">${count}</span>
                    </button>
                  `
                )
                .join('')}
            </div>
          `
          : ''
      }
    </div>
  `;
}

function bindFilterEvents() {
  const input = $app.querySelector('#listSearchInput');
  const clearBtn = $app.querySelector('#listSearchClear');
  const sortBtn = $app.querySelector('#sortBtn');
  const sortDropdown = $app.querySelector('#sortDropdown');

  if (input) {
    input.oninput = (e) => {
      state.searchQuery = e.target.value;
      if (clearBtn) clearBtn.style.display = state.searchQuery ? 'grid' : 'none';
      clearTimeout(filterSearchTimer);
      filterSearchTimer = setTimeout(refreshMoviesContainer, 320);
    };
  }

  if (clearBtn) {
    clearBtn.onclick = () => {
      clearTimeout(filterSearchTimer);
      state.searchQuery = '';
      if (input) input.value = '';
      clearBtn.style.display = 'none';
      refreshMoviesContainer();
    };
  }

  if (sortBtn && sortDropdown) {
    sortBtn.onclick = (e) => {
      e.stopPropagation();
      $app.querySelector('#fabMenu')?.classList.add('hidden');
      $app.querySelector('#fabBtn')?.classList.remove('open');
      sortDropdown.classList.toggle('hidden');
      haptic('light');
    };

    sortDropdown.querySelectorAll('.sort-option').forEach((optBtn) => {
      optBtn.onclick = (e) => {
        e.stopPropagation();
        const nextSort = optBtn.dataset.sort;
        if (!nextSort) return;
        state.sortBy = nextSort;
        const activeSort = SORT_OPTIONS.find((o) => o.value === nextSort) || SORT_OPTIONS[0];
        const lbl = $app.querySelector('#sortBtnLabel');
        if (lbl) lbl.textContent = activeSort.shortLabel;
        sortBtn.classList.toggle('active', state.sortBy !== 'date');
        sortDropdown.querySelectorAll('.sort-option').forEach((btn) => {
          const isMatch = btn.dataset.sort === state.sortBy;
          btn.classList.toggle('active', isMatch);
          const item = SORT_OPTIONS.find((o) => o.value === btn.dataset.sort);
          btn.innerHTML = `<span>${esc(item?.label || '')}</span>${isMatch ? '<span>✓</span>' : ''}`;
        });
        sortDropdown.classList.add('hidden');
        haptic('light');
        refreshMoviesContainer();
      };
    });
  }

  $app.querySelectorAll('#tagFilterBar .tag-filter-chip').forEach((chip) => {
    chip.onclick = () => {
      const tag = chip.dataset.tag || null;
      state.selectedTag = state.selectedTag === tag ? null : tag;
      haptic('light');
      $app.querySelectorAll('#tagFilterBar .tag-filter-chip').forEach((c) => {
        const isAll = !c.dataset.tag;
        c.classList.toggle('active', isAll ? !state.selectedTag : c.dataset.tag === state.selectedTag);
      });
      refreshMoviesContainer();
    };
  });
}

function switchTab(newTab) {
  if (state.tab === newTab) return;
  state.tab = newTab;
  state.selectedFolder = null;
  state.folders = [];
  const availableTags = partyTags().map(([t]) => t);
  if (state.selectedTag && !availableTags.includes(state.selectedTag)) {
    state.selectedTag = null;
  }
  render();
  loadPartyFolders().then(() => {
    refreshMoviesContainer();
  }).catch(() => {});
}

function switchStatus(newStatus) {
  if (state.status === newStatus) return;
  state.status = newStatus;
  const tagsInNewStatus = partyTags().map(([t]) => t);
  if (state.selectedTag && !tagsInNewStatus.includes(state.selectedTag)) {
    state.selectedTag = null;
  }
  render();
  loadPartyFolders().then(() => {
    refreshMoviesContainer();
  }).catch(() => {});
}

function render() {
  const scrollY = window.scrollY;

  if (state.loading) {
    $app.innerHTML = '<div class="spinner">Loading...</div>';
    return;
  }

  if (!state.partyId || !currentParty()) {
    renderWelcome();
    return;
  }

  const p = currentParty();
  const membersCount = (p.members || []).length;
  const avatarsHtml = (p.members || [])
    .slice(0, 3)
    .map((m) => {
      if (m.avatar_url) {
        return `<div class="avatar"><img src="${esc(m.avatar_url)}" alt=""></div>`;
      }
      return `<div class="avatar"><span>${esc((m.name || m.first_name || 'F').slice(0, 1).toUpperCase())}</span></div>`;
    })
    .join('');

  const userAvatarHtml = state.me?.avatar_url
    ? `<img src="${esc(state.me.avatar_url)}" alt="">`
    : `<span>${esc((state.me?.custom_name || state.me?.display_name || state.me?.first_name || 'U').slice(0, 1).toUpperCase())}</span>`;

  const otherTabLabel = otherMemberName();

  $app.innerHTML = `
    <div class="screen">
      <header class="topbar">
        <button class="pill-tablet party-pill" id="partySelectBtn" aria-label="Select Party">
          <svg class="pill-icon-svg" viewBox="0 0 24 24">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
            <circle cx="9" cy="7" r="4"></circle>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
          </svg>
          <span class="pill-label">${esc(p.name)}</span>
          <span class="pill-count-badge">· ${membersCount}</span>
          <svg class="pill-chevron-svg" viewBox="0 0 24 24">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>

        <button class="pill-tablet profile-pill" id="profileBtn" aria-label="Profile">
          <div class="pill-avatar-circle">${userAvatarHtml}</div>
          <span class="pill-label">${esc(state.me?.custom_name || state.me?.display_name || state.me?.first_name || 'Profile')}</span>
        </button>
      </header>

      <nav class="tabs">
        <button class="tab ${state.tab === 'together' ? 'active' : ''}" data-tab="together"><span>Together</span></button>
        <button class="tab ${state.tab === 'mine' ? 'active' : ''}" data-tab="mine"><span>Mine</span></button>
        <button class="tab ${state.tab === 'others' ? 'active' : ''}" data-tab="others"><span>${esc(otherTabLabel)}</span></button>
      </nav>

      <div class="seg-control">
        <button class="seg-btn ${state.status === 'want' ? 'active' : ''}" data-status="want">Want to watch</button>
        <button class="seg-btn ${state.status === 'watched' ? 'active' : ''}" data-status="watched">Watched</button>
      </div>

      ${renderFilterSection()}

      <div id="moviesContainer">
        <div id="folderBreadcrumb"></div>
        <div id="foldersContainer"></div>
        <div id="gridContainer"></div>
      </div>
    </div>

    ${
      state.tab !== 'others'
        ? `
          <div class="fab-container" id="fabContainer">
            <div class="fab-menu hidden" id="fabMenu">
              <button type="button" class="fab-menu-item" id="fabAddMovieBtn">
                <svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line></svg>
                <span>Add Movie</span>
              </button>
              <button type="button" class="fab-menu-item" id="fabCreateFolderBtn">
                <svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                <span>Create Folder</span>
              </button>
            </div>
            <button type="button" class="fab" id="fabBtn" aria-label="Actions">
              <svg viewBox="0 0 24 24">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
          </div>
        `
        : ''
    }
  `;

  $app.querySelector('#partySelectBtn').onclick = openPartySheet;
  $app.querySelector('#profileBtn').onclick = openProfileSheet;
  bindFilterEvents();
  refreshMoviesContainer();
  const fabBtn = $app.querySelector('#fabBtn');
  const fabMenu = $app.querySelector('#fabMenu');
  if (fabBtn && fabMenu) {
    fabBtn.onclick = (e) => {
      e.stopPropagation();
      $app.querySelector('#sortDropdown')?.classList.add('hidden');
      const willOpen = fabMenu.classList.contains('hidden');
      fabMenu.classList.toggle('hidden', !willOpen);
      fabBtn.classList.toggle('open', willOpen);
      haptic('light');
    };
    $app.querySelector('#fabAddMovieBtn').onclick = () => {
      fabMenu.classList.add('hidden');
      fabBtn.classList.remove('open');
      haptic('medium');
      openMovieEditor();
    };
    $app.querySelector('#fabCreateFolderBtn').onclick = () => {
      fabMenu.classList.add('hidden');
      fabBtn.classList.remove('open');
      haptic('medium');
      openFolderEditor();
    };
  }

  $app.querySelectorAll('[data-tab]').forEach((b) => {
    b.onclick = () => {
      haptic('light');
      switchTab(b.dataset.tab);
    };
  });

  $app.querySelectorAll('[data-status]').forEach((b) => {
    b.onclick = () => {
      haptic('light');
      switchStatus(b.dataset.status);
    };
  });

  if (scrollY > 0) {
    window.scrollTo(0, scrollY);
  }
}

// ---------- Welcome Screen ----------
function renderWelcome() {
  $app.innerHTML = `
    <div class="screen" style="padding-top:12vh; text-align:center;">
      <h1 class="display" style="font-size:28px; margin-bottom:8px;">Cinema Party</h1>
      <p style="color:var(--muted); font-size:14px; margin-bottom:32px;">Shared movie tracking with friends.</p>

      <div style="display:grid; gap:12px; text-align:left;">
        <label class="form-field">
          <span class="form-label">Create a new party</span>
          <input type="text" id="newPartyName" placeholder="e.g. Movie Nights" maxlength="40">
        </label>
        <div>
          <button class="btn primary" id="createPartyBtn">Create Party</button>
        </div>

        <div style="text-align:center; color:var(--muted); font-size:12px; margin:8px 0;">OR</div>

        <label class="form-field">
          <span class="form-label">Join by invite code</span>
          <input type="text" id="joinPartyCode" placeholder="6-CHAR CODE" autocapitalize="characters" maxlength="6">
        </label>
        <div>
          <button class="btn" id="joinPartyBtn">Join Party</button>
        </div>
      </div>
    </div>
  `;

  $app.querySelector('#createPartyBtn').onclick = async () => {
    const val = $app.querySelector('#newPartyName').value.trim();
    if (!val) return toast('Please enter a party name');
    try {
      const p = await api('/parties', { method: 'POST', body: { name: val } });
      state.partyId = p.id;
      localStorage.setItem('cinema_party_id', p.id);
      await refreshAll();
      toast('Party created');
    } catch (e) {
      toast(e.message);
    }
  };

  $app.querySelector('#joinPartyBtn').onclick = async () => {
    const code = $app.querySelector('#joinPartyCode').value.trim();
    if (!code) return toast('Please enter an invite code');
    try {
      const res = await api('/parties/join', { method: 'POST', body: { code } });
      state.partyId = res.id;
      localStorage.setItem('cinema_party_id', res.id);
      await refreshAll();
      toast('Joined party');
    } catch (e) {
      toast(e.message);
    }
  };
}

// ---------- Folder Sheets (Create / Rename / Context / Delete / Move Movie) ----------
function openFolderEditor(folder = null, options = {}) {
  const isEdit = Boolean(folder);
  const targetKind = folder?.kind || options.kind || (state.tab === 'mine' ? 'personal' : 'together');
  let selectedColor = /^#[0-9A-Fa-f]{6}$/.test(folder?.color || '') ? folder.color : '#D71921';

  const s = openSheet(`
    <h2 class="sheet-title display">${isEdit ? 'Edit Folder' : 'New Folder'}</h2>
    <div class="folder-editor-preview" id="folderIconPreview">
      ${renderFolderIcon(selectedColor, 64)}
    </div>
    <div class="field">
      <label class="field-label" for="folderNameInput">Folder Name</label>
      <input type="text" id="folderNameInput" maxlength="40" value="${esc(folder?.name || '')}" placeholder="e.g. Weekend Watchlist">
    </div>
    <div class="field">
      <label class="field-label">Color</label>
      <div class="swatches" id="folderSwatchRow">
        ${PRESET_SWATCHES.map((hex) => `
          <button type="button" class="swatch ${selectedColor.toLowerCase() === hex.toLowerCase() ? 'active' : ''}" data-color="${hex}" style="background:${hex};" aria-label="Color ${hex}"></button>
        `).join('')}
      </div>
      <div class="color-row" style="margin-top:10px;">
        <input type="color" id="folderColorPicker" value="${esc(selectedColor)}" aria-label="Custom folder color">
        <span style="font-size:13px; color:var(--muted);">Custom color</span>
      </div>
    </div>
    <div class="action-stack">
      <button type="button" class="btn primary" id="saveFolderBtn">${isEdit ? 'Save' : 'Create'}</button>
      <button type="button" class="btn" id="cancelFolderBtn">Cancel</button>
    </div>
  `);

  const nameInput = s.querySelector('#folderNameInput');
  const previewEl = s.querySelector('#folderIconPreview');
  const colorPicker = s.querySelector('#folderColorPicker');
  const saveBtn = s.querySelector('#saveFolderBtn');
  const cancelBtn = s.querySelector('#cancelFolderBtn');

  function syncColor(hex) {
    if (!/^#[0-9A-Fa-f]{6}$/.test(hex || '')) return;
    selectedColor = hex;
    previewEl.innerHTML = renderFolderIcon(selectedColor, 64);
    colorPicker.value = selectedColor;
    s.querySelectorAll('#folderSwatchRow .swatch').forEach((sw) => {
      sw.classList.toggle('active', sw.dataset.color.toLowerCase() === selectedColor.toLowerCase());
    });
  }

  s.querySelectorAll('#folderSwatchRow .swatch').forEach((sw) => {
    sw.onclick = () => {
      haptic('light');
      syncColor(sw.dataset.color);
    };
  });

  colorPicker.oninput = (e) => {
    syncColor(e.target.value);
  };

  cancelBtn.onclick = closeSheet;

  async function submitFolder() {
    const name = nameInput.value.trim();
    if (!name) {
      toast('Folder name is required');
      nameInput.focus();
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = isEdit ? 'Saving...' : 'Creating...';
    try {
      const saved = isEdit
        ? await api(`/folders/${folder.id}`, { method: 'PATCH', body: { name, color: selectedColor } })
        : await api(`/parties/${state.partyId}/folders`, {
            method: 'POST',
            body: { name, color: selectedColor, kind: targetKind },
          });
      hapticNotice('success');
      closeSheet();
      if (typeof options.onCreated === 'function') {
        await options.onCreated(saved);
      } else {
        toast(isEdit ? 'Folder updated' : 'Folder created');
      }
      await loadPartyMovies();
      render();
    } catch (err) {
      toast(err.message || 'Failed to save folder');
      saveBtn.disabled = false;
      saveBtn.textContent = isEdit ? 'Save' : 'Create';
    }
  }

  saveBtn.onclick = submitFolder;
  nameInput.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitFolder();
    }
  };

  setTimeout(() => {
    if (options.focus === 'color') {
      colorPicker?.focus();
    } else {
      nameInput?.focus();
      if (isEdit) nameInput?.select();
    }
  }, 100);
}

function openDeleteFolderSheet(folder) {
  const count = Number(folder.total_movie_count ?? folder.movie_count ?? 0);
  const s = openSheet(`
    <h2 class="sheet-title display">Delete "${esc(folder.name)}"?</h2>
    <div style="color:var(--muted); font-size:14px; line-height:1.5; margin-bottom:20px;">
      This folder contains ${count} ${count === 1 ? 'movie' : 'movies'}. Choose what to do with them.
    </div>
    <div class="action-stack full-width">
      <button type="button" class="btn primary" id="deleteKeepMoviesBtn">Move movies out (keep them)</button>
      <button type="button" class="btn danger" id="deleteAllMoviesBtn">Delete movies too</button>
      <button type="button" class="btn" id="cancelDeleteFolderBtn">Cancel</button>
    </div>
  `);

  s.querySelector('#cancelDeleteFolderBtn').onclick = closeSheet;

  s.querySelector('#deleteKeepMoviesBtn').onclick = async () => {
    const btn = s.querySelector('#deleteKeepMoviesBtn');
    btn.disabled = true;
    try {
      await api(`/folders/${folder.id}?deleteMovies=false`, { method: 'DELETE' });
      if (state.selectedFolder === folder.id) state.selectedFolder = null;
      hapticNotice('success');
      closeSheet();
      await loadPartyMovies();
      render();
      toast('Folder deleted');
    } catch (err) {
      toast(err.message || 'Failed to delete folder');
      btn.disabled = false;
    }
  };

  s.querySelector('#deleteAllMoviesBtn').onclick = async () => {
    const ok = await confirmSheet({
      title: 'Delete Folder & Movies?',
      message: `This will permanently delete "${folder.name}" and all ${count} ${count === 1 ? 'movie' : 'movies'} inside it.`,
      confirmText: 'Delete permanently',
      cancelText: 'Cancel',
    });
    if (!ok) return;
    try {
      await api(`/folders/${folder.id}?deleteMovies=true`, { method: 'DELETE' });
      if (state.selectedFolder === folder.id) state.selectedFolder = null;
      hapticNotice('success');
      await loadPartyMovies();
      render();
      toast('Folder and movies deleted');
    } catch (err) {
      toast(err.message || 'Failed to delete folder');
    }
  };
}

function openFolderContextSheet(folder) {
  const canEdit = state.tab !== 'others' && (folder.kind === 'together' || folder.user_id === state.me?.id);
  const count = Number(folder.movie_count || 0);
  const totalCount = Number(folder.total_movie_count ?? count);
  const subText = state.tab === 'others' && folder.owner_name
    ? `${count} ${count === 1 ? 'movie' : 'movies'} · By ${folder.owner_name}`
    : `${count} ${count === 1 ? 'movie' : 'movies'} here`;

  if (!canEdit) {
    const s = openSheet(`
      <div class="folder-editor-preview" style="padding:4px 0 8px;">${renderFolderIcon(folder.color, 56)}</div>
      <h2 class="sheet-title display" style="text-align:center;">${esc(folder.name)}</h2>
      <div style="text-align:center; color:var(--muted); font-size:13px; margin-bottom:18px;">${esc(subText)}</div>
      <div class="action-stack full-width">
        <button type="button" class="btn primary" id="viewFolderBtn">View Folder</button>
        <button type="button" class="btn" id="closeFolderCtxBtn">Cancel</button>
      </div>
    `);
    s.querySelector('#viewFolderBtn').onclick = () => {
      state.selectedFolder = folder.id;
      closeSheet();
      render();
    };
    s.querySelector('#closeFolderCtxBtn').onclick = closeSheet;
    return;
  }

  const s = openSheet(`
    <div class="folder-editor-preview" style="padding:4px 0 8px;">${renderFolderIcon(folder.color, 56)}</div>
    <h2 class="sheet-title display" style="text-align:center;">${esc(folder.name)}</h2>
    <div style="text-align:center; color:var(--muted); font-size:13px; margin-bottom:18px;">${esc(subText)}</div>
    <div class="action-stack full-width">
      <button type="button" class="btn" id="renameFolderBtn">Rename</button>
      <button type="button" class="btn" id="recolorFolderBtn">Change Color</button>
      <button type="button" class="btn danger" id="deleteFolderBtn">Delete Folder</button>
      <button type="button" class="btn" id="closeFolderCtxBtn">Cancel</button>
    </div>
  `);

  s.querySelector('#renameFolderBtn').onclick = () => {
    closeSheet();
    openFolderEditor(folder, { focus: 'name' });
  };

  s.querySelector('#recolorFolderBtn').onclick = () => {
    closeSheet();
    openFolderEditor(folder, { focus: 'color' });
  };

  s.querySelector('#deleteFolderBtn').onclick = async () => {
    if (totalCount > 0) {
      openDeleteFolderSheet(folder);
      return;
    }
    const ok = await confirmSheet({
      title: 'Delete Folder?',
      message: `Delete empty folder "${folder.name}"?`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
    });
    if (!ok) return;
    try {
      await api(`/folders/${folder.id}?deleteMovies=false`, { method: 'DELETE' });
      if (state.selectedFolder === folder.id) state.selectedFolder = null;
      hapticNotice('success');
      await loadPartyMovies();
      render();
      toast('Folder deleted');
    } catch (err) {
      toast(err.message || 'Failed to delete folder');
    }
  };

  s.querySelector('#closeFolderCtxBtn').onclick = closeSheet;
}

async function openMoveToFolderSheet(movie) {
  let folders = [];
  if (
    (movie.kind === 'together' && state.tab === 'together') ||
    (movie.kind === 'personal' && state.tab === 'mine')
  ) {
    folders = state.folders;
  } else {
    try {
      const targetTab = movie.kind === 'personal' ? 'mine' : 'together';
      const data = await api(
        `/parties/${state.partyId}/folders?tab=${targetTab}&status=${encodeURIComponent(state.status)}`
      );
      folders = data.folders || [];
    } catch {
      toast('Failed to load folders');
      return;
    }
  }

  const s = openSheet(`
    <h2 class="sheet-title display">Move "${esc(movie.title)}"</h2>
    <div style="color:var(--muted); font-size:13px; margin-bottom:16px;">
      Choose a ${movie.kind === 'personal' ? 'Personal' : 'Together'} folder.
    </div>
    <div class="action-stack full-width">
      ${movie.folder_id ? `<button type="button" class="btn" id="removeFromFolderBtn">Remove from folder</button>` : ''}
      ${folders
        .map((f) => {
          const isCurrent = movie.folder_id === f.id;
          return `
            <button type="button" class="btn ${isCurrent ? 'primary' : ''}" data-move-folder-id="${f.id}" ${isCurrent ? 'disabled' : ''}>
              <span class="folder-crumb-dot" style="background:${esc(f.color)};"></span>
              <span>${esc(f.name)}${isCurrent ? ' (current)' : ''}</span>
            </button>
          `;
        })
        .join('')}
      <button type="button" class="btn primary" id="createMoveFolderBtn">+ Create new folder</button>
      <button type="button" class="btn" id="cancelMoveFolderBtn">Cancel</button>
    </div>
  `);

  s.querySelector('#cancelMoveFolderBtn').onclick = closeSheet;

  const removeBtn = s.querySelector('#removeFromFolderBtn');
  if (removeBtn) {
    removeBtn.onclick = async () => {
      removeBtn.disabled = true;
      try {
        await api(`/movies/${movie.id}`, { method: 'PATCH', body: { folder_id: null } });
        hapticNotice('success');
        closeSheet();
        await loadPartyMovies();
        render();
        toast('Removed from folder');
      } catch (err) {
        toast(err.message || 'Failed to move movie');
        removeBtn.disabled = false;
      }
    };
  }

  s.querySelectorAll('[data-move-folder-id]').forEach((btn) => {
    btn.onclick = async () => {
      const targetId = Number(btn.dataset.moveFolderId);
      btn.disabled = true;
      try {
        await api(`/movies/${movie.id}`, { method: 'PATCH', body: { folder_id: targetId } });
        hapticNotice('success');
        closeSheet();
        await loadPartyMovies();
        render();
        const targetFolder = folders.find((x) => x.id === targetId);
        toast(targetFolder ? `Moved to "${targetFolder.name}"` : 'Moved to folder');
      } catch (err) {
        toast(err.message || 'Failed to move movie');
        btn.disabled = false;
      }
    };
  });

  s.querySelector('#createMoveFolderBtn').onclick = () => {
    closeSheet();
    openFolderEditor(null, {
      kind: movie.kind,
      onCreated: async (newFolder) => {
        await api(`/movies/${movie.id}`, { method: 'PATCH', body: { folder_id: newFolder.id } });
        toast(`Moved to "${newFolder.name}"`);
      },
    });
  };
}

// ---------- Movie Detail Sheet ----------
function openMovieDetail(movieId) {
  const m = state.movies.find((x) => x.id === movieId);
  if (!m) return;

  const canEdit = m.kind === 'together' || m.added_by === state.me.id;
  const posterHtml = m.poster
    ? `<img src="${esc(m.poster)}" alt="${esc(m.title)}" onerror="this.onerror=null;this.replaceWith(Object.assign(document.createElement('div'),{className:'poster-ph',textContent:'${esc(m.title)}'}))">`
    : `<div class="poster-ph" style="padding:40px 10px;">${esc(m.title)}</div>`;

  const metaParts = [];
  if (m.year) metaParts.push(m.year);
  if (m.kind === 'together') metaParts.push('Shared');
  else metaParts.push(`Added by ${m.added_by_name || 'Friend'}`);

  const ratingHtml =
    m.status === 'watched' && m.rating
      ? `<div class="detail-rating-display">RATING: ${m.rating} / 5</div>`
      : '';

  const tags = parseTags(m.tags);
  const tagsHtml = tags.length
    ? `<div style="display:flex; flex-wrap:wrap; gap:6px; justify-content:center; margin-bottom:14px;">
        ${tags.map((t) => `<span class="movie-tag" style="padding:4px 10px; font-size:12px; cursor:pointer;" data-filtertag="${esc(t)}">${esc(t)}</span>`).join('')}
      </div>`
    : '';

  const s = openSheet(`
    <div class="detail-poster-wrap">${posterHtml}</div>
    <div class="detail-heading">${esc(m.title)}</div>
    <div class="detail-sub">${metaParts.map(esc).join(' · ')}</div>
    ${tagsHtml}
    ${ratingHtml}
    ${m.note ? `<div class="detail-note-box">${esc(m.note)}</div>` : ''}

    ${
      canEdit
        ? `
          <div class="action-stack" style="justify-content:center;">
            <button class="btn primary" id="toggleWatchBtn">
              ${
                m.status === 'want'
                  ? `<svg class="btn-icon-svg" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg> Mark as Watched`
                  : `<svg class="btn-icon-svg" viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg> Move to Want to Watch`
              }
            </button>
            <button class="btn" id="editMovieBtn">
              <svg class="btn-icon-svg" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> Edit Movie
            </button>
            <button class="btn danger" id="deleteMovieBtn">
              <svg class="btn-icon-svg" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> Delete Movie
            </button>
          </div>
        `
        : `<div style="text-align:center; color:var(--muted); font-size:12px; margin-top:14px;">Personal item (view only)</div>`
    }
  `);

  s.querySelectorAll('[data-filtertag]').forEach((chip) => {
    chip.onclick = () => {
      state.selectedTag = chip.dataset.filtertag;
      closeSheet();
      render();
    };
  });

  const posterImg = s.querySelector('.detail-poster-wrap img');
  if (posterImg && m.poster) {
    posterImg.classList.add('detail-poster-clickable');
    posterImg.style.cursor = 'pointer';
    posterImg.onclick = () => {
      openPosterViewer(m.poster, m.title);
    };
  }

  if (!canEdit) return;

  s.querySelector('#toggleWatchBtn').onclick = async () => {
    hapticNotice('success');
    const newStatus = m.status === 'want' ? 'watched' : 'want';
    try {
      await api(`/movies/${m.id}`, { method: 'PATCH', body: { status: newStatus } });
      closeSheet();
      await loadPartyMovies();
      render();
      toast(newStatus === 'watched' ? 'Marked as watched' : 'Moved to watchlist');
    } catch (e) {
      toast(e.message);
    }
  };

  s.querySelector('#editMovieBtn').onclick = () => openMovieEditor(m);

  s.querySelector('#deleteMovieBtn').onclick = async () => {
    const ok = await confirmSheet({
      title: 'Delete Movie',
      message: `"${m.title}" will be removed from this list.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
    });
    if (!ok) return;
    try {
      await api(`/movies/${m.id}`, { method: 'DELETE' });
      closeSheet();
      await loadPartyMovies();
      render();
      toast('Movie deleted');
    } catch (e) {
      toast(e.message);
    }
  };
}

// ---------- Fullscreen Poster Viewer ----------
let activePosterViewer = null;

function openPosterViewer(imageUrl, title) {
  if (!imageUrl || activePosterViewer) return;
  haptic('light');

  const overlay = document.createElement('div');
  overlay.className = 'poster-viewer-overlay';
  overlay.innerHTML = `
    <img class="poster-viewer-img" src="${esc(imageUrl)}" alt="${esc(title || '')}" draggable="false">
    <button type="button" class="poster-viewer-close" aria-label="Close">
      <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  `;
  document.body.appendChild(overlay);
  activePosterViewer = overlay;

  // Prevent body scroll while viewer is open
  const prevBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  // Telegram BackButton lifecycle
  if (tg?.BackButton) {
    try {
      if (backButtonBound) {
        tg.BackButton.offClick(closeSheet);
        backButtonBound = false;
      }
      tg.BackButton.show();
      tg.BackButton.onClick(closePosterViewer);
    } catch {}
  }

  // Keyboard escape for desktop testing
  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      closePosterViewer();
    }
  };
  window.addEventListener('keydown', onKeyDown);

  const img = overlay.querySelector('.poster-viewer-img');
  const closeBtn = overlay.querySelector('.poster-viewer-close');

  // Zoom and touch state
  let scale = 1;
  let translateX = 0;
  let translateY = 0;
  let startDist = 0;
  let startScale = 1;
  let startX = 0;
  let startY = 0;
  let touchStartX = 0;
  let touchStartY = 0;
  let baseTranslateX = 0;
  let baseTranslateY = 0;
  let swipeStartY = 0;
  let isSwiping = false;
  let isPinching = false;
  let hasMoved = false;
  let lastTapTime = 0;

  const clampScale = (s) => Math.min(4, Math.max(1, s));

  const clampPan = () => {
    if (scale <= 1) {
      translateX = 0;
      translateY = 0;
      return;
    }
    const maxX = Math.max(0, (img.offsetWidth * scale - window.innerWidth) / 2 + 30);
    const maxY = Math.max(0, (img.offsetHeight * scale - window.innerHeight) / 2 + 30);
    translateX = Math.max(-maxX, Math.min(maxX, translateX));
    translateY = Math.max(-maxY, Math.min(maxY, translateY));
  };

  const applyTransform = (animate = true) => {
    img.classList.toggle('zooming', !animate);
    img.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
  };

  const resetTransform = (animate = true) => {
    scale = 1;
    translateX = 0;
    translateY = 0;
    applyTransform(animate);
  };

  const distance = (t1, t2) => {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // Pinch-to-zoom + pan when zoomed + swipe down when scale=1
  overlay.addEventListener(
    'touchstart',
    (e) => {
      if (e.target.closest('.poster-viewer-close')) return;
      hasMoved = false;
      if (e.touches.length === 2) {
        isPinching = true;
        isSwiping = false;
        startDist = distance(e.touches[0], e.touches[1]);
        startScale = scale;
        startX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        startY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        baseTranslateX = translateX;
        baseTranslateY = translateY;
      } else if (e.touches.length === 1) {
        isPinching = false;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        swipeStartY = e.touches[0].clientY;
        baseTranslateX = translateX;
        baseTranslateY = translateY;
        if (scale > 1) {
          startX = e.touches[0].clientX;
          startY = e.touches[0].clientY;
        } else {
          isSwiping = true;
          overlay.style.transition = 'none';
        }
      }
    },
    { passive: true }
  );

  overlay.addEventListener(
    'touchmove',
    (e) => {
      if (e.target.closest('.poster-viewer-close')) return;
      if (e.touches.length === 2 && startDist > 0) {
        if (e.cancelable) e.preventDefault();
        hasMoved = true;
        const dist = distance(e.touches[0], e.touches[1]);
        scale = clampScale(startScale * (dist / startDist));
        clampPan();
        applyTransform(false);
      } else if (e.touches.length === 1) {
        const moveDist = Math.hypot(e.touches[0].clientX - touchStartX, e.touches[0].clientY - touchStartY);
        if (moveDist > 8) hasMoved = true;
        if (scale > 1) {
          if (e.cancelable) e.preventDefault();
          const dx = e.touches[0].clientX - startX;
          const dy = e.touches[0].clientY - startY;
          translateX = baseTranslateX + dx;
          translateY = baseTranslateY + dy;
          clampPan();
          applyTransform(false);
        } else if (isSwiping && scale === 1) {
          const dy = e.touches[0].clientY - swipeStartY;
          if (dy > 0) {
            if (e.cancelable) e.preventDefault();
            overlay.style.transform = `translateY(${dy * 0.6}px)`;
            overlay.style.opacity = String(Math.max(0.4, 1 - dy / 500));
          }
        }
      }
    },
    { passive: false }
  );

  overlay.addEventListener(
    'touchend',
    (e) => {
      if (e.target.closest('.poster-viewer-close')) return;
      if (isPinching && e.touches.length < 2) {
        isPinching = false;
        if (scale < 1.05) {
          resetTransform(true);
        } else {
          clampPan();
          applyTransform(true);
        }
        if (e.touches.length === 1) {
          touchStartX = e.touches[0].clientX;
          touchStartY = e.touches[0].clientY;
          startX = e.touches[0].clientX;
          startY = e.touches[0].clientY;
          baseTranslateX = translateX;
          baseTranslateY = translateY;
          isSwiping = scale <= 1;
          swipeStartY = e.touches[0].clientY;
        }
      } else if (isSwiping && scale === 1 && e.touches.length === 0) {
        const endY = e.changedTouches[0]?.clientY || 0;
        const dy = endY - swipeStartY;
        if (dy > 100) {
          closePosterViewer();
          return;
        }
        overlay.style.transition = 'transform 0.2s ease-out, opacity 0.2s ease-out';
        overlay.style.transform = '';
        overlay.style.opacity = '1';
        setTimeout(() => {
          if (overlay.parentNode) overlay.style.transition = '';
        }, 220);
        isSwiping = false;
      }
      if (e.touches.length === 0) {
        setTimeout(() => {
          hasMoved = false;
        }, 120);
      }
    },
    { passive: true }
  );

  // Double-tap to toggle zoom (centered at tap point if available)
  img.addEventListener('click', (e) => {
    if (hasMoved) return;
    const now = Date.now();
    if (now - lastTapTime < 320) {
      haptic('light');
      if (scale > 1) {
        resetTransform(true);
      } else {
        scale = 2.5;
        if (e.clientX || e.clientY) {
          const cx = window.innerWidth / 2;
          const cy = window.innerHeight / 2;
          translateX = (cx - e.clientX) * 1.5;
          translateY = (cy - e.clientY) * 1.5;
        } else {
          translateX = 0;
          translateY = 0;
        }
        clampPan();
        applyTransform(true);
      }
      lastTapTime = 0;
    } else {
      lastTapTime = now;
    }
  });

  closeBtn.addEventListener('click', closePosterViewer);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay && !hasMoved) closePosterViewer();
  });

  // Save cleanup state
  overlay._prevBodyOverflow = prevBodyOverflow;
  overlay._onKeyDown = onKeyDown;
}

function closePosterViewer() {
  if (!activePosterViewer) return;
  haptic('light');

  const overlay = activePosterViewer;
  activePosterViewer = null;

  if (overlay._onKeyDown) {
    window.removeEventListener('keydown', overlay._onKeyDown);
  }

  // Restore BackButton lifecycle
  if (tg?.BackButton) {
    try {
      tg.BackButton.offClick(closePosterViewer);
      if (currentOverlay) {
        if (!backButtonBound) {
          tg.BackButton.onClick(closeSheet);
          backButtonBound = true;
        }
        tg.BackButton.show();
      } else {
        tg.BackButton.hide();
      }
    } catch {}
  }

  document.body.style.overflow = overlay._prevBodyOverflow || '';

  overlay.classList.add('closing');
  setTimeout(() => {
    if (overlay.parentNode) overlay.remove();
  }, 200);
}

// ---------- Movie Editor (Add / Edit) ----------
async function resizeImage(file, maxW = 600) {
  const bmp = await createImageBitmap(file);
  const ratio = Math.min(1, maxW / bmp.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * ratio);
  canvas.height = Math.round(bmp.height * ratio);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        resolve(blob || file);
      },
      'image/webp',
      0.75
    );
  });
}

const DEFAULT_TAG_PRESETS = [
  '#action',
  '#comedy',
  '#drama',
  '#horror',
  '#thriller',
  '#sci-fi',
  '#animation',
  '#romance',
  '#documentary',
  '#family',
];

function renderTagChips(container, onAdd, customTags = [], onDeleteCustom = null) {
  if (!container) return;
  const all = [...customTags, ...DEFAULT_TAG_PRESETS];
  const seen = new Set();
  container.innerHTML = all
    .filter((t) => {
      const key = t.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((t) => {
      const isCustom = customTags.includes(t);
      return `<button type="button" class="tag-suggest-chip${isCustom ? ' custom' : ''}" data-addtag="${esc(t)}"${isCustom ? ' data-iscustom="1"' : ''}>+ ${esc(t)}</button>`;
    })
    .join('');

  container.querySelectorAll('[data-addtag]').forEach((chip) => {
    let pressTimer = null;
    let didLongPress = false;

    const startPress = () => {
      didLongPress = false;
      if (chip.dataset.iscustom === '1' && onDeleteCustom) {
        pressTimer = setTimeout(() => {
          didLongPress = true;
          haptic('medium');
          onDeleteCustom(chip.dataset.addtag);
        }, 500);
      }
    };

    const cancelPress = () => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    };

    chip.addEventListener('touchstart', startPress, { passive: true });
    chip.addEventListener('touchend', (e) => {
      cancelPress();
      if (didLongPress) e.preventDefault();
    });
    chip.addEventListener('touchcancel', cancelPress);
    chip.addEventListener('mousedown', startPress);
    chip.addEventListener('mouseup', cancelPress);
    chip.addEventListener('mouseleave', cancelPress);

    chip.onclick = (e) => {
      if (didLongPress) {
        e.preventDefault();
        return;
      }
      onAdd(chip.dataset.addtag);
    };
  });
}

function openMovieEditor(movie) {
  const isEdit = !!movie;
  const draft = movie
    ? {
        title: movie.title,
        year: movie.year || '',
        note: movie.note || '',
        tags: movie.tags || '',
        poster: movie.poster || '',
        kind: movie.kind,
        status: movie.status,
        rating: movie.rating || null,
      }
    : {
        title: '',
        year: '',
        note: '',
        tags: '',
        poster: '',
        kind: state.tab === 'mine' ? 'personal' : 'together',
        status: state.status,
        rating: null,
      };

  const s = openSheet(`
    <h2 class="sheet-title display">${isEdit ? 'Edit Movie' : 'Add Movie'}</h2>

    <div class="seg-control" id="kindControl">
      <button type="button" class="seg-btn ${draft.kind === 'together' ? 'active' : ''}" data-k="together">Together</button>
      <button type="button" class="seg-btn ${draft.kind === 'personal' ? 'active' : ''}" data-k="personal">Mine</button>
    </div>

    <div class="form-field">
      <span class="form-label">Title *</span>
      <div class="input-wrap">
        <input type="text" id="movieTitle" placeholder="Start typing movie title..." maxlength="120" autocomplete="off" value="${esc(draft.title)}">
        <div class="suggestions-box" id="titleSuggestions" hidden></div>
      </div>
    </div>

    <div class="cover-row">
      <div class="cover-preview" id="coverPreview"></div>
      <div class="cover-actions">
        <button type="button" class="btn" id="pickGalleryBtn">From Gallery</button>
        <button type="button" class="btn danger" id="removeCoverBtn" style="padding:10px;">Remove</button>
        <input type="file" id="coverFileInput" accept="image/*" hidden>
      </div>
    </div>

    <div class="form-row">
      <label class="form-field">
        <span class="form-label">Year</span>
        <input type="text" id="movieYear" placeholder="e.g. 2024" maxlength="4" inputmode="numeric">
      </label>
      <div class="form-field">
        <span class="form-label">Status</span>
        <div class="seg-control" id="statusControl" style="margin:0;">
          <button class="seg-btn ${draft.status === 'want' ? 'active' : ''}" data-s="want">Want</button>
          <button class="seg-btn ${draft.status === 'watched' ? 'active' : ''}" data-s="watched">Watched</button>
        </div>
      </div>
    </div>

    <div class="form-field" id="ratingContainer" style="display:${draft.status === 'watched' ? 'block' : 'none'};">
      <span class="form-label">Rating</span>
      <div class="rating-dots" id="ratingDots">
        ${[1, 2, 3, 4, 5]
          .map((n) => `<button type="button" class="rating-dot-btn ${draft.rating === n ? 'active' : ''}" data-rate="${n}">${n}</button>`)
          .join('')}
      </div>
    </div>

    <label class="form-field">
      <span class="form-label">Hashtags &amp; Categories</span>
      <input type="text" id="movieTags" placeholder="#action #comedy #drama #sci-fi..." maxlength="200" value="${esc(draft.tags)}">
      <div class="tag-suggest-chips" id="tagSuggestChips"></div>
      <button type="button" class="btn" id="addCustomTagBtn" style="margin-top:8px; height:32px; font-size:12px;">+ Add custom tag</button>
    </label>

    <label class="form-field">
      <span class="form-label">Note</span>
      <textarea id="movieNote" placeholder="Thoughts, recommendations, notes..." maxlength="500"></textarea>
    </label>

    <div class="action-stack">
      <button class="btn primary" id="saveMovieBtn">
        <svg class="btn-icon-svg" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg> Save
      </button>
      <button type="button" class="btn" id="cancelMovieBtn">Cancel</button>
    </div>
  `);

  const $ = (sel) => s.querySelector(sel);
  $('#cancelMovieBtn').onclick = closeSheet;
  $('#movieTitle').value = draft.title;
  $('#movieYear').value = draft.year;
  $('#movieNote').value = draft.note;

  const updateCoverUi = () => {
    $('#coverPreview').innerHTML = draft.poster
      ? `<img src="${esc(draft.poster)}" alt="">`
      : 'No cover';
    $('#removeCoverBtn').hidden = !draft.poster;
  };

  const updateSegUi = () => {
    s.querySelectorAll('#kindControl button').forEach((b) =>
      b.classList.toggle('active', b.dataset.k === draft.kind)
    );
    s.querySelectorAll('#statusControl button').forEach((b) =>
      b.classList.toggle('active', b.dataset.s === draft.status)
    );
    $('#ratingContainer').style.display = draft.status === 'watched' ? 'block' : 'none';
  };

  const updateRatingUi = () => {
    s.querySelectorAll('#ratingDots button').forEach((b) =>
      b.classList.toggle('active', Number(b.dataset.rate) <= (draft.rating || 0))
    );
  };

  updateCoverUi();
  updateSegUi();
  updateRatingUi();

  s.querySelectorAll('#kindControl button').forEach((b) => {
    b.onclick = () => {
      draft.kind = b.dataset.k;
      updateSegUi();
    };
  });

  s.querySelectorAll('#statusControl button').forEach((b) => {
    b.onclick = () => {
      draft.status = b.dataset.s;
      updateSegUi();
    };
  });

  s.querySelectorAll('#ratingDots button').forEach((b) => {
    b.onclick = () => {
      const val = Number(b.dataset.rate);
      draft.rating = draft.rating === val ? null : val;
      updateRatingUi();
    };
  });

  $('#removeCoverBtn').onclick = () => {
    draft.poster = '';
    updateCoverUi();
  };

  // Gallery file upload
  $('#pickGalleryBtn').onclick = () => $('#coverFileInput').click();
  $('#coverFileInput').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const btn = $('#pickGalleryBtn');
    btn.disabled = true;
    btn.textContent = 'Processing...';

    try {
      const resizedBlob = await resizeImage(file);
      const fd = new FormData();
      fd.append('file', resizedBlob, 'cover.webp');
      const res = await api('/covers', { method: 'POST', body: fd });
      draft.poster = res.url;
      updateCoverUi();
      toast('Cover uploaded');
    } catch (err) {
      toast(err.message || 'Upload failed');
    }
    btn.disabled = false;
    btn.textContent = 'From Gallery';
  };

  // Live autocomplete search as you type
  let searchTimer = null;
  let searchAbort = null;
  const suggestionsBox = $('#titleSuggestions');

  $('#movieTitle').oninput = (e) => {
    clearTimeout(searchTimer);
    if (searchAbort) {
      searchAbort.abort();
      searchAbort = null;
    }

    const val = e.target.value.trim();
    if (val.length < 2) {
      suggestionsBox.hidden = true;
      suggestionsBox.innerHTML = '';
      return;
    }

    searchTimer = setTimeout(async () => {
      searchAbort = new AbortController();
      try {
        const res = await fetch('/api/movies/search?q=' + encodeURIComponent(val), {
          headers: { Authorization: authHeader() },
          signal: searchAbort.signal,
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        const list = data.results || [];
        if (!list.length) {
          suggestionsBox.hidden = true;
          suggestionsBox.innerHTML = '';
          return;
        }

        suggestionsBox.innerHTML = list
          .map(
            (r, idx) => `
              <button class="suggestion-item" data-idx="${idx}" type="button">
                <div class="sug-poster">
                  ${r.poster ? `<img src="${esc(r.poster)}" alt="" loading="lazy">` : 'NO'}
                </div>
                <div class="sug-info">
                  <div class="sug-title">${esc(r.title)}</div>
                  <div class="sug-year">${esc(r.year || '')}</div>
                </div>
              </button>
            `
          )
          .join('');
        suggestionsBox.hidden = false;

        suggestionsBox.querySelectorAll('.suggestion-item').forEach((itemBtn) => {
          itemBtn.onclick = () => {
            const item = list[Number(itemBtn.dataset.idx)];
            $('#movieTitle').value = item.title;
            if (item.year) $('#movieYear').value = item.year;
            if (item.poster) {
              draft.poster = item.poster;
              updateCoverUi();
            }
            if (item.tags && !$('#movieTags').value.trim()) {
              $('#movieTags').value = item.tags;
              draft.tags = item.tags;
            }
            suggestionsBox.hidden = true;
            suggestionsBox.innerHTML = '';
            haptic('light');
          };
        });
      } catch (err) {
        if (err.name === 'AbortError') return;
        suggestionsBox.hidden = true;
      } finally {
        searchAbort = null;
      }
    }, 320);
  };

  s.addEventListener('click', (e) => {
    if (!e.target.closest('.input-wrap')) {
      suggestionsBox.hidden = true;
    }
  });

  // Quick tag chips in editor
  const addTagToInput = (tag) => {
    const input = $('#movieTags');
    if (!input) return;
    const current = input.value.trim();
    const existingTags = current.split(/\s+/).map((t) => t.toLowerCase());
    if (!existingTags.includes(tag.toLowerCase())) {
      input.value = current ? `${current} ${tag}` : tag;
      draft.tags = input.value;
      haptic('light');
    }
  };

  const chipsContainer = s.querySelector('#tagSuggestChips');
  const refreshChips = () => {
    renderTagChips(
      chipsContainer,
      addTagToInput,
      state.customTags,
      async (tagToDelete) => {
        const ok = await confirmSheet({
          title: 'Remove Tag',
          message: `Remove preset "${tagToDelete}"?`,
          confirmText: 'Remove',
        });
        if (ok) {
          const next = state.customTags.filter((t) => t.toLowerCase() !== tagToDelete.toLowerCase());
          await saveCustomTags(next);
          haptic('medium');
          refreshChips();
        }
      }
    );
  };
  refreshChips();

  s.querySelector('#addCustomTagBtn').onclick = async () => {
    const raw = await promptSheet({
      title: 'New tag',
      message: 'Name without # (e.g. "date_night")',
      placeholder: 'tag_name',
    });
    if (!raw) return;
    const cleaned =
      '#' +
      String(raw)
        .trim()
        .toLowerCase()
        .replace(/[^\wа-яё-]/gi, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
    if (cleaned === '#') return;

    if (!state.customTags.includes(cleaned)) {
      const next = [...state.customTags, cleaned];
      await saveCustomTags(next);
      addTagToInput(cleaned);
      haptic('light');
      refreshChips();
    } else {
      addTagToInput(cleaned);
    }
  };

  // Save movie
  $('#saveMovieBtn').onclick = async () => {
    const title = $('#movieTitle').value.trim();
    const year = $('#movieYear').value.trim();
    const note = $('#movieNote').value.trim();
    const tags = $('#movieTags').value.trim();

    if (!title) {
      toast('Title is required');
      $('#movieTitle').focus();
      return;
    }

    const payload = {
      title,
      year: year || null,
      note: note || null,
      tags: tags || '',
      poster: draft.poster || null,
      kind: draft.kind,
      status: draft.status,
      rating: draft.status === 'watched' ? draft.rating : null,
    };
    if (!isEdit && state.selectedFolder) {
      const activeFolder = state.folders.find((f) => f.id === state.selectedFolder);
      if (activeFolder && activeFolder.kind === draft.kind) {
        payload.folder_id = activeFolder.id;
      }
    }

    const saveBtn = $('#saveMovieBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
      if (isEdit) {
        await api(`/movies/${movie.id}`, { method: 'PATCH', body: payload });
      } else {
        await api(`/parties/${state.partyId}/movies`, { method: 'POST', body: payload });
      }
      hapticNotice('success');
      closeSheet();
      await loadPartyMovies();
      render();
      toast(isEdit ? 'Saved' : 'Movie added');
    } catch (err) {
      toast(err.message || 'Failed to save');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  };
}

// ---------- Party Sheet ----------
function openPartySheet() {
  const p = currentParty();
  if (!p) return;

  const link = state.inviteBase ? `${state.inviteBase}${p.code}` : p.code;

  const s = openSheet(`
    <h2 class="sheet-title display">${esc(p.name)}</h2>

    <div class="form-label" style="margin-bottom:8px;">Members in this Room (${(p.members || []).length})</div>
    <div style="margin-bottom:14px;">
      ${(p.members || [])
        .map(
          (m) => `
            <div class="member-row">
              <div class="avatar" style="width:40px; height:40px; min-width:40px; min-height:40px; border-radius:50%; overflow:hidden; flex-shrink:0;">
                ${
                  m.avatar_url
                    ? `<img src="${esc(m.avatar_url)}" alt="" style="width:100%; height:100%; object-fit:cover; display:block; border-radius:50%;">`
                    : `<span>${esc((m.name || m.first_name || 'F').slice(0, 1).toUpperCase())}</span>`
                }
              </div>
              <div class="member-info">
                <div class="member-title">${esc(m.name || m.first_name || 'Friend')}${m.id === state.me?.id ? ' (You)' : ''}</div>
                <div class="member-sub">${m.username ? '@' + esc(m.username) : 'Active'}</div>
              </div>
            </div>
          `
        )
        .join('')}
    </div>

    <div class="section-divider"></div>
    <div style="font-size:12px; color:var(--muted); text-transform:uppercase;">Invite Code</div>
    <div class="code-badge">${esc(p.code)}</div>

    <div class="action-stack">
      <button class="btn primary" id="shareInviteBtn">
        <svg class="btn-icon-svg" viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> Share Invite Link
      </button>
      <button class="btn" id="createAnotherPartyBtn">
        <svg class="btn-icon-svg" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Other Parties
      </button>
      <button class="btn danger" id="leavePartyBtn">
        <svg class="btn-icon-svg" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg> Leave Party
      </button>
    </div>

    ${
      state.parties.length > 1
        ? `
          <div class="section-divider"></div>
          <div style="font-size:12px; color:var(--muted); text-transform:uppercase; margin-bottom:8px;">Switch Party</div>
          ${state.parties
            .map(
              (x) => `
                <button type="button" class="party-card-item ${x.id === state.partyId ? 'active' : ''}" data-pid="${x.id}">
                  <div style="font-weight:600;">${esc(x.name)}</div>
                  <div style="font-size:12px; color:var(--muted);">${(x.members || []).map((m) => esc(m.name || m.first_name)).join(', ')}</div>
                </button>
              `
            )
            .join('')}
        `
        : ''
    }
  `);

  s.querySelectorAll('[data-pid]').forEach((b) => {
    b.onclick = async () => {
      state.partyId = Number(b.dataset.pid);
      state.selectedFolder = null;
      state.folders = [];
      localStorage.setItem('cinema_party_id', state.partyId);
      closeSheet();
      state.loading = true;
      render();
      await loadPartyMovies();
      state.loading = false;
      render();
    };
  });

  s.querySelector('#shareInviteBtn').onclick = () => {
    const text = `Join my movie party "${p.name}"! Code: ${p.code}`;
    if (tg?.openTelegramLink && link.startsWith('https://t.me/')) {
      tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(`${text}\n${link}`).then(() => toast('Invite copied'));
    } else {
      toast(`Code: ${p.code}`);
    }
  };

  s.querySelector('#createAnotherPartyBtn').onclick = openCreateOrJoinSheet;

  s.querySelector('#leavePartyBtn').onclick = async () => {
    const ok = await confirmSheet({
      title: 'Leave Party',
      message: 'Leave this party? If you are the last member, it will be deleted.',
      confirmText: 'Leave',
      cancelText: 'Cancel',
    });
    if (!ok) return;
    try {
      await api(`/parties/${p.id}/leave`, { method: 'POST' });
      closeSheet();
      state.partyId = null;
      state.selectedFolder = null;
      state.folders = [];
      localStorage.removeItem('cinema_party_id');
      await refreshAll();
      toast('Left party');
    } catch (e) {
      toast(e.message);
    }
  };
}

function openCreateOrJoinSheet() {
  const s = openSheet(`
    <h2 class="sheet-title display">New Party</h2>

    <label class="form-field">
      <span class="form-label">Party Name</span>
      <input type="text" id="anotherPartyName" placeholder="e.g. Cinema Club" maxlength="40">
    </label>
    <div>
      <button class="btn primary" id="doCreateAnotherBtn">Create</button>
    </div>

    <div style="text-align:center; color:var(--muted); font-size:12px; margin:16px 0;">OR</div>

    <label class="form-field">
      <span class="form-label">Invite Code</span>
      <input type="text" id="anotherJoinCode" placeholder="6-CHAR CODE" autocapitalize="characters" maxlength="6">
    </label>
    <div>
      <button class="btn" id="doJoinAnotherBtn">Join</button>
    </div>
  `);

  s.querySelector('#doCreateAnotherBtn').onclick = async () => {
    const name = s.querySelector('#anotherPartyName').value.trim();
    if (!name) return toast('Party name is required');
    try {
      const p = await api('/parties', { method: 'POST', body: { name } });
      state.partyId = p.id;
      state.selectedFolder = null;
      state.folders = [];
      localStorage.setItem('cinema_party_id', p.id);
      closeSheet();
      await refreshAll();
      toast('Party created');
    } catch (e) {
      toast(e.message);
    }
  };

  s.querySelector('#doJoinAnotherBtn').onclick = async () => {
    const code = s.querySelector('#anotherJoinCode').value.trim();
    if (!code) return toast('Code is required');
    try {
      const res = await api('/parties/join', { method: 'POST', body: { code } });
      state.partyId = res.id;
      state.selectedFolder = null;
      state.folders = [];
      localStorage.setItem('cinema_party_id', res.id);
      closeSheet();
      await refreshAll();
      toast('Joined party');
    } catch (e) {
      toast(e.message);
    }
  };
}

// ---------- Profile & Settings Sheet ----------
function openProfileSheet() {
  const currentAccent = localStorage.getItem('cinema_accent') || DEFAULT_ACCENT;
  const p = currentParty();

  const swatchesHtml = PRESET_SWATCHES.map(
    (c) => `
      <button class="swatch ${c.toLowerCase() === currentAccent.toLowerCase() ? 'active' : ''}" style="background:${c};" data-color="${c}" aria-label="Color ${c}"></button>
    `
  ).join('');

  const currentName = state.me?.custom_name || state.me?.first_name || '';

  const s = openSheet(`
    <h2 class="sheet-title display">Profile &amp; Settings</h2>

    <div class="profile-avatar-wrap">
      <div class="profile-avatar-large" id="profileAvatarLarge">
        ${
          state.me?.avatar_url
            ? `<img src="${esc(state.me.avatar_url)}" alt="">`
            : `<span>${esc((state.me?.display_name || state.me?.first_name || 'U').slice(0, 1).toUpperCase())}</span>`
        }
      </div>
      <button type="button" class="btn" id="changeAvatarBtn" style="padding:8px 16px; font-size:13px;">Change Photo</button>
      <input type="file" id="avatarFileInput" accept="image/*" hidden>
    </div>

    <label class="form-field">
      <span class="form-label">Display Nickname</span>
      <input type="text" id="profileNameInput" value="${esc(currentName)}" placeholder="Your nickname" maxlength="40">
    </label>
    <div style="margin-bottom:16px;">
      <button type="button" class="btn primary" id="saveProfileBtn">
        <svg class="btn-icon-svg" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg> Save Nickname
      </button>
    </div>

    <div class="section-divider"></div>
    <div class="form-label" style="margin-bottom:12px;">Accent Color</div>
    <div class="swatches">${swatchesHtml}</div>

    <div class="color-row">
      <span style="font-size:13px; font-weight:500;">Custom color</span>
      <input type="color" id="customColorPicker" value="${currentAccent}">
    </div>

    <div>
      <button type="button" class="btn" id="resetAccentBtn">Reset Accent</button>
    </div>

    ${
      p
        ? `
          <div class="section-divider"></div>
          <div class="form-label" style="margin-bottom:12px;">Party: ${esc(p.name)}</div>
          <label class="form-field">
            <span class="form-label">Rename Party</span>
            <input type="text" id="renamePartyInput" value="${esc(p.name)}" maxlength="40">
          </label>
          <div style="margin-bottom:12px;">
            <button type="button" class="btn primary" id="savePartyRenameBtn">Rename</button>
          </div>
        `
        : ''
    }

    <div class="section-divider"></div>
    <div class="form-label">About</div>
    <div class="about-text">
      Cinema Party v1.2.0<br>
      Minimalist movie tracker with editorial serif typography.<br><br>
      Powered by open source movie catalog.
    </div>

    <div style="margin-top:16px;">
      <button type="button" class="btn" id="addToHomeBtn" style="width:100%; justify-content:center;">
        <svg class="btn-icon-svg" viewBox="0 0 24 24">
          <path d="M12 2L2 12h3v8h6v-6h2v6h6v-8h3L12 2z"/>
        </svg>
        <span id="addToHomeLabel">Add to Home Screen</span>
      </button>
    </div>
  `);

  // Avatar upload handler
  s.querySelector('#changeAvatarBtn').onclick = () => s.querySelector('#avatarFileInput').click();
  s.querySelector('#avatarFileInput').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const btn = s.querySelector('#changeAvatarBtn');
    btn.disabled = true;
    btn.textContent = 'Uploading...';
    try {
      const resized = await resizeImage(file, 400);
      const fd = new FormData();
      fd.append('file', resized, 'avatar.webp');
      const res = await api('/covers', { method: 'POST', body: fd });
      await api('/me/profile', { method: 'PATCH', body: { avatar_url: res.url } });
      state.me.avatar_url = res.url;
      s.querySelector('#profileAvatarLarge').innerHTML = `<img src="${esc(res.url)}" alt="">`;
      render();
      toast('Avatar updated');
    } catch (err) {
      toast(err.message || 'Avatar upload failed');
    }
    btn.disabled = false;
    btn.textContent = 'Change Photo';
  };

  // Profile name save
  s.querySelector('#saveProfileBtn').onclick = async () => {
    const newName = s.querySelector('#profileNameInput').value.trim();
    if (!newName) return toast('Name cannot be empty');
    try {
      await api('/me/profile', { method: 'PATCH', body: { name: newName } });
      state.me.custom_name = newName;
      state.me.display_name = newName;
      render();
      toast('Nickname updated');
    } catch (err) {
      toast(err.message || 'Failed to update nickname');
    }
  };

  s.querySelectorAll('.swatch').forEach((swatchBtn) => {
    swatchBtn.onclick = () => {
      const color = swatchBtn.dataset.color;
      applyAccent(color, true);
      s.querySelectorAll('.swatch').forEach((b) => b.classList.toggle('active', b === swatchBtn));
      s.querySelector('#customColorPicker').value = color;
      haptic('light');
    };
  });

  s.querySelector('#customColorPicker').oninput = (e) => {
    const val = e.target.value;
    applyAccent(val, true);
    s.querySelectorAll('.swatch').forEach((b) => b.classList.toggle('active', b.dataset.color.toLowerCase() === val.toLowerCase()));
  };

  s.querySelector('#resetAccentBtn').onclick = () => {
    applyAccent(DEFAULT_ACCENT, true);
    s.querySelectorAll('.swatch').forEach((b) => b.classList.toggle('active', b.dataset.color === DEFAULT_ACCENT));
    s.querySelector('#customColorPicker').value = DEFAULT_ACCENT;
    haptic('medium');
    toast('Accent reset to default');
  };

  if (p) {
    s.querySelector('#savePartyRenameBtn').onclick = async () => {
      const newName = s.querySelector('#renamePartyInput').value.trim();
      if (!newName) return toast('Party name is required');
      try {
        await api(`/parties/${p.id}`, { method: 'PATCH', body: { name: newName } });
        p.name = newName;
        render();
        toast('Party renamed');
      } catch (e) {
        toast(e.message);
      }
    };
  }

  const addHomeBtn = s.querySelector('#addToHomeBtn');
  const addHomeLabel = s.querySelector('#addToHomeLabel');
  if (addHomeBtn) {
    if (homeScreenStatus === 'added') {
      addHomeBtn.disabled = true;
      if (addHomeLabel) addHomeLabel.textContent = 'Added to Home Screen';
    } else if (tg && typeof tg.checkHomeScreenStatus === 'function') {
      try {
        tg.checkHomeScreenStatus((status) => {
          homeScreenStatus = status;
          if (status === 'added') {
            addHomeBtn.disabled = true;
            if (addHomeLabel) addHomeLabel.textContent = 'Added to Home Screen';
          } else if (status === 'unsupported') {
            if (addHomeLabel) addHomeLabel.textContent = 'Add to Home Screen (not supported)';
          }
        });
      } catch {}
    }
    addHomeBtn.onclick = requestAddToHomeScreen;
  }

  if (localStorage.getItem('cinema_debug') === '1') {
    const debugWrap = document.createElement('div');
    debugWrap.style.marginTop = '16px';
    debugWrap.innerHTML = `<button type="button" class="btn" id="showSafeAreaBtn" style="font-size:12px; opacity:0.75;">Show SafeArea values</button>`;
    s.appendChild(debugWrap);
    s.querySelector('#showSafeAreaBtn').onclick = () => {
      const sTop = Number(tg?.safeAreaInset?.top) || 0;
      const cTop = Number(tg?.contentSafeAreaInset?.top) || 0;
      const resolved = getComputedStyle(document.documentElement)
        .getPropertyValue('--tg-total-top-inset').trim();
      try {
        tg?.showAlert?.(
          `sTop=${sTop}\ncTop=${cTop}\nisFullscreen=${!!tg?.isFullscreen}\nresolvedTop=${resolved}`
        );
      } catch {
        toast(`sTop=${sTop}, cTop=${cTop}, resolved=${resolved}`);
      }
    };
  }
}

// ---------- App Initialization ----------
(async function init() {
  render();
  try {
    await loadInitialData();

    // Auto-join from URL parameter ?code=... or ?start=... or ?startapp=... or Telegram start_param
    const urlParams = new URLSearchParams(location.search);
    const startCode =
      tg?.initDataUnsafe?.start_param ||
      urlParams.get('code') ||
      urlParams.get('start') ||
      urlParams.get('startapp');

    if (startCode) {
      try {
        const res = await api('/parties/join', { method: 'POST', body: { code: startCode.trim() } });
        state.partyId = res.id;
        localStorage.setItem('cinema_party_id', res.id);
        try { history.replaceState(null, '', location.pathname); } catch {}
        await loadInitialData();
      } catch {}
    }

    await loadPartyMovies();
  } catch (err) {
    $app.innerHTML = `
      <div class="screen" style="padding-top:14vh; text-align:center;">
        <div class="display" style="font-size:24px; margin-bottom:8px;">Authentication Error</div>
        <p style="color:var(--muted); font-size:14px; line-height:1.5;">${esc(err.message)}<br><br>Please open this Mini App inside Telegram.</p>
      </div>
    `;
    return;
  }

  state.loading = false;
  render();
  startPolling();
})();

let pollTimer = null;
let isPolling = false;
let lastSyncAt = 0;

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    if (isPolling) return; // защита от параллельного запуска
    if (pendingMutationsCount > 0) return; // не перезаписывать данные во время мутаций
    if (document.visibilityState !== 'visible') return;
    if (currentOverlay) return; // не мешаем открытым sheet
    isPolling = true;
    try {
      await loadPartyMovies();
      refreshMoviesContainer();
      lastSyncAt = Date.now();
    } catch {
      // silent — не спамим пользователя ошибками polling
    } finally {
      isPolling = false;
    }
  }, 30000);
}

function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.me) {
    loadPartyMovies().then(() => {
      refreshMoviesContainer();
      startPolling();
    }).catch(() => {});
  } else {
    stopPolling();
  }
});

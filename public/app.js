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
  if (tg) {
    const topInset = tg.contentSafeAreaInset?.top || tg.safeAreaInset?.top || 0;
    if (topInset > 0) {
      document.documentElement.style.setProperty('--tg-content-safe-area-inset-top', `${topInset}px`);
    }
    const bottomInset = tg.contentSafeAreaInset?.bottom || tg.safeAreaInset?.bottom || 0;
    if (bottomInset > 0) {
      document.documentElement.style.setProperty('--tg-content-safe-area-inset-bottom', `${bottomInset}px`);
    }
  }
}
updateSafeArea();
try { tg?.onEvent?.('fullscreenChanged', updateSafeArea); } catch {}

const $app = document.getElementById('app');

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
        toast('Added to Home Screen');
      }
      window.deferredInstallPrompt = null;
    });
    return;
  }

  openAddToHomeGuideSheet();
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

async function api(path, { method = 'GET', body } = {}) {
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
}

// ---------- Bottom Sheet Helpers ----------
let currentOverlay = null;

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
    tg.BackButton.onClick(closeSheet);
  }
  return overlay.querySelector('.sheet');
}

function closeSheet() {
  if (currentOverlay) {
    currentOverlay.remove();
    currentOverlay = null;
  }
  if (tg?.BackButton) {
    tg.BackButton.hide();
  }
}

// ---------- Application State ----------
const state = {
  me: null,
  parties: [],
  partyId: Number(localStorage.getItem('cinema_party_id')) || null,
  movies: [],
  inviteBase: '',
  tab: 'together', // 'together' | 'mine' | 'others'
  status: 'want', // 'want' | 'watched'
  selectedTag: null, // active hashtag filter
  searchQuery: '', // active text search query
  loading: true,
};

function parseTags(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  const matches = String(raw).match(/#[a-zA-Z0-9а-яА-ЯёЁ_-]+/g);
  if (matches) {
    const set = new Set();
    matches.forEach((t) => set.add(t.toLowerCase()));
    return Array.from(set);
  }
  return String(raw)
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (t.startsWith('#') ? t.toLowerCase() : `#${t.toLowerCase()}`));
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
  const candidates = tabMovies();
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

  if (data.user?.accent) {
    applyAccent(data.user.accent);
  }

  if (!currentParty()) {
    state.partyId = state.parties[0]?.id || null;
    if (state.partyId) localStorage.setItem('cinema_party_id', state.partyId);
  }
}

async function loadPartyMovies() {
  if (!state.partyId) {
    state.movies = [];
    return;
  }
  const data = await api(`/parties/${state.partyId}/movies`);
  state.movies = data.movies || [];
}

async function refreshAll() {
  await loadInitialData();
  await loadPartyMovies();
  state.loading = false;
  render();
}

// ---------- UI Rendering ----------
function visibleMovies() {
  const sq = (state.searchQuery || '').trim().toLowerCase();
  const selectedTag = state.selectedTag ? state.selectedTag.toLowerCase() : null;

  return tabMovies().filter((m) => {
    if (selectedTag) {
      const mTags = parseTags(m.tags);
      if (!mTags.includes(selectedTag)) return false;
    }

    if (sq) {
      const titleMatch = (m.title || '').toLowerCase().includes(sq);
      const noteMatch = (m.note || '').toLowerCase().includes(sq);
      const tagsMatch = (m.tags || '').toLowerCase().includes(sq);
      const yearMatch = (m.year || '').includes(sq);
      if (!titleMatch && !noteMatch && !tagsMatch && !yearMatch) return false;
    }

    return true;
  });
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
    ? `<img src="${esc(m.poster)}" alt="${esc(m.title)}" loading="lazy" onerror="this.onerror=null;this.parentElement.innerHTML='<div class=\\'poster-ph\\'>${esc(m.title)}</div>'">`
    : `<div class="poster-ph">${esc(m.title)}</div>`;

  let meta = '';
  if (state.tab === 'others') {
    meta = esc(m.added_by_name || 'Friend');
  } else if (m.year) {
    meta = esc(m.year);
  }

  const tags = parseTags(m.tags);
  const tagsHtml = tags.length
    ? `<div class="card-tags">${tags.slice(0, 2).map((t) => `<span class="movie-tag">${esc(t)}</span>`).join('')}${tags.length > 2 ? `<span class="movie-tag more">+${tags.length - 2}</span>` : ''}</div>`
    : '';

  return `
    <button class="card" data-id="${m.id}">
      <div class="poster-box">
        ${posterHtml}
        ${tagBadge}
        ${ratingBadge}
      </div>
      <div class="card-title">${esc(m.title)}</div>
      ${meta ? `<div class="card-meta">${meta}</div>` : ''}
      ${tagsHtml}
    </button>
  `;
}

function emptyMessage() {
  if (state.searchQuery || state.selectedTag) {
    return 'No movies match current filter or search.';
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

function refreshMoviesContainer() {
  const container = $app.querySelector('#moviesContainer');
  if (!container) return;
  const list = visibleMovies();
  container.innerHTML = list.length
    ? `<div class="grid">${list.map(renderCard).join('')}</div>`
    : `
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

  container.querySelectorAll('.card').forEach((c) => {
    c.onclick = () => {
      haptic('light');
      openMovieDetail(Number(c.dataset.id));
    };
  });
}

function renderFilterSection() {
  const tagsList = partyTags();
  return `
    <div class="filter-section">
      <div class="list-search-wrap">
        <svg class="list-search-icon" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        <input type="text" class="list-search-input" id="listSearchInput" placeholder="Search title, year, #tag..." value="${esc(state.searchQuery)}">
        ${state.searchQuery ? `<button type="button" class="list-search-clear" id="listSearchClear">&times;</button>` : ''}
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

  if (input) {
    input.oninput = (e) => {
      state.searchQuery = e.target.value;
      if (clearBtn) clearBtn.style.display = state.searchQuery ? 'grid' : 'none';
      refreshMoviesContainer();
    };
  }

  if (clearBtn) {
    clearBtn.onclick = () => {
      state.searchQuery = '';
      if (input) input.value = '';
      clearBtn.style.display = 'none';
      refreshMoviesContainer();
    };
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
  const availableTags = partyTags().map(([t]) => t);
  if (state.selectedTag && !availableTags.includes(state.selectedTag)) {
    state.selectedTag = null;
  }
  render();
}

function switchStatus(newStatus) {
  if (state.status === newStatus) return;
  state.status = newStatus;
  const tagsInNewStatus = partyTags().map(([t]) => t);
  if (state.selectedTag && !tagsInNewStatus.includes(state.selectedTag)) {
    state.selectedTag = null;
  }
  render();
}

function render() {
  if (state.loading) {
    $app.innerHTML = '<div class="spinner">Loading...</div>';
    return;
  }

  if (!state.partyId || !currentParty()) {
    renderWelcome();
    return;
  }

  const p = currentParty();
  const list = visibleMovies();
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
    : `<span>${esc((state.me?.display_name || state.me?.first_name || 'U').slice(0, 1).toUpperCase())}</span>`;

  const otherTabLabel = otherMemberName();

  $app.innerHTML = `
    <div class="screen">
      <header class="top-brand-bar">
        <div class="brand-title display">Cine Party</div>
        <button type="button" class="brand-room-pill" id="topPartyChip" aria-label="Room details">
          <span class="room-dot"></span>
          <span class="room-name">${esc(p.name)}</span>
          <span class="room-count">· ${membersCount}</span>
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
      ${
        list.length
          ? `<div class="grid">${list.map(renderCard).join('')}</div>`
          : `
            <div class="empty-box">
              <div class="dotted-illustration">
                <span></span><span></span><span></span><span></span>
                <span></span><span class="active"></span><span></span><span></span>
                <span></span><span></span><span class="active"></span><span></span>
                <span></span><span></span><span></span><span></span>
              </div>
              <div class="empty-text">${emptyMessage()}</div>
            </div>
          `
      }
      </div>
    </div>

    <nav class="liquid-dock" id="bottomDock">
      <button type="button" class="dock-item" id="dockParty" aria-label="Room &amp; Members">
        <svg viewBox="0 0 24 24">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
          <circle cx="9" cy="7" r="4"></circle>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
        </svg>
        <span class="dock-item-label">${esc(p.name)}</span>
      </button>

      <button type="button" class="dock-item active" id="dockMovies" aria-label="Movies">
        <svg viewBox="0 0 24 24">
          <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect>
          <line x1="7" y1="2" x2="7" y2="22"></line>
          <line x1="17" y1="2" x2="17" y2="22"></line>
          <line x1="2" y1="12" x2="22" y2="12"></line>
          <line x1="2" y1="7" x2="7" y2="7"></line>
          <line x1="2" y1="17" x2="7" y2="17"></line>
          <line x1="17" y1="17" x2="22" y2="17"></line>
          <line x1="17" y1="7" x2="22" y2="7"></line>
        </svg>
        <span class="dock-item-label">Movies</span>
      </button>

      <button type="button" class="dock-item dock-add-btn" id="dockAdd" aria-label="Add Movie">
        <div class="dock-add-circle">
          <svg viewBox="0 0 24 24">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </div>
        <span class="dock-item-label">Add</span>
      </button>

      <button type="button" class="dock-item" id="dockProfile" aria-label="Profile">
        <div class="dock-avatar">${userAvatarHtml}</div>
        <span class="dock-item-label">${esc(state.me?.custom_name || state.me?.first_name || 'Profile')}</span>
      </button>
    </nav>
  `;

  $app.querySelector('#topPartyChip').onclick = openPartySheet;
  $app.querySelector('#dockParty').onclick = openPartySheet;
  $app.querySelector('#dockMovies').onclick = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    haptic('light');
  };
  $app.querySelector('#dockAdd').onclick = () => {
    haptic('medium');
    openMovieEditor();
  };
  $app.querySelector('#dockProfile').onclick = openProfileSheet;
  bindFilterEvents();

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

  $app.querySelectorAll('.card').forEach((c) => {
    c.onclick = () => {
      haptic('light');
      openMovieDetail(Number(c.dataset.id));
    };
  });
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

// ---------- Movie Detail Sheet ----------
function openMovieDetail(movieId) {
  const m = state.movies.find((x) => x.id === movieId);
  if (!m) return;

  const canEdit = m.kind === 'together' || m.added_by === state.me.id;
  const posterHtml = m.poster
    ? `<img src="${esc(m.poster)}" alt="${esc(m.title)}">`
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
    if (!confirm(`Delete "${m.title}"?`)) return;
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
      <input type="text" id="movieTags" placeholder="#комедия #драма #боевик #sci-fi..." maxlength="200" value="${esc(draft.tags)}">
      <div class="tag-suggest-chips" id="tagSuggestChips">
        <button type="button" class="tag-suggest-chip" data-addtag="#комедия">+ #комедия</button>
        <button type="button" class="tag-suggest-chip" data-addtag="#фантастика">+ #фантастика</button>
        <button type="button" class="tag-suggest-chip" data-addtag="#боевик">+ #боевик</button>
        <button type="button" class="tag-suggest-chip" data-addtag="#драма">+ #драма</button>
        <button type="button" class="tag-suggest-chip" data-addtag="#триллер">+ #триллер</button>
        <button type="button" class="tag-suggest-chip" data-addtag="#ужасы">+ #ужасы</button>
        <button type="button" class="tag-suggest-chip" data-addtag="#мультфильм">+ #мультфильм</button>
        <button type="button" class="tag-suggest-chip" data-addtag="#семейный">+ #семейный</button>
      </div>
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
  const suggestionsBox = $('#titleSuggestions');

  $('#movieTitle').oninput = (e) => {
    clearTimeout(searchTimer);
    const val = e.target.value.trim();
    if (val.length < 2) {
      suggestionsBox.hidden = true;
      suggestionsBox.innerHTML = '';
      return;
    }

    searchTimer = setTimeout(async () => {
      try {
        const data = await api('/movies/search?q=' + encodeURIComponent(val));
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
      } catch {
        suggestionsBox.hidden = true;
      }
    }, 250);
  };

  s.addEventListener('click', (e) => {
    if (!e.target.closest('.input-wrap')) {
      suggestionsBox.hidden = true;
    }
  });

  // Quick tag chips in editor
  s.querySelectorAll('[data-addtag]').forEach((chip) => {
    chip.onclick = () => {
      const add = chip.dataset.addtag;
      const current = $('#movieTags').value.trim();
      if (!current.toLowerCase().includes(add.toLowerCase())) {
        $('#movieTags').value = current ? `${current} ${add}` : add;
        draft.tags = $('#movieTags').value;
        haptic('light');
      }
    };
  });

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
              <div class="avatar">
                ${
                  m.avatar_url
                    ? `<img src="${esc(m.avatar_url)}" alt="">`
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
    if (!confirm('Leave this party? If you are the last member, it will be deleted.')) return;
    try {
      await api(`/parties/${p.id}/leave`, { method: 'POST' });
      closeSheet();
      state.partyId = null;
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

    <div class="section-divider"></div>
    <div class="form-label" style="margin-bottom:12px;">Quick Access</div>
    <div style="margin-bottom:14px;">
      <button type="button" class="btn" id="profileAddToHomeBtn">
        <svg class="btn-icon-svg" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> Add to Home Screen
      </button>
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

  s.querySelector('#profileAddToHomeBtn')?.addEventListener('click', requestAddToHomeScreen);

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
})();

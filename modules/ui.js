import { state, db }                               from './config.js';
import { $ }                                       from './utils.js';
import {
  collection, query, where, orderBy, limit, getDocs, startAt, endAt
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

/* ── Global mute ─────────────────────────────────────────────────────── */
const MUTE_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/>
  <line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>
</svg>`;
const UNMUTE_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/>
  <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
  <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
</svg>`;

export function updateMuteBtnUI() {
  const muted = state.globalMuted;
  const icon  = muted ? MUTE_SVG   : UNMUTE_SVG;
  const label = muted ? "Ovoz o'chiq" : 'Ovoz yoqiq';
  const tip   = muted ? 'Ovozni yoqish' : "Ovozni o'chirish";

  const gb = $('globalMuteBtn');
  if (gb) { gb.innerHTML = icon; gb.title = tip; gb.classList.toggle('is-unmuted', !muted); }

  const sb = $('sbMuteBtn');
  if (sb) { sb.innerHTML = icon + `<span>${label}</span>`; sb.classList.toggle('is-unmuted', !muted); }

  document.querySelectorAll('.reel-vol-top').forEach(btn => {
    const volIc   = btn.querySelector('.ic-vol');
    const mutedIc = btn.querySelector('.ic-muted');
    if (volIc)   volIc.style.display   = muted ? 'none' : 'block';
    if (mutedIc) mutedIc.style.display = muted ? 'block' : 'none';
  });

  document.querySelectorAll('.vid-wrap').forEach(wrap => {
    const volIc   = wrap.querySelector('.ic-vol');
    const mutedIc = wrap.querySelector('.ic-muted');
    if (volIc)   volIc.style.display   = muted ? 'none' : '';
    if (mutedIc) mutedIc.style.display = muted ? '' : 'none';
    const vid = wrap.querySelector('video');
    if (vid) vid.muted = muted;
  });
}

export function toggleGlobalMute() {
  state.globalMuted = !state.globalMuted;
  document.querySelectorAll('video').forEach(v => { if (!v.paused) v.muted = state.globalMuted; });
  updateMuteBtnUI();
}

document.addEventListener('mutestatechange', updateMuteBtnUI);

/* ══════════════════════════════════════════════════════════════════════
   SEARCH OVERLAY — unified mobile + desktop
   ══════════════════════════════════════════════════════════════════════ */
const appHdr         = $('appHdr');
const sbSearchToggle = $('sbSearchToggle');
const searchOverlay  = $('searchOverlay');
const searchInput    = $('searchInput');

function openSearchOverlay() {
  searchOverlay?.classList.add('open');
  setTimeout(() => searchInput?.focus(), 60);
  sbSearchToggle?.classList.add('search-active');
}

function closeSearchOverlay() {
  searchOverlay?.classList.remove('open');
  sbSearchToggle?.classList.remove('search-active');
  if (searchInput) { searchInput.value = ''; _doSearch(''); }
}

/* hdrSearchBtn onclick — router.js/_attachSearchHandler tomonidan boshqariladi.
   Har tab o'zgarganda handler qayta biriktiriladi. */

/* Yopish button inside overlay */
$('searchOverlayClose')?.addEventListener('click', e => {
  e.stopPropagation();
  closeSearchOverlay();
});

/* Backdrop click → close */
searchOverlay?.addEventListener('click', e => {
  if (e.target === searchOverlay) closeSearchOverlay();
});

/* sbSearchToggle onclick — router.js/_attachSearchHandler tomonidan boshqariladi. */


/* ── View switching ──────────────────────────────────────────────────── */
export async function switchView(v) {
  state.view = v;
  document.querySelectorAll('video').forEach(x => x.pause());
  document.querySelectorAll('.view').forEach(x => x.classList.remove('on'));
  document.querySelectorAll('.nav-btn[data-v]').forEach(x => x.classList.remove('on'));
  document.getElementById(`${v}View`)?.classList.add('on');
  document.querySelector(`.nav-btn[data-v="${v}"]`)?.classList.add('on');

  // Sync with navigation bar
  const { updateActiveNav } = await import('./bar.js');
  updateActiveNav(v);

  const upm = $('userProfileModal');
  if (upm?.classList.contains('show')) {
    state.currentViewingUserId    = null;
    state.currentViewingUserPosts = [];
    upm.classList.remove('show');
  }

  /* Qidiruv overlay yopilsin */
  if (searchOverlay?.classList.contains('open')) {
    closeSearchOverlay();
  }

  updateMuteBtnUI();
  window.scrollTo({ top: 0 });

  if (v === 'home') {
    state.visibleN = 10;
    const { renderFeed } = await import('./feed.js');
    renderFeed();
  }
  if (v === 'profile') {
    const { renderProfile } = await import('./profile.js');
    renderProfile();
  }
}

/* ── Open media post in modal/zoom ───────────────────────────────────── */
export async function openMediaInModal(postId) {
  const post = state.allPosts.find(p => p.id === postId);
  if (!post) return;
  const { openZoom } = await import('./utils.js');
  openZoom(post.mediaUrl, post.mediaType?.startsWith('video') ? 'video' : 'image');
}

/* ── Logo click → home ───────────────────────────────────────────────── */
const hdrLogoBtn = document.getElementById('hdrLogoBtn');
if (hdrLogoBtn) {
  hdrLogoBtn.addEventListener('click', async () => {
    const { navigateTo } = await import('./router.js');
    navigateTo('home');
  });
}

/* ── Nav buttons handled by router.js — do NOT add duplicate listeners here ── */

/* ── Header / sidebar tabs removed ───────────────────────────────────── */
// Barchasi/My filter tabs no longer used

/* ── Qidiruv ──────────────────────────────────────────────────────────── */
async function _doSearch(val) {
  state.search = val;
  clearTimeout(window._sT);
  window._sT = setTimeout(async () => {
    state.visibleN = 10;
    const { renderFeed } = await import('./feed.js');
    if (state.view === 'home') renderFeed();
    if (state.view !== 'home' && val) {
      switchView('home');
    }
  }, 300);
}


const suggestionsEl = $('searchSuggestions');
let suggestionIndex = -1;
let currentSuggestions = [];

function showSuggestions(list) {
  if (!suggestionsEl) return;
  if (!list || list.length === 0) {
    suggestionsEl.classList.remove('show');
    suggestionsEl.innerHTML = '';
    return;
  }
  currentSuggestions = list;
  suggestionIndex = -1;
  suggestionsEl.innerHTML = list.map((item, i) => {
    const avatarHtml = item.type === 'user'
      ? `<img src="${item.avatar || ''}" class="search-suggestion-avatar" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" style="width:28px;height:28px;border-radius:50%;object-fit:cover;flex-shrink:0">
         <span class="search-suggestion-avatar-fallback" style="display:none;width:28px;height:28px;border-radius:50%;background:var(--accent,#8b5cf6);color:#fff;align-items:center;justify-content:center;font-size:13px;flex-shrink:0">${escapeHtml((item.label[1] || '?').toUpperCase())}</span>`
      : `<svg class="search-suggestion-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          ${item.type === 'hashtag' ? '<path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18"/>' : '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>'}
        </svg>`;
    return `<div class="search-suggestion-item" data-index="${i}" data-type="${item.type}">
      ${avatarHtml}
      <span class="search-suggestion-text">${escapeHtml(item.label)}</span>
    </div>`;
  }).join('');
  suggestionsEl.classList.add('show');

  suggestionsEl.querySelectorAll('.search-suggestion-item').forEach(el => {
    el.addEventListener('click', async () => {
      const idx = parseInt(el.dataset.index);
      const chosen = currentSuggestions[idx];
      if (suggestionsEl) suggestionsEl.classList.remove('show');
      if (chosen.type === 'user' && chosen.uid) {
        closeSearchOverlay();
        const { openUserProfileModal } = await import('./profile.js');
        openUserProfileModal(chosen.uid);
      } else {
        if (searchInput) searchInput.value = chosen.value;
        _doSearch(chosen.value);
      }
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function fetchSuggestions(rawQuery) {
  if (!rawQuery || rawQuery.trim().length < 2) return [];

  const results = [];
  const q = rawQuery.toLowerCase().replace(/^@/, '');

  // 1. Firestore dan username bo'yicha qidirish
  try {
    const usersRef = collection(db, 'users');
    const snap = await getDocs(
      query(usersRef,
        orderBy('username'),
        startAt(q),
        endAt(q + '\uf8ff'),
        limit(5)
      )
    );
    snap.forEach(d => {
      const u = d.data();
      if (u.username) {
        results.push({ type: 'user', label: '@' + u.username, value: u.username, uid: d.id, avatar: u.photoURL || null });
      }
    });
  } catch (e) {
    // Firestore index bo'lmasa, local allUsers dan izlaymiz
    state.allUsers?.forEach(user => {
      if (user.username?.toLowerCase().includes(q)) {
        results.push({ type: 'user', label: '@' + user.username, value: user.username, uid: user.uid, avatar: user.photoURL || null });
      }
    });
  }

  // 2. Hashtag qidirish (postlardan)
  const hashtags = new Set();
  state.allPosts?.forEach(post => {
    const matches = post.caption?.match(/#[a-zA-Z0-9_]+/g);
    matches?.forEach(tag => {
      if (tag.toLowerCase().includes(q)) hashtags.add(tag);
    });
  });
  hashtags.forEach(tag => results.push({ type: 'hashtag', label: tag, value: tag }));

  // 3. Post caption qidirish
  state.allPosts?.forEach(post => {
    if (post.caption && post.caption.toLowerCase().includes(q)) {
      const snippet = post.caption.substring(0, 40) + (post.caption.length > 40 ? '...' : '');
      results.push({ type: 'post', label: snippet, value: post.caption.split(' ')[0] });
    }
  });

  return results.slice(0, 6);
}

// Debounced suggestion fetch
let suggestionTimeout;
function handleSearchInput(val) {
  clearTimeout(suggestionTimeout);
  suggestionTimeout = setTimeout(async () => {
    const suggestions = await fetchSuggestions(val);
    showSuggestions(suggestions);
  }, 200);
  _doSearch(val);
}

if (searchInput) {
  searchInput.oninput = e => handleSearchInput(e.target.value);

  searchInput.addEventListener('keydown', async e => {
    const items = suggestionsEl?.querySelectorAll('.search-suggestion-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      suggestionIndex = Math.min(suggestionIndex + 1, currentSuggestions.length - 1);
      if (items) updateSuggestionHighlight([...items]);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      suggestionIndex = Math.max(suggestionIndex - 1, -1);
      if (items) updateSuggestionHighlight([...items]);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (suggestionIndex >= 0 && currentSuggestions[suggestionIndex]) {
        const chosen = currentSuggestions[suggestionIndex];
        suggestionsEl?.classList.remove('show');
        if (chosen.type === 'user' && chosen.uid) {
          closeSearchOverlay();
          const { openUserProfileModal } = await import('./profile.js');
          openUserProfileModal(chosen.uid);
        } else {
          if (searchInput) searchInput.value = chosen.value;
          _doSearch(chosen.value);
        }
      } else {
        // Enter bosildi lekin suggestion tanlanmagan — birinchi user topib profilni oching
        const firstUser = currentSuggestions.find(s => s.type === 'user');
        if (firstUser && firstUser.uid) {
          suggestionsEl?.classList.remove('show');
          closeSearchOverlay();
          const { openUserProfileModal } = await import('./profile.js');
          openUserProfileModal(firstUser.uid);
        } else {
          _doSearch(searchInput.value);
        }
      }
    } else if (e.key === 'Escape') {
      closeSearchOverlay();
    }
  });
}

function updateSuggestionHighlight(items) {
  items.forEach((item, i) => {
    item.classList.toggle('active', i === suggestionIndex);
  });
}

// Yopish suggestions on outside click
document.addEventListener('click', e => {
  if (suggestionsEl && !e.target.closest('.search-overlay-inner')) {
    showSuggestions([]);
  }
});

/* ── Desktop search input ────────────────────────────────────────────── */
const sbSearchInput = $('sbSearchInput');
if (sbSearchInput) sbSearchInput.oninput = e => handleSearchInput(e.target.value);

/* ── Init mute UI ────────────────────────────────────────────────────── */
updateMuteBtnUI();

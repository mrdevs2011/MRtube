/* ── Search for non-admin users ──────────────────────────────────────── */
let _searchQuery = '';

function _injectSearchCSS() {
  if (document.getElementById('chat-search-css')) return;
  const s = document.createElement('style');
  s.id = 'chat-search-css';
  s.textContent = `
.ulist-search-wrap {
  display: flex; align-items: center; gap: 10px;
  margin: 12px 14px 8px;
  background: var(--bg4, rgba(255,255,255,0.06));
  border: 1.5px solid var(--line, rgba(255,255,255,0.10));
  border-radius: 14px;
  padding: 10px 14px;
  transition: border-color .18s, box-shadow .18s;
}
.ulist-search-wrap:focus-within {
  border-color: var(--blue, #3b82f6);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--blue, #3b82f6) 18%, transparent);
}
.ulist-search-icon {
  color: var(--text3, #6b7280); flex-shrink: 0; cursor: pointer;
  display: flex; align-items: center; transition: color .15s;
}
.ulist-search-icon:hover { color: var(--blue, #3b82f6); }
.ulist-search-input {
  flex: 1; min-width: 0; background: transparent; border: none; outline: none;
  color: var(--text, #fff); font-size: 14.5px; line-height: 1.4;
}
.ulist-search-input::placeholder { color: var(--text3, #6b7280); }
.ulist-search-result { margin: 0 18px 10px; font-size: 12.5px; font-weight: 500; color: var(--text3, #6b7280); }
.ulist-search-result.not-found { color: var(--red, #ef4444); }

/* ── Skeleton ── */
@keyframes skelShimmer {
  0%   { background-position: -400px 0; }
  100% { background-position: 400px 0; }
}
.chat-row-skeleton {
  display: flex; align-items: center; gap: 12px;
  padding: 11px 16px;
  opacity: 0;
  animation: skelFadeIn .28s ease forwards;
}
@keyframes skelFadeIn { to { opacity: 1; } }
.skel-avi {
  width: 46px; height: 46px; border-radius: 50%; flex-shrink: 0;
  background: linear-gradient(90deg, var(--bg2,#1e1e2e) 25%, color-mix(in srgb, var(--blue,#3b82f6) 10%, var(--bg2,#1e1e2e)) 50%, var(--bg2,#1e1e2e) 75%);
  background-size: 400px 100%;
  animation: skelShimmer 1.3s infinite linear;
}
.skel-body { flex: 1; display: flex; flex-direction: column; gap: 7px; }
.skel-name, .skel-preview {
  height: 11px; border-radius: 7px;
  background: linear-gradient(90deg, var(--bg2,#1e1e2e) 25%, color-mix(in srgb, var(--blue,#3b82f6) 8%, var(--bg2,#1e1e2e)) 50%, var(--bg2,#1e1e2e) 75%);
  background-size: 400px 100%;
  animation: skelShimmer 1.3s infinite linear;
}
.skel-name { height: 13px; }

/* ── Row slide-in animation ── */
@keyframes chatRowSlideIn {
  from { opacity: 0; transform: translateY(10px) scale(0.97); filter: blur(3px); }
  to   { opacity: 1; transform: translateY(0)   scale(1);    filter: blur(0); }
}
`;
  document.head.appendChild(s);
}

function _renderSearchBox(container) {
  _injectSearchCSS();
  const existingBox = document.getElementById('chatSearchBoxWrap');
  if (existingBox) return; // already injected
  const wrap = document.createElement('div');
  wrap.id = 'chatSearchBoxWrap';
  wrap.innerHTML = `
    <div class="ulist-search-wrap">
      <div class="ulist-search-icon" id="chatSearchBtn" title="Qidirish">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="7"/><line x1="17" y1="17" x2="22" y2="22"/>
        </svg>
      </div>
      <input class="ulist-search-input" id="chatSearchInput" placeholder="Username yoki havola kiriting..." autocomplete="off" spellcheck="false">
      <div class="ulist-link-icon" id="chatJoinLinkBtn" title="Havola orqali qo'shilish">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11.5 4.5"/><path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07L12.5 19.5"/></svg>
      </div>
    </div>
    <div class="ulist-search-result d-none" id="chatSearchResult"></div>
  `;
  container.insertBefore(wrap, container.firstChild);

  const inp = document.getElementById('chatSearchInput');
  const btn = document.getElementById('chatSearchBtn');
  const res = document.getElementById('chatSearchResult');
  const linkBtn = document.getElementById('chatJoinLinkBtn');
  if (linkBtn) linkBtn.addEventListener('click', () => openJoinByLink());

  function doSearch() {
    const q = inp.value.trim();
    _searchQuery = q;
    if (!q) {
      res.classList.add('d-none');
      // Faqat kontaktlar (eski chat tarixi hisobga olinmaydi — hammada 0dan boshlanadi)
      const contacts = (_usersCache || []).filter(u => _myContacts.has(u.uid));
      _paintUserRows(contacts);
      return;
    }
    // Skeleton animation
    _paintSearchSkeleton();
    setTimeout(async () => {
      const lq = q.toLowerCase();
      const found = (_usersCache || []).filter(u =>
        (u.username || '').toLowerCase().includes(lq) ||
        (u.fullName || '').toLowerCase().includes(lq)
      );
      if (found.length) {
        res.textContent = found.length + ' ta natija topildi';
        res.className = 'ulist-search-result';
        res.classList.remove('d-none');
        _paintUserRows(found, true /* animate */);
        return;
      }

      // Username topilmasa — kiritilgan matnni guruh/kanal havolasi sifatida tekshiramiz
      res.textContent = 'Qidirilmoqda...';
      res.className = 'ulist-search-result';
      res.classList.remove('d-none');
      const linkRes = await joinGroupByCode(q);
      if (linkRes.ok) {
        res.classList.add('d-none');
        return;
      }
      res.textContent = '"' + q + '" — topilmadi';
      res.className = 'ulist-search-result not-found';
      _paintUserRows([], true);
    }, 420);
  }

  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });
  btn.addEventListener('click', doSearch);
  inp.addEventListener('input', () => {
    if (!inp.value.trim()) {
      _searchQuery = '';
      res.classList.add('d-none');
      const contacts = (_usersCache || []).filter(u => _myContacts.has(u.uid));
      _paintUserRows(contacts);
    }
  });
}

/* ── Skeleton loading for search ─────────────────────────────────────── */
function _paintSearchSkeleton() {
  const root = $('chatsListWrap');
  if (!root) return;
  let rowsWrap = document.getElementById('chatRowsWrap');
  if (!rowsWrap) {
    rowsWrap = document.createElement('div');
    rowsWrap.id = 'chatRowsWrap';
    root.appendChild(rowsWrap);
  }
  rowsWrap.innerHTML = [1,2,3].map((_, i) => `
    <div class="chat-row-skeleton" style="animation-delay:${i*0.08}s">
      <div class="skel-avi"></div>
      <div class="skel-body">
        <div class="skel-name" style="width:${55+i*12}%"></div>
        <div class="skel-preview" style="width:${40+i*8}%"></div>
      </div>
    </div>
  `).join('');
}

/* ── Paint only user rows (for search results / contacts) ────────────── */
function _paintUserRows(users, animate = false) {
  const root = $('chatsListWrap');
  if (!root) return;

  // Spinner yoki bo'sh placeholder ni o'chiramiz
  root.querySelectorAll('.spin-wrap, .empty').forEach(el => el.remove());

  let rowsWrap = document.getElementById('chatRowsWrap');
  if (!rowsWrap) {
    rowsWrap = document.createElement('div');
    rowsWrap.id = 'chatRowsWrap';
    root.appendChild(rowsWrap);
  }
  const chatMap = _latestChatMap;
  if (!users.length) {
    rowsWrap.innerHTML = '';
    return;
  }
  const rows = users.map(u => ({ u, c: chatMap[u.uid] || null }));
  rows.sort((a, b) => {
    const ta = a.c?.lastMessageAt?.toMillis?.() || 0;
    const tb = b.c?.lastMessageAt?.toMillis?.() || 0;
    if (ta !== tb) return tb - ta;
    return (a.u.fullName || '').localeCompare(b.u.fullName || '');
  });
  const html = rows.map(({ u, c }, idx) => {
    const av = u.avatar || defAvi(u.fullName || 'U');
    const isContact = _myContacts.has(u.uid);
    const preview = c
      ? `${c.lastSenderId === state.me.uid ? 'You: ' : ''}${esc((c.lastMessage || '').slice(0, 46))}`
      : isContact ? 'Kontakt' : 'Yangi suhbat boshlash';
    const time   = c?.lastMessageAt ? fmt(c.lastMessageAt) : '';
    const unread = c?.unreadCount?.[state.me.uid] || 0;
    const badgeTxt = unread > 99 ? '+99' : '+' + unread;
    const animStyle = animate ? `style="animation: chatRowSlideIn .32s cubic-bezier(.22,.68,0,1.2) ${idx*0.06}s both"` : '';
    return `<div class="chat-row${unread ? ' unread' : ''}${animate ? ' chat-row-anim' : ''}" data-uid="${u.uid}" ${animStyle}>
      <div class="chat-avi"><img src="${av}" onerror="this.style.display='none'"></div>
      <div class="chat-row-body">
        <div class="chat-row-name">${esc(u.fullName || 'Foydalanuvchi')}</div>
        <div class="chat-row-preview${c ? '' : ' chat-row-empty'}">${preview}</div>
      </div>
      <div class="chat-row-right">
        ${time ? `<div class="chat-row-time">${time}</div>` : ''}
        ${unread ? `<div class="chat-row-badge">${badgeTxt}</div>` : ''}
      </div>
    </div>`;
  }).join('');
  rowsWrap.innerHTML = html;
  rowsWrap.querySelectorAll('.chat-row').forEach(row => {
    row.addEventListener('click', () => openChatThread(row.dataset.uid));
  });
}

/**
 * MRdatabase — Suhbatlar (1-on-1 DM)
 * Suhbatlar ro'yxati: barcha ro'yxatdan o'tgan userlar
 * Chat thread: real vaqtli xabarlashish (Firestore onSnapshot)
 *
 * Firestore schema:
 *   chats/{chatId} {
 *     participants:[uidA,uidB], lastMessage, lastSenderId, lastMessageAt,
 *     unreadCount: { [uid]: number }   // har bir ishtirokchi uchun alohida hisob
 *   }
 *   chats/{chatId}/messages/{msgId} {
 *     senderId, text, createdAt,
 *     status: 'sent' | 'read',         // 1 ptichka / 2 ptichka uchun
 *     readAt                           // o'qilgan vaqt (status='read' bo'lganda)
 *   }
 *   chatId = [uidA, uidB] tartiblanib '_' bilan birlashtiriladi (har doim bitta xat ID)
 *
 * NOT: agar real qurilmada ptichkalar 1dan 2ga o'tmasa — Firestore Security
 * Rules'ni tekshiring. messages/{msgId} hujjatini OLDIN faqat senderId yozgan,
 * endi esa qabul qiluvchi (boshqa ishtirokchi) ham shu hujjatni "status: read"
 * qilib yangilashi kerak — demak update qoidasi faqat
 * `senderId == request.auth.uid` bilan emas, balki ikkala ishtirokchiga ham
 * ruxsat berishi kerak (masalan: request.auth.uid in get(parent chat).data.participants).
 */
import { db, state, uploadViaController, isAdmin, auth } from './config.js';
import { $, esc, defAvi, fmt, fmtTime, fmtSz } from './utils.js';
import { toast }            from './toast.js';
import {
  startGroupsWatcher, stopGroupsWatcher,
  openGroupThread, closeGroupThread,
  sendGroupMessage, sendGroupFile,
  injectGroupsDOM, openCreateChoice, getGroupRows,
  getCurrentGroupId, openJoinByLink, joinGroupByCode
} from './groups.js';
import {
  collection, query, where, orderBy, limit,
  doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
  onSnapshot, serverTimestamp, writeBatch, increment, arrayUnion
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import {
  cacheChatsList, getCachedChatsList, getCachedChatsListAgeMs,
  cacheThreadMessages, getCachedThreadMessages
} from './local-cache.js';

const MSG_LIMIT = 60; // Bir thread'da max xabar soni (RAM tejash)

/* ── Helpers ──────────────────────────────────────────────────────────── */
function chatIdFor(uidA, uidB) {
  return [uidA, uidB].sort().join('_');
}

let _threadUnsub = null;
let _chatSelFile = null;

/* ── Global chats watcher (badge + chats list, real-time) ─────────────
   Bitta onSnapshot orqali HAR DOIM (foydalanuvchi qaysi view'da turishidan
   qat'i nazar) ishlaydi — login bo'lgan zahoti boshlanadi (auth.js orqali).
   Shu bitta listener ikki narsani ta'minlaydi:
     1) Sidebar/bottom-nav dagi "Suhbatlar" tugmasi ustidagi kichik qizil
        badge — barcha chatlardagi umumiy o'qilmagan xabarlar soni.
     2) Suhbatlar ro'yxati (har bir foydalanuvchi qatoridagi kattaroq badge) —
        agar foydalanuvchi hozir aynan shu view'da bo'lsa, real vaqtda
        qayta chiziladi.
   ──────────────────────────────────────────────────────────────────── */
let _chatsUnsub     = null;
let _usersCache     = null;
let _latestChatMap  = {};
let _watcherPromise = null;
let _noticeUnsub    = null;   // adminNotice real-time listener
let _latestNotice   = null;   // { text, target, createdAt } | null
let _contactsUnsub  = null;   // contacts real-time listener
let _myContacts     = new Set(); // current user's contact UIDs
let _groupsListenerAttached = false; // groupsUpdated leak oldini olish

function updateChatBadge(count) {
  const badge = $('chatBadge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = `+${count > 99 ? 99 : count}`;
    badge.classList.remove('d-none');
  } else {
    badge.textContent = '';
    badge.classList.add('d-none');
  }
}

export function startChatsWatcher() {
  // Also start groups watcher
  startGroupsWatcher();
  // Listen for group updates to repaint list — faqat BIR MARTA qo'shamiz
  if (!_groupsListenerAttached) {
    _groupsListenerAttached = true;
    document.addEventListener('groupsUpdated', () => {
      if (state.view === 'chats') paintChatsList(_usersCache || [], _latestChatMap);
    });
  }

  if (_chatsUnsub) return Promise.resolve();
  if (_watcherPromise) return _watcherPromise;

  _watcherPromise = (async () => {
    if (!state.me) return;

    // Agar kesh 5 daqiqadan yangi bo'lsa — butun "users" kolleksiyasini
    // qayta tarmoqdan yuklamaymiz (bu og'ir so'rov, foydalanuvchilar
    // ko'payib borgan sari sekinlashadi). Kesh eskirgan/yo'q bo'lsagina
    // yangilaymiz.
    const cacheAgeMs = getCachedChatsListAgeMs(state.me.uid);
    const cacheIsFresh = cacheAgeMs !== null && cacheAgeMs < 5 * 60 * 1000;

    if (cacheIsFresh) {
      // _usersCache hali o'rnatilmagan bo'lishi mumkin (masalan foydalanuvchi
      // "Suhbatlar" bo'limini hali ochmagan bo'lsa) — shu holatda ham
      // to'g'ridan-to'g'ri localStorage'dagi keshdan o'qib olamiz.
      if (!_usersCache) {
        const cached = getCachedChatsList(state.me.uid);
        _usersCache = cached?.users || [];
      }
    } else {
      try {
        const usersSnap = await getDocs(collection(db, 'users'));
        _usersCache = usersSnap.docs
          .map(d => ({ uid: d.id, ...d.data() }))
          .filter(u => u.uid !== state.me.uid && u.approved === true && u.blocked !== true);
        cacheChatsList(state.me.uid, _usersCache, _latestChatMap);
      } catch (err) {
        console.warn('[Chat] users fetch failed:', err.message);
        _usersCache = _usersCache || [];
      }
    }

    // Kontaktlar listener — oddiy user uchun contacts subcollection.
    // MUHIM: bu yerda ENDI hech narsani kutmaymiz (avval "birinchi snapshot
    // kelguncha yoki 5 soniya" deb sun'iy kutish bor edi — aynan shu
    // "10 soniya+" sekinlikning asosiy sababi edi). Listener fonda ishga
    // tushadi, ma'lumot kelganda ekran o'zi jimgina yangilanadi.
    if (!isAdmin() && !_contactsUnsub) {
      _contactsUnsub = onSnapshot(
        collection(db, 'users', state.me.uid, 'contacts'),
        snap => {
          _myContacts = new Set(snap.docs.map(d => d.id));
          if (state.view === 'chats') paintChatsList(_usersCache || [], _latestChatMap);
        },
        (err) => console.warn('[Chat] contacts snapshot error:', err.message)
      );
    }

    if (!state.me) return; // logout race davomida

    // adminNotice real-time listener
    if (!_noticeUnsub) {
      _noticeUnsub = onSnapshot(doc(db, 'adminNotice', 'global'), snap => {
        _latestNotice = snap.exists() ? snap.data() : null;
        if (state.view === 'chats') _repaintNoticeBanner();
      }, () => {});
    }

    _chatsUnsub = onSnapshot(
      query(collection(db, 'chats'), where('participants', 'array-contains', state.me.uid)),
      snap => {
        const chatMap = {};
        let total = 0;
        snap.docs.forEach(d => {
          const c = d.data();
          const otherUid = (c.participants || []).find(p => p !== state.me?.uid);
          if (otherUid) chatMap[otherUid] = { id: d.id, ...c };
          total += c.unreadCount?.[state.me?.uid] || 0;
        });
        _latestChatMap = chatMap;
        updateChatBadge(total);
        if (_usersCache) cacheChatsList(state.me.uid, _usersCache, chatMap);
        if (state.view === 'chats') paintChatsList(_usersCache || [], chatMap);
      },
      err => console.warn('[Chat] chats watcher error:', err.message)
    );
  })();

  return _watcherPromise;
}

export function stopChatsWatcher() {
  stopGroupsWatcher();
  if (_chatsUnsub) { _chatsUnsub(); _chatsUnsub = null; }
  if (_noticeUnsub) { _noticeUnsub(); _noticeUnsub = null; }
  if (_contactsUnsub) { _contactsUnsub(); _contactsUnsub = null; }
  _usersCache    = null;
  _latestChatMap = {};
  _latestNotice  = null;
  _myContacts    = new Set();
  _watcherPromise = null;
  _groupsListenerAttached = false;
  updateChatBadge(0);
}

/* ── Render chats list (all registered users) ───────────────────────── */
export async function renderChatsList() {
  const root = $('chatsListWrap');
  if (!root || !state.me) return;

  if (!_usersCache) {
    // Tarmoqni kutmasdan — keshdagi so'nggi ma'lumotni darhol ko'rsatamiz
    const cached = getCachedChatsList(state.me.uid);
    if (cached && cached.users && cached.users.length) {
      _usersCache    = cached.users;
      _latestChatMap = cached.chatMap || {};
      paintChatsList(_usersCache, _latestChatMap);
    } else {
      root.innerHTML = `<div class="spin-wrap pt-60px"><div class="spinner"></div></div>`;
    }
  }

  try {
    await startChatsWatcher();

    if (!_usersCache || !_usersCache.length) {
      root.innerHTML = `<div class="empty pt-30vh tac">
        <div class="fs-14px fw-600 c-text mb-6px">Hozircha boshqa foydalanuvchilar yo'q</div>
        <div class="fs-13px c-text2">Odamlar MRgram ga qo'shilgach, shu yerda ko'rinadi</div>
      </div>`;
      return;
    }

    paintChatsList(_usersCache, _latestChatMap);
  } catch (err) {
    console.error('❌ Firebase: renderChatsList failed:', err.message);
    root.innerHTML = `<div class="empty pt-30vh tac">
      <div class="fs-14px fw-600 c-text mb-6px">Suhbatlar yuklanmadi</div>
      <div class="fs-13px c-text2">${esc(err.message)}</div>
    </div>`;
  }
}

/* ── Admin notice banner (chats tepasida) ────────────────────────────── */
function _injectNoticeCSS() {
  if (document.getElementById('admin-notice-css')) return;
  const s = document.createElement('style');
  s.id = 'admin-notice-css';
  s.textContent = `
.admin-notice-banner {
  display: flex; align-items: flex-start; gap: 10px;
  margin: 12px 16px 4px;
  background: color-mix(in srgb, var(--blue) 12%, var(--bg2));
  border: 1px solid color-mix(in srgb, var(--blue) 35%, transparent);
  border-radius: 12px;
  padding: 11px 14px;
  font-size: 13px;
  color: var(--text);
  line-height: 1.45;
}
.admin-notice-icon { color: var(--blue); flex-shrink:0; margin-top:1px; }
.admin-notice-text { flex: 1; word-break: break-word; }
`;
  document.head.appendChild(s);
}

function _repaintNoticeBanner() {
  const wrap = $('chatsListWrap');
  if (!wrap) return;
  const existing = document.getElementById('adminNoticeBanner');
  if (existing) existing.remove();
  if (!_latestNotice || !_latestNotice.text) return;
  const t = _latestNotice.target || 'all';
  if (t === 'pending') return; // kutayotganlar uchun — chatda ko'rinmaydi
  _injectNoticeCSS();
  const html = `<div class="admin-notice-banner" id="adminNoticeBanner">
    <div class="admin-notice-icon">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
    </div>
    <div class="admin-notice-text">${esc(_latestNotice.text)}</div>
  </div>`;
  wrap.insertAdjacentHTML('afterbegin', html);
}

export function repaintNoticeBanner() { _repaintNoticeBanner(); }

/* ── Append group/channel rows to chats list ─────────────────────────── */
function _appendGroupRows(root) {
  // Remove old group section if any
  root.querySelector('.grp-rows-section')?.remove();

  const groups = getGroupRows();
  if (!groups.length) return;

  const section = document.createElement('div');
  section.className = 'grp-rows-section';

  section.innerHTML = `<div class="chats-section-label">Guruhlar va kanallar</div>` +
    groups.map(g => {
      const av      = g.avatar || defAvi(g.name || 'G');
      const unread  = g.unreadCount?.[state.me?.uid] || 0;
      const badgeTxt = unread > 99 ? '+99' : `+${unread}`;
      const preview  = g.lastMessage ? esc(g.lastMessage.slice(0, 46)) : (g.type === 'channel' ? 'Kanal' : 'Guruh');
      const time     = g.lastMessageAt ? fmt(g.lastMessageAt) : '';
      const typeIcon = g.type === 'channel'
        ? `<svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>`
        : `<svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
      const badgeClass = g.type === 'channel' ? 'chat-row-grp-badge--channel' : 'chat-row-grp-badge--group';

      return `<div class="chat-row${unread ? ' unread' : ''}" data-gid="${g.id}">
        <div class="chat-avi">
          <img src="${av}" onerror="this.style.display='none'">
          <div class="chat-row-grp-badge ${badgeClass}">${typeIcon}</div>
        </div>
        <div class="chat-row-body">
          <div class="chat-row-name">${esc(g.name || 'Guruh')}</div>
          <div class="chat-row-preview">${preview}</div>
        </div>
        <div class="chat-row-right">
          ${time ? `<div class="chat-row-time">${time}</div>` : ''}
          ${unread ? `<div class="chat-row-badge">${badgeTxt}</div>` : ''}
        </div>
      </div>`;
    }).join('');

  root.appendChild(section);

  section.querySelectorAll('.chat-row[data-gid]').forEach(row => {
    row.addEventListener('click', () => openGroupThread(row.dataset.gid));
  });
}

function paintChatsList(users, chatMap) {
  const root = $('chatsListWrap');
  if (!root) return;

  // Search box endi hamma uchun (admin va oddiy user) ko'rsatiladi
  _renderSearchBox(root);

  const admin = isAdmin();
  const q = _searchQuery;
  let filtered;
  if (q) {
    const lq = q.toLowerCase();
    filtered = users.filter(u =>
      (u.username || '').toLowerCase().includes(lq) ||
      (u.fullName || '').toLowerCase().includes(lq)
    );
  } else if (admin) {
    // Admin uchun: qidiruv bo'sh bo'lsa to'liq ro'yxat ko'rinadi
    filtered = users;
  } else {
    // Oddiy user uchun: qidiruv bo'sh bo'lsa faqat kontaktlar ko'rinadi
    // (eski chat tarixi hisobga olinmaydi — hammada 0dan boshlanadi)
    filtered = users.filter(u => _myContacts.has(u.uid));
  }
  _paintUserRows(filtered);
  _repaintNoticeBanner();
  _appendGroupRows(root);
}

/* ── Other user avatar cache for DM messages ─────────────────────────── */
let _otherUserAvi = '';
let _otherUserUid = '';

/* ── Open chat thread ─────────────────────────────────────────────────── */
export async function openChatThread(uid) {
  if (!uid || !state.me || uid === state.me.uid) return;

  $('chatThreadModal').classList.add('show');
  $('chatThreadName').textContent   = '...';
  $('chatThreadAvi').innerHTML      = '';
  $('chatThreadInput').value        = '';

  state.currentChatUid = uid;
  const chatId = chatIdFor(state.me.uid, uid);
  state.currentChatId = chatId;

  // Tarmoqni kutmasdan — keshdagi so'nggi xabarlarni darhol ko'rsatamiz
  const _cachedMsgs = getCachedThreadMessages(chatId);
  if (_cachedMsgs && _cachedMsgs.length) {
    paintMessages(_cachedMsgs);
  } else {
    $('chatThreadMessages').innerHTML = `<div class="spin-wrap pt-60px"><div class="spinner"></div></div>`;
  }
  // Reset voice/file state (functions defined below, safe after page load)
  try { cancelRecording(); } catch(_) {}
  _chatSelFile = null;
  $('chatFilePreview')?.classList.remove('active');
  $('chatFileInput') && ($('chatFileInput').value = '');
  try { updateVoiceSendBtn(); } catch(_) {}

  try {
    const uSnap = await getDoc(doc(db, 'users', uid));
    const ud = uSnap.data() || {};
    const av = ud.avatar || defAvi(ud.fullName || 'U');
    $('chatThreadName').textContent = ud.fullName || 'Foydalanuvchi';
    $('chatThreadAvi').innerHTML = `<img src="${av}" onerror="this.style.display='none'">`;
    // Cache for message avatars
    _otherUserAvi = av;
    _otherUserUid = uid;
  } catch (err) {
    console.warn('[Chat] Failed to load user info:', err.message);
    _otherUserAvi = defAvi('U');
    _otherUserUid = uid;
  }

  // Parent chat hujjatini OLDIN yaratib/merge qilib qo'yamiz (participants bilan)
  // va shu bilan birga MENING o'qilmagan xabarlar sonimni nolga tushiramiz —
  // chunki men bu chatni ochyapman, demak hozirgacha kelganlarni ko'raman.
  // Sabab (participants uchun): Firestore rules'da messages subcollection
  // ruxsati get(chats/{chatId}).data.participants ga bog'liq — agar parent
  // hujjat hali mavjud bo'lmasa (birinchi marta suhbat ochilganda), bu get()
  // xato beradi va onSnapshot listener "permission-denied" bilan o'chib qoladi.
  //
  // MUHIM: oldin bu yerda avval getDoc() bilan mavjudligini tekshirib, keyin
  // setDoc/updateDoc tanlanardi — lekin chat hujjati HALI mavjud bo'lmaganda
  // o'sha getDoc() o'zi "permission-denied" bilan rad etiladi (chunki rules
  // "read" qoidasi resource.data.participants ga qaraydi, hujjat yo'q bo'lsa
  // resource == null va shu joyga murojaat xato beradi — Firestore buni ham
  // rad etish deb hisoblaydi). Natijada try/catch xatoni yutib yuborardi,
  // hujjat HECH QACHON yaratilmasdi va birinchi xabar yuborilganda
  // updateDoc() "No document to update" bilan muvaffaqiyatsiz tugardi.
  // Yechim: alohida tekshiruvsiz, bitta idempotent setDoc(merge:true) —
  // bu ham yangi hujjatni yaratadi (create qoidasi), ham mavjudini
  // o'zgartiradi (update qoidasi), getDoc talab qilmaydi. participants'ni
  // doim BIR XIL (saralangan) tartibda yozamiz — aks holda ikkinchi
  // foydalanuvchi chatni ochganda boshqa tartibda qayta yozib, "onlyFields"
  // tekshiruvini buzib qo'yardi (participants update ro'yxatida yo'q).
  try {
    await setDoc(doc(db, 'chats', chatId), {
      participants: [state.me.uid, uid].sort(),
      unreadCount:  { [state.me.uid]: 0 }
    }, { merge: true });
  } catch (err) {
    console.warn('[Chat] Failed to init chat doc:', err.message);
  }

  // Kontaktlarni saqlash — xato bo'lsa chat ochilishga ta'sir qilmaydi
  try {
    const otherSnap = await getDoc(doc(db, 'users', uid));
    const od = otherSnap.data() || {};
    const meSnap = await getDoc(doc(db, 'users', state.me.uid));
    const meD = meSnap.data() || {};
    await setDoc(doc(db, 'users', state.me.uid, 'contacts', uid), {
      uid,
      fullName: od.fullName || '',
      avatar: od.avatar || '',
      addedAt: serverTimestamp()
    }, { merge: true });
    // Boshqa user uchun contacts yozish serverda (Cloud Function) yoki
    // u o'zi chat ochganda bajariladi — permission-denied oldini olish uchun
    // bu yerda faqat o'z kontaktimizni saqlaymiz
    _myContacts.add(uid);
  } catch (err) {
    console.warn('[Chat] Failed to save contacts:', err.message);
  }

  if (_threadUnsub) { _threadUnsub(); _threadUnsub = null; }

  _threadUnsub = onSnapshot(
    query(collection(db, 'chats', chatId, 'messages'), orderBy('createdAt', 'desc'), limit(MSG_LIMIT)),
    snap => {
      const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() })).reverse();
      paintMessages(msgs);
      cacheThreadMessages(chatId, msgs);
      // Thread hozir ham ochiq turgan bo'lsa (foydalanuvchi xabarni
      // "ko'rib turgani" demakdir) — boshqa tomondan kelgan o'qilmagan
      // xabarlarni shu zahoti "read" deb belgilaymiz. Bu real vaqtda
      // yuboruvchi tomonda 1 ptichkadan 2 ptichkaga aylanishini ta'minlaydi.
      if (state.currentChatId === chatId && $('chatThreadModal').classList.contains('show')) {
        markThreadRead(chatId, uid, msgs);
      }
    },
    err => {
      console.warn('[Chat] Thread listener error:', err.message);
      $('chatThreadMessages').innerHTML = `<div class="empty pt-30vh tac">
        <div class="fs-13px c-text2">Xabarlar yuklanmadi</div>
      </div>`;
    }
  );
}

/* ── Mark incoming (other user's) messages as read ───────────────────── */
async function markThreadRead(chatId, otherUid, msgs) {
  if (!state.me) return;
  const unread = msgs.filter(m => m.senderId === otherUid && m.status !== 'read');
  if (!unread.length) return;


  try {
    const batch = writeBatch(db);
    unread.forEach(m => {
      // MUHIM: Firestore rules da ikkala ishtirokchi ham update qila olishi kerak!
      // rules: allow update: if request.auth.uid in resource.data.participants
      // (yoki parent chat doc participants ga tekshiring)
      batch.update(doc(db, 'chats', chatId, 'messages', m.id), {
        status: 'read',
        readAt: serverTimestamp()
      });
    });
    // unreadCount ni nolga tushiramiz (o'zimizniki)
    batch.update(doc(db, 'chats', chatId), {
      [`unreadCount.${state.me.uid}`]: 0
    });
    await batch.commit();
  } catch (err) {
    // Agar Firestore rules xato bersa, bu yerda ko'rinadi
    console.error('❌ markThreadRead failed:', err.code, err.message);
    if (err.code === 'permission-denied') {
      console.warn(
        'Firestore Rules muammosi!\n' +
        'messages/{msgId} uchun update ruxsati yo\'q.\n' +
        'Rules da: allow update: if request.auth.uid in get(/databases/$(database)/documents/chats/$(chatId)).data.participants;'
      );
    }
  }
}

function renderTicks(status) {
  // 'read' = 2 ko'k chek, boshqa holat (sent/undefined/null) = 1 oq chek
  if (status === 'read') {
    return `<svg class="msg-ticks read" width="18" height="11" viewBox="0 0 18 11" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M1 5.5L4.5 9L10 2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M6 5.5L9.5 9L16 1.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }
  // sent (yoki pending)
  return `<svg class="msg-ticks" width="12" height="10" viewBox="0 0 12 10" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M1 5.2L4.5 8.5L11 1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

/* ── Voice waveform bars (random-ish heights for visual) ─────────────── */
function renderVoiceWave(seed = 0, count = 28) {
  let bars = '';
  for (let i = 0; i < count; i++) {
    const h = 4 + Math.abs(Math.sin((i + seed) * 0.8 + seed * 0.3) * 20);
    bars += `<span class="cvm-bar" style="height:${h.toFixed(1)}px"></span>`;
  }
  return bars;
}

function paintMessages(msgs) {
  const box = $('chatThreadMessages');
  if (!box) return;

  if (!msgs.length) {
    box.innerHTML = `<div class="empty pt-30vh tac">
      <div class="fs-14px fw-600 c-text mb-6px">Hozircha xabarlar yo'q</div>
      <div class="fs-13px c-text2">Salom bering</div>
    </div>`;
    return;
  }

  const prevCount = box.querySelectorAll('.chat-msg').length;
  // Foydalanuvchi pastda (eng oxirgi xabarlarda) turganini tekshiramiz
  // threshold: pastdan 120px uzoqda bo'lsa "pastda" hisoblanadi
  const isAtBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  const isInitialLoad = prevCount === 0;

  box.innerHTML = msgs.map((m, idx) => {
    const mine = m.senderId === state.me?.uid;
    const time = fmtTime(m.createdAt);
    let bubbleContent = '';

    if (m.type === 'voice') {
      /* ── Voice message ── */
      const dur = m.duration ? fmtVoiceDur(m.duration) : '0:00';
      // URL ni esc() orqali o'tkazmaymiz — & belgisi buziladi!
      // data-* attributga to'g'ridan-to'g'ri qo'yamiz
      const safeUrl = (m.mediaUrl || '').replace(/"/g, '&quot;');
      bubbleContent = `<div class="chat-voice-msg" data-url="${safeUrl}" data-dur="${m.duration||0}">
        <button class="cvm-play" onclick="window._chatPlayVoice(this)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </button>
        <div class="cvm-waveform">${renderVoiceWave(idx)}</div>
        <span class="cvm-dur">${dur}</span>
      </div>`;
    } else if (m.type === 'file') {
      /* ── File message ── */
      const fname = esc(m.fileName || 'file');
      const fsz = m.fileSize ? fmtSz(m.fileSize) : '';
      const safeUrl = (m.mediaUrl || '').replace(/"/g, '&quot;');
      const _ext = (m.fileName || '').toLowerCase().split('.').pop() || '';
      const _mime = (m.mediaType || '').toLowerCase();
      const _isImage = _mime.startsWith('image') || ['jpg','jpeg','png','gif','webp','svg','avif'].includes(_ext);
      const _isVideo = _mime.startsWith('video') || ['mp4','mov','avi','mkv','webm'].includes(_ext);

      if (_isImage) {
        /* ── Image preview inline ── */
        bubbleContent = `<div class="cfm-media-wrap">
          <a href="${safeUrl}" target="_blank" rel="noopener" class="cfm-img-link">
            <img class="cfm-img-preview" src="${safeUrl}" alt="${fname}" loading="lazy" onload="this.classList.add('loaded')">
          </a>
          ${fsz ? `<div class="cfm-media-meta">${fname} · ${fsz}</div>` : ''}
        </div>`;
      } else if (_isVideo) {
        /* ── Video preview inline ── */
        bubbleContent = `<div class="cfm-media-wrap">
          <video class="cfm-video-preview" src="${safeUrl}" controls playsinline preload="metadata">
            <a href="${safeUrl}" target="_blank" rel="noopener">${fname}</a>
          </video>
          ${fsz ? `<div class="cfm-media-meta">${fname} · ${fsz}</div>` : ''}
        </div>`;
      } else {
        /* ── Other files — name is clickable link ── */
        bubbleContent = `<div class="chat-file-msg">
          <div class="cfm-icon">${getChatFileIcon(m.fileName, m.mediaType)}</div>
          <div class="cfm-info">
            <a class="cfm-name cfm-name--link" href="${safeUrl}" target="_blank" rel="noopener" title="Ochish">${fname}</a>
            ${fsz ? `<div class="cfm-size">${fsz}</div>` : ''}
          </div>
          <a class="cfm-dl" href="${safeUrl}" download="${fname}" target="_blank" title="Yuklab olish">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
          </a>
        </div>`;
      }
    } else {
      /* ── Text message ── */
      bubbleContent = `<div class="chat-bubble-text">${esc(m.text || '')}</div>`;
    }

    const isNew = idx >= prevCount;
    return `<div class="chat-msg ${mine ? 'mine' : 'theirs'}${isNew ? ' anim-in' : ''}" data-msg-id="${m.id || ''}" style="${isNew ? `animation-delay:${Math.min(idx * 0.04, 0.3)}s` : ''}">
      
      <div class="chat-bubble">
        <div class="chat-bubble-wrap">
          ${bubbleContent}
          <span class="chat-msg-meta">
            <span class="chat-msg-time">${time}</span>
            ${mine ? renderTicks(m.status) : ''}
          </span>
        </div>
      </div>
    </div>`;
  }).join('');

  // Faqat pastda turgan bo'lsak yoki chat yangi ochilgan bo'lsa scroll qilamiz
  if (isAtBottom || isInitialLoad) {
    setTimeout(() => { box.scrollTop = box.scrollHeight; }, 60);
  }

  // "theirs" xabarlaridagi avatar bosilganda profil ochamiz
  box.querySelectorAll('.msg-avi-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const uid = btn.dataset.uid;
      if (!uid || uid === state.me?.uid) return;
      const { openUserProfileModal } = await import('./profile.js');
      openUserProfileModal(uid);
    });
  });
}

/* ── Yopish chat thread ───────────────────────────────────────────────── */
export function closeChatThread() {
  if (_threadUnsub) { _threadUnsub(); _threadUnsub = null; }
  // If in group/channel mode, cleanup group state too
  if (state.currentChatKind && state.currentChatKind !== 'dm') {
    closeGroupThread();
  }
  state.currentChatUid = null;
  state.currentChatId  = null;
  $('chatThreadModal').classList.remove('show');
  // Chat ro'yxatini yangilash — oxirgi xabar/preview yangi bo'lishi uchun
  if (state.view === 'chats') renderChatsList();
}

/* ── Send message ────────────────────────────────────────────────────── */
export async function sendChatMessage() {
  // Route to group/channel send if in that mode
  if (state.currentChatKind && state.currentChatKind !== 'dm') {
    return sendGroupMessage();
  }
  const inp  = $('chatThreadInput');
  const text = inp?.value?.trim();
  if (!text || !state.currentChatId || !state.me) return;

  const chatId   = state.currentChatId;
  const otherUid = state.currentChatUid;

  inp.value = '';

  // 1v1 (shaxsiy) chatlarda AI moderatsiya ishlatilmaydi — bu yerda
  // atayin hech qanday tekshiruv yo'q, xabar to'g'ridan-to'g'ri yuboriladi.

  try {
    await updateDoc(doc(db, 'chats', chatId), {
      lastMessage:   text,
      lastSenderId:  state.me.uid,
      lastMessageAt: serverTimestamp(),
      [`unreadCount.${otherUid}`]: increment(1)
    });

    await addDoc(collection(db, 'chats', chatId, 'messages'), {
      senderId:  state.me.uid,
      text,
      status:    'sent',
      createdAt: serverTimestamp()
    });

    // Push notification — chat tezligiga ta'sir qilmasligi uchun await qilmaymiz
    auth.currentUser?.getIdToken().then(idToken => fetch('/api/send-notification', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        toUid:    otherUid,
        fromUid:  state.me.uid,
        fromName: state.me.displayName || 'Noma\'lum',
        chatId,
        text,
      }),
    }))
      .then(async r => {
        const data = await r.json().catch(() => ({}));
        // r.ok bo'lmasa ham fetch() reject bo'lmaydi (faqat tarmoq xatosida
        // reject bo'ladi) — shuning uchun bu yerda status alohida tekshiriladi,
        // aks holda server tomonidagi xato (masalan, FIREBASE_SERVICE_ACCOUNT
        // sozlanmagani) hech qachon konsolda ko'rinmay, jim qolib ketadi.
        if (!r.ok) console.warn('[Push] notify HTTP', r.status, data);
      })
      .catch(err => console.warn('[Push] notify failed:', err.message));
  } catch (err) {
    console.error('❌ Firebase: sendChatMessage failed:', err.message);
    toast('Xabar yuborilmadi', 'error');
    inp.value = text; // qaytarib qo'yamiz, user qayta yuborishi uchun
  }
}

/* ── Helpers for new features ───────────────────────────────────────── */
function fmtVoiceDur(s) {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${sec < 10 ? '0' : ''}${sec}`;
}

function getChatFileIcon(name = '', mime = '') {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const m   = (mime || '').toLowerCase();

  if (m.startsWith('image') || ['jpg','jpeg','png','gif','webp','svg'].includes(ext))
    return `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="10" fill="rgba(34,197,94,0.12)"/><rect x="8" y="12" width="32" height="24" rx="4" stroke="#22c55e" stroke-width="2"/><circle cx="17" cy="20" r="3" stroke="#22c55e" stroke-width="1.8"/><path d="M8 30l8-7 7 6 5-4 12 9" stroke="#22c55e" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  if (m.startsWith('audio') || ['mp3','wav','ogg','aac','opus','m4a'].includes(ext))
    return `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="10" fill="rgba(168,85,247,0.12)"/><path d="M18 34V18l16-4v16" stroke="#a855f7" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="15" cy="34" r="3" fill="#a855f7"/><circle cx="31" cy="30" r="3" fill="#a855f7"/></svg>`;

  if (m.startsWith('video') || ['mp4','mov','avi','mkv','webm'].includes(ext))
    return `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="10" fill="rgba(239,68,68,0.12)"/><rect x="6" y="12" width="28" height="24" rx="4" stroke="#ef4444" stroke-width="2"/><path d="M34 18l8-4v20l-8-4V18z" stroke="#ef4444" stroke-width="2" stroke-linejoin="round"/><polygon points="18 19 18 29 26 24" fill="#ef4444"/></svg>`;

  if (ext === 'pdf' || m === 'application/pdf')
    return `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="10" fill="rgba(239,68,68,0.12)"/><path d="M13 8h16l8 8v24a2 2 0 0 1-2 2H13a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z" stroke="#ef4444" stroke-width="2"/><path d="M29 8v8h8" stroke="#ef4444" stroke-width="2"/><text x="24" y="34" text-anchor="middle" font-family="monospace" font-weight="700" font-size="9" fill="#ef4444">PDF</text></svg>`;

  return `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="10" fill="rgba(107,114,128,0.12)"/><path d="M13 8h16l8 8v24a2 2 0 0 1-2 2H13a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z" stroke="#9ca3af" stroke-width="2"/><path d="M29 8v8h8" stroke="#9ca3af" stroke-width="2"/><line x1="16" y1="24" x2="32" y2="24" stroke="#9ca3af" stroke-width="2" stroke-linecap="round"/><line x1="16" y1="30" x2="26" y2="30" stroke="#9ca3af" stroke-width="2" stroke-linecap="round"/></svg>`;
}

/* ── Voice player (global handler for onclick in innerHTML) ─────────── */
let _activeAudio = null;
let _activeBtn   = null;

window._chatPlayVoice = function(btn) {
  const wrap = btn.closest('.chat-voice-msg');
  const url  = wrap?.dataset?.url;

  if (!url) {
    console.warn('Voice: URL topilmadi', wrap?.dataset);
    toast('Audio URL topilmadi', 'error');
    return;
  }

  // Bir xil xabar — pause/resume
  if (_activeAudio && _activeBtn === btn) {
    if (_activeAudio.paused) {
      _activeAudio.play().catch(e => { console.error('Resume xatosi:', e); toast('Ijro etilmadi', 'error'); });
      btn.innerHTML = PAUSE_ICON;
    } else {
      _activeAudio.pause();
      btn.innerHTML = PLAY_ICON;
    }
    return;
  }

  // Boshqa xabar o'ynayotgan bo'lsa — to'xtat
  if (_activeAudio) {
    _activeAudio.pause();
    _activeAudio.onended = null;
    _activeAudio.ontimeupdate = null;
    if (_activeBtn) _activeBtn.innerHTML = PLAY_ICON;
    // Oldingi xabar barlarini reset
    const oldWrap = _activeBtn?.closest('.chat-voice-msg');
    oldWrap?.querySelectorAll('.cvm-bar').forEach(b => b.classList.remove('played'));
  }

  _activeBtn = btn;
  const audio = new Audio(url);
  _activeAudio = audio;

  const bars      = wrap.querySelectorAll('.cvm-bar');
  const durEl     = wrap.querySelector('.cvm-dur');
  const waveEl    = wrap.querySelector('.cvm-waveform');
  const total     = parseFloat(wrap.dataset.dur || '0') || 0;

  btn.innerHTML = PAUSE_ICON;
  if (waveEl) waveEl.classList.add('playing');

  audio.ontimeupdate = () => {
    const duration = audio.duration || total || 1;
    const pct = audio.currentTime / duration;
    const filled = Math.floor(pct * bars.length);
    bars.forEach((b, i) => b.classList.toggle('played', i < filled));
    if (durEl) durEl.textContent = fmtVoiceDur(audio.currentTime);
  };

  audio.onended = () => {
    if (waveEl) waveEl.classList.remove('playing');
    btn.innerHTML = PLAY_ICON;
    bars.forEach(b => b.classList.remove('played'));
    if (durEl) durEl.textContent = fmtVoiceDur(total);
    _activeAudio = null;
    _activeBtn   = null;
  };

  audio.onerror = (e) => {
    console.error('Audio xatosi:', e, 'URL:', url);
    toast('Audio yuklanmadi', 'error');
    btn.innerHTML = PLAY_ICON;
    _activeAudio = null;
    _activeBtn   = null;
  };

  audio.play().catch(e => {
    console.error('Audio play xatosi:', e, 'URL:', url);
    toast('Audio ijro etilmadi', 'error');
    btn.innerHTML = PLAY_ICON;
    _activeAudio = null;
    _activeBtn   = null;
  });
};

const PLAY_ICON  = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
const PAUSE_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;

/* ── Voice recording ─────────────────────────────────────────────────── */
let _mediaRec  = null;
let _recChunks = [];
let _recSecs   = 0;
let _recTimer  = null;

function startRecording() {
  navigator.mediaDevices.getUserMedia({ audio: true })
    .then(stream => {
      _recChunks = [];
      _recSecs   = 0;

      const opts = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? { mimeType: 'audio/webm;codecs=opus' }
        : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
        ? { mimeType: 'audio/ogg;codecs=opus' }
        : {};

      _mediaRec = new MediaRecorder(stream, opts);
      _mediaRec.ondataavailable = e => {
        if (e.data.size > 0) _recChunks.push(e.data);
        // Real-time amplitude pulse — AudioContext orqali
        _updateVoicePulse(stream);
      };
      _mediaRec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        if (_pulseAnalyser) { _pulseAnalyser = null; }
        const duration = _recSecs;
        const mimeType = _mediaRec.mimeType || 'audio/webm';
        const blob = new Blob(_recChunks, { type: mimeType });
        sendVoiceMessage(blob, duration);
      };
      _mediaRec.start(100);

      // Voice btn — recording pulse
      $('chatVoiceBtn').classList.add('recording');
      _startVoicePulse(stream);

      // Timer
      _recTimer = setInterval(() => {
        _recSecs++;
        // Timer labelini btn tooltip ga yozamiz (ixtiyoriy)
      }, 1000);
    })
    .catch(err => {
      console.error('Mikrofon xatosi:', err);
      toast('Mikrofonga ruxsat berilmadi', 'error');
    });
}

/* ── Real-time voice amplitude → btn ring pulse ── */
let _pulseAnalyser = null;
let _pulseAudioCtx = null;
let _pulseRaf = null;

function _startVoicePulse(stream) {
  try {
    _pulseAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = _pulseAudioCtx.createMediaStreamSource(stream);
    const analyser = _pulseAudioCtx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    _pulseAnalyser = analyser;
    const data = new Uint8Array(analyser.frequencyBinCount);
    const btn = $('chatVoiceBtn');

    const tick = () => {
      if (!_pulseAnalyser) return;
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const avg = sum / data.length; // 0–255
      const scale = Math.min(1 + avg / 120, 1.55); // 1.0 – 1.55
      const glow  = Math.min(avg * 0.9, 180);
      if (btn) {
        btn.style.setProperty('--rec-scale', scale.toFixed(3));
        btn.style.setProperty('--rec-glow', glow.toFixed(0));
      }
      _pulseRaf = requestAnimationFrame(tick);
    };
    tick();
  } catch(e) { /* AudioContext yo'q bo'lsa oddiy pulse */ }
}

function _stopVoicePulse() {
  if (_pulseRaf) { cancelAnimationFrame(_pulseRaf); _pulseRaf = null; }
  if (_pulseAudioCtx) { try { _pulseAudioCtx.close(); } catch(_) {} _pulseAudioCtx = null; }
  _pulseAnalyser = null;
  const btn = $('chatVoiceBtn');
  if (btn) { btn.style.removeProperty('--rec-scale'); btn.style.removeProperty('--rec-glow'); }
}

function _updateVoicePulse() { /* ondataavailable'dan chaqiriladi — hech narsa kerak emas, RAF ishlab turibdi */ }

function stopRecording() {
  if (_recTimer) { clearInterval(_recTimer); _recTimer = null; }
  _stopVoicePulse();
  if (_mediaRec && _mediaRec.state !== 'inactive') _mediaRec.stop();
  $('chatVoiceBtn').classList.remove('recording');
}

function cancelRecording() {
  if (_recTimer) { clearInterval(_recTimer); _recTimer = null; }
  _stopVoicePulse();
  if (_mediaRec) {
    _mediaRec.ondataavailable = null;
    _mediaRec.onstop = null;
    if (_mediaRec.state !== 'inactive') {
      _mediaRec.stream?.getTracks().forEach(t => t.stop());
      try { _mediaRec.stop(); } catch(_) {}
    }
    _mediaRec = null;
  }
  _recChunks = [];
  $('chatVoiceBtn').classList.remove('recording');
}

async function sendVoiceMessage(blob, duration) {
  if (!state.currentChatId || !state.me) return;
  const chatId   = state.currentChatId;
  const otherUid = state.currentChatUid;

  // Pending message — loading bubble ko'rsatish
  const pendingId = 'pending_voice_' + Date.now();
  _showPendingBubble(pendingId, 'voice', blob.size);

  try {
    const ext = blob.type.includes('ogg') ? 'ogg' : 'webm';
    const file = new File([blob], `voice_${Date.now()}.${ext}`, { type: blob.type });
    const result = await uploadViaControllerProgress(file, 'chat-voice', pct => {
      _updatePendingProgress(pendingId, pct);
    });

    _removePendingBubble(pendingId);

    await updateDoc(doc(db, 'chats', chatId), {
      lastMessage:   'Ovozli xabar',
      lastSenderId:  state.me.uid,
      lastMessageAt: serverTimestamp(),
      [`unreadCount.${otherUid}`]: increment(1)
    });

    await addDoc(collection(db, 'chats', chatId, 'messages'), {
      senderId:  state.me.uid,
      type:      'voice',
      mediaUrl:  result.url,
      mediaPath: result.path,
      storageIndex: result.storageIndex,
      duration,
      status:    'sent',
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.error('Voice send failed:', err);
    _removePendingBubble(pendingId);
    toast('Ovozli xabar yuborilmadi', 'error');
  }
}

/* ── Chat file attach ──────────────────────────────────────────────────── */
function setChatFile(file) {
  _chatSelFile = file;
  $('cfpIcon').innerHTML = getChatFileIcon(file.name, file.type);
  $('cfpName').textContent = file.name.length > 36 ? file.name.slice(0, 34) + '…' : file.name;
  $('cfpSize').textContent = fmtSz(file.size);
  $('chatFilePreview').classList.add('active');
  updateVoiceSendBtn();
}

function clearChatFile() {
  _chatSelFile = null;
  $('chatFilePreview').classList.remove('active');
  $('chatFileInput').value = '';
  updateVoiceSendBtn();
}

function updateVoiceSendBtn() {
  const inp  = $('chatThreadInput');
  const hasText = inp?.value?.trim().length > 0;
  const hasFile = !!_chatSelFile;
  const showSend = hasText || hasFile;
  const mic  = $('chatVoiceBtn').querySelector('.icon-mic');
  const send = $('chatVoiceBtn').querySelector('.icon-send');
  if (mic)  mic.style.display  = showSend ? 'none'  : '';
  if (send) send.style.display = showSend ? ''      : 'none';
}

async function sendChatFile() {
  if (!_chatSelFile || !state.me) return;
  // Route to group file send if in group mode
  if (state.currentChatKind && state.currentChatKind !== 'dm') {
    const file = _chatSelFile;
    clearChatFile();
    return sendGroupFile(file);
  }
  if (!state.currentChatId) return;
  const chatId   = state.currentChatId;
  const otherUid = state.currentChatUid;
  const file = _chatSelFile;

  // 1v1 (shaxsiy) chatlarda fayl/rasm uchun ham AI tekshiruvi yo'q.

  clearChatFile();

  const pendingId = 'pending_file_' + Date.now();
  _showPendingBubble(pendingId, 'file', file.size, file.name, file.type);

  try {
    const result = await uploadViaControllerProgress(file, 'chat-files', pct => {
      _updatePendingProgress(pendingId, pct);
    });

    _removePendingBubble(pendingId);

    await updateDoc(doc(db, 'chats', chatId), {
      lastMessage:   file.name,
      lastSenderId:  state.me.uid,
      lastMessageAt: serverTimestamp(),
      [`unreadCount.${otherUid}`]: increment(1)
    });

    await addDoc(collection(db, 'chats', chatId, 'messages'), {
      senderId:  state.me.uid,
      type:      'file',
      mediaUrl:  result.url,
      mediaPath: result.path,
      storageIndex: result.storageIndex,
      mediaType: file.type,
      fileName:  file.name,
      fileSize:  file.size,
      status:    'sent',
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.error('File send failed:', err);
    _removePendingBubble(pendingId);
    toast('Fayl yuborilmadi', 'error');
  }
}


/* ── Pending bubble (upload progress) ───────────────────────────────── */
function _showPendingBubble(id, type, size, name = '', mime = '') {
  const box = $('chatThreadMessages');
  if (!box) return;
  const szTxt = size ? fmtSz(size) : '';
  const isVoice = type === 'voice';
  const inner = isVoice
    ? `<div class="cpb-voice">
        <div class="cpb-mic-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="currentColor" fill="none" stroke-width="2"/></svg>
        </div>
        <div class="cpb-info">
          <div class="cpb-label">Ovoz yuborilmoqda...</div>
          ${szTxt ? `<div class="cpb-size">${szTxt}</div>` : ''}
        </div>
      </div>`
    : `<div class="cpb-file">
        <div class="cpb-file-icon">${getChatFileIcon(name, mime)}</div>
        <div class="cpb-info">
          <div class="cpb-label">${esc(name || 'Fayl')}</div>
          ${szTxt ? `<div class="cpb-size">${szTxt}</div>` : ''}
        </div>
      </div>`;

  const el = document.createElement('div');
  el.className = 'chat-msg mine cpb-wrap';
  el.id = id;
  el.innerHTML = `<div class="chat-bubble cpb-bubble">
    <div class="chat-bubble-wrap">
      ${inner}
      <div class="cpb-progress-bar"><div class="cpb-progress-fill" id="${id}_fill"></div></div>
      <div class="cpb-pct" id="${id}_pct">0%</div>
    </div>
  </div>`;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}

function _updatePendingProgress(id, pct) {
  const fill = document.getElementById(id + '_fill');
  const lbl  = document.getElementById(id + '_pct');
  if (fill) fill.style.width = pct + '%';
  if (lbl)  lbl.textContent  = Math.round(pct) + '%';
}

function _removePendingBubble(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

/* ── XHR upload with progress (Supabase direct upload) ─────────────── */
async function uploadViaControllerProgress(file, folder, onProgress) {
  // Avval controller va project ma'lumotlarini olamiz
  const { getController } = await import('./config.js');
  const ctrl = await getController();
  const idx = ctrl.uploadIndex || 1;
  const proj = (ctrl.projects || {})[String(idx)];

  if (!proj || !proj.url || !proj.anonKey || proj.anonKey === 'anonkey') {
    throw new Error('Project #' + idx + ' not configured');
  }

  const safeName = file.name.replace(/[^\w.\-]/g, '_').replace(/_+/g, '_');
  const path = `${folder}/${state.me.uid}/${Date.now()}_${safeName}`;
  const bucket = proj.bucket || ctrl.defaultBucket || 'videos';
  const uploadUrl = `${proj.url}/storage/v1/object/${bucket}/${path}`;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', uploadUrl);
    xhr.setRequestHeader('Authorization', `Bearer ${proj.anonKey}`);
    xhr.setRequestHeader('x-upsert', 'true');
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');

    xhr.upload.onprogress = e => {
      if (e.lengthComputable && onProgress) onProgress((e.loaded / e.total) * 100);
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          const { createClient } = window._supabaseCreateClient || {};
          // Public URL qurish
          const publicUrl = `${proj.url}/storage/v1/object/public/${bucket}/${data.Key || path}`;
          if (onProgress) onProgress(100);
          resolve({ path, url: publicUrl, storageIndex: idx });
        } catch(e) {
          // Fallback: uploadViaController ishlaydi
          import('./config.js').then(({ uploadViaController }) =>
            uploadViaController(file, folder).then(resolve).catch(reject)
          );
        }
      } else {
        // Fallback to normal upload
        import('./config.js').then(({ uploadViaController }) =>
          uploadViaController(file, folder).then(res => { if(onProgress) onProgress(100); resolve(res); }).catch(reject)
        );
      }
    };
    xhr.onerror = () => {
      // Fallback
      import('./config.js').then(({ uploadViaController }) =>
        uploadViaController(file, folder).then(res => { if(onProgress) onProgress(100); resolve(res); }).catch(reject)
      );
    };
    xhr.send(file);
  });
}

/* ── Wire static DOM (modal already exists in index.html on page load) ── */
$('chatThreadBack').onclick = closeChatThread;
$('chatThreadModal').addEventListener('click', e => {
  if (e.target === $('chatThreadModal')) closeChatThread();
});

// Groups DOM injection + "+" button
injectGroupsDOM();
state.currentChatKind = state.currentChatKind || 'dm';

const _chatsAddBtn = $('chatsAddBtn');
if (_chatsAddBtn) _chatsAddBtn.addEventListener('click', openCreateChoice);

// Input text changes — toggle mic/send icon
$('chatThreadInput').addEventListener('input', updateVoiceSendBtn);
$('chatThreadInput').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendAction(); }
});
$('chatVoiceBtn').onclick = () => {
  const hasText = $('chatThreadInput').value.trim().length > 0;
  const hasFile = !!_chatSelFile;
  if (hasText || hasFile) {
    handleSendAction();
  } else {
    // Toggle recording
    if (_mediaRec && _mediaRec.state === 'recording') {
      stopRecording();
    } else {
      startRecording();
    }
  }
};

// Bekor qilish recording
$('cviCancel').onclick = cancelRecording;

// File attach
$('chatAttachBtn').onclick = () => $('chatFileInput').click();
$('chatFileInput').onchange = e => {
  const f = e.target.files?.[0];
  if (f) setChatFile(f);
};
$('cfpRemove').onclick = clearChatFile;

async function handleSendAction() {
  if (_chatSelFile) {
    await sendChatFile();
    // If there's also text, send it after
    const text = $('chatThreadInput').value.trim();
    if (text) await sendChatMessage();
  } else {
    await sendChatMessage();
  }
}

/* ── destroyChatsView: chat viewdan chiqqanda cleanup ─────────────────── */
export function destroyChatsView() {
  // Thread listener'ni to'xtatish
  if (_threadUnsub) { _threadUnsub(); _threadUnsub = null; }
  // Thread modal'ni yopish
  try { closeChatThread(); } catch (_) {}
  // chatsWatcher'ni to'xtatmaymiz — u background notification uchun kerak
  // (auth.js stopChatsWatcher logout paytida chaqiradi)
}

/* ── Chat thread header: avi/nom bosilganda profil ochish ────────────── */
// DM uchun: user profil modali
// Guruh/Kanal uchun: guruh info overlay
(function() {
  const aviEl  = document.getElementById('chatThreadAvi');
  const nameEl = document.getElementById('chatThreadName');

  async function openCurrentProfile() {
    const kind = state.currentChatKind || 'dm';
    if (kind === 'dm') {
      const uid = state.currentChatUid;
      if (!uid) return;
      const { openUserProfileModal } = await import('./profile.js');
      openUserProfileModal(uid);
    } else {
      // guruh yoki kanal — group info overlay
      const { openGroupInfo } = await import('./groups.js');
      if (state.currentChatId || window._currentGroupId) {
        // currentGroupId groups.js ichida — openGroupThread da o'rnatiladi
        const gid = document.getElementById('chatThreadModal')?.dataset?.gid
          || window._currentGroupId;
        if (gid) openGroupInfo(gid);
      }
    }
  }

  if (aviEl)  aviEl.style.cursor  = 'pointer';
  if (nameEl) nameEl.style.cursor = 'pointer';
  if (aviEl)  aviEl.addEventListener('click',  openCurrentProfile);
  if (nameEl) nameEl.addEventListener('click', openCurrentProfile);
})();

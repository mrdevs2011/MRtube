/* ── Onlayn holat (presence) uchun CSS ────────────────────────────────── */
function _injectPresenceCSS() {
  if (document.getElementById('chat-presence-css')) return;
  const s = document.createElement('style');
  s.id = 'chat-presence-css';
  s.textContent = `
.chat-avi { position: relative; }
.presence-dot {
  position: absolute;
  right: -1px; bottom: -1px;
  width: 11px; height: 11px;
  background: #3ecf8e;
  border: 2px solid var(--bg1, #17181c);
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(0,0,0,0.15);
}
#chatTypingStatus {
  font-size: 12.5px;
  color: var(--text3, #6b7280);
  margin-top: 1px;
}
#chatTypingStatus.online { color: #3ecf8e; font-weight: 500; }
`;
  document.head.appendChild(s);
}

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
  background: var(--bg2,#1e1e2e);
  background-size: 400px 100%;
  animation: skelShimmer 1.3s infinite linear;
}
.skel-body { flex: 1; display: flex; flex-direction: column; gap: 7px; }
.skel-name, .skel-preview {
  height: 11px; border-radius: 7px;
  background: var(--bg2,#1e1e2e);
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
      <div class="ulist-search-icon" id="chatSearchBtn" title="Havola bo'yicha qidirish">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="7"/><line x1="17" y1="17" x2="22" y2="22"/>
        </svg>
      </div>
      <input class="ulist-search-input" id="chatSearchInput" placeholder="Havola kiriting (username yoki link)..." autocomplete="off" spellcheck="false">
    </div>

    <div class="ulist-search-result d-none" id="chatSearchResult"></div>
  `;
  container.insertBefore(wrap, container.firstChild);

  const inp = document.getElementById('chatSearchInput');
  const btn = document.getElementById('chatSearchBtn');
  const res = document.getElementById('chatSearchResult');

  /* ── Havola bo'yicha qidirish ───────────────────────────────────────
     Xavfsizlik/maxfiylik uchun: yozayotganda (har harfda) HECH QANDAY
     natija ko'rsatilmaydi va fullName/username bo'yicha qisman (substring)
     moslik izlanmaydi. Faqat Enter bosilganda (yoki qidiruv belgisi
     bosilganda) qidiruv boshlanadi va faqat:
       1) to'liq mos username ("@username" yoki "username"), yoki
       2) to'liq mos guruh/kanal havolasi (maxfiy yoki ochiq)
     bo'yicha ANIQ (exact) moslik izlanadi. Muvaffaqiyatli holatda
     har doim faqat 1 ta natija chiqadi; aks holda "topilmadi" deyiladi. */
  function doSearch() {
    const raw = inp.value.trim();
    if (!raw) {
      _searchQuery = '';
      res.classList.add('d-none');
      const contacts = (_usersCache || []).filter(u => _myContacts.has(u.uid));
      _paintUserRows(contacts);
      return;
    }
    _searchQuery = raw;
    _paintSearchSkeleton();
    res.textContent = 'Qidirilmoqda...';
    res.className = 'ulist-search-result';
    res.classList.remove('d-none');
    setTimeout(async () => {
      // Qidiruv paytida input o'zgargan bo'lsa (masalan foydalanuvchi
      // qayta yozgan) — eskirgan natijani chizmaymiz
      if (inp.value.trim() !== raw) return;

      const uname = raw.startsWith('@') ? raw.slice(1) : raw;
      const foundUser = (_usersCache || []).find(u => (u.username || '').toLowerCase() === uname.toLowerCase());
      if (foundUser) {
        res.textContent = 'Natija topildi';
        res.className = 'ulist-search-result';
        res.classList.remove('d-none');
        _paintUserRows([foundUser], true /* animate */);
        return;
      }

      // Username bo'yicha topilmasa — guruh/kanal havolasi (maxfiy yoki
      // ochiq) sifatida ANIQ moslik tekshiramiz
      const linkRes = await joinGroupByCode(raw);
      if (linkRes.ok) {
        res.classList.add('d-none');
        return;
      }
      res.textContent = `"${raw}" — topilmadi`;
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
    const online = isOnline(u.lastSeenAt);
    const preview = c
      ? `${c.lastSenderId === state.me.uid ? 'You: ' : ''}${esc((c.lastMessage || '').slice(0, 46))}`
      : isContact ? 'Kontakt' : 'Yangi suhbat boshlash';
    const time   = c?.lastMessageAt ? fmt(c.lastMessageAt) : '';
    const unread = c?.unreadCount?.[state.me.uid] || 0;
    const badgeTxt = unread > 99 ? '+99' : '+' + unread;
    const animStyle = animate ? `style="animation: chatRowSlideIn .32s cubic-bezier(.22,.68,0,1.2) ${idx*0.06}s both"` : '';
    return `<div class="chat-row${unread ? ' unread' : ''}${animate ? ' chat-row-anim' : ''}" data-uid="${u.uid}" ${animStyle}>
      <div class="chat-avi">
        <img src="${av}" onerror="this.style.display='none'">
        ${online ? '<span class="presence-dot" title="onlayn"></span>' : ''}
      </div>
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
  _injectPresenceCSS();
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
import { db, state, uploadViaController, isAdmin, auth, transcribeAudio, synthesizeSpeech, getAiVoiceGender } from './config.js';
import { playVoiceMessageWithEffects, buildVoiceMessageBothGenders, injectNaturalMarkers, stripEffectMarkers, stripMarkdownForSpeech } from './voice-fx-player.js';
import { $, esc, renderMarkdown, defAvi, fmt, fmtTime, fmtSz, isOnline, formatLastSeen } from './utils.js';
import { toast }            from './toast.js';
import {
  startGroupsWatcher, stopGroupsWatcher,
  openGroupThread, closeGroupThread,
  sendGroupMessage, sendGroupFile,
  injectGroupsDOM, openCreateChoice, getGroupRows,
  getCurrentGroupId, joinGroupByCode
} from './groups.js';
import {
  collection, query, where, orderBy, limit,
  doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
  onSnapshot, serverTimestamp, writeBatch, increment, arrayUnion
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import {
  cacheChatsList, getCachedChatsList, getCachedChatsListAgeMs,
  cacheThreadMessages, getCachedThreadMessages, invalidateChatsListCache
} from './local-cache.js';
import {
  MRGRAM_AI_UID, MRGRAM_AI_NAME, MRGRAM_AI_AVATAR, MRGRAM_AI_TAGLINE,
  getMrgramAiReply, getMrgramAiReplyStream
} from './mrgram-ai.js';

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
let _presenceRepaintTick = null; // onlayn nuqtalarni vaqt bo'yicha yangilab turadi
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

/** Admin userni o'chirgan/bloklaganda chaqiriladi — hotira ichidagi va
 * localStorage'dagi kontaktlar (suhbat boshlash) keshini bekor qilib,
 * ro'yxatni Firestore'dan qayta yuklaydi (5 daqiqa kutilmaydi). */
export async function invalidateChatsUsersCache() {
  if (state.me?.uid) invalidateChatsListCache(state.me.uid);
  _usersCache = null;
  if (!state.me) return;
  try {
    const usersSnap = await getDocs(collection(db, 'users'));
    _usersCache = usersSnap.docs
      .map(d => ({ uid: d.id, ...d.data() }))
      .filter(u => u.uid !== state.me.uid && u.approved === true && u.blocked !== true);
    cacheChatsList(state.me.uid, _usersCache, _latestChatMap);
  } catch (err) {
    console.warn('[Chat] invalidateChatsUsersCache fetch failed:', err.message);
  }
  if (state.view === 'chats') paintChatsList(_usersCache || [], _latestChatMap);
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
      _noticeUnsub = onSnapshot(doc(db, 'ADMIN', '_index', 'adminNotice', 'global'), snap => {
        _latestNotice = snap.exists() ? snap.data() : null;
        if (state.view === 'chats') _repaintNoticeBanner();
      }, () => {});
    }

    _chatsUnsub = onSnapshot(
      query(collection(db, 'chats', '_index', '1v1chat'), where('participants', 'array-contains', state.me.uid)),
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

    // Onlayn nuqtalar vaqt o'tishi bilan (masalan user oflayn bo'lib qolganda)
    // o'zi so'nishi uchun — yangi ma'lumot kelmasa ham ro'yxatni davriy
    // qayta chizamiz (isOnline() joriy vaqtga qarab hisoblanadi).
    if (!_presenceRepaintTick) {
      _presenceRepaintTick = setInterval(() => {
        if (state.view === 'chats') paintChatsList(_usersCache || [], _latestChatMap);
      }, 30000);
    }
  })();

  return _watcherPromise;
}

export function stopChatsWatcher() {
  stopGroupsWatcher();
  if (_chatsUnsub) { _chatsUnsub(); _chatsUnsub = null; }
  if (_noticeUnsub) { _noticeUnsub(); _noticeUnsub = null; }
  if (_contactsUnsub) { _contactsUnsub(); _contactsUnsub = null; }
  if (_presenceRepaintTick) { clearInterval(_presenceRepaintTick); _presenceRepaintTick = null; }
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
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
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

/* ── "MRgram AI" — hamma uchun doim mahkamlangan (pinned) bot-chat ───────
 * Suhbatlar ro'yxatida HAR DOIM eng tepada ko'rinadi (kontaktlar ro'yxatidan
 * qat'i nazar) — chunki bu haqiqiy foydalanuvchi emas, balki platformaning
 * o'zi taqdim etadigan doimiy AI yordamchi. Xabar preview/vaqt/unread
 * badge oddiy suhbatlar bilan bir xil `chats/{chatId}` hujjatidan olinadi
 * (chatId = chatIdFor(myUid, MRGRAM_AI_UID) — boshqa hech narsa qilish
 * shart emas, mavjud real-vaqtli `_latestChatMap` mexanizmi ishlayveradi).
 ─────────────────────────────────────────────────────────────────────────*/
function _renderAiPinnedRow() {
  const rowsWrap = document.getElementById('chatRowsWrap');
  if (!rowsWrap || !state.me) return;

  // Qidiruv faol bo'lsa — faqat "AI"/"MRgram" so'ziga mos kelganda ko'rsatamiz
  if (_searchQuery) {
    const lq = _searchQuery.toLowerCase();
    if (!MRGRAM_AI_NAME.toLowerCase().includes(lq) && !'mrgram ai bot yordamchi'.includes(lq)) return;
  }

  const c = _latestChatMap[MRGRAM_AI_UID] || null;
  const preview = c
    ? `${c.lastSenderId === state.me.uid ? 'Siz: ' : ''}${esc((c.lastMessage || '').slice(0, 46))}`
    : 'Savolingiz bormi? Yozing — javob beraman ✨';
  const time     = c?.lastMessageAt ? fmt(c.lastMessageAt) : '';
  const unread   = c?.unreadCount?.[state.me.uid] || 0;
  const badgeTxt = unread > 99 ? '+99' : '+' + unread;

  const html = `<div class="chat-row ai-pinned-row${unread ? ' unread' : ''}" data-uid="${MRGRAM_AI_UID}">
    <div class="chat-avi">
      <img src="${MRGRAM_AI_AVATAR}" onerror="this.style.display='none'">
      <span class="presence-dot" title="doim onlayn"></span>
    </div>
    <div class="chat-row-body">
      <div class="chat-row-name">${esc(MRGRAM_AI_NAME)}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="#5288c1" style="vertical-align:-2px;margin-left:2px" title="Rasmiy AI yordamchi"><path d="M12 2l2.4 4.86 5.37.78-3.89 3.79.92 5.35L12 14.27l-4.8 2.51.92-5.35L4.23 7.64l5.37-.78L12 2z"/></svg>
      </div>
      <div class="chat-row-preview${c ? '' : ' chat-row-empty'}">${preview}</div>
    </div>
    <div class="chat-row-right">
      ${time ? `<div class="chat-row-time">${time}</div>` : ''}
      ${unread ? `<div class="chat-row-badge">${badgeTxt}</div>` : ''}
    </div>
  </div>`;

  rowsWrap.insertAdjacentHTML('afterbegin', html);
  rowsWrap.querySelector('.ai-pinned-row')?.addEventListener('click', () => openChatThread(MRGRAM_AI_UID));
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
    // Qidiruv faol — faqat ANIQ mos username natijasini ko'rsatamiz
    // (substring/fullName bo'yicha qidirish YO'Q — maxfiylik uchun)
    const uname = q.startsWith('@') ? q.slice(1) : q;
    const exact = users.find(u => (u.username || '').toLowerCase() === uname.toLowerCase());
    filtered = exact ? [exact] : [];
  } else if (admin) {
    // Admin uchun: qidiruv bo'sh bo'lsa to'liq ro'yxat ko'rinadi
    filtered = users;
  } else {
    // Oddiy user uchun: qidiruv bo'sh bo'lsa faqat kontaktlar ko'rinadi
    // (eski chat tarixi hisobga olinmaydi — hammada 0dan boshlanadi)
    filtered = users.filter(u => _myContacts.has(u.uid));
  }
  _paintUserRows(filtered);
  _renderAiPinnedRow();
  _repaintNoticeBanner();
  _appendGroupRows(root);
}

/* ── Other user avatar cache for DM messages ─────────────────────────── */
let _otherUserAvi = '';
let _otherUserUid = '';

/* ── Peer onlayn holati (chat thread sarlavhasi uchun) ────────────────── */
let _peerUserUnsub = null;
let _peerStatusTick = null;
let _peerLastSeenAt = null;
let _chatDocUnsub = null;
let _peerTyping = false;
let _iAmTyping = false;
let _typingTimeout = null;

function _paintPeerStatus(lastSeenAt) {
  _peerLastSeenAt = lastSeenAt;
  const el = $('chatTypingStatus');
  if (!el) return;
  if (_peerTyping) {
    el.textContent = 'yozmoqda...';
    el.classList.add('online');
    return;
  }
  const online = isOnline(lastSeenAt);
  el.textContent = formatLastSeen(lastSeenAt);
  el.classList.toggle('online', online);
}

/* ── "Yozmoqda..." holatini Firestore'ga yozish (debounce bilan) ─────────
 * chats/{chatId}.typing.{myUid} = true/false. Rules'da bu maydon
 * onlyFields ro'yxatida allaqachon ruxsat berilgan — qo'shimcha
 * o'zgarish kerak emas.
 ─────────────────────────────────────────────────────────────────────── */
function _setTyping(isTyping) {
  if (!state.currentChatId || !state.me) return;
  if (_iAmTyping === isTyping) return; // ortiqcha yozuvlarni oldini olish
  _iAmTyping = isTyping;
  updateDoc(doc(db, 'chats', '_index', '1v1chat', state.currentChatId), {
    [`typing.${state.me.uid}`]: isTyping
  }).catch(() => {});
}

function _onChatInputTyping() {
  // Faqat 1v1 (DM) chatda ishlaydi — guruh/kanalda alohida mantiq kerak
  if (state.currentChatKind && state.currentChatKind !== 'dm') return;
  _setTyping(true);
  clearTimeout(_typingTimeout);
  _typingTimeout = setTimeout(() => _setTyping(false), 2500);
}

/* ── Open chat thread ─────────────────────────────────────────────────── */
export async function openChatThread(uid) {
  if (!uid || !state.me || uid === state.me.uid) return;

  _injectPresenceCSS();
  $('chatThreadModal').classList.add('show');
  $('chatThreadName').textContent   = '...';
  $('chatThreadAvi').innerHTML      = '';
  $('chatThreadInput').value        = '';

  state.currentChatUid = uid;
  const chatId = chatIdFor(state.me.uid, uid);
  state.currentChatId = chatId;
  // Boshqa chatga o'tilganda ID-kuzatuvchini tozalaymiz — aks holda Set
  // cheksiz o'sib ketishi mumkin va yangi chatning birinchi ochilishida
  // xabarlar tabiiy tarzda "pop-in" bo'lishi kerak.
  if (_seenMsgIdsChatId !== chatId) {
    _seenMsgIds = new Set();
    _seenMsgIdsChatId = chatId;
  }
  // Agar hozir ijro etilayotgan ovozli xabar aynan shu chatga tegishli
  // bo'lsa — mini-pleer bar endi kerak emas (xabar o'zi thread ichida
  // ko'rinadi), aks holda bar davom etib turadi.
  try { _syncMiniPlayer(); } catch (_) {}

  // Tarmoqni kutmasdan — keshdagi so'nggi xabarlarni darhol ko'rsatamiz
  const _cachedMsgs = getCachedThreadMessages(chatId);
  if (_cachedMsgs && _cachedMsgs.length) {
    paintMessages(_cachedMsgs);
  } else {
    $('chatThreadMessages').innerHTML = `<div class="spin-wrap pt-60px"><div class="spinner"></div></div>`;
  }
  // Reset voice/file state (functions defined below, safe after page load)
  try { cancelRecording(); } catch(_) {}
  $('chatVoiceBtn')?.classList.remove('active');
  _chatSelFile = null;
  $('chatFilePreview')?.classList.remove('active');
  $('chatFileInput') && ($('chatFileInput').value = '');
  try { updateVoiceSendBtn(); } catch(_) {}

  // "MRgram AI" haqiqiy `users/{uid}` hujjatiga ega emas (u foydalanuvchi
  // emas, platformaning o'zi taqdim etadigan doimiy bot) — shuning uchun
  // profil ma'lumotlarini Firestore'dan o'qishga urinmasdan, statik/qattiq
  // belgilangan qiymatlarni ko'rsatamiz va onlayn/typing kuzatuvchilarini
  // (ular uchun ham users hujjati kerak bo'lardi) butunlay o'tkazib yuboramiz.
  if (uid === MRGRAM_AI_UID) {
    $('chatThreadName').textContent = MRGRAM_AI_NAME;
    $('chatThreadAvi').innerHTML = `<img src="${MRGRAM_AI_AVATAR}" onerror="this.style.display='none'">`;
    _otherUserAvi = MRGRAM_AI_AVATAR;
    _otherUserUid = uid;
    const statusEl = $('chatTypingStatus');
    if (statusEl) {
      statusEl.textContent = MRGRAM_AI_TAGLINE;
      statusEl.classList.remove('online');
    }
    if (_peerUserUnsub)  { _peerUserUnsub();  _peerUserUnsub  = null; }
    if (_peerStatusTick) { clearInterval(_peerStatusTick); _peerStatusTick = null; }
    if (_chatDocUnsub)   { _chatDocUnsub();   _chatDocUnsub   = null; }
    // AI bilan qo'ng'iroq funksiyasi olib tashlandi — endi u bilan faqat
    // ovozli xabar (voice message) orqali "tabiiy" gaplashiladi, shu sabab
    // ikkala qo'ng'iroq tugmasi ham (ovozli va video) AI suhbatida yashirin.
    const videoBtn = $('chatVideoCallBtn');
    if (videoBtn) videoBtn.style.display = 'none';
    const voiceCallBtn = $('chatVoiceCallBtn');
    if (voiceCallBtn) voiceCallBtn.style.display = 'none';
  } else {
    const videoBtn = $('chatVideoCallBtn');
    if (videoBtn) videoBtn.style.display = '';
    const voiceCallBtn = $('chatVoiceCallBtn');
    if (voiceCallBtn) voiceCallBtn.style.display = '';
    try {
      const uSnap = await getDoc(doc(db, 'users', uid));
      const ud = uSnap.data() || {};
      const av = ud.avatar || defAvi(ud.fullName || 'U');
      $('chatThreadName').textContent = ud.fullName || 'Foydalanuvchi';
      $('chatThreadAvi').innerHTML = `<img src="${av}" onerror="this.style.display='none'">`;
      _paintPeerStatus(ud.lastSeenAt);
      // Cache for message avatars
      _otherUserAvi = av;
      _otherUserUid = uid;
    } catch (err) {
      console.warn('[Chat] Failed to load user info:', err.message);
      _otherUserAvi = defAvi('U');
      _otherUserUid = uid;
    }

    // Onlayn holatni real vaqtda kuzatib turish — peer user hujjatidagi
    // `lastSeenAt` heartbeat orqali yangilanganda darhol sarlavhada ko'rinsin.
    if (_peerUserUnsub) { _peerUserUnsub(); _peerUserUnsub = null; }
    _peerUserUnsub = onSnapshot(doc(db, 'users', uid), snap => {
      _paintPeerStatus(snap.data()?.lastSeenAt);
    }, () => {});
    // "Onlayn"dan "N daqiqa oldin"ga o'tishini ko'rsatish uchun har 20s da
    // matnni qayta hisoblaymiz (server yozuvi o'zgarmasa ham vaqt o'tadi).
    if (_peerStatusTick) clearInterval(_peerStatusTick);
    _peerStatusTick = setInterval(() => _paintPeerStatus(_peerLastSeenAt), 20000);

    // "Yozmoqda..." holatini kuzatish — chats/{chatId}.typing.{peerUid}
    _peerTyping = false;
    if (_chatDocUnsub) { _chatDocUnsub(); _chatDocUnsub = null; }
    _chatDocUnsub = onSnapshot(doc(db, 'chats', '_index', '1v1chat', chatId), snap => {
      _peerTyping = !!(snap.data()?.typing?.[uid]);
      _paintPeerStatus(_peerLastSeenAt);
    }, () => {});
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
    await setDoc(doc(db, 'chats', '_index', '1v1chat', chatId), {
      participants: [state.me.uid, uid].sort(),
      unreadCount:  { [state.me.uid]: 0 }
    }, { merge: true });
  } catch (err) {
    console.warn('[Chat] Failed to init chat doc:', err.message);
  }

  // Kontaktlarni saqlash — xato bo'lsa chat ochilishga ta'sir qilmaydi.
  // "MRgram AI" haqiqiy foydalanuvchi emas (users/{uid} hujjati yo'q),
  // shuning uchun uni kontaktlar ro'yxatiga yozishning hojati yo'q — u
  // baribir har doim pinned holda alohida ko'rsatiladi.
  if (uid !== MRGRAM_AI_UID) {
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
  }

  if (_threadUnsub) { _threadUnsub(); _threadUnsub = null; }

  _threadUnsub = onSnapshot(
    query(collection(db, 'chats', '_index', '1v1chat', chatId, 'messages'), orderBy('createdAt', 'desc'), limit(MSG_LIMIT)),
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
      batch.update(doc(db, 'chats', '_index', '1v1chat', chatId, 'messages', m.id), {
        status: 'read',
        readAt: serverTimestamp()
      });
    });
    // unreadCount ni nolga tushiramiz (o'zimizniki)
    batch.update(doc(db, 'chats', '_index', '1v1chat', chatId), {
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

/* ── "MRgram AI" foydalanuvchi xabarini "o'qidi" (2 ptichka) qilib
 * belgilash ────────────────────────────────────────────────────────────
 * Chaqirilish o'rni MUHIM: bu FAQAT Groq'ga so'rov MUVAFFAQIYATLI (success)
 * yetib borgandan keyin (ya'ni getMrgramAiReply*() xatosiz qaytgach)
 * chaqiriladi — shu bilan foydalanuvchi "AI so'rovimni haqiqatan qabul
 * qilib, javob tayyorladi" degan aniq signalni 2 ko'k ptichka orqali
 * ko'radi (oddiy foydalanuvchilar orasidagi "o'qildi" belgisi kabi).
 * Agar Groq so'rovi xato bersa — bu funksiya chaqirilmaydi va xabar
 * 1 ptichkada (sent) qolib qoladi.
 */
async function _markUserMsgSeenByAi(chatId, userMsgId) {
  if (!chatId || !userMsgId) return;
  try {
    await updateDoc(doc(db, 'chats', '_index', '1v1chat', chatId, 'messages', userMsgId), {
      status: 'read',
      readAt: serverTimestamp()
    });
  } catch (err) {
    // Jim — bu faqat vizual ptichka holati, asosiy AI javob oqimini to'xtatmaydi
    console.warn('[MRgram AI] foydalanuvchi xabarini "read" qilishda xato:', err?.message || err);
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

/* ── "MRgram AI" matnli javobi uchun fon rejimida tayyorlanayotgan ovozli
 * xabar (mini-pleer) holatini kuzatish ─────────────────────────────────
 * paintMessages() faqat Firestore'dagi msgs massividan chiziladi, lekin
 * audio hali Firestore'ga yozilmagan (hali tayyorlanmoqda) bosqichda ham
 * foydalanuvchiga BIR NARSA sodir bo'layotganini ko'rsatish kerak — aks
 * holda uzun javoblarda (bir necha TTS bo'lagi ketma-ket kutilganda)
 * matn ko'rinadi-yu, undan keyin hech narsa o'zgarmagandek tuyuladi va
 * foydalanuvchi "ovoz umuman kelmayapti" deb o'ylaydi, holbuki u orqa
 * fonda hali tayyorlanayotgan bo'ladi. Shu sabab shu xabar ID'lari
 * to'plamda saqlanadi va paintMessages shu ID'lar uchun kichik
 * "ovoz tayyorlanmoqda…" indikatorini chizadi — audio tayyor bo'lib
 * Firestore'ga yozilgach yoki xato chiqib bekor qilingach, ID to'plamdan
 * olib tashlanadi va thread darhol qayta chiziladi. */
const _pendingAiVoiceMsgIds = new Set();
// msgId -> hozirgi HAQIQIY % (0-100). Har safar % o'zgarganda BUTUN
// threadni qayta chizish (paintMessages) shart emas — bu keraksiz DOM
// qayta yaratish va "yonib-o'chish" tuyg'usiga olib kelardi (chunki %
// bir necha marta, tez-tez yangilanadi). Shu sabab progress uchun faqat
// mos DOM elementining textContent'i to'g'ridan-to'g'ri yangilanadi
// (pastdagi _updateAiVoiceProgressDom), full repaint esa faqat
// indikator birinchi paydo bo'lganda/yo'qolganda ishlatiladi.
const _pendingAiVoicePercent = new Map();

function _repaintThreadIfOpen(chatId) {
  if (state.currentChatId !== chatId) return;
  const cached = getCachedThreadMessages(chatId);
  if (cached) paintMessages(cached);
}

function _markAiVoicePending(chatId, msgId) {
  if (!msgId) return;
  _pendingAiVoiceMsgIds.add(msgId);
  _pendingAiVoicePercent.set(msgId, 0);
  _repaintThreadIfOpen(chatId);
}

/** Fon rejimida tayyorlanayotgan ovozli xabarning HAQIQIY % progressini
 * yangilaydi. Full repaint qilmaydi — faqat shu xabarning DOM'dagi
 * "ovoz tayyorlanmoqda… N%" yorlig'ini to'g'ridan-to'g'ri yangilaydi,
 * shunda progress tez-tez o'zgarsa ham thread "yonib-o'chib" turmaydi. */
function _updateAiVoiceProgress(chatId, msgId, percent) {
  if (!msgId || state.currentChatId !== chatId) return;
  const pct = Math.max(0, Math.min(100, Math.round(percent || 0)));
  _pendingAiVoicePercent.set(msgId, pct);
  const label = document.querySelector(`.chat-msg[data-msg-id="${CSS.escape(String(msgId))}"] .cvp-label`);
  if (label) label.textContent = `ovoz tayyorlanmoqda… ${pct}%`;
}

function _clearAiVoicePending(chatId, msgId) {
  if (!msgId) return;
  _pendingAiVoicePercent.delete(msgId);
  if (_pendingAiVoiceMsgIds.delete(msgId)) _repaintThreadIfOpen(chatId);
}

/* ── "MRgram AI" — Sardor (erkak) / Madina (ayol) ikkala ovozi ───────────
 * Har bir AI ovozli javob uchun IKKALA ovoz ham (fon rejimida, ketma-ket)
 * tayyorlanib, xabar hujjatiga "...Male"/"...Female" qo'shimchali alohida
 * maydonlar sifatida yoziladi (asosiy `mediaUrl`/`audioUrl` va h.k. esa
 * xabar YARATILGAN paytda tanlangan ovozni ko'rsatib, eski kod bilan ham
 * moslashuvchan qoladi). Sozlamalarda ovoz almashtirilganda — HATTO
 * tarixdagi xabarlar ham shu tanlangan ovozga "o'tib qoladi", chunki
 * quyidagi tanlagich funksiyalar har safar paintMessages chaqirilganda
 * joriy getAiVoiceGender() qiymatiga qarab mos maydonni tanlaydi. */
const _CAP = { male: 'Male', female: 'Female' };

/** `type:'voice'` AI xabari uchun — joriy tanlangan ovoz jinsiga mos
 * media URL/davomiylikni tanlaydi. Agar shu jins uchun ovoz hali (fon
 * rejimida) tayyorlanmagan bo'lsa yoki xabar shu funksiya qo'shilishidan
 * OLDIN yaratilgan bo'lsa — xabar yaratilgan paytdagi asosiy `mediaUrl`ga
 * qaytiladi (foydalanuvchi hech qachon butunlay ovozsiz qolmaydi). */
function _pickVoiceMsgMedia(m) {
  const gender = getAiVoiceGender();
  const url = m[`mediaUrl${_CAP[gender]}`];
  if (url) return { url, duration: m[`duration${_CAP[gender]}`] || m.duration || 0 };
  return { url: m.mediaUrl || '', duration: m.duration || 0 };
}

/** Xuddi yuqoridagidek, lekin oddiy matn xabari ostidagi kichik AI
 * ovoz-pleeri (`audioUrl` maydoni) uchun. */
function _pickAiTextVoiceMedia(m) {
  const gender = getAiVoiceGender();
  const url = m[`audioUrl${_CAP[gender]}`];
  if (url) return { url, duration: m[`audioDuration${_CAP[gender]}`] || m.audioDuration || 0 };
  return { url: m.audioUrl || '', duration: m.audioDuration || 0 };
}

/** Sozlamalarda ovoz (Sardor/Madina) almashtirilganda auth.js shu
 * funksiyani chaqiradi — hozir ochiq turgan suhbat (agar shu "MRgram AI"
 * chati bo'lsa) keshdagi xabarlar asosida DARHOL qayta chiziladi, shu
 * bilan HATTO oldingi (tarixdagi) ovozli xabarlar ham yangi tanlangan
 * ovozga zudlik bilan "o'tib qoladi" — hech qanday qayta yuklash yoki
 * qayta so'rov shart emas, chunki audio allaqachon fon rejimida ikkala
 * jins uchun ham tayyorlab qo'yilgan (yoki hali tayyorlanmoqda). */
export function repaintForVoiceGenderChange() {
  if (!state.currentChatId) return;
  const cached = getCachedThreadMessages(state.currentChatId);
  if (cached && cached.length) paintMessages(cached);
}

/** Yasalgan (blob) ovozli xabar audiosini Storage'ga yuklaydi va
 * xabar hujjatiga yozsa bo'ladigan shaklda qaytaradi. `built` — odatda
 * `buildVoiceMessageAudioBlob()`/`buildVoiceMessageBothGenders()`
 * natijasi ({blob, duration, ext, mimeType}). Xato bo'lsa yoki `built`
 * bo'sh bo'lsa — `null`. */
async function _uploadBuiltVoiceBlob(built) {
  if (!built || !built.blob) return null;
  try {
    const ext = built.ext || 'wav';
    const mimeType = built.mimeType || 'audio/wav';
    const file = new File([built.blob], `ai_voice_${Date.now()}.${ext}`, { type: mimeType });
    const result = await uploadViaController(file, 'chat-ai-voice');
    return { url: result.url, path: result.path, storageIndex: result.storageIndex, duration: built.duration || 0 };
  } catch (err) {
    console.warn('[voice-fx] muqobil ovoz yuklashda xato:', err?.message || err);
    return null;
  }
}

/** Fon rejimida tayyorlangan MUQOBIL (ikkinchi) ovozni Storage'ga yuklab,
 * berilgan xabar hujjatiga qo'shimcha maydon sifatida yozib qo'yadi va
 * (agar shu suhbat ochiq bo'lsa) threadni qayta chizadi. `fields` — shu
 * xabar turiga mos maydon nomlari ({urlField, pathField, durField}).
 * `built` bo'sh (`null`) bo'lsa — jimgina hech narsa qilmaydi (muqobil
 * ovoz — ixtiyoriy yaxshilanish, asosiy xabar baribir saqlangan). */
function _attachSecondaryVoice(msgRef, chatId, built, fields) {
  (async () => {
    const secAudio = built ? await _uploadBuiltVoiceBlob(built) : null;
    if (!secAudio) return;
    try {
      const update = {
        [fields.urlField]: secAudio.url,
        [fields.pathField]: secAudio.path,
        [fields.durField]: secAudio.duration || 0,
      };
      if (fields.storageField) update[fields.storageField] = secAudio.storageIndex;
      await updateDoc(msgRef, update);
      _repaintThreadIfOpen(chatId);
    } catch (err) {
      console.warn('[voice-fx] muqobil ovozni saqlashda xato:', err?.message || err);
    }
  })();
}

/* ── Voice waveform bars ──────────────────────────────────────────────
 * Boshlanishida — tekis (flat) past bar'lar (real ma'lumot hali yo'q).
 * Audio fayl fonda decode qilingach, har bir bar shu segmentdagi
 * HAQIQIY ovoz amplitudasiga (RMS) qarab balandligini oladi —
 * `_hydrateVoiceWaveforms()` orqali. Shu tufayli baland ovoz — baland
 * bar, past/jim joy — past bar bo'ladi (sun'iy sinus emas). */
const CVM_MIN_BARS  = 50;  // eng qisqa xabar uchun bar soni
const CVM_MAX_BARS  = 80;  // eng uzun xabar uchun bar soni
const CVM_BAR_COUNT = CVM_MIN_BARS; // fallback (davomiylik noma'lum bo'lganda)
const CVM_MIN_H = 3;   // tekis bazaviy balandlik (px)
const CVM_MAX_H = 24;  // eng baland pik (px) — ingichka, zich barlar bilan muvozanatli

/* Telegram — bar sonini xabar davomiyligiga qarab dinamik hisoblaydi:
 * qisqa ovozli xabar ~50 ta ingichka bar, uzunrog'i (≈20s+) esa ~80
 * tagacha bar bilan chiziladi — natijada wave zich va aniq ko'rinadi. */
function _voiceBarCount(duration) {
  const d = Number(duration) || 0;
  if (d <= 0) return CVM_MIN_BARS;
  const count = Math.round(d * 4); // ≈4 bar/soniya
  return Math.max(CVM_MIN_BARS, Math.min(CVM_MAX_BARS, count));
}

function renderVoiceWave(seed = 0, count = CVM_BAR_COUNT) {
  let bars = '';
  for (let i = 0; i < count; i++) {
    bars += `<span class="cvm-bar" style="height:${CVM_MIN_H}px"></span>`;
  }
  return bars;
}

/* url → Promise<number[] | null> (har bir qiymat 0..1, normalizatsiya
 * qilingan RMS amplituda). Bir xil xabar ikki marta decode qilinmasin
 * deb keshlaymiz. */
const _waveformCache = new Map();

function _getWaveformData(url, count = CVM_BAR_COUNT) {
  if (!url) return Promise.resolve(null);
  const cacheKey = `${url}::${count}`;
  if (_waveformCache.has(cacheKey)) return _waveformCache.get(cacheKey);

  const promise = (async () => {
    try {
      // cache: 'no-store' — brauzer HTTP keshida (yoki avval boshqa joyda
      // <audio> orqali Range so'rov bilan olingan qisman/206 javobda)
      // qolib ketgan noto'liq baytlarni QAYTA ISHLATMASLIK uchun. Har
      // safar to'liq, yangi oqim so'raladi — shu orqali "Unable to
      // decode audio data" xatosining eng keng tarqalgan sababi
      // (keshdagi buzuq/qisman fayl) bartaraf etiladi.
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arrBuf = await res.arrayBuffer();
      if (!arrBuf || arrBuf.byteLength === 0) throw new Error('Bo\'sh audio bufer');
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC();
      const audioBuf = await ctx.decodeAudioData(arrBuf.slice(0));
      const raw = audioBuf.getChannelData(0); // 1-kanal yetarli
      const blockSize = Math.max(1, Math.floor(raw.length / count));
      const peaks = [];
      for (let i = 0; i < count; i++) {
        const start = i * blockSize;
        const end = Math.min(raw.length, start + blockSize);
        let sumSq = 0, n = 0;
        for (let j = start; j < end; j++) { sumSq += raw[j] * raw[j]; n++; }
        // RMS — segmentning haqiqiy energiya/chastota darajasi
        peaks.push(n ? Math.sqrt(sumSq / n) : 0);
      }
      try { ctx.close(); } catch (_) {}
      const max = Math.max(...peaks, 0.0001);
      return peaks.map(v => Math.min(1, v / max));
    } catch (e) {
      // e?.message || e — Error obyektining o'z xususiyatlari (message,
      // stack) enumerable emas, shuning uchun ba'zi konsollarda to'g'ridan
      // to'g'ri Error obyektini chop etsak "Error {}" (bo'sh) ko'rinadi va
      // haqiqiy sabab (masalan "Failed to fetch" — odatda CORS yoki
      // noto'g'ri/eskirgan Supabase Storage URL) yashirinib qoladi.
      console.warn('Waveform ajratib olishda xato:', e?.message || e?.name || e, '| url:', url);
      // MUHIM (flat-forever fix): agar shu (muvaffaqiyatsiz) natijani
      // keshda saqlab qo'ysak, chat ro'yxati Firestore yangilanishi bilan
      // qayta chizilganda (bu tez-tez sodir bo'ladi) HAR SAFAR shu keshdagi
      // "null"ni qaytarib, xabar ABADIY tekis (flat) ko'rinib qolardi —
      // hatto vaqtinchalik tarmoq xatosi tuzalgan bo'lsa ham. Xato holatini
      // keshdan o'chiramiz — shunda keyingi qayta chizilishda (re-render)
      // qaytadan haqiqiy urinish (retry) qilinadi.
      _waveformCache.delete(cacheKey);
      return null; // xato bo'lsa — tekis holat saqlanib qoladi
    }
  })();

  _waveformCache.set(cacheKey, promise);
  return promise;
}

/* Bir vaqtning o'zida ko'p ovozli xabar fon fonida dekod qilinsa,
 * server/tarmoqqa haddan tashqari ko'p parallel so'rov ketib, hatto
 * <audio> elementining o'zi ham yuklanishida muammo tug'dirishi mumkin
 * (masalan "no supported source" xatosi). Shu sabab — navbat orqali
 * bir vaqtda faqat 2 tasi dekod qilinadi, qolganlari navbatda kutadi. */
const CVM_MAX_CONCURRENT = 2;
let _cvmActiveDecodes = 0;
const _cvmQueue = [];

function _cvmRunQueue() {
  while (_cvmActiveDecodes < CVM_MAX_CONCURRENT && _cvmQueue.length) {
    const job = _cvmQueue.shift();
    _cvmActiveDecodes++;
    job().finally(() => {
      _cvmActiveDecodes--;
      _cvmRunQueue();
    });
  }
}

function _cvmEnqueue(job) {
  _cvmQueue.push(job);
  _cvmRunQueue();
}

/* Faqat foydalanuvchi haqiqatan ko'rayotgan (viewportga yaqin) ovozli
 * xabarlar uchun waveform yuklaymiz — chat ochilishi bilanoq o'nlab
 * xabarning to'liq audio faylini fon fonida yuklab yubormaymiz. */
let _cvmObserver = null;
function _cvmGetObserver() {
  if (_cvmObserver) return _cvmObserver;
  _cvmObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const waveEl = entry.target;
      _cvmObserver.unobserve(waveEl);
      _cvmStartHydrate(waveEl);
    });
  }, { root: null, rootMargin: '200px', threshold: 0.01 });
  return _cvmObserver;
}

function _cvmStartHydrate(waveEl) {
  const wrap = waveEl.closest('.chat-voice-msg');
  const url = wrap?.dataset.url;
  // Bar soni renderVoiceWave() chizganidagi son bilan bir xil bo'lishi kerak
  // (aks holda haqiqiy amplituda qiymatlari bar'lar bilan mos kelmay qoladi).
  const count = parseInt(wrap?.dataset.barCount, 10) || CVM_BAR_COUNT;
  if (!url || waveEl.dataset.hydrated === '1' || waveEl.dataset.hydrated === 'pending') return;
  waveEl.dataset.hydrated = 'pending';
  _cvmEnqueue(() => _getWaveformData(url, count).then(data => {
    if (!waveEl.isConnected) return;
    if (!data) { waveEl.dataset.hydrated = ''; return; }
    waveEl.dataset.hydrated = '1';
    const bars = waveEl.querySelectorAll('.cvm-bar');
    bars.forEach((b, i) => {
      const v = data[i] ?? 0;
      const h = CVM_MIN_H + v * (CVM_MAX_H - CVM_MIN_H);
      b.style.height = `${h.toFixed(1)}px`;
    });
  }));
}

/* Berilgan konteyner ichidagi hali "hydrate" qilinmagan barcha voice
 * xabarlarni kuzatuvga (IntersectionObserver) qo'shadi — har biri
 * faqat ekranga yaqinlashganda navbat orqali dekod qilinadi. */
function _hydrateVoiceWaveforms(container) {
  if (!container) return;
  const observer = _cvmGetObserver();
  const wraps = container.querySelectorAll('.chat-voice-msg[data-url]');
  wraps.forEach(wrap => {
    const waveEl = wrap.querySelector('.cvm-waveform');
    if (!waveEl || waveEl.dataset.hydrated === '1' || waveEl.dataset.hydrated === 'pending') return;
    observer.observe(waveEl);
  });
}

/* ── Xabar pufakchalari uchun "bounce" (pop-in) animatsiyasi qaysi
 * xabarlarga tegishli ekanini ANIQ, ID asosida kuzatamiz.
 *
 * ESKI USUL MUAMMOSI: oldin `idx >= prevCount` (ya'ni "avvalgi chizishda
 * nechta .chat-msg bor edi") solishtirilardi. Lekin `_showAiStreamBubble()`
 * ("...yozmoqda" pufakchasi) HAM `.chat-msg` klassiga ega va u paintMessages()
 * dan TASHQARIDA, to'g'ridan-to'g'ri box.appendChild() bilan qo'shiladi/
 * o'chiriladi. Natijada `box.querySelectorAll('.chat-msg').length` real
 * Firestore xabarlar soniga har doim mos kelmasdi (goh ortiq, goh kam) —
 * xabar yuborilganda, AI javobi kelganda va AI ovozi tayyor bo'lib
 * xabarga audioUrl qo'shilganda (bularning har biri messages'ga alohida
 * onSnapshot signalini qo'zg'atadi) `prevCount` noto'g'ri chiqib, ko'p
 * hollarda BARCHA xabarlar "yangi" deb hisoblanib, hammasi bir vaqtda
 * "bounce" bo'lib qolardi.
 *
 * YECHIM: har bir xabarning barqaror Firestore ID'si orqali — "shu ID
 * avval chizilganmi?" — tekshiramiz. Faqat HAQIQIY yangi (hali hech
 * qachon chizilmagan) xabar bounce bo'ladi; status/audioUrl kabi
 * maydonlar yangilanib qayta chizilganda eski xabarlar tegilmaydi. */
let _seenMsgIds = new Set();
let _seenMsgIdsChatId = null;

/* ── Sana ajratuvchi (Telegram uslubida "Bugun" / "Kecha" / "12-iyul") ── */
export function _toDateSafe(ts) {
  if (!ts) return null;
  return ts.toDate ? ts.toDate() : new Date(ts);
}
export function _isSameDay(a, b) {
  if (!a || !b) return false;
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth()    === b.getMonth()    &&
         a.getDate()     === b.getDate();
}
const _UZ_MONTHS = ['yanvar','fevral','mart','aprel','may','iyun','iyul','avgust','sentabr','oktabr','noyabr','dekabr'];
export function _dateSepLabel(ts) {
  const d = _toDateSafe(ts);
  if (!d) return '';
  const now = new Date();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (_isSameDay(d, now)) return 'Bugun';
  if (_isSameDay(d, yesterday)) return 'Kecha';
  const sameYear = d.getFullYear() === now.getFullYear();
  return sameYear
    ? `${d.getDate()}-${_UZ_MONTHS[d.getMonth()]}`
    : `${d.getDate()}-${_UZ_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
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
      /* ── Voice message ──
       * "MRgram AI" bot xabarlarida — sozlamalarda tanlangan ovoz (Sardor/
       * Madina) jinsiga mos audio tanlanadi (_pickVoiceMsgMedia), hatto
       * bu ESKI/tarixdagi xabar bo'lsa ham. Oddiy foydalanuvchi ovozli
       * xabarlarida gender-maydonlar bo'lmagani uchun bu funksiya shunchaki
       * asl `mediaUrl`ni qaytaradi (o'zgarishsiz). */
      const voiceMedia = _pickVoiceMsgMedia(m);
      const dur = voiceMedia.duration ? fmtVoiceDur(voiceMedia.duration) : '0:00';
      const barCount = _voiceBarCount(voiceMedia.duration);
      // URL ni esc() orqali o'tkazmaymiz — & belgisi buziladi!
      // data-* attributga to'g'ridan-to'g'ri qo'yamiz
      const safeUrl = (voiceMedia.url || '').replace(/"/g, '&quot;');
      const _mpName = (mine ? 'Siz' : ($('chatThreadName')?.textContent || 'Ovozli xabar')).replace(/"/g, '&quot;');
      bubbleContent = `<div class="chat-voice-msg" data-url="${safeUrl}" data-dur="${voiceMedia.duration||0}" data-bar-count="${barCount}" data-chat-id="${state.currentChatId||''}" data-chat-uid="${state.currentChatUid||''}" data-name="${_mpName}">
        <button class="cvm-play" onclick="window._chatPlayVoice(this)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </button>
        <div class="cvm-waveform">${renderVoiceWave(idx, barCount)}</div>
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
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
          </a>
        </div>`;
      }
    } else {
      /* ── Text message ── */
      let aiVoicePlayer = '';
      // "MRgram AI" javobi uchun — TTS audio tayyor bo'lsa, matn ostida
      // kichik ovoz pleeri (xuddi voice message'dagi kabi, mavjud
      // window._chatPlayVoice global handleridan qayta foydalanamiz).
      const aiTextVoiceMedia = m.senderId === MRGRAM_AI_UID ? _pickAiTextVoiceMedia(m) : null;
      if (aiTextVoiceMedia && aiTextVoiceMedia.url) {
        const safeAudioUrl = aiTextVoiceMedia.url.replace(/"/g, '&quot;');
        const aiDur = aiTextVoiceMedia.duration ? fmtVoiceDur(aiTextVoiceMedia.duration) : '0:00';
        const aiBarCount = _voiceBarCount(aiTextVoiceMedia.duration);
        aiVoicePlayer = `<div class="chat-voice-msg chat-voice-msg--ai" data-url="${safeAudioUrl}" data-dur="${aiTextVoiceMedia.duration||0}" data-bar-count="${aiBarCount}" data-chat-id="${state.currentChatId||''}" data-chat-uid="${state.currentChatUid||''}" data-name="MRgram AI">
          <button class="cvm-play" onclick="window._chatPlayVoice(this)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </button>
          <div class="cvm-waveform">${renderVoiceWave(idx, aiBarCount)}</div>
          <span class="cvm-dur">${aiDur}</span>
        </div>`;
      } else if (m.senderId === MRGRAM_AI_UID && !(aiTextVoiceMedia && aiTextVoiceMedia.url) && _pendingAiVoiceMsgIds.has(m.id)) {
        // Audio hali Firestore'ga yozilmagan, lekin fon rejimida tayyorlanmoqda —
        // foydalanuvchiga "osilib qolmagan" taassurotini berish uchun ko'rinadigan
        // kichik indikator (tayyor bo'lganda avtomatik pleerga almashadi).
        {
          const _pct = _pendingAiVoicePercent.get(m.id) || 0;
          aiVoicePlayer = `<div class="chat-voice-pending">
            <span class="cvp-dot"></span><span class="cvp-dot"></span><span class="cvp-dot"></span>
            <span class="cvp-label">ovoz tayyorlanmoqda… ${_pct}%</span>
          </div>`;
        }
      }
      bubbleContent = `<div class="chat-bubble-text">${renderMarkdown(m.text || '')}</div>${aiVoicePlayer}`;
    }

    // ID asosida "yangi"lik: shu xabar ID'si ilgari chizilmagan bo'lsagina
    // bounce animatsiyasi beriladi (status/audioUrl kabi maydon
    // yangilanishlari eski xabarlarni qayta "bounce" qilib yubormaydi).
    const isNew = !!m.id && !_seenMsgIds.has(m.id);
    if (m.id) _seenMsgIds.add(m.id);

    // Kun almashgan bo'lsa — Telegram uslubidagi "Bugun"/"Kecha"/sana pill'i
    let dateSep = '';
    const prevMsg = msgs[idx - 1];
    const curDate  = _toDateSafe(m.createdAt);
    const prevDate = prevMsg ? _toDateSafe(prevMsg.createdAt) : null;
    if (curDate && (!prevDate || !_isSameDay(curDate, prevDate))) {
      dateSep = `<div class="chat-date-sep"><span>${_dateSepLabel(m.createdAt)}</span></div>`;
    }

    return `${dateSep}<div class="chat-msg ${mine ? 'mine' : 'theirs'}${isNew ? ' anim-in' : ''}" data-msg-id="${m.id || ''}" style="${isNew ? `animation-delay:${Math.min(idx * 0.04, 0.3)}s` : ''}">
      
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

  // Voice xabarlar uchun — haqiqiy waveform balandliklarini fonda yuklaymiz
  _hydrateVoiceWaveforms(box);

  // BUG FIX: paintMessages() har qanday Firestore yozuvida (masalan
  // _attachSecondaryVoice orqali fon rejimida ikkinchi jins ovozi
  // qo'shilganda) butun DOM'ni qayta chizadi. Agar shu paytda audio
  // fonda ijro etilayotgan bo'lsa (_activeAudio), eski <button> DOM
  // elementi yo'q qilinadi va _activeBtn "orfan" obyektga aylanadi —
  // natijada yangi tugma har doim "Play" holatida chiqadi, garchi
  // audio haqiqatan hali ham ijro etilayotgan bo'lsa ham. Shu yerda
  // faol ijro holatini yangi chizilgan DOM ichidan data-url bo'yicha
  // qidirib topilgan tugma/waveform'ga qayta bog'laymiz.
  _reattachActiveVoiceUI(box);
}

/**
 * Agar hozir biror ovozli xabar ijro etilayotgan/pauza holatida bo'lsa
 * (_activeAudio hali mavjud), paintMessages() repaint qilganidan keyin
 * uning UI holatini (tugma ikonkasi, waveform progress, davomiylik) yangi
 * DOM elementlariga qayta bog'laydi. _activeBtn eski (endi DOM'dan
 * o'chirilgan) tugmaga ishora qilib qolmasligi uchun uni ham yangilaymiz.
 */
function _reattachActiveVoiceUI(box) {
  if (!_activeAudio || !_activeBtn) return;

  // Eski tugma hali DOM ichida turibdimi (masalan repaint umuman shu
  // xabarga tegmagan bo'lsa) — bo'lsa hech narsa qilish shart emas.
  if (box.contains(_activeBtn)) return;

  const url = _activeBtn?.closest?.('.chat-voice-msg')?.dataset?.url
    || (_activeAudio.src || '');
  if (!url) return;

  // Xuddi shu audio URL'iga mos yangi chizilgan wrapper'ni topamiz.
  const newWrap = Array.from(box.querySelectorAll('.chat-voice-msg'))
    .find(w => w.dataset.url === url || (w.dataset.url && _activeAudio.src && _activeAudio.src.endsWith(w.dataset.url)));
  if (!newWrap) return;

  const newBtn = newWrap.querySelector('.cvm-play');
  if (!newBtn) return;

  // Holatni (play/pause ikonka) qayta tiklaymiz
  newBtn.innerHTML = _activeAudio.paused ? PLAY_ICON : PAUSE_ICON;

  const bars   = newWrap.querySelectorAll('.cvm-bar');
  const durEl  = newWrap.querySelector('.cvm-dur');
  const waveEl = newWrap.querySelector('.cvm-waveform');
  const total  = parseFloat(newWrap.dataset.dur || '0') || _activeAudio.duration || 0;

  if (!_activeAudio.paused && waveEl) waveEl.classList.add('playing');

  // Progressni joriy audio.currentTime asosida darhol tiklaymiz
  const duration = _activeAudio.duration || total || 1;
  const pct = duration ? (_activeAudio.currentTime / duration) : 0;
  const filled = Math.floor(pct * bars.length);
  bars.forEach((b, i) => b.classList.toggle('played', i < filled));
  if (durEl) durEl.textContent = fmtVoiceDur(_activeAudio.currentTime);

  // Audio event handlerlarini yangi elementlarga qayta ulaymiz, aks holda
  // ular hamon eski (DOM'dan o'chirilgan) tugmani yangilashda davom etadi.
  _activeAudio.onwaiting = () => {
    newBtn.innerHTML = LOADING_ICON;
    newBtn.classList.add('cvm-play--loading');
  };
  _activeAudio.onplaying = () => {
    newBtn.innerHTML = PAUSE_ICON;
    newBtn.classList.remove('cvm-play--loading');
    _syncMiniPlayer();
  };
  _activeAudio.ontimeupdate = () => {
    const dur2 = _activeAudio.duration || total || 1;
    const pct2 = _activeAudio.currentTime / dur2;
    const filled2 = Math.floor(pct2 * bars.length);
    bars.forEach((b, i) => b.classList.toggle('played', i < filled2));
    if (durEl) durEl.textContent = fmtVoiceDur(_activeAudio.currentTime);
    _updateMiniPlayerProgress(pct2);
  };
  _activeAudio.onended = () => {
    if (waveEl) waveEl.classList.remove('playing');
    newBtn.innerHTML = PLAY_ICON;
    bars.forEach(b => b.classList.remove('played'));
    if (durEl) durEl.textContent = fmtVoiceDur(total);
    _activeAudio = null;
    _activeBtn   = null;
    _syncMiniPlayer();
  };
  const _thisAudio = _activeAudio;
  _activeAudio.onerror = (e) => {
    if (_activeAudio !== _thisAudio) return;
    console.error('Audio xatosi (repaint keyin):', e, 'URL:', url);
    toast('Audio yuklanmadi', 'error');
    newBtn.innerHTML = PLAY_ICON;
    _activeAudio = null;
    _activeBtn   = null;
    _syncMiniPlayer();
  };

  _activeBtn = newBtn;
}

/* ── Yopish chat thread ───────────────────────────────────────────────── */
export function closeChatThread() {
  if (_threadUnsub) { _threadUnsub(); _threadUnsub = null; }
  if (_peerUserUnsub) { _peerUserUnsub(); _peerUserUnsub = null; }
  if (_peerStatusTick) { clearInterval(_peerStatusTick); _peerStatusTick = null; }
  if (_chatDocUnsub) { _chatDocUnsub(); _chatDocUnsub = null; }
  clearTimeout(_typingTimeout);
  _setTyping(false);
  _peerTyping = false;
  // If in group/channel mode, cleanup group state too
  if (state.currentChatKind && state.currentChatKind !== 'dm') {
    closeGroupThread();
  }
  state.currentChatUid = null;
  state.currentChatId  = null;
  $('chatThreadModal').classList.remove('show');
  // Chat ro'yxatini yangilash — oxirgi xabar/preview yangi bo'lishi uchun
  if (state.view === 'chats') renderChatsList();
  // Ovoz hali ijro etilayotgan bo'lsa — endi bu chat yopilgani uchun
  // mini-pleer bar ko'rinishi kerak (ovozning o'zi to'xtamaydi).
  try { _syncMiniPlayer(); } catch (_) {}
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
  updateVoiceSendBtn();
  clearTimeout(_typingTimeout);
  _setTyping(false);

  // 1v1 (shaxsiy) chatlarda AI moderatsiya ishlatilmaydi — bu yerda
  // atayin hech qanday tekshiruv yo'q, xabar to'g'ridan-to'g'ri yuboriladi.

  try {
    await updateDoc(doc(db, 'chats', '_index', '1v1chat', chatId), {
      lastMessage:   text,
      lastSenderId:  state.me.uid,
      lastMessageAt: serverTimestamp(),
      [`unreadCount.${otherUid}`]: increment(1)
    });

    const userMsgRef = await addDoc(collection(db, 'chats', '_index', '1v1chat', chatId, 'messages'), {
      senderId:  state.me.uid,
      text,
      status:    'sent',
      createdAt: serverTimestamp()
    });

    if (otherUid === MRGRAM_AI_UID) {
      // Bu "MRgram AI" bilan suhbat — push-bildirishnoma o'rniga AI javobini so'raymiz.
      // userMsgRef.id — Groq'ga so'rov muvaffaqiyatli yetib borgach, shu
      // xabarni "o'qildi" (2 ptichka) qilib belgilash uchun kerak.
      _triggerMrgramAiReply(chatId, text, null, userMsgRef.id);
    } else {
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
    }
  } catch (err) {
    console.error('❌ Firebase: sendChatMessage failed:', err.message);
    toast('Xabar yuborilmadi', 'error');
    inp.value = text; // qaytarib qo'yamiz, user qayta yuborishi uchun
    updateVoiceSendBtn();
  }
}

/* ── MRgram AI — real-vaqt "yozayotgan" pufakcha (streaming) ──────────────
 * Firestore'ga token-token yozish shart emas (va zarar ham keltiradi —
 * paintMessages() har safar butun ro'yxatni qayta chizadi). Shuning uchun
 * bu pufakcha FAQAT lokal DOM'da, foydalanuvchi ekranida yaratiladi va
 * yangilanadi; javob to'liq bo'lgach, chat.js oddiy xabar sifatida
 * Firestore'ga (bir marta) yozadi — keyingi onSnapshot repaint shu vaqtinchalik
 * pufakchani xuddi shu ko'rinishdagi haqiqiy xabar bilan tabiiy almashtiradi.
 ─────────────────────────────────────────────────────────────────────────*/
function _showAiStreamBubble(chatId) {
  if (state.currentChatId !== chatId) return null;
  const box = $('chatThreadMessages');
  if (!box) return null;
  box.querySelector('.ai-stream-msg')?.remove();
  const el = document.createElement('div');
  el.className = 'chat-msg theirs ai-stream-msg anim-in';
  el.innerHTML = `<div class="chat-bubble">
    <div class="chat-bubble-wrap">
      <div class="chat-bubble-text ai-stream-text"><span class="typing-dots"><span></span><span></span><span></span></span></div>
      <div class="ai-speaking-indicator">
        <span class="ai-speaking-bars"><span></span><span></span><span></span><span></span></span>
        <span>Ovozli xabar ijro etilmoqda...</span>
      </div>
    </div>
  </div>`;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
  return el;
}

function _updateAiStreamBubble(el, chatId, fullTextSoFar) {
  if (!el || state.currentChatId !== chatId) return;
  const textEl = el.querySelector('.ai-stream-text');
  if (!textEl) return;
  textEl.innerHTML = renderMarkdown(fullTextSoFar || '');
  const box = $('chatThreadMessages');
  if (box && box.scrollHeight - box.scrollTop - box.clientHeight < 140) {
    box.scrollTop = box.scrollHeight;
  }
}

function _removeAiStreamBubble(chatId) {
  if (state.currentChatId !== chatId) return;
  $('chatThreadMessages')?.querySelector('.ai-stream-msg')?.remove();
}

/* ── "Ovozli xabar ijro etilmoqda..." indikatori ───────────────────────────
 * playVoiceMessageWithEffects() ichida bir nechta bo'lak (marker + TTS)
 * ketma-ket, BITTA umumiy <audio> elementida ijro etiladi — har bir bo'lak
 * o'zining 'onended' hodisasini ishlatadi, lekin funksiyaning o'zi
 * qaytargan Promise faqat SO'NGGI bo'lakning 'onended'i ishga tushgach
 * "resolve" bo'ladi (voice-fx-player.js'dagi playQueueItem/for...of'ga
 * qarang). Shu sabab bu yerda alohida 'onended' listener biriktirish shart
 * emas — Promise'ning o'zi bilan boshlanish/tugashni belgilash yetarli va
 * xuddi shu natijani beradi, lekin ancha soddaroq. */
function _setAiSpeakingIndicator(streamEl, active) {
  if (!streamEl) return;
  const ind = streamEl.querySelector('.ai-speaking-indicator');
  if (!ind) return;
  ind.classList.toggle('show', !!active);
}

/* ── "MRgram AI" javobini so'rash va Firestore'ga saqlash ─────────────────
 * Foydalanuvchi AI-bot bilan suhbatda matn yoki rasm yuborganda chaqiriladi.
 * Groq'ga so'rov `getMrgramAiReply()` (modules/mrgram-ai.js) orqali ketadi,
 * javob esa oddiy xabar sifatida shu chatga yoziladi (firestore.rules'da
 * shu maxsus bot ID uchun alohida ruxsat bor — mrgram-ai.js'dagi izohga q.).
 ─────────────────────────────────────────────────────────────────────────*/
/* ── "MRgram AI" ovozli javobi — foydalanuvchi OVOZLI XABAR yuborganda ────
 * Oddiy _triggerMrgramAiReply()dan farqi: yakuniy xabar matn+mini-pleer
 * emas, balki HAQIQIY ovozli xabar pufakchasi (type:'voice', xuddi
 * foydalanuvchining o'z ovozli xabari kabi katta waveform pleer bilan).
 * Matn hali ham stream holida ko'rsatiladi (tabiiy "yozayotgan..." hissi
 * uchun), lekin saqlanganda faqat ovoz (mp3, Edge TTS) qoladi — matn faqat
 * keyingi AI so'rovlari uchun (suhbat tarixi) "text" maydonida saqlanadi va
 * paintMessages buni matn sifatida hech qachon ko'rsatmaydi (type:'voice'
 * bo'lgani uchun). ─────────────────────────────────────────────────────*/
async function _triggerMrgramAiVoiceReply(chatId, userText, userMsgId) {
  const isThreadOpen = () => state.currentChatId === chatId && $('chatThreadModal')?.classList.contains('show');
  const statusEl = $('chatTypingStatus');
  if (isThreadOpen() && statusEl) {
    statusEl.textContent = 'ovozli xabar yozmoqda...';
    statusEl.classList.add('online');
  }

  let streamEl = _showAiStreamBubble(chatId);

  try {
    const cached = getCachedThreadMessages(chatId) || [];
    const history = cached.slice(-12).map(m => ({
      role: m.senderId === MRGRAM_AI_UID ? 'assistant' : 'user',
      content: m.text || (m.type === 'file' ? `[fayl yubordi: ${m.fileName || ''}]` : '')
    })).filter(h => h.content);

    const reply = await getMrgramAiReplyStream(history, userText, null, (_delta, fullSoFar) => {
      if (!streamEl) streamEl = _showAiStreamBubble(chatId);
      _updateAiStreamBubble(streamEl, chatId, fullSoFar);
    }, { voiceMode: true });

    // Groq'ga so'rov shu yergacha muvaffaqiyatli (xatosiz) yetib bordi —
    // foydalanuvchining ovozli xabarini "o'qildi" (2 ptichka) qilib belgilaymiz.
    _markUserMsgSeenByAi(chatId, userMsgId);

    // Foydalanuvchi shu suhbatni ochiq holda kuzatib turgan bo'lsa — javobni
    // DARHOL, jonli (live) tarzda, marker'lardagi tovush effektlari bilan
    // birga eshittiramiz (modules/voice-fx-player.js). Bu pastdagi
    // synthesizeSpeech() chaqiruvidan MUSTAQIL, alohida ijro — u faqat
    // xabar tarixida saqlanadigan doimiy audio faylni yasaydi va jonli
    // ijroga bog'liq emas. Xato chiqsa ham xabarni saqlash oqimi
    // to'xtamasin deb try/catch bilan o'raymiz va awaitlamaymiz.
    if (isThreadOpen()) {
      try {
        _setAiSpeakingIndicator(streamEl, true);
        playVoiceMessageWithEffects(reply, { voice: getAiVoiceGender() })
          .catch(err => console.warn('[voice-fx] jonli ijro xatosi:', err?.message || err))
          .finally(() => _setAiSpeakingIndicator(streamEl, false));
      } catch (err) {
        console.warn('[voice-fx] jonli ijroni boshlab bo\'lmadi:', err?.message || err);
        _setAiSpeakingIndicator(streamEl, false);
      }
    }

    if (isThreadOpen() && statusEl) statusEl.textContent = 'ovoz yasalmoqda...';

    // Doimiy saqlanadigan faylda ham HAQIQIY tovush effekti (qisqa nafas)
    // va ovozsiz pauza bo'lishi uchun — oddiy synthesizeSpeech() o'rniga
    // marker+TTS bo'laklarini bitta audio faylga "quyadigan" (stitch
    // qiladigan) buildVoiceMessageAudioBlob()'dan foydalanamiz. Bu marker
    // matnining TTS tomonidan so'zma-so'z o'qilib qolish xatosini ham
    // avtomatik tuzatadi (marker'lar endi haqiqiy mp3'ga aylanadi, matn
    // sifatida hech qachon TTS'ga yuborilmaydi).
    //
    // MUHIM: Sardor VA Madina — ikkalasi ham tayyorlanadi, lekin
    // foydalanuvchini ikkalasi bir vaqtda tugaguncha kutib QOLDIRMAYMIZ —
    // sozlamalarda hozir tanlangan ovoz (primaryGender) birinchi, to'liq
    // tayyor bo'lguncha kutib yasaladi va xabar SHU BILAN darhol
    // saqlanadi; muqobil ovoz esa faqat shundan keyin, fon rejimida
    // (buildVoiceMessageBothGenders ichida) tayyorlanib, tayyor bo'lgach
    // xabar hujjatiga alohida maydon sifatida qo'shiladi.
    const primaryGender = getAiVoiceGender();
    let audio = null;
    // MUHIM (poyga holati/race condition oldini olish): muqobil ovoz fon
    // rejimida QACHON tayyor bo'lishi noma'lum — ba'zan xabar hujjati
    // (pastdagi addDoc) hali yaratilmasdan turib ham tayyor bo'lib qolishi
    // mumkin. Shu sabab bu yerda "kechiktirilgan" (deferred) promise
    // ishlatiladi: muqobil ovoz tayyor bo'lganda xabar hujjati (ID) hali
    // mavjud bo'lmasa — shunchaki voiceMsgRefPromise hal (resolve)
    // bo'lishini kutadi, keyin xavfsiz saqlaydi. Tartib qanday bo'lishidan
    // qat'i nazar, muqobil ovoz hech qachon yo'qolib qolmaydi.
    let resolveVoiceMsgRef;
    const voiceMsgRefPromise = new Promise(res => { resolveVoiceMsgRef = res; });
    try {
      const result = await buildVoiceMessageBothGenders(reply, {
        primaryGender,
        // HAQIQIY % — buildVoiceMessageAudioBlob() tugallangan TTS/effekt
        // bo'laklari soniga qarab hisoblab beradi (soxta/тахминий emas).
        onProgress: (pct) => {
          if (isThreadOpen() && statusEl) statusEl.textContent = `ovoz yasalmoqda... ${pct}%`;
        },
        onSecondaryReady: (built, gender) => {
          if (!built) return;
          voiceMsgRefPromise.then(msgRef => {
            if (!msgRef) return; // yakuniy xabar ovozsiz (matn) bo'lib qoldi — biriktiradigan joy yo'q
            _attachSecondaryVoice(msgRef, chatId, built, {
              urlField:  `mediaUrl${_CAP[gender]}`,
              pathField: `mediaPath${_CAP[gender]}`,
              durField:  `duration${_CAP[gender]}`,
            });
          });
        },
      });
      if (result.primary && result.primary.blob) {
        audio = await _uploadBuiltVoiceBlob(result.primary);
      }
    } catch (err) {
      console.warn('[voice-fx] effektli audio yasashda xato, oddiy TTS\'ga qaytamiz:', err?.message || err);
    }
    // Zaxira: effektli audio yasab bo'lmasa (masalan brauzer Web Audio
    // API'ni qo'llab-quvvatlamasa) — hech bo'lmasa oddiy (effektsiz) TTS
    // bilan javob beramiz, foydalanuvchi javobsiz qolmasin. Markerlarni
    // albatta tozalab yuboramiz — aks holda TTS ularni so'zma-so'z o'qib
    // beradi.
    if (!audio) {
      audio = await synthesizeSpeech(stripEffectMarkers(reply));
    }
    _removeAiStreamBubble(chatId);

    const cleanText = stripEffectMarkers(reply);

    if (!audio) {
      // TTS vaqtincha ishlamasa — hech bo'lmasa oddiy matn xabar bilan javob beramiz
      resolveVoiceMsgRef(null);
      await addDoc(collection(db, 'chats', '_index', '1v1chat', chatId, 'messages'), {
        senderId: MRGRAM_AI_UID, text: cleanText, status: 'sent', createdAt: serverTimestamp(),
      });
      await updateDoc(doc(db, 'chats', '_index', '1v1chat', chatId), {
        lastMessage:   cleanText.slice(0, 120),
        lastSenderId:  MRGRAM_AI_UID,
        lastMessageAt: serverTimestamp(),
        [`unreadCount.${state.me.uid}`]: isThreadOpen() ? 0 : increment(1)
      });
      return;
    }

    const aiVoiceMsgRef = await addDoc(collection(db, 'chats', '_index', '1v1chat', chatId, 'messages'), {
      senderId:     MRGRAM_AI_UID,
      type:         'voice',
      text:         cleanText,      // faqat kontekst/tarix uchun (marker'lardan tozalangan) — pufakcha buni matn sifatida ko'rsatmaydi
      mediaUrl:     audio.url,
      mediaPath:    audio.path,
      storageIndex: audio.storageIndex,
      duration:     audio.duration || 0,
      [`mediaUrl${_CAP[primaryGender]}`]:  audio.url,
      [`mediaPath${_CAP[primaryGender]}`]: audio.path,
      [`duration${_CAP[primaryGender]}`]:  audio.duration || 0,
      status:       'sent',
      createdAt:    serverTimestamp(),
    });
    // Muqobil ovoz kutib turgan bo'lsa (yoki hali kelayotgan bo'lsa) —
    // yuqoridagi onSecondaryReady ichidagi voiceMsgRefPromise.then(...)
    // shu yerdan xabar hujjatini oladi va xavfsiz saqlaydi.
    resolveVoiceMsgRef(aiVoiceMsgRef);

    await updateDoc(doc(db, 'chats', '_index', '1v1chat', chatId), {
      lastMessage:   'Ovozli xabar',
      lastSenderId:  MRGRAM_AI_UID,
      lastMessageAt: serverTimestamp(),
      [`unreadCount.${state.me.uid}`]: isThreadOpen() ? 0 : increment(1)
    });
  } catch (err) {
    console.warn('[MRgram AI] Ovozli javob olishda xato:', err.message);
    _removeAiStreamBubble(chatId);
    // Rate-limit xatosi ("N soniyadan keyin qayta urinib ko'ring") bo'lsa —
    // foydalanuvchiga aynan shu aniq matnni ko'rsatamiz, umumiy xato o'rniga.
    const isRateLimit = /soniyadan keyin qayta urinib/i.test(err?.message || '');
    try {
      await addDoc(collection(db, 'chats', '_index', '1v1chat', chatId, 'messages'), {
        senderId:  MRGRAM_AI_UID,
        text:      isRateLimit ? err.message : 'Kechirasiz, hozir ovozli javob bera olmadim 🙏 Birozdan so\'ng qaytadan urinib ko\'ring.',
        status:    'sent',
        createdAt: serverTimestamp()
      });
    } catch (_) { /* jim */ }
  } finally {
    if (isThreadOpen() && statusEl) {
      statusEl.textContent = MRGRAM_AI_TAGLINE;
      statusEl.classList.remove('online');
    }
  }
}

async function _triggerMrgramAiReply(chatId, userText, imageUrl, userMsgId) {
  const isThreadOpen = () => state.currentChatId === chatId && $('chatThreadModal')?.classList.contains('show');
  const statusEl = $('chatTypingStatus');
  if (isThreadOpen() && statusEl) {
    statusEl.textContent = 'yozmoqda...';
    statusEl.classList.add('online');
  }

  // Darhol (kutmasdan) mahalliy "yozayotgan" pufakchasini ko'rsatamiz —
  // Claude/ChatGPT kabi silliq, bir zumda boshlanadigan taassurot uchun.
  // Bu Firestore'ga yozilmaydi, faqat shu foydalanuvchi ekranida ko'rinadi.
  let streamEl = _showAiStreamBubble(chatId);

  try {
    // Kontekst uchun oxirgi ~12 ta xabarni (kesh yoki hozir ochiq bo'lgan
    // threaddan) o'qiymiz — shu bilan AI oldingi suhbatni "eslab" javob beradi.
    const cached = getCachedThreadMessages(chatId) || [];
    const history = cached.slice(-12).map(m => ({
      role: m.senderId === MRGRAM_AI_UID ? 'assistant' : 'user',
      content: m.text || (m.type === 'file' ? `[fayl yubordi: ${m.fileName || ''}]` : '')
    })).filter(h => h.content);

    const reply = await getMrgramAiReplyStream(history, userText, imageUrl, (_delta, fullSoFar) => {
      if (!streamEl) streamEl = _showAiStreamBubble(chatId);
      _updateAiStreamBubble(streamEl, chatId, fullSoFar);
    });

    // Groq'ga so'rov shu yergacha muvaffaqiyatli (xatosiz) yetib bordi —
    // foydalanuvchining xabarini "o'qildi" (2 ptichka) qilib belgilaymiz.
    _markUserMsgSeenByAi(chatId, userMsgId);

    const aiMsgRef = await addDoc(collection(db, 'chats', '_index', '1v1chat', chatId, 'messages'), {
      senderId:  MRGRAM_AI_UID,
      text:      reply,
      status:    'sent',
      createdAt: serverTimestamp(),
    });

    await updateDoc(doc(db, 'chats', '_index', '1v1chat', chatId), {
      lastMessage:   (reply || '').slice(0, 120),
      lastSenderId:  MRGRAM_AI_UID,
      lastMessageAt: serverTimestamp(),
      [`unreadCount.${state.me.uid}`]: isThreadOpen() ? 0 : increment(1)
    });

    // Ovozli xabar (TTS) — matn allaqachon ko'rsatilgan/saqlangan, shu sabab
    // bu fon rejimida (kutmasdan) ishlaydi va foydalanuvchi javobni matn
    // sifatida darhol ko'raveradi. Tayyor bo'lgach, shu XABARNING o'ziga
    // audioUrl/audioDuration qo'shiladi — paintMessages buni ko'rib pastida
    // kichik pleer chizadi (hfkey hali sozlanmagan bo'lsa — jim, hech narsa
    // o'zgarmaydi, faqat matn qoladi).
    //
    // Oddiy matn javobida AI'dan marker so'ralmagan (voiceMode:true emas),
    // shu sabab bu yerda tabiiy tovushni ta'minlash uchun ikkita qadam
    // bajariladi: 1) injectNaturalMarkers() matn ustidan heuristik tarzda
    // (AI o'zi tanlagandek "aqlli" emas, lekin xuddi shu chastota/qoida
    // bilan) tomoq/nafas marker'larini joylashtiradi; 2) natija Markdown'dan
    // tozalanib, buildVoiceMessageAudioBlob() bilan HAQIQIY effekt+TTS
    // audio fayliga "quyiladi" — endi bu mini-pleer ham quruq TTS emas.
    (async () => {
      // Darhol ko'rinadigan indikator qo'yamiz — matn allaqachon ekranda,
      // endi uning ostida "ovoz tayyorlanmoqda…" belgisi paydo bo'ladi va
      // audio tayyor (yoki muvaffaqiyatsiz) bo'lguncha turadi.
      _markAiVoicePending(chatId, aiMsgRef.id);
      try {
        const spoken = injectNaturalMarkers(reply);
        // Sardor VA Madina — ikkalasi ham tayyorlanadi: sozlamalarda hozir
        // tanlangan (primary) ovoz birinchi, to'liq tayyor bo'lguncha
        // kutib yasaladi va DARHOL saqlanadi (foydalanuvchi ikkalasini
        // bir vaqtda kutib qolmaydi); muqobil ovoz esa shundan keyin,
        // fon rejimida tayyorlanib, tayyor bo'lgach shu XABARNING o'ziga
        // qo'shimcha maydon sifatida yoziladi.
        const primaryGender = getAiVoiceGender();
        const { primary, secondaryGender } = await buildVoiceMessageBothGenders(spoken, {
          primaryGender,
          // HAQIQIY % — pending indikatordagi "ovoz tayyorlanmoqda…" yorlig'ini
          // to'g'ridan-to'g'ri (full repaint'siz) yangilaydi.
          onProgress: (pct) => _updateAiVoiceProgress(chatId, aiMsgRef.id, pct),
          onSecondaryReady: (built) => {
            _attachSecondaryVoice(doc(db, 'chats', '_index', '1v1chat', chatId, 'messages', aiMsgRef.id), chatId, built, {
              urlField:     `audioUrl${_CAP[secondaryGender]}`,
              pathField:    `audioPath${_CAP[secondaryGender]}`,
              durField:     `audioDuration${_CAP[secondaryGender]}`,
              storageField: `audioStorage${_CAP[secondaryGender]}`,
            });
          },
        });

        let audio = null;
        if (primary && primary.blob) {
          audio = await _uploadBuiltVoiceBlob(primary);
        } else {
          // Zaxira: effektli audio yasab bo'lmasa — oddiy TTS (Markdown'dan
          // tozalangan matn bilan, aks holda "**"/"#" kabi belgilar
          // so'zma-so'z o'qilib qoladi).
          audio = await synthesizeSpeech(stripMarkdownForSpeech(reply));
        }
        if (!audio) return;

        await updateDoc(doc(db, 'chats', '_index', '1v1chat', chatId, 'messages', aiMsgRef.id), {
          audioUrl:      audio.url,
          audioPath:     audio.path,
          audioStorage:  audio.storageIndex,
          audioDuration: audio.duration || 0,
          [`audioUrl${_CAP[primaryGender]}`]:      audio.url,
          [`audioPath${_CAP[primaryGender]}`]:     audio.path,
          [`audioStorage${_CAP[primaryGender]}`]:  audio.storageIndex,
          [`audioDuration${_CAP[primaryGender]}`]: audio.duration || 0,
        });
      } catch (err) {
        console.warn('[voice-fx] oddiy matn uchun tabiiy audio yasashda xato:', err?.message || err);
        // Oldin bu yerda foydalanuvchiga HECH QANDAY signal berilmasdi —
        // "ovoz tayyorlanmoqda…" indikatori jimgina yo'qolib, matn o'zi
        // qolardi, go'yo ovoz umuman so'ralmagandek. Endi shu chat hozir
        // ochiq bo'lsa, kichik (bezovta qilmaydigan) toast bilan xabar
        // beramiz — foydalanuvchi "nega ovoz yo'q" deb ajablanib qolmaydi.
        if (state.currentChatId === chatId) {
          toast("Ovozli xabar yasab bo'lmadi, matn qoldi", 'error');
        }
      } finally {
        // Muvaffaqiyatli bo'lsa — keyingi onSnapshot audioUrl bilan qayta
        // chizadi; muvaffaqiyatsiz bo'lsa — indikator jimgina yo'qoladi,
        // matn xabar o'zi baribir qolaveradi (foydalanuvchi javobsiz
        // qolmaydi, faqat ovoz bo'lmaydi).
        _clearAiVoicePending(chatId, aiMsgRef.id);
      }
    })();
  } catch (err) {
    console.warn('[MRgram AI] Javob olishda xato:', err.message);
    _removeAiStreamBubble(chatId);
    // Rate-limit xatosi ("N soniyadan keyin qayta urinib ko'ring") bo'lsa —
    // foydalanuvchiga aynan shu aniq matnni ko'rsatamiz, umumiy xato o'rniga.
    const isRateLimit = /soniyadan keyin qayta urinib/i.test(err?.message || '');
    try {
      await addDoc(collection(db, 'chats', '_index', '1v1chat', chatId, 'messages'), {
        senderId:  MRGRAM_AI_UID,
        text:      isRateLimit ? err.message : 'Kechirasiz, hozir javob bera olmadim 🙏 Birozdan so\'ng qaytadan urinib ko\'ring.',
        status:    'sent',
        createdAt: serverTimestamp()
      });
    } catch (_) { /* jim */ }
  } finally {
    if (isThreadOpen() && statusEl) {
      statusEl.textContent = MRGRAM_AI_TAGLINE;
      statusEl.classList.remove('online');
    }
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
let _activeAudio   = null;
let _activeBtn     = null;
let _activeChatId  = null;
let _activeChatUid = null;
let _activeName    = '';

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
    _syncMiniPlayer();
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

  _activeBtn    = btn;
  _activeChatId  = wrap.dataset.chatId || state.currentChatId || null;
  _activeChatUid = wrap.dataset.chatUid || state.currentChatUid || null;
  _activeName   = wrap.dataset.name || 'Ovozli xabar';
  const audio = new Audio(url);
  audio.preload = 'auto';
  _activeAudio = audio;

  const bars      = wrap.querySelectorAll('.cvm-bar');
  const durEl     = wrap.querySelector('.cvm-dur');
  const waveEl    = wrap.querySelector('.cvm-waveform');
  const total     = parseFloat(wrap.dataset.dur || '0') || 0;

  // Fayl hali (masalan sekin tarmoqda) yuklanayotgan bo'lsa — tugmani
  // darhol pauza belgisiga o'tkazmasdan, kichik spinner ko'rsatamiz. Aks
  // holda foydalanuvchi uchun "bosdim-yu hech narsa bo'lmadi, qotib qoldi"
  // taassuroti qoladi, garchi audio aslida orqa fonda yuklanayotgan bo'lsa
  // ham. `waiting` — buferlash paytida, `playing` — ijro haqiqatan
  // boshlanganda chaqiriladi (brauzer standart Audio eventlari).
  btn.innerHTML = LOADING_ICON;
  btn.classList.add('cvm-play--loading');

  audio.onwaiting = () => {
    btn.innerHTML = LOADING_ICON;
    btn.classList.add('cvm-play--loading');
  };
  audio.onplaying = () => {
    btn.innerHTML = PAUSE_ICON;
    btn.classList.remove('cvm-play--loading');
    _syncMiniPlayer();
  };

  if (waveEl) waveEl.classList.add('playing');

  audio.ontimeupdate = () => {
    const duration = audio.duration || total || 1;
    const pct = audio.currentTime / duration;
    const filled = Math.floor(pct * bars.length);
    bars.forEach((b, i) => b.classList.toggle('played', i < filled));
    if (durEl) durEl.textContent = fmtVoiceDur(audio.currentTime);
    _updateMiniPlayerProgress(pct);
  };

  audio.onended = () => {
    if (waveEl) waveEl.classList.remove('playing');
    btn.innerHTML = PLAY_ICON;
    bars.forEach(b => b.classList.remove('played'));
    if (durEl) durEl.textContent = fmtVoiceDur(total);
    _activeAudio = null;
    _activeBtn   = null;
    _syncMiniPlayer();
  };

  audio.onerror = (e) => {
    // Agar bu audio allaqachon boshqasi bilan almashtirilgan bo'lsa (masalan
    // foydalanuvchi tez orada boshqa xabarni bosgan) — bu "eski" audio
    // xatosi endi hech narsaga ta'sir qilmasligi kerak.
    if (_activeAudio !== audio) return;
    console.error('Audio xatosi:', e, 'URL:', url);
    toast('Audio yuklanmadi', 'error');
    btn.innerHTML = PLAY_ICON;
    _activeAudio = null;
    _activeBtn   = null;
    _syncMiniPlayer();
  };

  audio.play().catch(e => {
    // AbortError — play() so'rovi darhol keyingi pause()/boshqa xabar
    // bosilishi bilan bekor qilinganda tashlanadi. Bu KUTILGAN holat
    // (foydalanuvchi tez-tez xabarlar orasida almashganda) — xato emas,
    // shuning uchun toast ko'rsatmaymiz.
    if (e?.name === 'AbortError') return;
    if (_activeAudio !== audio) return;
    console.error('Audio play xatosi:', e, 'URL:', url);
    toast('Audio ijro etilmadi', 'error');
    btn.innerHTML = PLAY_ICON;
    _activeAudio = null;
    _activeBtn   = null;
    _syncMiniPlayer();
  });

  _syncMiniPlayer();
};

/* ── Voice mini-player — foydalanuvchi shu xabarning chatidan chiqib
 * ketsa (boshqa chatga o'tsa yoki thread'ni yopsa) ham, ovoz ijrosi
 * davom etadi (browser Audio elementi DOM'ga bog'liq emas — allaqachon
 * shunday ishlaydi). Bu funksiya faqat KO'RINADIGAN bar'ni — hozir
 * qaysi chat ochiqligiga qarab — ko'rsatish/yashirishni boshqaradi.
 * Telegram/WhatsApp'dagi "ovoz almashtirilgan chatda ham davom etadi"
 * funksiyasiga mos. */
function _isVoiceOwnerChatOpen() {
  const threadOpen = $('chatThreadModal')?.classList.contains('show');
  return !!(threadOpen && state.currentChatId && state.currentChatId === _activeChatId);
}

function _syncMiniPlayer() {
  const bar = $('voiceMiniPlayer');
  if (!bar) return;
  const shouldShow = !!_activeAudio && !_isVoiceOwnerChatOpen();
  if (!shouldShow) { bar.classList.remove('show'); return; }

  bar.classList.add('show');
  const titleEl = $('vmpTitle');
  if (titleEl) titleEl.textContent = _activeName || 'Ovozli xabar';
  const playBtn = $('vmpPlay');
  if (playBtn) playBtn.innerHTML = (_activeAudio && !_activeAudio.paused) ? PAUSE_ICON : PLAY_ICON;
}

function _updateMiniPlayerProgress(pct) {
  const fill = $('vmpFill');
  if (fill) fill.style.width = `${Math.max(0, Math.min(1, pct)) * 100}%`;
}

$('vmpPlay')?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!_activeAudio) return;
  if (_activeAudio.paused) _activeAudio.play().catch(() => {});
  else _activeAudio.pause();
  if (_activeBtn) _activeBtn.innerHTML = _activeAudio.paused ? PLAY_ICON : PAUSE_ICON;
  _syncMiniPlayer();
});

$('vmpClose')?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (_activeAudio) {
    _activeAudio.pause();
    _activeAudio.onended = null;
    _activeAudio.ontimeupdate = null;
    _activeAudio = null;
  }
  if (_activeBtn) { _activeBtn.innerHTML = PLAY_ICON; _activeBtn = null; }
  _activeChatId  = null;
  _activeChatUid = null;
  _syncMiniPlayer();
});

// Bar bosilganda — ovoz chiqayotgan chatga qaytamiz
$('voiceMiniPlayer')?.addEventListener('click', () => {
  if (_activeChatUid) openChatThread(_activeChatUid);
});

const PLAY_ICON  = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
const PAUSE_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
// Fayl hali yuklanayotganda (buferlanmoqda) ko'rsatiladigan aylanuvchi spinner —
// CSS animatsiyasi uchun .cvm-play--loading klassi (CSS/chat.css) bilan birga ishlaydi.
const LOADING_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" class="cvm-spin"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="42 14"/></svg>`;

/* ── Voice recording (tap-to-toggle) ──────────────────────────────────────
 * Mikrofon tugmasiga BITTA tap = yozish boshlanadi (ushlab turish shart
 * emas). Yozish paytida yana bitta tap = to'xtatadi va darhol yuboradi
 * (bkz. pastdagi 'click' listener). Gapirilayotganda tugma atrofida ovoz
 * balandligiga sezgir, silliq kengayadigan "pulse ring" ko'rinadi
 * (#cvPulse) — AnalyserNode + requestAnimationFrame + lerp. */
let _mediaRec    = null;
let _recChunks   = [];
let _recStartTs  = 0;
let _pulseCtx    = null;
let _pulseAnalyser = null;
let _pulseRaf    = null;
let _pulseLevel  = 0; // joriy (silliqlashtirilgan) ovoz darajasi, 0..1

function startRecording() {
  navigator.mediaDevices.getUserMedia({ audio: true })
    .then(stream => {
      _recChunks = [];
      _recStartTs = performance.now();

      const MIME_CANDIDATES = [
        'audio/webm;codecs=opus',
        'audio/ogg;codecs=opus',
        'audio/mp4',
        'audio/webm',
      ];
      const chosenMime = MIME_CANDIDATES.find(m => MediaRecorder.isTypeSupported?.(m));
      const opts = chosenMime ? { mimeType: chosenMime } : {};

      _mediaRec = new MediaRecorder(stream, opts);
      _mediaRec.ondataavailable = e => {
        if (e.data && e.data.size > 0) _recChunks.push(e.data);
      };
      _mediaRec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const duration = Math.round((performance.now() - _recStartTs) / 1000);
        if (!_recChunks.length) {
          toast('Ovoz yozilmadi, qayta urinib ko\'ring', 'error');
          return;
        }
        const mimeType = _mediaRec.mimeType || chosenMime || 'audio/webm';
        const blob = new Blob(_recChunks, { type: mimeType });
        sendVoiceMessage(blob, duration);
      };
      _mediaRec.start();

      _startPulse(stream);
    })
    .catch(err => {
      console.error('Mikrofon xatosi:', err);
      toast('Mikrofonga ruxsat berilmadi', 'error');
      $('chatVoiceBtn').classList.remove('active');
    });
}

function stopRecording() {
  if (_mediaRec && _mediaRec.state !== 'inactive') _mediaRec.stop();
  _stopPulse();
}

function cancelRecording() {
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
  _stopPulse();
}

/* ── Pulse ring: mikrofon tugmasi atrofida, ovoz balandligiga juda
 * sezgir, lerp bilan silliq kengayadigan/torayadigan doira. ── */
function _startPulse(stream) {
  const ring = $('cvPulse');
  if (!ring) return;
  try {
    _pulseCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = _pulseCtx.createMediaStreamSource(stream);
    const analyser = _pulseCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.25; // past — o'ta sezgir
    src.connect(analyser);
    _pulseAnalyser = analyser;

    const data = new Uint8Array(analyser.frequencyBinCount);
    const MIN_SCALE = 1, MAX_SCALE = 3.4;
    const MIN_OPAC  = 0.14, MAX_OPAC = 0.55;
    const LERP = 0.5; // kattaroq = tezroq/sezgirroq reaksiya

    const tick = () => {
      if (!_pulseAnalyser) return;
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const avg = sum / data.length / 255; // 0..1
      const target = Math.pow(avg, 0.5); // sqrt — past ovozlarni ham ko'taradi
      _pulseLevel += (target - _pulseLevel) * LERP;

      const scale = MIN_SCALE + _pulseLevel * (MAX_SCALE - MIN_SCALE);
      const opac  = MIN_OPAC + _pulseLevel * (MAX_OPAC - MIN_OPAC);
      ring.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(3)})`;
      ring.style.opacity   = opac.toFixed(3);

      _pulseRaf = requestAnimationFrame(tick);
    };
    tick();
  } catch (e) {
    console.warn('Pulse ring ishga tushmadi:', e?.message || e);
  }
}

function _stopPulse() {
  if (_pulseRaf) { cancelAnimationFrame(_pulseRaf); _pulseRaf = null; }
  if (_pulseCtx) { try { _pulseCtx.close(); } catch(_) {} _pulseCtx = null; }
  _pulseAnalyser = null;
  _pulseLevel = 0;
  const ring = $('cvPulse');
  if (ring) {
    ring.style.transform = 'translate(-50%, -50%) scale(1)';
    ring.style.opacity = '0';
  }
}

async function sendVoiceMessage(blob, duration) {
  if (!state.currentChatId || !state.me) return;
  const chatId   = state.currentChatId;
  const otherUid = state.currentChatUid;
  const isAiChat = otherUid === MRGRAM_AI_UID;

  // Pending message — loading bubble ko'rsatish
  const pendingId = 'pending_voice_' + Date.now();
  _showPendingBubble(pendingId, 'voice', blob.size);

  try {
    const ext = blob.type.includes('ogg') ? 'ogg' : 'webm';
    const file = new File([blob], `voice_${Date.now()}.${ext}`, { type: blob.type });

    // "MRgram AI" bilan suhbatda — ovozni Groq Whisper orqali matnga
    // o'giramiz (yuklash bilan PARALLEL, tezlik uchun). Boshqa (haqiqiy)
    // foydalanuvchilar bilan suhbatda transkripsiya shart emas — ortiqcha
    // Groq so'rovi yuborilmaydi.
    const uploadPromise = uploadViaControllerProgress(file, 'chat-voice', pct => {
      _updatePendingProgress(pendingId, pct);
    });
    const transcribePromise = isAiChat ? transcribeAudio(blob).catch(() => '') : Promise.resolve('');

    const [result, transcript] = await Promise.all([uploadPromise, transcribePromise]);

    _removePendingBubble(pendingId);

    await updateDoc(doc(db, 'chats', '_index', '1v1chat', chatId), {
      lastMessage:   'Ovozli xabar',
      lastSenderId:  state.me.uid,
      lastMessageAt: serverTimestamp(),
      [`unreadCount.${otherUid}`]: increment(1)
    });

    const voiceMsgDoc = {
      senderId:  state.me.uid,
      type:      'voice',
      mediaUrl:  result.url,
      mediaPath: result.path,
      storageIndex: result.storageIndex,
      duration,
      status:    'sent',
      createdAt: serverTimestamp(),
    };
    // Transkripsiya matnini ham (ko'rinmas holda) saqlaymiz — shu orqali
    // keyingi AI so'rovlarida suhbat tarixi ("history") bu ovozli xabarni
    // ham "eslay" oladi (paintMessages buni ko'rsatmaydi, faqat kontekst
    // uchun ishlatiladi — modules/chat.js `_triggerMrgramAiReply`ga q.).
    if (isAiChat && transcript) voiceMsgDoc.text = transcript;

    const userMsgRef = await addDoc(collection(db, 'chats', '_index', '1v1chat', chatId, 'messages'), voiceMsgDoc);

    if (isAiChat) {
      // userMsgRef.id — Groq'ga so'rov muvaffaqiyatli yetib borgach, shu
      // ovozli xabarni "o'qildi" (2 ptichka) qilib belgilash uchun kerak.
      _triggerMrgramAiVoiceReply(
        chatId,
        transcript || 'Foydalanuvchi menga ovozli xabar yubordi, lekin men uni tinglab matnga o\'gira olmadim. Iltimos undan buni qisqacha matn bilan yozib yuborishini so\'ra.',
        userMsgRef.id
      );
    }
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

export function updateVoiceSendBtn() {
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

    await updateDoc(doc(db, 'chats', '_index', '1v1chat', chatId), {
      lastMessage:   file.name,
      lastSenderId:  state.me.uid,
      lastMessageAt: serverTimestamp(),
      [`unreadCount.${otherUid}`]: increment(1)
    });

    const userMsgRef = await addDoc(collection(db, 'chats', '_index', '1v1chat', chatId, 'messages'), {
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

    if (otherUid === MRGRAM_AI_UID) {
      // "MRgram AI" rasmlarni ko'ra oladi (Groq vision model) — shu URL'ni
      // to'g'ridan-to'g'ri unga yuboramiz. Boshqa fayl turlari uchun hozircha
      // faqat fayl nomi/turi haqida kontekst beramiz.
      const isImage = (file.type || '').startsWith('image/');
      // userMsgRef.id — Groq'ga so'rov muvaffaqiyatli yetib borgach, shu
      // fayl/rasm xabarini "o'qildi" (2 ptichka) qilib belgilash uchun kerak.
      _triggerMrgramAiReply(
        chatId,
        isImage ? '' : `Foydalanuvchi "${file.name}" nomli (${file.type || 'noma\'lum turdagi'}) fayl yubordi. Bu faylni hozircha to'g'ridan-to'g'ri o'qiy olmayman (faqat rasmlarni ko'ra olaman) — foydalanuvchiga buni tabiiy tarzda ayt va agar mumkin bo'lsa matnini nusxalab yuborishni taklif qil.`,
        isImage ? result.url : null,
        userMsgRef.id
      );
    }
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

// Input text changes — toggle mic/send icon + "yozmoqda..." holatini yuborish
$('chatThreadInput').addEventListener('input', updateVoiceSendBtn);
$('chatThreadInput').addEventListener('input', _onChatInputTyping);
$('chatThreadInput').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendAction(); }
});

/* ── Composer emoji tugmasi — matn maydoni ichida chapda (Telegram
 * uslubi). Kompakt quick-picker: keng tarqalgan emojilardan iborat
 * ro'yxat, bosilganda kursor turgan joyga qo'shiladi. ── */
const CHAT_QUICK_EMOJIS = [
  '😀','😂','🥰','😍','😊','🙂','😉','😎','🤔','😴',
  '😭','😢','😡','🥳','😱','🤗','🙄','😅','🤝','👍',
  '👎','👏','🙏','💪','🔥','✨','🎉','❤️','💔','💯',
  '👌','✅','❌','⭐','☺️','😇','🤣','😘','😜','🤷',
];
(function _initChatEmojiQuickpick() {
  const btn  = $('chatEmojiBtn');
  const pop  = $('chatEmojiQuickpick');
  const inp  = $('chatThreadInput');
  if (!btn || !pop || !inp) return;

  if (!pop.childElementCount) {
    pop.innerHTML = CHAT_QUICK_EMOJIS
      .map(em => `<button type="button">${em}</button>`)
      .join('');
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    pop.classList.toggle('show');
  });

  pop.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const emoji = b.textContent;
    const start = inp.selectionStart ?? inp.value.length;
    const end   = inp.selectionEnd ?? inp.value.length;
    inp.value = inp.value.slice(0, start) + emoji + inp.value.slice(end);
    const caret = start + emoji.length;
    inp.focus();
    inp.setSelectionRange(caret, caret);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });

  document.addEventListener('click', (e) => {
    if (!pop.classList.contains('show')) return;
    if (e.target === btn || pop.contains(e.target)) return;
    pop.classList.remove('show');
  });
})();

// Mikrofon/yuborish tugmasi — bitta tugma, uch xil holat:
//  1) Matn/fayl bor bo'lsa — tap = yuborish.
//  2) Matn/fayl yo'q va hozir yozilmayotgan bo'lsa — tap = yozishni boshlash
//     (ushlab turish SHART EMAS).
//  3) Yozish paytida yana bir tap = to'xtatish va darhol yuborish.
$('chatVoiceBtn').addEventListener('click', () => {
  const btn = $('chatVoiceBtn');
  const hasText = $('chatThreadInput').value.trim().length > 0;
  const hasFile = !!_chatSelFile;

  if (hasText || hasFile) { handleSendAction(); return; }

  if (btn.classList.contains('active')) {
    // Ikkinchi tap — yozishni to'xtatish va yuborish
    btn.classList.remove('active');
    stopRecording();
  } else {
    // Birinchi tap — yozishni boshlash
    btn.classList.add('active');
    startRecording();
  }
});


// File attach
$('chatAttachBtn')?.addEventListener('click', () => $('chatFileInput')?.click());
$('chatFileInput')?.addEventListener('change', e => {
  const f = e.target.files?.[0];
  if (f) setChatFile(f);
});
$('cfpRemove')?.addEventListener('click', clearChatFile);

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

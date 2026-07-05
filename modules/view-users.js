/**
 * MRgram — Admin Foydalanuvchilar Panel
 * Faqat admin (uid === "cS9Riz2K4xgW1i4PVboWoQfhGok2") uchun
 */

import { db, auth, state } from './config.js';
import { $ } from './utils.js';
import { toast } from './toast.js';
import {
  collection, onSnapshot, doc, updateDoc, deleteDoc, getDocs,
  serverTimestamp, query, orderBy, where
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import {
  EmailAuthProvider, reauthenticateWithCredential
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

// Cache invalidation + feed refresh helper
async function _invalidateAndRefreshFeed(uid) {
  try {
    // User cache ni tozalaymiz
    if (state._userCache && uid) delete state._userCache[uid];
    // Feed ni qayta render qilamiz (agar home view da bo'lsa)
    if (state.view === 'home') {
      const { renderFeed } = await import('./feed.js');
      renderFeed();
    }
  } catch(_) {}
}

export const ADMIN_UID = 'cS9Riz2K4xgW1i4PVboWoQfhGok2'; // config.js dagi _ADMIN_UID bilan mos bo'lishi kerak

let _unsubUsers = null;
let _initialized = false;

/* ── Parol bilan ochish (har gal panel ochilganda qayta yopiq holatda
 * boshlanadi — admin hisobiga kirgan boshqa kishi parolni bilmasa
 * hech narsa ko'ra olmaydi, hatto username ham) ───────────────────────── */
let _unlocked = false;
let _lastUsers = [];
let _stats = {}; // uid -> { posts, views, likes, publicPosts, lastPostAt, chats, lastChatAt }
let _statsLoaded = false;

/* ── Modal state ────────────────────────────────────────────────────── */
let _pendingAction = null; // { type: 'delete'|'block'|'unblock', uid, name }

/* ── Admin panel blok countdown ─────────────────────────────────────── */
let _adminBlockTimers = {}; // uid -> intervalId

/* ── initView ───────────────────────────────────────────────────────── */
export function initView() {
  if (!state.me || state.me.uid !== ADMIN_UID) {
    const wrap = $('usersAdminList');
    if (wrap) wrap.innerHTML = '<p style="padding:24px;color:var(--text2)">Ruxsat yo\'q.</p>';
    return;
  }
  _unlocked = false; // panelga har kirishda qaytadan parol so'raladi
  _ensureModal();
  _ensurePasswordModal();
  // Har doim yangi onSnapshot ulaymiz — destroyView() uni to'xtatgan bo'lishi mumkin
  _initialized = true;
  _loadUsers();
}

/* ── Yagona modal (delete + block uchun) ────────────────────────────── */
function _ensureModal() {
  if ($('uaActionModal')) return;

  const modal = document.createElement('div');
  modal.id = 'uaActionModal';
  modal.className = 'ua-modal-overlay';
  modal.innerHTML = `
    <div class="ua-modal">
      <div class="ua-modal-icon" id="uaModalIcon"></div>
      <div class="ua-modal-title" id="uaModalTitle"></div>
      <div class="ua-modal-body" id="uaModalBody"></div>
      <div class="ua-modal-btns">
        <button class="ua-modal-cancel" id="uaModalCancel">Bekor qilish</button>
        <button class="ua-modal-confirm" id="uaModalConfirm">
          <span id="uaModalConfirmTxt"></span>
        </button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  $('uaModalCancel').addEventListener('click', _closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) _closeModal(); });
  $('uaModalConfirm').addEventListener('click', _confirmAction);
}

function _openDeleteModal(uid, name) {
  _pendingAction = { type: 'delete', uid, name };
  $('uaModalIcon').innerHTML     = _svgTrash();
  $('uaModalTitle').textContent  = "O'chiramizmi?";
  $('uaModalBody').innerHTML     = `<strong>${_esc(name)}</strong> ni ro'yxatdan butunlay o'chirasizmi?<br>
    <span class="ua-modal-warn">Diqqat, buni qaytarib bo'lmaydi!</span>`;
  $('uaModalConfirmTxt').textContent = "O'chirish";
  $('uaModalConfirm').className  = 'ua-modal-confirm ua-modal-confirm--danger';
  $('uaModalConfirm').disabled   = false;
  $('uaActionModal').classList.add('show');
}

function _openBlockModal(uid, name, isBlocked) {
  _pendingAction = { type: isBlocked ? 'unblock' : 'block', uid, name };
  if (isBlocked) {
    $('uaModalIcon').innerHTML    = _svgUnlock();
    $('uaModalTitle').textContent  = "Blokdan chiqaramizmi?";
    $('uaModalBody').innerHTML     = `<strong>${_esc(name)}</strong> ga qayta kirish ruxsati berilsinmi?`;
    $('uaModalConfirmTxt').textContent = "Blokdan chiqarish";
    $('uaModalConfirm').className  = 'ua-modal-confirm ua-modal-confirm--safe';
    // Vaqt inputini yashiramiz
    const tw = document.getElementById('uaBlockUntilWrap');
    if (tw) tw.style.display = 'none';
  } else {
    $('uaModalIcon').innerHTML    = _svgLock();
    $('uaModalTitle').textContent  = "Bloklaymizmi?";

    $('uaModalBody').innerHTML = `<strong>${_esc(name)}</strong> bloklansinmi?<br>
      <span class="ua-modal-warn">Muddatni belgilang (millisoniyagacha aniqlik bilan):</span>
      <div id="uaBlockUntilWrap" style="margin-top:12px;"></div>`;

    import('./duration-picker.js').then(({ createDurationPicker }) => {
      const wrap = document.getElementById('uaBlockUntilWrap');
      if (!wrap) return;
      const picker = createDurationPicker(wrap, { allowPermanent: true });
      wrap._picker = picker;
    });

    $('uaModalConfirmTxt').textContent = "Bloklash";
    $('uaModalConfirm').className  = 'ua-modal-confirm ua-modal-confirm--warn';
  }
  $('uaModalConfirm').disabled = false;
  $('uaActionModal').classList.add('show');
}

function _closeModal() {
  _pendingAction = null;
  const modal = $('uaActionModal');
  if (modal) modal.classList.remove('show');
}

async function _confirmAction() {
  if (!_pendingAction) return;
  const { type, uid, name } = _pendingAction;

  const confirmBtn = $('uaModalConfirm');
  const confirmTxt = $('uaModalConfirmTxt');
  confirmBtn.disabled = true;
  confirmTxt.textContent = '...';

  try {
    if (type === 'delete') {
      await deleteDoc(doc(db, 'users', uid));
      toast(`${name} o'chirildi`, 'success');
      await _invalidateAndRefreshFeed(uid);

    } else if (type === 'block') {
      // Advanced Duration Picker'dan aniq muddatni (ms) olamiz
      const untilWrap = document.getElementById('uaBlockUntilWrap');
      const picker = untilWrap?._picker;
      const selectedMs = picker ? picker.getMs() : 0;
      const untilData = {};
      let untilDate = null;
      if (selectedMs > 0) {
        untilDate = picker.getUntilDate();
        const { Timestamp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
        untilData.blockedUntil = Timestamp.fromDate(untilDate);
      } else {
        untilData.blockedUntil = null; // doimiy blok
      }
      await updateDoc(doc(db, 'users', uid), {
        blocked: true,
        blockedAt: serverTimestamp(),
        approved: false,
        ...untilData
      });
      const untilMsg = untilDate
        ? ` (${untilDate.toLocaleString('uz-UZ')} gacha)` : ' (doimiy)';
      toast(`${name} bloklandi${untilMsg}`, 'info');
      await _invalidateAndRefreshFeed(uid);

    } else if (type === 'unblock') {
      await updateDoc(doc(db, 'users', uid), {
        blocked: false,
        blockedAt: null,
        blockedUntil: null,
        approved: true
      });
      toast(`${name} blokdan chiqarildi `, 'success');
      await _invalidateAndRefreshFeed(uid);
    }
    _closeModal();
  } catch (err) {
    console.error('❌ Action error:', err);
    toast('Xatolik: ' + err.message, 'error');
    confirmBtn.disabled = false;
    confirmTxt.textContent = type === 'delete' ? "O'chirish" : type === 'block' ? 'Bloklash' : 'Blokdan chiqarish';
  }
}

/* ── Firestore listener ─────────────────────────────────────────────── */
function _loadUsers() {
  const wrap = $('usersAdminList');
  if (!wrap) return;

  wrap.innerHTML = '<div class="spin-wrap"><div class="spinner"></div></div>';
  if (_unsubUsers) { _unsubUsers(); _unsubUsers = null; }

  // orderBy('createdAt') ishlatmaymiz — serverTimestamp() pending paytida null bo'lib,
  // yangi userlar query da ko'rinmay qoladi. Client side sortlaymiz.
  const q = collection(db, 'users');
  _unsubUsers = onSnapshot(q, snap => {
    // Admin o'zini ro'yxatda ko'rmasligi uchun filtrlaymiz, keyin client da sortlaymiz
    const users = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(u => (u.uid || u.id) !== ADMIN_UID)
      .sort((a, b) => {
        const at = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
        const bt = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
        return bt - at; // yangi → eski
      });
    _lastUsers = users;
    _render(wrap, users);
  }, err => {
    wrap.innerHTML = `<p style="padding:24px;color:var(--red)">Xatolik: ${err.message}</p>`;
  });
}

/* ── Parol modal (admin o'zining joriy parolini qayta kiritadi) ──────── */
function _ensurePasswordModal() {
  if ($('uaPwdModal')) return;

  const modal = document.createElement('div');
  modal.id = 'uaPwdModal';
  modal.className = 'ua-modal-overlay';
  modal.innerHTML = `
    <div class="ua-modal">
      <div class="ua-modal-icon">${_svgKey()}</div>
      <div class="ua-modal-title">Maxfiy ma'lumotlar</div>
      <div class="ua-modal-body">
        Foydalanuvchilar ro'yxatini to'liq ko'rish va boshqarish uchun
        admin parolini qayta tasdiqlang.
        <input type="password" id="uaPwdInput" placeholder="Admin paroli"
          class="ua-pwd-input" autocomplete="current-password">
        <div id="uaPwdErr" class="ua-modal-warn" style="display:none"></div>
      </div>
      <div class="ua-modal-btns">
        <button class="ua-modal-cancel" id="uaPwdCancel">Bekor qilish</button>
        <button class="ua-modal-confirm" id="uaPwdConfirm">
          <span id="uaPwdConfirmTxt">Mayli</span>
        </button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const close = () => {
    modal.classList.remove('show');
    $('uaPwdInput').value = '';
    $('uaPwdErr').style.display = 'none';
    _pendingOpenUid  = null;
    _pendingOpenName = null;
  };

  $('uaPwdCancel').addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });

  const submit = async () => {
    const pwd = $('uaPwdInput').value;
    const errEl = $('uaPwdErr');
    const btn = $('uaPwdConfirm');
    const txt = $('uaPwdConfirmTxt');
    errEl.style.display = 'none';

    if (!pwd) {
      errEl.textContent = "Parolni kiriting";
      errEl.style.display = 'block';
      return;
    }
    if (!auth.currentUser || !auth.currentUser.email) {
      errEl.textContent = "Sessiya topilmadi, qayta kiring";
      errEl.style.display = 'block';
      return;
    }

    btn.disabled = true;
    txt.textContent = '...';
    try {
      const cred = EmailAuthProvider.credential(auth.currentUser.email, pwd);
      await reauthenticateWithCredential(auth.currentUser, cred);
      _unlocked = true;
      close();
      if (_pendingOpenUid) {
        const _uid = _pendingOpenUid;
        const _name = _pendingOpenName;
        _pendingOpenUid = null;
        _pendingOpenName = null;
        _render($('usersAdminList'), _lastUsers);
        _loadExtraStats();
        _ensureDetailModal();
        _openDetailModal(_uid, _name);
      } else {
        _render($('usersAdminList'), _lastUsers);
        _loadExtraStats();
        toast("Ma'lumotlar ochildi", 'success');
      }
    } catch (err) {
      errEl.textContent = (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential')
        ? "Parol noto'g'ri"
        : "Xatolik: " + err.message;
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false;
      txt.textContent = 'Mayli';
    }
  };

  $('uaPwdConfirm').addEventListener('click', submit);
  $('uaPwdInput')
}

function _openPasswordModal() {
  const modal = $('uaPwdModal');
  if (!modal) return;
  modal.classList.add('show');
  setTimeout(() => $('uaPwdInput')?.focus(), 50);
}

/* ── Postlar va chatlar bo'yicha qo'shimcha statistika ─────────────────
 * Faqat parol tasdiqlangandan keyin, bir martagina yuklanadi
 * (ko'p o'qishdan saqlanish uchun keshlanadi). ──────────────────────── */
async function _loadExtraStats() {
  if (_statsLoaded) { _render($('usersAdminList'), _lastUsers); return; }

  const wrap = $('usersAdminList');
  try {
    const [postsSnap, chatsSnap] = await Promise.all([
      getDocs(collection(db, 'posts')),
      getDocs(collection(db, 'chats')),
    ]);

    const stats = {};
    const ensure = uid => (stats[uid] ||= {
      posts: 0, views: 0, likes: 0, publicPosts: 0, lastPostAt: 0, chats: 0, lastChatAt: 0,
      postList: [], chatList: []
    });

    postsSnap.forEach(d => {
      const p = d.data();
      const uid = p.userId;
      if (!uid) return;
      const s = ensure(uid);
      s.posts++;
      s.views += p.views || 0;
      s.likes += p.likes || 0;
      if (p.isPublic) s.publicPosts++;
      const t = p.createdAt?.toMillis?.() || 0;
      if (t > s.lastPostAt) s.lastPostAt = t;
      s.postList.push({
        id: d.id, url: p.mediaUrl || '', text: p.text || '',
        isPublic: !!p.isPublic, views: p.views || 0, likes: p.likes || 0, at: t
      });
    });

    chatsSnap.forEach(d => {
      const c = d.data();
      const t = c.lastMessageAt?.toMillis?.() || 0;
      const parts = c.participants || [];
      parts.forEach(uid => {
        const s = ensure(uid);
        s.chats++;
        if (t > s.lastChatAt) s.lastChatAt = t;
        const otherUid = parts.find(p => p !== uid) || '';
        s.chatList.push({
          chatId: d.id, otherUid,
          lastMessage: c.lastMessage || '',
          lastSenderId: c.lastSenderId || '',
          at: t
        });
      });
    });

    Object.values(stats).forEach(s => {
      s.postList.sort((a,b) => b.at - a.at);
      s.chatList.sort((a,b) => b.at - a.at);
    });

    _stats = stats;
    _statsLoaded = true;
  } catch (err) {
    console.warn('[Admin] Stats yuklashda xato:', err.message);
  }
  _render(wrap, _lastUsers);
}

/* ── Foydalanuvchi bo'yicha "USER MALUMOTLARI" panel (3 tab) ──────────
 * Tablar: Ochiq malumotlar / Statuslar va yopiq malumotlar / Tarixlar.
 * Suhbatlar bo'limida faqat metama'lumot (oxirgi xabar preview'i) —
 * to'liq yozishma tarixi emas. ────────────────────────────────────── */
let _detailUid = null;
let _detailTab = 'info';
let _pendingOpenUid = null;
let _pendingOpenName = null;
let _loginHistoryCache = {}; // uid -> array | 'loading'

function _ensureDetailModal() {
  if ($('uaDetailModal')) return;
  const modal = document.createElement('div');
  modal.id = 'uaDetailModal';
  modal.className = 'ua-modal-overlay';
  modal.innerHTML = `
    <div class="ua-modal ua-detail-modal">
      <div class="ua-detail-head">
        <div class="ua-modal-title" style="margin:0">User malumotlari</div>
        <div class="ua-detail-avi" id="uaDetailAvi"></div>
      </div>
      <div class="ua-detail-tabs">
        <button class="ua-detail-tab" data-tab="info">Ochiq malumotlar</button>
        <button class="ua-detail-tab" data-tab="status">Statuslar va yopiq malumotlar</button>
        <button class="ua-detail-tab" data-tab="tarix">Tarixlar</button>
      </div>
      <div class="ua-detail-body" id="uaDetailBody"></div>
      <div class="ua-modal-btns">
        <button class="ua-modal-cancel" id="uaDetailClose">Yopish</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  $('uaDetailClose').addEventListener('click', () => modal.classList.remove('show'));
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('show'); });

  modal.querySelectorAll('.ua-detail-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      _detailTab = btn.dataset.tab;
      _renderDetailBody();
    });
  });
}

function _openDetailModal(uid, name) {
  _detailUid = uid;
  _detailTab = 'info';
  const u = _lastUsers.find(x => (x.uid || x.id) === uid) || {};
  const initials = (name || 'U').trim()[0]?.toUpperCase() || 'U';
  $('uaDetailAvi').innerHTML = u.avatar
    ? `<img src="${u.avatar}" alt="">`
    : initials;
  $('uaDetailModal').classList.add('show');
  _renderDetailBody();
}

async function _renderDetailBody() {
  const body = $('uaDetailBody');
  if (!body || !_detailUid) return;

  document.querySelectorAll('.ua-detail-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === _detailTab));

  const u = _lastUsers.find(x => (x.uid || x.id) === _detailUid) || {};
  const s = _stats[_detailUid] || { postList: [], chatList: [] };
  const row = (label, value) => `
    <div class="ua-field-row">
      <span class="ua-field-label">${_esc(label)}</span>
      <span class="ua-field-value">${value || '—'}</span>
    </div>`;

  /* ── Tab 1: Ochiq malumotlar ── */
  if (_detailTab === 'info') {
    body.innerHTML =
      row('Ism', _esc(u.fullName || u.username || '')) +
      row('Foydalanuvchi nomi', u.username ? '@' + _esc(u.username) : '') +
      row('To\'liq ism', _esc(u.fullName || '')) +
      row('UID', `<span style="font-size:12px;opacity:.7">${_esc(_detailUid)}</span>`) +
      row('Bio (tavsif)', u.bio ? _esc(u.bio) : '');

  /* ── Tab 2: Statuslar va yopiq malumotlar ── */
  } else if (_detailTab === 'status') {
    const approvedAt = u.approvedAt?.toDate ? u.approvedAt.toDate().toLocaleString('uz-UZ') : '';
    const blockedAt  = u.blockedAt?.toDate  ? u.blockedAt.toDate().toLocaleString('uz-UZ')  : '';
    const lastSeen   = u.lastSeenAt?.toDate ? u.lastSeenAt.toDate().toLocaleString('uz-UZ') : '';
    const lastLogin  = u.lastLoginAt?.toDate? u.lastLoginAt.toDate().toLocaleString('uz-UZ'): '';
    const followers  = Array.isArray(u.followers) ? u.followers.length : 0;
    const following  = Array.isArray(u.following) ? u.following.length : 0;
    const devices    = Array.isArray(u.fcmTokens) ? u.fcmTokens.length : 0;
    body.innerHTML =
      row('Holat', _statusBadge(u)) +
      row('Elektron pochta', u.email ? _esc(u.email) : '') +
      row('Ruxsat berilgan', approvedAt) +
      row('Bloklangan', blockedAt) +
      row('Obunachilar', String(followers)) +
      row('Obunalar', String(following)) +
      row('Qurilmalar (push)', String(devices)) +
      row('Oxirgi faollik', lastSeen) +
      row('Oxirgi login', lastLogin) +
      row('Platforma', u.lastPlatform ? _esc(u.lastPlatform) : '') +
      (u.lastUserAgent ? `<div class="ua-field-row"><span class="ua-field-label">User agent</span>
        <span class="ua-field-value" style="font-size:11px;word-break:break-all;opacity:.75">${_esc(u.lastUserAgent)}</span></div>` : '');

  /* ── Tab 3: Tarixlar (login tarixi + postlar + suhbatlar) ── */
  } else if (_detailTab === 'tarix') {
    body.innerHTML = '<div class="spin-wrap"><div class="spinner"></div></div>';

    let entries = _loginHistoryCache[_detailUid];
    if (!entries || entries === 'loading') {
      _loginHistoryCache[_detailUid] = 'loading';
      try {
        const snap = await getDocs(
          query(collection(db, 'users', _detailUid, 'loginHistory'), orderBy('at', 'desc'))
        );
        entries = snap.docs.map(d => d.data());
        _loginHistoryCache[_detailUid] = entries;
      } catch (err) {
        entries = [];
      }
    }
    if (_detailTab !== 'tarix') return; // tab almashtirilgan bo'lsa eski natijani chizmaymiz

    const pub  = s.postList.filter(p => p.isPublic);
    const priv = s.postList.filter(p => !p.isPublic);
    const postRow = p => `
      <a class="ua-post-link" href="${p.url || '#'}" target="_blank" rel="noopener">
        ${p.url ? 'Media' : 'Link yo\'q'}${p.text ? ' — ' + _esc(p.text.slice(0,40)) : ''}
        <span class="ua-date" style="display:block">
          ${p.views} ko'rish · ${p.likes} like ${p.at ? '· ' + new Date(p.at).toLocaleString('uz-UZ') : ''}
        </span>
      </a>`;
    const chatRows = (s.chatList || []).map(c => {
      const other = _lastUsers.find(x => (x.uid || x.id) === c.otherUid);
      const otherName = other ? (other.fullName || other.username || c.otherUid) : (c.otherUid || 'Noma\'lum');
      return `
      <div class="ua-detail-row">
        <div><strong>${_esc(otherName)}</strong> bilan suhbat</div>
        <div class="ua-date">${_esc((c.lastMessage||'').slice(0,80) || '(media/bo\'sh)')}
          ${c.at ? '· ' + new Date(c.at).toLocaleString('uz-UZ') : ''}</div>
      </div>`;
    }).join('');

    body.innerHTML = `
      <div class="ua-detail-section">
        <div class="ua-detail-section-title">Kirish tarixi (${entries.length})</div>
        ${entries.length ? entries.map(h => `
          <div class="ua-detail-row">
            <div>${h.type === 'login' ? 'Login (parol bilan)' : 'Sessiya tiklandi'}
              — ${h.at?.toDate ? h.at.toDate().toLocaleString('uz-UZ') : ''}</div>
            ${h.platform ? `<div class="ua-date">${_esc(h.platform)}</div>` : ''}
          </div>`).join('') : '<p class="ua-empty">Tarix yo\'q (eski foydalanuvchi)</p>'}
      </div>
      <div class="ua-detail-section">
        <div class="ua-detail-section-title">Ochiq postlar (${pub.length})</div>
        ${pub.length ? pub.map(postRow).join('') : '<p class="ua-empty">Yo\'q</p>'}
      </div>
      <div class="ua-detail-section">
        <div class="ua-detail-section-title">Yopiq (private) postlar (${priv.length})</div>
        ${priv.length ? priv.map(postRow).join('') : '<p class="ua-empty">Yo\'q</p>'}
      </div>
      <div class="ua-detail-section">
        <div class="ua-detail-section-title">Suhbatlar (${(s.chatList||[]).length})</div>
        ${chatRows || '<p class="ua-empty">Suhbat yo\'q</p>'}
      </div>`;
  }
}

/* ── Helpers ────────────────────────────────────────────────────────── */
function _statusBadge(user) {
  if (user.blocked === true)
    return `<span class="ua-badge ua-badge--blocked">Bloklangan</span>`;
  const a = user.approved;
  if (a === true)       return `<span class="ua-badge ua-badge--approved">Ruxsat berilgan</span>`;
  if (a === false)      return `<span class="ua-badge ua-badge--pending">Kutilmoqda</span>`;
  if (a === 'rejected') return `<span class="ua-badge ua-badge--rejected">Rad etilgan</span>`;
  return `<span class="ua-badge ua-badge--legacy">Eski foydalanuvchi</span>`;
}

function _approveBtn(user) {
  if (user.blocked) return '';
  const a = user.approved;
  if (a === true || a === undefined) return '';
  return `<button class="ua-approve-btn" data-uid="${user.uid||user.id}">Ruxsat berish</button>`;
}

function _rejectBtn(user) {
  if (user.blocked) return '';
  const a = user.approved;
  if (a === 'rejected' || a === true || a === undefined) return '';
  return `<button class="ua-reject-btn" data-uid="${user.uid||user.id}">Rad etish</button>`;
}

/* ── Render ─────────────────────────────────────────────────────────── */
function _render(wrap, users) {
  if (!users.length) {
    wrap.innerHTML = '<p style="padding:24px;color:var(--text2)">Foydalanuvchilar yo\'q.</p>';
    return;
  }

  if (!_unlocked) {
    /* ── Yopiq holat: ism + pending badge ko'rinadi, boshqa ma'lumot yashirin ── */
    wrap.innerHTML = `
      <div class="ua-locked-banner">
        To'liq ma'lumot va boshqaruv tugmalari berkitilgan.
        <button id="uaUnlockBtn" class="ua-unlock-banner-btn">Parol bilan ochish</button>
      </div>` + users.map(u => {
        const name = u.fullName || u.username || u.uid || u.id;
        const isPending = u.approved === false;
        const isRejected = u.approved === 'rejected';
        const badgeHtml = isPending
          ? `<span class="ua-badge ua-badge--pending" style="margin-left:8px">⏳ Kutilmoqda</span>`
          : isRejected
          ? `<span class="ua-badge ua-badge--rejected" style="margin-left:8px">❌ Rad etildi</span>`
          : '';
        return `
        <div class="ua-row ua-row--locked" data-uid="${u.uid || u.id}">
          <div class="ua-avi">
            ${u.avatar
              ? `<img src="${u.avatar}" alt="" class="ua-avi-img ua-avi-img--blurred">`
              : `<div class="ua-avi-placeholder">${(name[0]||'U').toUpperCase()}</div>`}
          </div>
          <div class="ua-info">
            <div class="ua-name">${_esc(name)}${badgeHtml}</div>
          </div>
        </div>`;
      }).join('');

    wrap.querySelectorAll('.ua-row--locked').forEach(row => {
      row.addEventListener('click', () => {
        _pendingOpenUid  = row.dataset.uid;
        _pendingOpenName = (row.querySelector('.ua-name')?.textContent || '').trim();
        _openPasswordModal();
      });
    });
    $('uaUnlockBtn')?.addEventListener('click', e => {
      e.stopPropagation();
      _pendingOpenUid  = null;
      _pendingOpenName = null;
      _openPasswordModal();
    });
    return;
  }

  wrap.innerHTML = (!_statsLoaded
    ? `<div class="ua-locked-banner">Postlar/chatlar statistikasi yuklanmoqda...</div>`
    : '') + users.map(u => {
    const name      = u.fullName || u.username || u.uid || u.id;
    const uname     = u.username ? `@${u.username}` : '';
    const uid       = u.uid || u.id;
    const isBlocked = u.blocked === true;
    const created   = u.createdAt?.toDate
      ? u.createdAt.toDate().toLocaleString('uz-UZ') : '';
    const blockedAt = u.blockedAt?.toDate
      ? u.blockedAt.toDate().toLocaleString('uz-UZ') : '';
    const blockedUntil = u.blockedUntil?.toDate
      ? u.blockedUntil.toDate().toLocaleString('uz-UZ') : '';
    const approvedAt = u.approvedAt?.toDate
      ? u.approvedAt.toDate().toLocaleString('uz-UZ') : '';
    const followers  = Array.isArray(u.followers) ? u.followers.length : 0;
    const following  = Array.isArray(u.following) ? u.following.length : 0;
    const devices    = Array.isArray(u.fcmTokens) ? u.fcmTokens.length : 0;
    const lastSeen   = u.lastSeenAt?.toDate
      ? u.lastSeenAt.toDate().toLocaleString('uz-UZ') : '';
    const lastLogin  = u.lastLoginAt?.toDate
      ? u.lastLoginAt.toDate().toLocaleString('uz-UZ') : '';
    const ua         = u.lastUserAgent || '';
    const platform   = u.lastPlatform || '';
    const s          = _stats[uid] || {};
    const lastPostAt  = s.lastPostAt  ? new Date(s.lastPostAt).toLocaleString('uz-UZ')  : '';
    const lastChatAt  = s.lastChatAt  ? new Date(s.lastChatAt).toLocaleString('uz-UZ')  : '';

    const blockBtnLabel = isBlocked ? 'Blokdan chiqarish' : 'Bloklash';
    const blockBtnClass = isBlocked ? 'ua-unblock-btn' : 'ua-block-btn';
    const blockedUntilMs = u.blockedUntil?.toMillis ? u.blockedUntil.toMillis() : (u.blockedUntil ? Number(u.blockedUntil) : 0);

    return `
    <div class="ua-row${isBlocked ? ' ua-row--blocked' : ''}" data-uid="${uid}">
      <div class="ua-avi">
        ${u.avatar
          ? `<img src="${u.avatar}" alt="" class="ua-avi-img">`
          : `<div class="ua-avi-placeholder">${(name[0]||'U').toUpperCase()}</div>`}
        
      </div>
      <div class="ua-info">
        <div class="ua-name">${_esc(name)}</div>
        ${uname   ? `<div class="ua-uname">${_esc(uname)}</div>` : ''}
        ${u.email ? `<div class="ua-uname">${_esc(u.email)}</div>` : ''}
        <div class="ua-uname">${_esc(uid)}</div>
        ${created ? `<div class="ua-date">Ro'yxat: ${created}</div>` : ''}
        ${approvedAt ? `<div class="ua-date">Ruxsat: ${approvedAt}</div>` : ''}
        ${blockedAt ? `<div class="ua-date ua-date--blocked">Bloklangan: ${blockedAt}</div>` : ''}
        ${blockedUntil ? `<div class="ua-date ua-date--blocked">Blok tugashi: ${blockedUntil}</div>` : ''}
        <div class="ua-date">${followers} obunachi · ${following} obuna · ${devices} qurilma</div>
        ${_statsLoaded ? `<div class="ua-date">${s.posts||0} post (${s.publicPosts||0} ochiq) · ${s.views||0} ko'rish · ${s.likes||0} like</div>` : ''}
        ${_statsLoaded ? `<div class="ua-date">${s.chats||0} suhbat${lastChatAt ? ' · oxirgi yozishma: ' + lastChatAt : ''}</div>` : ''}
        ${lastPostAt ? `<div class="ua-date">Oxirgi post: ${lastPostAt}</div>` : ''}
        ${lastSeen ? `<div class="ua-date">Oxirgi faollik: ${lastSeen}</div>` : ''}
        ${lastLogin ? `<div class="ua-date">Oxirgi login: ${lastLogin}</div>` : ''}
        ${platform ? `<div class="ua-date">Platforma: ${_esc(platform)}</div>` : ''}
        ${ua ? `<div class="ua-date" style="word-break:break-all;font-size:11px;opacity:.75">${_esc(ua)}</div>` : ''}
        ${u.bio ? `<div class="ua-date">${_esc(u.bio)}</div>` : ''}
        <div class="ua-status">${_statusBadge(u)}</div>
      </div>
      <div class="ua-actions">
        ${_approveBtn(u)}
        ${_rejectBtn(u)}
        <button class="ua-history-btn" data-uid="${uid}" data-name="${_esc(name)}">Malumotlar</button>
        <button class="${blockBtnClass}" data-uid="${uid}" data-name="${_esc(name)}" data-blocked="${isBlocked}" data-blocked-until-ms="${blockedUntilMs}">
          ${blockBtnLabel}
        </button>
      </div>
      <button class="ua-delete-btn" data-uid="${uid}" data-name="${_esc(name)}" title="O'chirish">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
        </svg>
      </button>
    </div>`;
  }).join('');

  /* Approve */
  wrap.querySelectorAll('.ua-approve-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const uid = btn.dataset.uid;
      btn.disabled = true; btn.textContent = '...';
      try {
        await updateDoc(doc(db, 'users', uid), { approved: true, approvedAt: serverTimestamp() });
        toast('Ruxsat berildi ', 'success');
        await _invalidateAndRefreshFeed(uid);
      } catch (err) {
        toast('Xatolik: ' + err.message, 'error');
        btn.disabled = false; btn.textContent = 'Ruxsat berish';
      }
    });
  });

  /* Reject */
  wrap.querySelectorAll('.ua-reject-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const uid = btn.dataset.uid;
      btn.disabled = true; btn.textContent = '...';
      try {
        await updateDoc(doc(db, 'users', uid), { approved: 'rejected' });
        toast('Rad etildi', 'info');
        await _invalidateAndRefreshFeed(uid);
      } catch (err) {
        toast('Xatolik: ' + err.message, 'error');
        btn.disabled = false; btn.textContent = 'Rad etish';
      }
    });
  });

  /* Block / Unblock */
  wrap.querySelectorAll('.ua-block-btn, .ua-unblock-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const isBlocked = btn.dataset.blocked === 'true';
      _openBlockModal(btn.dataset.uid, btn.dataset.name, isBlocked);
    });
  });

  /* Admin panel — vaqtli blok countdownlari */
  _clearAllAdminTimers();
  wrap.querySelectorAll('.ua-unblock-btn[data-blocked-until-ms]').forEach(btn => {
    const uid = btn.dataset.uid;
    const untilMs = Number(btn.dataset.blockedUntilMs);
    if (!untilMs || untilMs <= 0) return;
    _startAdminBlockCountdown(btn, uid, untilMs);
  });

  /* To'liq tarix */
  wrap.querySelectorAll('.ua-history-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      _ensureDetailModal();
      _openDetailModal(btn.dataset.uid, btn.dataset.name);
    });
  });

  /* Delete */
  wrap.querySelectorAll('.ua-delete-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      _openDeleteModal(btn.dataset.uid, btn.dataset.name);
    });
  });
}

/* ── Admin panel blok countdown yordamchilari ───────────────────────── */
function _clearAllAdminTimers() {
  Object.values(_adminBlockTimers).forEach(id => clearInterval(id));
  _adminBlockTimers = {};
}

function _fmtCountdown(ms) {
  if (ms <= 0) return '0s';
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (d > 0) return `${d}k ${h}s ${m}m`;
  if (h > 0) return `${h}s ${m}m ${s}sec`;
  if (m > 0) return `${m}m ${s}sec`;
  return `${s}sec`;
}

function _startAdminBlockCountdown(btn, uid, untilMs) {
  // Darhol ko'rsatamiz
  const update = () => {
    const remaining = untilMs - Date.now();
    if (remaining <= 0) {
      // Vaqt tugadi — Firestore da unblock, tugmani qizilga o'zgartir
      clearInterval(_adminBlockTimers[uid]);
      delete _adminBlockTimers[uid];
      // Firestore ni yangilaymiz
      updateDoc(doc(db, 'users', uid), {
        blocked: false,
        blockedAt: null,
        blockedUntil: null,
        approved: true
      }).catch(() => {});
      // Tugmani darhol o'zgartiramiz
      btn.className = 'ua-block-btn';
      btn.textContent = 'Bloklash';
      btn.dataset.blocked = 'false';
      btn.dataset.blockedUntilMs = '0';
      // Row dan blocked klassini olamiz
      const row = btn.closest('.ua-row');
      if (row) row.classList.remove('ua-row--blocked');
      return;
    }
    btn.textContent = _fmtCountdown(remaining);
  };
  update();
  _adminBlockTimers[uid] = setInterval(update, 1000);
}

function _svgTrash() {
  return `<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="color:var(--red)">
    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
    <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
  </svg>`;
}
function _svgLock() {
  return `<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="color:var(--amber)">
    <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
  </svg>`;
}
function _svgUnlock() {
  return `<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="color:var(--green)">
    <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>
  </svg>`;
}
function _svgKey() {
  return `<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="color:var(--blue)">
    <circle cx="7.5" cy="15.5" r="5.5"/><path d="M21 2l-9.6 9.6"/><path d="M15.5 7.5l3 3"/><path d="M19 4l1.5 1.5"/>
  </svg>`;
}

function _esc(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function destroyView() {
  if (_unsubUsers) { _unsubUsers(); _unsubUsers = null; }
  _clearAllAdminTimers();
  _initialized = false;
  _unlocked = false;
  _statsLoaded = false;
  _stats = {};
}

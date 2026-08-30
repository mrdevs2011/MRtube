/**
 * MRgram — Admin AI Ishlatilish Statistikasi
 * ─────────────────────────────────────────────────────────────────────────
 * Faqat sayt admini uchun. Ma'lumotlar 100% SERVER tomonidan yoziladi
 * (api/groq-chat.js, Firebase Admin SDK orqali) — shuning uchun client
 * tomonidan soxtalashtirib bo'lmaydi va foydalanuvchi ilovani yopib
 * qo'yishi statistikani yo'qotmaydi.
 *
 * Ko'rsatadi:
 *   1) Umumiy ko'rsatkichlar (bugungi/jami token, so'rovlar, faol kalitlar)
 *   2) Kunlik token sarfi trendi — chiziqli grafik (matn vs rasm)
 *   3) Har bir Groq kaliti bo'yicha statistika — jadval + ustunli grafik,
 *      "qaysi kalit qachon oxirgi marta ishlatilgani" bilan
 *   4) Har bir foydalanuvchi bo'yicha token sarfi — qidiruvli jadval
 *   5) So'nggi AI so'rovlar oqimi (real-vaqt) — kim, qachon, qaysi kalit,
 *      qaysi model, qancha token
 *
 * Firestore manbalari (barchasi faqat admin o'qiy oladi — firestore.rules):
 *   aiUsageKeyStats/{keyId}, aiUsageUserStats/{uid},
 *   aiUsageDaily/{yyyy-mm-dd}, aiUsageLogs/{id}
 */

import { db, state } from './config.js';
import { ADMIN_UID } from './view-users.js';
import { $, esc, fmt, defAvi } from './utils.js';
import {
  collection, query, orderBy, limit, onSnapshot, getDoc, doc, documentId
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

let _keyUnsub = null, _userUnsub = null, _dailyUnsub = null, _logUnsub = null;
let _keyStats = {}, _userStats = {}, _dailyStats = {}, _logs = [];
let _userNameCache = {};
let _rootEl = null;
let _userSearchTerm = '';

/* ── CSS ─────────────────────────────────────────────────────────────── */
function _injectCSS() {
  if (document.getElementById('aiu-css')) return;
  const s = document.createElement('style');
  s.id = 'aiu-css';
  s.textContent = `
#aiUsageSection { padding: 0 16px 24px; }
.aiu-cards {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(120px,1fr));
  gap: 8px; margin-bottom: 16px;
}
.aiu-card {
  background: var(--bg2); border: 1px solid var(--line); border-radius: 12px;
  padding: 12px 14px;
}
.aiu-card-label { font-size: 11px; color: var(--text3); font-weight: 600; letter-spacing: .02em; }
.aiu-card-value { font-size: 19px; font-weight: 700; color: var(--text); margin-top: 4px; font-variant-numeric: tabular-nums; }
.aiu-card-sub { font-size: 10.5px; color: var(--text3); margin-top: 2px; }

.aiu-section-title {
  font-size: 13px; font-weight: 700; color: var(--text); margin: 20px 0 10px;
  display: flex; align-items: center; gap: 6px;
}
.aiu-section-title svg { width: 15px; height: 15px; color: var(--accent,#a78bfa); }

.aiu-chart-wrap {
  background: var(--bg2); border: 1px solid var(--line); border-radius: 14px;
  padding: 14px; overflow: hidden;
}
.aiu-legend { display: flex; gap: 14px; margin-bottom: 8px; font-size: 11px; color: var(--text2); }
.aiu-legend-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; }
.aiu-chart-svg { width: 100%; height: 150px; display: block; }
.aiu-chart-empty { text-align: center; color: var(--text3); font-size: 12.5px; padding: 30px 0; }

.aiu-key-grid { display: flex; flex-direction: column; gap: 8px; }
.aiu-key-card {
  background: var(--bg2); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px;
}
.aiu-key-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.aiu-key-name { font-size: 13px; font-weight: 700; color: var(--text); display: flex; align-items: center; gap: 6px; }
.aiu-key-dot { width: 7px; height: 7px; border-radius: 50%; background: #4b5563; flex-shrink: 0; }
.aiu-key-dot.active { background: #4ade80; box-shadow: 0 0 5px rgba(74,222,128,.9); }
.aiu-key-total { font-size: 13px; font-weight: 700; color: var(--accent,#a78bfa); font-variant-numeric: tabular-nums; }
.aiu-key-bar-track { height: 6px; border-radius: 4px; background: var(--bg3); margin: 8px 0 6px; overflow: hidden; }
.aiu-key-bar-fill { height: 100%; border-radius: 4px; background: #a78bfa; }
.aiu-key-meta { display: flex; flex-wrap: wrap; gap: 10px; font-size: 11px; color: var(--text3); }
.aiu-key-meta b { color: var(--text2); font-weight: 600; }

.aiu-search { width: 100%; margin-bottom: 10px; }
.aiu-search input {
  width: 100%; background: var(--bg3); border: 1px solid var(--line2); border-radius: 8px;
  color: var(--text); font-family: var(--font); font-size: 12.5px; padding: 8px 11px; outline: none;
}
.aiu-user-table { background: var(--bg2); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
.aiu-user-row {
  display: flex; align-items: center; gap: 10px; padding: 9px 12px;
  border-top: 1px solid var(--line);
}
.aiu-user-row:first-child { border-top: none; }
.aiu-user-avi { width: 30px; height: 30px; border-radius: 50%; overflow: hidden; flex-shrink: 0; background: var(--bg3); }
.aiu-user-avi img { width: 100%; height: 100%; object-fit: cover; }
.aiu-user-info { flex: 1; min-width: 0; }
.aiu-user-name { font-size: 12.5px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.aiu-user-sub { font-size: 10.5px; color: var(--text3); margin-top: 1px; }
.aiu-user-total { font-size: 12.5px; font-weight: 700; color: var(--text); text-align: right; font-variant-numeric: tabular-nums; }
.aiu-user-rank { font-size: 10.5px; color: var(--text3); width: 18px; text-align: center; flex-shrink: 0; }

.aiu-log-list { display: flex; flex-direction: column; gap: 6px; max-height: 340px; overflow-y: auto; }
.aiu-log-row {
  display: flex; align-items: center; gap: 8px; padding: 8px 11px;
  background: var(--bg2); border: 1px solid var(--line); border-radius: 10px; font-size: 11.5px;
}
.aiu-log-kind {
  flex-shrink: 0; font-size: 9.5px; font-weight: 700; padding: 2px 7px; border-radius: 20px;
  text-transform: uppercase; letter-spacing: .02em;
}
.aiu-log-kind.text   { background: rgba(59,130,246,.15); color: #60a5fa; }
.aiu-log-kind.vision { background: rgba(167,139,250,.15); color: #a78bfa; }
.aiu-log-user { flex: 1; min-width: 0; color: var(--text2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.aiu-log-key { flex-shrink: 0; color: var(--text3); font-size: 10.5px; }
.aiu-log-tok { flex-shrink: 0; font-weight: 700; color: var(--text); font-variant-numeric: tabular-nums; }
.aiu-log-time { flex-shrink: 0; color: var(--text3); font-size: 10.5px; width: 74px; text-align: right; }

.aiu-empty { text-align: center; color: var(--text3); font-size: 12.5px; padding: 20px 0; }
`;
  document.head.appendChild(s);
}

/* ── helpers ─────────────────────────────────────────────────────────── */
function _n(v) { return (v || 0).toLocaleString('uz-UZ'); }

function _dayKey(d) { return d.toISOString().slice(0, 10); }

function _last14Days() {
  const out = [];
  const now = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(_dayKey(d));
  }
  return out;
}

async function _resolveUserName(uid) {
  if (!uid) return { fullName: "O'chirilgan", avatar: null };
  if (_userNameCache[uid]) return _userNameCache[uid];
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    const info = snap.exists()
      ? { fullName: snap.data().fullName || 'Foydalanuvchi', avatar: snap.data().avatar || null }
      : { fullName: "O'chirilgan foydalanuvchi", avatar: null };
    _userNameCache[uid] = info;
    return info;
  } catch {
    return { fullName: 'Foydalanuvchi', avatar: null };
  }
}

/* ── Chart: kunlik trend (matn vs rasm) ─────────────────────────────── */
function _renderTrendChart() {
  const days = _last14Days();
  const rows = days.map(k => _dailyStats[k] || {});
  const textVals   = rows.map(r => r.textTokens   || 0);
  const visionVals = rows.map(r => r.visionTokens || 0);
  const maxVal = Math.max(1, ...textVals, ...visionVals);

  const W = 600, H = 150, padL = 6, padR = 6, padT = 10, padB = 20;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const n = days.length;
  const stepX = n > 1 ? innerW / (n - 1) : 0;

  const toXY = (vals, i) => {
    const x = padL + stepX * i;
    const y = padT + innerH - (vals[i] / maxVal) * innerH;
    return [x, y];
  };
  const pathFor = (vals) => vals.map((_, i) => {
    const [x, y] = toXY(vals, i);
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const hasAny = textVals.some(v => v > 0) || visionVals.some(v => v > 0);
  if (!hasAny) {
    return `<div class="aiu-chart-empty">Hali hech qanday AI so'rov qayd etilmagan</div>`;
  }

  const firstLbl = days[0].slice(5);
  const lastLbl  = days[n - 1].slice(5);

  return `
    <div class="aiu-legend">
      <span><span class="aiu-legend-dot" style="background:#60a5fa"></span>Matn</span>
      <span><span class="aiu-legend-dot" style="background:#a78bfa"></span>Rasm/video</span>
    </div>
    <svg class="aiu-chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <line x1="${padL}" y1="${padT+innerH}" x2="${W-padR}" y2="${padT+innerH}" stroke="var(--line,#333)" stroke-width="1"/>
      <path d="${pathFor(textVals)}" fill="none" stroke="#60a5fa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${pathFor(visionVals)}" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="${padL}" y="${H-4}" font-size="9" fill="var(--text3,#888)">${esc(firstLbl)}</text>
      <text x="${W-padR}" y="${H-4}" font-size="9" fill="var(--text3,#888)" text-anchor="end">${esc(lastLbl)}</text>
    </svg>
  `;
}

/* ── Cards ───────────────────────────────────────────────────────────── */
function _renderCards() {
  const today = _dayKey(new Date());
  const todayStat = _dailyStats[today] || {};
  const keyIds = Object.keys(_keyStats);
  const now = Date.now();
  const ACTIVE_WINDOW_MS = 5 * 60 * 1000;
  const activeKeys = keyIds.filter(id => {
    const t = _keyStats[id].lastUsedAt?.toMillis ? _keyStats[id].lastUsedAt.toMillis() : 0;
    return t && (now - t) < ACTIVE_WINDOW_MS;
  });
  const totalAll = keyIds.reduce((sum, id) => sum + (_keyStats[id].totalTokens || 0), 0);
  const reqAll   = keyIds.reduce((sum, id) => sum + (_keyStats[id].requests || 0), 0);

  return `
    <div class="aiu-cards">
      <div class="aiu-card">
        <div class="aiu-card-label">Bugungi token</div>
        <div class="aiu-card-value">${_n(todayStat.totalTokens)}</div>
        <div class="aiu-card-sub">${_n(todayStat.requests)} so'rov</div>
      </div>
      <div class="aiu-card">
        <div class="aiu-card-label">Jami token</div>
        <div class="aiu-card-value">${_n(totalAll)}</div>
        <div class="aiu-card-sub">${_n(reqAll)} so'rov</div>
      </div>
      <div class="aiu-card">
        <div class="aiu-card-label">Kalitlar</div>
        <div class="aiu-card-value">${keyIds.length}</div>
        <div class="aiu-card-sub">${activeKeys.length} ta faol (5 daq)</div>
      </div>
      <div class="aiu-card">
        <div class="aiu-card-label">Foydalanuvchilar</div>
        <div class="aiu-card-value">${Object.keys(_userStats).length}</div>
        <div class="aiu-card-sub">AI ishlatgan</div>
      </div>
    </div>
  `;
}

/* ── Kalitlar bo'yicha ───────────────────────────────────────────────── */
async function _renderKeySection() {
  const ids = Object.keys(_keyStats);
  if (!ids.length) return `<div class="aiu-empty">Hali hech qanday kalit ishlatilmagan</div>`;

  const maxTotal = Math.max(1, ...ids.map(id => _keyStats[id].totalTokens || 0));
  const now = Date.now();
  const ACTIVE_WINDOW_MS = 5 * 60 * 1000;

  const sorted = ids.sort((a, b) => (_keyStats[b].totalTokens || 0) - (_keyStats[a].totalTokens || 0));

  const cards = await Promise.all(sorted.map(async id => {
    const k = _keyStats[id];
    const pct = Math.round(((k.totalTokens || 0) / maxTotal) * 100);
    const lastMs = k.lastUsedAt?.toMillis ? k.lastUsedAt.toMillis() : 0;
    const isActive = lastMs && (now - lastMs) < ACTIVE_WINDOW_MS;
    const lastUserInfo = k.lastUserId ? await _resolveUserName(k.lastUserId) : null;
    const lastUsedStr = k.lastUsedAt ? fmt(k.lastUsedAt) : "hali ishlatilmagan";

    return `
      <div class="aiu-key-card">
        <div class="aiu-key-top">
          <div class="aiu-key-name"><span class="aiu-key-dot ${isActive ? 'active' : ''}"></span>${esc(id)}</div>
          <div class="aiu-key-total">${_n(k.totalTokens)} token</div>
        </div>
        <div class="aiu-key-bar-track"><div class="aiu-key-bar-fill" style="width:${pct}%"></div></div>
        <div class="aiu-key-meta">
          <span><b>${_n(k.requests)}</b> so'rov</span>
          <span>kirish <b>${_n(k.promptTokens)}</b> / chiqish <b>${_n(k.completionTokens)}</b></span>
          <span>oxirgi model: <b>${esc(k.lastModel || '—')}</b></span>
          <span>oxirgi: <b>${esc(lastUsedStr)}</b></span>
          ${lastUserInfo ? `<span>kim: <b>${esc(lastUserInfo.fullName)}</b></span>` : ''}
        </div>
      </div>
    `;
  }));

  return `<div class="aiu-key-grid">${cards.join('')}</div>`;
}

/* ── Foydalanuvchilar bo'yicha ───────────────────────────────────────── */
async function _renderUserSection() {
  const ids = Object.keys(_userStats);
  if (!ids.length) return `<div class="aiu-empty">Hali hech kim AI ishlatmagan</div>`;

  const sorted = ids.sort((a, b) => (_userStats[b].totalTokens || 0) - (_userStats[a].totalTokens || 0));

  const infos = await Promise.all(sorted.map(uid => _resolveUserName(uid)));

  const rows = sorted
    .map((uid, i) => ({ uid, info: infos[i], stat: _userStats[uid], rank: i + 1 }))
    .filter(r => !_userSearchTerm || r.info.fullName.toLowerCase().includes(_userSearchTerm));

  if (!rows.length) return `<div class="aiu-empty">Hech narsa topilmadi</div>`;

  return rows.map(r => {
    const av = r.info.avatar || defAvi(r.info.fullName);
    const lastStr = r.stat.lastUsedAt ? fmt(r.stat.lastUsedAt) : '';
    return `
      <div class="aiu-user-row">
        <div class="aiu-user-rank">${r.rank}</div>
        <div class="aiu-user-avi"><img src="${av}" onerror="this.style.display='none'"></div>
        <div class="aiu-user-info">
          <div class="aiu-user-name">${esc(r.info.fullName)}</div>
          <div class="aiu-user-sub">${_n(r.stat.requests)} so'rov · oxirgi: ${esc(lastStr)} · ${esc(r.stat.lastModel || '')}</div>
        </div>
        <div class="aiu-user-total">${_n(r.stat.totalTokens)}</div>
      </div>
    `;
  }).join('');
}

/* ── So'nggi faoliyat oqimi ──────────────────────────────────────────── */
async function _renderLogSection() {
  if (!_logs.length) return `<div class="aiu-empty">Hali hech qanday so'rov qayd etilmagan</div>`;

  const rows = await Promise.all(_logs.map(async l => {
    const info = await _resolveUserName(l.userId);
    const timeStr = l.createdAt ? fmt(l.createdAt) : '';
    return `
      <div class="aiu-log-row">
        <span class="aiu-log-kind ${l.kind === 'vision' ? 'vision' : 'text'}">${l.kind === 'vision' ? 'rasm' : 'matn'}</span>
        <span class="aiu-log-user">${esc(info.fullName)}</span>
        <span class="aiu-log-key">${esc(l.keyId || '—')}</span>
        <span class="aiu-log-tok">${_n(l.totalTokens)}</span>
        <span class="aiu-log-time">${esc(timeStr)}</span>
      </div>
    `;
  }));

  return `<div class="aiu-log-list">${rows.join('')}</div>`;
}

/* ── Full render ─────────────────────────────────────────────────────── */
async function _renderAll() {
  if (!_rootEl) return;

  _rootEl.innerHTML = `
    ${_renderCards()}

    <div class="aiu-section-title">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></svg>
      Kunlik token sarfi (oxirgi 14 kun)
    </div>
    <div class="aiu-chart-wrap">${_renderTrendChart()}</div>

    <div class="aiu-section-title">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="7" height="10" rx="1"/><rect x="14" y="3" width="7" height="18" rx="1"/></svg>
      Groq kalitlari bo'yicha
    </div>
    <div id="aiuKeySection"><div class="aiu-empty">Yuklanmoqda…</div></div>

    <div class="aiu-section-title">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
      Foydalanuvchilar bo'yicha (token sarfi)
    </div>
    <div class="aiu-search"><input type="text" id="aiuUserSearch" placeholder="Foydalanuvchi qidirish..." value="${esc(_userSearchTerm)}"></div>
    <div class="aiu-user-table" id="aiuUserSection"><div class="aiu-empty">Yuklanmoqda…</div></div>

    <div class="aiu-section-title">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="9"/></svg>
      So'nggi faoliyat (real-vaqt)
    </div>
    <div id="aiuLogSection"><div class="aiu-empty">Yuklanmoqda…</div></div>
  `;

  const searchInp = _rootEl.querySelector('#aiuUserSearch');
  if (searchInp) {
    searchInp.addEventListener('input', async (e) => {
      _userSearchTerm = e.target.value.trim().toLowerCase();
      const sec = _rootEl.querySelector('#aiuUserSection');
      if (sec) sec.innerHTML = await _renderUserSection();
    });
  }

  const keySec = _rootEl.querySelector('#aiuKeySection');
  if (keySec) keySec.innerHTML = await _renderKeySection();

  const userSec = _rootEl.querySelector('#aiuUserSection');
  if (userSec) userSec.innerHTML = await _renderUserSection();

  const logSec = _rootEl.querySelector('#aiuLogSection');
  if (logSec) logSec.innerHTML = await _renderLogSection();
}

let _renderQueued = false;
function _scheduleRender() {
  // Bir nechta onSnapshot deyarli bir vaqtda kelishi mumkin — barchasini
  // bitta microtask'da birlashtirib, keraksiz qayta-qayta render'ning
  // oldini olamiz.
  if (_renderQueued) return;
  _renderQueued = true;
  Promise.resolve().then(() => { _renderQueued = false; _renderAll(); });
}

/* ── initView / destroyView ─────────────────────────────────────────── */
export async function initView(containerEl) {
  if (!state.me || state.me.uid !== ADMIN_UID) return;
  _injectCSS();

  _rootEl = containerEl || $('actionsAiUsageSection');
  if (!_rootEl) return;
  _rootEl.id = _rootEl.id || 'aiUsageSection';
  _rootEl.innerHTML = `<div class="aiu-empty">Yuklanmoqda…</div>`;

  destroyView(); // eski listenerlarni tozalash (qayta ochilganda)

  _keyUnsub = onSnapshot(collection(db, 'AI', '_stats', 'keyStats'), snap => {
    _keyStats = {};
    snap.docs.forEach(d => { _keyStats[d.id] = d.data(); });
    _scheduleRender();
  }, err => console.warn('[AI Usage] keyStats xato:', err.message));

  _userUnsub = onSnapshot(collection(db, 'AI', '_stats', 'userStats'), snap => {
    _userStats = {};
    snap.docs.forEach(d => { _userStats[d.id] = d.data(); });
    _scheduleRender();
  }, err => console.warn('[AI Usage] userStats xato:', err.message));

  _dailyUnsub = onSnapshot(
    query(collection(db, 'AI', '_stats', 'daily'), orderBy(documentId(), 'desc'), limit(60)),
    snap => {
      _dailyStats = {};
      snap.docs.forEach(d => { _dailyStats[d.id] = d.data(); });
      _scheduleRender();
    },
    err => console.warn('[AI Usage] daily xato:', err.message)
  );

  _logUnsub = onSnapshot(
    query(collection(db, 'AI', '_stats', 'logs'), orderBy('createdAt', 'desc'), limit(50)),
    snap => {
      _logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      _scheduleRender();
    },
    err => console.warn('[AI Usage] logs xato:', err.message)
  );
}

export function destroyView() {
  if (_keyUnsub)   { _keyUnsub();   _keyUnsub   = null; }
  if (_userUnsub)  { _userUnsub();  _userUnsub  = null; }
  if (_dailyUnsub) { _dailyUnsub(); _dailyUnsub = null; }
  if (_logUnsub)   { _logUnsub();   _logUnsub   = null; }
}

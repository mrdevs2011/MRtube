/**
 * MRgram — Admin Actions Panel
 * Statistika, Foydalanuvchilar va Broadcast birlashtirilgan panel
 * Faqat admin (ADMIN_UID) uchun
 */

import { state, getMediaUrl } from './config.js';
import { db } from './config.js';
import { ADMIN_UID } from './view-users.js';
import { toast } from './toast.js';
import { esc } from './utils.js';
import { initAuditLog, destroyAuditLog, logAdminAction } from './admin-audit.js';
import { initDashboardSummary, destroyDashboardSummary } from './dashboard-summary.js';
import {
  doc, setDoc, deleteDoc, updateDoc, onSnapshot, serverTimestamp,
  collection, query, where, orderBy, limit, getDocs, addDoc
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

let _initialized = false;
let _noticeUnsub    = null;
let _bcHistoryUnsub = null;
let _aiModUnsub     = null;
let _aiTasksUnsub   = null;

/* ── CSS ── */
function _injectCSS() {
  if (document.getElementById('actions-view-css')) return;
  const s = document.createElement('style');
  s.id = 'actions-view-css';
  s.textContent = `
#actionsView { background: var(--bg); }

.actions-divider {
  display: flex; align-items: center; gap: 10px;
  padding: 20px 16px 10px; margin-top: 4px;
}
.actions-divider::before, .actions-divider::after {
  content: ''; flex: 1; height: 1px; background: var(--line);
}
.actions-divider-label {
  font-size: 12px; font-weight: 700; color: var(--text2);
  letter-spacing: 0.3px; white-space: nowrap; padding: 0 4px;
}

/* ── Broadcast UI ── */
.bc-wrap {
  margin: 0 16px 8px;
  background: var(--bg2);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.bc-row {
  display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
}
.bc-input {
  flex: 1; min-width: 0;
  background: var(--bg3);
  border: 1px solid var(--line2);
  border-radius: 8px;
  color: var(--text);
  font-family: var(--font);
  font-size: 13px;
  padding: 9px 12px;
  outline: none;
  transition: border-color 0.15s;
}
.bc-input:focus { border-color: var(--blue); }
.bc-input::placeholder { color: var(--text3); }
.bc-select {
  background: var(--bg3);
  border: 1px solid var(--line2);
  border-radius: 8px;
  color: var(--text2);
  font-family: var(--font);
  font-size: 12px;
  padding: 9px 10px;
  outline: none;
  cursor: pointer;
}
.bc-send-btn {
  display: flex; align-items: center; gap: 6px;
  background: var(--blue);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-family: var(--font);
  font-size: 13px;
  font-weight: 600;
  padding: 9px 16px;
  cursor: pointer;
  transition: opacity 0.15s;
  white-space: nowrap;
}
.bc-send-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.bc-send-btn svg { width: 15px; height: 15px; flex-shrink: 0; }
.bc-result {
  font-size: 12px;
  color: var(--text3);
  min-height: 16px;
}
.bc-result.ok  { color: var(--green); }
.bc-result.err { color: var(--red); }

/* ── AI Moderatsiya UI ── */
.aimod-wrap {
  margin: 0 16px 8px;
  display: flex; flex-direction: column; gap: 10px;
}
.aimod-empty {
  background: var(--bg2);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 18px 16px;
  text-align: center;
  color: var(--text3);
  font-size: 13px;
}
.aimod-card {
  background: var(--bg2);
  border: 1px solid color-mix(in srgb, var(--red,#ef4444) 30%, var(--line));
  border-radius: 14px;
  padding: 14px;
  display: flex; flex-direction: column; gap: 8px;
}
.aimod-card-top {
  display: flex; align-items: flex-start; gap: 10px;
}
.aimod-thumb {
  width: 56px; height: 56px; border-radius: 10px; object-fit: cover;
  flex-shrink: 0; background: var(--bg3);
}
.aimod-info { flex: 1; min-width: 0; }
.aimod-author { font-size: 13px; font-weight: 700; color: var(--text); }
.aimod-caption { font-size: 12.5px; color: var(--text2); margin-top: 2px; word-break: break-word; }
.aimod-reason {
  font-size: 12px; color: var(--red,#ef4444); font-weight: 600;
  background: color-mix(in srgb, var(--red,#ef4444) 10%, transparent);
  border-radius: 8px; padding: 6px 9px; margin-top: 4px;
}
.aimod-meta { font-size: 11px; color: var(--text3); margin-top: 2px; }
.aimod-restore-btn {
  align-self: flex-start;
  display: flex; align-items: center; gap: 6px;
  background: var(--blue); color: #fff; border: none;
  border-radius: 8px; font-family: var(--font); font-size: 12.5px; font-weight: 600;
  padding: 7px 14px; cursor: pointer; transition: opacity 0.15s;
}
.aimod-restore-btn:hover { opacity: 0.85; }
.aimod-restore-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.aimod-stats-bar {
  margin: 0 16px 10px;
  display: flex; flex-wrap: wrap; gap: 8px 16px;
  background: var(--bg2);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 10px 14px;
  font-size: 12px;
  color: var(--text2);
}
.aimod-stats-loading { color: var(--text3); }
.aimod-stat b { color: var(--text); font-size: 13px; }
.aimod-stat--fp b { color: var(--red,#ef4444); }

.aimod-btn-row { display: flex; gap: 8px; flex-wrap: wrap; }
.aimod-block-btn {
  align-self: flex-start;
  display: flex; align-items: center; gap: 6px;
  background: color-mix(in srgb, var(--red,#ef4444) 15%, transparent);
  color: var(--red,#ef4444);
  border: 1px solid color-mix(in srgb, var(--red,#ef4444) 35%, transparent);
  border-radius: 8px; font-family: var(--font); font-size: 12.5px; font-weight: 600;
  padding: 7px 14px; cursor: pointer; transition: opacity 0.15s;
}
.aimod-block-btn:hover { opacity: 0.8; }
.aimod-block-btn:disabled { opacity: 0.5; cursor: not-allowed; }
`;
  document.head.appendChild(s);
}

/* ── initView ── */
export async function initView() {
  if (!state.me || state.me.uid !== ADMIN_UID) return;
  _injectCSS();

  _initDashboardSummary();
  _initAuditLog();
  _initAiModeration();
  _initAiBlockedUsers();
  _initAdminTasks();
  _initBroadcast();
  await _initStats();
  await _initAiUsage();
  await _initUsers();

  _initialized = true;
}

/* ── Dashboard Summary: tezkor umumiy ko'rinish ── */
function _initDashboardSummary() {
  if (!document.getElementById('actionsDashboardSection')) return;
  initDashboardSummary('actionsDashboardSection');
}

/* ── Audit Log: "So'nggi amallar" ── */
function _initAuditLog() {
  let section = document.getElementById('actionsAuditSection');
  if (!section) {
    // HTML da yo'q bo'lsa ham ishlashi uchun dinamik yaratamiz (usersAdminList dan oldin)
    section = document.createElement('div');
    section.id = 'actionsAuditSection';
    const hdr = document.querySelector('.users-admin-hdr');
    if (hdr && hdr.parentElement) {
      const divider = document.createElement('div');
      divider.className = 'actions-divider';
      divider.innerHTML = '<span class="actions-divider-label">So\'nggi amallar</span>';
      hdr.parentElement.insertBefore(divider, hdr);
      hdr.parentElement.insertBefore(section, hdr);
    } else {
      document.getElementById('actionsView')?.prepend(section);
    }
  }
  initAuditLog('actionsAuditSection');
}

/* ── AI Moderatsiya: AI tomonidan yashirilgan postlar ro'yxati ── */
async function _initAiModeration() {
  const section = document.getElementById('actionsAiModSection');
  if (!section) return;

  section.innerHTML = `
    <div id="aimodStatsBar" class="aimod-stats-bar"><span class="aimod-stats-loading">Statistika yuklanmoqda…</span></div>
    <div class="aimod-wrap" id="aimodWrap"><div class="aimod-empty">Yuklanmoqda…</div></div>`;
  const wrap = document.getElementById('aimodWrap');

  _loadAiModStats();

  if (_aiModUnsub) { _aiModUnsub(); _aiModUnsub = null; }

  const q = query(collection(db, 'posts'), where('aiHidden', '==', true));

  _aiModUnsub = onSnapshot(q, async (snap) => {
    const docs = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const at = a.aiFlaggedAt?.toMillis ? a.aiFlaggedAt.toMillis() : 0;
        const bt = b.aiFlaggedAt?.toMillis ? b.aiFlaggedAt.toMillis() : 0;
        return bt - at;
      });

    if (!docs.length) {
      wrap.innerHTML = `<div class="aimod-empty">AI hozircha hech qanday postni yashirmagan</div>`;
      return;
    }

    wrap.innerHTML = '<div class="aimod-empty">Yuklanmoqda…</div>';

    // Barcha postlar uchun mediaUrl ni resolve qilamiz
    const resolvedDocs = await Promise.all(docs.map(async p => {
      if (!p.mediaUrl && (p.mediaPath || p.storageIndex)) {
        try { p = { ...p, mediaUrl: await getMediaUrl(p) }; } catch {}
      }
      return p;
    }));

    wrap.innerHTML = resolvedDocs.map(p => {
      const thumbSrc = p.mediaUrl || '';
      const dt = p.aiFlaggedAt?.toDate ? p.aiFlaggedAt.toDate().toLocaleString('uz-UZ') : '';
      return `
        <div class="aimod-card" data-postid="${p.id}">
          <div class="aimod-card-top">
            ${thumbSrc ? `<img class="aimod-thumb" src="${thumbSrc}" loading="lazy" onerror="this.style.display='none'">` : ''}
            <div class="aimod-info">
              <div class="aimod-author">${esc(p.userFullName || 'Foydalanuvchi')}</div>
              ${p.text ? `<div class="aimod-caption">${esc(p.text)}</div>` : ''}
              <div class="aimod-reason"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg> ${esc(p.aiReason || 'AI tomonidan nomaqul deb topildi')}</div>
              <div class="aimod-meta">${dt}</div>
            </div>
          </div>
          <div class="aimod-btn-row">
            <button class="aimod-restore-btn" data-restore="${p.id}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
              Postni qaytarish
            </button>
            <button class="aimod-block-btn" data-blockpost="${p.id}" data-uid="${p.userId || ''}" data-name="${esc(p.userFullName || 'Foydalanuvchi')}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
              Bloklash
            </button>
          </div>
        </div>`;
    }).join('');

    wrap.querySelectorAll('[data-restore]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const postId = btn.dataset.restore;
        btn.disabled = true;
        btn.textContent = 'Qaytarilmoqda…';
        try {
          await updateDoc(doc(db, 'posts', postId), {
            aiHidden: false,
            aiApproved: true, // AI bu postni qaytib tekshirmasin
            aiRestoredAt: serverTimestamp(),
            aiRestoredBy: state.me.uid,
          });
          toast('Post qaytarildi — AI uni qaytib o\'chirmaydi', 'success');
          logAdminAction({
            action: 'postRestore',
            targetUid: null,
            targetName: '',
            details: `Post ID: ${postId}`,
          });
        } catch (err) {
          toast('Xatolik: ' + err.message, 'error');
          btn.disabled = false;
          btn.innerHTML = 'Postni qaytarish';
        }
      });
    });

    wrap.querySelectorAll('[data-blockpost]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const postId = btn.dataset.blockpost;
        const uid    = btn.dataset.uid;
        const name   = btn.dataset.name || uid;
        if (!uid) { toast('Foydalanuvchi UID topilmadi', 'error'); return; }
        if (!confirm(`${name} ushbu post uchun bloklansinmi? (doimiy blok)`)) return;
        btn.disabled = true;
        btn.textContent = 'Bloklanmoqda…';
        try {
          await updateDoc(doc(db, 'users', uid), {
            blocked:      true,
            blockedAt:    serverTimestamp(),
            blockedUntil: null,
            approved:     false,
          });
          toast(`${name} bloklandi`, 'info');
          logAdminAction({
            action: 'postBlockUser',
            targetUid: uid,
            targetName: name,
            details: `Post ID: ${postId}`,
          });
        } catch (err) {
          toast('Xatolik: ' + err.message, 'error');
          btn.disabled = false;
          btn.innerHTML = 'Bloklash';
        }
      });
    });
  }, (err) => {
    wrap.innerHTML = `<div class="aimod-empty">Xatolik: ${esc(err.message)}</div>`;
  });
}

/* ── AI Moderatsiya aniqlik statistikasi (false-positive) ──
 * Bir martalik hisoblash: nechta post AI tomonidan flag qilingan,
 * nechtasi admin tomonidan qaytarilgan (false-positive), nechtasi
 * hozir ham yashirilgan holatda. ── */
async function _loadAiModStats() {
  const bar = document.getElementById('aimodStatsBar');
  if (!bar) return;
  try {
    const snap = await getDocs(collection(db, 'posts'));
    let totalFlagged = 0, restored = 0, stillHidden = 0;
    snap.forEach(d => {
      const p = d.data();
      if (p.aiFlaggedAt) totalFlagged++;
      if (p.aiRestoredAt) restored++;
      if (p.aiHidden === true) stillHidden++;
    });
    const fpRate = totalFlagged ? Math.round((restored / totalFlagged) * 100) : 0;
    bar.innerHTML = `
      <span class="aimod-stat"><b>${totalFlagged}</b> jami flag qilingan</span>
      <span class="aimod-stat"><b>${stillHidden}</b> hozir yashirilgan</span>
      <span class="aimod-stat aimod-stat--fp"><b>${restored}</b> qaytarilgan (${fpRate}% false-positive)</span>
    `;
  } catch (err) {
    bar.innerHTML = `<span class="aimod-stats-loading">Statistika: xatolik — ${esc(err.message)}</span>`;
  }
}

/* ── Admin Tasks: AI tomonidan yuborilgan bloklash topshiriqlari ── */
function _initAdminTasks() {
  if (_aiTasksUnsub) { _aiTasksUnsub(); _aiTasksUnsub = null; }

  const q = query(
    collection(db, 'ADMIN', '_index', 'adminTasks'),
    where('type',  '==', 'autoBlock'),
    where('done',  '==', false)
  );

  _aiTasksUnsub = onSnapshot(q, async (snap) => {
    for (const taskDoc of snap.docs) {
      const task = taskDoc.data();
      if (!task.uid) continue;
      try {
        // Admin nomidan bloklash
        await updateDoc(doc(db, 'users', task.uid), {
          blocked:        true,
          aiAutoBlocked:  true,
          aiBlockedAt:    new Date().toISOString(),
          aiBlockReason:  task.reason || 'AI tomonidan avtomatik bloklash',
          aiBlockCount:   task.count || 6,
          aiPendingBlock: false,
        });
        // Taskni bajarildi deb belgilaymiz
        await updateDoc(doc(db, 'ADMIN', '_index', 'adminTasks', taskDoc.id), {
          done:       true,
          doneAt:     new Date().toISOString(),
          doneBy:     'auto',
        });
        console.log('[AdminTask] AutoBlock bajarildi:', task.uid);
        logAdminAction({
          action: 'aiAutoBlock',
          targetUid: task.uid,
          targetName: task.userName || task.uid,
          details: task.reason || '',
        });
      } catch (err) {
        console.warn('[AdminTask] Xato:', err.message);
      }
    }
  });
}

/* ── AI Tomonidan Bloklangan Foydalanuvchilar ── */
let _aiBlockedUnsub = null;
function _initAiBlockedUsers() {
  // Dynamically create section if not in HTML
  let section = document.getElementById('actionsAiBlockedSection');
  if (!section) {
    section = document.createElement('div');
    section.id = 'actionsAiBlockedSection';
    section.className = 'aimod-wrap';
    // Insert before broadcast section
    const broadcastSection = document.getElementById('actionsBroadcastSection');
    if (broadcastSection) {
      const parent = broadcastSection.parentElement;
      parent?.insertBefore(section, broadcastSection);
    } else {
      document.querySelector('.actions-content, main, #actionsAiModSection')?.after(section);
    }
  }

  section.innerHTML = `
    <h3 style="margin:18px 0 10px;font-size:1rem;font-weight:700;color:var(--red,#ef4444);display:flex;align-items:center;gap:8px;">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
      AI tomonidan bloklangan foydalanuvchilar
    </h3>
    <div id="aiBlockedWrap"><div class="aimod-empty">Yuklanmoqda…</div></div>`;

  const wrap = document.getElementById('aiBlockedWrap');
  if (!wrap) return;

  if (_aiBlockedUnsub) { _aiBlockedUnsub(); _aiBlockedUnsub = null; }

  const q = query(
    collection(db, 'users'),
    where('aiAutoBlocked', '==', true)
  );

  _aiBlockedUnsub = onSnapshot(q, (snap) => {
    const users = snap.docs
      .map(d => ({ uid: d.id, ...d.data() }))
      .sort((a, b) => (b.aiBlockedAt || '').localeCompare(a.aiBlockedAt || ''));

    if (!users.length) {
      wrap.innerHTML = `<div class="aimod-empty">AI hozircha hech kimni bloklashenmagan</div>`;
      return;
    }

    wrap.innerHTML = users.map(u => {
      const violCount = (u.aiViolations || []).length;
      const blockedAt = u.aiBlockedAt ? new Date(u.aiBlockedAt).toLocaleString('uz-UZ') : '';
      const sources = (u.aiViolations || []).map(v => v.source).filter(Boolean);
      const hasChatViol = sources.includes('chat');
      const hasFileViol = sources.includes('file');
      const hasPostViol = sources.includes('post');
      return `
        <div class="aimod-card" data-uid="${u.uid}" style="border-left:3px solid var(--red,#ef4444)">
          <div class="aimod-card-top">
            <img class="aimod-thumb" src="${u.avatar || ''}" style="width:44px;height:44px;border-radius:50%;object-fit:cover;" onerror="this.style.display='none'">
            <div class="aimod-info">
              <div class="aimod-author" style="font-weight:700">${esc(u.fullName || u.email || u.uid)}</div>
              <div class="aimod-meta" style="color:var(--red,#ef4444);font-weight:600">
                🚫 ${violCount} ta qoidabuzarlik
                ${hasPostViol ? '<span style="margin-left:6px;background:#fef2f2;color:#b91c1c;padding:1px 6px;border-radius:4px;font-size:11px">Post</span>' : ''}
                ${hasChatViol ? '<span style="margin-left:4px;background:#fff7ed;color:#c2410c;padding:1px 6px;border-radius:4px;font-size:11px">Chat</span>' : ''}
                ${hasFileViol ? '<span style="margin-left:4px;background:#f0fdf4;color:#15803d;padding:1px 6px;border-radius:4px;font-size:11px">Fayl</span>' : ''}
              </div>
              <div class="aimod-reason" style="margin-top:4px">${esc(u.aiBlockReason || '')}</div>
              <div class="aimod-meta" style="margin-top:4px;opacity:.6">Bloklangan: ${blockedAt}</div>
              <details style="margin-top:6px;font-size:12px">
                <summary style="cursor:pointer;color:var(--blue,#3b82f6)">Barcha qoidabuzarliklarni ko'rish (${violCount})</summary>
                <div style="margin-top:6px;display:flex;flex-direction:column;gap:4px">
                  ${(u.aiViolations || []).slice(-10).reverse().map((v, i) => `
                    <div style="background:#f9fafb;border-radius:6px;padding:6px 8px;font-size:11px">
                      <span style="opacity:.6">${new Date(v.at).toLocaleString('uz-UZ')} · ${v.source || 'post'}</span><br>
                      ${esc(v.reason || '')}
                    </div>`).join('')}
                </div>
              </details>
            </div>
          </div>
          <div style="display:flex;gap:8px;margin-top:8px">
            <button class="aimod-restore-btn" data-unblock="${u.uid}" style="background:var(--green,#22c55e);color:#fff">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              Blokdan chiqarish + 0 ga tushirish
            </button>
            <button class="aimod-restore-btn" data-clearviolations="${u.uid}" style="background:#6b7280;color:#fff;font-size:12px">
              Qoidabuzarliklarni tozalash
            </button>
          </div>
        </div>`;
    }).join('');

    // Unblock + full AI memory reset
    wrap.querySelectorAll('[data-unblock]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid = btn.dataset.unblock;
        if (!confirm('Blokdan chiqarib, AI xotirasini (barcha qoidabuzarliklarni) tozalash?')) return;
        btn.disabled = true; btn.textContent = 'Qayta yoqilmoqda…';
        try {
          await updateDoc(doc(db, 'users', uid), {
            blocked:        false,
            aiAutoBlocked:  false,
            aiViolations:   [],
            aiBlockReason:  '',
            aiBlockCount:   0,
            aiBlockedAt:    '',
            aiUnblockedAt:  serverTimestamp(),
            aiUnblockedBy:  state.me.uid,
          });
          toast('✅ Foydalanuvchi blokdan chiqarildi va AI xotirasi tozalandi (0 dan boshlaydi)', 'success', 6000);
          {
            const u2 = users.find(x => x.uid === uid);
            logAdminAction({
              action: 'aiUnblock',
              targetUid: uid,
              targetName: u2?.fullName || u2?.email || uid,
              details: 'AI xotirasi to\'liq tozalandi',
            });
          }
        } catch (err) {
          toast('Xatolik: ' + err.message, 'error');
          btn.disabled = false; btn.textContent = 'Blokdan chiqarish';
        }
      });
    });

    // Clear violations only (keep user unblocked but wipe history)
    wrap.querySelectorAll('[data-clearviolations]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid = btn.dataset.clearviolations;
        if (!confirm('Faqat qoidabuzarliklar tarixini o\'chirish (bloklash saqlanadi)?')) return;
        btn.disabled = true; btn.textContent = 'Tozalanmoqda…';
        try {
          await updateDoc(doc(db, 'users', uid), {
            aiViolations:  [],
            aiAutoBlocked: false,
            aiBlockCount:  0,
            blocked:       false,
          });
          toast('Qoidabuzarliklar tarixi tozalandi', 'success');
          {
            const u2 = users.find(x => x.uid === uid);
            logAdminAction({
              action: 'aiClearViolations',
              targetUid: uid,
              targetName: u2?.fullName || u2?.email || uid,
            });
          }
        } catch (err) {
          toast('Xatolik: ' + err.message, 'error');
          btn.disabled = false; btn.textContent = 'Qoidabuzarliklarni tozalash';
        }
      });
    });
  }, (err) => {
    wrap.innerHTML = `<div class="aimod-empty">Xatolik: ${esc(err.message)}</div>`;
  });
}

/* ── Broadcast / Admin Notice ── */
function _initBroadcast() {
  const section = document.getElementById('actionsBroadcastSection');
  if (!section || section.dataset.ready) return;
  section.dataset.ready = '1';

  section.innerHTML = `
    <div class="bc-wrap">
      <div class="bc-row">
        <textarea class="bc-input bc-textarea" id="bcBody" placeholder="Xabar matni… (maslan: Bugun vaqtim yo'q, ertaga ochib qo'yaman)" maxlength="300" rows="3"></textarea>
      </div>
      <div class="bc-row">
        <select class="bc-select" id="bcTarget">
          <option value="all">Barchaga (chat + kutayotganlar)</option>
          <option value="approved">Faqat tasdiqlanganlarga (chat)</option>
          <option value="pending">Faqat kutayotganlarga (ularning ekranida)</option>
        </select>
        <button class="bc-send-btn" id="bcSendBtn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
          E'lon qilish
        </button>
      </div>
      <div class="bc-result" id="bcResult"></div>
    </div>
    <div class="bc-current-wrap" id="bcCurrentWrap" style="display:none;">
      <div class="bc-current-label">Faol e'lon:</div>
      <div class="bc-current-card" id="bcCurrentCard"></div>
      <button class="bc-del-btn" id="bcDelBtn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        E'lonni o'chirish
      </button>
    </div>
    <div class="bc-history-wrap">
      <div class="bc-history-label">E'lonlar tarixi</div>
      <div id="bcHistoryList"><div class="aimod-empty">Yuklanmoqda…</div></div>
    </div>
  `;

  // Extra CSS
  if (!document.getElementById('bc-notice-css')) {
    const s = document.createElement('style');
    s.id = 'bc-notice-css';
    s.textContent = `
.bc-textarea { resize: vertical; min-height: 70px; }
.bc-current-wrap {
  margin: 0 16px 12px;
  background: color-mix(in srgb, var(--blue) 10%, var(--bg2));
  border: 1px solid color-mix(in srgb, var(--blue) 30%, transparent);
  border-radius: 12px;
  padding: 12px 14px;
  display: flex; flex-direction: column; gap: 8px;
}
.bc-current-label { font-size: 11px; font-weight: 700; color: var(--text2); text-transform: uppercase; letter-spacing: 0.4px; }
.bc-current-card { font-size: 13px; color: var(--text); line-height: 1.45; word-break: break-word; }
.bc-current-target { font-size: 11px; color: var(--blue); margin-top: 4px; }
.bc-del-btn {
  display: flex; align-items: center; gap: 6px;
  align-self: flex-start;
  background: color-mix(in srgb, var(--red,#ef4444) 15%, transparent);
  color: var(--red,#ef4444);
  border: 1px solid color-mix(in srgb, var(--red,#ef4444) 35%, transparent);
  border-radius: 8px;
  font-family: var(--font); font-size: 12px; font-weight: 600;
  padding: 6px 12px; cursor: pointer;
  transition: opacity 0.15s;
}
.bc-del-btn:hover { opacity: 0.75; }
.bc-history-wrap {
  margin: 0 16px 12px;
  display: flex; flex-direction: column; gap: 8px;
}
.bc-history-label { font-size: 11px; font-weight: 700; color: var(--text2); text-transform: uppercase; letter-spacing: 0.4px; }
.bc-history-item {
  background: var(--bg2);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 12.5px;
  color: var(--text);
  line-height: 1.4;
}
.bc-history-text { word-break: break-word; }
.bc-history-meta { font-size: 11px; color: var(--text3); margin-top: 4px; }
`;
    document.head.appendChild(s);
  }

  const bodyEl   = document.getElementById('bcBody');
  const targetEl = document.getElementById('bcTarget');
  const sendBtn  = document.getElementById('bcSendBtn');
  const resultEl = document.getElementById('bcResult');
  const currentWrap = document.getElementById('bcCurrentWrap');
  const currentCard = document.getElementById('bcCurrentCard');
  const delBtn   = document.getElementById('bcDelBtn');

  const TARGET_LABELS = {
    all: 'Barchaga (chat + kutayotganlar)',
    approved: 'Faqat tasdiqlanganlarga',
    pending: 'Faqat kutayotganlarga',
  };

  // Real-time: faol e'lonni ko'rsat
  if (_noticeUnsub) { _noticeUnsub(); _noticeUnsub = null; }
  _noticeUnsub = onSnapshot(doc(db, 'ADMIN', '_index', 'adminNotice', 'global'), snap => {
    if (snap.exists()) {
      const d = snap.data();
      currentWrap.style.display = 'flex';
      currentCard.innerHTML = `
        <div>${(d.text || '').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</div>
        <div class="bc-current-target"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg> ${TARGET_LABELS[d.target] || d.target}</div>
      `;
    } else {
      currentWrap.style.display = 'none';
      currentCard.innerHTML = '';
    }
  }, () => {});

  // Real-time: e'lonlar tarixi (oxirgi 20 ta)
  if (_bcHistoryUnsub) { _bcHistoryUnsub(); _bcHistoryUnsub = null; }
  const historyList = document.getElementById('bcHistoryList');
  const histQ = query(collection(db, 'ADMIN', '_index', 'broadcastHistory'), orderBy('createdAt', 'desc'), limit(20));
  _bcHistoryUnsub = onSnapshot(histQ, snap => {
    if (!historyList) return;
    if (snap.empty) {
      historyList.innerHTML = `<div class="aimod-empty">Hozircha e'lon yuborilmagan</div>`;
      return;
    }
    historyList.innerHTML = snap.docs.map(d => {
      const h = d.data();
      const dt = h.createdAt?.toDate ? h.createdAt.toDate().toLocaleString('uz-UZ') : '';
      return `
        <div class="bc-history-item">
          <div class="bc-history-text">${esc(h.text || '')}</div>
          <div class="bc-history-meta">${TARGET_LABELS[h.target] || h.target || ''} · ${dt}</div>
        </div>`;
    }).join('');
  }, () => {
    if (historyList) historyList.innerHTML = `<div class="aimod-empty">Tarixni yuklab bo'lmadi</div>`;
  });

  // Yuborish
  sendBtn.addEventListener('click', async () => {
    const body   = bodyEl.value.trim();
    const target = targetEl.value;

    if (!body) { bodyEl.focus(); return; }

    sendBtn.disabled = true;
    sendBtn.textContent = 'Saqlanmoqda…';
    resultEl.textContent = '';
    resultEl.className = 'bc-result';

    try {
      await setDoc(doc(db, 'ADMIN', '_index', 'adminNotice', 'global'), {
        text: body,
        target,
        createdAt: serverTimestamp(),
        adminUid: state.me.uid,
      });
      addDoc(collection(db, 'ADMIN', '_index', 'broadcastHistory'), {
        text: body,
        target,
        createdAt: serverTimestamp(),
        adminUid: state.me.uid,
      }).catch(() => {});
      bodyEl.value = '';
      resultEl.textContent = 'E\'lon muvaffaqiyatli chop etildi';
      resultEl.className = 'bc-result ok';
      toast('E\'lon chop etildi', 'success');
      logAdminAction({
        action: 'broadcastSend',
        details: `[${TARGET_LABELS[target] || target}] ${body.slice(0, 80)}${body.length > 80 ? '…' : ''}`,
      });
    } catch (err) {
      resultEl.textContent = `Xatolik: ${err.message}`;
      resultEl.className = 'bc-result err';
      toast('Xatolik: ' + err.message, 'error');
    } finally {
      sendBtn.disabled = false;
      sendBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px">
          <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
        E'lon qilish`;
    }
  });

  // O'chirish
  delBtn.addEventListener('click', async () => {
    if (!confirm('E\'lonni o\'chirasizmi?')) return;
    try {
      await deleteDoc(doc(db, 'ADMIN', '_index', 'adminNotice', 'global'));
      toast('E\'lon o\'chirildi', 'success');
      logAdminAction({ action: 'broadcastDelete' });
    } catch (err) {
      toast('O\'chirishda xatolik: ' + err.message, 'error');
    }
  });

  // Ctrl+Enter → yuborish
  bodyEl
}

/* ── Stats ── */
async function _initStats() {
  const section = document.getElementById('actionsStatsSection');
  if (!section) return;
  try {
    const mod = await import('./view-stats.js');
    if (mod.destroyView) mod.destroyView();
    await mod.initView(section);
  } catch (err) {
    console.error('[Actions] Stats init error:', err);
  }
}

/* ── AI Ishlatilish statistikasi (advanced, faqat admin) ── */
async function _initAiUsage() {
  const section = document.getElementById('actionsAiUsageSection');
  if (!section) return;
  try {
    const mod = await import('./view-ai-usage.js');
    if (mod.destroyView) mod.destroyView();
    await mod.initView(section);
  } catch (err) {
    console.error('[Actions] AI usage init error:', err);
  }
}

/* ── Users ── */
async function _initUsers() {
  try {
    const { initView: usersInit } = await import('./view-users.js');
    usersInit();
  } catch (err) {
    console.error('[Actions] Users init error:', err);
  }
}

export function destroyView() {
  _initialized = false;
  const section = document.getElementById('actionsBroadcastSection');
  if (section) delete section.dataset.ready;
  destroyAuditLog();
  destroyDashboardSummary();
  if (_noticeUnsub) { _noticeUnsub(); _noticeUnsub = null; }
  if (_bcHistoryUnsub) { _bcHistoryUnsub(); _bcHistoryUnsub = null; }
  if (_aiModUnsub) { _aiModUnsub(); _aiModUnsub = null; }
  if (_aiBlockedUnsub) { _aiBlockedUnsub(); _aiBlockedUnsub = null; }
  if (_aiTasksUnsub) { _aiTasksUnsub(); _aiTasksUnsub = null; }
  import('./view-stats.js').then(m => m.destroyView && m.destroyView()).catch(() => {});
  import('./view-ai-usage.js').then(m => m.destroyView && m.destroyView()).catch(() => {});
}

/**
 * MRgram — Admin Audit Log
 * Har bir muhim admin amalini 'adminActions' collection'iga yozadi
 * va actions sahifasida "So'nggi amallar" ro'yxatini render qiladi.
 */

import { db, state } from './config.js';
import { esc } from './utils.js';
import {
  collection, addDoc, onSnapshot, query, orderBy, limit, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

const MAX_ITEMS = 30;

/* ── Amal turlari uchun label/icon ── */
const ACTION_META = {
  userBlock:        { label: 'Foydalanuvchi bloklandi',        icon: '🔒', color: 'var(--red,#ef4444)' },
  userUnblock:      { label: 'Foydalanuvchi blokdan chiqarildi', icon: '🔓', color: 'var(--green,#22c55e)' },
  userDelete:       { label: 'Foydalanuvchi o\'chirildi',       icon: '🗑️', color: 'var(--red,#ef4444)' },
  userApprove:      { label: 'Foydalanuvchi tasdiqlandi',       icon: '✅', color: 'var(--green,#22c55e)' },
  userReject:       { label: 'Foydalanuvchi rad etildi',        icon: '⛔', color: 'var(--red,#ef4444)' },
  postRestore:      { label: 'Post qaytarildi (AI moderatsiya)', icon: '↩️', color: 'var(--blue,#3b82f6)' },
  postBlockUser:    { label: 'Post asosida foydalanuvchi bloklandi', icon: '🚫', color: 'var(--red,#ef4444)' },
  aiUnblock:        { label: 'AI bloklagan foydalanuvchi qayta yoqildi', icon: '🔓', color: 'var(--green,#22c55e)' },
  aiClearViolations:{ label: 'Qoidabuzarliklar tarixi tozalandi', icon: '🧹', color: 'var(--text2)' },
  broadcastSend:    { label: 'E\'lon chop etildi',               icon: '📢', color: 'var(--blue,#3b82f6)' },
  broadcastDelete:  { label: 'E\'lon o\'chirildi',                icon: '🗑️', color: 'var(--text2)' },
  aiAutoBlock:      { label: 'AI avtomatik bloklash bajardi',    icon: '🤖', color: 'var(--red,#ef4444)' },
};

/* ── Yozish ──
 * action: yuqoridagi kalitlardan biri
 * targetUid/targetName: amal qaysi foydalanuvchi/postga tegishli (ixtiyoriy)
 * details: qisqa qo'shimcha matn (ixtiyoriy)
 */
export async function logAdminAction({ action, targetUid = null, targetName = '', details = '' } = {}) {
  try {
    await addDoc(collection(db, 'ADMIN', '_index', 'adminActions'), {
      action,
      targetUid,
      targetName,
      details,
      adminUid:  state.me?.uid || null,
      adminName: state.me?.fullName || state.me?.email || 'Admin',
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    // Audit log yozilmasa ham asosiy amal to'xtamasin — faqat konsolga chiqaramiz
    console.warn('[AdminAudit] Yozib bo\'lmadi:', err.message);
  }
}

/* ── CSS ── */
function _injectCSS() {
  if (document.getElementById('admin-audit-css')) return;
  const s = document.createElement('style');
  s.id = 'admin-audit-css';
  s.textContent = `
.audit-wrap {
  margin: 0 16px 8px;
  display: flex; flex-direction: column; gap: 8px;
  max-height: 360px;
  overflow-y: auto;
}
.audit-empty {
  background: var(--bg2);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 16px;
  text-align: center;
  color: var(--text3);
  font-size: 13px;
}
.audit-item {
  display: flex; align-items: flex-start; gap: 10px;
  background: var(--bg2);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px 12px;
}
.audit-icon { font-size: 16px; line-height: 1; flex-shrink: 0; margin-top: 1px; }
.audit-body { flex: 1; min-width: 0; }
.audit-title { font-size: 12.5px; font-weight: 700; }
.audit-sub { font-size: 12px; color: var(--text2); margin-top: 2px; word-break: break-word; }
.audit-meta { font-size: 11px; color: var(--text3); margin-top: 3px; }
`;
  document.head.appendChild(s);
}

let _unsub = null;

/* ── Render: real-vaqt "So'nggi amallar" ro'yxati ── */
export function initAuditLog(containerId) {
  const section = document.getElementById(containerId);
  if (!section) return;
  _injectCSS();

  section.innerHTML = `<div class="audit-wrap" id="auditWrap"><div class="audit-empty">Yuklanmoqda…</div></div>`;
  const wrap = document.getElementById('auditWrap');

  if (_unsub) { _unsub(); _unsub = null; }

  const q = query(
    collection(db, 'ADMIN', '_index', 'adminActions'),
    orderBy('createdAt', 'desc'),
    limit(MAX_ITEMS)
  );

  _unsub = onSnapshot(q, (snap) => {
    if (snap.empty) {
      wrap.innerHTML = `<div class="audit-empty">Hozircha hech qanday amal qayd etilmagan</div>`;
      return;
    }

    wrap.innerHTML = snap.docs.map(d => {
      const a = d.data();
      const meta = ACTION_META[a.action] || { label: a.action || 'Amal', icon: '•', color: 'var(--text2)' };
      const dt = a.createdAt?.toDate ? a.createdAt.toDate().toLocaleString('uz-UZ') : 'hozir';
      return `
        <div class="audit-item">
          <div class="audit-icon">${meta.icon}</div>
          <div class="audit-body">
            <div class="audit-title" style="color:${meta.color}">${esc(meta.label)}</div>
            ${a.targetName ? `<div class="audit-sub">${esc(a.targetName)}${a.details ? ' — ' + esc(a.details) : ''}</div>` : (a.details ? `<div class="audit-sub">${esc(a.details)}</div>` : '')}
            <div class="audit-meta">${esc(a.adminName || 'Admin')} · ${dt}</div>
          </div>
        </div>`;
    }).join('');
  }, (err) => {
    wrap.innerHTML = `<div class="audit-empty">Xatolik: ${esc(err.message)}</div>`;
  });
}

export function destroyAuditLog() {
  if (_unsub) { _unsub(); _unsub = null; }
}

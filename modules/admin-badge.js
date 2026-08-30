/**
 * MRgram — Admin Badge (real-vaqt bildirishnoma)
 * Bottom-nav'dagi "Boshqaruv" (Actions) tugmasida — admin boshqa
 * bo'limda bo'lsa ham — yangi pending foydalanuvchi yoki AI moderatsiya
 * hodisasi paydo bo'lganda qizil badge ko'rsatadi.
 */

import { db } from './config.js';
import {
  collection, onSnapshot, query, where
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

let _pendingUnsub = null;
let _aiModUnsub   = null;
let _pendingCount = 0;
let _aiModCount   = 0;
let _running      = false;

function _updateBadge() {
  const badge = document.getElementById('adminActionsBadge');
  if (!badge) return;
  const total = _pendingCount + _aiModCount;
  if (total > 0) {
    badge.textContent = total > 99 ? '99+' : String(total);
    badge.classList.remove('d-none');
  } else {
    badge.textContent = '';
    badge.classList.add('d-none');
  }
}

/** Admin tasdiqlangandan keyin bir marta chaqiriladi (idempotent) */
export function initAdminBadge() {
  if (_running) return; // allaqachon ishlamoqda — qayta ulamaymiz
  _running = true;

  const usersQ = query(collection(db, 'users'), where('approved', '==', false));
  _pendingUnsub = onSnapshot(usersQ, snap => {
    _pendingCount = snap.size;
    _updateBadge();
  }, () => {});

  const aiModQ = query(collection(db, 'posts'), where('aiHidden', '==', true));
  _aiModUnsub = onSnapshot(aiModQ, snap => {
    _aiModCount = snap.size;
    _updateBadge();
  }, () => {});
}

/** Admin bo'lmagan foydalanuvchi kirsa yoki chiqib ketsa to'xtatiladi */
export function destroyAdminBadge() {
  if (_pendingUnsub) { _pendingUnsub(); _pendingUnsub = null; }
  if (_aiModUnsub)   { _aiModUnsub();   _aiModUnsub   = null; }
  _pendingCount = 0;
  _aiModCount   = 0;
  _running      = false;
  const badge = document.getElementById('adminActionsBadge');
  if (badge) { badge.textContent = ''; badge.classList.add('d-none'); }
}

/**
 * modules/token-usage.js
 * ─────────────────────────────────────────────────────────────────────────
 * ADVANCED / DEBUG: matn modeli (openai/gpt-oss-120b) va rasm/vision modeli
 * (qwen/qwen3.6-27b) qancha token sarflayotganini kuzatib boruvchi
 * floating (suzuvchi) bubble.
 *
 * MUHIM: faqat ADMIN uchun ko'rinadi. DOM elementi modules/script.js orqali
 * ilova yuklanganda yaratiladi, lekin boshida yashirin (display:none) holda
 * turadi — ko'rinishi modules/router.js dagi applyAdminNav() (login/logout
 * va admin holati aniqlangan har safar chaqiriladi) orqali
 * setTokenUsageBubbleVisible(isAdmin) bilan boshqariladi. Oddiy
 * foydalanuvchilarda hech qachon ko'rinmaydi.
 *
 * Har bir /api/groq-chat so'rovi tugagach, Groq javobidagi `usage` maydoni
 * (prompt_tokens/completion_tokens/total_tokens) shu yerga yig'iladi —
 * modules/config.js dagi groqRequest()/groqRequestStream() orqali (bu ikkala
 * funksiya orqali ILOVADAGI BARCHA AI so'rovlari — chat, captionlar,
 * kommentariyalar, ovozli qo'ng'iroq va h.k. — ketadi).
 *
 * Kesh sessiya davomida saqlanadi (sessionStorage) — sahifa yangilansa
 * (F5) ham hisob nolga tushmaydi, lekin brauzer yopilsa tozalanadi (bu
 * ataylab shunday — doimiy statistika emas, joriy sessiya monitoringi).
 */

import { db, isAdmin } from './config.js';
import { doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

const STORAGE_KEY = 'mrgram_token_usage_v1';
const EVT_UPDATED  = 'mrgram:token-usage-updated';

function _emptyModelStats() {
  return { prompt: 0, completion: 0, total: 0, requests: 0 };
}

/** Bitta Groq API kaliti (id — "gk1"/"legacy"/"env" va h.k.) uchun statistika. */
function _emptyKeyStats() {
  return { prompt: 0, completion: 0, total: 0, requests: 0 };
}

function _load() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error('empty');
    const parsed = JSON.parse(raw);
    return {
      text:   { ..._emptyModelStats(), ...(parsed.text   || {}) },
      vision: { ..._emptyModelStats(), ...(parsed.vision || {}) },
      // Har bir Groq kaliti (id bo'yicha) qancha so'rov/token ishlatgani —
      // masalan { gk1: {...}, gk2: {...}, legacy: {...} }.
      keys: (parsed.keys && typeof parsed.keys === 'object') ? parsed.keys : {},
      // Eng so'nggi so'rovda ishlatilgan kalit id'si — panelda "hozirgi
      // faol kalit" sifatida belgilash uchun.
      lastKeyId: parsed.lastKeyId || null,
    };
  } catch (_) {
    return { text: _emptyModelStats(), vision: _emptyModelStats(), keys: {}, lastKeyId: null };
  }
}

let _state = _load();

function _persist() {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(_state)); } catch (_) { /* jim */ }
}

function _notify() {
  document.dispatchEvent(new CustomEvent(EVT_UPDATED, { detail: getTokenUsageState() }));
}

/**
 * Modellar orasidan qaysi turga tegishli ekanini aniqlaydi — model nomi
 * bo'yicha. Yangi vision model qo'shilsa ham ishlashda davom etsin uchun
 * "qwen"/"vision" so'zlariga qarab ham aniqlaymiz (faqat aniq nom bilan
 * cheklanib qolmaslik uchun).
 */
export function classifyModelKind(model) {
  const m = (model || '').toLowerCase();
  if (m.includes('qwen') || m.includes('vision')) return 'vision';
  return 'text';
}

/**
 * Bitta so'rov yakunlanganda chaqiriladi — Groq `usage` obyektini yozib
 * boradi. `keyId` — /api/groq-chat javobidagi `X-Groq-Key-Id` header'idan
 * kelgan, so'rov aynan qaysi Groq kaliti orqali bajarilganini bildiruvchi
 * id ("gk1", "legacy", "env" va h.k.). Kalit noma'lum bo'lsa (masalan eski
 * keshlangan javob yoki header kelmagan holat) faqat model bo'yicha
 * statistika yangilanadi, kalit bo'yicha yangilanmaydi.
 */
export function recordTokenUsage(model, usage, keyId = null) {
  if (!usage) return;
  const kind = classifyModelKind(model);
  const s = _state[kind];
  const prompt     = usage.prompt_tokens     || 0;
  const completion = usage.completion_tokens || 0;
  const total      = usage.total_tokens      || (prompt + completion);

  s.prompt     += prompt;
  s.completion += completion;
  s.total      += total;
  s.requests   += 1;

  if (keyId) {
    if (!_state.keys[keyId]) _state.keys[keyId] = _emptyKeyStats();
    const k = _state.keys[keyId];
    k.prompt     += prompt;
    k.completion += completion;
    k.total      += total;
    k.requests   += 1;
    _state.lastKeyId = keyId;
  }

  _persist();
  _notify();
}

export function getTokenUsageState() {
  return JSON.parse(JSON.stringify(_state));
}

/* ── Bugungi UMUMIY (barcha foydalanuvchilar) token sarfi ────────────────
 * Server (api/groq-chat.js) har bir muvaffaqiyatli so'rovdan keyin
 * AI/_stats/daily/{yyyy-mm-dd} hujjatini yangilaydi (barcha foydalanuvchilar
 * uchun umumiy). Bu yerda o'sha hujjatni REAL-VAQTDA (onSnapshot) o'qiymiz —
 * lekin FAQAT admin uchun (firestore.rules ham shunday cheklaydi) va FAQAT
 * bubble ko'rinib turgan paytda (ortiqcha Firestore o'qishlarini oldini olish
 * uchun — q. _startTodayListener/_stopTodayListener, setTokenUsageBubbleVisible
 * orqali chaqiriladi). ──────────────────────────────────────────────────── */
let _todayTotal = 0;
let _todayUnsub = null;

function _todayDocId() {
  // Server dayKey'ni UTC bo'yicha hisoblaydi (groq-chat.js: toISOString().slice(0,10)) —
  // shu bilan mos kelishi uchun bu yerda ham UTC sanadan foydalanamiz.
  return new Date().toISOString().slice(0, 10);
}

function _startTodayListener() {
  if (_todayUnsub || !isAdmin()) return;
  try {
    _todayUnsub = onSnapshot(
      doc(db, 'AI', '_stats', 'daily', _todayDocId()),
      (snap) => {
        _todayTotal = snap.exists() ? (snap.data().totalTokens || 0) : 0;
        if (_bubbleEl) _renderPanel(_bubbleEl, getTokenUsageState());
      },
      () => { /* admin bo'lmasa/xato — jim, badge shunchaki 0 ko'rsatadi */ }
    );
  } catch (_) { /* jim */ }
}

function _stopTodayListener() {
  if (_todayUnsub) { try { _todayUnsub(); } catch (_) {} _todayUnsub = null; }
}

export function resetTokenUsage() {
  _state = { text: _emptyModelStats(), vision: _emptyModelStats(), keys: {}, lastKeyId: null };
  _persist();
  _notify();
}

/* ── Floating bubble UI ──────────────────────────────────────────────── */

let _bubbleInitialized = false;
let _bubbleEl = null;

function _fmt(n) {
  return (n || 0).toLocaleString('uz-UZ');
}

function _injectStyles() {
  if (document.getElementById('mrgram-token-bubble-style')) return;
  const style = document.createElement('style');
  style.id = 'mrgram-token-bubble-style';
  style.textContent = `
#mrgramTokenBubble {
  position: fixed;
  z-index: 99999;
  right: 14px;
  bottom: 84px;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #8a4fff;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font: 600 11px/1.1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  box-shadow: 0 4px 16px rgba(0,0,0,.35);
  cursor: grab;
  user-select: none;
  touch-action: none;
  transition: width .18s ease, height .18s ease, border-radius .18s ease, background .18s ease;
}
#mrgramTokenBubble.expanded {
  width: 220px;
  height: auto;
  border-radius: 16px;
  padding: 12px 14px;
  align-items: stretch;
  justify-content: flex-start;
  flex-direction: column;
  cursor: default;
  background: rgba(28,26,46,.96);
}
#mrgramTokenBubble .mtb-badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  line-height: 1.05;
}
#mrgramTokenBubble .mtb-badge b { font-size: 13px; }
#mrgramTokenBubble .mtb-badge span { font-size: 8px; opacity: .8; }
#mrgramTokenBubble.expanded .mtb-badge { display: none; }
#mrgramTokenBubble .mtb-panel { display: none; }
#mrgramTokenBubble.expanded .mtb-panel { display: block; }
#mrgramTokenBubble .mtb-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 8px; cursor: grab;
}
#mrgramTokenBubble .mtb-title { font-size: 12px; font-weight: 700; color: #fff; }
#mrgramTokenBubble .mtb-close {
  background: none; border: none; color: #bbb; font-size: 16px; line-height: 1;
  cursor: pointer; padding: 2px 6px;
}
#mrgramTokenBubble .mtb-row {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 11px; color: #ddd; padding: 5px 0; border-top: 1px solid rgba(255,255,255,.08);
}
#mrgramTokenBubble .mtb-row:first-of-type { border-top: none; }
#mrgramTokenBubble .mtb-model { font-weight: 600; color: #fff; }
#mrgramTokenBubble .mtb-sub { font-size: 9.5px; color: #999; margin-top: 1px; }
#mrgramTokenBubble .mtb-total { text-align: right; font-variant-numeric: tabular-nums; }
#mrgramTokenBubble .mtb-reset {
  margin-top: 8px; width: 100%; padding: 6px 0; border-radius: 8px; border: none;
  background: rgba(255,255,255,.1); color: #eee; font-size: 11px; cursor: pointer;
}
#mrgramTokenBubble .mtb-reset:active { background: rgba(255,255,255,.18); }
#mrgramTokenBubble .mtb-section {
  margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,.12);
  font-size: 10.5px; font-weight: 700; color: #cfc9ff; letter-spacing: .02em;
}
#mrgramTokenBubble .mtb-key-dot {
  display: inline-block; width: 6px; height: 6px; border-radius: 50%;
  background: #4ade80; margin-right: 5px; box-shadow: 0 0 4px rgba(74,222,128,.9);
}
#mrgramTokenBubble .mtb-empty {
  font-size: 10.5px; color: #888; padding: 6px 0;
}
`;
  document.head.appendChild(style);
}

function _renderPanel(root, s) {
  const ownTotal = s.text.total + s.vision.total;
  root.innerHTML = `
    <div class="mtb-badge">
      <b>${_fmt(_todayTotal)}</b>
      <span>bugun</span>
    </div>
    <div class="mtb-panel">
      <div class="mtb-head">
        <span class="mtb-title">🧠 AI token sarfi</span>
        <button type="button" class="mtb-close" aria-label="Yopish">✕</button>
      </div>
      <div class="mtb-row">
        <div>
          <div class="mtb-model">📊 Bugun — hammasi</div>
          <div class="mtb-sub">barcha foydalanuvchilar, real-vaqtda</div>
        </div>
        <div class="mtb-total">${_fmt(_todayTotal)}</div>
      </div>
      <div class="mtb-row">
        <div>
          <div class="mtb-model">👤 Sizniki (bu seans)</div>
          <div class="mtb-sub">${s.text.requests + s.vision.requests} so'rov</div>
        </div>
        <div class="mtb-total">${_fmt(ownTotal)}</div>
      </div>
      <button type="button" class="mtb-reset">Sizniki hisobni nolga tushirish</button>
    </div>
  `;
}

/** Suzuvchi bubble'ni tortib (drag) joyini o'zgartirish imkonini beradi. */
function _makeDraggable(el, handleSelector) {
  let dragging = false, moved = false, startX = 0, startY = 0, startRight = 0, startBottom = 0;

  const getHandle = () => (handleSelector ? el.querySelector(handleSelector) : el) || el;

  const onDown = (e) => {
    const p = e.touches ? e.touches[0] : e;
    dragging = true; moved = false;
    startX = p.clientX; startY = p.clientY;
    const rect = el.getBoundingClientRect();
    startRight  = window.innerWidth  - rect.right;
    startBottom = window.innerHeight - rect.bottom;
    el.style.cursor = 'grabbing';
  };
  const onMove = (e) => {
    if (!dragging) return;
    const p = e.touches ? e.touches[0] : e;
    const dx = p.clientX - startX;
    const dy = p.clientY - startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
    if (!moved) return;
    e.preventDefault();
    let newRight  = startRight  - dx;
    let newBottom = startBottom - dy;
    const rect = el.getBoundingClientRect();
    newRight  = Math.min(Math.max(newRight,  4), window.innerWidth  - rect.width  - 4);
    newBottom = Math.min(Math.max(newBottom, 4), window.innerHeight - rect.height - 4);
    el.style.right  = `${newRight}px`;
    el.style.bottom = `${newBottom}px`;
  };
  const onUp = () => { dragging = false; el.style.cursor = 'grab'; };

  el.addEventListener('mousedown', (e) => { if (e.target.closest('.mtb-close, .mtb-reset')) return; onDown(e); });
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  el.addEventListener('touchstart', (e) => { if (e.target.closest('.mtb-close, .mtb-reset')) return; onDown(e); }, { passive: true });
  window.addEventListener('touchmove', onMove, { passive: false });
  window.addEventListener('touchend', onUp);

  return () => moved; // chaqiruvchi "sudralganmi yoki tap bosildimi"ni bilishi uchun
}

/**
 * Floating bubble'ni sahifaga qo'shadi. Bir necha marta chaqirilsa ham
 * faqat bitta nusxa yaratiladi (SPA navigatsiyasida qayta-qayta
 * chaqirilishidan himoya).
 */
export function initTokenUsageBubble() {
  if (_bubbleInitialized || document.getElementById('mrgramTokenBubble')) return;
  _bubbleInitialized = true;

  _injectStyles();

  const el = document.createElement('div');
  el.id = 'mrgramTokenBubble';
  // Faqat admin uchun — boshqa hamma foydalanuvchida yashirin turadi.
  // Ko'rinishini boshqarish uchun q. setTokenUsageBubbleVisible().
  el.style.display = 'none';
  document.body.appendChild(el);
  _bubbleEl = el;

  _renderPanel(el, getTokenUsageState());

  const wasMoved = _makeDraggable(el, '.mtb-head');

  el.addEventListener('click', (e) => {
    if (wasMoved()) return; // drag tugagach tasodifiy tap sifatida hisoblanmasin
    if (e.target.closest('.mtb-close')) {
      el.classList.remove('expanded');
      return;
    }
    if (e.target.closest('.mtb-reset')) {
      resetTokenUsage();
      return;
    }
    if (!el.classList.contains('expanded')) {
      el.classList.add('expanded');
    }
  });

  document.addEventListener(EVT_UPDATED, (e) => {
    _renderPanel(el, e.detail);
  });
}

/**
 * Bubble'ni ko'rsatish/yashirish — faqat admin uchun chaqiriladi
 * (q. modules/router.js -> applyAdminNav()). Oddiy foydalanuvchilarda
 * har doim yashirin turadi.
 */
export function setTokenUsageBubbleVisible(visible) {
  if (!_bubbleEl) _bubbleEl = document.getElementById('mrgramTokenBubble');
  if (!_bubbleEl) return;
  _bubbleEl.style.display = visible ? '' : 'none';
  // Admin bo'lmasa panel ochiq qolib ketmasin
  if (!visible) _bubbleEl.classList.remove('expanded');

  // "Bugun — hammasi" ko'rsatkichi faqat bubble ko'rinib turgan paytda
  // (ya'ni admin tizimga kirgan paytda) real-vaqtda kuzatiladi — aks
  // holda oddiy foydalanuvchilarda ham bekorga Firestore o'qilib turmasin.
  if (visible) _startTodayListener(); else _stopTodayListener();
}

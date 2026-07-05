import { db, state, MAX_FILE, uploadViaController, aiGenerateCaption, aiModeratePost, createThinkingUI, auth, clearControllerCache } from './config.js';
import { $, esc, fmtSz, lockScroll, unlockScroll }  from './utils.js';
import { toast }                                   from './toast.js';
import {
  collection, addDoc, doc, getDoc, onSnapshot,
  serverTimestamp, updateDoc, arrayUnion
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

/* ═══════════════════════════════════════════════════════════════════════
   FILE TYPE → SVG icon + label + accent color
   ═══════════════════════════════════════════════════════════════════════ */
function getFileTypeInfo(name = '', mime = '') {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const m   = (mime || '').toLowerCase();

  /* ── Audio / Music ── */
  if (m.startsWith('audio') || ['mp3','wav','ogg','aac','flac','m4a','wma','opus','aiff','mid','midi'].includes(ext))
    return {
      label: ext.toUpperCase() || 'AUDIO', color: '#a855f7',
      svg: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="48" height="48" rx="10" fill="rgba(168,85,247,0.12)"/>
        <path d="M18 34V18l16-4v16" stroke="#a855f7" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="15" cy="34" r="3" fill="#a855f7"/>
        <circle cx="31" cy="30" r="3" fill="#a855f7"/>
        <path d="M20 22l12-3" stroke="#a855f7" stroke-width="1.6" stroke-linecap="round" opacity=".5"/>
      </svg>`
    };

  /* ── HTML ── */
  if (['html','htm'].includes(ext) || m === 'text/html')
    return {
      label: 'HTML', color: '#f97316',
      svg: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="48" height="48" rx="10" fill="rgba(249,115,22,0.12)"/>
        <text x="24" y="29" text-anchor="middle" font-family="monospace" font-weight="700" font-size="10" fill="#f97316">&lt;/&gt;</text>
        <path d="M14 18l-5 6 5 6" stroke="#f97316" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M34 18l5 6-5 6" stroke="#f97316" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
        <line x1="28" y1="14" x2="20" y2="34" stroke="#f97316" stroke-width="2" stroke-linecap="round" opacity=".6"/>
      </svg>`
    };

  /* ── TypeScript ── */
  if (['ts','tsx'].includes(ext))
    return {
      label: 'TS', color: '#3b82f6',
      svg: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="48" height="48" rx="10" fill="rgba(59,130,246,0.12)"/>
        <rect x="10" y="10" width="28" height="28" rx="5" fill="#3b82f6"/>
        <text x="24" y="30" text-anchor="middle" font-family="monospace" font-weight="800" font-size="14" fill="white">TS</text>
      </svg>`
    };

  /* ── JavaScript / JSX ── */
  if (['js','mjs','cjs','jsx'].includes(ext) || m.includes('javascript'))
    return {
      label: ext === 'jsx' ? 'JSX' : 'JS', color: '#eab308',
      svg: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="48" height="48" rx="10" fill="rgba(234,179,8,0.12)"/>
        <rect x="10" y="10" width="28" height="28" rx="5" fill="#eab308"/>
        <text x="24" y="30" text-anchor="middle" font-family="monospace" font-weight="800" font-size="${ext==='jsx'?'10':'14'}" fill="currentColor">${ext === 'jsx' ? 'JSX' : 'JS'}</text>
      </svg>`
    };

  /* ── PDF ── */
  if (ext === 'pdf' || m === 'application/pdf')
    return {
      label: 'PDF', color: '#ef4444',
      svg: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="48" height="48" rx="10" fill="rgba(239,68,68,0.12)"/>
        <path d="M13 8h16l8 8v24a2 2 0 0 1-2 2H13a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z" stroke="#ef4444" stroke-width="2"/>
        <path d="M29 8v8h8" stroke="#ef4444" stroke-width="2" stroke-linecap="round"/>
        <text x="24" y="34" text-anchor="middle" font-family="monospace" font-weight="700" font-size="9" fill="#ef4444">PDF</text>
      </svg>`
    };

  /* ── ZIP / Archive ── */
  if (['zip','rar','7z','tar','gz','bz2','xz','lz','lzma'].includes(ext))
    return {
      label: ext.toUpperCase(), color: '#8b5cf6',
      svg: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="48" height="48" rx="10" fill="rgba(139,92,246,0.12)"/>
        <rect x="12" y="16" width="24" height="20" rx="3" stroke="#8b5cf6" stroke-width="2"/>
        <path d="M12 22h24" stroke="#8b5cf6" stroke-width="2"/>
        <path d="M12 28h24" stroke="#8b5cf6" stroke-width="1.4" opacity=".5"/>
        <rect x="20" y="8" width="8" height="8" rx="2" stroke="#8b5cf6" stroke-width="2"/>
        <line x1="24" y1="8" x2="24" y2="16" stroke="#8b5cf6" stroke-width="2"/>
        <line x1="21" y1="11" x2="27" y2="11" stroke="#8b5cf6" stroke-width="1.5" opacity=".6"/>
        <line x1="21" y1="13" x2="27" y2="13" stroke="#8b5cf6" stroke-width="1.5" opacity=".6"/>
      </svg>`
    };

  /* ── Word / DOC ── */
  if (['doc','docx'].includes(ext) || m.includes('msword') || m.includes('wordprocessingml'))
    return {
      label: 'DOCX', color: '#2563eb',
      svg: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="48" height="48" rx="10" fill="rgba(37,99,235,0.12)"/>
        <path d="M13 8h16l8 8v24a2 2 0 0 1-2 2H13a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z" stroke="#2563eb" stroke-width="2"/>
        <path d="M29 8v8h8" stroke="#2563eb" stroke-width="2" stroke-linecap="round"/>
        <line x1="16" y1="26" x2="32" y2="26" stroke="#2563eb" stroke-width="2" stroke-linecap="round"/>
        <line x1="16" y1="31" x2="28" y2="31" stroke="#2563eb" stroke-width="2" stroke-linecap="round" opacity=".6"/>
        <text x="24" y="23" text-anchor="middle" font-family="sans-serif" font-weight="800" font-size="8" fill="#2563eb">W</text>
      </svg>`
    };

  /* ── Excel / CSV / Spreadsheet ── */
  if (['xls','xlsx','csv','ods'].includes(ext) || m.includes('spreadsheet') || m.includes('excel') || m === 'text/csv')
    return {
      label: ext.toUpperCase(), color: '#16a34a',
      svg: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="48" height="48" rx="10" fill="rgba(22,163,74,0.12)"/>
        <rect x="9" y="14" width="30" height="22" rx="3" stroke="#16a34a" stroke-width="2"/>
        <line x1="9" y1="22" x2="39" y2="22" stroke="#16a34a" stroke-width="1.5"/>
        <line x1="9" y1="29" x2="39" y2="29" stroke="#16a34a" stroke-width="1.5" opacity=".6"/>
        <line x1="21" y1="14" x2="21" y2="36" stroke="#16a34a" stroke-width="1.5" opacity=".7"/>
        <line x1="30" y1="14" x2="30" y2="36" stroke="#16a34a" stroke-width="1.5" opacity=".5"/>
      </svg>`
    };

  /* ── Python ── */
  if (ext === 'py' || m === 'text/x-python')
    return {
      label: 'PY', color: '#3b82f6',
      svg: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="48" height="48" rx="10" fill="rgba(59,130,246,0.10)"/>
        <path d="M18 10h8a4 4 0 0 1 4 4v4H18a4 4 0 0 1-4-4v-2a2 2 0 0 1 2-2z" fill="#3b82f6"/>
        <path d="M18 38h8a4 4 0 0 0 4-4v-4H18a4 4 0 0 0-4 4v2a2 2 0 0 0 2 2z" fill="#eab308"/>
        <circle cx="22" cy="16" r="1.5" fill="white"/>
        <circle cx="26" cy="32" r="1.5" fill="white"/>
      </svg>`
    };

  /* ── JSON ── */
  if (ext === 'json' || m === 'application/json')
    return {
      label: 'JSON', color: '#f59e0b',
      svg: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="48" height="48" rx="10" fill="rgba(245,158,11,0.12)"/>
        <text x="10" y="30" font-family="monospace" font-weight="700" font-size="18" fill="#f59e0b">{}</text>
        <text x="10" y="20" font-family="monospace" font-size="9" fill="#f59e0b" opacity=".7">"key":</text>
      </svg>`
    };

  /* ── CSS / SCSS ── */
  if (['css','scss','sass','less'].includes(ext))
    return {
      label: ext.toUpperCase(), color: '#06b6d4',
      svg: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="48" height="48" rx="10" fill="rgba(6,182,212,0.12)"/>
        <rect x="10" y="10" width="28" height="28" rx="5" fill="#06b6d4"/>
        <text x="24" y="30" text-anchor="middle" font-family="monospace" font-weight="800" font-size="11" fill="white">CSS</text>
      </svg>`
    };

  /* ── Markdown ── */
  if (['md','mdx','markdown'].includes(ext))
    return {
      label: 'MD', color: '#6b7280',
      svg: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="48" height="48" rx="10" fill="rgba(107,114,128,0.12)"/>
        <path d="M8 14h32v20H8z" stroke="#6b7280" stroke-width="2" rx="3"/>
        <text x="24" y="29" text-anchor="middle" font-family="monospace" font-weight="700" font-size="11" fill="#6b7280">M↓</text>
      </svg>`
    };

  /* ── Plain Text / TXT / LOG ── */
  if (['txt','log','ini','cfg','conf'].includes(ext) || m === 'text/plain')
    return {
      label: ext.toUpperCase() || 'TXT', color: '#9ca3af',
      svg: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="48" height="48" rx="10" fill="rgba(156,163,175,0.10)"/>
        <path d="M13 8h16l8 8v24a2 2 0 0 1-2 2H13a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z" stroke="#9ca3af" stroke-width="2"/>
        <path d="M29 8v8h8" stroke="#9ca3af" stroke-width="2" stroke-linecap="round"/>
        <line x1="16" y1="22" x2="32" y2="22" stroke="#9ca3af" stroke-width="1.8" stroke-linecap="round"/>
        <line x1="16" y1="27" x2="32" y2="27" stroke="#9ca3af" stroke-width="1.8" stroke-linecap="round" opacity=".7"/>
        <line x1="16" y1="32" x2="26" y2="32" stroke="#9ca3af" stroke-width="1.8" stroke-linecap="round" opacity=".5"/>
      </svg>`
    };

  /* ── Default / unknown ── */
  return {
    label: (ext || 'FILE').toUpperCase(), color: '#5b8ef5',
    svg: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="48" height="48" rx="10" fill="rgba(91,142,245,0.10)"/>
      <path d="M13 8h16l8 8v24a2 2 0 0 1-2 2H13a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z" stroke="#5b8ef5" stroke-width="2"/>
      <path d="M29 8v8h8" stroke="#5b8ef5" stroke-width="2" stroke-linecap="round"/>
      <line x1="16" y1="24" x2="32" y2="24" stroke="#5b8ef5" stroke-width="1.8" stroke-linecap="round" opacity=".6"/>
      <line x1="16" y1="30" x2="28" y2="30" stroke="#5b8ef5" stroke-width="1.8" stroke-linecap="round" opacity=".4"/>
    </svg>`
  };
}

/* export so feed.js can use it too */
export { getFileTypeInfo };

/* ── FIX: Object URL ni tozalash helper ──────────────────────────────── */
function revokeObjUrl() {
  if (state._objUrl) { URL.revokeObjectURL(state._objUrl); state._objUrl = null; }
  state._selMediaW = null;
  state._selMediaH = null;
}

/* Rasm/video tanlanganda haqiqiy o'lchamini (width/height) o'lchab olamiz —
   shu orqali feed'da post-card media joyi hali yuklanmasdan turib ham
   TO'G'RI aspect-ratio bilan ochilib turadi (blur bilan), layout sakramaydi. */
function _measureSelectedMedia(file, objUrl) {
  state._selMediaW = null;
  state._selMediaH = null;
  if (file.type.startsWith('image')) {
    const img = new Image();
    img.onload = () => {
      // Foydalanuvchi shu orada faylni almashtirgan/tozalagan bo'lishi mumkin
      if (state._objUrl !== objUrl) return;
      state._selMediaW = img.naturalWidth  || null;
      state._selMediaH = img.naturalHeight || null;
    };
    img.src = objUrl;
  } else if (file.type.startsWith('video')) {
    const vid = document.createElement('video');
    vid.preload = 'metadata';
    vid.onloadedmetadata = () => {
      if (state._objUrl !== objUrl) return;
      state._selMediaW = vid.videoWidth  || null;
      state._selMediaH = vid.videoHeight || null;
    };
    vid.src = objUrl;
  }
}

/* ── Button enable/disable check ────────────────────────────────────── */
function refreshPostBtn() {
  const hasText = !!($('captionInput').value.trim());
  const hasFile = !!state.selFile;
  $('uploadBtn').disabled = !(hasText || hasFile);
}

/* ── Reset ───────────────────────────────────────────────────────────── */
export function resetUpload() {
  revokeObjUrl();
  state.selFile = null;
  state._visMode = 'private';
  $('fileInput').value = '';
  $('previewArea').style.display = 'none';
  $('previewArea').innerHTML = '';
  $('captionInput').value = '';
  $('pubToggle').checked = false;
  const ab = $('aiCaptionBtn'); if (ab) ab.style.display = 'none';
  /* Visibility tugmalarni reset qilish */
  setVisMode('private');
  $('uploadBtn').disabled = true;
  $('uploadBtn').textContent = 'Yuklash';
  $('sizeWarn').textContent = '';
  hideProgress();
}

/* ── Progress helpers ────────────────────────────────────────────────── */
function showProgress(pct) {
  const bar   = $('uploadProgress');
  const fill  = $('uploadProgressFill');
  const label = $('uploadProgressPct');
  if (!bar) return;
  bar.classList.add('active');
  fill.style.width = pct + '%';
  label.textContent = pct.toFixed(1) + '%';
}

function hideProgress() {
  const bar = $('uploadProgress');
  if (bar) bar.classList.remove('active');
  const fill = $('uploadProgressFill');
  if (fill) fill.style.width = '0%';
}

/* ── File pick ───────────────────────────────────────────────────────── */
export function pickFile(f) {
  const isMaxPrivateMode = state._visMode === 'maxprivate';
  if (!isMaxPrivateMode && f.size > MAX_FILE) {
    $('sizeWarn').textContent = `File ${fmtSz(f.size)} — limit 50 MB`;
    toast('Fayl hajmi 50 MB dan oshmasligi kerak', 'error');
    return;
  }
  $('sizeWarn').textContent = '';
  revokeObjUrl();
  state.selFile = f;
  state._objUrl = URL.createObjectURL(f);
  _measureSelectedMedia(f, state._objUrl);
  $('uploadBtn').disabled = false;
  $('previewArea').style.display = 'block';

  if (f.type.startsWith('image')) {
    $('previewArea').innerHTML = `<div class="preview-wrap"><img src="${state._objUrl}"><button class="preview-clear" data-action="clear-file">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button></div>`;
    const ab = $('aiCaptionBtn'); if (ab) ab.style.display = 'inline-block';
  } else if (f.type.startsWith('video')) {
    $('previewArea').innerHTML = `<div class="preview-wrap"><video class="max-h-150px w-full brr-10px" src="${state._objUrl}" controls muted></video><button class="preview-clear" data-action="clear-file">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button></div>`;
    // Video uchun ham AI caption tugmasi ko'rsatiladi
    const ab = $('aiCaptionBtn'); if (ab) ab.style.display = 'inline-block';
  } else {
    const info = getFileTypeInfo(f.name, f.type);
    $('previewArea').innerHTML = `<div class="preview-file">
      <div class="preview-file-icon w-44px h-44px flex-shrink-0">${info.svg}</div>
      <div class="flex-1 min-w-0">
        <div class="fs-13px fw-500 ws-nowrap overflow-hidden text-ellipsis">${esc(f.name)}</div>
        <div class="fs-11px c-text3-theme mt-2px">${info.label} · ${fmtSz(f.size)}</div>
      </div>
      <button class="bg-transparent border-none c-text3-theme cursor-pointer d-flex items-center flex-shrink-0" data-action="clear-file">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`;
    // Boshqa fayllar (html, js, css, pdf va h.k.) uchun AI caption ko'rsatiladi
    const ab = $('aiCaptionBtn'); if (ab) ab.style.display = 'inline-block';
  }
  refreshPostBtn();
}

/* ── Caption input → enable/disable Post btn ─────────────────────────── */
$('captionInput').addEventListener('input', refreshPostBtn);

// AI Caption tugmasi
const aiCaptionBtn = document.createElement('button');
aiCaptionBtn.id = 'aiCaptionBtn';
aiCaptionBtn.type = 'button';
aiCaptionBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></svg> AI caption';
aiCaptionBtn.style.cssText = 'display:none;margin-bottom:8px;padding:6px 14px;border-radius:20px;border:1.5px solid var(--accent,#a78bfa);background:transparent;color:var(--accent,#a78bfa);font-size:13px;cursor:pointer;transition:all 0.2s;';
aiCaptionBtn.onmouseenter = () => { aiCaptionBtn.style.background = 'var(--accent,#a78bfa)'; aiCaptionBtn.style.color = '#fff'; };
aiCaptionBtn.onmouseleave = () => { aiCaptionBtn.style.background = 'transparent'; aiCaptionBtn.style.color = 'var(--accent,#a78bfa)'; };

const captionEl = $('captionInput');
captionEl.parentNode.insertBefore(aiCaptionBtn, captionEl);

aiCaptionBtn.addEventListener('click', async () => {
  if (!state.selFile) return;

  // Eski bubble bo'lsa olib tashlaymiz
  const captionEl2 = $('captionInput');
  captionEl2?.parentNode?.querySelector('.ai-cap-bubble')?.remove();

  // Bubble yaratamiz — captionInput dan oldin
  const bubble = document.createElement('div');
  bubble.className = 'ai-cap-bubble ai-reply-thinking';
  captionEl2?.parentNode?.insertBefore(bubble, captionEl2);

  aiCaptionBtn.disabled = true;
  const thinkUI = createThinkingUI(bubble);

  try {
    let uploaderName = null;
    if (state.me) {
      try {
        const uSnap = await getDoc(doc(db, 'users', state.me.uid));
        uploaderName = uSnap?.data()?.fullName || state.me.displayName || null;
      } catch {
        uploaderName = state.me.displayName || null;
      }
    }

    let caption = '';
    if (state.selFile.type.startsWith('image/')) {
      const reader = new FileReader();
      const base64 = await new Promise((res, rej) => {
        reader.onload = e => res(e.target.result);
        reader.onerror = rej;
        reader.readAsDataURL(state.selFile);
      });
      caption = await aiGenerateCaption(base64, null, null, uploaderName, (n) => thinkUI.step(n));
    } else {
      caption = await aiGenerateCaption(
        state.selFile, state.selFile.name, state.selFile.type, uploaderName,
        (n) => thinkUI.step(n)
      );
    }

    thinkUI.finish();

    if (!caption) {
      bubble.remove();
      toast('AI caption yoza olmadi.', 'error', 3000);
      return;
    }

    // Taklif + OK tugma
    bubble.classList.remove('ai-reply-thinking');
    bubble.innerHTML = `
      <p class="ai-cmt-suggestion">${caption.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>
      <div class="ai-cmt-actions">
        <button class="ai-cmt-ok">Inputga qo'yish</button>
        <button class="ai-cmt-cancel">Bekor</button>
      </div>`;

    bubble.querySelector('.ai-cmt-ok').addEventListener('click', () => {
      $('captionInput').value = caption;
      refreshPostBtn();
      $('captionInput').focus();
      bubble.remove();
    });
    bubble.querySelector('.ai-cmt-cancel').addEventListener('click', () => bubble.remove());

  } catch (e) {
    thinkUI.destroy();
    bubble.remove();
    toast('AI xatosi: ' + e.message, 'error');
  } finally {
    aiCaptionBtn.disabled = false;
  }
});
/* ── Preview clear ───────────────────────────────────────────────────── */
$('previewArea').addEventListener('click', e => {
  if (e.target.closest('[data-action="clear-file"]')) clearFile();
});

function clearFile() {
  revokeObjUrl();
  state.selFile = null;
  $('previewArea').style.display = 'none';
  $('previewArea').innerHTML = '';
  $('fileInput').value = '';
  refreshPostBtn();
}

/* ── Visibility mode helper ─────────────────────────────────────────── */
function setVisMode(mode) {
  state._visMode = mode;
  const row  = $('visibilityRow');
  const desc = $('visDesc');

  /* Barcha tugmalardan active klassni olib tashlash */
  document.querySelectorAll('.vis-btn').forEach(b => b.classList.remove('vis-btn--active'));

  /* Aktiv tugmani belgilash */
  const activeBtn = document.querySelector(`.vis-btn[data-mode="${mode}"]`);
  if (activeBtn) activeBtn.classList.add('vis-btn--active');

  /* Row klasslarini tozalash */
  row.classList.remove('is-public', 'is-maxprivate');

  if (mode === 'public') {
    $('pubToggle').checked = true;
    row.classList.add('is-public');
    desc.textContent = 'Buni barcha foydalanuvchilar ko\'radi';
  } else if (mode === 'maxprivate') {
    $('pubToggle').checked = false;
    row.classList.add('is-maxprivate');
    desc.textContent = '⬛ Faqat sizning kompyuteringizga saqlanadi';
  } else {
    $('pubToggle').checked = false;
    desc.textContent = 'Buni faqat siz ko\'rasiz';
  }
}

/* ── Visibility tugmalar ────────────────────────────────────────────── */
async function verifyMaxPrivatePassword() {
  const entered = window.prompt('Kompyuterimga saqlash uchun parolni kiriting:');
  if (entered === null) return false; // bekor qilindi

  let correctPass = null;
  try {
    const ctrl = await getDoc(doc(db, 'spbs-collection', 'controller'));
    if (ctrl.exists()) correctPass = ctrl.data().privatePASS ?? null;
  } catch {}

  if (correctPass == null) {
    toast('Parol tekshirib bo\'lmadi (serverga ulanish xatosi)', 'error');
    return false;
  }

  if (entered !== correctPass) {
    toast('Parol noto\'g\'ri', 'error');
    return false;
  }

  return true;
}

document.querySelectorAll('.vis-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const mode = btn.dataset.mode;
    if (mode === 'maxprivate') {
      const ok = await verifyMaxPrivatePassword();
      if (!ok) return; // parol noto'g'ri yoki bekor qilindi — rejim o'zgarmaydi
    }
    setVisMode(mode);
  });
});

/* ── Yuklash / Post ───────────────────────────────────────────────────── */
/* ── Float bar helpers ───────────────────────────────────────────────── */
function floatBarShow(name) {
  const bar = $('uploadFloatBar');
  if (!bar) return;
  $('ufbName').textContent = name || 'Yuklanmoqda...';
  $('ufbFill').style.width = '0%';
  $('ufbFill').classList.remove('indeterminate');
  $('ufbPct').textContent  = '0%';
  bar.style.display = 'flex';
}

function floatBarUpdate(pct) {
  const fill = $('ufbFill');
  const pctEl = $('ufbPct');
  if (!fill) return;
  if (pct >= 95) {
    /* 90%+ da qotib qolmasin — indeterminate animatsiya */
    fill.classList.add('indeterminate');
    pctEl.textContent = 'Tugatilmoqda...';
  } else {
    fill.classList.remove('indeterminate');
    fill.style.width = pct + '%';
    pctEl.textContent = Math.round(pct) + '%';
  }
}

function floatBarDone(success) {
  const bar  = $('uploadFloatBar');
  const icon = bar?.querySelector('.ufb-icon');
  const fill = $('ufbFill');
  if (!bar) return;
  fill?.classList.remove('indeterminate');
  if (fill) fill.style.width = '100%';
  $('ufbPct').textContent = '100%';
  $('ufbName').textContent = success ? 'Yuklandi!' : 'Yuklash amalga oshmadi';
  if (icon) {
    icon.classList.add('done');
    icon.innerHTML = success
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  }
  setTimeout(() => {
    if (bar) bar.style.display = 'none';
    if (icon) { icon.classList.remove('done'); icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>'; }
  }, 2500);
}

/* ── Yuklash / Post ───────────────────────────────────────────────────── */
$('uploadBtn').onclick = async () => {
  const caption      = $('captionInput').value.trim();
  const visMode      = state._visMode || 'private';
  const isPublic     = visMode === 'public';
  const isMaxPrivate = visMode === 'maxprivate';
  if (!state.me) return;
  if (!caption && !state.selFile) return;

  /* Server offline bo'lsa maxprivate rejimda yuborishni to'xtatamiz */
  if (isMaxPrivate) {
    const serverBtn = $('visBtnMaxPrivate');
    const serverOnline = serverBtn && serverBtn.classList.contains('server-online');
    if (!serverOnline) {
      toast('Local server ishlamayapti! server.js ni yoqing.', 'error');
      return;
    }
  }

  $('uploadBtn').disabled    = true;
  $('uploadBtn').textContent = 'Yuklanmoqda…';

  // Controller cache ni tozalash — eski/o'chirilgan konfiguratsiya bilan yuklash xatosini oldini oladi
  clearControllerCache();

  /* Fayl bo'lsa overlay ni darhol yopamiz — foydalanuvchi reels ko'ra olsin */
  const hasFile = !!state.selFile;
  if (hasFile) {
    $('uploadOverlay').classList.remove('show');
    const shortName = state.selFile.name.length > 28
      ? state.selFile.name.slice(0, 26) + '…'
      : state.selFile.name;
    floatBarShow(shortName);
  }

  try {
    const uD = await getDoc(doc(db, 'users', state.me.uid));
    const ud  = uD.data() || {};
    let mediaPath = null;
    let mediaUrl  = null;
    let mediaType = null;
    let fileName  = null;
    let fileSize  = null;
    let storageIndex = null;

    /* ══════════════════════════════════════════════════════════════════
       MAX PRIVATE — serverga hech narsa yozilmaydi
       Faqat brauzer orqali kompyuterga saqlanadi
       ══════════════════════════════════════════════════════════════════ */
    if (isMaxPrivate) {
      /* Local server URL — Firestore controller dan olinadi yoki default */
      let LOCAL_SERVER = 'http://localhost:3747';
      try {
        const ctrl = await getDoc(doc(db, 'spbs-collection', 'controller'));
        if (ctrl.exists() && ctrl.data().localServerUrl) {
          LOCAL_SERVER = ctrl.data().localServerUrl;
        }
      } catch {}

      let localFile = null;
      if (hasFile) {
        const file = state.selFile;
        const base64 = await new Promise((res, rej) => {
          const reader = new FileReader();
          reader.onload  = () => res(reader.result);
          reader.onerror = rej;
          reader.readAsDataURL(file);
        });
        localFile = { name: file.name, size: file.size, type: file.type, data: base64 };
      }

      const postData = {
        text:     caption || null,
        file:     localFile,
        author:   ud.username || ud.fullName || state.me.displayName || 'Admin',
        userId:   state.me.uid,
      };

      let saved = false;
      try {
        const idToken = await auth.currentUser?.getIdToken();
        const resp = await fetch(`${LOCAL_SERVER}/save`, {
          method:  'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': idToken ? `Bearer ${idToken}` : '',
          },
          body:    JSON.stringify(postData),
        });
        saved = (await resp.json()).ok;
      } catch { saved = false; }

      revokeObjUrl();
      if (saved) {
        toast('⬛ Kompyuterimga saqlash — kompyuteringizga saqlandi!', 'success');
      } else {
        toast('Local server ishlamayapti! server.js ni yoqing.', 'error');
      }
      $('uploadOverlay').classList.remove('show');
      resetUpload();
      return; /* <-- Firestore ga YOZMASDAN chiqamiz */
    }

    /* ── Oddiy Private / Public uchun Firestore ── */
    if (hasFile) {
      const file = state.selFile;

      let simPct = 0;
      let lastTick = Date.now();
      const simInterval = setInterval(() => {
        lastTick = Date.now();
        const step = Math.max(0.3, (3 - (file.size / (10 * 1024 * 1024))) * Math.random());
        simPct = Math.min(simPct + step, 88);
        floatBarUpdate(simPct);
      }, 200);

      const result = await uploadViaController(file, 'posts');

      clearInterval(simInterval);
      floatBarUpdate(100);

      mediaPath    = result.path;
      mediaUrl     = result.url;
      storageIndex = result.storageIndex;
      mediaType    = file.type;
      fileName     = file.name;
      fileSize     = file.size;
    }

    const newPostRef = await addDoc(collection(db, 'posts'), {
      text:         caption || null,
      mediaPath,
      storageIndex,
      mediaType,
      mediaWidth:   hasFile ? (state._selMediaW || null) : null,
      mediaHeight:  hasFile ? (state._selMediaH || null) : null,
      fileName,
      fileSize,
      isPublic,
      isMaxPrivate: false,
      userId:       state.me.uid,
      userFullName: ud.fullName || state.me.displayName || 'Foydalanuvchi',
      createdAt:    serverTimestamp(),
      views:        0,
      likes:        0,
      commentCount: 0,
      aiHidden:     false,
      aiChecked:    false,
    });

    /* ── AI moderatsiya: fon rejimida (postni tezroq ko'rsatish uchun) ──
       Foydalanuvchini kutdirmaymiz — post darhol yuklanadi, AI esa orqa
       fonda ~5 soniya ichida tekshirib, yomon bo'lsa avtomatik yashiradi. */
    const isImageMedia = (mediaType || '').startsWith('image/');
    runAiModeration(newPostRef.id, isImageMedia ? mediaUrl : null, caption);

    revokeObjUrl();

    if (hasFile) {
      floatBarDone(true);
    } else {
      toast('Yuklandi!', 'success');
      $('uploadOverlay').classList.remove('show');
    }
    resetUpload();

  } catch (err) {
    if (hasFile) {
      floatBarDone(false);
      toast('Yuklash amalga oshmadi: ' + (err.message || 'Noma\'lum xatolik'), 'error');
    } else {
      toast('Xatolik: ' + (err.message || 'Noma\'lum xatolik'), 'error');
      $('uploadOverlay').classList.remove('show');
    }
    resetUpload();
  }
};

/* ══════════════════════════════════════════════════════════════════════
   AI MODERATSIYA — yangi post yuklanganidan keyin fon rejimida ishlaydi.
   Yomon (SEX / zo'ravonlik / nafrat va h.k.) deb topilsa, postni hech kimga
   (egasiga ham) ko'rsatmasdan avtomatik yashiradi — admin "AI moderatsiya"
   ro'yxatida ko'radi va xohlasa qaytarishi mumkin.
   ══════════════════════════════════════════════════════════════════════ */
// ── Qoidabuzarlik kategoriyalari ───────────────────────────────────────
const VIOLATION_CATEGORIES = [
  '18+ va kattalar uchun kontent (yalangochlik, erotika, pornografiya)',
  'Zoravonlik va shafqatsizlik (qon, tajovuz, hayvonlarga shafqatsizlik)',
  'Noqonuniy moddalar va buyumlar (giyohvandlik, qurol, portlovchi)',
  'Firibgarlik va scam (fishing, moliyaviy aldov, soxta yutuq)',
  'Shaxsiy malumotar (PII) - pasport, karta, telefon ruxsatsiz tarqatish',
  'Nafrat tili va bulling (millat, din, jins boyicha haqorat, tahdid)',
];

// ── Ogohlantiruv xabarlari (violation soni boyicha) ─────────────────────
const VIOLATION_MESSAGES = {
  // 2-3 ta violation: yumshoq ogohlantirish
  soft: [
    'Sizning bir nechta postlaringiz qoidalarga zid kontent sifatida belgilandi. Iltimos, MRgram qoidalariga rioya qiling.',
    'Diqqat! Siz taqiqlangan kontent joylashtirayotgansiz. Qoidalarni buzishda davom etsangiz, hisobingiz cheklanishi mumkin.',
  ],
  // 4 ta violation: qattiq ogohlantirish
  hard: [
    "Ko'p marta taqiqlangan kontent (18+, zo'ravonlik, noqonuniy material va hokazo) joylashtirgansiz. Agar bunday postlar qo'yishda davom etsangiz — hisobingizdan ayrilasiz.",
    "OGOHLANTIRUV: Siz taqiqlangan materiallarni qayta-qayta joylashtiryapsiz. Keyingi qoidabuzarlik hisobingizning doimiy bloklanishiga olib keladi.",
  ],
  // 5 ta violation: oxirgi ogohlantirish (6-da bloklash bo'ladi)
  final: [
    "⚠️ OXIRGI OGOHLANTIRISH: Bu sizning 5-chi qoidabuzarligingiz. Yana BITTA taqiqlangan post yoki xabar — va hisobingiz AI tomonidan doimiy ravishda bloklanadi.",
  ],
};

function _randMsg(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Violation source turlari
export const VIOLATION_SOURCE = {
  POST:  'post',
  CHAT:  'chat',
  FILE:  'file',
};

/**
 * Violation yozish + ogohlantirish + 6+ bo'lsa avtomatik bloklash.
 * source: 'post' | 'chat' | 'file'
 */
export async function _recordViolationAndWarn(userId, reason, source = VIOLATION_SOURCE.POST) {
  try {
    const violation = {
      at:     new Date().toISOString(),
      reason: reason || 'Nomalum sabab',
      source,
    };

    // users/{uid} ga violations array qoshish
    const userRef = doc(db, 'users', userId);
    await updateDoc(userRef, {
      aiViolations: arrayUnion(violation),
    });

    // Violations sonini hisoblash uchun qayta olish
    const snap     = await getDoc(userRef);
    const userData = snap.data() || {};
    const violations = userData.aiViolations || [];
    const count      = violations.length;

    // ── 6+ violation: admin ga avtomatik bloklash TOPSHIRIG'I ──────────
    // Xavfsizlik: foydalanuvchi o'zini bloklayolmaydi (rules da taqiqlangan).
    // Buning o'rniga adminTasks kolleksiyasiga yozamiz — admin (yoki Cloud Function)
    // bu taskni ko'rib foydalanuvchini bloklaydi.
    if (count >= 6 && !userData.blocked && !userData.aiPendingBlock) {
      const blockReason = `AI avtomatik bloklash: ${count} ta qoidabuzarlik. Oxirgi: ${reason || 'Nomalum'}`;
      try {
        await addDoc(collection(db, 'adminTasks'), {
          type:      'autoBlock',
          uid:       userId,
          reason:    blockReason,
          count,
          createdAt: new Date().toISOString(),
          done:      false,
        });
        // aiPendingBlock ni yozib qo'yamiz — bir xil task bir necha marta yaratilmasin
        await updateDoc(userRef, { aiPendingBlock: true });
      } catch (e) {
        console.warn('adminTask yozishda xato:', e.message);
      }
      setTimeout(() => toast(
        '🚫 Hisobingiz ko\'p marta qoidabuzarlik sababli bloklash uchun admin ko\'rib chiqishga yuborildi.',
        'error', 15000
      ), 1500);
      return;
    }

    // Ogohlantirish darajasiga qarab xabar ko'rsatish
    let msg = null;
    if (count >= 5) {
      msg = _randMsg(VIOLATION_MESSAGES.final);
    } else if (count >= 4) {
      msg = _randMsg(VIOLATION_MESSAGES.hard);
    } else if (count >= 2) {
      msg = _randMsg(VIOLATION_MESSAGES.soft);
    }

    if (msg) {
      // Toast 10 soniya ko'rsatamiz — jiddiy xabar
      setTimeout(() => toast(msg, 'error', 10000), 2000);
    }
  } catch (err) {
    console.warn('Violation yozishda xato:', err.message);
  }
}

async function runAiModeration(postId, imageUrl, text) {
  try {
    const result = await aiModeratePost({ imageUrl, text });
    const patch = { aiChecked: true };
    if (result.flagged) {
      patch.aiHidden   = true;
      patch.aiReason   = result.reason || 'AI tomonidan nomaqul deb topildi';
      patch.aiFlaggedAt = serverTimestamp();
    }
    await updateDoc(doc(db, 'posts', postId), patch);

    // Flaglangan bo'lsa — foydalanuvchi violations ro'yxatiga qo'shamiz
    if (result.flagged && state.me?.uid) {
      await _recordViolationAndWarn(state.me.uid, result.reason, VIOLATION_SOURCE.POST);
    }
  } catch (err) {
    // AI tekshiruvi ishlamasa ham — post oddiy holatda qoladi (xavfsiz fallback)
    console.warn('AI moderatsiya xatosi:', err.message);
  }
}

/* ══════════════════════════════════════════════════════════════════════
   SERVER YONIQLIK TEKSHIRUVI — REALTIME (Max Private tugmani boshqaradi)
   ══════════════════════════════════════════════════════════════════════ */
let CURRENT_LOCAL_SERVER = 'http://localhost:3747';
let pingIntervalId       = null;

function updateMaxPrivateBtn(isOnline) {
  const btn = $('visBtnMaxPrivate');
  if (!btn) return;

  // Tugma barcha hisoblarda doim ko'rinadi — rang server holatini bildiradi
  btn.style.display = '';
  btn.classList.toggle('server-online', !!isOnline);

  if (isOnline) {
    btn.title = 'Kompyuterimga saqlash (server yoniq)';
  } else {
    btn.title = 'Kompyuterimga saqlash (server o\'chiq)';
    // ❌ Avvalgi xato: ping muvaffaqiyatsiz bo'lsa rejimni o'zgartirardi.
    // Bu foydalanuvchi parol kiritib tanlagan rejimni bekor qilardi.
    // Endi faqat tugma rangini o'zgartiramiz, rejimni teginmaymiz.
  }
}

async function pingLocalServer() {
  // Har safar Firestore dan eng yangi URL ni olamiz — eski cached URL ishlatilmasin.
  // Tunnel qayta ulanib yangi URL olganda ham to'g'ri ishlaydi.
  try {
    const ctrl = await getDoc(doc(db, 'spbs-collection', 'controller'));
    if (ctrl.exists() && ctrl.data().localServerUrl) {
      CURRENT_LOCAL_SERVER = ctrl.data().localServerUrl;
    }
  } catch { /* Firestore xatosi — avvalgi URL bilan davom etamiz */ }

  try {
    const resp = await fetch(`${CURRENT_LOCAL_SERVER}/ping`, { signal: AbortSignal.timeout(3000) });
    updateMaxPrivateBtn(resp.ok);
  } catch {
    // Network xatolari (ERR_NAME_NOT_RESOLVED, timeout, offline) — konsolga chiqmasin
    updateMaxPrivateBtn(false);
  }
}

/** Firestore'dagi controller documentini realtime kuzatish.
 *  localServerUrl o'zgarganda (masalan, server qayta ishga tushib, yangi
 *  Cloudflare tunnel olganda) — darhol yangi manzilga o'tadi va tekshiradi. */
function startRealtimeServerWatch() {
  onSnapshot(doc(db, 'spbs-collection', 'controller'), (snap) => {
    if (snap.exists() && snap.data().localServerUrl) {
      CURRENT_LOCAL_SERVER = snap.data().localServerUrl;
    } else {
      CURRENT_LOCAL_SERVER = 'http://localhost:3747';
    }
    pingLocalServer(); // url o'zgargan zahoti darhol tekshirish
  }, (err) => {
  });
  // pingInterval olib tashlandi — onSnapshot URL o'zgarishini real-time kuzatadi,
  // qo'shimcha 10s interval faqat CPU/network isrof qilardi.
}

startRealtimeServerWatch();

/* ── Overlay open/close ──────────────────────────────────────────────── */
$('createBtn').onclick    = () => { $('uploadOverlay').classList.add('show'); lockScroll(); resetUpload(); pingLocalServer(); };
$('hdrNewPostBtn').onclick    = () => { $('uploadOverlay').classList.add('show'); lockScroll(); resetUpload(); pingLocalServer(); };
$('cancelUpload').onclick = () => { $('uploadOverlay').classList.remove('show'); unlockScroll(); resetUpload(); };
$('uploadOverlay').onclick = e => {
  if (e.target === $('uploadOverlay')) { $('uploadOverlay').classList.remove('show'); unlockScroll(); resetUpload(); }
};

/* ── File input / drop / paste ───────────────────────────────────────── */
$('uploadDrop').onclick = () => $('fileInput').click();
$('fileInput').onchange = e => { if (e.target.files[0]) pickFile(e.target.files[0]); };

$('uploadDrop').addEventListener('dragover', e => {
  e.preventDefault();
  $('uploadDrop').classList.add('drag-over');
});
$('uploadDrop').addEventListener('dragleave', () => $('uploadDrop').classList.remove('drag-over'));
$('uploadDrop').addEventListener('drop', e => {
  e.preventDefault();
  $('uploadDrop').classList.remove('drag-over');
  const f = e.dataTransfer.files[0]; if (f) pickFile(f);
});

window.addEventListener('paste', e => {
  for (const item of (e.clipboardData?.items || [])) {
    if (item.kind === 'file') {
      const f = item.getAsFile();
      if (f) { pickFile(f); $('uploadOverlay').classList.add('show'); break; }
    }
  }
});

$('uploadOverlay')
import { state }  from './config.js';
import { toast }  from './toast.js';

/* ── DOM / formatting helpers ─────────────────────────────────────────── */
export const $    = id => document.getElementById(id);
export const esc  = s  => s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : '';

/**
 * Foydalanuvchi yozgan (yoki AI qaytargan) oddiy Markdown belgilarini xavfsiz
 * HTML'ga aylantiradi: **qalin**, *egik*, ~~chizilgan~~, `kod`, ```kod bloki```,
 * # ## ### sarlavhalar, - / * ro'yxat elementlari (ichma-ich/indent bilan ham),
 * 1. raqamlangan ro'yxat, > iqtibos, [matn](url) havolalar. Butun MRgram
 * bo'ylab ishlatiladi (shaxsiy/guruh chatlar, post tavsiflari, izohlar) —
 * faqat AI emas, HAR QANDAY foydalanuvchi shu belgilardan foydalansa
 * chiroyli ko'rinadi.
 *
 * XAVFSIZLIK: eng avval esc() orqali butun matn HTML-escape qilinadi (< > &
 * xavfli belgilar zararsizlantiriladi), FAQAT shundan keyin Markdown
 * belgilari (*, #, `, -, >, []()) HTML teglariga aylantiriladi — shuning
 * uchun foydalanuvchi hech qachon o'zboshimcha HTML/skript kiritib ulgira
 * olmaydi. Havolalarda ham faqat http(s)/mailto sxemalariga ruxsat
 * beriladi (masalan "javascript:" kabi xavfli sxemalar rad etiladi).
 */
export function renderMarkdown(rawText) {
  if (!rawText) return '';
  let s = esc(String(rawText));

  // MUHIM: kod bloklarini (ko'p qatorli va bitta qatorli) ENG BIRINCHI
  // bo'lib maxsus placeholder'larga almashtiramiz — shunda pastdagi
  // sarlavha/ro'yxat/qalin/egik/iqtibos va eng oxirgi "\n"→"<br>" qoidalari
  // kod ICHIDAGI matnga umuman tegmaydi (avval kod HTML'ga aylantirilib,
  // keyin qolgan qoidalar SHU HTML ustida yana ishlab, kodni buzib
  // yuborardi — masalan kod ichidagi "- ", "# ", "**", "\n" markdown
  // sifatida qayta talqin qilinardi). Placeholder'lar eng oxirida,
  // barcha boshqa almashtirishlardan KEYIN asl holiga qaytariladi.
  const codeBlocks = [];
  s = s.replace(/```([\s\S]*?)```/g, (_m, code) => {
    const idx = codeBlocks.push(`<pre class="md-codeblock"><code>${code.trim()}</code></pre>`) - 1;
    return `\u0000CB${idx}\u0000`;
  });
  const inlineCodes = [];
  s = s.replace(/`([^`\n]+)`/g, (_m, code) => {
    const idx = inlineCodes.push(`<code class="md-code">${code}</code>`) - 1;
    return `\u0000IC${idx}\u0000`;
  });

  // Havolalar [matn](url) — faqat http(s)/mailto ruxsat etiladi (xavfsizlik
  // uchun "javascript:" va shunga o'xshash sxemalar rad etiladi). Bold/
  // italic'dan OLDIN ishlanadi, aks holda url ichidagi "_" kabi belgilar
  // xato ravishda egik matn sifatida talqin qilinishi mumkin edi.
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+?)(?:\s+"[^"]*")?\)/g,
    '<a href="$2" class="md-link" target="_blank" rel="noopener noreferrer">$1</a>');

  // Sarlavhalar (qator boshida # / ## / ###, oldida bo'sh joy/indent bo'lsa ham)
  s = s.replace(/^[ \t]*###\s+(.+)$/gm, '<div class="md-h3">$1</div>');
  s = s.replace(/^[ \t]*##\s+(.+)$/gm,  '<div class="md-h2">$1</div>');
  s = s.replace(/^[ \t]*#\s+(.+)$/gm,   '<div class="md-h1">$1</div>');

  // Iqtibos (blockquote) "> matn" — DIQQAT: esc() yuqorida ">" ni "&gt;"ga
  // aylantirgan, shuning uchun aynan "&gt;" ni izlaymiz.
  s = s.replace(/^[ \t]*&gt;\s?(.+)$/gm, '<div class="md-quote">$1</div>');

  // Raqamlangan ro'yxat "1. matn" (indent/ichma-ich darajasini saqlagan holda)
  s = s.replace(/^([ \t]*)(\d+)\.\s+(.+)$/gm, (_m, indent, num, txt) => {
    const depth = Math.floor(indent.replace(/\t/g, '  ').length / 2);
    return `<div class="md-li md-li-ol" style="padding-left:${2 + depth * 16}px">${num}. ${txt}</div>`;
  });
  // Nuqtali ro'yxat elementlari "- matn" yoki "* matn" (indent/ichma-ich
  // darajasini saqlagan holda — avvalgi versiya faqat qator boshida, hech
  // qanday bo'shliqsiz boshlanganini qabul qilardi, shuning uchun ichma-ich
  // (indent qilingan) elementlar chiqarilmay qolardi).
  s = s.replace(/^([ \t]*)[-*]\s+(.+)$/gm, (_m, indent, txt) => {
    const depth = Math.floor(indent.replace(/\t/g, '  ').length / 2);
    return `<div class="md-li" style="padding-left:${2 + depth * 16}px">• ${txt}</div>`;
  });

  // Chizilgan (strikethrough) ~~matn~~
  s = s.replace(/~~([^~\n]+)~~/g, '<del class="md-del">$1</del>');
  // Qalin **matn** yoki __matn__
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  // Egik *matn* yoki _matn_ (bitta yulduzcha/pastki chiziq)
  s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  s = s.replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
  // Qolgan qator ko'chirishlar (kod bloklari hali placeholder holida —
  // ularning ICHIDAGI asl "\n" belgilari <pre> orqali saqlanib qoladi,
  // ikki marta qator ko'chirilib ketmaydi)
  s = s.replace(/\n/g, '<br>');

  // Placeholder'larni kod HTML'ining asl (buzilmagan) holatiga qaytaramiz —
  // eng oxirida, shunda hech qanday qoida ularga endi tegmaydi.
  s = s.replace(/\u0000CB(\d+)\u0000/g, (_m, i) => codeBlocks[Number(i)]);
  s = s.replace(/\u0000IC(\d+)\u0000/g, (_m, i) => inlineCodes[Number(i)]);

  return s;
}

export const fmt  = ts => {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return new Intl.DateTimeFormat('en', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }).format(d);
};

/* Faqat soat:minut (chat xabarlari ostidagi vaqt uchun, masalan "11:55") */
export const fmtTime = ts => {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
};

export const fmtSz  = b  => b > 1048576 ? (b/1048576).toFixed(1)+' MB' : (b/1024).toFixed(0)+' KB';

/* ── Onlayn holat / oxirgi faollik ────────────────────────────────────
 * Presence uchun alohida "online" maydon ishlatilmaydi — buning o'rniga
 * `lastSeenAt` (heartbeat orqali har ~25s da yangilanadi) asos qilib
 * olinadi. Agar oxirgi yangilanishdan beri ONLINE_THRESHOLD_MS dan kam
 * vaqt o'tgan bo'lsa — foydalanuvchi "onlayn" hisoblanadi.
 */
export const ONLINE_THRESHOLD_MS = 70 * 1000; // heartbeat ~25s, shuning uchun bufer sifatida 70s

export function isOnline(lastSeenAt) {
  if (!lastSeenAt) return false;
  const d = lastSeenAt.toDate ? lastSeenAt.toDate() : new Date(lastSeenAt);
  return (Date.now() - d.getTime()) < ONLINE_THRESHOLD_MS;
}

export function formatLastSeen(lastSeenAt) {
  if (!lastSeenAt) return "faollik ma'lumoti yo'q";
  if (isOnline(lastSeenAt)) return 'onlayn';

  const d = lastSeenAt.toDate ? lastSeenAt.toDate() : new Date(lastSeenAt);
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / 60000);
  const hour = Math.floor(min / 60);

  if (min < 1)  return 'hozirgina faol edi';
  if (min < 60) return `${min} daqiqa oldin faol edi`;
  if (hour < 24) return `${hour} soat oldin faol edi`;

  const isToday = d.toDateString() === new Date().toDateString();
  const y = new Date(); y.setDate(y.getDate() - 1);
  const isYesterday = d.toDateString() === y.toDateString();
  const timeStr = new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', hour12: false }).format(d);

  if (isToday)      return `bugun soat ${timeStr} da faol edi`;
  if (isYesterday)  return `kecha soat ${timeStr} da faol edi`;
  return `${fmt(lastSeenAt)} da faol edi`;
}
export const initL  = n  => (n && n[0] ? n[0].toUpperCase() : 'U');
export const uToEmail = u => `${u.toLowerCase().replace(/[^a-z0-9]/g,'')}@mrdatabase.uz`;
export const clr    = n  => {
  const c = ['#4f8ef7','#3ecf8e','#e84057','#f5a623','#9b59b6','#1abc9c'];
  return c[Math.abs((n||'').length) % c.length];
};
export const defAvi = n => {
  const l = initL(n), c = clr(n);
  return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='${encodeURIComponent(c)}' rx='50'/%3E%3Ctext x='50' y='68' text-anchor='middle' fill='white' font-size='44' font-weight='600' font-family='DM Sans,sans-serif'%3E${l}%3C/text%3E%3C/svg%3E`;
};

/* ── Tasdiqlash dialog ───────────────────────────────────────────────────── */
export function showConfirm(msg, onOk, title = 'Aniqmi?') {
  const confirmTitle   = $('confirmTitle');
  const confirmMsg     = $('confirmMsg');
  const confirmOverlay = $('confirmOverlay');
  const ok             = $('confirmOkBtn');
  const cancel         = $('confirmCancelBtn');
  if (!confirmTitle || !confirmMsg || !confirmOverlay || !ok || !cancel) {
    if (window.confirm(msg)) onOk();
    return;
  }
  confirmTitle.textContent = title;
  confirmMsg.textContent   = msg;
  confirmOverlay.classList.add('show');
  const close  = () => confirmOverlay.classList.remove('show');
  const newOk  = ok.cloneNode(true);
  ok.parentNode.replaceChild(newOk, ok);
  newOk.onclick  = () => { close(); onOk(); };
  cancel.onclick = close;
}

/* ── Skeleton cards with shimmer animation ───────────────────────────── */
export function buildSkeletons(n = 3) {
  const delayClass = i => `delay-${i * 80}ms`;
  return Array.from({ length: n }, (_, i) => `
    <div class="skeleton-post ${delayClass(i)}">
      <div class="d-flex items-center gap-10px mb-14px">
        <div class="skel-avi"></div>
        <div class="flex-1 d-flex flex-col gap-7px">
          <div class="skel-line w-42pct"></div>
          <div class="skel-line w-26pct h-9px opacity-60"></div>
        </div>
      </div>
      <div class="skel-media"></div>
      <div class="p-12px-0 d-flex flex-col gap-7px">
        <div class="skel-line w-88pct"></div>
        <div class="skel-line w-65pct"></div>
      </div>
      <div class="skel-actions"></div>
    </div>`).join('');
}

/* ── Heart burst animation ────────────────────────────────────────────── */
export function showHeartBurst(x, y, container) {
  const el = document.createElement('div');
  el.className = 'heart-burst';
  el.style.left = x + 'px';
  el.style.top  = y + 'px';
  el.innerHTML = `<svg width="80" height="80" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path fill="#f04060" d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
  </svg>`;
  container.appendChild(el);
  setTimeout(() => el.remove(), 900);
}

/* ── Video helpers ────────────────────────────────────────────────────── */
export function fmtVidTime(s) {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return m + ':' + String(sec).padStart(2, '0');
}

export function setPlayState(wrap, playing) {
  const ip = wrap.querySelector('.ic-play'), ipu = wrap.querySelector('.ic-pause');
  if (ip)  ip.style.display  = playing ? 'none' : '';
  if (ipu) ipu.style.display = playing ? '' : 'none';
}

export function initVidWrap(wrap) {
  const vid = wrap.querySelector('video');
  if (!vid || vid._inited) return;
  vid._inited = true;
  vid.muted = state.globalMuted;
  const volIc = wrap.querySelector('.ic-vol'), mutedIc = wrap.querySelector('.ic-muted');
  if (volIc)   volIc.style.display   = state.globalMuted ? 'none' : '';
  if (mutedIc) mutedIc.style.display = state.globalMuted ? '' : 'none';
  vid.addEventListener('loadedmetadata', () => {
    const ratio = vid.videoWidth / vid.videoHeight;
    wrap.style.aspectRatio = ratio.toFixed(4);
  });
  vid.addEventListener('timeupdate', () => {
    if (!vid.duration) return;
    const pct  = (vid.currentTime / vid.duration) * 100;
    const fill = wrap.querySelector('.vc-fill');
    const timeEl = wrap.querySelector('.vc-time');
    if (fill)   fill.style.width = pct + '%';
    if (timeEl) timeEl.textContent = fmtVidTime(vid.currentTime);
  });
  vid.addEventListener('ended', () => setPlayState(wrap, false));
  vid.addEventListener('play',  () => setPlayState(wrap, true));
  vid.addEventListener('pause', () => setPlayState(wrap, false));
}

export function toggleVidPlay(el) {
  const wrap = el.closest ? el.closest('.vid-wrap') : el;
  const vid  = wrap?.querySelector('video');
  if (!vid) return;
  if (vid.paused) {
    vid.muted = state.globalMuted;
    vid.play().catch(() => {});
  } else {
    vid.pause();
  }
}

export function seekVid(e, bar) {
  const wrap = bar.closest('.vid-wrap');
  const vid  = wrap?.querySelector('video');
  if (!vid || !vid.duration) return;
  const rect = bar.getBoundingClientRect();
  vid.currentTime = ((e.clientX - rect.left) / rect.width) * vid.duration;
}

export function toggleMute(wrap) {
  const vid = wrap?.querySelector('video');
  if (!vid) return;
  vid.muted = !vid.muted;
  state.globalMuted = vid.muted;
  wrap.querySelector('.ic-vol').style.display   = vid.muted ? 'none' : '';
  wrap.querySelector('.ic-muted').style.display = vid.muted ? '' : 'none';
  document.dispatchEvent(new CustomEvent('mutestatechange'));
}

export function reqFullscreen(wrap) {
  const vid = wrap?.querySelector('video');
  if (!vid) return;
  if (vid.requestFullscreen)            vid.requestFullscreen();
  else if (vid.webkitRequestFullscreen) vid.webkitRequestFullscreen();
}

/* ── Event delegation for video controls ─────────────────────────────── */
document.addEventListener('click', e => {
  const wrap = e.target.closest('.vid-wrap');
  if (!wrap) return;
  if (e.target.closest('.vc-play') || e.target.closest('.vid-overlay')) {
    toggleVidPlay(wrap);
  } else if (e.target.closest('.vc-mute')) {
    toggleMute(wrap);
  } else if (e.target.closest('.vc-fs')) {
    reqFullscreen(wrap);
  }
});

document.addEventListener('click', e => {
  const bar = e.target.closest('.vc-progress');
  if (bar) seekVid(e, bar);
});

/* ── File download ────────────────────────────────────────────────────── */
export async function dlFile(url, name) {
  toast('Yuklab olinmoqda...', 'info', 8000);
  try {
    const res  = await fetch(url);
    if (!res.ok) throw new Error('Tarmoq xatosi');
    const blob = await res.blob();
    const burl = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = burl;
    a.download = name || 'file';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(burl); a.remove(); }, 1000);
    toast('Yuklab olindi!', 'success');
  } catch {
    window.open(url, '_blank');
    toast('Yangi oynada ochildi', 'info');
  }
}

/* ── Zoom modal ───────────────────────────────────────────────────────── */
export function openZoom(url, type) {
  const im = $('zoomImg'), vd = $('zoomVideo'), zm = $('zoomModal');
  if (!im || !vd || !zm) { window.open(url,'_blank'); return; }
  if (type === 'avatar') {
    im.style.display = 'block'; vd.style.display = 'none'; im.src = url;
    im.style.borderRadius = '50%';
    im.style.width = 'min(72vw, 340px)';
    im.style.height = 'min(72vw, 340px)';
    im.style.objectFit = 'cover';
    im.style.maxWidth = 'none';
    im.style.maxHeight = 'none';
  } else if (type === 'image') {
    im.style.display = 'block'; vd.style.display = 'none'; im.src = url;
    im.style.borderRadius = '12px';
    im.style.width = '';
    im.style.height = '';
    im.style.objectFit = 'contain';
    im.style.maxWidth = '96%';
    im.style.maxHeight = '96dvh';
  } else if (type === 'video') {
    im.style.display = 'none'; vd.style.display = 'block'; vd.src = url; vd.play().catch(() => {});
  } else { window.open(url,'_blank'); return; }
  zm.classList.add('show');
}

// Only attach if elements exist (not on login page)
const zoomClose = $('zoomClose');
const zoomModal = $('zoomModal');
if (zoomClose) {
  zoomClose.onclick = () => { $('zoomVideo')?.pause(); zoomModal?.classList.remove('show'); };
}
if (zoomModal) {
  zoomModal.onclick = e => {
    if (e.target === zoomModal) { $('zoomVideo')?.pause(); zoomModal.classList.remove('show'); }
  };
}

document

// Offline/online notifications o'chirildi
/* ═══════════════════════════════════════════════════════════════════════
   iOS 27 HAPTIC ENGINE
   navigator.vibrate — iOS Safari 16.4+ qo'llab-quvvatlaydi
   Fallback: CSS .haptic-flash animatsiyasi
   ═══════════════════════════════════════════════════════════════════════ */

const _hap = () => 'vibrate' in navigator;

export const haptic = {
  /** Engil tap — nav, like, checkbox */
  light  () { _hap() && navigator.vibrate(6);  },
  /** O'rta tap — tugmalar, post yuborish */
  medium () { _hap() && navigator.vibrate(10); },
  /** Og'ir tap — xato, ogohlantirish */
  heavy  () { _hap() && navigator.vibrate([12, 6, 12]); },
  /** Muvaffaqiyat — post, xabar yuborildi */
  success() { _hap() && navigator.vibrate([6, 4, 8]); },
  /** Xato — form validation, network error */
  error  () { _hap() && navigator.vibrate([14, 6, 14, 6, 14]); },
  /** Tanlash o'zgardi — tab, toggle, picker */
  select () { _hap() && navigator.vibrate(4);  },
};

/** Elementga visual + haptic touch feedback qo'shish */
export function addHapticTouch(el, type = 'light') {
  el.addEventListener('pointerdown', () => {
    haptic[type]?.();
    el.classList.add('haptic-flash');
    el.addEventListener('animationend', () => el.classList.remove('haptic-flash'), { once: true });
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   SCROLL LOCK — modal/sheet ochilganda orqa sahifa scroll bo'lmasin
   ═══════════════════════════════════════════════════════════════════════ */

let _scrollLockCount = 0;
let _scrollY = 0;

/** Body scrollini bloklash — modal/sheet ochilganda chaqiring */
export function lockScroll() {
  _scrollLockCount++;
  if (_scrollLockCount === 1) {
    _scrollY = window.scrollY;
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${_scrollY}px`;
    document.body.style.width = '100%';
  }
}

/** Body scrollini qayta ochish — modal/sheet yopilganda chaqiring */
export function unlockScroll() {
  _scrollLockCount = Math.max(0, _scrollLockCount - 1);
  if (_scrollLockCount === 0) {
    document.body.style.overflow = '';
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
    window.scrollTo(0, _scrollY);
  }
}

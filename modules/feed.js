import { db, state, CAP_LIMIT, getMediaUrl, isAdmin, aiAboutPost, createThinkingUI, auth } from './config.js';
import { $, esc, fmt, fmtSz, defAvi,
         initVidWrap, showConfirm,
         buildSkeletons, dlFile, openZoom, showHeartBurst } from './utils.js';
import { toast }                            from './toast.js';
import { follow, unfollow }                 from './auth.js';
import {
  collection, doc, getDoc, getDocs, query, orderBy,
  deleteDoc, setDoc, updateDoc,
  serverTimestamp, increment, where
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// ViewObserver placeholder (no caching)
function setupViewObserver() {}

/* ── Helpers ─────────────────────────────────────────────────────────── */

/* File type → SVG icon (mirrors upload.js getFileTypeInfo) */
function getFileIcon(name, mime) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const m   = (mime || '').toLowerCase();
  if (m.startsWith('audio') || ['mp3','wav','ogg','aac','flac','m4a','wma','opus','aiff','mid','midi'].includes(ext))
    return `<svg viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="10" fill="rgba(168,85,247,0.12)"/><path d="M18 34V18l16-4v16" stroke="#a855f7" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="15" cy="34" r="3" fill="#a855f7"/><circle cx="31" cy="30" r="3" fill="#a855f7"/><path d="M20 22l12-3" stroke="#a855f7" stroke-width="1.6" stroke-linecap="round" opacity=".5"/></svg>`;
  if (['html','htm'].includes(ext) || m === 'text/html')
    return `<svg viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="10" fill="rgba(249,115,22,0.12)"/><path d="M14 18l-5 6 5 6" stroke="#f97316" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M34 18l5 6-5 6" stroke="#f97316" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><line x1="28" y1="14" x2="20" y2="34" stroke="#f97316" stroke-width="2" stroke-linecap="round" opacity=".6"/></svg>`;
  if (['ts','tsx'].includes(ext))
    return `<svg viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="10" fill="rgba(59,130,246,0.12)"/><rect x="10" y="10" width="28" height="28" rx="5" fill="#3b82f6"/><text x="24" y="30" text-anchor="middle" font-family="monospace" font-weight="800" font-size="14" fill="white">TS</text></svg>`;
  if (['js','mjs','cjs','jsx'].includes(ext) || m.includes('javascript'))
    return `<svg viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="10" fill="rgba(234,179,8,0.12)"/><rect x="10" y="10" width="28" height="28" rx="5" fill="#eab308"/><text x="24" y="30" text-anchor="middle" font-family="monospace" font-weight="800" font-size="14" fill="#111">${ext==='jsx'?'JSX':'JS'}</text></svg>`;
  if (ext === 'pdf' || m === 'application/pdf')
    return `<svg viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="10" fill="rgba(239,68,68,0.12)"/><path d="M13 8h16l8 8v24a2 2 0 0 1-2 2H13a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z" stroke="#ef4444" stroke-width="2"/><path d="M29 8v8h8" stroke="#ef4444" stroke-width="2" stroke-linecap="round"/><text x="24" y="34" text-anchor="middle" font-family="monospace" font-weight="700" font-size="9" fill="#ef4444">PDF</text></svg>`;
  if (['zip','rar','7z','tar','gz','bz2','xz'].includes(ext))
    return `<svg viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="10" fill="rgba(139,92,246,0.12)"/><rect x="12" y="16" width="24" height="20" rx="3" stroke="#8b5cf6" stroke-width="2"/><path d="M12 22h24" stroke="#8b5cf6" stroke-width="2"/><rect x="20" y="8" width="8" height="8" rx="2" stroke="#8b5cf6" stroke-width="2"/><line x1="24" y1="8" x2="24" y2="16" stroke="#8b5cf6" stroke-width="2"/></svg>`;
  if (['doc','docx'].includes(ext) || m.includes('msword') || m.includes('wordprocessingml'))
    return `<svg viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="10" fill="rgba(37,99,235,0.12)"/><path d="M13 8h16l8 8v24a2 2 0 0 1-2 2H13a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z" stroke="#2563eb" stroke-width="2"/><line x1="16" y1="26" x2="32" y2="26" stroke="#2563eb" stroke-width="2" stroke-linecap="round"/><line x1="16" y1="31" x2="28" y2="31" stroke="#2563eb" stroke-width="2" stroke-linecap="round" opacity=".6"/><text x="24" y="23" text-anchor="middle" font-family="sans-serif" font-weight="800" font-size="8" fill="#2563eb">W</text></svg>`;
  if (['xls','xlsx','csv','ods'].includes(ext) || m.includes('spreadsheet') || m.includes('excel') || m === 'text/csv')
    return `<svg viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="10" fill="rgba(22,163,74,0.12)"/><rect x="9" y="14" width="30" height="22" rx="3" stroke="#16a34a" stroke-width="2"/><line x1="9" y1="22" x2="39" y2="22" stroke="#16a34a" stroke-width="1.5"/><line x1="9" y1="29" x2="39" y2="29" stroke="#16a34a" stroke-width="1.5" opacity=".6"/><line x1="21" y1="14" x2="21" y2="36" stroke="#16a34a" stroke-width="1.5" opacity=".7"/></svg>`;
  if (ext === 'py')
    return `<svg viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="10" fill="rgba(59,130,246,0.10)"/><path d="M18 10h8a4 4 0 0 1 4 4v4H18a4 4 0 0 1-4-4v-2a2 2 0 0 1 2-2z" fill="#3b82f6"/><path d="M18 38h8a4 4 0 0 0 4-4v-4H18a4 4 0 0 0-4 4v2a2 2 0 0 0 2 2z" fill="#eab308"/><circle cx="22" cy="16" r="1.5" fill="white"/><circle cx="26" cy="32" r="1.5" fill="white"/></svg>`;
  if (ext === 'json')
    return `<svg viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="10" fill="rgba(245,158,11,0.12)"/><text x="10" y="30" font-family="monospace" font-weight="700" font-size="18" fill="#f59e0b">{}</text><text x="10" y="20" font-family="monospace" font-size="9" fill="#f59e0b" opacity=".7">"key":</text></svg>`;
  if (['css','scss','sass','less'].includes(ext))
    return `<svg viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="10" fill="rgba(6,182,212,0.12)"/><rect x="10" y="10" width="28" height="28" rx="5" fill="#06b6d4"/><text x="24" y="30" text-anchor="middle" font-family="monospace" font-weight="800" font-size="11" fill="white">CSS</text></svg>`;
  if (['md','mdx'].includes(ext))
    return `<svg viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="10" fill="rgba(107,114,128,0.12)"/><path d="M8 14h32v20H8z" stroke="#6b7280" stroke-width="2" rx="3"/><text x="24" y="29" text-anchor="middle" font-family="monospace" font-weight="700" font-size="11" fill="#6b7280">M↓</text></svg>`;
  // default
  return `<svg viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="10" fill="rgba(91,142,245,0.10)"/><path d="M13 8h16l8 8v24a2 2 0 0 1-2 2H13a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z" stroke="#5b8ef5" stroke-width="2"/><path d="M29 8v8h8" stroke="#5b8ef5" stroke-width="2" stroke-linecap="round"/><line x1="16" y1="24" x2="32" y2="24" stroke="#5b8ef5" stroke-width="1.8" stroke-linecap="round" opacity=".6"/></svg>`;
}


export function filtered() {
  let p = [...state.allPosts];
  // Local (Max Private) postlar: public qilingan bo'lsa hammaga, aks holda faqat egasiga
  // Supabase/Firestore postlar: isPublic === true bo'lsa hammaga, aks holda faqat egasiga
  p = p.filter(x => {
    if (x.userId === state.me?.uid) return true; // o'z postlari har doim ko'rinadi
    if (x._fromLocal) return x._localPublic === true; // local post — faqat public bo'lsa
    return x.isPublic === true; // Firestore post
  });
  if (state.search) {
    const q = state.search.toLowerCase();
    p = p.filter(x =>
      (x.text||'').toLowerCase().includes(q) ||
      (x.userFullName||'').toLowerCase().includes(q)
    );
  }
  return p;
}


export function buildCaption(text, postId) {
  if (!text) return '';
  const escaped = esc(text);
  if (text.length <= CAP_LIMIT) return `<div class="post-caption">${escaped}</div>`;
  const short = esc(text.substring(0, CAP_LIMIT));
  return `<div class="post-caption cap-collapsed" data-postid="${postId}">
    <span class="cap-short">${short}<span class="cap-more">...ko'proq</span></span>
    <span class="cap-full">${escaped}<span class="cap-more c-blue-theme">kamroq</span></span>
  </div>`;
}

export function buildMedia(p) {
  if (!p.mediaUrl) return '';
  // Post matni doim darrov ko'rinadi (buildCaption alohida chiziladi).
  // Media esa "pm-loading" holatida boshlanadi: agar postda mediaWidth/
  // mediaHeight saqlangan bo'lsa (yuklash paytida o'lchangan), post-card
  // ALDINDAN xuddi shu nisbatda joy ochib turadi — shu bois rasm/video
  // hali yuklanmasdan turib ham layout "sakramaydi", faqat blur bilan
  // ko'rinadi. To'liq yuklangach (onload/onloadeddata) "pm-loading"
  // klassi olib tashlanadi va blur asta yo'qoladi.
  const ratio = (p.mediaWidth && p.mediaHeight)
    ? ` style="aspect-ratio:${p.mediaWidth}/${p.mediaHeight}"`
    : '';
  if (p.mediaType?.startsWith('image'))
    return `<div class="post-media pm-loading" data-id="${p.id}" data-type="image" data-url="${esc(p.mediaUrl)}"${ratio}><img src="${esc(p.mediaUrl)}" loading="lazy" onload="this.closest('.post-media')?.classList.remove('pm-loading')" onerror="this.closest('.post-media')?.classList.remove('pm-loading')"></div>`;
  if (p.mediaType?.startsWith('video'))
    return `<div class="post-media pm-loading" data-id="${p.id}" data-type="video" data-url="${esc(p.mediaUrl)}"${ratio}>
      <div class="vid-wrap">
        <video src="${esc(p.mediaUrl)}" preload="metadata" playsinline onloadeddata="this.closest('.post-media')?.classList.remove('pm-loading')" onerror="this.closest('.post-media')?.classList.remove('pm-loading')"></video>
        <div class="vid-overlay"></div>
        <div class="vid-controls">
          <button class="vc-play">
            <svg class="ic-play" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
            <svg class="ic-pause d-none" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          </button>
          <div class="vc-progress">
            <div class="vc-bar"><div class="vc-fill"></div></div>
          </div>
          <span class="vc-time">0:00</span>
          <button class="vc-mute">
            <svg class="ic-vol" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
            <svg class="ic-muted d-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
          </button>
          <button class="vc-fs">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15,3 21,3 21,9"/><polyline points="9,21 3,21 3,15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
          </button>
        </div>
      </div>
    </div>`;
  return `<div class="file-card" data-url="${esc(p.mediaUrl)}" data-name="${esc(p.fileName||'file')}">
    <div class="file-card-icon">${getFileIcon(p.fileName||'', p.mediaType||'')}</div>
    <div class="file-info"><div class="file-name">${esc(p.fileName||'File')}</div><div class="file-size">${p.fileSize ? fmtSz(p.fileSize) : ''}</div></div>
    <button class="file-dl" data-url="${esc(p.mediaUrl)}" data-name="${esc(p.fileName||'file')}">Yuklab olish</button>
  </div>`;
}

/* ── Feed rendering ──────────────────────────────────────────────────── */
/** Scroll paytida faqat yangi postlarni qo'shadi (butun feed qayta yozilmaydi) */
async function appendPostsToFeed(feedEl, newPosts) {
  if (!newPosts.length) return;

  // Media URL larni olish
  await Promise.all(newPosts.map(async p => {
    if (!p.mediaUrl && (p.mediaPath || p.storageIndex)) {
      p.mediaUrl = await getMediaUrl(p);
    }
  }));

  // Vaqtinchalik konteyner orqali HTML yaratamiz
  const tempEl = document.createElement('div');
  tempEl.style.display = 'none';
  document.body.appendChild(tempEl);
  await renderFeedTo(tempEl, newPosts);
  document.body.removeChild(tempEl);

  // Yangi postlarni asosiy feed'ga ko'chiramiz
  const posts = tempEl.querySelectorAll('.post');
  posts.forEach(p => feedEl.appendChild(p));

  bindFeedEvents(feedEl);
  requestAnimationFrame(() => setupViewObserver());
}

export async function renderFeedTo(feedEl, posts) {
  if (!state.me || !feedEl) return;
  if (!posts.length) {
    if (state.search) {
      feedEl.innerHTML = `<div class="empty-search">
        <div class="empty-search-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
        </div>
        <div>Natija topilmadi: "<strong>${esc(state.search)}</strong>"</div>
        <div class="empty-search-hint">Boshqa so'z bilan qidirib ko'ring yoki imloni tekshiring</div>
      </div>`;
    } else {
      const createBtn = state.view === 'home' ? `<button class="empty-cta" onclick="document.querySelector('.nav-center-btn')?.click()">Birinchi videongizni yuklang →</button>` : '';
      feedEl.innerHTML = `<div class="empty">
        <div class="empty-icon">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
            <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
          </svg>
        </div>
        <div>Hozircha postlar yo'q</div>
        ${createBtn}
      </div>`;
    }
    return;
  }

  // User cache dan foydalanish - Firestore reads kamaytirish
  const uids = [...new Set(posts.map(p => p.userId))];
  const uMap = {};
  const uidsToFetch = uids.filter(uid => !state._userCache[uid]);

  // Cache dan borlarni olish
  uids.forEach(uid => {
    if (state._userCache[uid]) {
      uMap[uid] = {
        fullName: state._userCache[uid].fullName,
        avatar: state._userCache[uid].avatar || defAvi(state._userCache[uid].fullName)
      };
    }
  });

  // Faqat cache da yo'qlarni yuklash
  if (uidsToFetch.length) {
    const userDocs = await Promise.all(uidsToFetch.map(u => getDoc(doc(db,'users',u))));
    uidsToFetch.forEach((u,i) => {
      const d = userDocs[i].data() || {};
      state._userCache[u] = {
        uid: u,
        fullName: d.fullName,
        avatar: d.avatar,
        username: d.username
      };
      uMap[u] = { fullName: d.fullName, avatar: d.avatar || defAvi(d.fullName) };
    });
  } else {
  }

  // Like status cache dan foydalanish (local va Firestore postlar alohida collection)
  const unknownPosts = posts.filter(p => !state.myLikedPosts.has(p.id) && !state._knownUnliked.has(p.id));
  if (unknownPosts.length) {
    const lS = await Promise.all(unknownPosts.map(p => {
      const col = p._fromLocal ? 'local-posts' : 'posts';
      return getDoc(doc(db, col, p.id, 'likes', state.me.uid)).catch(() => null);
    }));
    unknownPosts.forEach((p,i) => {
      if (lS[i]?.exists()) state.myLikedPosts.add(p.id);
      else state._knownUnliked.add(p.id);
    });
  }
  const likedSet = new Set(posts.filter(p => state.myLikedPosts.has(p.id)).map(p => p.id));

  // Multi-Supabase: Har bir post uchun mediaUrl yaratish (backward compatibility)
  await Promise.all(posts.map(async p => {
    if (!p.mediaUrl && (p.mediaPath || p.storageIndex)) {
      p.mediaUrl = await getMediaUrl(p);
    }
  }));

  // commentCount ni post documentidan olish
  // Local postlar uchun local-posts collectiondan yangi qiymat olish
  const cMap = {};
  // Local postlar uchun ham post objectidagi ma'lumotni ishlatamiz
  // (har render'da Firestore o'qish o'rniga — RAM dan)
  posts.forEach(p => { cMap[p.id] = p.commentCount ?? 0; });

  let html = '';
  for (const p of posts) {
    const u        = uMap[p.userId] || {};
    const liked    = likedSet.has(p.id);
    const canDel   = state.me.uid === p.userId || isAdmin();
    const isMine   = state.me.uid === p.userId;
    const isSub    = state.myFollowing.has(p.userId);

    html += `<div class="post" data-id="${p.id}">
      <div class="post-head">
        <div class="avi user-avi-btn" data-uid="${p.userId}"><img src="${u.avatar}" onerror="this.style.display='none'"></div>
        <div class="post-meta user-avi-btn" data-uid="${p.userId}">
          <div class="post-name">${esc(u.fullName||'Noma\'lum')}</div>
          <div class="post-time">${fmt(p.createdAt)}${p.isMaxPrivate ? ' <span class="mp-badge">⬛ Kompyuterimga saqlandi</span>' : ''}</div>
        </div>
        ${!isMine && !isSub ? `<button class="feed-sub-btn" data-uid="${p.userId}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>` : ''}
        ${(isMine && p._fromLocal) ? `<button class="mp-vis-btn" data-id="${p.id}" data-public="${p._localPublic ? '1' : '0'}" title="${p._localPublic ? 'Publicga o\'tkazilgan' : 'Faqat siz ko\'rasiz'}">
          ${p._localPublic
            ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`
            : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`
          }
        </button>` : ''}
        ${canDel ? `<button class="del-btn" data-id="${p.id}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/>
          </svg></button>` : ''}
      </div>
      ${buildMedia(p)}
      ${buildCaption(p.text, p.id)}
      <div class="post-stats">
        <span>${p.views || 0} ko'rishlar</span>
        <span id="lc-${p.id}">${p.likes || 0} yoqtirish</span>
        <span id="cc-${p.id}">${cMap[p.id] || 0} izoh</span>
      </div>
      <div class="post-actions">
        <button class="act-btn like-btn${liked?' liked':''}" data-id="${p.id}">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="${liked?'#f04060':'none'}" stroke="${liked?'#f04060':'currentColor'}" stroke-width="2">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
        </button>
        <button class="act-btn cmt-open-btn" data-id="${p.id}">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </button>
        <button class="act-btn share-btn"
          data-id="${p.id}"
          data-url="${p.mediaUrl ? esc(p.mediaUrl) : ''}"
          data-private="${(p._fromLocal ? (!p._localPublic) : (!p.isPublic)) ? '1' : '0'}">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
          </svg>
        </button>
        <button class="act-btn ai-about-btn" data-id="${p.id}" title="AI fikri">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72Z"/>
            <path d="m14 7 3 3"/>
            <path d="M5 6v4"/>
            <path d="M19 14v4"/>
            <path d="M10 2v2"/>
            <path d="M7 8H3"/>
            <path d="M21 16h-4"/>
            <path d="M11 3H9"/>
          </svg>
        </button>
      </div>
    </div>`;
  }

  feedEl.innerHTML = html;
  bindFeedEvents(feedEl);
  // FIX: setTimeout o'rniga requestAnimationFrame — render tugagandan keyin observer qo'yish
  requestAnimationFrame(() => setupViewObserver());
}

/* ── Auto-play videos on scroll ──────────────────────────────────────── */
export function setupFeedVideoObs(feedEl) {
  if (state.feedVidObs) state.feedVidObs.disconnect();
  state.feedVidObs = new IntersectionObserver(entries => {
    entries.forEach(en => {
      const wrap = en.target;
      const vid  = wrap.querySelector('video');
      if (!vid) return;
      if (en.isIntersecting && en.intersectionRatio >= 0.5) {
        vid.muted = state.globalMuted;
        vid.play().catch(() => {});
      } else {
        vid.pause();
      }
    });
  }, { threshold: 0.5 });
  feedEl.querySelectorAll('.vid-wrap').forEach(w => state.feedVidObs.observe(w));
}

/* ── Share popup ─────────────────────────────────────────────────────── */
function _injectShareCSS() {
  if (document.getElementById('share-popup-css')) return;
  const s = document.createElement('style');
  s.id = 'share-popup-css';
  s.textContent = `
.share-popup-overlay {
  position: fixed; inset: 0; z-index: 9990;
}
.share-popup {
  position: fixed; z-index: 9991;
  background: var(--bg2, #1a1a2e);
  border: 1px solid color-mix(in srgb, var(--blue, #3b82f6) 25%, transparent);
  border-radius: 16px;
  padding: 6px;
  min-width: 210px;
  box-shadow: 0 8px 32px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.04);
  animation: sharePopIn .18s cubic-bezier(.22,.68,0,1.2) both;
  transform-origin: top center;
}
@keyframes sharePopIn {
  from { opacity: 0; transform: scale(.88) translateY(-6px); }
  to   { opacity: 1; transform: scale(1)   translateY(0); }
}
.share-popup-row {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px;
  border-radius: 11px;
  cursor: pointer;
  font-size: 13.5px;
  color: var(--text, #fff);
  font-weight: 500;
  transition: background .12s;
  user-select: none;
}
.share-popup-row:hover { background: color-mix(in srgb, var(--blue, #3b82f6) 14%, transparent); }
.share-popup-row:active { background: color-mix(in srgb, var(--blue, #3b82f6) 22%, transparent); }
.share-popup-icon { color: var(--blue, #3b82f6); flex-shrink: 0; display: flex; align-items: center; }
.share-popup-divider { height: 1px; margin: 2px 10px; background: color-mix(in srgb, var(--border, #fff) 12%, transparent); }

/* ── Post highlight glow ── */
@keyframes postGlow {
  0%   { box-shadow: 0 0 0 0 color-mix(in srgb, var(--blue,#3b82f6) 0%, transparent); background: transparent; }
  20%  { box-shadow: 0 0 0 4px color-mix(in srgb, var(--blue,#3b82f6) 30%, transparent); background: color-mix(in srgb, var(--blue,#3b82f6) 7%, transparent); }
  60%  { box-shadow: 0 0 0 6px color-mix(in srgb, var(--blue,#3b82f6) 18%, transparent); background: color-mix(in srgb, var(--blue,#3b82f6) 5%, transparent); }
  100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--blue,#3b82f6) 0%, transparent); background: transparent; }
}
.post-highlight {
  animation: postGlow 2.2s cubic-bezier(.4,0,.2,1) forwards;
  border-radius: 18px;
  transition: background .3s;
}
`;
  document.head.appendChild(s);
}

let _sharePopupEl = null;
let _shareOverlayEl = null;

function _closeSharePopup() {
  if (_sharePopupEl) {
    _sharePopupEl.style.animation = 'sharePopIn .13s cubic-bezier(.4,0,1,1) reverse both';
    setTimeout(() => { _sharePopupEl?.remove(); _sharePopupEl = null; }, 130);
  }
  if (_shareOverlayEl) { _shareOverlayEl.remove(); _shareOverlayEl = null; }
}

function showSharePopup(btn) {
  _injectShareCSS();
  _closeSharePopup();

  const postId   = btn.dataset.id;
  const mediaUrl = btn.dataset.url;
  const isPrivate = btn.dataset.private === '1';

  // Agar private va media yo'q → hech narsa qilamiz
  if (isPrivate && !mediaUrl) {
    toast('Bu post private — ulashish imkonsiz', 'error');
    return;
  }

  // Agar private → auto nusxa media link
  if (isPrivate) {
    navigator.clipboard?.writeText(mediaUrl);
    toast('Fayl havolasi nusxalandi', 'info');
    return;
  }

  // Public post — popup ko'rsatamiz
  const overlay = document.createElement('div');
  overlay.className = 'share-popup-overlay';
  overlay.addEventListener('click', _closeSharePopup);
  document.body.appendChild(overlay);
  _shareOverlayEl = overlay;

  const popup = document.createElement('div');
  popup.className = 'share-popup';

  const rows = [];

  if (mediaUrl) {
    rows.push({ icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`, label: 'Fayl havolasi', action: () => {
      navigator.clipboard?.writeText(mediaUrl);
      toast('Fayl havolasi nusxalandi', 'info');
      _closeSharePopup();
    }});
  }

  if (!isPrivate) {
    rows.push({ icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`, label: 'Post havolasi', action: () => {
      const postUrl = window.location.origin + window.location.pathname + '#post-' + postId;
      navigator.clipboard?.writeText(postUrl);
      toast('Post havolasi nusxalandi', 'info');
      _closeSharePopup();
    }});
  }

  popup.innerHTML = rows.map((r, i) => `
    ${i > 0 ? '<div class="share-popup-divider"></div>' : ''}
    <div class="share-popup-row" data-idx="${i}">
      <span class="share-popup-icon">${r.icon}</span>
      <span>${r.label}</span>
    </div>
  `).join('');

  document.body.appendChild(popup);
  _sharePopupEl = popup;

  // Position popup above/below the button
  const rect = btn.getBoundingClientRect();
  const popW = 220;
  let left = rect.left + rect.width / 2 - popW / 2;
  let top  = rect.top - 8;
  // Clamp horizontal
  left = Math.max(8, Math.min(left, window.innerWidth - popW - 8));
  // Show above or below
  const popH = rows.length * 48 + 20;
  if (top - popH < 8) top = rect.bottom + 8;
  else top = top - popH;
  popup.style.left = left + 'px';
  popup.style.top  = top  + 'px';
  popup.style.width = popW + 'px';

  popup.querySelectorAll('.share-popup-row').forEach(row => {
    row.addEventListener('click', (e) => { e.stopPropagation(); rows[+row.dataset.idx].action(); });
  });
}

/* ── Scroll to post by URL hash ──────────────────────────────────────── */
export function scrollToPostFromHash() {
  const hash = window.location.hash;
  if (!hash.startsWith('#post-')) return;
  const postId = hash.slice(6);

  let attempts = 0;
  const tryScroll = () => {
    const el = document.querySelector(`.post[data-id="${postId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Glow / flash effect
      el.classList.add('post-highlight');
      setTimeout(() => el.classList.remove('post-highlight'), 2200);
      return;
    }
    // Post hali DOM'da yo'q (masalan, postlar hali yuklanmoqda) — bir necha
    // marta qayta urinib ko'ramiz, shunda ulashilgan link boshqa odamda ham ishlaydi
    attempts++;
    if (attempts < 8) setTimeout(tryScroll, 400);
  };
  setTimeout(tryScroll, 500);
}

function bindFeedEvents(feedEl) {
  feedEl.querySelectorAll('.vid-wrap').forEach(w => initVidWrap(w));
  feedEl.querySelectorAll('.mp-vis-btn').forEach(b => b.addEventListener('click', () => doToggleLocalVis(b.dataset.id, b)));
  feedEl.querySelectorAll('.like-btn').forEach(b => b.addEventListener('click', () => doLike(b.dataset.id, b)));
  feedEl.querySelectorAll('.del-btn').forEach(b => b.addEventListener('click', () => doDelete(b.dataset.id)));

  feedEl.querySelectorAll('.feed-sub-btn').forEach(b => b.addEventListener('click', async e => {
    e.stopPropagation();
    const uid = b.dataset.uid;
    const currently = state.myFollowing.has(uid);
    if (currently) {
      // unfollow — bu feedda bo'lmaydi, profilda amalga oshiriladi
    } else {
      state.myFollowing.add(uid);
      follow(uid, true).catch(() => {});
      // Follow qilingan barcha tugmalarni o'chirish
      feedEl.querySelectorAll(`.feed-sub-btn[data-uid="${uid}"]`).forEach(btn => btn.remove());
    }
  }));
  feedEl.querySelectorAll('.cmt-open-btn').forEach(b => b.addEventListener('click', async () => {
    const { openCmtModal } = await import('./comments.js');
    openCmtModal(b.dataset.id);
  }));
  feedEl.querySelectorAll('.share-btn').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    showSharePopup(b);
  }));
  feedEl.querySelectorAll('.ai-about-btn').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    doAiAboutPost(b.dataset.id, b);
  }));
  feedEl.querySelectorAll('.post-media').forEach(m => m.addEventListener('click', async e => {
    if (e.target.closest('.file-dl')) return;
    if (e.target.closest('.vid-controls') || e.target.closest('.vc-progress')) return;
    // Open media in zoom modal
    const { openMediaInModal } = await import('./ui.js');
    openMediaInModal(m.dataset.id);
  }));
  feedEl.querySelectorAll('.user-avi-btn').forEach(b => b.addEventListener('click', async () => {
    if (b.dataset.uid !== state.me?.uid) {
      const { openUserProfileModal } = await import('./profile.js');
      openUserProfileModal(b.dataset.uid);
    }
  }));
  feedEl.querySelectorAll('.file-dl').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    dlFile(b.dataset.url, b.dataset.name);
  }));
  // Fayl post (rasm/video bo'lmagan, lekin fayl biriktirilgan post) ustiga
  // bosilganda — faylning havolasini (Supabase url) yangi tabda ochamiz.
  // Matnli (fayl yuklanmagan) postlarda .file-card umuman render qilinmaydi,
  // shu sababli bu shart avtomatik ravishda faqat fayl yuklangan postlarga tegishli.
  feedEl.querySelectorAll('.file-card').forEach(card => card.addEventListener('click', e => {
    if (e.target.closest('.file-dl')) return; // "Yuklab olish" tugmasi o'z vazifasini bajaradi
    const url = card.dataset.url;
    if (url) window.open(url, '_blank', 'noopener');
  }));
  feedEl.querySelectorAll('.cap-more').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const cap = btn.closest('.post-caption');
      cap.classList.toggle('cap-collapsed');
      cap.classList.toggle('cap-expanded');
    });
  });
  setupFeedVideoObs(feedEl);
}

/* ── AI fikri ("✨ magic" tugma) ─────────────────────────────────────── */
// ── Taqiqlangan kontent uchun AI javob bermaydi ─────────────────────────
const BLOCKED_AI_REPLIES = [
  "Bu post taqiqlangan kontent sifatida belgilangan. AI bu post haqida fikr bildira olmaydi.",
  "AI bu post bo'yicha izoh bera olmaydi — post qoidalarga zid kontent tufayli yashirilgan.",
  "Taqiqlangan material: AI ushbu post haqida javob bermaydi.",
];

/* ── AI "thinking" animatsiyasi uchun yordamchi funksiyalar ────────────── */

// Postlar bo'yicha AI javoblar xotirasi — { postId → [{role, text}] }
const _aiPostMemory = new Map();

export async function doAiAboutPost(postId, btn) {
  if (btn.disabled) return;
  const post = state.allPosts.find(p => p.id === postId);
  if (!post) return;

  // Post aiHidden bo'lsa — AI javob bermaydi
  if (post.aiHidden) {
    const msg = BLOCKED_AI_REPLIES[Math.floor(Math.random() * BLOCKED_AI_REPLIES.length)];
    toast(msg, 'error', 5000);
    return;
  }

  // Agar bubble allaqachon ochiq bo'lsa — yopamiz (yangi javob so'raymiz)
  const postEl = btn.closest('.post');
  const existing = postEl?.querySelector('.ai-reply-bubble');
  if (existing) existing.remove();

  const origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.style.opacity = '0.5';

  // Thinking bubble
  const bubble = document.createElement('div');
  bubble.className = 'ai-reply-bubble';
  bubble.innerHTML = `
    <div class="ai-reply-header">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>
      <span>AI tahlili</span>
      <button class="ai-reply-close" aria-label="Yopish">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="ai-reply-body ai-reply-thinking"></div>`;

  // Post actions dan oldin qo'shamiz
  const actionsEl = postEl?.querySelector('.post-actions');
  if (actionsEl) actionsEl.before(bubble);
  else postEl?.append(bubble);

  // Real-status thinking UI
  const thinkingBody = bubble.querySelector('.ai-reply-body');
  const thinkUI = createThinkingUI(thinkingBody);

  // Yopish tugmasi
  bubble.querySelector('.ai-reply-close').addEventListener('click', () => {
    thinkUI.destroy();
    bubble.remove();
  });

  try {
    // Post egasining ismini cache yoki Firebase dan olamiz
    let posterName = null;
    if (post.userId) {
      try {
        if (state._userCache?.[post.userId]?.fullName) {
          posterName = state._userCache[post.userId].fullName;
        } else {
          const { doc: fsDoc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
          const uSnap = await getDoc(fsDoc(db, 'users', post.userId));
          posterName = uSnap.data()?.fullName || null;
        }
      } catch {}
    }

    // Haqiqiy izoh matnlarini Firestore dan olamiz
    thinkUI.step('comments');
    let userComments = [];
    try {
      const { collection: col, query, orderBy, limit, getDocs } =
        await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
      const isLocal = !!post._fromLocal;
      const colName = isLocal ? 'local-posts' : 'posts';
      const cmtSnap = await getDocs(
        query(col(db, colName, postId, 'comments'), orderBy('createdAt', 'asc'), limit(12))
      );
      userComments = cmtSnap.docs
        .map(d => ({ role: 'user', userName: d.data().userName || '?', text: (d.data().text || '').trim() }))
        .filter(c => c.text.length > 0);
    } catch {}

    // Bu post uchun oldingi AI javoblarini xotiradan olamiz
    const prevAiHistory = (_aiPostMemory.get(postId) || []);
    // Ikkisini birlashtirish: avval user izohlar, keyin AI javoblar (xronologiya)
    const prevComments = [...userComments, ...prevAiHistory];

    // Media URL ni resolve qilamiz
    let resolvedMediaUrl = post.mediaUrl || null;
    if (!resolvedMediaUrl && (post.mediaPath || post.storageIndex)) {
      try { resolvedMediaUrl = await getMediaUrl(post); } catch {}
    }

    const result = await aiAboutPost({
      mediaUrl:     resolvedMediaUrl,
      fileName:     post.fileName      || null,
      mediaType:    post.mediaType     || null,
      text:         post.text          || null,
      posterName,
      likes:        post.likes         ?? null,
      views:        post.views         ?? null,
      commentCount: post.commentCount  ?? null,
      createdAt:    post.createdAt     || null,
      prevComments,
      onStep:       (name) => thinkUI.step(name),
    });

    thinkUI.finish();
    const body = bubble.querySelector('.ai-reply-body');
    // Kichik pauza — oxirgi SUCCESS ko'rinsin
    await new Promise(r => setTimeout(r, 320));
    body.classList.remove('ai-reply-thinking');

    // Moderatsiyadan o'tmagan javob
    if (result?._blocked) {
      bubble.remove();
      toast('AI bu kontent uchun fikr bildira olmadi.', 'error', 4000);
      return;
    }

    bubble.classList.add('ai-mood-' + (result?.mood || 'neutral'));
    body.innerHTML = '';
    if (result?.title) {
      const h = document.createElement('div');
      h.className = 'ai-h2';
      h.textContent = result.title;
      body.append(h);
    }
    const p = document.createElement('p');
    p.className = 'ai-p';
    p.textContent = result?.comment || 'AI javob bera olmadi';
    body.append(p);

    // Javobni xotiraga saqlaymiz — keyingi "yana" bosishda takrorlanmasin
    if (result?.comment) {
      const mem = _aiPostMemory.get(postId) || [];
      mem.push({ role: 'ai', text: result.comment });
      // Xotirani 6 ta javob bilan cheklaymiz
      if (mem.length > 6) mem.shift();
      _aiPostMemory.set(postId, mem);
    }
  } catch (err) {
    thinkUI.finish();
    const body = bubble.querySelector('.ai-reply-body');
    body.classList.remove('ai-reply-thinking');
    body.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'ai-p';
    p.textContent = `Xato: ${err.message || 'AI javob bera olmadi'}`;
    body.append(p);
    body.style.color = 'var(--red, #ef4444)';
  } finally {
    btn.disabled = false;
    btn.style.opacity = '';
    btn.innerHTML = origHtml;
  }
}


/* ── Like ────────────────────────────────────────────────────────────── */
export async function doLike(postId, btn) {
  if (!state.me) return;
  const wasLiked = state.myLikedPosts.has(postId);
  const post     = state.allPosts.find(p => p.id === postId);
  const cur      = post?.likes || 0;
  const svg      = btn.querySelector('svg');
  const lc       = document.getElementById(`lc-${postId}`);

  if (wasLiked) {
    state.myLikedPosts.delete(postId);
    state._knownUnliked.add(postId);
    btn.classList.remove('liked');
    svg?.setAttribute('fill','none'); svg?.setAttribute('stroke','currentColor');
    if (lc) lc.textContent = `${Math.max(0,cur-1)} yoqtirish`;
    if (post) post.likes = Math.max(0, cur-1);
  } else {
    state.myLikedPosts.add(postId);
    state._knownUnliked.delete(postId);
    btn.classList.add('liked');
    svg?.setAttribute('fill','#f04060'); svg?.setAttribute('stroke','#f04060');
    if (lc) lc.textContent = `${cur+1} yoqtirish`;
    if (post) post.likes = cur + 1;
    btn.classList.add('like-pop');
    setTimeout(() => btn.classList.remove('like-pop'), 400);
  }

  const isLocal = !!post?._fromLocal;
  const col   = isLocal ? 'local-posts' : 'posts';
  const lRef  = doc(db, col, postId, 'likes', state.me.uid);
  const pRef  = doc(db, col, postId);
  try {
    if (wasLiked) {
      await Promise.all([
        deleteDoc(lRef),
        updateDoc(pRef, { likes: increment(-1) }).catch(() =>
          setDoc(pRef, { likes: Math.max(0,(post?.likes||1)-1) }, { merge: true })
        )
      ]);
    } else {
      await Promise.all([
        setDoc(lRef, { userId: state.me.uid, createdAt: serverTimestamp() }),
        updateDoc(pRef, { likes: increment(1) }).catch(() =>
          setDoc(pRef, { likes: (post?.likes||0)+1 }, { merge: true })
        )
      ]);
    }
  } catch {}
}

/* ── Max Private → Public / Private toggle ───────────────────────────── */
async function doToggleLocalVis(id, btn) {
  const post = state.allPosts.find(p => p.id === id);
  if (!post?._fromLocal) return;

  const nowPublic = !post._localPublic;

  // Server dagi about.json ni yangilash
  let LOCAL_SERVER = 'http://localhost:3747';
  try {
    const ctrl = await getDoc(doc(db, 'spbs-collection', 'controller'));
    if (ctrl.exists() && ctrl.data().localServerUrl) LOCAL_SERVER = ctrl.data().localServerUrl;
  } catch {}

  try {
    const idToken = await auth.currentUser?.getIdToken();
    await fetch(`${LOCAL_SERVER}/set-vis`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': idToken ? `Bearer ${idToken}` : '',
      },
      body: JSON.stringify({ id, isPublic: nowPublic }),
    });
  } catch {
    toast('Server bilan bog\'lanib bo\'lmadi', 'error'); return;
  }

  // State va UI yangilash
  post._localPublic = nowPublic;
  btn.dataset.public = nowPublic ? '1' : '0';
  btn.title = nowPublic ? 'Publicga o\'tkazilgan' : 'Faqat siz ko\'rasiz';
  btn.innerHTML = nowPublic
    ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`
    : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;

  toast(nowPublic ? 'Post public qilindi' : 'Post private qilindi', 'info');
}

/* ── Delete ──────────────────────────────────────────────────────────── */
async function doDelete(id) {
  showConfirm('Bu post butunlay o\'chiriladi.', async () => {
    const post = state.allPosts.find(p => p.id === id);
    if (post?._fromLocal) {
      // Local (Max Private) post — serverdan o'chirish
      let LOCAL_SERVER = 'http://localhost:3747';
      try {
        const ctrl = await getDoc(doc(db, 'spbs-collection', 'controller'));
        if (ctrl.exists() && ctrl.data().localServerUrl) LOCAL_SERVER = ctrl.data().localServerUrl;
      } catch {}
      const username = (post.userFullName || 'UNKNOWN').replace(/[^a-zA-Z0-9_\-]/g, '_').toUpperCase();
      const folder = post._localFolder || id;
      try {
        const idToken = await auth.currentUser?.getIdToken();
        await fetch(`${LOCAL_SERVER}/delete/${username}/${folder}`, {
          method: 'DELETE',
          headers: { 'Authorization': idToken ? `Bearer ${idToken}` : '' },
        });
      } catch {}
      state.allPosts = state.allPosts.filter(p => p.id !== id);
      toast('Post o\'chirildi', 'success');
    } else {
      await deleteDoc(doc(db,'posts',id));
      toast('Post o\'chirildi', 'success');
    }
  }, 'Postni o\'chirasizmi?');
}

/* ── Keyboard Controls ───────────────────────────────────────────────── */
/* ── patchCounts — update numbers without full re-render ─────────────── */
export function patchCounts(posts) {
  posts.forEach(p => {
    // Like count
    const lc = document.getElementById(`lc-${p.id}`);
    if (lc) lc.textContent = `${p.likes || 0} yoqtirish`;

    const rlc = document.querySelector(`.rlc-${p.id}`);
    if (rlc) rlc.textContent = `${p.likes || 0}`;

    // Comment count
    const cc = document.getElementById(`cc-${p.id}`);
    if (cc) cc.textContent = `${p.commentCount || 0} izoh`;

    const rcc = document.querySelector(`.rcmt-${p.id}`);
    if (rcc) rcc.textContent = `${p.commentCount || 0}`;

    // Post stats block (views + likes)
    const statsEl = document.querySelector(`.post[data-id="${p.id}"] .post-stats`);
    if (statsEl) {
      const spans = statsEl.querySelectorAll('span');
      if (spans[0]) spans[0].textContent = `${p.views || 0} ko'rishlar`;
      if (spans[1]) spans[1].textContent = `${p.likes || 0} yoqtirish`;
      if (spans[2]) spans[2].textContent = `${p.commentCount || 0} izoh`;
    }
  });
}

/* ── FIX: Skeleton faqat birinchi render da ──────────────────────────── */
let _feedFirstRender = true;
let _hashPostHandled = false; // link orqali kelingan postni faqat bir marta moslashtiramiz

/* ── renderFeed ────────────────────────────────────────────────────── */
export async function renderFeed() {
  if (!state.me) return;
  const feedEl = $('feed');

  // URL'da #post-<id> hash bo'lsa (masalan, "Havolani nusxalash" orqali
  // ulashilgan link), lekin o'sha post visibleN chegarasidan tashqarida
  // (ya'ni feedning pastida) bo'lsa — u hali render qilinmagan bo'ladi va
  // pastdagi scrollToPostFromHash uni topa olmay, sukut bilan hech narsa
  // qilmaydi. Shuning uchun avval postni filtered() ro'yxatida topib,
  // kerak bo'lsa visibleN ni shu postgacha (+bir oz zaxira) oshiramiz.
  if (!_hashPostHandled && window.location.hash.startsWith('#post-')) {
    const hashId = window.location.hash.slice(6);
    const all = filtered();
    const idx = all.findIndex(p => String(p.id) === String(hashId));
    if (idx !== -1) {
      if (idx >= state.visibleN) state.visibleN = Math.min(idx + 10, all.length);
      _hashPostHandled = true;
    }
    // idx === -1 bo'lsa — postlar hali to'liq yuklanmagan bo'lishi mumkin,
    // _hashPostHandled true qilinmaydi va keyingi renderFeed chaqirilganda
    // (allPosts to'liq kelganda) qayta urinib ko'riladi.
  }

  const posts  = filtered().slice(0, state.visibleN);

  // Show skeleton on first render while loading
  if (_feedFirstRender && !feedEl.querySelector('.post')) {
    feedEl.innerHTML = buildSkeletons(5);
  }
  _feedFirstRender = false;

  await renderFeedTo(feedEl, posts);

  // URL hash da post id bo'lsa — o'sha postga smooth scroll
  if (window.location.hash.startsWith('#post-')) scrollToPostFromHash();

  if (state.visibleN < filtered().length) {
    feedEl.insertAdjacentHTML('beforeend', '<div class="spin-wrap"><div class="spinner"></div></div>');
  }
  setupScroll();
}

function setupScroll() {
  window.onscroll = () => {
    const maxN = filtered().length;
    if (state.loadingMore || state.visibleN >= maxN) return;
    if (window.scrollY + window.innerHeight >= document.body.scrollHeight - 400) {
      state.loadingMore = true;
      setTimeout(async () => {
        const prevN = state.visibleN;
        state.visibleN = Math.min(prevN + 10, maxN);
        state.loadingMore = false;
        if (state.view !== 'home') return;

        const feedEl = $('feed');
        if (!feedEl) return;

        // Spinner'ni olib tashlaymiz
        feedEl.querySelector('.spin-wrap')?.remove();

        // Faqat yangi postlarni qo'shamiz (butun feed'ni qayta yozmaymiz)
        const newPosts = filtered().slice(prevN, state.visibleN);
        if (newPosts.length > 0) {
          await appendPostsToFeed(feedEl, newPosts);
        }

        if (state.visibleN < filtered().length) {
          feedEl.insertAdjacentHTML('beforeend', '<div class="spin-wrap"><div class="spinner"></div></div>');
        }
      }, 300);
    }
  };
}
/* ── FIX: setupPullToRefresh ─────────────────── */
export function setupPullToRefresh() {
    const homeView = document.getElementById('homeView');
    if (!homeView || homeView._ptrReady) return;
    homeView._ptrReady = true;

    let startY    = 0;
    let isPulling = false;
    let distance  = 0;

    homeView.addEventListener('touchstart', e => {
        if (window.scrollY <= 5) {
            startY    = e.touches[0].clientY;
            isPulling = true;
            distance  = 0;
        }
    }, { passive: true });

    homeView.addEventListener('touchmove', e => {
        if (!isPulling) return;
        distance = e.touches[0].clientY - startY;
    }, { passive: true });

    homeView.addEventListener('touchend', async () => {
        if (isPulling && distance > 130) {
            await renderFeed();
            toast('Yangilandi', 'success', 1200);
        }
        isPulling = false;
        distance  = 0;
    });
}

/* ── Feed scroll: native scroll ishlatiladi (silliq, momentum bilan) ── */
export function setupFeedScrollSensitivity() {
    // Native browser scroll intentionally used — no override needed.
    // Custom touchmove override was causing janky scroll on iOS/Android.
}
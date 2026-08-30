import { db, state, isAdmin, aiSuggestComment, rephraseAiComment, getMediaUrl, createThinkingUI } from './config.js';
import { $, esc, renderMarkdown, defAvi }          from './utils.js';
import { toast }                   from './toast.js';
import {
  collection, query, orderBy, doc, getDoc,
  getDocs, addDoc, deleteDoc, serverTimestamp,
  updateDoc, increment, setDoc, arrayUnion
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

/* ── Duplicate load oldini olish ──────────────────────────────────────── */
let _loading = false;

/* ── Open modal ───────────────────────────────────────────────────────── */
export async function openCmtModal(postId) {
  state.cmtPostId = postId;

  // Video post uchun ham AI izoh tugmasi ishlaydi
  aiCmtBtn.style.display = '';
  $('cmtModalList').innerHTML = `
    <div class="cmt-skel-row"><div class="skel skel-avi w-32px h-32px flex-shrink-0"></div><div class="flex-1 d-flex flex-col gap-6px"><div class="skel skel-line w-45pct"></div><div class="skel skel-line w-75pct h-9px opacity-60"></div></div></div>
    <div class="cmt-skel-row delay-60ms"><div class="skel skel-avi w-32px h-32px flex-shrink-0"></div><div class="flex-1 d-flex flex-col gap-6px"><div class="skel skel-line w-35pct"></div><div class="skel skel-line w-60pct h-9px opacity-60"></div></div></div>`;

  const inp = $('cmtModalInput');
  inp.value = '';
  $('cmtCharCount').textContent = '300';
  $('cmtCharCount').className   = 'cmt-char-count';
  $('cmtModal').classList.add('show');

  if (state.me) {
    getDoc(doc(db,'users',state.me.uid)).then(s => {
      const av = s.data()?.avatar || defAvi(s.data()?.fullName || 'U');
      $('cmtMyAvi').innerHTML = `<img class="w-full h-full object-cover brr-50pct" src="${av}" onerror="this.classList.add('d-none')">`;
    }).catch(() => {});
  }

  await loadCmtModal(postId);
}

/* ── Load / refresh list ──────────────────────────────────────────────── */
export async function loadCmtModal(postId) {
  // Duplicate call oldini olish
  if (_loading) return;
  _loading = true;

  const list = $('cmtModalList');
  try {
    const snap = await getDocs(
      query(collection(db, 'posts', postId, 'comments'), orderBy('createdAt','asc'))
    );
    const cmts = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Feed va post-stats da comment sonini yangilash
    const ccSpanFeed = document.getElementById(`cc-${postId}`);
    if (ccSpanFeed) ccSpanFeed.textContent = `${cmts.length} izoh`;

    // allPosts state ni sinxronlash
    const post = state.allPosts.find(p => p.id === postId);
    if (post) post.commentCount = cmts.length;

    if (!cmts.length) {
      list.innerHTML = `<div class="cmt-empty">
        <svg class="opacity-30 mb-8px" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        Hali izoh yo'q
      </div>`;
      return;
    }

    const uids = [...new Set(cmts.map(c => c.userId))];
    const uDs  = await Promise.all(uids.map(u => getDoc(doc(db,'users',u))));
    const aMap = {};
    uids.forEach((u,i) => {
      const d = uDs[i].data() || {};
      aMap[u] = d.avatar || defAvi(d.fullName);
    });

    list.innerHTML = cmts.map(c => `<div class="cmt-row" data-cmt-id="${c.id}">
      <div class="cmt-avi user-avi-btn" data-uid="${c.userId}">
        <img src="${aMap[c.userId]}" onerror="this.style.display='none'">
      </div>
      <div class="cmt-body">
        <div class="cmt-name">${esc(c.userName)}</div>
        <div class="cmt-text">${renderMarkdown(c.text)}</div>
      </div>
      ${(state.me?.uid === c.userId || isAdmin())
        ? `<button class="cmt-del" data-post="${postId}" data-cmt="${c.id}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/>
            </svg></button>`
        : ''}
    </div>`).join('');

    list.querySelectorAll('.cmt-del').forEach(b => b.addEventListener('click', async () => {
      if (b.disabled) return;
      b.disabled = true;
      try {
        await deleteDoc(doc(db, 'posts', b.dataset.post, 'comments', b.dataset.cmt));
        // commentCount ni kamaytirish (atomic)
        await updateDoc(doc(db, 'posts', b.dataset.post), {
          commentCount: increment(-1)
        }).catch(() => setDoc(doc(db, 'posts', b.dataset.post), { commentCount: 0 }, { merge: true }));
        toast('Izoh o\'chirildi', 'success');
        await loadCmtModal(b.dataset.post);
      } catch(e) {
        console.error('❌ Comment delete failed:', e);
        toast('Izohni o\'chirib bo\'lmadi', 'error');
        b.disabled = false;
      }
    }));

    list.querySelectorAll('.user-avi-btn').forEach(b => b.addEventListener('click', async () => {
      if (b.dataset.uid !== state.me?.uid) {
        $('cmtModal').classList.remove('show');
        const { openUserProfileModal } = await import('./profile.js');
        openUserProfileModal(b.dataset.uid);
      }
    }));

    list.scrollTop = list.scrollHeight;

  } catch(e) {
    console.error('❌ Izohlar load failed:', e);
    list.innerHTML = `<div class="cmt-empty">Izohlar yuklanmadi. Qayta urinib ko'ring.</div>`;
  } finally {
    _loading = false;
  }
}

/* ── Send comment ─────────────────────────────────────────────────────── */
export async function sendCmtModal() {
  const inp  = $('cmtModalInput');
  const text = inp?.value?.trim();
  if (!text || !state.cmtPostId || !state.me) return;

  const sendBtn = $('cmtModalSend');
  if (sendBtn) sendBtn.disabled = true;

  try {
    const uD = await getDoc(doc(db,'users',state.me.uid));
    const ud = uD.data() || {};

    await addDoc(collection(db, 'posts', state.cmtPostId, 'comments'), {
      userId:    state.me.uid,
      userName:  ud.fullName || state.me.displayName || 'Foydalanuvchi',
      text,
      createdAt: serverTimestamp()
    });

    // commentCount ni oshirish (atomic)
    await updateDoc(doc(db, 'posts', state.cmtPostId), {
      commentCount: increment(1)
    }).catch(() => setDoc(doc(db, 'posts', state.cmtPostId), { commentCount: 1 }, { merge: true }));

    inp.value = '';
    $('cmtCharCount').textContent = '300';
    $('cmtCharCount').className   = 'cmt-char-count';

    // DOM ni darhol yangilash
    const newCount = (state.allPosts.find(p => p.id === state.cmtPostId)?.commentCount || 0) + 1;

    const ccSpan = document.getElementById(`cc-${state.cmtPostId}`);
    if (ccSpan) ccSpan.textContent = `${newCount} izoh`;

    const rccSpan = document.querySelector(`.rcmt-${state.cmtPostId}`);
    if (rccSpan) rccSpan.textContent = `${newCount}`;

    // allPosts state ni yangilash
    const post = state.allPosts.find(p => p.id === state.cmtPostId);
    if (post) post.commentCount = newCount;

    toast('Izoh qo\'shildi', 'success');
    await loadCmtModal(state.cmtPostId);

  } catch(e) {
    console.error('❌ Comment send failed:', e);
    toast('Izohni yuborib bo\'lmadi', 'error');
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
}

/* ── Modal event listeners ────────────────────────────────────────────── */
$('cmtModalSend').onclick = sendCmtModal;
$('cmtModalInput')
$('cmtModalInput').addEventListener('input', () => {
  const len = $('cmtModalInput').value.length;
  const cnt = $('cmtCharCount');
  cnt.textContent = 300 - len;
  cnt.className   = 'cmt-char-count' + (len >= 270 ? (len >= 300 ? ' over' : ' warn') : '');
});
$('cmtModalClose').onclick = () => $('cmtModal').classList.remove('show');
$('cmtModal').addEventListener('click', e => {
  if (e.target === $('cmtModal')) $('cmtModal').classList.remove('show');
});

/* ── AI Izoh taklifi ──────────────────────────────────────────────────── */
const aiCmtBtn = document.createElement('button');
aiCmtBtn.type = 'button';
aiCmtBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></svg>';
aiCmtBtn.title = 'AI izoh taklif qilsin';
aiCmtBtn.style.cssText = 'padding:6px 10px;border-radius:50%;border:1.5px solid var(--accent,#a78bfa);background:transparent;color:var(--accent,#a78bfa);font-size:14px;cursor:pointer;flex-shrink:0;transition:all 0.2s;';
aiCmtBtn.onmouseenter = () => { aiCmtBtn.style.background = 'var(--accent,#a78bfa)'; aiCmtBtn.style.color = '#fff'; };
aiCmtBtn.onmouseleave = () => { aiCmtBtn.style.background = 'transparent'; aiCmtBtn.style.color = 'var(--accent,#a78bfa)'; };

const cmtSend = $('cmtModalSend');
if (cmtSend && cmtSend.parentNode) {
  cmtSend.parentNode.insertBefore(aiCmtBtn, cmtSend);
}

aiCmtBtn.addEventListener('click', async () => {
  $('cmtModal')?.querySelector('.ai-cmt-bubble')?.remove();

  const bubble = document.createElement('div');
  bubble.className = 'ai-cmt-bubble ai-reply-thinking';
  const inputRow = $('cmtModal')?.querySelector('.cmt-input-row');
  if (inputRow) inputRow.before(bubble);

  aiCmtBtn.disabled = true;
  const thinkUI = createThinkingUI(bubble);

  try {
    let imageUrl = null, postText = '', fileName = null, mediaType = null, pool = [];
    if (state.cmtPostId) {
      const snap = await getDoc(doc(db, 'posts', state.cmtPostId));
      if (snap.exists()) {
        const d = snap.data();
        if (d.mediaUrl) imageUrl = d.mediaUrl;
        else if (d.mediaPath || d.storageIndex) {
          try { imageUrl = await getMediaUrl({ id: state.cmtPostId, ...d }); } catch {}
        }
        postText = d.text || '';
        fileName = d.fileName || null;
        mediaType = d.mediaType || null;
        // Bu post uchun avval generatsiya qilingan takliflar pool'i bo'lsa —
        // qayta AI so'rov yubormasdan o'shani ishlatamiz.
        pool = Array.isArray(d.aiCommentSuggestion) ? d.aiCommentSuggestion : [];
      }
    }

    const CACHE_POOL_SIZE = 2;
    let suggestion;

    // Admin "AI izoh taklifi" tugmasini bossa — eski pool/rephrase keshi
    // chetlab o'tiladi, har doim yangi AI so'rov yuboriladi va natija
    // pastda pool'ni TO'LIQ ALMASHTIRADI (arrayUnion emas) — shu bilan
    // barcha foydalanuvchilar uchun yangi taklif ko'rinadi.
    const forceRegenerate = isAdmin();

    if (pool.length && !forceRegenerate) {
      if (pool.length >= CACHE_POOL_SIZE) {
        // Pool to'la — hech qanday AI so'rov yuborilmaydi.
        suggestion = pool[Math.floor(Math.random() * pool.length)].text;
      } else {
        // Pool hali to'lmagan — arzon TEXT_MODEL orqali qayta so'zlab, pool'ga qo'shamiz.
        const base = pool[Math.floor(Math.random() * pool.length)].text;
        suggestion = base;
        try {
          const variant = await rephraseAiComment(base);
          suggestion = variant;
          if (state.cmtPostId) {
            const entry = { text: variant, createdAt: Date.now() };
            updateDoc(doc(db, 'posts', state.cmtPostId), { aiCommentSuggestion: arrayUnion(entry) }).catch(() => {});
          }
        } catch {}
      }
      thinkUI.finish();
    } else {
      let prevComments = [];
      if (state.cmtPostId) {
        try {
          const cmtSnap = await getDocs(
            query(collection(db, 'posts', state.cmtPostId, 'comments'), orderBy('createdAt', 'asc'))
          );
          prevComments = cmtSnap.docs.map(d => ({ userName: d.data().userName || '?', text: d.data().text || '' }));
        } catch {}
      }

      suggestion = await aiSuggestComment(
        imageUrl, postText, fileName, mediaType, null, prevComments, state.cmtPostId,
        (name) => thinkUI.step(name)
      );

      thinkUI.finish();

      // Natijani Firestore'ga saqlaymiz: admin qayta yaratgan bo'lsa — eski
      // pool butunlay yangi natija bilan ALMASHTIRILADI (barcha uchun yangi
      // bo'ladi); oddiy user bo'lsa — pool'ning birinchi a'zosi sifatida
      // qo'shiladi va keyingi userlar arzon rephrase orqali pool'ni to'ldiradi.
      if (suggestion && state.cmtPostId) {
        const entry = { text: suggestion, createdAt: Date.now() };
        if (forceRegenerate) {
          setDoc(doc(db, 'posts', state.cmtPostId), { aiCommentSuggestion: [entry] }, { merge: true }).catch(() => {});
        } else {
          updateDoc(doc(db, 'posts', state.cmtPostId), { aiCommentSuggestion: arrayUnion(entry) })
            .catch(() => setDoc(doc(db, 'posts', state.cmtPostId), { aiCommentSuggestion: [entry] }, { merge: true }))
            .catch(() => {}); // boshqa user ulgurib yozgan bo'lsa — jim o'tkazamiz
        }
      }
    }

    if (!suggestion) {
      bubble.remove();
      toast('AI bu kontent uchun izoh taklif qila olmadi.', 'error', 4000);
      return;
    }

    bubble.classList.remove('ai-reply-thinking');
    bubble.innerHTML = `
      <p class="ai-cmt-suggestion">${suggestion.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>
      <div class="ai-cmt-actions">
        <button class="ai-cmt-ok">Inputga qo'yish</button>
        <button class="ai-cmt-cancel">Bekor</button>
      </div>`;

    bubble.querySelector('.ai-cmt-ok').addEventListener('click', () => {
      $('cmtModalInput').value = suggestion;
      $('cmtModalInput').dispatchEvent(new Event('input'));
      $('cmtModalInput').focus();
      bubble.remove();
    });
    bubble.querySelector('.ai-cmt-cancel').addEventListener('click', () => bubble.remove());

  } catch (e) {
    thinkUI.destroy();
    bubble.remove();
    toast('AI xatosi: ' + e.message, 'error');
  } finally {
    aiCmtBtn.disabled = false;
  }
});
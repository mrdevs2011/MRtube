import { auth, db, state, uploadViaController, isAdmin, clearControllerCache } from './config.js';
import { $, esc, defAvi, uToEmail, lockScroll, unlockScroll } from './utils.js';
import { toast }                       from './toast.js';
import { initPush, removePushToken }   from './push.js';
import { startChatsWatcher, stopChatsWatcher, repaintNoticeBanner } from './chat.js';
import { startCallWatcher, stopCallWatcher } from './call.js';
import { clearAllCache, cachePosts, getCachedPosts } from './local-cache.js';
import {
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, onAuthStateChanged,
  updateProfile as fbUpdateProfile,
  updateEmail,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
  collection, query, where, orderBy, limit, onSnapshot,
  doc, getDoc, setDoc, serverTimestamp, addDoc,
  updateDoc, arrayUnion, arrayRemove, deleteDoc, getDocs, writeBatch
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

/* ── Server vaqti sinxronizatsiyasi ────────────────────────────────────
   Foydalanuvchi lokal soatini o'zgartirsa ham ban muddati to'g'ri ishlaydi.
   Firestore serverTimestamp() dan real vaqt olib, local offset saqlanadi.
   serverNow() => real server vaqti (ms) — Date.now() o'rniga ishlatiladi.
─────────────────────────────────────────────────────────────────────── */
let _serverTimeOffset = 0; // ms, server - local farqi
let _serverTimeSynced = false;

async function _syncServerTime() {
  // Offline bo'lsa umuman urinmaymiz — bekorga tarmoqni kutib sarflanadigan
  // 2-3 soniya shu yerdan kelib chiqadi edi.
  if (!navigator.onLine) { _serverTimeOffset = 0; return; }
  try {
    // Firestore'ga vaqtinchalik doc yozib, serverTimestamp() ni olib o'chiramiz
    // Rule: myUid() == docId.split('_')[0] — shuning uchun uid prefiksli ID ishlatamiz
    const uid = auth.currentUser?.uid;
    if (!uid) return; // Auth yo'q bo'lsa skip
    const tmpRef = doc(db, '_servertime_sync', uid + '_tmp');
    await setDoc(tmpRef, { t: serverTimestamp() });
    const snap = await getDoc(tmpRef);
    if (snap.exists()) {
      const serverMs = snap.data().t?.toMillis?.() ?? Date.now();
      _serverTimeOffset = serverMs - Date.now();
      _serverTimeSynced = true;
    }
    // Tozalash (xato bo'lsa ham davom etaveradi)
    try { await deleteDoc(tmpRef); } catch(_) {}
  } catch (err) {
    console.warn('[Auth] Server vaqti sinxronizatsiya xatosi:', err.message);
    _serverTimeOffset = 0; // fallback: local vaqt
  }
}

/** Hozirgi haqiqiy server vaqti (ms). Date.now() o'rniga ishlating. */
function serverNow() {
  return Date.now() + _serverTimeOffset;
}

/* ── Kirish tarixi: har bir login/sessiya tiklanganda yangi yozuv ────── */
async function _logLoginHistory(uid, type) {
  try {
    await addDoc(collection(db, 'users', uid, 'loginHistory'), {
      type, // 'login' | 'session'
      at: serverTimestamp(),
      userAgent: navigator.userAgent || null,
      platform: navigator.platform || null,
    });
  } catch (_) { /* tarixni yoza olmasak ham ilova ishlashda davom etsin */ }
}

/* ── Render callbacks injected by script.js ──────────────────────────── */
let _cb = {};
export function setRenderCallbacks(callbacks) {
  _cb = callbacks;
}

/* ── Auth form state ─────────────────────────────────────────────────── */
let isLogin = true;

const authSwitchBtn = $('authSwitchBtn');
if (authSwitchBtn) {
  authSwitchBtn.onclick = () => {
    isLogin = !isLogin;
    $('authTitle').textContent      = isLogin ? 'Hisobingizga kiring' : 'Hisob yaratish';
    $('authBtn').textContent        = isLogin ? 'Kirish' : 'Ro\'yxatdan o\'tish';
    $('authSwitchText').textContent = isLogin ? 'Hisobingiz yo\'qmi? ' : 'Hisobingiz bormi? ';
    authSwitchBtn.textContent         = isLogin ? 'Ro\'yxatdan o\'tish' : 'Kirish';
    $('nameRow').style.display      = isLogin ? 'none' : 'block';
    $('confirmRow').style.display   = isLogin ? 'none' : 'block';
    $('authErr').textContent = '';
  };
}

/* ── Firebase xato kodlarini o'zbekchaga tarjima ─────────────────────── */
function fbErrUz(code) {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
      return 'Foydalanuvchi nomi yoki parol xato';
    case 'auth/email-already-in-use':
      return 'Bu login allaqachon band';
    case 'auth/weak-password':
      return `Parol kamida 6 ta belgi bo'lishi kerak`;
    case 'auth/too-many-requests':
      return `Juda ko'p urinish. Biroz kuting`;
    case 'auth/network-request-failed':
      return `Internet aloqasi yo'q`;
    case 'auth/user-disabled':
      return 'Bu hisob bloklangan';
    case 'auth/operation-not-allowed':
      return 'Bu amalga ruxsatingiz yo\'q';
    default:
      return `Xatolik yuz berdi. Qayta urinib ko'ring`;
  }
}

/* ── Domen tarixi ───────────────────────────────────────────────────────
 * uToEmail() dagi domen oxirgi 3 kunda bir necha marta o'zgargan
 * (mrtube.uz → mrspace.uz → mrdatabase.uz → mrtube.uz → mrdatabase.uz)
 * Joriy domen: mrdatabase.uz. Legacy: mrtube.uz, mrspace.uz, mrdatabase.uz.
 * lekin Firebase Auth'dagi eski akkauntlar hech qachon yangi domenga
 * migratsiya qilinmagan. Shu sabab login paytida eski domenlarni ham
 * sinab ko'ramiz — agar topilsa, shu bilan kiritamiz (parol o'zi to'g'ri,
 * faqat domen eski edi). Yangi ro'yxatdan o'tish har doim joriy domenda
 * (uToEmail) davom etadi, shuning uchun bu ro'yxat faqat LOGIN uchun. ── */
const LEGACY_EMAIL_DOMAINS = ['mrtube.uz', 'mrspace.uz', 'mrdatabase.uz'];

async function signInWithDomainFallback(usernameRaw, password) {
  const localPart = usernameRaw.toLowerCase().replace(/[^a-z0-9]/g, '');

  /* ── 1-QADAM: "/usernames/{key}" xaritasidan haqiqiy emailni topamiz ──
     Username o'zgartirilgan bo'lsa ham Firebase Auth dagi email o'zgarmaydi.
     Avval "/usernames" (faqat uid+email saqlaydigan, ochiq, MINIMAL hujjat)
     dan qidiramiz — bu to'liq /users/{uid} hujjatini (email, bio, push-token
     va h.k.) hammaga ochiq qilib qo'yishning oldini oladi.               ── */
  try {
    const unameSnap = await getDoc(doc(db, 'usernames', localPart));
    if (unameSnap.exists()) {
      const userEmail = unameSnap.data().email;
      if (userEmail) {
        try {
          return await signInWithEmailAndPassword(auth, userEmail, password);
        } catch (err) {
          // Parol xato bo'lsa — xatoni qaytaramiz (fallback ma'nosiz)
          if (err.code !== 'auth/invalid-credential') throw err;
          // Agar Firestore dagi email Firebase Auth da mavjud bo'lmasa (eski/o'chirilgan)
          // — 2-qadam (domen fallback) ga o'tishiga ruxsat beramiz
          console.warn('[Auth] Firestore email bilan login bo\'lmadi, domen fallback ga o\'tilmoqda:', userEmail);
          // throw qilmaymiz — tashqi try/catch 2-qadam ga o'tadi
        }
      }
    }
  } catch (err) {
    // Firestore query xatosi (network va h.k.) — email/domen fallback ga o'tamiz
    if (err.code && err.code.startsWith('auth/')) throw err;
    console.warn('[Auth] usernames xaritasidan qidirish muvaffaqiyatsiz, email taxmin qilishga o\'tilmoqda:', err.message);
  }

  /* ── 2-QADAM: Firestore da topilmasa — eski usul (email generatsiya) ──
     Yangi ro'yxatdan o'tganlar yoki Firestore query ishlamagan holat uchun. ── */
  const primaryEmail = uToEmail(usernameRaw);
  const fallbackEmails = LEGACY_EMAIL_DOMAINS
    .map(domain => `${localPart}@${domain}`)
    .filter(email => email !== primaryEmail);

  let lastErr;
  for (const email of [primaryEmail, ...fallbackEmails]) {
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      if (email !== primaryEmail) {
        console.warn(`⚠️ Login eski domen bilan o'tdi (${email}). Avtomatik migratsiya boshlanmoqda...`);
        // Avtomatik migratsiya: Firebase Auth emailni yangi domendaga o'tkazamiz
        try {
          await updateEmail(cred.user, primaryEmail);
          // Firestore da ham email yangilaymiz
          await updateDoc(doc(db, 'users', cred.user.uid), { email: primaryEmail });
          console.log(`✅ Migratsiya muvaffaqiyatli: ${email} → ${primaryEmail}`);
        } catch (migErr) {
          // Migratsiya xatosi login jarayonini to'xtatmasin
          console.warn(`⚠️ Migratsiya amalga oshmadi (keyingi logindan keyin qayta uriniladi):`, migErr.message);
        }
      }
      return cred;
    } catch (err) {
      lastErr = err;
      // Faqat "topilmadi/parol xato" bo'lsa keyingi domenni sinaymiz;
      // boshqa xato turlarida (network, too-many-requests, ...) darrov to'xtaymiz.
      if (err.code !== 'auth/invalid-credential') throw err;
    }
  }
  throw lastErr;
}

const authBtn = $('authBtn');
if (authBtn) {
  authBtn.onclick = async () => {
    const u = $('aUsername')?.value?.trim() || '';
    const p = $('aPassword')?.value || '';
    const e = $('authErr');

  /* ── Xato ko'rsatish: matn + shake + qizil border ── */
  const showErr = (msg, fields = []) => {
    e.textContent = msg;
    if ('vibrate' in navigator) navigator.vibrate([14, 6, 14, 6, 14]);

    /* Inputlarga qizil border */
    ['aUsername','aPassword','aConfirm','aFullname'].forEach(id => {
      const el = $(id);
      if (el) el.classList.remove('input-error');
    });
    fields.forEach(id => {
      const el = $(id);
      if (el) el.classList.add('input-error');
    });

    /* Shake animatsiya */
    const card = document.querySelector('.auth-card');
    if (card) {
      card.classList.remove('shake');
      void card.offsetWidth;
      card.classList.add('shake');
    }
  };

  /* Inputdan focus ketganda qizil borderini olib tashlash */
  ['aUsername','aPassword','aConfirm','aFullname'].forEach(id => {
    const el = $(id);
    if (el && !el._errListenerAdded) {
      el._errListenerAdded = true;
      el.addEventListener('input', () => el.classList.remove('input-error'));
    }
  });

  /* ── Validatsiya ── */
  if (!u || u.length < 1) {
    showErr(`Foydalanuvchi nomi bo'sh bo'lishi mumkin emas`, ['aUsername']);
    return;
  }
  if (!p || p.length < 6) {
    showErr(`Parol kamida 6 ta belgi bo'lishi kerak`, ['aPassword']);
    return;
  }
  e.textContent = '';
  authBtn.disabled = true;
  authBtn.textContent = isLogin ? 'Kirilmoqda...' : 'Hisob yaratilmoqda...';

  try {
    if (isLogin) {
      const cred = await signInWithDomainFallback(u, p);
      try {
        await updateDoc(doc(db, 'users', cred.user.uid), {
          lastLoginAt: serverTimestamp(),
          lastUserAgent: navigator.userAgent || null,
          lastPlatform: navigator.platform || null,
        });
        await _logLoginHistory(cred.user.uid, 'login');
      } catch (_) { /* profil yo'q bo'lsa ham loginni to'xtatmaymiz */ }
      // location.reload() kerak emas — onAuthStateChanged o'zi pending screen ko'rsatadi
      return;
    } else {
      const fn = $('aFullname').value.trim();
      const c  = $('aConfirm').value;
      if (!fn) {
        authBtn.disabled = false;
        authBtn.textContent = "Ro'yxatdan o'tish";
        showErr('Ismingizni kiriting', ['aFullname']);
        return;
      }
      if (p !== c) {
        authBtn.disabled = false;
        authBtn.textContent = "Ro'yxatdan o'tish";
        showErr('Parollar mos emas', ['aPassword','aConfirm']);
        return;
      }
      // onAuthStateChanged race condition dan himoya — createUserWithEmailAndPassword DAN OLDIN flag o'rnatamiz
      sessionStorage.setItem('mrdatabase_new_signup', '1');
      const cr = await createUserWithEmailAndPassword(auth, uToEmail(u), p);
      await fbUpdateProfile(cr.user, { displayName: fn });
      await setDoc(doc(db,'users',cr.user.uid), {
        uid: cr.user.uid, username: u, fullName: fn,
        email: uToEmail(u), bio: '', avatar: defAvi(fn),
        followers: [], following: [], createdAt: serverTimestamp(),
        approved: false
      });
      // Login paytida (autentifikatsiyasiz) username -> email topish uchun
      // ALOHIDA, kichik va ochiq "/usernames/{key}" xaritasi. Bu — to'liq
      // /users/{uid} hujjatini (email, bio, push-token va h.k.) ochiq
      // qilib qo'yishning o'rniga, faqat shu yozuv uchun kerakli minimal
      // ma'lumotni (uid+email) ochiq qiladi. `key` — login normalizatsiyasi
      // bilan bir xil (pastki registr, faqat harf-raqam).
      try {
        const unameKey = u.toLowerCase().replace(/[^a-z0-9]/g, '');
        await setDoc(doc(db,'usernames',unameKey), { uid: cr.user.uid, email: uToEmail(u) });
      } catch (unameErr) {
        console.warn('[Auth] usernames xaritasi yozilmadi:', unameErr.message);
      }
      // location.reload() kerak emas — onAuthStateChanged o'zi pending screen ko'rsatadi
    }
    } catch(err) {
      const code = err.code || '';
      console.error('❌ Auth error:', code, err.message);
      // Signup muvaffaqiyatsiz bo'lsa flagni tozalaymiz
      if (!isLogin) sessionStorage.removeItem('mrdatabase_new_signup');
      authBtn.disabled = false;
      authBtn.textContent = isLogin ? 'Kirish' : "Ro'yxatdan o'tish";
      if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) {
        showErr(fbErrUz(code), ['aUsername','aPassword']);
      } else if (code.includes('email-already-in-use')) {
        showErr(fbErrUz(code), ['aUsername']);
      } else if (code.includes('auth/')) {
        // Boshqa Firebase xatolar - to'liq xabar ko'rsatish
        showErr(code + ': ' + err.message);
      } else {
        showErr(fbErrUz(code));
      }
    }
  };
}

['aUsername','aPassword','aConfirm'].forEach(id => {
  const el = $(id);
  if (el) el
});

/* ── Parol warning modal (signup only) ────────────────────────────── */
let _pwdWarnShown = false;

function showPwdWarn() {
  if (_pwdWarnShown || isLogin) return;
  _pwdWarnShown = true;
  const overlay = $('pwdWarnOverlay');
  if (overlay) overlay.classList.add('show');
}

function hidePwdWarn() {
  const overlay = $('pwdWarnOverlay');
  if (overlay) overlay.classList.remove('show');
}

const aPassword = $('aPassword');
if (aPassword) {
  aPassword.addEventListener('focus', () => { if (!isLogin) showPwdWarn(); });
}

const pwdWarnOk = $('pwdWarnOk');
if (pwdWarnOk) {
  pwdWarnOk.addEventListener('click', hidePwdWarn);
}

const pwdWarnOverlay = $('pwdWarnOverlay');
if (pwdWarnOverlay) {
  pwdWarnOverlay.addEventListener('click', e => {
    if (e.target === pwdWarnOverlay) hidePwdWarn();
  });
}

/* Reset shown flag when switching back to login */
if (authSwitchBtn) {
  authSwitchBtn.addEventListener('click', () => {
    setTimeout(() => {
      if (isLogin) { _pwdWarnShown = false; hidePwdWarn(); }
    }, 0);
  });
}

/* ── Ruxsat kutish ekrani ────────────────────────────────────────────── */
let _approvalListener = null;
let _noticeUnsubPending = null;

function _updatePendingNotice(noticeData) {
  const container = document.getElementById('pendingNoticeWrap');
  if (!container) return;
  if (!noticeData || !noticeData.text) {
    container.style.display = 'none';
    container.textContent = '';
    return;
  }
  const t = noticeData.target || 'all';
  if (t === 'approved') {
    // Faqat tasdiqlanganlarga — kutayotganlar ko'rmasin
    container.style.display = 'none';
    container.textContent = '';
    return;
  }
  container.style.display = 'flex';
  container.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--blue,#3b82f6)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:2px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
    <span>${noticeData.text.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</span>
  `;
}

function _startPendingNoticeWatcher() {
  if (_noticeUnsubPending) return;
  _noticeUnsubPending = onSnapshot(doc(db, 'adminNotice', 'global'), snap => {
    _updatePendingNotice(snap.exists() ? snap.data() : null);
  }, () => {});
}

function _stopPendingNoticeWatcher() {
  if (_noticeUnsubPending) { _noticeUnsubPending(); _noticeUnsubPending = null; }
  _updatePendingNotice(null);
}

/* ── Blocked countdown timer ─────────────────────────────────────────── */
let _blockedCountdownInterval = null;

function _stopBlockedCountdown() {
  if (_blockedCountdownInterval) {
    clearInterval(_blockedCountdownInterval);
    _blockedCountdownInterval = null;
  }
}

function _startBlockedCountdown(blockedUntilMs, onExpire = null) {
  _stopBlockedCountdown();
  const el = document.getElementById('blockedCountdownWrap');
  if (!el) return;

  const update = () => {
    const now = serverNow();
    const diff = blockedUntilMs - now;
    if (diff <= 0) {
      el.style.display = 'none';
      _stopBlockedCountdown();
      if (typeof onExpire === 'function') onExpire();
      return;
    }
    const totalSec = Math.ceil(diff / 1000);
    const d = Math.floor(totalSec / 86400);
    const h = Math.floor((totalSec % 86400) / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;

    let parts = [];
    if (d > 0) parts.push(`${d} kun`);
    if (h > 0) parts.push(`${h} soat`);
    if (m > 0) parts.push(`${m} daqiqa`);
    parts.push(`${s} soniya`);

    const untilStr = new Date(blockedUntilMs).toLocaleString('uz-UZ');
    el.style.display = 'block';
    el.innerHTML = `
      <div style="font-size:13px;color:var(--text2,#999);margin-bottom:6px;">Blok muddati tugashiga:</div>
      <div id="blockedCountdownTimer" style="font-size:2rem;font-weight:800;color:var(--red,#ef4444);letter-spacing:1px;font-variant-numeric:tabular-nums;">${parts.join(' ')}</div>
      <div style="font-size:12px;color:var(--text2,#999);margin-top:6px;">${untilStr} gacha bloklangansiz</div>
    `;
  };

  update();
  _blockedCountdownInterval = setInterval(update, 1000);
}


function showPendingScreen(reason = 'pending', blockedUntilMs = null) {
  const screen = $('pendingApprovalScreen');
  const app    = $('app');
  const authWrap = $('authWrap');

  // Matnni holatga qarab o'zgartirish
  const h2 = screen?.querySelector('h2');
  const p  = screen?.querySelector('p');
  const countdownWrap = document.getElementById('blockedCountdownWrap');

  _stopBlockedCountdown();
  if (countdownWrap) countdownWrap.style.display = 'none';

  if (reason === 'blocked') {
    if (h2) h2.textContent = 'Hisobingiz bloklangan';
    if (p) {
      if (blockedUntilMs && blockedUntilMs > serverNow()) {
        p.innerHTML = `Siz admin tomonidan vaqtinchalik <strong style="color:var(--red,#ef4444)">bloklangansiz.</strong><br>Muddat tugagach avtomatik ochilasiz.`;
        _startBlockedCountdown(blockedUntilMs, async () => {
          // Vaqt tugadi — pending ekranni yashirib app ga kiritamiz
          // banJustExpired=true: snapshot da blocked:true kelsa ignore qilsinlar
          hidePendingScreen();
          if (state.me) {
            await _enterApp(state.me);
            _startRealtimeUserWatch(doc(db, 'users', state.me.uid), state.me, true);
          }
        });
      } else {
        p.innerHTML = `Siz admin tomonidan <strong style="color:var(--text,#fff)">bloklangansiz.</strong><br>Qo'shimcha ma'lumot uchun administratorga murojaat qiling.`;
        if (countdownWrap) countdownWrap.style.display = 'none';
      }
    }
  } else if (reason === 'rejected') {
    if (h2) h2.textContent = 'Arizangiz rad etildi';
    if (p)  p.innerHTML = `Afsuski, admin sizning arizangizni <strong style="color:var(--red,#ef4444)">rad etdi.</strong><br>Qo'shimcha ma'lumot uchun administratorga murojaat qiling.`;
  } else {
    if (h2) h2.textContent = 'Ruxsat kutilmoqda';
    if (p)  p.innerHTML = `Hisobingiz muvaffaqiyatli yaratildi.<br><strong style="color:var(--text,#fff)">Administrator ruxsatini kuting.</strong><br>Ruxsat berilgandan so'ng avtomatik kirasiz.`;
  }

  if (screen)   { screen.style.display = 'flex'; }
  if (app)      { app.classList.remove('show'); }
  if (authWrap) { authWrap.classList.remove('show'); }
  if (reason === 'pending') _startPendingNoticeWatcher();
}

function hidePendingScreen() {
  const screen = $('pendingApprovalScreen');
  if (screen) { screen.style.display = 'none'; }
  _stopPendingNoticeWatcher();
  _stopBlockedCountdown();
}

// "Chiqish" tugmasi — pending ekrandagi
const pendingSignOutBtn = $('pendingSignOutBtn');
if (pendingSignOutBtn) {
  pendingSignOutBtn.addEventListener('click', async () => {
    if (_approvalListener) { _approvalListener(); _approvalListener = null; }
    if (_activeUserUnsub) { _activeUserUnsub(); _activeUserUnsub = null; }
    hidePendingScreen();
    await signOut(auth);
    location.replace('/');
  });
}

/* ── Realtime user doc kuzatuvi ────────────────────────────────────────
 * Kirgan har bir user uchun: blok, o'chirish, ruxsat — hammasi real-time.
 * ─────────────────────────────────────────────────────────────────────── */
let _activeUserUnsub = null;

function _startRealtimeUserWatch(ref, user, banJustExpired = false) {
  if (_activeUserUnsub) { _activeUserUnsub(); _activeUserUnsub = null; }

  _activeUserUnsub = onSnapshot(ref, async snapLive => {
    // Doc o'chirilgan — hisobdan chiqaramiz
    // Yangi signup bo'lsa doc hali serverga yetib bormagan bo'lishi mumkin — signOut qilmaymiz
    if (!snapLive.exists()) {
      if (sessionStorage.getItem('mrdatabase_new_signup')) return; // race condition — kutamiz
      if (_activeUserUnsub) { _activeUserUnsub(); _activeUserUnsub = null; }
      if (_approvalListener) { _approvalListener(); _approvalListener = null; }
      try { await signOut(auth); } catch(_) {}
      location.replace('/');
      return;
    }

    const d = snapLive.data();
    const app = $('app');
    const isInApp = app && app.classList.contains('show');

    // Ban muddati allaqachon o'tgan bo'lsa — blocked tekshiruvini o'tkazib yuboramiz
    if (banJustExpired && d.blocked === true) {
      const untilChk = d.blockedUntil?.toMillis ? d.blockedUntil.toMillis() : null;
      if (untilChk && untilChk <= serverNow()) {
        // Hali admin tozalamagan — ignore qilamiz, user app da
        return;
      }
      // Admin yangi ban qo'ygan — normal holatga qaytamiz
      banJustExpired = false;
    }

    // Bloklangan
    if (d.blocked === true) {
      // blockedUntil tekshiruvi — vaqt o'tgan bo'lsa bloklamas
      const until = d.blockedUntil?.toMillis ? d.blockedUntil.toMillis() : (d.blockedUntil || null);
      if (until && until <= serverNow()) {
        // Ban muddati o'tgan — Firestore blocked:true turibdi lekin biz kiritamiz
        // onSnapshot ni to'xtatib, app ga kiritamiz (loop oldini olish)
        if (_activeUserUnsub) { _activeUserUnsub(); _activeUserUnsub = null; }
        if (!isInApp) {
          hidePendingScreen();
          await _enterApp(user);
        }
        // 5 soniyadan so'ng oddiy realtime listener qayta ulanadi
        // (admin Firestore ni tozalaguncha kutamiz)
        setTimeout(() => _startRealtimeUserWatch(ref, user, true), 5000);
        return;
      }
      // App'da yoki boshqa joyda bo'lsa — blocked screen ko'rsat (logout emas!)
      if (isInApp) {
        // Ilovadan chiqarib blocked screen ko'rsatamiz
        stopChatsWatcher();
        stopCallWatcher();
        const appEl = $('app');
        if (appEl) appEl.classList.remove('show');
      }
      showPendingScreen('blocked', until);
      return;
    }

    // Ilovada bo'lgan user uchun: approved false yoki rejected bo'lsa chiqarish
    if (isInApp && d.approved === false) {
      if (_activeUserUnsub) { _activeUserUnsub(); _activeUserUnsub = null; }
      try { await signOut(auth); } catch(_) {}
      location.replace('/');
      return;
    }

    // Pending ekranda bo'lgan user uchun: rad etildi
    if (!isInApp && d.approved === 'rejected' && d.blocked !== true) {
      showPendingScreen('rejected');
      return;
    }

    // Pending ekranda bo'lgan user uchun: ruxsat berildi
    if (!isInApp && d.approved === true && d.blocked !== true) {
      if (_activeUserUnsub) { _activeUserUnsub(); _activeUserUnsub = null; }
      hidePendingScreen();
      _enterApp(user);
      _startRealtimeUserWatch(ref, user); // qayta ulash (enterApp ichida)
      return;
    }
  }, err => {
    console.warn('[Auth] Realtime user watch error:', err.message);
  });
}

/* ── Auth state observer ─────────────────────────────────────────────── */
onAuthStateChanged(auth, async user => {
  // Har safar auth holati o'zgarganda server vaqtini sinxronlashtirish
  if (!_serverTimeSynced) {
    await _syncServerTime();
  }

  if (user) {
    state.me = user;

    // Admin nav tugmasini ko'rsatish
    try {
      const { applyAdminNav } = await import('./router.js');
      applyAdminNav();
    } catch(_) {}

    try {
      const ref  = doc(db,'users',user.uid);
      const snap = await getDoc(ref);

      if (!snap.exists()) {
        // Offline bo'lsa: bu "hujjat serverda yo'q" degani EMAS — shunchaki
        // hali mahalliy keshda yo'q. Bunday holatda signOut/reload qilish —
        // har safar qayta autentifikatsiyadan keyin AYNAN shu xatoga
        // qaytadi, ya'ni cheksiz "splash → qora ekran" loop hosil qiladi.
        // Shuning uchun offline'da signOut QILMAYMIZ.
        if (!navigator.onLine) {
          console.warn('[Auth] Offline: user hujjati keshda topilmadi — ehtiyot bilan ilovaga kiritilmoqda');
          _enterApp(user);
          _startRealtimeUserWatch(ref, user);
          return;
        }
        // Email signup race condition: setDoc hali bajarilmagan bo'lishi mumkin
        if (sessionStorage.getItem('mrdatabase_new_signup')) {
          sessionStorage.removeItem('mrdatabase_new_signup');
          showPendingScreen('pending');
          _startRealtimeUserWatch(ref, user);
          return;
        }
        // Yangi user doc yo'q — hisobdan chiqaramiz
        try { await signOut(auth); } catch(_) {}
        location.replace('/');
        return;
      } else {
        const data = snap.data();
        // Bloklangan foydalanuvchi
        if (data.blocked === true) {
          const until = data.blockedUntil?.toMillis ? data.blockedUntil.toMillis() : (data.blockedUntil || null);
          if (until && until <= serverNow()) {
            // Ban muddati o'tgan — app ga kiritamiz, listener blocked:true ni ignore qilsin
            _enterApp(user);
            _startRealtimeUserWatch(ref, user, true);
            return;
          } else {
            showPendingScreen('blocked', until);
            _startRealtimeUserWatch(ref, user);
            return;
          }
        }
        // approved === false — ruxsat kutilmoqda
        if (data.approved === false) {
          showPendingScreen('pending');
          _startRealtimeUserWatch(ref, user);
          return;
        }
        // approved === 'rejected' — rad etilgan
        if (data.approved === 'rejected') {
          showPendingScreen('rejected');
          _startRealtimeUserWatch(ref, user);
          return;
        }
      }
    } catch (err) {
      console.warn('[Auth] Failed to get/create user doc:', err.message);
      if (!navigator.onLine) {
        _enterApp(user);
        _startRealtimeUserWatch(doc(db, 'users', user.uid), user);
        return;
      }
      // Xato bo'lsa pending screen ko'rsatamiz — ruxsatsiz app ga kiritmaymiz
      showPendingScreen('pending');
      return;
    }

    _enterApp(user);
    // Ilovaga kirgan user uchun ham realtime kuzatuv
    _startRealtimeUserWatch(doc(db, 'users', user.uid), user);
  } else {
    state.me = null;
    if (_approvalListener) { _approvalListener(); _approvalListener = null; }
    if (_activeUserUnsub) { _activeUserUnsub(); _activeUserUnsub = null; }
    hidePendingScreen();
    stopChatsWatcher();
    stopCallWatcher();
    const app = $('app');
    const authWrap = $('authWrap');
    if (app) app.classList.remove('show');
    if (authWrap) authWrap.classList.add('show');
  }
});

/* ── User cache invalidation helper ────────────────────────────────── */
export function invalidateUserCache(uid) {
  if (state._userCache && uid) {
    delete state._userCache[uid];
  }
}

async function _enterApp(user) {
  const authWrap = $('authWrap');
  const app = $('app');
  if (authWrap) authWrap.classList.remove('show');
  if (app) app.classList.add('show');

  /* Faqat yangi ro'yxatdan o'tgan foydalanuvchilarga onboarding */
  if (sessionStorage.getItem('mrdatabase_new_signup')) {
    sessionStorage.removeItem('mrdatabase_new_signup');
    setTimeout(() => {
      if (typeof window._startOnboarding === 'function') window._startOnboarding(true);
    }, 1100);
  }

  await refreshMyFollowing();
  listenPosts();
  initPush();
  startChatsWatcher();
  startCallWatcher();

  // "Oxirgi faollik" — admin panelida ko'rsatish uchun
  try {
    await updateDoc(doc(db, 'users', user.uid), {
      lastSeenAt: serverTimestamp(),
      lastUserAgent: navigator.userAgent || null,
      lastPlatform: navigator.platform || null,
    });
    await _logLoginHistory(user.uid, 'session');
  } catch (_) { /* jim o'tkazib yuboramiz */ }
}

/* ── Following helpers ───────────────────────────────────────────────── */
export async function refreshMyFollowing() {
  if (!state.me) return;
  try {
    const snap = await getDoc(doc(db,'users',state.me.uid));
    state.myFollowing = new Set(snap.data()?.following || []);
  } catch (err) {
    console.warn('[Auth] Failed to refresh following:', err.message);
  }
}


/* ── Live posts listener ─────────────────────────────────────────────────
   ESLATMA: Firestore xavfsizlik qoidalari "posts" uchun resource.data ga
   bog'liq (isPublic / userId). Filtersiz "list" so'rovi (where() siz)
   Firestore tomonidan STATIK tekshiriladi — agar qoida har bir mumkin
   bo'lgan hujjat uchun to'g'ri ekanini oldindan isbotlay olmasa (chunki
   so'rov hech narsani filtrlamaydi), Firestore HAR DOIM butun so'rovni
   "Missing or insufficient permissions" bilan rad etadi — hatto haqiqatda
   qaytariladigan hujjatlar ruxsatga ega bo'lsa ham. Shu sababli oldingi
   bitta umumiy onSnapshot(query(collection(db,'posts'), orderBy(...)))
   har doim xato berardi (admin bo'lmagan har bir foydalanuvchi uchun).

   Yechim: qoidaning o'ziga mos ikkita filterlangan listener ishlatamiz —
     1) isPublic == true bo'lgan postlar (hammaga ko'rinadigan)
     2) o'zining postlari (userId == myUid, private bo'lsa ham ko'radi)
   Admin uchun esa qoida resource.data dan qat'i nazar ruxsat beradi,
   shuning uchun to'liq kolleksiyani filtersiz tinglashi mumkin.

   orderBy() ataylab so'rovdan olib tashlandi — where() + orderBy() turli
   maydonlarda composite index talab qiladi; buning o'rniga saralash
   pastda JavaScript tomonida amalga oshiriladi. ──────────────────────── */
let _postsUnsub = null;
export function listenPosts() {
  if (_postsUnsub) return; // Allaqachon tinglayapti — yana qo'shma
  if (!state.me?.uid) return; // Login bo'lmagan
  let _lastPostIds = '';

  const myUid = state.me.uid;
  let _publicDocs = [];
  let _ownDocs    = [];

  // ── KESH-BIRINCHI: internetni kutmasdan, oldingi safar saqlangan
  // postlarni DARHOL ko'rsatamiz. Firestore listener javob berishi
  // bilan (pastda) ekran jimgina haqiqiy ma'lumot bilan yangilanadi. ──
  const _cachedPosts = getCachedPosts(myUid);
  if (_cachedPosts && _cachedPosts.length) {
    state.allPosts = _cachedPosts;
    _lastPostIds = _cachedPosts.map(p => p.id).join(',');
    if (state.view === 'home')    _cb.renderFeed?.();
    if (state.view === 'reels')   _cb.renderReels?.();
    if (state.view === 'profile') _cb.renderProfile?.();
  }

  const render = async () => {
    // Ikki listenerdan kelgan natijalarni birlashtirish (id bo'yicha
    // dublikatlarsiz) va createdAt bo'yicha yangi → eski saralash
    const byId = new Map();
    for (const d of _publicDocs) byId.set(d.id, d);
    for (const d of _ownDocs)    byId.set(d.id, d);
    const firestorePosts = [...byId.values()].sort((a, b) => {
      const at = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const bt = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return bt - at;
    });

    // AI tomonidan yashirilgan postlar (aiHidden=true) hech kimga ko'rsatilmaydi —
    // egasiga ham. Faqat admin "AI Moderatsiya" panelida alohida so'rov orqali ko'radi.
    const newPosts = firestorePosts.filter(p => p.aiHidden !== true);

    // User cache update - har bir post uchun user ma'lumotini cache qilish
    const uniqueUids = [...new Set(newPosts.map(p => p.userId).filter(Boolean))];
    if (uniqueUids.length) {
      // Cache dan borlarni olib tashlash, yangilarini yuklash
      const uidsToFetch = uniqueUids.filter(uid => !state._userCache[uid]);
      if (uidsToFetch.length) {
        const userDocs = await Promise.all(uidsToFetch.map(u => getDoc(doc(db,'users',u))));
        uidsToFetch.forEach((u, i) => {
          const d = userDocs[i].data() || {};
          state._userCache[u] = {
            uid: u,
            fullName: d.fullName,
            avatar: d.avatar,
            username: d.username,
            blocked: d.blocked,
            approved: d.approved
          };
        });
      }
    }

    // Structural change detection - faqat post ID o'zgarganda re-render
    const currentIds = newPosts.map(p => p.id).join(',');
    const structural = _lastPostIds !== currentIds;

    // Like/views/commentCount o'zgarishini aniqlash
    const countChanged = state.allPosts && state.allPosts.some((oldP) => {
      const newP = newPosts.find(p => p.id === oldP.id);
      return newP && (
        newP.likes !== oldP.likes ||
        newP.views !== oldP.views ||
        newP.commentCount !== oldP.commentCount
      );
    });

    state.allPosts = newPosts;
    _lastPostIds = currentIds;

    // Keyingi safar DARHOL ko'rsatish uchun keshga yozib qo'yamiz
    // (faqat structural o'zgarish bo'lganda — like/views sonini har safar
    // keshga yozib turishning hojati yo'q).
    if (structural) cachePosts(myUid, newPosts);

    if (structural) {
      // Faqat post qo'shilganda/o'chirilganda to'liq re-render
      if (state.view === 'home')      _cb.renderFeed?.();
      if (state.view === 'reels')     _cb.renderReels?.();
      if (state.view === 'profile')   _cb.renderProfile?.();
      if (state.currentViewingUserId) {
        const modal = document.getElementById('userProfileModal');
        if (modal?.classList.contains('show')) _cb.renderUserProfileModal?.(state.currentViewingUserId);
      }
    } else if (countChanged) {
      // Faqat count o'zgarganda - patch only
      _cb.patchCounts?.(newPosts);
    }
  };

  const onErr = label => err => {
    console.warn(`[Auth] Posts listener error (${label}):`, err.message);
  };

  const POST_LIMIT = 1000; // Barcha postlarni yuklash (scroll orqali 10 tadan ko'rsatiladi)

  if (isAdmin()) {
    // Admin — qoida resource.data dan qat'i nazar ruxsat beradi
    const unsub = onSnapshot(
      query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(POST_LIMIT)),
      snap => { _publicDocs = snap.docs.map(d => ({ id: d.id, ...d.data() })); render(); },
      onErr('admin')
    );
    _postsUnsub = unsub;
  } else {
    const unsubPublic = onSnapshot(
      query(collection(db,'posts'), where('isPublic','==', true), limit(POST_LIMIT)),
      snap => { _publicDocs = snap.docs.map(d => ({ id: d.id, ...d.data() })); render(); },
      onErr('public')
    );
    const unsubOwn = onSnapshot(
      query(collection(db,'posts'), where('userId','==', myUid), limit(POST_LIMIT)),
      snap => { _ownDocs = snap.docs.map(d => ({ id: d.id, ...d.data() })); render(); },
      onErr('own')
    );
    _postsUnsub = () => { unsubPublic(); unsubOwn(); };
  }
}

/* ── Follow / Unfollow ───────────────────────────────────────────────── */
export async function follow(uid, silent = false) {
  await Promise.all([
    updateDoc(doc(db,'users',state.me.uid), { following: arrayUnion(uid) }),
    updateDoc(doc(db,'users',uid),          { followers: arrayUnion(state.me.uid) })
  ]);
  state.myFollowing.add(uid);
  if (!silent) toast('Obuna bo\'lindi', 'success');
}

export async function unfollow(uid, silent = false) {
  await Promise.all([
    updateDoc(doc(db,'users',state.me.uid), { following: arrayRemove(uid) }),
    updateDoc(doc(db,'users',uid),          { followers: arrayRemove(state.me.uid) })
  ]);
  state.myFollowing.delete(uid);
  if (!silent) toast('Obunadan chiqildi', 'info');
}

/* ── Profil edit / logout — to'liq implementatsiya ─────────────────── */

let _peAviPending = null;
let _peCoverPending = null;
let _peOriginalUsername = '';

const editProfileBtn = $('editProfileBtn');
if (editProfileBtn) {
  editProfileBtn.onclick = async () => {
    if (!state.me) return;
    const d = (await getDoc(doc(db,'users',state.me.uid))).data() || {};
    _peOriginalUsername = d.username || '';

    const editName = $('editName');
    const editBioInput = $('editBioInput');
    const editUsername = $('editUsername');
    const editWebsite = $('editWebsite');
    const editLocation = $('editLocation');
    if (editName) editName.value = d.fullName || '';
    if (editBioInput) editBioInput.value = d.bio || '';
    if (editUsername) editUsername.value = d.username || '';
    if (editWebsite) editWebsite.value = d.website || '';
    if (editLocation) editLocation.value = d.location || '';

    _peAviPending = null;
    const peAviImg = $('peAviImg');
    if (peAviImg) {
      const av = d.avatar || defAvi(d.fullName || 'U');
      peAviImg.innerHTML = `<img src="${av}" onerror="this.style.display='none'">`;
    }

    _peCoverPending = null;
    const peCoverImg = $('peCoverImg');
    if (peCoverImg) {
      if (d.coverUrl) {
        peCoverImg.style.backgroundImage = `url(${d.coverUrl})`;
        peCoverImg.style.backgroundSize = 'cover';
        peCoverImg.style.backgroundPosition = 'center';
      } else {
        peCoverImg.style.backgroundImage = '';
        peCoverImg.style.background = 'var(--glass-mid)';
      }
    }

    const peAviInput = $('peAviInput');
    const peAviEditBadge = $('peAviEditBadge');
    if (peAviEditBadge && peAviInput) {
      peAviEditBadge.onclick = () => peAviInput.click();
      peAviInput.onchange = async ev => {
        const f = ev.target.files[0];
        if (!f || !f.type.startsWith('image/')) return;
        if (f.size > 5*1024*1024) { toast("Avatar 5 MB dan kam bo'lishi kerak", 'error'); return; }
        toast('Yuklanmoqda...', 'info');
        try {
          const result = await uploadViaController(f, 'avatars');
          _peAviPending = result.url;
          if (peAviImg) peAviImg.innerHTML = `<img src="${result.url}">`;
          toast('Avatar tanlandi', 'success');
        } catch(e) { toast('Xato: ' + e.message, 'error'); }
      };
    }

    const peCoverInput = $('peCoverInput');
    const peCoverWrap = $('peCoverWrap');
    if (peCoverWrap && peCoverInput) {
      peCoverWrap.onclick = (e) => { if (e.target !== peCoverInput) peCoverInput.click(); };
      peCoverInput.onchange = async ev => {
        const f = ev.target.files[0];
        if (!f || !f.type.startsWith('image/')) return;
        if (f.size > 20*1024*1024) { toast("Rasm 20 MB dan kichik bo'lishi kerak", 'error'); return; }
        try {
          const { openCropModal } = await import('./cover-crop.js');
          const blob = await openCropModal(f);
          const croppedFile = new File([blob], 'cover.jpg', { type: 'image/jpeg' });
          toast('Cover yuklanmoqda...', 'info');
          const result = await uploadViaController(croppedFile, 'covers');
          _peCoverPending = result.url;
          if (peCoverImg) {
            peCoverImg.style.backgroundImage = `url(${result.url})`;
            peCoverImg.style.backgroundSize = 'cover';
            peCoverImg.style.backgroundPosition = 'center';
          }
          toast('Cover tanlandi ✓', 'success');
        } catch(e) {
          if (e.message !== 'cancelled') toast('Xato: ' + e.message, 'error');
        }
        peCoverInput.value = '';
      };
    }

    const profileEditOverlay = $('profileEditOverlay');
    if (profileEditOverlay) { profileEditOverlay.classList.add('show'); lockScroll(); }
  };
}

const saveProfileBtn = $('saveProfileBtn');
if (saveProfileBtn) {
  saveProfileBtn.onclick = async () => {
    if (!state.me) return;
    const fn = $('editName')?.value?.trim();
    if (!fn) { toast('Ismingizni kiriting', 'error'); return; }

    const updates = {
      fullName: fn,
      bio:      $('editBioInput')?.value?.trim() || '',
      website:  $('editWebsite')?.value?.trim() || '',
      location: $('editLocation')?.value?.trim() || '',
    };

    const rawUser = $('editUsername')?.value?.trim() || '';
    if (rawUser) {
      const cleaned = rawUser.toLowerCase().replace(/[^a-z0-9_]/g, '');
      if (cleaned.length < 1) { toast("Username bo'sh bo'lishi mumkin emas", 'error'); return; }
      updates.username = cleaned;
    }

    if (_peAviPending)   updates.avatar   = _peAviPending;
    if (_peCoverPending) updates.coverUrl  = _peCoverPending;

    try {
      await updateDoc(doc(db,'users',state.me.uid), updates);
      await fbUpdateProfile(state.me, { displayName: fn, ...(updates.avatar ? { photoURL: updates.avatar } : {}) });

      // Agar username o'zgartirilgan bo'lsa — /usernames xaritasini ham
      // yangilaymiz (eski kalitni o'chirib, yangisini yozamiz), aks holda
      // login paytidagi qidiruv eski username bilan ishlab, yangisi bilan
      // ishlamay qoladi.
      if (updates.username) {
        try {
          const oldKey = _peOriginalUsername.toLowerCase().replace(/[^a-z0-9]/g, '');
          const newKey = updates.username.toLowerCase().replace(/[^a-z0-9]/g, '');
          const email  = auth.currentUser?.email || uToEmail(updates.username);
          if (oldKey && oldKey !== newKey) {
            try { await deleteDoc(doc(db,'usernames',oldKey)); } catch(_) {}
          }
          await setDoc(doc(db,'usernames',newKey), { uid: state.me.uid, email });
        } catch (unameErr) {
          console.warn('[Auth] usernames xaritasi yangilanmadi:', unameErr.message);
        }
      }

      // Agar username o'zgartirilgan bo'lsa — eski postlardagi author maydonini ham yangilash
      if (updates.username) {
        try {
          const postsSnap = await getDocs(
            query(collection(db,'posts'), where('userId','==',state.me.uid))
          );
          if (!postsSnap.empty) {
            const batch = writeBatch(db);
            postsSnap.docs.forEach(d => batch.update(d.ref, { author: updates.username }));
            await batch.commit();
          }
        } catch(batchErr) {
          console.warn('Postlar username yangilanmadi:', batchErr);
        }
      }

      const profileEditOverlay = $('profileEditOverlay');
      if (profileEditOverlay) { profileEditOverlay.classList.remove('show'); unlockScroll(); }
      toast('Profil yangilandi', 'success');
      _cb.renderProfile?.();
    } catch(e) { toast('Xato: ' + e.message, 'error'); }
  };
}

const cancelEditBtn = $('cancelEditBtn');
if (cancelEditBtn) {
  cancelEditBtn.onclick = () => {
    const profileEditOverlay = $('profileEditOverlay');
    if (profileEditOverlay) { profileEditOverlay.classList.remove('show'); unlockScroll(); }
  };
}

const logoutBtn = $('logoutBtn');
if (logoutBtn) {
  logoutBtn.onclick = async () => {
    await removePushToken();
    clearControllerCache();
    clearAllCache();
    await signOut(auth);
    location.replace('/');
  };
}

const profileEditOverlay = $('profileEditOverlay');
if (profileEditOverlay) {
  profileEditOverlay.onclick = e => {
    if (e.target === profileEditOverlay) { profileEditOverlay.classList.remove('show'); unlockScroll(); }
  };
}

// Initialize call handlers (buttons for accept/reject/end)

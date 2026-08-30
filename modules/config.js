/**
 * MRdatabase v3 — config.js (Ultra Simple)
 * Faqat spbs-collection/controller dan o'qiydi
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
  getFirestore, initializeFirestore,
  persistentLocalCache, persistentMultipleTabManager, persistentSingleTabManager,
  doc, getDoc, setDoc, deleteDoc
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.3/+esm';
import { extractFileContent } from './file-extract.js';
import { recordTokenUsage } from './token-usage.js';

// Firebase web config — bu qiymatlar maxfiy emas (Firebase rasmiy hujjatlariga ko'ra),
// shuning uchun to'g'ridan-to'g'ri kodda saqlash xavfsiz va standart amaliyot.
// Ilgari bu /api/config orqali serverless function bilan olinardi — bu HAR BIR
// sahifa yuklanishida qo'shimcha, to'siqli (blocking) network round-trip qo'shardi,
// chunki bu modul deyarli barcha boshqa modullar tomonidan import qilinadi.
const firebaseConfig = {
  apiKey: "AIzaSyBhzWWFFgrOH84J2RIW5o7l_8192iPtbOg",
  authDomain: "code-vibe-df610.firebaseapp.com",
  projectId: "code-vibe-df610",
  storageBucket: "code-vibe-df610.firebasestorage.app",
  messagingSenderId: "747762490655",
  appId: "1:747762490655:web:a6aba637700668ebf3a42a",
};

const fbApp = initializeApp(firebaseConfig);

export { firebaseConfig };

export const auth = getAuth(fbApp);

// Firestore: mahalliy (IndexedDB) kesh yoqilgan holda ishga tushiramiz.
// Bu Firebase SDK'ning O'ZIDA tayyor bo'lgan funksiya — yoqilgach:
//  • Har bir onSnapshot/getDoc natijasi avtomatik IndexedDB'ga saqlanadi.
//  • Ilova qayta ochilganda avval KESHDAN darhol ma'lumot ko'rsatiladi,
//    fonda esa serverdan faqat O'ZGARGAN qismi (delta) tortiladi —
//    Telegram/Instagram ishlatadigan xuddi shu tamoyil.
//  • Internet umuman yo'q bo'lsa ham oldin ko'rilgan ma'lumotlar bilan
//    ilova to'liq ishlayveradi (o'qish uchun); yozishlar navbatga
//    qo'yilib, internet qaytganda avtomatik yuboriladi.
//
// 3 BOSQICHLI FALLBACK ZANJIRI:
//  1) persistentMultipleTabManager — bir nechta tab/oyna orasida keshni
//     bo'lishadi (BroadcastChannel API talab qiladi).
//  2) Ba'zi brauzer/WebView muhitlarida (masalan iOS Safari'ning ayrim
//     versiyalari, ba'zi PWA standalone rejimlari) BroadcastChannel yoki
//     multi-tab lock to'liq ishlamaydi va initializeFirestore xato
//     tashlaydi ('failed-precondition' / 'unimplemented'). Bunday holda
//     ILGARI to'g'ridan-to'g'ri KESHSIZ rejimga tushib qolinardi — bu esa
//     "offline'da postlar/chatlar yuklanmayabdi" muammosining aynan o'zi
//     edi. Endi bunday holatda avval persistentSingleTabManager bilan
//     qayta urinamiz (faqat 1 ta tab/oyna uchun, lekin IndexedDB kesh
//     baribir ishlaydi — offline o'qish saqlanib qoladi).
//  3) Agar IndexedDB'ning o'zi umuman mavjud bo'lmasa (juda eski brauzer,
//     ba'zi incognito rejimlar) — faqat shunda oddiy (keshsiz) rejimga
//     o'tamiz, ilova baribir ishlayveradi (lekin offline'da postlar/
//     chatlar ko'rinmaydi).
// experimentalAutoDetectLongPolling: ba'zi tarmoqlar (mobil operator proksisi,
// VPN, korporativ firewall) yoki Android WebView/TWA muhitida Firestore'ning
// standart WebChannel (WebSocket'ga o'xshash) oqimi barqaror ishlamay,
// "WebChannelConnection RPC 'Write' stream ... transport errored" xatosini
// beradi. Bu sozlama SDK'ga ulanish sifatini avtomatik aniqlab, kerak bo'lsa
// long-polling'ga (sekinroq, lekin ancha barqaror) o'tishga ruxsat beradi.
let _db;
try {
  _db = initializeFirestore(fbApp, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    experimentalAutoDetectLongPolling: true,
  });
} catch (err) {
  console.warn('[Firestore] Multi-tab offline kesh yoqilmadi, single-tab bilan qayta urinilmoqda:', err?.message);
  try {
    _db = initializeFirestore(fbApp, {
      localCache: persistentLocalCache({ tabManager: persistentSingleTabManager({}) }),
      experimentalAutoDetectLongPolling: true,
    });
  } catch (err2) {
    console.error('[Firestore] Offline kesh UMUMAN yoqilmadi (offline rejim ishlamaydi):', err2?.message);
    try {
      _db = initializeFirestore(fbApp, { experimentalAutoDetectLongPolling: true });
    } catch {
      _db = getFirestore(fbApp);
    }
  }
}
export const db = _db;

// ═══════════════════════════════════════════════════════════════════════
// SIMPLE CONTROLLER - Hammasi shu yerda
// ═══════════════════════════════════════════════════════════════════════

let _ctrl = null;

/** Controller cache ni tozalash (masalan logout yoki API key yangilanishida) */
export function clearControllerCache() { _ctrl = null; }

/** Controller ni olish (spbs-collection/controller) */
export async function getController() {
  // Yuklash paytida har doim yangi ma'lumot olamiz — cache upload ni buzishi mumkin
  // Oddiy ko'rish (feed, media URL) uchun cache ishlaydi, lekin upload uchun fresh data kerak
  const shouldRefresh = !_ctrl;
  if (shouldRefresh) {
    try {
      const snap = await getDoc(doc(db, 'spbs-collection', 'controller'));
      if (snap.exists()) {
        _ctrl = snap.data();
        const proj = (_ctrl.projects || {})[String(_ctrl.uploadIndex || 1)];
        if (!proj || !proj.url || !proj.anonKey) {
          console.error('⚠️ Controller: Project #' + (_ctrl.uploadIndex || 1) + ' not configured!');
          console.error('   Firebase Console → Firestore → spbs-collection/controller ni tekshiring');
        }
      } else {
        console.warn('⚠️ Controller hujjati yo\'q! Firestore\'da spbs-collection/controller yarating');
        _ctrl = { uploadIndex: 1, projects: {} };
      }
    } catch (err) {
      console.error('❌ Controller read failed:', err.message);
      console.error('   Firebase Console → Firestore Database → Rules ni tekshiring');
      throw err;
    }
  }
  return _ctrl;
}

/** Yuklash uchun controller (doim yangi ma'lumot — cache o'tkazib yuboriladi) */
export async function getControllerFresh() {
  _ctrl = null;
  return getController();
}

/** Yuklash uchun Supabase client */
export async function getUploadClient() {
  const ctrl = await getController();
  const idx = ctrl.uploadIndex || 1;
  const proj = (ctrl.projects || {})[String(idx)];

  if (!proj || !proj.url || !proj.anonKey) {
    throw new Error(`Project ${idx} not configured in controller`);
  }

  // MUHIM: auth: { persistSession: false } — bu ilovada Supabase Auth
  // umuman ishlatilmaydi (faqat Storage), lekin createClient() standart
  // holatda har chaqiriqda o'z GoTrueClient (auth) instansini yaratib,
  // bir xil localStorage kalitiga yozadi. Bir nechta instansiya bir xil
  // kalitni bo'lishganda brauzer konsolida "Multiple GoTrueClient
  // instances detected..." ogohlantirishi chiqadi. persistSession/
  // autoRefreshToken'ni o'chirish bu instansiyani butunlay yaratilishining
  // oldini oladi.
  return createClient(proj.url, proj.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Per-session cache: mediaPath → verified public URL (or null if 404) */
const _mediaUrlCache = new Map();

/** Post uchun media URL */
export async function getMediaUrl(post) {
  // Eski post (to'liq URL bilan)
  if (post.mediaUrl) return post.mediaUrl;

  // Yangi post (path + index)
  if (!post.mediaPath || !post.storageIndex) return null;

  // Cache hit — HEAD request takrorlanmasin
  const cacheKey = `${post.storageIndex}:${post.mediaPath}`;
  if (_mediaUrlCache.has(cacheKey)) return _mediaUrlCache.get(cacheKey);

  const ctrl = await getController();
  const proj = (ctrl.projects || {})[String(post.storageIndex)];

  if (!proj || !proj.url) return null;

  // Controller dan bucket olish (default: videos)
  const bucket = proj.bucket || ctrl.defaultBucket || 'videos';
  const url = `${proj.url}/storage/v1/object/public/${bucket}/${post.mediaPath}`;

  // 🔥 Agar fayl Supabase'dan o'chirilgan bo'lsa, Firebase'dan ham o'chirish
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    if (res.status === 404 || res.status === 403) {
      // Fayl yo'q! Yetim post ni o'chirish
      _mediaUrlCache.set(cacheKey, null);
      try {
        await deleteDoc(doc(db, 'posts', post.id));
        } catch (e) {
        console.error('❌ Post o\'chirishda xato:', e);
      }
      return null; // Post ko'rinmaydi
    }
  } catch (e) {
    // Tekshirishda xato bo'lsa, davom etamiz
    console.warn('⚠️ Fayl tekshiruvida xato:', e.message);
  }

  _mediaUrlCache.set(cacheKey, url);
  return url;
}

/**
 * Faylni controller orqali yuklash
 * Faqat file beriladi, qolganini controller hal qiladi
 * Admin uchun - oddiy userlar upload qilmaydi
 */
export async function uploadViaController(file, folder = 'posts') {
  const ctrl = await getControllerFresh(); // Har upload da yangi controller — eski cache yuklashni buzmaydi
  const idx = ctrl.uploadIndex || 1;
  const proj = (ctrl.projects || {})[String(idx)];

  // Project validatsiyasi (faqat xato chiqarish, fallback yo'q)
  if (!proj || !proj.url || !proj.anonKey || proj.anonKey === 'anonkey') {
    console.error('❌ Project #' + idx + ' not configured in controller');
    console.error('   Check spbs-collection/controller in Firebase');
    throw new Error('Yuklash amalga oshmadi: Project #' + idx + ' not configured. Please set uploadIndex to a valid project (1, 2, etc.)');
  }

  // Project nomini URL dan olish (mujoriozax, qnuilmvd, etc.)
  const projectName = proj.url.match(/\/\/([^.]+)\.supabase\.co/)?.[1] || 'unknown';
  // Client yaratish — auth persistensiyasi o'chirilgan (yuqoridagi
  // getUploadClient'dagi izohga qarang: "Multiple GoTrueClient instances"
  // ogohlantirishining oldini olish uchun).
  const client = createClient(proj.url, proj.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // Path yaratish (uid va timestamp bilan)
  if (!state.me) throw new Error('Tizimga kirilmagan');
  const safeName = file.name.replace(/[^\w.\-]/g, '_').replace(/_+/g, '_');
  const path = `${folder}/${state.me.uid}/${Date.now()}_${safeName}`;

  // Bucket (controller dan)
  const bucket = proj.bucket || ctrl.defaultBucket || 'videos';

  // Yuklash
  const { data, error } = await client.storage.from(bucket).upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: true,
  });

  if (error) {
    console.error('❌ Supabase:', error);
    throw error;
  }

  // Public URL olish
  const { data: { publicUrl } } = client.storage.from(bucket).getPublicUrl(data.path);

  return {
    path: data.path,
    url: publicUrl,
    storageIndex: idx,
  };
}

// Constants
export const MAX_FILE = 50 * 1024 * 1024;
export const CAP_LIMIT = 100;
// Bu yerda ham qoladi (Firestore rules kabi) — chunki bu browser client
// kodi, server-side api/_admin.js'ni import qila olmaydi (alohida bundle).
// Lekin endi kamida shu loyiha ICHIDA bitta manba: view-users.js va boshqa
// client modullar buni config.js'dan import qiladi, o'zi qayta yozmaydi.
export const ADMIN_UID = 'cS9Riz2K4xgW1i4PVboWoQfhGok2';

/** Joriy foydalanuvchi admin ekanligini tekshirish */
export function isAdmin() {
  return !!(state.me && state.me.uid === ADMIN_UID);
}

// State
export const state = {
  me: null, allPosts: [], tab: 'all', search: '', view: 'home',
  selFile: null, _objUrl: null, visibleN: 10, loadingMore: false,
  reelObs: null, viewedSet: new Set(), myFollowing: new Set(),
  myLikedPosts: new Set(), _knownUnliked: new Set(), cmtPostId: null,
  pendingReelId: null, pendingReelTime: 0, _lastPostIds: '',
  currentChatUid: null, currentChatId: null,
  globalMuted: true, currentViewingUserId: null,
  currentViewingUserPosts: [], feedVidObs: null, viewObserver: null,
  // Firestore read optimization caches
  _userCache: {},         // uid -> { fullName, avatar, ... }
  _likeStatusCache: {},   // postId -> boolean (liked/unliked)
};

// ═══════════════════════════════════════════════════════════════════════
// AI ISHLATISH CHEKLOVI (rate limit) — foydalanuvchi tomonidan ishga
// tushiriladigan AI funksiyalar (caption, izoh taklifi, "AI fikri") uchun.
// 1 daqiqa ichida 3 martadan ko'p ishlatib bo'lmaydi.
// (Avtomatik fon moderatsiyasi — aiModeratePost — bu chеklovga kirmaydi,
//  chunki u foydalanuvchi ishlatadigan funksiya emas, tizimning o'zi
//  yuklangan postni tekshiradi.)
// ═══════════════════════════════════════════════════════════════════════
const AI_RATE_WINDOW_MS = 60 * 1000;

// Har bir "kind" (funksiya turi) o'zining alohida kvotasiga ega — shunda
// caption boshqa funksiyalar (izoh taklifi, "AI fikri", rephrase) bilan
// bitta umumiy hisoblagichni bo'lishmaydi. Caption tez-tez va qulay
// ishlatiladigan funksiya bo'lgani uchun limiti kengroq.
const AI_RATE_LIMITS = {
  default: 6,    // izoh taklifi, "AI fikri", rephrase va h.k.
  caption: 20,   // AI caption — alohida, kengroq kvota
  // "MRgram AI" bot bilan yozma suhbat VA ovozli qo'ng'iroq — ikkalasi
  // ham shu bitta kvotani baham ko'radi (bir xil bot, bir xil Groq/TTS
  // infratuzilmasi). Qo'ng'iroqda tabiiy suhbat tezligi (har 5-10 soniyada
  // bir gap) buzilmasligi uchun limit boshqalarga nisbatan kengroq.
  chat: 15,
};
const AI_RATE_LS_KEY_PREFIX = 'mrgram_ai_usage_ts';

// ── Firestore: AI/_stats/rate/{uid}_{kind} → { timestamps: number[] } ───
// localStorage faqat Firestore xato bo'lganda fallback sifatida ishlatiladi.

function _lsKey(kind) { return `${AI_RATE_LS_KEY_PREFIX}:${kind}`; }

function _lsReadTs(kind) {
  try { return JSON.parse(localStorage.getItem(_lsKey(kind)) || '[]'); }
  catch { return []; }
}
function _lsWriteTs(kind, arr) {
  try { localStorage.setItem(_lsKey(kind), JSON.stringify(arr)); } catch {}
}

async function _fsReadTs(kind) {
  const uid = state.me?.uid;
  if (!uid) return null;          // tizimga kirilmagan — LS fallback
  try {
    const snap = await getDoc(doc(db, 'AI', '_stats', 'rate', `${uid}_${kind}`));
    return snap.exists() ? (snap.data().timestamps || []) : [];
  } catch { return null; }        // xato — LS fallback
}

async function _fsWriteTs(kind, arr) {
  const uid = state.me?.uid;
  if (!uid) return;
  try {
    await setDoc(doc(db, 'AI', '_stats', 'rate', `${uid}_${kind}`), { timestamps: arr, updatedAt: Date.now() });
  } catch {}
}

/** Hozir AI ishlatish mumkinmi? { allowed, waitSec }
 *  UI tugmalarida ham chaqiriladi — Firestore'dan o'qiydi.
 *  @param {string} kind - 'default' | 'caption' */
export async function aiRateLimitStatus(kind = 'default') {
  // Admin uchun hech qanday AI cheklov qo'llanmaydi (test/moderatsiya
  // ehtiyojlari uchun cheksiz foydalanish).
  if (isAdmin()) return { allowed: true, waitSec: 0 };

  const limit = AI_RATE_LIMITS[kind] ?? AI_RATE_LIMITS.default;
  const now  = Date.now();
  const fsTs = await _fsReadTs(kind);
  const arr  = (fsTs !== null ? fsTs : _lsReadTs(kind)).filter(t => now - t < AI_RATE_WINDOW_MS);
  if (arr.length >= limit) {
    const oldest  = Math.min(...arr);
    const waitSec = Math.max(1, Math.ceil((AI_RATE_WINDOW_MS - (now - oldest)) / 1000));
    return { allowed: false, waitSec };
  }
  return { allowed: true, waitSec: 0 };
}

async function _enforceAiRateLimit(kind = 'default') {
  // Admin uchun hech qanday AI cheklov qo'llanmaydi (test/moderatsiya
  // ehtiyojlari uchun cheksiz foydalanish).
  if (isAdmin()) return;

  const limit = AI_RATE_LIMITS[kind] ?? AI_RATE_LIMITS.default;
  const now  = Date.now();
  const fsTs = await _fsReadTs(kind);
  const useFs = fsTs !== null;
  const arr  = (useFs ? fsTs : _lsReadTs(kind)).filter(t => now - t < AI_RATE_WINDOW_MS);

  if (arr.length >= limit) {
    const oldest  = Math.min(...arr);
    const waitSec = Math.max(1, Math.ceil((AI_RATE_WINDOW_MS - (now - oldest)) / 1000));
    throw new Error(`AI juda tez-tez ishlatildi. ${waitSec} soniyadan keyin qayta urinib ko'ring.`);
  }

  arr.push(now);
  if (useFs) {
    await _fsWriteTs(kind, arr);
    _lsWriteTs(kind, arr);        // LS ni ham yangilaymiz (oflayn konsistentlik)
  } else {
    _lsWriteTs(kind, arr);        // Firestore xato — faqat LS
  }
}

/** _enforceAiRateLimit ning tashqi modullar (masalan mrgram-ai.js — AI
 *  yozma suhbat va ovozli qo'ng'iroq) uchun public wrapperi. Limitga
 *  tegilgan bo'lsa, ichida aniq "N soniyadan keyin qayta urinib ko'ring"
 *  degan matn bilan Error tashlaydi — chaqiruvchi shu matnni to'g'ridan-
 *  to'g'ri foydalanuvchiga ko'rsatishi mumkin. Admin uchun hech narsa
 *  qilmaydi (cheksiz). */
export async function enforceAiRateLimit(kind = 'default') {
  return _enforceAiRateLimit(kind);
}

/* ── Video kadrlarini olish (canvas orqali brauzerda) ───────────────────
 * Strategiya: video URL → <video> element → canvas.toDataURL() → base64 JPEG
 * Kadrlar soni: 4 ta (bosh, 33%, 66%, oxir) — AI uchun optimal balans.
 * Qaytaradi: string[] — base64 data-URL massivi (bo'sh massiv = muvaffaqiyatsiz)
 * ──────────────────────────────────────────────────────────────────────── */
/* ── Groq Whisper orqali ovoz → matn ────────────────────────────────────
 * audioBlob: Blob (wav/mp3/ogg/webm/m4a)
 * Qaytaradi: transkripsiya matni yoki '' (xato bo'lsa)
 * ──────────────────────────────────────────────────────────────────────── */
// `apiKey` orqaga moslik uchun qoldirilgan parametr, endi ishlatilmaydi.
export async function transcribeAudio(audioBlob, apiKey) {
  try {
    // Groq API kaliti endi faqat serverda saqlanadi (bu funksiya /api/groq-transcribe
    // orqali serverga murojaat qiladi — kalit brauzerga hech qachon yuborilmaydi).
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) return '';

    const audioBase64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(audioBlob);
    });

    const res = await fetch('/api/groq-transcribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        audioBase64,
        mimeType: audioBlob.type || 'audio/webm',
        language: 'uz',
      }),
    });
    if (!res.ok) return '';
    const data = await res.json().catch(() => ({}));
    return (data.text || '').trim();
  } catch { return ''; }
}

/* ── Matn → ovoz (TTS) — "MRgram AI" javoblarini ovozli xabar sifatida ham
 * eshittirish uchun. Microsoft Edge TTS (norasmiy, bepul, kalitsiz) orqali
 * /api/tts serverless endpointga so'rov yuboradi. Kalit yoki ro'yxatdan
 * o'tish talab qilinmaydi — server uz-UZ-SardorNeural / uz-UZ-MadinaNeural
 * ovozlaridan foydalanadi va lotin yozuvidagi matnni to'g'ridan-to'g'ri
 * qabul qiladi.
 *
 * MUHIM: Edge TTS xizmati vaqtincha ishlamay qolsa (norasmiy API bo'lgani
 * uchun rasmiy kafolat yo'q), bu funksiya JIM (xatosiz) `null` qaytaradi —
 * chaqiruvchi kod (chat.js) buni "audio yo'q, faqat matn" deb qabul qiladi,
 * hech qanday xabar/toast ko'rsatilmaydi.
 * ──────────────────────────────────────────────────────────────────────── */

/* ── "MRgram AI" ovozi — Sardor (erkak) / Madina (ayol) tanlovi ──────────
 * Foydalanuvchi tanlagan ovoz localStorage'da saqlanadi va HAM yozma
 * chatdagi TTS javoblariga, HAM ovozli qo'ng'iroqdagi (call.js) TTS'ga
 * bir xilda qo'llaniladi — bitta joydan (masalan qo'ng'iroq ekranidagi
 * tugmadan) o'zgartirilsa, hammasida darhol ta'sir qiladi. */
const AI_VOICE_LS_KEY = 'mrgramAiVoiceGender';

/** Joriy tanlangan ovozni qaytaradi: 'male' (Sardor, standart) yoki 'female' (Madina). */
export function getAiVoiceGender() {
  try {
    const v = localStorage.getItem(AI_VOICE_LS_KEY);
    return v === 'female' ? 'female' : 'male';
  } catch { return 'male'; }
}

/** Ovozni almashtiradi va saqlaydi. Qaytaradi: yangi qiymat. */
export function setAiVoiceGender(gender) {
  const v = gender === 'female' ? 'female' : 'male';
  try { localStorage.setItem(AI_VOICE_LS_KEY, v); } catch {}
  return v;
}

/** Ikkalasi orasida almashtiradi (tugma uchun qulay) — yangi qiymatni qaytaradi. */
export function toggleAiVoiceGender() {
  return setAiVoiceGender(getAiVoiceGender() === 'male' ? 'female' : 'male');
}

/** /api/tts ga so'rov yuborib, xom audio Blob'ni qaytaradi (yuklashsiz).
 * synthesizeSpeech shu yordamchidan foydalanadi. Xato bo'lsa — `null`.
 * `voice` berilmasa — foydalanuvchi tanlagan (yoki standart) ovoz ishlatiladi. */
export async function _fetchTtsBlob(text, voice) {
  if (!text || !text.trim()) return null;
  try {
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) return null;

    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
      body: JSON.stringify({ text, voice: voice || getAiVoiceGender() }),
    });

    if (!res.ok) {
      // hfkey hali yo'q yoki HF vaqtinchalik xato — jim qaytamiz, chaqiruvchi
      // kod buni "audio yo'q" deb qabul qiladi, tajriba buzilmaydi.
      const data = await res.json().catch(() => ({}));
      console.warn('[TTS] /api/tts xato:', data?.error || res.status);
      return null;
    }
    return await res.blob();
  } catch (err) {
    console.warn('[TTS] fetch xato:', err.message);
    return null;
  }
}

/** Ovoz yasab, Supabase'ga yuklaydi (doimiy chat xabari uchun — mediaUrl
 * kerak, chunki xabar keyinchalik ham o'qilishi/tinglanishi kerak).
 * Qaytaradi: { url, path, storageIndex, duration } yoki null. */
export async function synthesizeSpeech(text, voice) {
  const blob = await _fetchTtsBlob(text, voice);
  if (!blob) return null;
  try {
    const duration = await _getAudioDuration(blob).catch(() => 0);
    const ext = blob.type.includes('wav') ? 'wav' : (blob.type.includes('mpeg') ? 'mp3' : 'flac');
    const file = new File([blob], `ai_voice_${Date.now()}.${ext}`, { type: blob.type || 'audio/flac' });
    const result = await uploadViaController(file, 'chat-ai-voice');
    return { url: result.url, path: result.path, storageIndex: result.storageIndex, duration };
  } catch (err) {
    console.warn('[synthesizeSpeech] xato:', err.message);
    return null;
  }
}

/** Audio Blob'ning davomiyligini (soniya) <audio> elementi orqali o'qiydi. */
function _getAudioDuration(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    const cleanup = () => URL.revokeObjectURL(url);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      const d = isFinite(audio.duration) ? audio.duration : 0;
      cleanup();
      resolve(d);
    };
    audio.onerror = () => { cleanup(); reject(new Error('audio metadata xato')); };
    audio.src = url;
  });
}


/* ── Video kadrlarini VA audio segmentlarini birga olish ────────────────
 * Har kadr uchun:
 *   - frames[i].dataUrl  — JPEG skrinshot (base64)
 *   - frames[i].timeSec  — video dagi vaqti (soniya)
 *   - frames[i].transcript — o'sha vaqt atrofidagi ovoz matni (Whisper)
 *
 * Audio segmentlash:
 *   Har kadr atrofida ±segmentSec soniyalik oyna olinadi.
 *   Masalan: 60s video, 4 kadr → 15s, 30s, 45s, 60s
 *   15s kadr uchun: 0–22.5s audio → Whisper ga yuboriladi.
 *
 * AudioContext + MediaRecorder/OfflineAudioContext ishlatiladi —
 * to'liq videoni yuklamasdan faqat kerakli qism olinadi.
 * ──────────────────────────────────────────────────────────────────────── */
export async function extractVideoWithAudio(videoUrl, apiKey, frameCount = 'auto') {
  // MUHIM: bu qadrlar Groq vision modelining TPM (tokens-per-minute) limitiga
  // to'g'ridan-to'g'ri ta'sir qiladi — har bir kadr rasmi tokenlarga
  // aylantiriladi (o'lcham qancha katta bo'lsa, shuncha ko'p token sarflanadi).
  // Oldin 640x360 @0.72 va 10 tagacha kadr TPM limitini tez tugatib qo'yardi,
  // shu sababli o'lcham/sifat va maksimal kadr soni pasaytirildi.
  const MAX_W = 480, MAX_H = 270, QUALITY = 0.6;
  const TIMEOUT_MS = 45000;

  return new Promise(resolve => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = false;   // ovoz kerak
    video.preload = 'auto';

    const results = [];
    const timer = setTimeout(() => { cleanup(); resolve(results.filter(r => r.dataUrl)); }, TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timer);
      video.pause();
      video.removeAttribute('src');
      video.load();
    }

    // Bitta kadrni canvas orqali JPEG qilib olish
    function snapFrame() {
      try {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, MAX_W / (video.videoWidth || 640), MAX_H / (video.videoHeight || 360));
        canvas.width  = Math.round((video.videoWidth  || 640) * scale);
        canvas.height = Math.round((video.videoHeight || 360) * scale);
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', QUALITY);
      } catch { return null; }
    }

    // Audio segment: [startSec, endSec] — OfflineAudioContext bilan kesib olish
    async function extractAudioSegment(startSec, endSec) {
      return new Promise(res => {
        try {
          const segDur = endSec - startSec;
          if (segDur <= 0) return res(null);

          // <audio> element orqali o'sha qismni o'ynamiz va MediaRecorder bilan yozib olamiz
          const tempAudio = document.createElement('audio');
          tempAudio.crossOrigin = 'anonymous';
          tempAudio.src = videoUrl;
          tempAudio.preload = 'auto';

          tempAudio.addEventListener('loadedmetadata', () => {
            let ctx = null;
            try {
              ctx = new AudioContext();
              const src = ctx.createMediaElementSource(tempAudio);
              const dest = ctx.createMediaStreamDestination();
              src.connect(dest);
              src.connect(ctx.destination);   // mute qilish uchun disconnect qilmaymiz, lekin volume = 0

              const recorder = new MediaRecorder(dest.stream, { mimeType: 'audio/webm' });
              const chunks = [];
              recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
              recorder.onstop = () => {
                ctx.close().catch(() => {});
                const blob = new Blob(chunks, { type: 'audio/webm' });
                res(blob);
              };

              tempAudio.currentTime = startSec;
              tempAudio.volume = 0;   // foydalanuvchi eshitmasin
              tempAudio.addEventListener('seeked', () => {
                recorder.start();
                tempAudio.play();
                setTimeout(() => {
                  recorder.stop();
                  tempAudio.pause();
                  tempAudio.src = '';
                }, segDur * 1000 + 200);
              }, { once: true });
            } catch { ctx?.close().catch(() => {}); res(null); }
          }, { once: true });

          tempAudio.addEventListener('error', () => res(null), { once: true });
          tempAudio.load();

          // Xavfsizlik uchun timeout
          setTimeout(() => res(null), (endSec - startSec) * 1000 + 5000);
        } catch { res(null); }
      });
    }

    video.addEventListener('loadedmetadata', async () => {
      const dur = video.duration;
      if (!dur || !isFinite(dur) || dur < 0.1) { cleanup(); return resolve([]); }

      // Adaptive kadr soni: video davomiyligiga qarab avtomatik tanlanadi.
      // 'auto' yoki 0 berilsa — quyidagi jadval bo'yicha, aks holda caller qiymati ishlatiladi.
      // MUHIM: sonlar yana pasaytirildi (TPM — tokens-per-minute limitiga
      // urilmaslik va umumiy token sarfini kamaytirish uchun; endi eng
      // uzun videolarda ham 4 tadan oshmaydi — oldin 6 tagacha bo'lardi).
      // DIQQAT: bu o'zgarish sifatga OZGINA ta'sir qilishi mumkin (juda
      // uzun, ko'p sahnali videolarda kamroq kadr — kamroq tafsilot degani);
      // agar AI tahlili sifati sezilarli pasaysa, quyidagi sonlarni
      // ko'tarish kerak bo'lishi mumkin.
      const effectiveCount = (frameCount === 'auto' || !frameCount)
        ? (dur <= 20  ? 2          // ≤20s  — qisqa klib: 2 kadr yetarli
         : dur <= 60  ? 3          // ≤60s  — standart/o'rta: 3 kadr
         :              4)         //  >60s — uzun: 4 kadr (max)
        : frameCount;
      const segDur    = dur / effectiveCount;
      const positions = Array.from({ length: effectiveCount }, (_, i) => ({
        timeSec:  Math.min(dur * 0.98, segDur * (i + 0.5)),   // har segmentning o'rtasi
        segStart: segDur * i,
        segEnd:   Math.min(dur, segDur * (i + 1)),
      }));

      for (let i = 0; i < positions.length; i++) {
        const { timeSec, segStart, segEnd } = positions[i];

        // 1) Kaderni ol
        await new Promise(res => {
          video.currentTime = timeSec;
          video.addEventListener('seeked', () => {
            results[i] = { timeSec, dataUrl: snapFrame(), transcript: '' };
            res();
          }, { once: true });
        });

        // 2) Audio segmentni ol va Whisper ga yubor (kalit serverda — transcribeAudio o'zi boshqaradi)
        try {
          const audioBlob = await extractAudioSegment(segStart, segEnd);
          if (audioBlob && audioBlob.size > 1000) {
            results[i].transcript = await transcribeAudio(audioBlob) || '';
          }
        } catch { /* audio xatosi — rasm baribir bor */ }
      }

      cleanup();
      resolve(results.filter(r => r.dataUrl));
    }, { once: true });

    video.addEventListener('error', () => { cleanup(); resolve([]); }, { once: true });
    video.src = videoUrl;
    video.load();
  });
}

/* ── Faqat kadrlar (eski funksiya — orqaga moslik) ─────────────────── */
export async function extractVideoFrames(videoUrl, frameCount = 4) {
  const results = await extractVideoWithAudio(videoUrl, null, frameCount);
  return results.map(r => r.dataUrl).filter(Boolean);
}


/* ── Video/audio tahlil natijalarini AI uchun content parts ga aylantirish ──
 * results: extractVideoWithAudio() dan kelgan [{dataUrl, timeSec, transcript}]
 * Qaytaradi: Groq messages content array
 * ──────────────────────────────────────────────────────────────────────── */
function buildVideoAudioContent(results, instruction) {
  const parts = [];

  for (const r of results) {
    if (r.dataUrl) {
      parts.push({ type: 'image_url', image_url: { url: r.dataUrl } });
    }
    if (r.transcript) {
      parts.push({ type: 'text', text: `[Bu kadrda eshitilgan ovoz]: "${r.transcript}"` });
    }
  }

  const hasAudio = results.some(r => r.transcript);
  const hasVideo = results.some(r => r.dataUrl);
  const context = hasAudio && hasVideo
    ? `Yuqorida videoning ${results.length} ta kadri va ovoz transkripsiyasi berilgan. MUHIM: 1) Videodagi kontent turini ANIQ identifikatsiya qil — o'yin bo'lsa to'liq nomini ayt (masalan "Minecraft", "GTA V", "Roblox"), film/serial bo'lsa nomini, hayvon bo'lsa turini; 2) Javobingda "0-1 saniyasidagi kadr", "2s dagi kadr" kabi texnik vaqt iboralarini ISHLATMA; 3) Post egasi ismini faqat tabiiy holda ishlatish mumkin — zo'rma-zo'raki qo'shma.`
    : hasVideo
    ? `Yuqorida videoning ${results.length} ta kadri berilgan. MUHIM: 1) Videodagi kontent turini ANIQ identifikatsiya qil — o'yin bo'lsa to'liq nomini ayt (masalan "Minecraft", "GTA V", "Roblox"), film/serial bo'lsa nomini, hayvon bo'lsa turini; 2) "saniyasidagi kadr" kabi texnik iboralarni ishlatma; 3) Post egasi ismini faqat tabiiy holda ishlatish mumkin — zo'rma-zo'raki qo'shma.`
    : `Ovoz transkripsiyasi: ${results.map(r => r.transcript).filter(Boolean).join(' ')}`;

  parts.push({ type: 'text', text: `${context}\n\n${instruction}` });
  return parts;
}


// Matn uchun tez model, rasm/video uchun kuchli vision model
// ESLATMA (2026-07-07): llama-3.3-70b-versatile va
// meta-llama/llama-4-scout-17b-16e-instruct Groq tomonidan eskirgan deb
// e'lon qilingan (llama-4-scout 2026-07-17'da butunlay o'chadi). Groq'ning
// rasmiy tavsiyasiga ko'ra openai/gpt-oss-120b (matn — sezilarli yaxshiroq
// fikrlash/tabiiylik, kamroq grammatik xato) va qwen/qwen3.6-27b (vision)
// ga o'tkazildi. https://console.groq.com/docs/deprecations
const TEXT_MODEL = 'openai/gpt-oss-120b';
const VISION_MODEL = 'qwen/qwen3.6-27b';

/** Groq API orqali AI funksiyalar */
export async function groqRequest(messages, opts = {}) {
  const {
    model          = TEXT_MODEL,
    temperature    = 0.7,
    max_tokens     = 200,
    response_format = null,   // masalan: { type: 'json_object' }
    reasoning_effort = null,  // GPT-OSS modellari uchun: 'low' | 'medium' | 'high'
    // "yam-yam-yam..." kabi takrorlanish-tsikliga tushib qolishning oldini
    // olish uchun — model xuddi shu so'z/bo'g'inni qayta tanlashini
    // "jazolaydi". OpenAI-mos qiymat oralig'i: -2.0 dan 2.0 gacha.
    frequency_penalty = null,
    presence_penalty  = null,
  } = (typeof opts === 'string' ? { model: opts } : opts); // eski chaqiruvlar bilan moslik (model string sifatida)

  // Groq API kaliti endi faqat serverda saqlanadi — client to'g'ridan-to'g'ri
  // Groq'ga emas, o'zimizning /api/groq-chat proksimizga murojaat qiladi.
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error('Tizimga kirilmagan');

  const body = { model, messages, max_tokens, temperature };
  if (response_format) body.response_format = response_format;
  if (reasoning_effort) body.reasoning_effort = reasoning_effort;
  if (frequency_penalty != null) body.frequency_penalty = frequency_penalty;
  if (presence_penalty  != null) body.presence_penalty  = presence_penalty;

  const _doFetch = () => fetch('/api/groq-chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`
    },
    body: JSON.stringify(body)
  });

  let res = await _doFetch();

  // 429 (rate-limit) yoki 5xx (server xatosi) bo'lsa — bir marta qayta urinish.
  // Foydalanuvchi xato ko'rmaydi; 400 Bad Request ni qayta urinmaydi (client xatosi).
  if (res.status === 429 || (res.status >= 500 && res.status !== 400)) {
    const retryAfterSec = parseInt(res.headers.get('retry-after') || '4', 10);
    const delayMs = Math.min(retryAfterSec * 1000, 8000); // maksimum 8 soniya
    await new Promise(r => setTimeout(r, delayMs));
    res = await _doFetch();
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Groq xatosi');
  }

  // ADVANCED/DEBUG: server qaysi Groq kalitini (id — "gk1"/"legacy"/"env")
  // ishlatganini header orqali bilib olamiz — token bubble'da har bir kalit
  // qancha ishlatilgani ko'rsatiladi.
  const keyId = res.headers.get('X-Groq-Key-Id') || null;

  const data = await res.json();
  // ADVANCED/DEBUG: har bir so'rov qancha token sarflaganini (matn/rasm
  // modeliga hamda ishlatilgan kalitga ajratib) floating bubble uchun
  // yig'ib boramiz.
  if (data.usage) recordTokenUsage(model, data.usage, keyId);
  const finishReason = data.choices?.[0]?.finish_reason || null;
  // ESLATMA: gpt-oss kabi "reasoning" modellarida max_tokens byudjeti
  // ko'rinadigan javob BILAN BIRGA ichki fikrlash (reasoning) tokenlarini
  // ham qamrab oladi — shu sabab finish_reason === 'length' bo'lganda
  // chaqiruvchiga xabar berish uchun uni ham qaytaramiz (opts.onFinish orqali).
  if (opts && typeof opts === 'object' && typeof opts.onFinish === 'function') {
    try { opts.onFinish(finishReason); } catch (_) { /* jim */ }
  }
  return data.choices?.[0]?.message?.content?.trim() || '';
}

/**
 * `groqRequest`ning STREAMING (token-token, real-vaqt) versiyasi.
 * Groq'dan kelayotgan javob to'liq tayyor bo'lguncha kutish o'rniga, har bir
 * kichik bo'lak (delta) kelgan zahoti `onDelta(deltaText, fullTextSoFar)`
 * chaqiriladi — shu orqali UI Claude/ChatGPT kabi "silliq" (bir zumda
 * boshlanadigan, so'z-so'z o'sib boradigan) javob ko'rsata oladi.
 *
 * @param {Array} messages
 * @param {{model?:string, temperature?:number, max_tokens?:number}} opts
 * @param {(delta:string, fullSoFar:string)=>void} [onDelta]
 * @returns {Promise<string>} to'liq yig'ilgan matn
 */
/** "yam-yam-yam-yam..." kabi holatlarni aniqlaydi: berilgan matnning oxirgi
 * ~300 belgilik oynasida 2-15 belgidan iborat bo'lak ketma-ket 8+ marta
 * takrorlansa — bu tabiiy til uchun deyarli mumkin emas, demak model
 * degeneratsiya (takrorlanish) tsikliga tushib qolgan. Natural nutqda
 * (masalan "ha-ha-ha" yoki "yo'q, yo'q, yo'q") bunchalik ko'p ketma-ket
 * takrorlanish bo'lmaydi, shu sabab 8 marta chegarasi xato signal berish
 * xavfini deyarli yo'qqa chiqaradi. */
function _detectRepetitionLoop(text) {
  const tail = text.slice(-300);
  return /(.{2,15}?)\1{7,}/i.test(tail);
}

/** Takrorlanish tsikli aniqlanganda — matnni aynan o'sha tsikl
 * boshlangan joydan kesib tashlaydi, shunda foydalanuvchi/xabar tarixida
 * faqat tsiklgacha bo'lgan (tushunarli) qism qoladi. */
function _trimRepetitionTail(text) {
  const windowStart = Math.max(0, text.length - 300);
  const tail = text.slice(windowStart);
  const m = tail.match(/(.{2,15}?)\1{7,}/i);
  if (!m) return text;
  const cutAt = windowStart + m.index;
  return text.slice(0, cutAt).replace(/[\s,.\-–—:;]+$/, '').trim();
}

export async function groqRequestStream(messages, opts = {}, onDelta) {
  const {
    model       = TEXT_MODEL,
    temperature = 0.7,
    max_tokens  = 800,
    frequency_penalty = null,
    presence_penalty  = null,
  } = (typeof opts === 'string' ? { model: opts } : opts);

  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error('Tizimga kirilmagan');

  // stream_options.include_usage: true — Groq/OpenAI-mos oqim (SSE)
  // yakunida alohida ("choices" bo'sh) hodisa ichida `usage` maydonini ham
  // yuboradi. Shu orqali streaming so'rovlarda ham token bubble'ini
  // yangilay olamiz (aks holda faqat oddiy so'rovlarda usage kelardi).
  const body = { model, messages, max_tokens, temperature, stream: true, stream_options: { include_usage: true } };
  if (frequency_penalty != null) body.frequency_penalty = frequency_penalty;
  if (presence_penalty  != null) body.presence_penalty  = presence_penalty;

  const res = await fetch('/api/groq-chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok || !res.body) {
    let message = 'Groq xatosi';
    try {
      const err = await res.json();
      message = err.error?.message || err.error || message;
    } catch (_) { /* jim — javob JSON emas bo'lishi mumkin */ }
    throw new Error(message);
  }

  // ADVANCED/DEBUG: streaming javobda ham server qaysi Groq kalitini
  // ishlatganini header orqali bilib olamiz (bir marta — butun oqim
  // davomida bitta kalit ishlatiladi).
  const keyId = res.headers.get('X-Groq-Key-Id') || null;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  // Oqim HAQIQATDA 'stop' (tabiiy tugash) bilan yakunlanganmi — buni
  // aniq kuzatamiz. MUHIM: agar server (Vercel funksiya vaqt limiti —
  // groq-chat.js'dagi maxDuration, yoki tarmoq uzilishi) oqimni
  // o'rtada, hech qanday finish_reason yubormasdan to'xtatib qo'ysa,
  // pastdagi `while` sikli shunchaki `done:true` bilan "muvaffaqiyatli"
  // tugagandek ko'rinadi — va bu holat aniqlanmasa, kesilgan matn xuddi
  // to'liq javobdek qaytariladi. Shu sabab faqat finish_reason==='length'
  // emas, balki "'stop' bilan tugamagan har qanday holat"ni ham
  // "chaqiruvchi davom ettirsin" (onFinish) deb belgilaymiz.
  let sawFinishReason = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE oqimi "\n\n" bilan ajratilgan hodisalardan iborat, lekin xavfsizlik
    // uchun har bir qatorni ("data: ...") alohida qayta ishlaymiz — oxirgi
    // (hali to'liq kelmagan) qatorni keyingi chunk bilan birlashtirish uchun
    // bufferда saqlab qolamiz.
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      const dataStr = line.slice(5).trim();
      if (!dataStr || dataStr === '[DONE]') continue;
      try {
        const json = JSON.parse(dataStr);
        // Oqim yakunidagi hodisada delta bo'sh, lekin finish_reason keladi
        // ('stop' — tabiiy tugadi, 'length' — max_tokens byudjeti tugab,
        // javob KESIB TASHLANDI). Buni chaqiruvchiga (opts.onFinish) yetkazamiz,
        // shunda kesilgan javobni davom ettirish mumkin bo'ladi.
        const finishReason = json.choices?.[0]?.finish_reason;
        if (finishReason) {
          sawFinishReason = finishReason;
          if (opts && typeof opts === 'object' && typeof opts.onFinish === 'function') {
            try { opts.onFinish(finishReason); } catch (_) { /* jim */ }
          }
        }
        const delta = json.choices?.[0]?.delta?.content || '';
        if (delta) {
          full += delta;
          onDelta?.(delta, full);

          // Takrorlanish (degeneratsiya) tsikliga tushib qolinganmi —
          // tekshiramiz. Aniqlansa: oqimni DARHOL bekor qilamiz (keyingi
          // token'larni kutmaymiz — aks holda max_tokens'gacha bir xil
          // so'zni qaytaraveradi), matnni tsikl boshlangan joydan kesib,
          // UI'ga tozalangan yakuniy holatni yuboramiz va shu bilan
          // funksiyadan chiqamiz.
          if (_detectRepetitionLoop(full)) {
            full = _trimRepetitionTail(full);
            onDelta?.('', full);
            try { await reader.cancel(); } catch (_) { /* jim */ }
            // MUHIM: bu yerda ham chaqiruvchiga (opts.onFinish) xabar berish
            // shart — aks holda finishReason 'null' qolib ketadi va yuqorida
            // (mrgram-ai.js) qo'shilgan "'stop'dan boshqa har qanday holat —
            // kesilgan javob" mantig'i ishga tushmaydi, natijada takrorlanish
            // sabab kesilgan (ko'pincha jumla o'rtasida tugagan) javob
            // tekshirilmasdan "to'liq" deb saqlanib qolar edi.
            sawFinishReason = 'repetition';
            if (opts && typeof opts === 'object' && typeof opts.onFinish === 'function') {
              try { opts.onFinish(sawFinishReason); } catch (_) { /* jim */ }
            }
            return full.trim();
          }
        }
        // ADVANCED/DEBUG: oqim yakunidagi maxsus ("choices" bo'sh) usage
        // hodisasi — token bubble uchun.
        if (json.usage) recordTokenUsage(model, json.usage, keyId);
      } catch (_) {
        // Chunk hali to'liq JSON emas yoki noma'lum format — e'tiborsiz qoldiramiz
      }
    }
  }

  // Oqim 'stop' bilan tugamagan (masalan server/tarmoq oqimni o'rtada
  // uzib qo'ygan, yoki finish_reason umuman kelmagan) — buni ham
  // "kesilgan javob" sifatida chaqiruvchiga bildiramiz, aks holda
  // (masalan Vercel funksiya vaqt limitiga tegib qolganda) javob
  // o'rtada kesilgan holda "to'liq" deb saqlanib qolaveradi.
  if (full && sawFinishReason !== 'stop' && opts && typeof opts === 'object' && typeof opts.onFinish === 'function') {
    try { opts.onFinish(sawFinishReason || 'length'); } catch (_) { /* jim */ }
  }

  return full.trim();
}

/**
 * VISION_MODEL (qwen) endi faqat "ko'zi" sifatida ishlatiladi — rasm/video
 * kadrini NEYTRAL, batafsil tasvirlab beradi, xolos. Yakuniy (caption/izoh/
 * "AI fikri") matnni yozish vazifasi TEXT_MODEL'ga (gpt-oss-120b) yuklatiladi.
 *
 * SABAB: qwen (VISION_MODEL) fon moderatsiyasi (aiModeratePost) tomonidan
 * ham ishlatiladi va shu TPM (daqiqalik token) budjeti barcha
 * foydalanuvchilar/funksiyalar o'rtasida umumiy. Vision modelga faqat
 * qisqa "tasvirlash" vazifasini berish (creative yozish emas) uning
 * yukini sezilarli kamaytiradi, og'ir/ijodiy matn yozish esa alohida
 * (kamroq band) TEXT_MODEL budjetiga o'tadi.
 */
async function _describeImageForText(imageUrl) {
  return groqRequest([
    {
      role: 'system',
      content: 'Sen rasmni tasvirlovchi yordamchisan. Vazifang — rasmda ko\'rinayotgan narsalarni ANIQ va BATAFSIL, lekin qisqa (3-5 jumla) tasvirlash: kim/nima bor, muhit, harakat, kayfiyat/holat, agar taniqli o\'yin/film/serial/anime bo\'lsa nomini aniq ayt. Baho berma, caption yoki izoh YOZMA — faqat ob\'ektiv tasvirla.',
    },
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: imageUrl } },
        { type: 'text', text: `Rasmda nima ko'rinmoqda? Aniq va batafsil tasvirla. Agar taniqli o'yin/film/serial/anime bo'lsa nomini aniq ayt.` },
      ],
    },
  ], { model: VISION_MODEL, temperature: 0.3, max_tokens: 180 });
}

async function _describeVideoFramesForText(results) {
  const parts = [];
  for (const r of results) {
    if (r.dataUrl) parts.push({ type: 'image_url', image_url: { url: r.dataUrl } });
  }
  parts.push({
    type: 'text',
    text: `Yuqorida videoning ${results.length} ta kadri berilgan. Videoda nima sodir bo'layotganini ANIQ va BATAFSIL tasvirla: kontent turi (o'yin/film/serial/anime bo'lsa to'liq nomini ayt), muhit, harakat, kayfiyat. Baho berma, caption yoki izoh YOZMA — faqat ob'ektiv tasvirla.`,
  });
  return groqRequest([
    { role: 'system', content: 'Sen video kadrlarini tasvirlovchi yordamchisan. Faqat ob\'ektiv, batafsil tasvirlab ber — caption yoki izoh yozma.' },
    { role: 'user', content: parts },
  ], { model: VISION_MODEL, temperature: 0.3, max_tokens: 220 });
}

/* ── Umumiy (postga bog'liq) "neytral tasvir" keshi ───────────────────────
   aiGenerateCaption, aiSuggestComment va aiAboutPost — uchalasi ham AYNAN
   bir xil vazifani (rasm/video kadrini neytral, ob'ektiv tasvirlash)
   bajaradi va endi AYNAN bir xil promptdan foydalanadi (yuqoridagi ikkita
   funksiya). Bitta post uchun bularning bir nechtasi ishga tushsa — qwen
   (VISION_MODEL) bir xil ishni bir necha marta qilib o'tirmasin deb, natija
   posts/{postId}.visionDesc (rasm) / .visionDescVideo (video) maydonida
   saqlanadi: birinchi chaqiruv AI'ga murojaat qilib natijani keshlaydi,
   qolganlari esa shu keshdan o'qiydi. Caption/izoh/tahlil matni AYNAN bir
   xil manba tasviridan kelib chiqqani uchun sifat o'zgarmaydi.

   DIQQAT: aiModeratePost bunga QO'SHILMAYDI — u ataylab boshqacha, "klinik"
   (yumshatmasdan, baho bermasdan tasvirlaydigan) promptdan foydalanadi;
   xavfsizlik uchun bu har doim ALOHIDA so'rov sifatida qoladi. ─────────── */
async function _describeImageShared(postId, imageUrl) {
  if (postId) {
    try {
      const snap = await getDoc(doc(db, 'posts', postId));
      const cached = snap.data()?.visionDesc;
      if (cached) return cached;
    } catch (_) { /* o'qib bo'lmasa — oddiy AI so'rovga o'tamiz */ }
  }
  const description = await _describeImageForText(imageUrl);
  if (postId && description) {
    setDoc(doc(db, 'posts', postId), { visionDesc: description }, { merge: true }).catch(() => {});
  }
  return description;
}

async function _describeVideoShared(postId, results) {
  if (postId) {
    try {
      const snap = await getDoc(doc(db, 'posts', postId));
      const cached = snap.data()?.visionDescVideo;
      if (cached) return cached;
    } catch (_) { /* o'qib bo'lmasa — oddiy AI so'rovga o'tamiz */ }
  }
  const description = await _describeVideoFramesForText(results);
  if (postId && description) {
    setDoc(doc(db, 'posts', postId), { visionDescVideo: description }, { merge: true }).catch(() => {});
  }
  return description;
}

/**
 * Fayl (rasm, video, yoki har qanday boshqa format: html/css/js/txt/pdf/
 * docx/xlsx/pptx/zip/exe/apk/iso) bo'yicha AI caption.
 *
 * source: rasm uchun eski usulda to'g'ridan-to'g'ri data-URL/URL berish
 *         mumkin (orqaga moslik uchun), yoki { source, fileName, mimeType }
 *         obyekti — bu holda source URL string yoki local File/Blob bo'lishi
 *         mumkin, fayl turi avtomatik aniqlanadi va kerak bo'lsa haqiqiy
 *         matn mazmuni (pdf/docx/xlsx/pptx/zip/text) ajratib olinadi.
 */
/* ── sessionStorage bilan zaxiralangan kesh ────────────────────────────────
   Oddiy JS Map() sahifa yangilansa (F5) yoki admin sahifani qayta ochsa
   butunlay yo'qoladi — shu sababli bir xil rasm/URL (masalan bir xil post,
   bir xil profil rasmi) qayta ishlatilganda ham AI qayta so'raladi. Bu
   klass xuddi oddiy Map kabi ishlaydi (.get/.set/.has — barcha chaqiruvchi
   kod o'zgarishsiz qoladi), lekin:
     • ochilganda avval sessionStorage'dan mavjud yozuvlarni o'qib oladi;
     • .set() chaqirilganda natijani sessionStorage'ga ham yozadi.
   Shu bilan bir xil BROWSER TAB sessiyasi davomida (tab yopilmaguncha)
   sahifa necha marta qayta yuklansa ham kesh ishlayveradi.
   Xavfsizlik choralari:
     • Juda uzun kalitlar (masalan rasm base64 data-URL) sessionStorage'ga
       YOZILMAYDI — ular faqat operativ xotirada (Map) qoladi, chunki
       storage kvotasini tez to'ldirib qo'yishi mumkin va baribir deyarli
       hech qachon aynan takrorlanmaydi.
     • Yozish/o'qishda xato (kvota to'lgan, private-mode va h.k.) bo'lsa —
       jim o'tkaziladi, ilova ishlashiga hech qanday ta'sir qilmaydi.
     • Eng ko'pi bilan MAX_ENTRIES ta yozuv saqlanadi (eskisi chiqariladi),
       shu bilan sessionStorage cheksiz o'sib ketmaydi. ────────────────────*/
const SESSION_CACHE_MAX_KEY_LEN = 600;
const SESSION_CACHE_MAX_ENTRIES = 150;

class PersistentCache extends Map {
  constructor(storageKey) {
    super();
    this._storageKey = storageKey;
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const obj = JSON.parse(raw);
        for (const k of Object.keys(obj)) super.set(k, obj[k]);
      }
    } catch (_) { /* sessionStorage yo'q/bloklangan yoki buzilgan — bo'sh boshlaymiz */ }
  }
  set(key, value) {
    super.set(key, value);
    if (typeof key === 'string' && key.length <= SESSION_CACHE_MAX_KEY_LEN) {
      try {
        while (this.size > SESSION_CACHE_MAX_ENTRIES) {
          const oldestKey = this.keys().next().value;
          if (oldestKey === undefined) break;
          super.delete(oldestKey);
        }
        const obj = {};
        for (const [k, v] of this) {
          if (k.length <= SESSION_CACHE_MAX_KEY_LEN) obj[k] = v;
        }
        sessionStorage.setItem(this._storageKey, JSON.stringify(obj));
      } catch (_) { /* kvota to'lgan va h.k. — jim o'tkazamiz */ }
    }
    return this;
  }
}

// ─── Caption keshi: URL → string (bir xil fayl uchun AI qayta chaqirilmaydi) ──
// File/Blob obyektlari doim noyob bo'lgani uchun ular keshlashga kirmaydi.
// Base64 (data-URL) kalitlar juda uzun bo'lgani uchun sessionStorage'ga
// yozilmaydi (yuqoridagi PersistentCache o'zi shuni avtomatik hal qiladi) —
// faqat haqiqiy (qisqa) URL kalitlar sessiyalar orasida saqlanadi.
const _captionCache = new PersistentCache('mrgram_caption_cache_v2');

async function _aiGenerateCaptionImpl(source, fileName, mimeType, uploaderName, onStep, onVisionDesc) {
  onStep?.('preparing');
  // Diqqat: rasm/video captionlari uchun limit YO'Q (cheksiz). Limit faqat
  // audio va boshqa (html/pdf/docx/...) fayl captionlari uchun qo'llanadi
  // — shu ikkalasi pastda, mos joyida alohida chaqiriladi.

  // Faqat birinchi ismni olamiz
  const uploaderFirst = uploaderName
    ? uploaderName.trim().split(/[\s\d.]+/)[0] || uploaderName
    : null;

  // Uslub namunalari (few-shot) — faqat OHANG/UZUNLIK uchun yo'l-yo'riq,
  // mazmuni quyidagi haqiqiy postga aloqasi yo'q. Model namunani mazmunan
  // ko'chirib qo'ymasligi uchun buni alohida ta'kidlaymiz.
  const CAPTION_FEWSHOT = `

Namunalar (faqat USLUB va UZUNLIK uchun — mazmunini ko'chirma, har doim pastda berilgan HAQIQIY post asosida yoz):
- Kontent: pitsa rasmi → Caption: "Nihoyat shu pitsani tatib ko'rdim, mazasi battamom boshqacha ekan 😋"
- Kontent: tog'da sayohat videosi → Caption: "Bugun tog'ga chiqdik, manzarasi hayratlanarli edi"`;

  // Upload konteksti: caption uploader nomidan, 1-shaxsda yoziladi
  const uploaderCtx = (uploaderFirst
    ? `Sen "${uploaderFirst}" ismli foydalanuvchisan va o'z postingga caption yozyapsan. Captionni birinchi shaxsda (men, mening, bugun kabi) yoz — xuddi o'sha odam o'zi yozayotgandek. Uchinchi shaxsda YOZMA.`
    : `Sen ijtimoiy tarmoq foydalanuvchisisisan va o'z postingga caption yozyapsan. Captionni tabiiy, birinchi shaxsda yoz.`)
    + CAPTION_FEWSHOT;

  // Orqaga moslik: eski chaqiruvlar shunchaki rasm data-URL/URL berardi (rasm — limitsiz)
  // IKKI BOSQICH: qwen (VISION_MODEL) faqat rasmni tasvirlab beradi, yakuniy
  // captionni esa gpt-oss (TEXT_MODEL) yozadi — shu orqali qwen'ning umumiy
  // TPM budjeti (moderatsiya bilan bo'lishiladigan) kamroq band bo'ladi.
  if (typeof source === 'string' && !fileName && !mimeType) {
    const description = await _describeImageForText(source);
    onVisionDesc?.(description);
    return groqRequest([
      { role: 'system', content: uploaderCtx },
      { role: 'user', content: `Rasm tasviri: "${description}"\nShu tasvir asosida qisqa, tabiiy o'zbek tilida caption yaz. Faqat captionni yoz, boshqa hech narsa yozma. 1-2 jumla bo'lsin.` }
    ], { model: TEXT_MODEL, max_tokens: 150, temperature: 1.0, reasoning_effort: 'low' });
  }

  // Video — kadr + audio segment birga (limitsiz)
  if ((mimeType || '').startsWith('video/')) {
    onStep?.('video');
    // Groq kaliti serverda (extractVideoWithAudio → transcribeAudio → /api/groq-transcribe)
    const results = (typeof source === 'string')
      ? await extractVideoWithAudio(source, null, 'auto')
      : [];
    if (results.length > 0) {
      onStep?.('thinking');
      // 1-bosqich: qwen kadrlarni tasvirlaydi. 2-bosqich: gpt-oss shu
      // tasvir + audio transkripsiya asosida captionni yozadi.
      const hasAudio = results.some(r => r.transcript);
      const audioHint = hasAudio
        ? `\n\n[Bu kadrlarda eshitilgan ovoz]: "${results.map(r => r.transcript).filter(Boolean).join(' ')}"`
        : '';
      const description = await _describeVideoFramesForText(results);
      return groqRequest([
        { role: 'system', content: uploaderCtx },
        { role: 'user', content: `Video tasviri: "${description}"${audioHint}\nShu mazmun asosida qisqa, tabiiy o'zbek tilida birinchi shaxsda caption yaz. Faqat captionni yaz, 1-2 jumla.` }
      ], { model: TEXT_MODEL, max_tokens: 150, temperature: 1.0, reasoning_effort: 'low' });
    }
    onStep?.('thinking');
    return groqRequest([{ role: 'system', content: uploaderCtx }, { role: 'user', content: "Video post uchun qisqa, tabiiy o'zbek tilida birinchi shaxsda caption yaz. Faqat captionni yaz, 1-2 jumla." }], { max_tokens: 150, reasoning_effort: 'low' });
  }

  if ((mimeType || '').startsWith('audio/')) {
    await _enforceAiRateLimit('caption');
    let transcript = '';
    onStep?.('audio');
    // Groq kaliti serverda (transcribeAudio /api/groq-transcribe orqali ishlaydi)
    if (source instanceof Blob) {
      transcript = await transcribeAudio(source);
    } else if (typeof source === 'string') {
      try {
        const blob = await fetch(source).then(r => r.blob());
        transcript = await transcribeAudio(blob);
      } catch {}
    }
    onStep?.('thinking');
    const audioDesc = transcript
      ? `Ovoz fayli transkripsiyasi: "${transcript}"`
      : `Ovoz fayli: "${fileName || 'audio'}"`;
    return groqRequest([
      { role: 'system', content: uploaderCtx },
      { role: 'user', content: `${audioDesc}\nShu asosida qisqa, tabiiy o'zbek tilida birinchi shaxsda caption yaz. Faqat captionni yaz, 1-2 jumla.` }
    ], { max_tokens: 150, temperature: 1.0, reasoning_effort: 'low' });
  }

  onStep?.('file');
  const info = await extractFileContent(source, fileName, mimeType);
  onStep?.('thinking');

  if (info.kind === 'image') {
    // Rasm ekanligi endi aniqlandi — limitsiz. IKKI BOSQICH: qwen faqat
    // tasvirlaydi, gpt-oss yakuniy captionni yozadi.
    const description = await _describeImageForText(source);
    onVisionDesc?.(description);
    return groqRequest([
      { role: 'system', content: uploaderCtx },
      { role: 'user', content: `Rasm tasviri: "${description}"\nShu tasvir asosida qisqa, tabiiy o'zbek tilida birinchi shaxsda caption yaz. Faqat captionni yoz, boshqa hech narsa yozma. 1-2 jumla bo'lsin.` }
    ], { model: TEXT_MODEL, max_tokens: 150, temperature: 1.0, reasoning_effort: 'low' });
  }

  // Boshqa fayl turlari (html/css/js/pdf/docx/...) — limit qo'llanadi
  await _enforceAiRateLimit('caption');
  const base = `"${fileName || 'fayl'}" (.${info.ext || '?'}) nomli fayl post sifatida yuklanmoqda.`;
  const body = info.kind === 'extracted'
    ? `Fayl mazmuni quyida berilgan:\n"""\n${info.text}\n"""\nShu mazmun asosida qisqa, tabiiy o'zbek tilida birinchi shaxsda post caption yoz.`
    : `${info.text}\nShu ma'lumot asosida qisqa, tabiiy o'zbek tilida birinchi shaxsda post caption yoz.`;

  return groqRequest([
    { role: 'system', content: uploaderCtx },
    { role: 'user', content: `${base}\n${body}\n1-2 jumla, kerak bo'lsa emoji ishlatish mumkin. Faqat captionni yoz.` }
  ], { max_tokens: 150, temperature: 1.0, reasoning_effort: 'low' });
}

/** Caption generatsiyasi — bir xil URL uchun AI qayta chaqirilmaydi.
 *  onVisionDesc(desc) — ixtiyoriy: rasm uchun hisoblangan neytral tasvir
 *  tayyor bo'lganda chaqiriladi (chaqiruvchi buni keyinroq, post
 *  yaratilgandan so'ng, posts/{id}.visionDesc sifatida saqlashi mumkin —
 *  shunda aiSuggestComment/aiAboutPost qwen'ni qayta chaqirmasdan shu
 *  tasvirni qayta ishlatadi). */
export async function aiGenerateCaption(source, fileName, mimeType, uploaderName, onStep, onVisionDesc) {
  const cacheKey = (typeof source === 'string') ? `caption:${source}` : null;
  if (cacheKey && _captionCache.has(cacheKey)) return _captionCache.get(cacheKey);
  const result = await _aiGenerateCaptionImpl(source, fileName, mimeType, uploaderName, onStep, onVisionDesc);
  if (cacheKey && result) _captionCache.set(cacheKey, result);
  return result;
}


/**
 * Postni AI orqali moderatsiya qilish (sex / zo'ravonlik / haqorat va h.k.)
 * Faqat tekshiradi va natijani qaytaradi — hech narsani o'chirmaydi.
 *
 * IKKI BOSQICHLI tekshiruv ishlatiladi, chunki bitta so'rovda vision model
 * ko'pincha "chiroyli caption yozish" rejimiga o'tib ketadi va ochiq-sochiq/
 * jinsiy mazmunni ko'rmaganday "kulgili", "quvonchli" deb yozib yuboradi:
 *   1-bosqich: model rasmda LITERAL nima ko'rinishini (baho bermasdan,
 *              hech narsani yumshatmasdan) sovuq-klinik tarzda tasvirlaydi.
 *   2-bosqich: shu tasvir + post matni asosida qattiq qoidalar bilan
 *              flagged: true/false deb hukm chiqaradi (temperature: 0,
 *              JSON majburiy, shubhali holatda "flagged: true" tomonga
 *              og'ish — false negative dan false positive afzalroq).
 *
 * { flagged: boolean, reason: string }
 */
// ─── Moderatsiya keshi: (imageUrl + text) → { flagged, reason } ────────────
// Bir xil mediaURL va matn ikkinchi marta yuklanganda AI qayta chaqirilmaydi.
// Endi sessionStorage bilan zaxiralangan — sahifa qayta yuklansa ham (F5,
// admin sahifani qayta ochsa) bir xil post/rasm uchun kesh ishlayveradi.
const _moderationCache = new PersistentCache('mrgram_moderation_cache_v2');

export async function aiModeratePost({ imageUrl, text, light = false } = {}) {
  if (!imageUrl && !text) return { flagged: false, reason: '' };

  // Kesh tekshiruvi — bir xil rasm/matn kombinatsiyasini qayta tahlil qilmaymiz
  const cacheKey = `mod:${light ? 'light:' : ''}${imageUrl || ''}::${text || ''}`;
  if (_moderationCache.has(cacheKey)) return _moderationCache.get(cacheKey);

  let visualDescription = '';

  /* ── 1-BOSQICH: neytral, "caption" emas — klinik tasvir ── */
  if (imageUrl) {
    try {
      visualDescription = await groqRequest([
        {
          role: 'system',
          content: 'Sen rasmlarni audit qiluvchi texnik tizimsan. Vazifang — rasmda LITERAL '
            + 'ko\'rinayotgan narsalarni sovuq, klinik, baho bermaydigan tilda sanab o\'tish. '
            + 'Hech qachon "go\'zal", "kulgili", "quvonchli", "yoqimli" kabi ijobiy/baho beruvchi '
            + 'so\'zlardan FOYDALANMA. Faqat ob\'ektiv kuzatuvlarni yoz: nechta odam bor, ular nima '
            + 'kiyimda (yoki kiyim yo\'qligi), tana holati/pozasi, jismoniy aloqa xarakteri, fonda '
            + 'nima bor. Agar tasvirda yalang\'ochlik, jinsiy harakat yoki yaqin jismoniy aloqa '
            + 'bo\'lsa — buni ham aniq va to\'g\'ridan-to\'g\'ri yoz, yashirmang yoki yumshatmang.',
        },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: imageUrl } },
            { type: 'text', text: 'Rasmda nima ko\'rinmoqda? Faqat ob\'ektiv tasvirni yoz, 3-5 jumla.' }
          ]
        }
      ], { model: VISION_MODEL, temperature: 0, max_tokens: 250 });
    } catch (err) {
      console.warn('⚠️ AI moderatsiya (1-bosqich) xatosi:', err.message);
    }
  }

  /* ── 2-BOSQICH: flagged true/false ──
     light=false → oddiy (postlar uchun) qoidalar
     light=true  → yengil (guruh xabarlari uchun) qoidalar: faqat aniq va
                   og'ir holatlarda bloklaydi, shubhali/chegaraviy holatlarni
                   o'tkazib yuboradi (false negative false positive'dan afzal). */
  const judgeSystem = light
    ? `Sen ijtimoiy tarmoq (MRgram) guruh xabarlari uchun YENGIL kontent moderatori AI'san.
Vazifang — faqat ANIQ va OG'IR qoidabuzarliklarni aniqlash. Oddiy, kundalik, hazil, janjal
yoki chegaraviy xabarlarni BLOKLAMA — faqat quyidagilar aniq-ravshan mavjud bo'lsa "flagged": true qaytar:
- Ochiq-oydin jinsiy kontent (yalang'ochlik, porno, fohishalik taklifi);
- Aniq zo'ravonlik chaqirig'i yoki tahdid, qurol bilan real tahdid;
- Og'ir nafrat tili (millat/din/irq asosida haqorat);
- O'z joniga qasd qilishga aniq undash.
Shubha bo'lsa yoki holat noaniq bo'lsa — "flagged": false qaytar. Oddiy so'kinish, kinoya,
hazil, bahs-munozara — bularning barchasi "flagged": false.

Faqat quyidagi JSON formatda javob qaytar, boshqa hech narsa yozma (markdown ham kerak emas):
{"flagged": true yoki false, "reason": "qisqa o'zbek tilida sabab, 1 jumla"}`
    : `Sen ijtimoiy tarmoq (MRgram) uchun kontent moderatori AI'san.
Vazifang — quyidagi ma'lumotlar asosida postni bloklash kerakligini hal qilish.
Maqsad — Google Play/Google Photos darajasidagi standart: faqat ANIQ va OCHIQ-OYDIN
og'ir holatlarni bloklash, chegaraviy yoki "ehtimol" holatlarni O'TKAZIB YUBORISH.

"flagged": true qaytarishing kerak bo'lgan holatlar (faqat ANIQ-RAVSHAN ko'rinib turgan bo'lsa):
- Ochiq porno darajasidagi jinsiy kontent: jinsiy a'zolarning ochiq ko'rinishi, jinsiy aloqa/harakat tasviri, fohishalik/jinsiy xizmat taklifi. (Kupalnik, ich kiyim reklamasi, plyaj fotosi, boks/sport, tibbiy/ilmiy kontent, san'at — bularning barchasi NORMAL, blok QILINMAYDI);
- Og'ir zo'ravonlik: haqiqiy o'lim, jarohat, qiynoq tasvirlari (film/o'yin/multfilm sahnalari emas);
- Og'ir nafrat tili: millat/din/irq asosida ochiq haqorat yoki zo'ravonlikka chaqiruv;
- O'z joniga qasd qilishga ochiq undash yoki uslubini o'rgatish.

Oddiy kiyim, sport, tibbiy, ta'lim, hazil, san'at yoki kundalik kontentni HECH QACHON blokLAMA.
Faqat chindan ham qoidabuzarlik 100% aniq ko'rinib turgan holatlarda "true" qaytar; ozgina
shubha bo'lsa ham — "flagged: false" deb belgila.

Faqat quyidagi JSON formatda javob qaytar, boshqa hech narsa yozma (markdown ham kerak emas):
{"flagged": true yoki false, "reason": "qisqa o'zbek tilida sabab, 1 jumla"}`;

  const judgeUserParts = [];
  if (visualDescription) judgeUserParts.push(`Rasm tasviri (AI tomonidan): "${visualDescription}"`);
  judgeUserParts.push(`Post matni: ${text ? `"${text}"` : '(matn yo\'q)'}`);
  // Agar tasvir 1-bosqichda olinmagan bo'lsa (masalan video post), rasmni
  // to'g'ridan-to'g'ri ham yuboramiz — model ba'zan to'g'ridan-to'g'ri ko'rib
  // yaxshiroq baholay oladi.
  const judgeContent = imageUrl && !visualDescription
    ? [{ type: 'image_url', image_url: { url: imageUrl } }, { type: 'text', text: judgeUserParts.join('\n') }]
    : judgeUserParts.join('\n');

  const judgeModel = (imageUrl && !visualDescription) ? VISION_MODEL : TEXT_MODEL;
  try {
    const raw = await groqRequest([
      { role: 'system', content: judgeSystem },
      { role: 'user', content: judgeContent },
    ], {
      model: judgeModel, temperature: 0, max_tokens: 200,
      response_format: { type: 'json_object' },
      // Reasoning model (gpt-oss-120b) bo'lsa — reasoning_effort:low
      // bermasak, ichki fikrlash 200 tokenlik limitni yeb qo'yib, JSON
      // yarim yo'lda kesilib qolishi mumkin (vision model bunga muhtoj emas).
      ...(judgeModel === TEXT_MODEL ? { reasoning_effort: 'low' } : {}),
    });

    const parsed = JSON.parse(raw);
    const result = {
      flagged: !!parsed.flagged,
      reason: String(parsed.reason || '').slice(0, 300),
    };
    _moderationCache.set(cacheKey, result); // muvaffaqiyatli natijani keshlash
    return result;
  } catch (err) {
    console.warn('⚠️ AI moderatsiya (2-bosqich) xatosi:', err.message);
    return { flagged: false, reason: '' }; // Xato bo'lsa — postni o'chirmaymiz (xavfsiz fallback)
  }
}

/** Post fayli (rasm/video/html/css/js/txt/pdf/docx/xlsx/pptx/zip/exe/apk/iso va h.k.) bo'yicha AI izoh taklifi */
/** Post fayli bo'yicha AI izoh taklifi — NEYTRAL uslubda (barcha userlar uchun bitta,
 *  cache qilinadigan natija bo'lgani sababli, biror bir aniq shaxs nomidan yozilmaydi). */
export async function aiSuggestComment(mediaUrl, postText, fileName, mediaType, commenterName, prevComments, postId, onStep) {
  onStep?.('preparing');
  await _enforceAiRateLimit();

  // Uslub namunalari (few-shot) — faqat OHANG/UZUNLIK uchun, mazmunini
  // ko'chirmasin deb alohida ta'kidlanadi.
  const COMMENT_FEWSHOT = `

Namunalar (faqat USLUB va UZUNLIK uchun — mazmunini ko'chirma, har doim pastda berilgan HAQIQIY post asosida yoz):
- Kontent: kechki ovqat fotosi → Izoh: "Voy zo'r ekan, ishtaha ochib yubordi 😄"
- Kontent: yangi mashina sotib olgani haqida post → Izoh: "Tabriklaymiz, juda chiroyli rang tanlangan!"`;

  // Neytral kontekst — aniq bir foydalanuvchi nomidan emas, umumiy taklif sifatida
  // (bu taklif Firestore'da postga bog'lab keshlanadi va barcha userlarga bir xil
  // ko'rsatiladi, shuning uchun "sen X ismli odamsan" kabi shaxsiylashtirish bo'lmasligi kerak).
  const commenterCtx = `Sen ijtimoiy tarmoqdagi izoh yozish yordamchisisan. Birovning postiga tabiiy, samimiy va qisqa izoh taklif qilyapsan — bu taklifni istalgan foydalanuvchi o'z izohi sifatida ishlatishi mumkin, shuning uchun aniq bir shaxsga xos tafsilot yoki ism qo'shma. Rasmiy iboralar ishlatma. TIL QOIDASI: Javobingni FAQAT O'ZBEK TILIDA yoz. Post yoki rasm inglizcha, ruscha yoki boshqa tilda bo'lsa ham — sen o'zbek tilida javob ber. Chet tildagi narsa/nom/iqtibosni o'zbek tiliga tarjima qilib tushuntir.`
    + COMMENT_FEWSHOT;

  const textPart = postText ? `Post matni: "${postText}". ` : '';

  // Oldingi izohlar konteksti
  const cmtCtx = (prevComments && prevComments.length)
    ? `\nOldingi izohlar (${prevComments.length} ta): ${prevComments.slice(-5).map(c => `"${c.userName}: ${c.text}"`).join(' | ')}. Shu muhitga mos, takrorlanmagan izoh yaz.`
    : '';

  // MUHIM: Kontent ohangini auto-aniqla
  const toneGuide = `AVVAL kontentni tahlil qil: agar kulgili/meme/hazil bo'lsa — kulgili izoh yaz; agar jiddiy/hissiy/muhim bo'lsa — jiddiy yoz; agar badiiy/chiroyli bo'lsa — hayrat bilan yoz. Ohangni kontent belgilaydi, sen emas. INGLIZCHA/RUSCHA POST BO'LSA: mazmunini o'zbek tiliga tarjima qilib, o'zbek tilida samimiy izoh yaz.`;

  // Generatsiya qilingan izohni moderatsiyadan o'tkazib qaytaradi
  const _safe = async (raw) => {
    if (!raw) return raw;
    const ok = await _moderateAiText(raw);
    if (!ok) {
      console.warn('⚠️ AI izoh taklifi moderatsiyadan o\'tmadi, bloklanmoqda.');
      return null;
    }
    return raw;
  };

  if (!mediaUrl) {
    onStep?.('thinking');
    return _safe(await groqRequest([
      { role: 'system', content: commenterCtx },
      { role: 'user', content: `${textPart}${cmtCtx}\n${toneGuide}\nQisqa, samimiy o'zbek tilida izoh yaz. Faqat izohni yaz, 1 jumla.` }
    ], { reasoning_effort: 'low' }));
  }

  onStep?.('file');
  const info = await extractFileContent(mediaUrl, fileName, mediaType);

  if (info.kind === 'image') {
    onStep?.('thinking');
    // IKKI BOSQICH: qwen faqat rasmni tasvirlaydi, yakuniy izohni gpt-oss yozadi.
    // (umumiy postga bog'liq kesh — bir xil tasvirni aiGenerateCaption/aiAboutPost
    // bilan bo'lishadi, shu orqali qwen qayta chaqirilmasligi mumkin)
    const description = await _describeImageShared(postId, mediaUrl);
    return _safe(await groqRequest([
      { role: 'system', content: commenterCtx },
      { role: 'user', content: `Rasm tasviri: "${description}"\n${textPart}${cmtCtx}\n${toneGuide}\nRasmda nima ko'rsang shuni eslatib, tabiiy fikr bildur. Faqat izohni yaz, 1 jumla.` }
    ], { model: TEXT_MODEL, reasoning_effort: 'low' }));
  }

  // Video — kadr + audio birga
  if ((mediaType || '').startsWith('video/')) {
    onStep?.('video');
    const results = mediaUrl ? await extractVideoWithAudio(mediaUrl, null, 'auto') : [];
    if (results.length > 0) {
      onStep?.('thinking');
      // IKKI BOSQICH: qwen kadrlarni tasvirlaydi, gpt-oss yakuniy izohni yozadi.
      // (umumiy postga bog'liq kesh — aiAboutPost bilan bo'lishiladi)
      const hasAudio = results.some(r => r.transcript);
      const audioHint = hasAudio
        ? `\n[Kadrlarda eshitilgan ovoz]: "${results.map(r => r.transcript).filter(Boolean).join(' ')}"`
        : '';
      const description = await _describeVideoShared(postId, results);
      const instr = `Video tasviri: "${description}"${audioHint}\n${textPart}${cmtCtx}\n${toneGuide}\nVideo kadrlarda nima ko'rayotganingga qarab, samimiy o'zbek tilida 1 jumla izoh yaz. Faqat izohni yaz.`;
      return _safe(await groqRequest([{ role: 'system', content: commenterCtx }, { role: 'user', content: instr }], { model: TEXT_MODEL, max_tokens: 120, temperature: 0.85, reasoning_effort: 'low' }));
    }
    onStep?.('thinking');
    return _safe(await groqRequest([
      { role: 'system', content: commenterCtx },
      { role: 'user', content: `${textPart}${cmtCtx}\n${toneGuide}\nQisqa, samimiy o'zbek tilida izoh yaz. Faqat izohni yaz, 1 jumla.` }
    ], { reasoning_effort: 'low' }));
  }

  // Audio (mp3/wav/ogg/m4a...) — Whisper → izoh
  if ((mediaType || '').startsWith('audio/')) {
    let transcript = '';
    onStep?.('audio');
    if (mediaUrl) {
      try { const blob = await fetch(mediaUrl).then(r => r.blob()); transcript = await transcribeAudio(blob); } catch {}
    }
    onStep?.('thinking');
    const desc = transcript ? `Ovoz fayli: "${transcript}"` : `Ovoz fayli biriktirilgan.`;
    return _safe(await groqRequest([
      { role: 'system', content: commenterCtx },
      { role: 'user', content: `${textPart}${desc}\n${cmtCtx}\n${toneGuide}\nQisqa, samimiy o'zbek tilida izoh yaz. Faqat izohni yaz, 1 jumla.` }
    ], { max_tokens: 120, temperature: 1.0, reasoning_effort: 'low' }));
  }

  const fileDesc = info.kind === 'extracted'
    ? `Fayl ("${fileName || 'fayl'}", .${info.ext || '?'}) mazmuni:\n"""\n${info.text}\n"""`
    : `Fayl ("${fileName || 'fayl'}", .${info.ext || '?'}) haqida ma'lumot: ${info.text}`;

  return _safe(await groqRequest([
    { role: 'system', content: commenterCtx },
    { role: 'user', content: `${textPart}${fileDesc}\n${cmtCtx}\n${toneGuide}\nQisqa, samimiy o'zbek tilida izoh yaz. Faqat izohni yaz, 1 jumla.` }
  ], { max_tokens: 120, temperature: 1.0, reasoning_effort: 'low' }));
}

/* ── Keshlangan AI natijasini ARZON qayta so'zlash ──────────────────────
   Post uchun AI fikri/izoh taklifi allaqachon Firestore'da bor bo'lsa,
   rasm/video/audio qayta tahlil QILINMAYDI (bu eng qimmat qism). Buning
   o'rniga faqat matnning o'zi, kichik va arzon TEXT_MODEL'ga berilib,
   mazmuni bir xil qolgan holda boshqa so'zlar bilan qayta yozdiriladi —
   shu orqali har bir foydalanuvchi bir-biriga o'xshamas, lekin token
   sarfi deyarli nolga yaqin javob ko'radi. ─────────────────────────────── */

export async function rephraseAiAbout(cached) {
  if (!cached?.comment) return cached;
  try {
    await _enforceAiRateLimit();
    const raw = await groqRequest([
      {
        role: 'system',
        content: `Sen matn tahrirchisisan. Sizga berilgan "sarlavha" va "fikr" matnlarini MA'NOSINI aynan saqlagan holda, boshqa so'zlar va jumla tuzilishi bilan qayta yoz. Uzunligi va ohangi o'xshash bo'lsin, yangi faktlar qo'shma, mavjudini ham tashlab ketma. FAQAT O'ZBEK TILIDA yoz. FAQAT JSON qaytar, boshqa hech narsa yozma: {"title": "...", "comment": "..."}`
      },
      { role: 'user', content: `Sarlavha: "${cached.title || ''}"\nFikr: "${cached.comment}"` }
    ], { model: TEXT_MODEL, temperature: 0.9, max_tokens: 200, response_format: { type: 'json_object' }, reasoning_effort: 'low' });
    const parsed = JSON.parse(raw);
    return {
      title:   (parsed.title || cached.title || '').trim(),
      comment: (parsed.comment || cached.comment).trim(),
      mood:    cached.mood, // ohang/mood o'zgarmaydi, faqat matn qayta yoziladi
    };
  } catch {
    return cached; // xato bo'lsa — asl keshlangan matnni ko'rsatamiz
  }
}

export async function rephraseAiComment(cachedText) {
  if (!cachedText) return cachedText;
  try {
    await _enforceAiRateLimit();
    const raw = await groqRequest([
      {
        role: 'system',
        content: `Sen matn tahrirchisisan. Berilgan izoh taklifini MA'NOSINI aynan saqlagan holda, boshqa so'zlar bilan, taxminan bir xil uzunlikda qayta yoz. FAQAT O'ZBEK TILIDA yoz. Faqat qayta yozilgan izohni yoz, boshqa hech narsa (tirnoq, izoh, markdown) qo'shma.`
      },
      { role: 'user', content: cachedText }
    ], { model: TEXT_MODEL, temperature: 0.9, max_tokens: 80, reasoning_effort: 'low' });
    return (raw || cachedText).trim();
  } catch {
    return cachedText; // xato bo'lsa — asl keshlangan matnni ko'rsatamiz
  }
}

/* ── "✨ AI fikri" tugmasi — post haqida har safar boshqacha uslubda fikr ──
   Har bosilganda tasodifiy uslub tanlanadi va yuqori temperature ishlatiladi,
   shu sababli javob har safar bir xil bo'lib qolmaydi. ───────────────────── */
const AI_ABOUT_STYLES = [
  "hazil-mutoyiba bilan, do'stlar orasida gaplashgandek kulgili ohangda",
  "jiddiy tahlilchi sifatida, lekin qiziqarli faktlar bilan",
  "iliq va samimiy, xuddi yaqin do'sting kabi",
  "kulgili va ironik, lekin xafa qilmaydigan ohangda",
  "qisqa va zarbli, lo'nda",
  "hayratda qolgan kishi kabi, voydod deb",
  "sport sharhlovchisi kabi hayajonli ohangda",
  "hazilkash do'st kabi, engil kulgi bilan",
  "ko'rgan narsadan ilhomlanib, samimiy his bilan",
];

// "mood" maydoni uchun ruxsat etilgan qiymatlar — UI shu orqali
// bubble rangini/animatsiyasini tanlaydi (CSS: .ai-mood-<qiymat>)
const AI_MOODS = ['funny', 'serious', 'warm', 'excited', 'amazed', 'neutral'];

// Oxirgi tanlangan uslubni eslab qolamiz — keyingi "yana" bosishda takrorlanmasin
let _lastAboutStyle = '';

/**
 * AI tomonidan generatsiya qilingan MATNNI tezkor TEXT_MODEL bilan tekshiradi.
 * Post moderatsiyasidan o'tgan bo'lsa ham, AI sharhi noo'rin bo'lishi mumkin —
 * bu qo'shimcha himoya qatlami faqat chiqish matnini baholaydi.
 *
 * @param {string} text — tekshiriladigan AI generatsiya matni
 * @returns {Promise<boolean>} — true = xavfsiz, false = bloklash kerak
 */
async function _moderateAiText(text) {
  if (!text || !text.trim()) return true;
  try {
    const raw = await groqRequest([
      {
        role: 'system',
        content: `Sen AI-generatsiya matnlarini tekshiruvchi tez moderatorsan.
Faqat quyidagi hollarda "unsafe" qaytarassan:
- Jinsiy mazmun, yalang'ochlikka ishora, jinsiy taklif;
- Zo'ravonlik, tahdid, qon, o'lim glorifikatsiyasi;
- Nafrat tili, haqorat, kamsitish;
- O'z joniga qasd qilishni targ'ib qilish.

Oddiy hazil, maqtov, tanqid, sport, o'yin, anime, tabiiy his-tuyg'u — BULAR XAVFSIZ.
Shubha bo'lsa "safe" tomon og'ish.

Faqat JSON: {"safe": true} yoki {"safe": false}`,
      },
      { role: 'user', content: `Matn: "${text.slice(0, 400)}"` },
    ], {
      model: 'openai/gpt-oss-20b', // eski llama-3.1-8b-instant eskirgan (Groq tavsiyasi)
      temperature: 0,
      max_tokens: 40,
      response_format: { type: 'json_object' },
      reasoning_effort: 'low', // reasoning model — bo'lmasa 20-40 tokenlik limitda JSON chiqmay qolishi mumkin
    });
    const parsed = JSON.parse(raw);
    return parsed.safe !== false;
  } catch {
    return true; // xato bo'lsa — ko'rsatamiz (xavfsiz fallback)
  }
}

/**
 * Model qaytargan xom JSON matnini { title, comment, mood } ga aylantiradi.
 * Model ba'zan JSON atrofiga qo'shimcha matn yoki ```json qo'shib yuborishi
 * mumkin — shu sababli matn ichidan { ... } qismini regex bilan ajratamiz.
 * Parsing muvaffaqiyatsiz bo'lsa — xom matnni "comment" sifatida qaytaramiz,
 * shunda foydalanuvchi hech bo'lmasa bo'sh natija ko'rmaydi.
 */
async function _parseAboutReply(raw) {
  const tryParse = (s) => {
    try { return JSON.parse(s || '{}'); } catch { return null; }
  };

  let parsed = tryParse(raw);

  // Model JSON atrofiga qo'shimcha matn/```json qo'shib yuborgan bo'lishi
  // mumkin — matn ichidan { ... } qismini ajratib qayta urinamiz.
  if (!parsed && raw) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) parsed = tryParse(match[0]);
  }

  // Hamon JSON emas (masalan response_format'siz fallback urinishdan kelgan
  // erkin matn) — xom matnni chiroyli {title, comment, mood} formatga
  // solish uchun tez matn modeliga (gpt-oss-120b) beramiz, shunda
  // foydalanuvchi tartibsiz xom matn o'rniga bir xil chiroyli ko'rinishni
  // ko'radi.
  if (!parsed && raw && raw.trim()) {
    try {
      const reformatted = await groqRequest([
        { role: 'system', content: 'Sen matnni qayta formatlovchi yordamchisan. Senga erkin matn beriladi — uni FAQAT quyidagi JSON formatiga solib qayta yoz, mazmunini o\'zgartirma, faqat tartibga sol: {"title": "1-4 so\'zli sarlavha", "comment": "1-2 jumlali fikr, FAQAT O\'ZBEK TILIDA", "mood": "funny, serious, warm, excited, amazed, neutral dan bittasi"}. FAQAT JSON qaytar, boshqa hech narsa yozma.' },
        { role: 'user', content: raw.slice(0, 1000) },
      ], { model: TEXT_MODEL, temperature: 0.3, max_tokens: 200, response_format: { type: 'json_object' }, reasoning_effort: 'low' }).catch(() => null);
      if (reformatted) parsed = tryParse(reformatted);
    } catch (err) {
      console.warn('⚠️ AI javobini qayta formatlashda xato:', err.message);
    }
  }

  if (parsed) {
    const moodRaw = String(parsed.mood || '').trim().toLowerCase();
    const comment = String(parsed.comment || '').trim().slice(0, 500);
    const title   = String(parsed.title   || '').trim().slice(0, 60);

    // AI generatsiya matnini tezkor tekshiruv
    const safe = await _moderateAiText(`${title} ${comment}`);
    if (!safe) {
      console.warn('⚠️ AI javob moderatsiyadan o\'tmadi, bloklanmoqda.');
      return { title: '', comment: '', mood: 'neutral', _blocked: true };
    }

    return {
      title,
      comment,
      mood: AI_MOODS.includes(moodRaw) ? moodRaw : 'neutral',
    };
  }

  console.warn('⚠️ AI fikri JSON parse xatosi: qayta formatlash ham muvaffaqiyatsiz bo\'ldi');
  return { title: '', comment: (raw || '').trim(), mood: 'neutral' };
}

/**
 * Post haqida AI fikri/sharhi. Har bosilganda tasodifiy uslub + yuqori
 * temperature tufayli boshqacha javob beradi (bir xil emas).
 * 1 daqiqada 3 martadan ko'p ishlatilsa — xato (rate limit) tashlaydi.
 *
 * Endi faqat rasm emas — html/css/js/txt/pdf/docx/xlsx/pptx/zip/exe/apk/iso
 * kabi har qanday biriktirilgan fayl uchun ham ishlaydi (matn/kod/hujjat
 * fayllari uchun haqiqiy mazmuni o'qib tahlil qilinadi; binar/ijro
 * fayllar uchun esa faqat fayl nomi/turi asosida fikr bildiriladi).
 *
 * @returns {Promise<{title: string, comment: string, mood: string}>}
 *   mood — UI uchun: 'funny' | 'serious' | 'warm' | 'excited' | 'amazed' | 'neutral'
 */
export async function aiAboutPost({ imageUrl, mediaUrl, fileName, mediaType, text, posterName, likes, views, commentCount, createdAt, prevComments, postId, onStep } = {}) {
  onStep?.('preparing');
  await _enforceAiRateLimit();

  const url = mediaUrl || imageUrl || null;

  // prevComments = [{ role: 'ai'|'user', text }, ...]
  // Oldingi AI javoblardan FARQLI uslub tanlaymiz
  const prevAiTexts  = (prevComments || []).filter(c => c.role === 'ai').map(c => c.text);
  const prevUserCmts = (prevComments || []).filter(c => c.role === 'user');
  const style = (() => {
    const pool = prevAiTexts.length
      ? AI_ABOUT_STYLES.filter(s => s !== _lastAboutStyle)
      : AI_ABOUT_STYLES;
    const chosen = pool[Math.floor(Math.random() * pool.length)];
    _lastAboutStyle = chosen;
    return chosen;
  })();

  // Post matni
  const textPart = text ? `Post matni: "${text}". ` : "(matn yo'q, faqat media bor). ";

  // Post statistikasi
  const statParts = [];
  if (typeof likes === 'number')        statParts.push(`${likes} ta like`);
  if (typeof views === 'number')        statParts.push(`${views} ta ko'rish`);
  if (typeof commentCount === 'number') statParts.push(`${commentCount} ta izoh`);
  const statPart = statParts.length ? `Post statistikasi: ${statParts.join(', ')}. ` : '';

  // Post vaqti
  let timePart = '';
  if (createdAt) {
    try {
      const d = createdAt.toDate ? createdAt.toDate() : new Date(createdAt);
      const diff = Date.now() - d.getTime();
      const mins = Math.floor(diff / 60000);
      const hrs  = Math.floor(diff / 3600000);
      const days = Math.floor(diff / 86400000);
      timePart = mins < 60  ? `(${mins} daqiqa oldin yuklangan) `
               : hrs < 24   ? `(${hrs} soat oldin yuklangan) `
               : days < 30  ? `(${days} kun oldin yuklangan) `
               : days < 365 ? `(${Math.floor(days/30)} oy oldin yuklangan) `
               :              `(${Math.floor(days/365)} yil oldin yuklangan) `;
    } catch {}
  }

  // System prompt: xarakter + ohang qoidasi
  const toneRule = `MUHIM QOIDA — ohangni KONTENT belgilaydi:
• Kulgili/meme/hazil/absurd kontent → SEN HAM kulgili yoz, hazil qil, emoji ishlatishi mumkin
• Jiddiy/muhim/hissiy kontent → jiddiy va samimiy yoz, hazil qilma
• Chiroyli/san'at/tabiat → hayrat va ilhom bilan yoz
• O'yin/film/anime → nomini to'g'ri identifikatsiya qil va ayt, o'sha dunyo atrofida fikr bildir
Hech qachon kontentga teskari ohangda javob berma.`;

  const langRule = `TIL QOIDASI — MUHIM: Javobingni har doim FAQAT O'ZBEK TILIDA yoz. Post, rasm, video yoki fayl inglizcha, ruscha yoki boshqa tilda bo'lsa ham — o'zbek tilida javob ber. Inglizcha yoki boshqa tildagi nomlar, sarlavhalar, iqtiboslarni o'zbek tiliga tarjima qilib, qisqacha tushuntir. Hech qachon inglizcha jumlalar yozma.`;

  // Uslub namunalari (few-shot) — faqat FORMAT/USLUB uchun, mazmunini
  // ko'chirmasin deb alohida ta'kidlanadi. Format pastdagi `instruction`
  // bilan bir xil: {"title", "comment", "mood"} JSON.
  const aboutFewshot = `

Namunalar (faqat FORMAT va USLUB uchun — mazmunini ko'chirma, har doim pastda berilgan HAQIQIY post asosida yoz):
"hazil-mutoyiba bilan" uslubida →
{"title": "Mashinaga oshiqlik", "comment": "Bu yigit mashinasini judа yaxshi ko'rar ekan, suratga ham romantik tushib oldi 😄", "mood": "funny"}

"jiddiy tahlilchi sifatida" uslubida →
{"title": "GTA V dunyosi", "comment": "Bu sahna GTA V o'yinining ochiq dunyo missiyalaridan biriga o'xshaydi, grafikasi va tafsilotlari ajoyib chiqgan.", "mood": "serious"}`;

  const sysPrompt = `Sen MRgram ijtimoiy tarmog'idagi zukko AI tahlilchisisan. O'yinlar (Minecraft, GTA, Roblox, Among Us...), filmlar, seriallar, anime, memlar, internet trendlarini yaxshi bilasan. "AI sifatida" kabi iboralar ishlatma. Foydalanuvchi nomini tilga olma — faqat kontent haqida fikr bildir. Kontent nomini (film, o'yin, serial nomi) aniq va to'g'ri identifikatsiya qil.\n\n${toneRule}\n\n${langRule}${aboutFewshot}`;

  // posterName dan faqat birinchi ismni olamiz (raqamlar va familiyani olib tashlaymiz)
  // Masalan: "Muhammadrasul Qosimov 2321.12124" → "Muhammadrasul"
  const firstName = posterName
    ? posterName.trim().split(/[\s\d.]+/)[0] || posterName
    : null;

  // Haqiqiy izoh matnlari (foydalanuvchilar yozganlari)
  let commentsPart = '';
  if (prevUserCmts.length > 0) {
    const lines = prevUserCmts.slice(-8).map(c => `• ${c.userName}: "${c.text}"`).join('\n');
    commentsPart = `\nFoydalanuvchi izohlari:\n${lines}\n`;
  }

  // User prompt konteksti — faqat birinchi ism beriladi
  const posterCtx = firstName ? `Post egasi: "${firstName}". ` : '';
  const baseCtx = `${posterCtx}${textPart}${statPart}${timePart}${commentsPart}`;

  const prevHint = prevAiTexts.length
    ? `\nOLDINGI AI JAVOBLAR (bularni KO'CHIRMA, tamoman boshqacha yoz):\n${prevAiTexts.slice(-3).map((t, i) => `${i + 1}. "${t.slice(0, 120)}"`).join('\n')}`
    : '';

  const instruction = `Quyidagi formatda FAQAT JSON qaytar, boshqa hech narsa yozma (markdown, ortiqcha matn yoki izoh kerak emas):\n{"title": "1-4 so'zli sarlavha — nima ekanini ayt, inglizcha bo'lsa o'zbekcha tarjimasi", "comment": "${style} uslubida, FAQAT O'ZBEK TILIDA yozilgan 1-2 jumlali fikr/sharh, kerak bo'lsa emoji ishlatish mumkin, texnik iboralar ishlatma", "mood": "kontent ohangiga eng mos keladigan bittasi: funny, serious, warm, excited, amazed, neutral"}${prevHint}\nAgar post egasi ismi gapga tabiiy mos kelsa "comment" ichida ishlatish mumkin — lekin majburiy emas, zo'rma-zo'raki qo'shma.`;

  if (!url) {
    onStep?.('thinking');
    const raw = await groqRequest([
      { role: 'system', content: sysPrompt },
      { role: 'user',   content: `${baseCtx}\n${instruction}` }
    ], { temperature: 1.15, max_tokens: 320, response_format: { type: 'json_object' }, reasoning_effort: 'low' });
    return await _parseAboutReply(raw);
  }

  // Video — kadr + audio birga
  if ((mediaType || '').startsWith('video/')) {
    onStep?.('video');
    const results = url ? await extractVideoWithAudio(url, null, 'auto') : [];
    if (results.length > 0) {
      onStep?.('thinking');
      // IKKI BOSQICH: qwen kadrlarni tasvirlaydi (kontent turini aniqlagan
      // holda), gpt-oss shu tasvir asosida yakuniy JSON fikrni yozadi.
      // (umumiy postga bog'liq kesh — aiSuggestComment bilan bo'lishiladi)
      const hasAudio = results.some(r => r.transcript);
      const audioHint = hasAudio
        ? `\n[Kadrlarda eshitilgan ovoz]: "${results.map(r => r.transcript).filter(Boolean).join(' ')}"`
        : '';
      const description = await _describeVideoShared(postId, results);
      const videoInstruction = `Video tasviri: "${description}"${audioHint}\n${baseCtx}\nVideodagi kontent turini aniq identifikatsiya qil (o'yin nomi, film nomi, hayvon turi va h.k.). Quyidagi formatda FAQAT JSON qaytar, boshqa hech narsa yozma:\n{"title": "1-4 so'zli sarlavha — o'yin/film/anime bo'lsa to'liq nomini yoz", "comment": "${style} uslubida, FAQAT O'ZBEK TILIDA yozilgan 1-2 jumlali fikr, kadr vaqtlarini eslatma. Post egasi ismi gapga tabiiy mos kelsa ishlatish mumkin — lekin majburiy emas", "mood": "funny, serious, warm, excited, amazed, neutral dan kontentga eng mosi"}`;
      const raw = await groqRequest([{ role: 'system', content: sysPrompt }, { role: 'user', content: videoInstruction }], { model: TEXT_MODEL, temperature: 1.05, max_tokens: 480, response_format: { type: 'json_object' }, reasoning_effort: 'low' });
      return await _parseAboutReply(raw);
    }
    onStep?.('thinking');
    const rawFallback = await groqRequest([
      { role: 'system', content: sysPrompt },
      { role: 'user',   content: `Video post. ${baseCtx}\n${instruction}` }
    ], { temperature: 0.9, max_tokens: 320, response_format: { type: 'json_object' }, reasoning_effort: 'low' });
    return await _parseAboutReply(rawFallback);
  }

  // Audio — Whisper transkripsiya + AI fikri
  if ((mediaType || '').startsWith('audio/')) {
    let transcript = '';
    onStep?.('audio');
    if (url) {
      try { const blob = await fetch(url).then(r => r.blob()); transcript = await transcribeAudio(blob); } catch {}
    }
    onStep?.('thinking');
    const audioDesc = transcript
      ? `Ovoz yozuvi (transkripsiya): "${transcript}"`
      : `Ovoz fayli: "${fileName || 'audio'}"`;
    const raw = await groqRequest([
      { role: 'system', content: sysPrompt },
      { role: 'user',   content: `${audioDesc}\n${baseCtx}\n${instruction}` }
    ], { temperature: 1.15, max_tokens: 320, response_format: { type: 'json_object' }, reasoning_effort: 'low' });
    return await _parseAboutReply(raw);
  }

  onStep?.('file');
  const info = await extractFileContent(url, fileName, mediaType || (imageUrl ? 'image/*' : ''));

  onStep?.('thinking');
  let userContent;
  if (info.kind === 'image') {
    // IKKI BOSQICH: qwen faqat rasmni tasvirlaydi, gpt-oss yakuniy JSON
    // fikrni yozadi — shu orqali qwen'ning umumiy TPM budjeti kamroq band
    // bo'ladi (moderatsiya bilan bo'lishiladigan). Umumiy postga bog'liq
    // kesh — aiGenerateCaption/aiSuggestComment bilan bo'lishiladi.
    const description = await _describeImageShared(postId, url);
    userContent = `Rasm tasviri: "${description}"\n${baseCtx}\n${instruction}`;
  } else {
    const fileLabel = `"${fileName || 'fayl'}" (.${info.ext || '?'})`;
    const fileDesc  = info.kind === 'extracted'
      ? `Postga biriktirilgan fayl ${fileLabel} mazmuni:\n${info.text}`
      : `Postga biriktirilgan fayl ${fileLabel} haqida: ${info.text}`;
    userContent = `${fileDesc}\n${baseCtx}\n${instruction}`;
  }

  const raw = await groqRequest([
    { role: 'system', content: sysPrompt },
    { role: 'user',   content: userContent }
  ], {
    model: TEXT_MODEL,
    temperature: 1.15,
    max_tokens: info.kind === 'image' ? 480 : 320,
    response_format: { type: 'json_object' },
    // MUHIM: gpt-oss-120b reasoning model — reasoning_effort:low bermasak,
    // ichki fikrlash tokenlik limitni yeb qo'yib, JSON yarim yo'lda kesilib
    // qolishi mumkin. Endi rasm holatida ham TEXT_MODEL ishlatilgani uchun
    // bu parametr har doim beriladi.
    reasoning_effort: 'low',
  });
  return await _parseAboutReply(raw);
}
/* ── Shared Thinking UI (feed, comments, upload) ─────────────────────── */

export const THINK_LABELS = {
  preparing : "Tayyorlanmoqda",
  comments  : "Izohlar o'qilmoqda",
  video     : "Video qayta ishlanmoqda",
  audio     : "Audio tahlil qilinmoqda",
  file      : "Rasm yuklanmoqda",
  thinking  : "Fikr yaratilmoqda",
};

/**
 * Minimal single-line thinking UI.
 * @param {HTMLElement} container
 * @returns {{ step(name), finish(), destroy() }}
 */
export function createThinkingUI(container) {
  container.innerHTML = `
    <div class="ai-think-row">
      <span class="ai-think-timer">0s</span>
      <span class="ai-think-spin"></span>
      <span class="ai-think-text">Tayyorlanmoqda</span>
    </div>`;

  const timerEl = container.querySelector('.ai-think-timer');
  const textEl  = container.querySelector('.ai-think-text');
  let destroyed = false;
  let seconds   = 0;
  const tick = setInterval(() => { seconds++; timerEl.textContent = `${seconds}s`; }, 1000);

  return {
    step(name) {
      if (destroyed) return;
      const label = THINK_LABELS[name] || name;
      textEl.classList.add('ai-text-fade');
      setTimeout(() => { textEl.textContent = label; textEl.classList.remove('ai-text-fade'); }, 180);
    },
    finish() { clearInterval(tick); },
    destroy() { destroyed = true; clearInterval(tick); }
  };
}

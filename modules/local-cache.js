/**
 * local-cache.js — Chat va profil ma'lumotlari uchun yengil localStorage kesh.
 *
 * Maqsad: HTML/CSS/JS fayllar allaqachon brauzer keshida saqlanadi, lekin
 * chatlar ro'yxati, xabarlar va profil ma'lumotlari har safar Firestore'dan
 * qayta yuklanardi (bo'sh ekran / spinner ko'rinardi). Bu modul o'sha
 * ma'lumotlarni localStorage'ga saqlab, keyingi ochilishda DARHOL (tarmoqni
 * kutmasdan) ekranga chiqarish, so'ng fon rejimida Firestore'dan yangilash
 * imkonini beradi ("stale-while-revalidate" pattern).
 *
 * Faqat "asosiy" narsalar saqlanadi: chatlar ro'yxati, har bir chat uchun
 * so'nggi xabarlar va foydalanuvchi profili. Media fayllar (rasm/video)
 * kesh qilinmaydi — ular URL orqali brauzer HTTP keshiga tushadi.
 */

const PREFIX          = 'mrg_c_';
const MAX_MSGS_PER_CHAT = 50;   // Har bir chat uchun kesh qilinadigan xabarlar soni
const MAX_CACHED_THREADS = 25;  // Nechta chat threadi keshda saqlanadi (joy tejash uchun)

function _k(key) { return PREFIX + key; }

/**
 * Firestore Timestamp obyektlari (va ichma-ich joylashganlari ham) oddiy
 * JSON.stringify orqali to'g'ri saqlanmaydi — toDate() metodi yo'qoladi.
 * Shuning uchun keshga yozishdan oldin ularni epoch-millisekundga
 * aylantiramiz; keyin fmt()/fmtTime() `new Date(millis)` orqali to'g'ri
 * o'qiy oladi (ular avval ts.toDate borligini tekshiradi, yo'q bo'lsa
 * new Date(ts) ishlatadi).
 */
function _serialize(value) {
  if (value == null) return value;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (Array.isArray(value)) return value.map(_serialize);
  if (typeof value === 'object') {
    const out = {};
    for (const k in value) if (Object.prototype.hasOwnProperty.call(value, k)) out[k] = _serialize(value[k]);
    return out;
  }
  return value;
}

function safeSet(key, value) {
  try {
    localStorage.setItem(_k(key), JSON.stringify({ v: _serialize(value), t: Date.now() }));
    return true;
  } catch {
    // Kvota to'lgan yoki localStorage yo'q — jimgina chiqib ketamiz
    return false;
  }
}

function safeGet(key) {
  try {
    const raw = localStorage.getItem(_k(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && 'v' in parsed ? parsed.v : null;
  } catch {
    return null;
  }
}

function safeRemove(key) {
  try { localStorage.removeItem(_k(key)); } catch {}
}

/* ── Thread ro'yxatini LRU tarzda cheklash (joy tejash) ─────────────── */
function _touchThreadIndex(chatId) {
  const idxKey = 'thread_index';
  let list = safeGet(idxKey) || [];
  list = list.filter(id => id !== chatId);
  list.unshift(chatId);
  if (list.length > MAX_CACHED_THREADS) {
    const removed = list.slice(MAX_CACHED_THREADS);
    removed.forEach(id => safeRemove(`thread_${id}`));
    list = list.slice(0, MAX_CACHED_THREADS);
  }
  safeSet(idxKey, list);
}

/* ══ Chatlar ro'yxati ════════════════════════════════════════════════ */
export function cacheChatsList(uid, users, chatMap) {
  if (!uid || !users) return;
  safeSet(`chats_${uid}`, { users, chatMap: chatMap || {} });
}

export function getCachedChatsList(uid) {
  if (!uid) return null;
  return safeGet(`chats_${uid}`); // { users, chatMap } | null
}

/** O'chirilgan/bloklangan userdan keyin joriy qurilmadagi keshni majburan eskirtirish. */
export function invalidateChatsListCache(uid) {
  if (!uid) return;
  safeRemove(`chats_${uid}`);
}

/** Keshning necha millisekund oldin saqlanganini qaytaradi (yo'q bo'lsa null). */
export function getCachedChatsListAgeMs(uid) {
  if (!uid) return null;
  try {
    const raw = localStorage.getItem(_k(`chats_${uid}`));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.t !== 'number') return null;
    return Date.now() - parsed.t;
  } catch { return null; }
}

/* ══ Chat thread xabarlari ═══════════════════════════════════════════ */
export function cacheThreadMessages(chatId, msgs) {
  if (!chatId || !Array.isArray(msgs)) return;
  const trimmed = msgs.slice(-MAX_MSGS_PER_CHAT);
  safeSet(`thread_${chatId}`, trimmed);
  _touchThreadIndex(chatId);
}

export function getCachedThreadMessages(chatId) {
  if (!chatId) return null;
  return safeGet(`thread_${chatId}`); // array | null
}

/* ══ Profil ma'lumotlari ═══════════════════════════════════════════════ */
export function cacheProfile(uid, data) {
  if (!uid || !data) return;
  safeSet(`profile_${uid}`, data);
}

export function getCachedProfile(uid) {
  if (!uid) return null;
  return safeGet(`profile_${uid}`);
}

/* ══ Feed postlari (bosh sahifa) ═══════════════════════════════════════
   Eng katta sekinlik shu yerdan edi: feed doim Firestore'dan (internetdan)
   kutib turardi. Endi oxirgi ko'rilgan postlar localStorage'ga saqlanadi —
   ilova ochilganda DARHOL shular ko'rsatiladi, fonda esa Firestore'dan
   yangi ma'lumot kelib, ekran jimgina yangilanadi. */
const MAX_CACHED_POSTS = 40; // Juda ko'p joy egallamasligi uchun cheklov

export function cachePosts(uid, posts) {
  if (!uid || !Array.isArray(posts)) return;
  safeSet(`posts_${uid}`, posts.slice(0, MAX_CACHED_POSTS));
}

export function getCachedPosts(uid) {
  if (!uid) return null;
  return safeGet(`posts_${uid}`); // array | null
}

/* ══ Tozalash (logout paytida chaqiriladi) ═════════════════════════════ */
export function clearAllCache() {
  try {
    Object.keys(localStorage)
      .filter(k => k.startsWith(PREFIX))
      .forEach(k => localStorage.removeItem(k));
  } catch {}
}

/** Service Worker'ning RUNTIME keshini (rasm/video/API javoblari kabi
 * dinamik ravishda saqlangan tarmoq javoblari) tozalaydi — "Sozlamalar →
 * Kesh/xotirani tozalash" tugmasi shu funksiyani chaqiradi. STATIC keshga
 * (ilova qobig'i: HTML/CSS/JS) tegilmaydi, aks holda keyingi ochilishda
 * hammasi qaytadan internetdan yuklanib, ilova sekinlashib qolar edi. */
export async function clearRuntimeCache() {
  if (!('caches' in window)) return 0;
  try {
    const keys = await caches.keys();
    const runtimeKeys = keys.filter(k => k.startsWith('mrgram-runtime-'));
    await Promise.all(runtimeKeys.map(k => caches.delete(k)));
    return runtimeKeys.length;
  } catch {
    return 0;
  }
}

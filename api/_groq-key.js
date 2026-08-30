/**
 * Groq API kalit(lar)ini olish uchun umumiy yordamchi.
 *
 * ENDI BIR NECHTA KALITNI QO'LLAB-QUVVATLAYDI — kunlik (TPD) limitni
 * ko'paytirish uchun. Kalitlar quyidagi joylardan yig'iladi (barchasi
 * birlashtiriladi, takrorlanganlar olib tashlanadi):
 *
 *   1) collection: "AI"  — har bir hujjat ichida `key` maydoni bo'lishi kerak.
 *        Masalan: AI/gk1 { key: "gsk_..." }, AI/gk2 { key: "gsk_..." }, ...
 *        Hujjat nomlari (gk1, gk2, ...) ixtiyoriy — faqat `key` maydoni o'qiladi.
 *   2) collection: spbs-collection, document: controller, field: groqkey
 *        (eski, yagona kalit uchun — orqaga moslik saqlanadi)
 *   3) process.env.GROQ_API_KEY (fallback, Firestore hali sozlanmagan bo'lsa)
 *
 * Har bir so'rovda Firestore'ni o'qimaslik uchun 5 daqiqalik in-memory
 * kesh ishlatiladi (serverless funksiya "issiq" turgan holatda saqlanadi).
 *
 * MUHIM: bu "cheksiz" limit degani emas — har bir kalit o'zining kunlik
 * (TPD) chegarasiga ega, shunchaki N ta kalit = N baravar ko'p sig'im.
 * Bitta shaxs/loyiha uchun ko'p bepul hisob ochish Groq'ning foydalanish
 * shartlariga zid bo'lishi mumkin — buni loyiha egasi o'z javobgarligida
 * hal qiladi.
 */
import { getFirestore } from 'firebase-admin/firestore';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 daqiqa
let _cachedKeys = null;
let _cachedAt = 0;

// Har bir kalit yonida uning "id"si ham saqlanadi (masalan "gk1", "legacy",
// "env") — xato loglarida qaysi kalit sabab bo'lganini aniq ko'rsatish uchun.
// _cachedKeys endi { id, key } obyektlar massivi.

async function _loadKeys(adminApp, { force = false } = {}) {
  const now = Date.now();
  if (!force && _cachedKeys && (now - _cachedAt) < CACHE_TTL_MS) {
    return _cachedKeys;
  }

  const entries = []; // { id, key }
  const seen = new Set();
  const db = getFirestore(adminApp);

  // 1) Yangi: "AI" collection — bir nechta kalit hujjatlari
  try {
    const snap = await db.collection('AI').get();
    snap.forEach((doc) => {
      const k = doc.data()?.key;
      if (k && typeof k === 'string' && k.trim() && !seen.has(k.trim())) {
        seen.add(k.trim());
        entries.push({ id: doc.id, key: k.trim() });
      }
    });
  } catch (err) {
    console.error('[getGroqApiKeys] "AI" collection o\'qishda xato:', err);
  }

  // 2) Eski: spbs-collection/controller/groqkey (orqaga moslik)
  try {
    const legacySnap = await db.collection('spbs-collection').doc('controller').get();
    const legacyKey = legacySnap.exists ? legacySnap.data()?.groqkey : null;
    if (legacyKey && typeof legacyKey === 'string' && !seen.has(legacyKey.trim())) {
      seen.add(legacyKey.trim());
      entries.push({ id: 'legacy', key: legacyKey.trim() });
    }
  } catch (err) {
    console.error('[getGroqApiKeys] legacy kalitni o\'qishda xato:', err);
  }

  // 3) Fallback: environment variable
  if (!entries.length && process.env.GROQ_API_KEY) {
    entries.push({ id: 'env', key: process.env.GROQ_API_KEY });
  }

  _cachedKeys = entries;
  _cachedAt = now;
  return entries;
}

/** Debug/log uchun: kalitning oxirgi 4 ta belgisini ko'rsatadi (to'liq
 * kalitni hech qachon logga chiqarmaslik uchun). */
export function maskKey(key) {
  if (!key || typeof key !== 'string') return '(yo\'q)';
  return key.length > 8 ? `...${key.slice(-4)}` : '****';
}

/** Kalitlar keshini majburan tozalaydi — keyingi so'rov Firestore'dan
 * yangi ro'yxatni o'qib oladi. Barcha kalitlar 401 (yaroqsiz) qaytarganda
 * chaqiriladi: ehtimol kalit endigina Firestore'da tuzatilgan bo'lishi
 * mumkin, lekin funksiya "issiq" turgani uchun eski (noto'g'ri) kesh hali
 * ham ishlatilayotgan bo'lishi mumkin. */
export function invalidateKeyCache() {
  _cachedKeys = null;
  _cachedAt = 0;
}

/** Orqaga moslik uchun — faqat BIRINCHI kalitni qaytaradi. */
export async function getGroqApiKey(adminApp) {
  const entries = await _loadKeys(adminApp);
  return entries[0]?.key || null;
}

/** Barcha mavjud kalitlarni qaytaradi (array of string) — orqaga moslik. */
export async function getGroqApiKeys(adminApp) {
  const entries = await _loadKeys(adminApp);
  return entries.map((e) => e.key);
}

/** Barcha mavjud kalitlarni id bilan birga qaytaradi: [{ id, key }, ...].
 * `force: true` — keshni chetlab, to'g'ridan-to'g'ri Firestore'dan o'qiydi. */
export async function getGroqApiKeysWithMeta(adminApp, opts) {
  return _loadKeys(adminApp, opts);
}

/** Tasodifiy (random) kalit indeksini qaytaradi.
 *
 * ESLATMA: ilgari bu yerda round-robin (_rrIndex++ % len) ishlatilgan edi.
 * Muammo: Vercel serverless funksiyalar tez-tez "sovuq" (cold start) qayta
 * ishga tushadi — har safar YANGI xotira bilan, ya'ni _rrIndex har safar
 * yana 0'dan boshlanadi. Kam/o'rtacha trafikda deyarli HAR BIR so'rov yangi
 * (sovuq) instansiyaga tushadi, shu sababli amalda deyarli doim faqat
 * BIRINCHI kalit (gk1) ishlatilardi — gk2/gk3 esa bo'sh turganda ham gk1
 * TPM (daqiqalik) limitiga tez-tez tegib qolardi.
 *
 * Random tanlov cold start'dan mutlaqo mustaqil ishlaydi — xotira holatidan
 * qat'i nazar, har chaqiruvda haqiqiy tasodifiy kalitdan boshlanadi, shu
 * bilan yuklama barcha kalitlar orasida amalda ham teng taqsimlanadi. */
export function nextKeyStartIndex(len) {
  if (!len) return 0;
  return Math.floor(Math.random() * len);
}

/** Oddiy, tez va barqaror (deterministik) string hash — FNV-1a algoritmi.
 * Bir xil `uid` doim bir xil son qaytaradi (jarayonlar/cold start'lardan
 * mustaqil), lekin turli uid'lar orasida natija amalda tasodifiy kabi
 * yaxshi taqsimlanadi. */
function _fnv1aHash(str) {
  let h = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    // FNV prime (32-bit) bilan ko'paytirish, 32-bit unsigned'ga qaytarish
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** "Yopishtirilgan" (sticky) kalit indeksini qaytaradi — bitta foydalanuvchi
 * (uid) doim bir xil kalitga tushadi, shu bilan Groq'ning prompt-cache
 * imkoniyati ishga tushadi (bir xil kalit + bir xil system prompt ~2 soat
 * ichida keshlanadi, keshlangan qism TPM limitiga hisoblanmaydi).
 *
 * `uid` bo'lmasa (yoki bo'sh bo'lsa) — eski tasodifiy usulga (nextKeyStartIndex)
 * qaytamiz, shunda hech bo'lmaganda yuklama kalitlar orasida taqsimlanadi. */
export function stickyKeyStartIndex(uid, len) {
  if (!len) return 0;
  if (!uid || typeof uid !== 'string') return nextKeyStartIndex(len);
  return _fnv1aHash(uid) % len;
}


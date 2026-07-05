/**
 * Groq API kalitini olish uchun umumiy yordamchi.
 *
 * Kalit endi Vercel environment variable'da emas, Firestore'dagi mavjud
 * konfiguratsiya hujjatida saqlanadi (boshqa sozlamalar — uploadIndex,
 * Supabase projektlari — bilan bir joyda, modules/config.js dagi
 * getController() o'qiydigan hujjat bilan bir xil):
 *
 *   collection: spbs-collection
 *   document:   controller
 *   field:      groqkey
 *
 * Bu admin panel orqali kalitni qayta deploy qilmasdan almashtirish imkonini
 * beradi. MUHIM: bu yerda o'qish firebase-admin (server, Admin SDK) orqali
 * bo'lgani uchun Firestore Security Rules'ni chetlab o'tadi — groqkey
 * maydoni hech qachon clientga (getController() orqali) yuborilmasligi
 * kerak, faqat server shu funksiya orqali o'qiydi.
 *
 * Har bir so'rovda Firestore'ni o'qimaslik uchun 5 daqiqalik in-memory
 * kesh ishlatiladi (serverless funksiya "issiq" turgan holatda saqlanadi).
 *
 * process.env.GROQ_API_KEY hamon fallback sifatida qo'llab-quvvatlanadi —
 * Firestore'da maydon topilmasa yoki xato yuz bersa shunga tushamiz.
 */
import { getFirestore } from 'firebase-admin/firestore';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 daqiqa
let _cachedKey = null;
let _cachedAt = 0;

export async function getGroqApiKey(adminApp) {
  const now = Date.now();
  if (_cachedKey && (now - _cachedAt) < CACHE_TTL_MS) {
    return _cachedKey;
  }

  try {
    const snap = await getFirestore(adminApp).collection('spbs-collection').doc('controller').get();
    const key = snap.exists ? (snap.data()?.groqkey || null) : null;
    if (key) {
      _cachedKey = key;
      _cachedAt = now;
      return key;
    }
  } catch (err) {
    console.error('[getGroqApiKey] Firestore o\'qishda xato:', err);
  }

  // Fallback: environment variable (masalan, Firestore hali sozlanmagan bo'lsa)
  const envKey = process.env.GROQ_API_KEY || null;
  if (envKey) {
    _cachedKey = envKey;
    _cachedAt = now;
  }
  return envKey;
}

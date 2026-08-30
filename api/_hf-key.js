/**
 * Hugging Face API kalitini olish uchun umumiy yordamchi.
 *
 * `_groq-key.js` bilan BIR XIL patern: kalit Firestore'dagi mavjud
 * konfiguratsiya hujjatida saqlanadi (groqkey bilan bir joyda):
 *
 *   collection: spbs-collection
 *   document:   controller
 *   field:      hfkey
 *
 * O'ZBEK OVOZLI XABAR (TTS) UCHUN KERAK. Kalitni olish:
 *   1) https://huggingface.co/join — bepul ro'yxatdan o'tish (faqat email,
 *      karta yoki telefon SO'RALMAYDI).
 *   2) Kirgandan so'ng: https://huggingface.co/settings/tokens — "New token"
 *      → nom bering (masalan "mrgram-tts") → Type: "Read" yetarli → Create.
 *   3) Ko'rsatilgan tokenni (hf_... bilan boshlanadi) nusxalab, Firebase
 *      Console → Firestore Database → spbs-collection → controller
 *      hujjatiga YANGI MAYDON sifatida qo'shing:
 *        maydon nomi: hfkey
 *        turi:        string
 *        qiymati:     hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 *   Shu qadamdan so'ng /api/tts avtomatik ishlay boshlaydi — kodni qayta
 *   deploy qilish SHART EMAS (xuddi groqkey kabi).
 *
 * MUHIM: bu yerda o'qish firebase-admin (server, Admin SDK) orqali bo'lgani
 * uchun Firestore Security Rules'ni chetlab o'tadi — hfkey maydoni hech
 * qachon clientga (getController() orqali) yuborilmasligi kerak, faqat
 * server shu funksiya orqali o'qiydi.
 *
 * Har bir so'rovda Firestore'ni o'qimaslik uchun 5 daqiqalik in-memory
 * kesh ishlatiladi (serverless funksiya "issiq" turgan holatda saqlanadi).
 *
 * process.env.HF_API_KEY hamon fallback sifatida qo'llab-quvvatlanadi —
 * Firestore'da maydon topilmasa yoki xato yuz bersa shunga tushamiz.
 */
import { getFirestore } from 'firebase-admin/firestore';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 daqiqa
let _cachedKey = null;
let _cachedAt = 0;

export async function getHfApiKey(adminApp) {
  const now = Date.now();
  if (_cachedKey && (now - _cachedAt) < CACHE_TTL_MS) {
    return _cachedKey;
  }

  try {
    const snap = await getFirestore(adminApp).collection('spbs-collection').doc('controller').get();
    const key = snap.exists ? (snap.data()?.hfkey || null) : null;
    if (key) {
      _cachedKey = key;
      _cachedAt = now;
      return key;
    }
  } catch (err) {
    console.error('[getHfApiKey] Firestore o\'qishda xato:', err);
  }

  // Fallback: environment variable (masalan, Firestore hali sozlanmagan bo'lsa)
  const envKey = process.env.HF_API_KEY || null;
  if (envKey) {
    _cachedKey = envKey;
    _cachedAt = now;
  }
  return envKey;
}

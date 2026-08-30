/**
 * Per-user rate limiting — AI-resurs chaqiradigan endpointlar uchun
 * (groq-chat, tts, groq-transcribe).
 *
 * NEGA FIRESTORE, NEGA REDIS/UPSTASH EMAS:
 *   Loyihada allaqachon Redis/Upstash/Vercel KV kabi infratuzilma yo'q —
 *   faqat Firebase Admin (Firestore) bor. Yangi servis qo'shish yangi
 *   akkaunt, yangi env variable, yangi bog'liqlik degani. Firestore esa
 *   allaqachon shu funksiyalarning barchasida ishlatiladi (masalan
 *   groq-chat.js har so'rovdan keyin usage statistikasini yozadi) — shu
 *   sababli bitta qo'shimcha o'qish/yozish arxitekturaga yot emas.
 *
 * NEGA VERCEL FUNKSIYA ICHIDAGI ODDIY `Map()` ISHLAMAYDI:
 *   send-notification.js dagi `_lastSent` Map — bu FAQAT bitta issiq
 *   (warm) instansiya doirasida ishlaydi. Vercel bir vaqtning o'zida
 *   BIR NECHTA instansiyani parallel ko'tarishi mumkin (har birida
 *   alohida xotira) va cold start bo'lganda xotira butunlay tozalanadi.
 *   Ya'ni "1 daqiqada 10 ta so'rov" degan chegara amalda "har instansiya
 *   uchun alohida 10 ta" bo'lib chiqadi — bu haqiqiy limit emas.
 *   Firestore esa barcha instansiyalar uchun BITTA umumiy holat manbai.
 *
 * FAIL-OPEN QARORI (ataylab shunday):
 *   Agar Firestore transaction xato bersa (masalan vaqtinchalik tarmoq
 *   muammosi), so'rovni BLOKLAMAYMIZ — ya'ni rate-limit ishlamay qolsa,
 *   foydalanuvchi baribir xizmatdan foydalana oladi. Sabab: rate-limit
 *   ikkinchi darajali himoya qatlami, asosiy funksiya (AI javob berish)
 *   undan ustun turishi kerak. Faqat cheklovning o'zi vaqtincha
 *   ishlamay qolishi mumkin, butun ilova emas.
 */
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

/**
 * @param {import('firebase-admin/app').App} adminApp
 * @param {string} uid
 * @param {string} bucket - masalan 'chat', 'tts', 'transcribe' (har xil
 *   endpointlar alohida limitga ega bo'lishi uchun)
 * @param {{ windowMs: number, max: number }} opts
 * @returns {Promise<{ allowed: boolean, retryAfterSec?: number, degraded?: boolean }>}
 */
export async function checkRateLimit(adminApp, uid, bucket, { windowMs, max }) {
  const db = getFirestore(adminApp);
  const ref = db.collection('rateLimits').doc(`${bucket}_${uid}`);
  const now = Date.now();

  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data() : null;

      // Oyna hali boshlanmagan yoki eskirgan (windowMs dan ko'p vaqt o'tgan)
      // — yangi oyna, hisoblagich 1 dan boshlanadi.
      if (!data || (now - data.windowStart) >= windowMs) {
        tx.set(ref, { windowStart: now, count: 1 });
        return { allowed: true };
      }

      if (data.count >= max) {
        const retryAfterSec = Math.ceil((windowMs - (now - data.windowStart)) / 1000);
        return { allowed: false, retryAfterSec };
      }

      tx.update(ref, { count: FieldValue.increment(1) });
      return { allowed: true };
    });
  } catch (err) {
    console.error(`[rate-limit:${bucket}] Firestore xato, fail-open:`, err.message);
    return { allowed: true, degraded: true };
  }
}

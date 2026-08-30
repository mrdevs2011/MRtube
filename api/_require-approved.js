/**
 * AI-resurs (Groq chat/vision, TTS, transcribe) chaqiradigan endpointlar
 * uchun umumiy "approved" tekshiruvi.
 *
 * MUAMMO (nima uchun bu fayl kerak bo'lib qoldi):
 *   groq-chat.js / tts.js / groq-transcribe.js — bularning barchasi
 *   Firebase ID tokenni tekshiradi (verifyIdToken), ya'ni "sen login
 *   qilgan haqiqiy foydalanuvchimisan" — HA. Lekin firestore.rules'dagi
 *   isApproved() bilan bir xil "senga bu ilovani ishlatishga ADMIN
 *   ruxsat berganmi" tekshiruvi bu uch faylning HECH birida yo'q edi.
 *
 *   Natija: ro'yxatdan endigina o'tgan (approved: false yoki hali
 *   umuman yo'q) har qanday odam idToken bilan to'g'ridan-to'g'ri shu
 *   API'larga so'rov yubora olardi — ya'ni Groq kvotasi/kutilmagan
 *   xarajat approve bosqichini butunlay chetlab o'tib sarflanardi.
 *
 * Bu funksiya: verifyIdToken'dan KEYIN chaqiriladi, users/{uid}
 * hujjatini o'qiydi va isApproved() bilan bir xil mantiqni qo'llaydi
 * (approved === true, blocked !== true, blockedUntil o'tib ketgan
 * bo'lsa muammo emas).
 */
import { getFirestore } from 'firebase-admin/firestore';

/**
 * @param {import('firebase-admin/app').App} adminApp
 * @param {string} uid - decoded.uid (verifyIdToken natijasidan)
 * @returns {Promise<{ ok: true } | { ok: false, status: number, error: string }>}
 */
export async function requireApprovedUser(adminApp, uid) {
  if (!uid || typeof uid !== 'string') {
    return { ok: false, status: 401, error: 'Token yaroqsiz' };
  }

  let snap;
  try {
    snap = await getFirestore(adminApp).collection('users').doc(uid).get();
  } catch (err) {
    console.error('[requireApprovedUser] users hujjatini o\'qishda xato:', err);
    return { ok: false, status: 500, error: 'Foydalanuvchi holatini tekshirib bo\'lmadi' };
  }

  if (!snap.exists) {
    return { ok: false, status: 403, error: 'Foydalanuvchi topilmadi' };
  }

  const u = snap.data() || {};

  if (u.approved !== true) {
    return { ok: false, status: 403, error: 'Hisobingiz hali admin tomonidan tasdiqlanmagan' };
  }

  if (u.blocked === true) {
    return { ok: false, status: 403, error: 'Hisobingiz bloklangan' };
  }

  if (u.blockedUntil) {
    // Firestore Timestamp bo'lishi mumkin (toMillis bor) yoki allaqachon
    // number/ISO string bo'lishi mumkin — ikkalasini ham qo'llab-quvvatlaymiz.
    const untilMs = typeof u.blockedUntil?.toMillis === 'function'
      ? u.blockedUntil.toMillis()
      : new Date(u.blockedUntil).getTime();
    if (!Number.isNaN(untilMs) && untilMs > Date.now()) {
      return { ok: false, status: 403, error: 'Hisobingiz vaqtincha bloklangan' };
    }
  }

  return { ok: true };
}

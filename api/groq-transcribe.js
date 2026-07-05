/**
 * POST /api/groq-transcribe
 * Groq Whisper (audio → matn) uchun xavfsiz server-side proksi.
 *
 * Nega kerak: Groq API kaliti ilgari Firestore (spbs-collection/controller)
 * orqali TO'G'RIDAN-TO'G'RI brauzerga berilar edi — bu esa har qanday
 * login qilgan foydalanuvchiga maxfiy kalitni o'qish imkonini berardi.
 * Endi kalit Firestore'da (spbs-collection/controller → groqkey) saqlanadi va
 * brauzer hech qachon uni ko'rmaydi.
 *
 * Auth: Authorization: Bearer <Firebase ID Token> — faqat tizimga
 * kirgan foydalanuvchilar chaqira oladi.
 *
 * Body (JSON): { audioBase64: string, mimeType?: string, language?: string }
 *   audioBase64 — audio Blob ning base64 (data: prefiksisiz) ko'rinishi.
 *
 * Eslatma: Vercel serverless funksiyalarda so'rov tanasi hajmi cheklangan
 * (odatda ~4.5MB). Audio segmentlari qisqa (bir necha soniya) bo'lgani
 * uchun bu yetarli, lekin juda uzun audio yuborilsa xato qaytishi mumkin.
 */
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getGroqApiKey } from './_groq-key.js';

const MAX_BASE64_CHARS = 6_000_000; // ~4.5MB dan biroz kam (base64 ~33% katta)

function getAdminApp() {
  if (getApps().length) return getApps()[0];
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (!b64) throw new Error('FIREBASE_SERVICE_ACCOUNT_BASE64 topilmadi');
  const sa = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  return initializeApp({ credential: cert(sa) });
}

function getBearerToken(req) {
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Firebase ID token tekshiruvi — asosiy himoya qatlami ──
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Authorization header (Bearer <idToken>) talab qilinadi' });
  }

  let decoded;
  try {
    decoded = await getAuth(getAdminApp()).verifyIdToken(token);
  } catch (err) {
    return res.status(401).json({ error: 'Token yaroqsiz' });
  }
  if (!decoded?.uid) {
    return res.status(401).json({ error: 'Token yaroqsiz' });
  }

  let GROQ_API_KEY;
  try {
    GROQ_API_KEY = await getGroqApiKey(getAdminApp());
  } catch (err) {
    console.error('[groq-transcribe] Groq kalitini olishda xato:', err);
  }
  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: 'Server konfiguratsiyasi xato: Groq API kaliti topilmadi (spbs-collection/controller → groqkey)' });
  }

  const { audioBase64, mimeType = 'audio/webm', language = 'uz' } = req.body || {};
  if (!audioBase64 || typeof audioBase64 !== 'string') {
    return res.status(400).json({ error: 'audioBase64 talab qilinadi' });
  }
  if (audioBase64.length > MAX_BASE64_CHARS) {
    return res.status(413).json({ error: 'Audio hajmi juda katta' });
  }

  try {
    const buffer = Buffer.from(audioBase64, 'base64');
    const blob = new Blob([buffer], { type: mimeType });

    const form = new FormData();
    form.append('file', blob, 'audio.webm');
    form.append('model', 'whisper-large-v3');
    form.append('response_format', 'text');
    if (language) form.append('language', language);

    const groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` },
      body: form,
    });

    if (!groqRes.ok) {
      return res.status(200).json({ text: '' }); // xato bo'lsa ham client kutmasin
    }
    const text = (await groqRes.text()).trim();
    return res.status(200).json({ text });
  } catch (err) {
    console.error('[groq-transcribe] error:', err);
    return res.status(200).json({ text: '' });
  }
}

/**
 * POST /api/groq-chat
 * Groq chat-completions (matn va vision modellar) uchun xavfsiz
 * server-side proksi. Groq API kaliti Firestore'da
 * (spbs-collection/controller → groqkey) saqlanadi va brauzerga hech
 * qachon yuborilmaydi.
 *
 * Auth: Authorization: Bearer <Firebase ID Token>.
 *
 * Body (JSON): { model, messages, max_tokens?, temperature?, response_format? }
 * Bularning barchasi Groq/OpenAI formatiga mos — client shu formatda yuboradi,
 * biz to'g'ridan-to'g'ri Groq'ga forward qilamiz.
 */
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getGroqApiKey } from './_groq-key.js';

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
    console.error('[groq-chat] Groq kalitini olishda xato:', err);
  }
  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: 'Server konfiguratsiyasi xato: Groq API kaliti topilmadi (spbs-collection/controller → groqkey)' });
  }

  const { model, messages, max_tokens = 200, temperature = 0.7, response_format = null } = req.body || {};
  if (!model || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'model va messages talab qilinadi' });
  }

  const body = { model, messages, max_tokens, temperature };
  if (response_format) body.response_format = response_format;

  try {
    const doFetch = () => fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    let groqRes = await doFetch();

    // 429/5xx bo'lsa — bir marta qayta urinish (400 qayta urinilmaydi)
    if (groqRes.status === 429 || (groqRes.status >= 500 && groqRes.status !== 400)) {
      const retryAfterSec = parseInt(groqRes.headers.get('retry-after') || '4', 10);
      const delayMs = Math.min(retryAfterSec * 1000, 8000);
      await new Promise(r => setTimeout(r, delayMs));
      groqRes = await doFetch();
    }

    const data = await groqRes.json().catch(() => ({}));

    if (!groqRes.ok) {
      return res.status(groqRes.status).json({ error: { message: data.error?.message || 'Groq xatosi' } });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error('[groq-chat] error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}

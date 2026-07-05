/**
 * POST /api/set-claim
 * Firebase Auth tokeniga { app: 'mrgram' } custom claim qo'shadi.
 * Faqat ALLOWED_ORIGIN dan kelgan, login bo'lgan userlar uchun.
 *
 * Body: { idToken: string }
 */
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth }                       from 'firebase-admin/auth';

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';

function getAdminApp() {
  if (getApps().length) return getApps()[0];
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (!b64) throw new Error('FIREBASE_SERVICE_ACCOUNT_BASE64 topilmadi');
  const sa = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  return initializeApp({ credential: cert(sa) });
}

function originAllowed(req) {
  const origin  = req.headers['origin']  || '';
  const referer = req.headers['referer'] || '';
  return (
    origin  === ALLOWED_ORIGIN ||
    referer.startsWith(ALLOWED_ORIGIN) ||
    origin  === '' // server-side / same-origin
  );
}

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!originAllowed(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { idToken } = req.body || {};
  if (!idToken || typeof idToken !== 'string') {
    return res.status(400).json({ error: 'idToken talab qilinadi' });
  }

  try {
    const adminApp = getAdminApp();
    const adminAuth = getAuth(adminApp);

    // Tokenni tekshiramiz — bu ham himoya qatlami
    const decoded = await adminAuth.verifyIdToken(idToken);

    // Claim allaqachon qo'yilgan bo'lsa — qayta qo'ymaymiz
    if (decoded.app === 'mrgram') {
      return res.status(200).json({ ok: true, skipped: true });
    }

    // Custom claim qo'shamiz
    await adminAuth.setCustomUserClaims(decoded.uid, {
      app: 'mrgram',
    });

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('[set-claim] error:', err.message);
    // Token noto'g'ri bo'lsa
    if (err.code?.includes('id-token')) {
      return res.status(401).json({ error: 'Token yaroqsiz' });
    }
    return res.status(500).json({ error: err.message });
  }
}

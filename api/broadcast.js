/**
 * MRdatabase — POST /api/broadcast
 * Admin barcha (yoki tanlangan) userlarga push notification yuboradi.
 * Faqat ADMIN_UID dan kelgan so'rovlar qabul qilinadi.
 *
 * Body: { adminUid, title, body, targetGroup }
 *   targetGroup: 'all' | 'approved' | 'pending'
 */
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { ADMIN_UID } from './_admin.js';

const CHUNK = 500; // FCM sendEachForMulticast max 500 token

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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Origin tekshiruvi — qo'shimcha himoya qatlami (asosiy himoya emas, chunki
  // brauzer bo'lmagan klientlar bu sarlavhalarni yubormasligi mumkin).
  const origin  = req.headers['origin']  || '';
  const referer = req.headers['referer'] || '';
  const allowed = process.env.ALLOWED_ORIGIN || '';
  const isAllowed = origin === allowed || referer.startsWith(allowed) || origin === '';
  if (!isAllowed) return res.status(403).json({ error: 'Forbidden' });

  // ── ASOSIY HIMOYA: Firebase ID token tekshiruvi ──
  // Ilgari bu yerda faqat so'rov tanasidagi `adminUid` maydoni solishtirilar
  // edi — bu qiymat client kodida ochiq turgani uchun HAR KIM o'zini admin
  // sifatida ko'rsatib, barcha foydalanuvchilarga push yubora olardi.
  // Endi chaqiruvchining haqiqiy Firebase identifikatorini token orqali
  // tekshiramiz va uni ADMIN_UID bilan solishtiramiz.
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

  // ADMIN_UID solishtirish + admin custom claim — ikkalasi ham qabul
  // qilinadi (migratsiya davrida hech kim admin huquqidan judo bo'lmasin).
  if (!decoded?.uid || (decoded.uid !== ADMIN_UID && decoded.admin !== true)) {
    return res.status(403).json({ error: 'Faqat admin yuborishi mumkin' });
  }

  const { title, body, targetGroup = 'all' } = req.body || {};

  if (!title || !body) {
    return res.status(400).json({ error: 'title va body talab qilinadi' });
  }

  try {
    const app = getAdminApp();
    const db  = getFirestore(app);
    const msg = getMessaging(app);

    const snap = await db.collection('users').get();
    const allTokens = [];

    snap.forEach(docSnap => {
      const u = docSnap.data();
      if (docSnap.id === ADMIN_UID) return; // adminga yuborma

      // Guruh filteri
      if (targetGroup === 'approved' && u.approved !== true) return;
      if (targetGroup === 'pending' && (u.approved === true || u.blocked)) return;
      if (u.blocked) return;

      const tokens = u.fcmTokens || [];
      tokens.forEach(t => { if (t) allTokens.push({ uid: docSnap.id, token: t }); });
    });

    if (!allTokens.length) {
      return res.status(200).json({ sent: 0, total: 0, reason: 'no-tokens' });
    }

    // 500 tadan chunklab yuboramiz
    let successCount = 0;
    const badTokensByUid = {};

    for (let i = 0; i < allTokens.length; i += CHUNK) {
      const chunk = allTokens.slice(i, i + CHUNK);
      const tokens = chunk.map(x => x.token);

      const resp = await msg.sendEachForMulticast({
        tokens,
        notification: { title, body },
        webpush: {
          fcmOptions: { link: 'https://mrgram.vercel.app/' },
          notification: {
            title,
            body,
            icon:  'https://mrgram.vercel.app/icons/icon-192.png',
            badge: 'https://mrgram.vercel.app/icons/icon-192.png',
            tag:   'mrgram-broadcast',
          },
        },
      });

      successCount += resp.successCount;

      // Bad tokenlarni uid bo'yicha yig'amiz
      resp.responses.forEach((r, idx) => {
        if (!r.success) {
          const code = r.error?.code || '';
          if (code.includes('registration-token-not-registered') || code.includes('invalid-argument')) {
            const uid = chunk[idx].uid;
            if (!badTokensByUid[uid]) badTokensByUid[uid] = [];
            badTokensByUid[uid].push(chunk[idx].token);
          }
        }
      });
    }

    // Bad tokenlarni tozalash
    const cleanups = Object.entries(badTokensByUid).map(async ([uid, badTokens]) => {
      const ref = db.collection('users').doc(uid);
      const snap = await ref.get();
      if (!snap.exists) return;
      const currentTokens = snap.data().fcmTokens || [];
      await ref.update({ fcmTokens: currentTokens.filter(t => !badTokens.includes(t)) });
    });
    await Promise.allSettled(cleanups);

    return res.status(200).json({ sent: successCount, total: allTokens.length });

  } catch (err) {
    console.error('[broadcast] error:', err);
    return res.status(500).json({ error: err.message });
  }
}

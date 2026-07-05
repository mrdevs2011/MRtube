/**
 * MRdatabase — POST /api/send-notification
 * Chatda yangi xabar yuborilganda chaqiriladi (modules/chat.js → sendChatMessage).
 * Recipient'ning Firestore'da saqlangan FCM tokenlariga push yuboradi.
 *
 * Kerakli Vercel Environment Variable:
 *   FIREBASE_SERVICE_ACCOUNT_BASE64  — service account JSON faylining base64 ko'rinishi
 *   ALLOWED_ORIGIN                   — api/config.js dagi bilan bir xil qiymat
 */
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

// 1 sekunda ichida bir xil (fromUid → toUid) juftlikdan faqat 1 ta notification
const _lastSent = new Map();
function isThrottled(fromUid, toUid) {
  const key = `${fromUid}:${toUid}`;
  const now = Date.now();
  if (_lastSent.has(key) && now - _lastSent.get(key) < 1000) return true;
  _lastSent.set(key, now);
  return false;
}

function getAdminApp() {
  if (getApps().length) return getApps()[0];

  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (!b64) throw new Error('FIREBASE_SERVICE_ACCOUNT_BASE64 environment variable topilmadi');

  const serviceAccount = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  return initializeApp({ credential: cert(serviceAccount) });
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

  /* ── Origin tekshiruvi — qo'shimcha himoya qatlami ── */
  const origin  = req.headers['origin']  || '';
  const referer = req.headers['referer'] || '';
  const allowed = process.env.ALLOWED_ORIGIN || '';

  const isAllowed =
    origin  === allowed ||
    referer.startsWith(allowed) ||
    origin  === '';

  if (!isAllowed) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  /* ── ASOSIY HIMOYA: Firebase ID token tekshiruvi ──
     Ilgari bu endpoint hech qanday autentifikatsiyasiz ishlar edi — har
     kim istalgan `fromUid`/`fromName` bilan istalgan foydalanuvchiga
     (soxta yuboruvchi nomidan) push-bildirishnoma yubora olardi. Endi
     chaqiruvchi haqiqatan ham tizimga kirgan bo'lishi va o'zini boshqa
     odam sifatida ko'rsatolmasligi (fromUid === token egasi) talab qilinadi. */
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

  const { toUid, fromUid, fromName, chatId, text, isCall, callType } = req.body || {};
  if (!toUid || !text) {
    return res.status(400).json({ error: 'toUid va text talab qilinadi' });
  }

  // Yuboruvchi identifikatorini spoofing qilib bo'lmaydi: fromUid har doim
  // token egasining haqiqiy uid'i bilan bir xil bo'lishi kerak.
  if (fromUid && fromUid !== decoded.uid) {
    return res.status(403).json({ error: 'fromUid token egasiga mos kelmaydi' });
  }

  try {
    const app = getAdminApp();
    const db  = getFirestore(app);

    const userSnap = await db.collection('users').doc(toUid).get();
    const tokens = userSnap.exists ? (userSnap.data().fcmTokens || []) : [];

    if (!tokens.length) {
      return res.status(200).json({ sent: 0, reason: 'no-tokens' });
    }

    // 1 sekunda ichida shu sender → shu recipient juftidan ko'p notification yuborma
    if (isThrottled(fromUid || '', toUid)) {
      return res.status(200).json({ sent: 0, reason: 'throttled' });
    }

    const messaging = getMessaging(app);
    const msgText  = String(text);
    const bodyText = msgText.length > 80 ? msgText.slice(0, 80).trimEnd() + '...' : msgText;
    const fullBody = (fromName || 'Kimdir') + ':\n' + bodyText;

    const resp = await messaging.sendEachForMulticast({
      tokens,
      notification: {
        title: 'MRgram',
        body:  fullBody,
      },
      data: {
        type:     isCall ? 'call' : 'chat',
        fromUid:  fromUid  || '',
        fromName: fromName || '',
        chatId:   chatId   || '',
        text:     bodyText,
        callType: callType || '',
      },
      webpush: {
        fcmOptions: { link: 'https://mrgram.vercel.app/' },
        notification: {
          title:              'MRgram',
          body:               fullBody,
          icon:               'https://mrgram.vercel.app/icons/icon-192.png',
          badge:              'https://mrgram.vercel.app/icons/icon-192.png',
          tag:                fromUid || chatId || 'mrgram-msg',
          requireInteraction: isCall ? true : false,
        },
      },
    });

    /* ── Eskirgan/o'chirilgan tokenlarni Firestore'dan tozalash ── */
    const badTokens = [];
    resp.responses.forEach((r, i) => {
      if (!r.success) {
        const code = r.error?.code || '';
        if (code.includes('registration-token-not-registered') || code.includes('invalid-argument')) {
          badTokens.push(tokens[i]);
        }
      }
    });
    if (badTokens.length) {
      await db.collection('users').doc(toUid).update({
        fcmTokens: tokens.filter(t => !badTokens.includes(t)),
      });
    }

    return res.status(200).json({ sent: resp.successCount });
  } catch (err) {
    console.error('[send-notification] failed:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}

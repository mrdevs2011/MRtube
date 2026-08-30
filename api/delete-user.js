/**
 * MRgram — POST /api/delete-user
 * Ikki joydan chaqiriladi:
 *   1) Admin panelda "O'chirish" bosilganda (modules/view-users.js) — istalgan
 *      userni o'chiradi.
 *   2) Profil → Sozlamalar → "Hisobni butunlay o'chirish" bosilganda
 *      (modules/auth.js) — foydalanuvchi FAQAT O'Z hisobini o'chiradi.
 *
 * Oldingi holat: faqat `users/{uid}` hujjati o'chirilar edi — userning
 * postlari, izohlari, like'lari, chatlari, guruh a'zoligi, follow
 * referenslari, username xaritasi va Firebase Authentication akkaunti
 * bazada "iz" bo'lib qolardi. Bu endpoint ADMIN SDK orqali (client
 * Firestore qoidalaridan mustaqil, to'liq huquq bilan) barcha izlarni
 * bosqichma-bosqich tozalaydi va oxirida Authentication akkauntini ham
 * o'chiradi.
 *
 * Body: { idToken: string, uid: string }
 * Header: Authorization: Bearer <idToken>  (idToken shu yerda ham qabul qilinadi)
 *
 * Kerakli Vercel Environment Variable:
 *   FIREBASE_SERVICE_ACCOUNT_BASE64 — service account JSON'ning base64 ko'rinishi
 *   ALLOWED_ORIGIN                  — boshqa api/* fayllardagi bilan bir xil qiymat
 *
 * ESLATMA: collectionGroup('comments')/('likes') so'rovlari uchun Firestore
 * konsolida "Collection group" ko'lamli composite index kerak bo'lishi mumkin
 * (userId maydoni bo'yicha). Birinchi ishga tushganda xatolik bo'lsa, Firestore
 * xato xabaridagi havola orqali indexni bir marta yaratib qo'yish kifoya —
 * shundan keyin doimiy ishlayveradi. Shu oraliqda ham qolgan bosqichlar davom
 * etadi (har bir bosqich alohida try/catch bilan izolyatsiya qilingan).
 */
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { ADMIN_UID } from './_admin.js';

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
  if (m) return m[1];
  return req.body?.idToken || null;
}

function originAllowed(req) {
  const origin  = req.headers['origin']  || '';
  const referer = req.headers['referer'] || '';
  const allowed = process.env.ALLOWED_ORIGIN || '';
  return origin === allowed || referer.startsWith(allowed) || origin === '';
}

function usernameKeyOf(username) {
  return String(username || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '');
    res.setHeader('Access-Control-Allow-Methods', 'POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!originAllowed(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'idToken (Bearer) talab qilinadi' });
  }

  const app = getAdminApp();

  let decoded;
  try {
    decoded = await getAuth(app).verifyIdToken(token);
  } catch (err) {
    return res.status(401).json({ error: 'Token yaroqsiz' });
  }

  // Ikki holatda ruxsat beriladi: (1) admin BOSHQA userni o'chirayotganda,
  // (2) foydalanuvchi O'Z hisobini o'chirayotganda ("Sozlamalar" ekranidan).
  // Spoofing mumkin emas — chunki uid har doim server tomonida verifyIdToken()
  // orqali tasdiqlangan decoded.uid bilan solishtiriladi.
  const { uid } = req.body || {};
  if (!uid || typeof uid !== 'string') {
    return res.status(400).json({ error: 'uid talab qilinadi' });
  }
  const isSelfDelete = decoded.uid === uid;
  const isAdminAction = decoded.uid === ADMIN_UID || decoded.admin === true;
  if (!isSelfDelete && !isAdminAction) {
    return res.status(403).json({ error: "Faqat o'z hisobingizni yoki (admin bo'lsangiz) boshqa hisobni o'chira olasiz" });
  }
  if (uid === ADMIN_UID) {
    return res.status(400).json({ error: "Admin akkauntini o'chirib bo'lmaydi" });
  }

  const db = getFirestore(app);
  const auth = getAuth(app);

  const report = {
    postsDeleted: 0, commentsDeleted: 0, likesDeleted: 0,
    chatsDeleted: 0, callsDeleted: 0,
    groupsDeleted: 0, groupsUpdated: 0,
    adminTasksDeleted: 0, contactsCleaned: 0, followRefsCleaned: 0,
    usernameMapDeleted: false, userDocDeleted: false, authDeleted: false,
    errors: [],
  };

  // ── 0. Userning o'z hujjati (username xaritasini tozalash uchun kerak) ──
  let userData = null;
  try {
    const uSnap = await db.collection('users').doc(uid).get();
    if (uSnap.exists) userData = uSnap.data();
  } catch (e) { report.errors.push('user-read: ' + e.message); }

  // ── 1. Userning o'z postlari (comments + likes subkolleksiyalari bilan) ──
  const deletedPostIds = new Set();
  try {
    const postsSnap = await db.collection('posts').where('userId', '==', uid).get();
    for (const p of postsSnap.docs) {
      deletedPostIds.add(p.id);
      try {
        await db.recursiveDelete(p.ref);
        report.postsDeleted++;
      } catch (e) { report.errors.push(`post ${p.id}: ${e.message}`); }
    }
  } catch (e) { report.errors.push('posts-query: ' + e.message); }

  // ── 2. Boshqalarning postlariga qoldirgan izohlari ──
  try {
    const cSnap = await db.collectionGroup('comments').where('userId', '==', uid).get();
    for (const c of cSnap.docs) {
      const postRef = c.ref.parent.parent;
      try {
        await c.ref.delete();
        report.commentsDeleted++;
        if (postRef && !deletedPostIds.has(postRef.id)) {
          await postRef.update({ commentCount: FieldValue.increment(-1) }).catch(() => {});
        }
      } catch (e) { report.errors.push(`comment ${c.id}: ${e.message}`); }
    }
  } catch (e) { report.errors.push('comments-query: ' + e.message); }

  // ── 3. Boshqalarning postlariga qo'ygan like'lari ──
  try {
    const lSnap = await db.collectionGroup('likes').where('userId', '==', uid).get();
    for (const l of lSnap.docs) {
      const postRef = l.ref.parent.parent;
      try {
        await l.ref.delete();
        report.likesDeleted++;
        if (postRef && !deletedPostIds.has(postRef.id)) {
          await postRef.update({ likes: FieldValue.increment(-1) }).catch(() => {});
        }
      } catch (e) { report.errors.push(`like ${l.id}: ${e.message}`); }
    }
  } catch (e) { report.errors.push('likes-query: ' + e.message); }

  // ── 4. Chatlar (ikkala tomon ham shu user bo'lgan xabarlar bilan birga) ──
  try {
    const chSnap = await db.collection('chats').doc('_index').collection('1v1chat').where('participants', 'array-contains', uid).get();
    for (const ch of chSnap.docs) {
      try {
        await db.recursiveDelete(ch.ref);
        report.chatsDeleted++;
      } catch (e) { report.errors.push(`chat ${ch.id}: ${e.message}`); }
    }
  } catch (e) { report.errors.push('chats-query: ' + e.message); }

  // ── 5. Qo'ng'iroqlar tarixi ──
  try {
    const [asCaller, asCallee] = await Promise.all([
      db.collection('chats').doc('_index').collection('calls').where('callerId', '==', uid).get(),
      db.collection('chats').doc('_index').collection('calls').where('calleeId', '==', uid).get(),
    ]);
    const callDocs = new Map();
    asCaller.docs.forEach(d => callDocs.set(d.id, d));
    asCallee.docs.forEach(d => callDocs.set(d.id, d));
    for (const d of callDocs.values()) {
      try {
        await d.ref.delete();
        report.callsDeleted++;
      } catch (e) { report.errors.push(`call ${d.id}: ${e.message}`); }
    }
  } catch (e) { report.errors.push('calls-query: ' + e.message); }

  // ── 6. Guruhlar: egasi bo'lsa butun guruh o'chadi, a'zo bo'lsa ro'yxatdan chiqadi ──
  try {
    const gSnap = await db.collection('chats').doc('_index').collection('groups').where('members', 'array-contains', uid).get();
    for (const g of gSnap.docs) {
      const gd = g.data();
      try {
        if (gd.ownerId === uid) {
          await db.recursiveDelete(g.ref);
          report.groupsDeleted++;
        } else {
          await g.ref.update({
            members: FieldValue.arrayRemove(uid),
            adminIds: FieldValue.arrayRemove(uid),
          });
          report.groupsUpdated++;
        }
      } catch (e) { report.errors.push(`group ${g.id}: ${e.message}`); }
    }
  } catch (e) { report.errors.push('groups-query: ' + e.message); }

  // ── 7. Bu userga tegishli admin vazifalari (masalan AI auto-block) ──
  try {
    const tSnap = await db.collection('ADMIN').doc('_index').collection('adminTasks').where('uid', '==', uid).get();
    for (const t of tSnap.docs) {
      try {
        await t.ref.delete();
        report.adminTasksDeleted++;
      } catch (e) { report.errors.push(`adminTask ${t.id}: ${e.message}`); }
    }
  } catch (e) { report.errors.push('adminTasks-query: ' + e.message); }

  // ── 8. Boshqa foydalanuvchilarning followers/following ro'yxatidan chiqarish ──
  try {
    const [asFollower, asFollowing] = await Promise.all([
      db.collection('users').where('followers', 'array-contains', uid).get(),
      db.collection('users').where('following', 'array-contains', uid).get(),
    ]);
    const affected = new Map();
    asFollower.docs.forEach(d => affected.set(d.id, d.ref));
    asFollowing.docs.forEach(d => affected.set(d.id, d.ref));
    for (const ref of affected.values()) {
      try {
        await ref.update({
          followers: FieldValue.arrayRemove(uid),
          following: FieldValue.arrayRemove(uid),
        });
        report.followRefsCleaned++;
      } catch (e) { report.errors.push(`follow-cleanup ${ref.id}: ${e.message}`); }
    }
  } catch (e) { report.errors.push('follow-query: ' + e.message); }

  // ── 9. Boshqa foydalanuvchilarning contacts subkolleksiyasidan tozalash ──
  try {
    const usersSnap = await db.collection('users').select().get();
    const others = usersSnap.docs.filter(d => d.id !== uid);
    await Promise.all(others.map(async d => {
      try {
        const cRef = db.collection('users').doc(d.id).collection('contacts').doc(uid);
        const cDoc = await cRef.get();
        if (cDoc.exists) {
          await cRef.delete();
          report.contactsCleaned++;
        }
      } catch (_) { /* best-effort, davom etamiz */ }
    }));
  } catch (e) { report.errors.push('contacts-cleanup: ' + e.message); }

  // ── 10. /usernames/{key} xaritasidan yozuvni o'chirish ──
  try {
    if (userData?.username) {
      const key = usernameKeyOf(userData.username);
      if (key) {
        await db.collection('users').doc('_index').collection('usernames').doc(key).delete();
        report.usernameMapDeleted = true;
      }
    }
  } catch (e) { report.errors.push('username-map: ' + e.message); }

  // ── 11. Userning o'z hujjati (loginHistory/contacts subkolleksiyalari bilan) ──
  try {
    await db.recursiveDelete(db.collection('users').doc(uid));
    report.userDocDeleted = true;
  } catch (e) { report.errors.push('user-doc: ' + e.message); }

  // ── 12. Firebase Authentication akkaunti ──
  try {
    await auth.deleteUser(uid);
    report.authDeleted = true;
  } catch (e) {
    if (e.code === 'auth/user-not-found') report.authDeleted = true;
    else report.errors.push('auth-delete: ' + e.message);
  }

  return res.status(200).json({ ok: true, report });
}

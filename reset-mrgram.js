/**
 * MRgram — TO'LIQ RESET SKRIPTI
 * ═══════════════════════════════════════════════════════════════════
 * Nima o'chiriladi:
 *   - posts               (barcha postlar + ularning comments/likes subcollection'lari)
 *   - chats/_index/1v1chat, groups, calls (barcha xabarlar bilan birga)
 *   - users               (FAQAT admin UID'dan boshqa hamma hujjat)
 *   - users/_index/usernames (FAQAT admin'ga tegishli bo'lmagan username yozuvlari)
 *   - ADMIN/_index/*      (adminActions, adminTasks, broadcastHistory — tarix)
 *
 * Nima SAQLANADI (TEGILMAYDI):
 *   - users/{ADMIN_UID}                    — admin profili
 *   - users/_index/usernames/{admin_uname} — admin username xaritasi
 *   - AI/{gk1,gk2,...}                     — Groq API kalit hujjatlari
 *   - AI/_stats/*                          — AI statistikasi (xohlasang qo'lda o'chir)
 *   - spbs-collection/controller           — HF/Groq legacy kalitlar
 *
 * ISHLATISH:
 *   1) npm install firebase-admin --save   (agar hali o'rnatilmagan bo'lsa)
 *   2) Firebase Console → Project Settings → Service Accounts →
 *      "Generate new private key" → JSON faylni yuklab ol
 *   3) Shu faylni loyiha papkasiga qo'y, nomini "serviceAccountKey.json" qil
 *      (yoki quyidagi KEY_PATH o'zgaruvchisini to'g'rila)
 *   4) node reset-mrgram.js --dry-run   ← AVVAL SHUNI ISHLAT (hech narsa o'chmaydi,
 *                                          faqat nima o'chirilishini ko'rsatadi)
 *   5) Natija to'g'ri ko'rinsa: node reset-mrgram.js --confirm
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const KEY_PATH = './serviceAccountKey.json';
const ADMIN_UID = 'cS9Riz2K4xgW1i4PVboWoQfhGok2';

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--confirm');

if (DRY_RUN) {
  console.log('⚠️  DRY-RUN rejimi — HECH NARSA o\'chirilmaydi, faqat ko\'rsatiladi.');
  console.log('   Haqiqiy o\'chirish uchun: node reset-mrgram.js --confirm\n');
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(readFileSync(KEY_PATH, 'utf8'));
} catch (err) {
  console.error(`❌ Service account key topilmadi: ${KEY_PATH}`);
  console.error('   Firebase Console → Project Settings → Service Accounts → Generate new private key');
  process.exit(1);
}

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

let totalDeleted = 0;

/** Berilgan query natijasidagi barcha hujjatlarni batch orqali o'chiradi (500 talik) */
async function deleteQueryBatch(query, label) {
  const snap = await query.get();
  if (snap.empty) return 0;

  console.log(`  → ${label}: ${snap.size} ta hujjat topildi`);
  if (DRY_RUN) return snap.size;

  let deleted = 0;
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += 500) {
    const batch = db.batch();
    const chunk = docs.slice(i, i + 500);
    chunk.forEach(d => batch.delete(d.ref));
    await batch.commit();
    deleted += chunk.length;
  }
  return deleted;
}

/** Hujjatning barcha subcollection'larini rekursiv o'chiradi, so'ng hujjatning o'zini */
async function deleteDocRecursive(docRef, label) {
  const subcols = await docRef.listCollections();
  for (const sub of subcols) {
    const n = await deleteQueryBatch(sub, `${label} > ${sub.id}`);
    totalDeleted += n;
  }
  if (!DRY_RUN) await docRef.delete();
  else console.log(`  → ${label}: hujjat o'chiriladi`);
  totalDeleted += 1;
}

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('1) POSTS — barcha postlar + comments/likes');
  console.log('═══════════════════════════════════════');
  const postsSnap = await db.collection('posts').get();
  console.log(`  Jami postlar: ${postsSnap.size}`);
  for (const postDoc of postsSnap.docs) {
    await deleteDocRecursive(postDoc.ref, `posts/${postDoc.id}`);
  }

  console.log('\n═══════════════════════════════════════');
  console.log('2) CHATS — 1v1chat, groups, calls (barcha xabarlar bilan)');
  console.log('═══════════════════════════════════════');
  const chatSubcollections = ['1v1chat', 'groups', 'calls'];
  for (const sub of chatSubcollections) {
    const ref = db.collection('chats').doc('_index').collection(sub);
    const snap = await ref.get();
    console.log(`  chats/_index/${sub}: ${snap.size} ta hujjat`);
    for (const d of snap.docs) {
      await deleteDocRecursive(d.ref, `chats/_index/${sub}/${d.id}`);
    }
  }

  console.log('\n═══════════════════════════════════════');
  console.log('3) USERS — admin\'dan boshqa hammasi');
  console.log('═══════════════════════════════════════');
  const usersSnap = await db.collection('users').get();
  let keptAdmin = false;
  const deletedUsernames = [];
  for (const userDoc of usersSnap.docs) {
    if (userDoc.id === '_index') continue; // alohida ishlaymiz pastda
    if (userDoc.id === ADMIN_UID) {
      keptAdmin = true;
      console.log(`  ✅ SAQLANDI (admin): users/${userDoc.id}`);
      continue;
    }
    const ud = userDoc.data();
    if (ud.username) deletedUsernames.push(ud.username.toLowerCase());
    await deleteDocRecursive(userDoc.ref, `users/${userDoc.id}`);
  }
  if (!keptAdmin) {
    console.warn(`  ⚠️  OGOHLANTIRISH: users/${ADMIN_UID} topilmadi! Admin UID to'g'riligini tekshir.`);
  }

  console.log('\n  users/_index/usernames — admin\'dan boshqa yozuvlar');
  const unameSnap = await db.collection('users').doc('_index').collection('usernames').get();
  for (const d of unameSnap.docs) {
    const data = d.data();
    if (data.uid === ADMIN_UID) {
      console.log(`  ✅ SAQLANDI (admin username): ${d.id}`);
      continue;
    }
    console.log(`  → o'chiriladi: users/_index/usernames/${d.id}`);
    if (!DRY_RUN) await d.ref.delete();
    totalDeleted += 1;
  }

  console.log('\n═══════════════════════════════════════');
  console.log('4) ADMIN — audit tarixi (adminActions, adminTasks, broadcastHistory)');
  console.log('═══════════════════════════════════════');
  const adminSubcollections = ['adminActions', 'adminTasks', 'broadcastHistory'];
  for (const sub of adminSubcollections) {
    const ref = db.collection('ADMIN').doc('_index').collection(sub);
    const n = await deleteQueryBatch(ref, `ADMIN/_index/${sub}`);
    totalDeleted += n;
  }

  console.log('\n═══════════════════════════════════════');
  console.log('TEGILMAGAN COLLECTION\'LAR (qasddan o\'tkazib yuborildi):');
  console.log('  - AI/{gk1,gk2,...}      (Groq API kalitlari)');
  console.log('  - AI/_stats/*           (AI statistika)');
  console.log('  - spbs-collection/*     (HF/Groq legacy kalitlar)');
  console.log('═══════════════════════════════════════');

  if (DRY_RUN) {
    console.log(`\n🔍 DRY-RUN tugadi. Jami o'chiriladigan hujjatlar: ~${totalDeleted}`);
    console.log('   Hammasi to\'g\'ri ko\'rinsa: node reset-mrgram.js --confirm');
  } else {
    console.log(`\n✅ RESET TUGADI. Jami o'chirilgan hujjatlar: ${totalDeleted}`);
    console.log('   Admin akkaunt saqlanib qoldi.');
  }
}

main().catch(err => {
  console.error('❌ Xato:', err);
  process.exit(1);
});

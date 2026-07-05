/**
 * migrate-usernames.js — BIR MARTALIK migratsiya skripti.
 *
 * Nima qiladi:
 *   Firestore'dagi barcha /users/{uid} hujjatlarini o'qib, har biri uchun
 *   yangi, MINIMAL /usernames/{username} -> { uid, email } yozuvini
 *   yaratadi. Bu — auth.js endi login paytida shu yangi jadvaldan
 *   qidiradi (to'liq /users profilini ochiq qilmasdan).
 *
 * QACHON ISHGA TUSHIRISH:
 *   1. Avval yangi kodni (modules/auth.js, firestore.rules) deploy qiling —
 *      lekin firestore.rules'da /users read qoidasi HALI "if true" bo'lsin
 *      (buni ATAYLAB shunday qoldirdik — pastga qarang).
 *   2. Shu skriptni BIR MARTA ishga tushiring (pastga qarang, qanday).
 *   3. Firebase Console'da /usernames kolleksiyasi to'lganini tekshiring
 *      (barcha userlar soni bilan solishtiring).
 *   4. Shundan KEYINGINA firestore.rules'da:
 *        match /users/{uid} { allow read: if true; ... }
 *      qatoridagi "if true" ni "if isAuthed();" ga almashtirib, qayta
 *      deploy qiling. Shundagina profil ma'lumotlari (email, push-token)
 *      internetdagi begona odamlarga ochiq bo'lishdan to'xtaydi.
 *
 * QANDAY ISHGA TUSHIRISH (kompyuteringizda, loyihaning o'zida emas):
 *   1. Firebase Console → Project Settings → Service Accounts →
 *      "Generate new private key" — JSON fayl yuklab oling.
 *   2. Terminalda:
 *        npm install firebase-admin
 *        GOOGLE_APPLICATION_CREDENTIALS="./service-account.json" node migrate-usernames.js
 *
 * Bu skript loyihaning asosiy kodiga (frontend'ga) HECH QANDAY aloqasi
 * yo'q — faqat bir martalik ma'lumotlar bazasi tuzatuvi uchun, keyin
 * o'chirib tashlashingiz mumkin.
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

function normalize(username) {
  return String(username || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function migrate() {
  console.log('Foydalanuvchilar o\'qilmoqda...');
  const usersSnap = await db.collection('users').get();
  console.log(`Jami ${usersSnap.size} ta foydalanuvchi topildi.`);

  let created = 0, skipped = 0, failed = 0;
  const batchSize = 400; // Firestore batch limiti 500, ehtiyot uchun kamroq
  let batch = db.batch();
  let opsInBatch = 0;

  for (const docSnap of usersSnap.docs) {
    const data = docSnap.data();
    const uid = docSnap.id;
    const username = data.username;
    const email = data.email;

    if (!username || !email) {
      console.warn(`⚠️  ${uid}: username yoki email yo'q, o'tkazib yuborildi`);
      skipped++;
      continue;
    }

    const key = normalize(username);
    if (!key) {
      console.warn(`⚠️  ${uid}: username normalizatsiyadan keyin bo'sh ("${username}")`);
      skipped++;
      continue;
    }

    try {
      const ref = db.collection('usernames').doc(key);
      batch.set(ref, { uid, email }, { merge: true });
      opsInBatch++;
      created++;

      if (opsInBatch >= batchSize) {
        await batch.commit();
        console.log(`  ...${created} ta yozildi (davom etmoqda)`);
        batch = db.batch();
        opsInBatch = 0;
      }
    } catch (err) {
      console.error(`❌ ${uid} (${username}): ${err.message}`);
      failed++;
    }
  }

  if (opsInBatch > 0) await batch.commit();

  console.log('\n=== Migratsiya tugadi ===');
  console.log(`✅ Yaratildi/yangilandi: ${created}`);
  console.log(`⚠️  O'tkazib yuborildi (ma'lumot yetishmadi): ${skipped}`);
  console.log(`❌ Xato: ${failed}`);
  console.log('\nEndi Firebase Console\'da "usernames" kolleksiyasini tekshiring.');
  console.log('Hammasi joyida bo\'lsa, firestore.rules\'da /users read qoidasini');
  console.log('"if isAuthed();" ga almashtirib qayta deploy qilishingiz mumkin.');
}

migrate().then(() => process.exit(0)).catch(err => {
  console.error('Migratsiya muvaffaqiyatsiz tugadi:', err);
  process.exit(1);
});

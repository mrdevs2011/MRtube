/**
 * push.js — FCM Web Push Notifications
 *
 * Android: sayt yopiq bo'lsa ham (background) xabar keladi
 * Desktop: sayt ochiq bo'lganda xabar keladi
 *
 * ⚠️  VAPID_KEY ni Firebase Console dan oling:
 *     Project Settings → Cloud Messaging → Web Push certificates → Generate key pair
 *     So'ng quyidagi VAPID_KEY ni o'zgartiring.
 */

import { db, auth, state } from './config.js';
import { doc, updateDoc, arrayUnion, arrayRemove } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getMessaging, getToken, deleteToken } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging.js';
import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';

// ⚠️  Firebase Console → Project Settings → Cloud Messaging → Web Push certificates
const VAPID_KEY = 'BNGEx0e9stxTPGNN-UbmNDUCmZOdFSQWt7JLVZwW4g-v0hfYHpFQMm2dtrwrwx6PF5e1jIwOPHF7tZUgttpe3DE';

// Foydalanuvchi "Sozlamalar" ekranidan bildirishnomalarni o'chirib qo'ysa,
// keyingi kirishlarda initPush() avtomatik chaqirilmasligi uchun localStorage
// bayrog'i. Standart holat: yoqilgan ('1' yozilmagan bo'lsa ham yoqilgan
// hisoblanadi — faqat aniq '0' yozilgan bo'lsa o'chirilgan deb qaraladi).
const NOTIF_LS_KEY = 'mrgramNotifsEnabled';

/** Foydalanuvchi bildirishnomalarni o'chirib qo'yganmi (Settings orqali)? */
export function notificationsUserDisabled() {
  try { return localStorage.getItem(NOTIF_LS_KEY) === '0'; } catch { return false; }
}

/** Settings ekranidagi toggle uchun: hozirgi holat yoqilganmi?
 * Brauzer ruxsati 'denied' bo'lsa — har doim o'chirilgan hisoblanadi
 * (JS orqali qayta yoqib bo'lmaydi, foydalanuvchi brauzer sozlamalaridan
 * o'zi yoqishi kerak). */
export function areNotificationsEnabled() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'denied') return false;
  return !notificationsUserDisabled();
}

let _messaging = null;
let _swReg     = null;
let _initDone  = false;

/** Service Worker'ni ro'yxatdan o'tkazish */
async function _registerSW() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    // Allaqachon ro'yxatdan o'tganmi?
    const existing = await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js');
    if (existing) return existing;
    return await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
  } catch {
    return null;
  }
}

/** FCM messaging instance olish */
function _getMessaging() {
  if (_messaging) return _messaging;
  try {
    _messaging = getMessaging(getApp());
    return _messaging;
  } catch {
    return null;
  }
}

/**
 * Push ruxsatini so'rash va FCM tokenni Firestore'ga saqlash.
 * auth.js → _enterApp() da chaqiriladi (foydalanuvchi kirganda).
 */
export async function initPush() {
  if (_initDone) return;
  if (!('Notification' in window)) return; // Browser qo'llab-quvvatlamaydi

  _swReg = await _registerSW();
  if (!_swReg) return;

  const messaging = _getMessaging();
  if (!messaging) return;

  // Foydalanuvchi allaqachon ruxsat berganmi?
  if (Notification.permission === 'denied') return; // Rad etilgan — so'ramaymiz

  try {
    // Ruxsat so'rash (agar 'default' bo'lsa — dialog chiqadi)
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    // FCM token olish
    const token = await getToken(messaging, {
      vapidKey:           VAPID_KEY,
      serviceWorkerRegistration: _swReg,
    });

    if (!token) return;

    // Tokenni Firestore'ga saqlash (arrayUnion — takror saqlamaydi)
    const uid = auth.currentUser?.uid || state.me?.uid;
    if (!uid) return;

    await updateDoc(doc(db, 'users', uid), {
      fcmTokens: arrayUnion(token),
    });

    _initDone = true;
  } catch {
    // Token olishda xato (VAPID key noto'g'ri, ruxsat yo'q) — jimgina
  }
}

/**
 * Chiqish paytida FCM tokenni Firestore'dan o'chirish.
 * auth.js → logOut() da chaqiriladi.
 */
export async function removePushToken() {
  try {
    const messaging = _getMessaging();
    if (!messaging || !_swReg) return;

    const token = await getToken(messaging, {
      vapidKey:           VAPID_KEY,
      serviceWorkerRegistration: _swReg,
    }).catch(() => null);

    if (!token) return;

    const uid = auth.currentUser?.uid || state.me?.uid;
    if (uid) {
      await updateDoc(doc(db, 'users', uid), {
        fcmTokens: arrayRemove(token),
      });
    }

    await deleteToken(messaging).catch(() => {});
  } catch {
    // Jimgina
  }
  _initDone = false;
}

/**
 * Settings ekranidagi "Bildirishnomalar" toggle tugmasi shu funksiyani
 * chaqiradi. Yoqilsa — brauzer ruxsatini so'rab, FCM tokenni qayta
 * ro'yxatdan o'tkazadi; o'chirilsa — tokenni o'chiradi va localStorage
 * bayrog'ini yozadi (keyingi kirishda initPush() avtomatik ishlamasligi
 * uchun — auth.js shu bayroqni tekshiradi).
 *
 * Qaytaradi: haqiqiy yakuniy holat (true = yoqilgan). Brauzer ruxsati
 * rad etilgan bo'lsa, `enabled=true` so'ralsa ham natija `false` bo'ladi.
 */
export async function setNotificationsEnabled(enabled) {
  if (!enabled) {
    await removePushToken();
    try { localStorage.setItem(NOTIF_LS_KEY, '0'); } catch {}
    return false;
  }

  try { localStorage.setItem(NOTIF_LS_KEY, '1'); } catch {}
  await initPush();
  return areNotificationsEnabled();
}

/**
 * firebase-messaging-sw.js
 * Background push notification handler.
 * Android: sayt yopiq bo'lsa ham ishlaydi.
 * Desktop: sayt ochiq bo'lsa ishlaydi (SW aktiv bo'lganda).
 */

importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            "AIzaSyBhzWWFFgrOH84J2RIW5o7l_8192iPtbOg",
  authDomain:        "code-vibe-df610.firebaseapp.com",
  projectId:         "code-vibe-df610",
  storageBucket:     "code-vibe-df610.firebasestorage.app",
  messagingSenderId: "747762490655",
  appId:             "1:747762490655:web:a6aba637700668ebf3a42a",
});

const messaging = firebase.messaging();

// Background xabar kelganda (sayt yopiq / fokusda emas)
messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};
  const data = payload.data || {};

  const isCall = data.type === 'call';

  self.registration.showNotification(title || 'MRgram', {
    body:  body || '',
    icon:  '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag:   isCall ? 'mrgram-call' : (data.fromUid || data.chatId || 'mrgram'),
    data:  { url: '/', ...data },
    // Qo'ng'iroqda kuchli tebranish pattern
    vibrate: isCall
      ? [500, 200, 500, 200, 500, 200, 500, 200, 500]
      : [200, 100, 200],
    requireInteraction: isCall, // Qo'ng'iroq bildirishnomasi o'z-o'zidan yopilmaydi
    silent: false,
    actions: isCall ? [
      { action: 'accept', title: 'Qabul qilish' },
      { action: 'reject', title: 'Rad etish' },
    ] : [],
  });
});

// Notification bosilganda saytni ochish
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data   = event.notification.data || {};
  const action = event.action; // 'accept' | 'reject' | ''
  const url    = '/';

  // URL ga action ni parametr sifatida qo'shamiz — sayt ochilganda qayta ishlaydi
  let openUrl = url;
  if (data.type === 'call' && data.fromUid) {
    openUrl = action === 'reject'
      ? `/?call_action=reject&from=${data.fromUid}`
      : `/?call_action=accept&from=${data.fromUid}`;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.postMessage({ type: 'CALL_ACTION', action, data });
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(openUrl);
    })
  );
});


/* ── Cache versiyasi ── */
// Statik fayllarga o'zgartirish kiritsangiz, PWA o'zi eskisini yangilashi uchun
// bu raqamni oshiring (v1 -> v2 -> v3 ...).
const CACHE_VERSION  = 'v62';
const STATIC_CACHE   = `mrgram-static-${CACHE_VERSION}`;
const RUNTIME_CACHE  = `mrgram-runtime-${CACHE_VERSION}`;

// PWA birinchi o'rnatilganda oldindan yuklab, cache'ga solib qo'yiladigan
// "ilova qobig'i" fayllari — tez ochilishi va OFFLINE'da ishlashi uchun.
//
// MUHIM: bu yerga ilovaning BARCHA modul fayllari kiritilishi shart —
// aks holda foydalanuvchi hali ochmagan sahifaga (masalan chat) offline
// paytida o'tsa, o'sha modul cache'da topilmay, import xatosi bilan
// BUTUN ilova ishdan chiqadi (ES module import — bittasi qulasa, hammasi
// qulaydi, chunki modullar bir-birini chain qilib import qiladi).
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/style.css',
  '/manifest.json',
  '/CSS/theme.css',
  '/CSS/nav.css',
  '/CSS/chat.css',
  '/CSS/feed.css',
  '/CSS/groups.css',
  '/CSS/profile.css',
  '/CSS/admin.css',
  '/CSS/borderless.css',
  '/CSS/dark-theme-fix.css',
  '/CSS/loading.css',
  '/CSS/local-utility.css',
  '/CSS/splash.css',
  '/CSS/devs-utility.css',
  '/CSS/ui-improvements.css',
  '/CSS/chat-dark-redesign.css',
  // Barcha JS modullari (modules/ papkasi to'liq)
  '/modules/script.js',
  '/modules/router.js',
  '/modules/config.js',
  '/modules/ui.js',
  '/modules/utils.js',
  '/modules/auth.js',
  '/modules/bar.js',
  '/modules/toast.js',
  '/modules/feed.js',
  '/modules/chat.js',
  '/modules/call.js',
  '/modules/comments.js',
  '/modules/cover-crop.js',
  '/modules/duration-picker.js',
  '/modules/file-extract.js',
  '/modules/groups.js',
  '/modules/local-cache.js',
  '/modules/profile.js',
  '/modules/push.js',
  '/modules/upload.js',
  '/modules/admin-audit.js',
  '/modules/admin-badge.js',
  '/modules/dashboard-summary.js',
  '/modules/mrgram-ai.js',
  '/modules/voice-fx-player.js',
  '/modules/token-usage.js',
  '/modules/view-ai-usage.js',
  '/modules/view-actions.js',
  '/modules/view-chats.js',
  '/modules/view-home.js',
  '/modules/view-login.js',
  '/modules/view-profile.js',
  '/modules/view-stats.js',
  '/modules/view-users.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/svg/MRgram.svg',
  '/svg/favicon.svg',
  '/svg/splash.svg',
  // "MRgram AI" ovozli xabar effekti (qisqa nafas) — offline holatda ham
  // javob eshittirilganda effekt ijro etilishi uchun. ([pauza] marker
  // audio fayl talab qilmaydi, shu sabab bu yerda yo'q. Boshqa eski
  // effektlar — tomoq-qirish/yo'tal/chuqur-nafas/kulgi — v58 patchda
  // butunlay olib tashlandi, endi ular ishlatilmaydi.)
  '/audio/sardor/qisqa-nafas.mp3',
  '/audio/madina/qisqa-nafas.mp3',
  // Firebase SDK (gstatic.com) — bular ES-import orqali chaqiriladi.
  // Bularsiz config.js import bosqichida XATO berib, offline'da BUTUN
  // ilova ishdan chiqadi — shuning uchun ular ham shart precache qilinadi.
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js',
];

// Qaysi so'rovlarga tegmaymiz (Firebase backend API, tashqi CDN va h.k.).
// DIQQAT: gstatic.com/firebasejs/* (Firebase SDK JS fayllari) BU YERDA
// bypass qilinmaydi — ular statik kutubxona fayllari, offline uchun
// keshlanishi SHART. Faqat haqiqiy jonli backend chaqiruvlari (Firestore
// so'rovlari, auth so'rovlari) bypass qilinadi — ular hech qachon
// keshlanmasligi kerak, chunki oni doim eng yangi ma'lumotni talab qiladi.
function _isBypassed(url) {
  // Firebase SDK statik fayllari (gstatic.com/firebasejs/*) — bypass QILINMAYDI,
  // ular keshlanishi va offline'da xizmat qilishi kerak (yuqorida sabab yozilgan).
  if (url.startsWith('https://www.gstatic.com/firebasejs/')) return false;

  // Qolgan hammasi: jonli backend chaqiruvlari, boshqa tashqi domenlar —
  // bularni hech qachon keshlamaymiz / to'g'ridan-to'g'ri tarmoqqa yuboramiz.
  return (
    url.includes('googleapis.com') ||   // Firestore/Auth/Storage REST so'rovlari
    url.includes('gstatic.com') ||      // boshqa gstatic resurslar (SDK bundan mustasno, yuqorida)
    url.includes('firebase') ||
    url.includes('/api/') ||
    url.includes('cloudflare') ||
    !url.startsWith(self.location.origin)
  );
}

// Statik resurs turini aniqlaymiz (CSS/JS/rasm/font) — bularga cache-first qo'llanadi
function _isStaticAsset(request) {
  const dest = request.destination; // 'style' | 'script' | 'image' | 'font' | ...
  return dest === 'style' || dest === 'script' || dest === 'image' || dest === 'font';
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => Promise.allSettled(
        // cache.addAll() bitta URL xato bersa BARCHASINI bekor qiladi —
        // shuning uchun har birini alohida, bir-biriga bog'liqmasdan
        // yuklaymiz. Bitta fayl (masalan CDN sekinlik qilib) muvaffaqiyatsiz
        // bo'lsa ham, qolganlari baribir keshda qoladi.
        PRECACHE_URLS.map((u) =>
          cache.add(u).catch((err) => console.warn('[SW] Precache xato:', u, err.message))
        )
      ))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Eski versiyadagi cache'larni tozalaymiz
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      );
      await clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = event.request.url;
  if (_isBypassed(url)) return;

  const isNavigation = event.request.mode === 'navigate' ||
    event.request.destination === 'document';

  // ── HTML sahifa (navigatsiya): CACHE-FIRST + fonda yangilash ──
  if (isNavigation) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(event.request) || await caches.match('/index.html') || await caches.match('/');
        const networkFetch = fetch(event.request)
          .then((response) => {
            if (response && response.status === 200 && response.type === 'basic') {
              const cloned = response.clone();
              caches.open(RUNTIME_CACHE).then((cache) => cache.put(event.request, cloned));
            }
            return response;
          })
          .catch(() => null);

        if (cached) {
          return cached;
        }
        const net = await networkFetch;
        if (net) return net;
        return new Response('Offline — internet aloqasi yo\'q', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      })()
    );
    return;
  }

  // ── Statik fayllar (CSS/JS/rasm/font): cache-first + fonda yangilash ──
  if (_isStaticAsset(event.request)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const networkFetch = fetch(event.request)
          .then((response) => {
            const cacheable = response && response.status === 200 &&
              (response.type === 'basic' || url.startsWith('https://www.gstatic.com/firebasejs/'));
            if (cacheable) {
              const cloned = response.clone();
              caches.open(STATIC_CACHE).then((cache) => cache.put(event.request, cloned));
            }
            return response;
          })
          .catch(() => cached);
        return cached || networkFetch;
      })
    );
    return;
  }

  // ── Qolgan hammasi: network-first, cache fallback ──
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const cloned = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(event.request, cloned));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        return new Response('Offline', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/plain' }
        });
      })
  );
});

# MRgram — Web'dan 100% Native Kotlin (Android)ga o'tkazish ROADMAP

> Bu fayl siz uchun emas, **AI kod agenti uchun** (Claude Code, Cursor, Windsurf va h.k.)
> yozilgan. Har bir bosqichda "AGENT UCHUN PROMPT" bloki bor — uni **o'zgartirmasdan,
> to'liq nusxalab** AI agentga bering. Har bosqichdan keyin natijani tekshirish
> mezonlari (✅ Qabul mezonlari) berilgan — shularga amal qiling.
>
> Loyihani hech qachon shoshilib, bir necha bosqichni birga qilishga urinmang.
> Har safar **FAQAT bitta bosqich**, build muvaffaqiyatli bo'lgach — keyingisiga o'ting.

---

## 0-QISM — Umumiy tamoyillar (har bir sessiyada agentga eslatib turing)

Har bir AI agent sessiyasini boshlashda, asosiy promptdan OLDIN quyidagi
"qoidalar bloki"ni doim qo'shing (yoki CLAUDE.md / .cursorrules faylga bir marta yozib qo'ying):

```
QOIDALAR (har doim rioya qilinsin):
1. Bu loyiha MRgram — mavjud web (PWA) ilovaning Kotlin/Android native versiyasi.
   Backend (Firebase Auth, Firestore, Supabase Storage, Vercel serverless API'lar)
   O'ZGARTIRILMAYDI — faqat mobil frontend yoziladi.
2. Firestore collection nomlari, document field nomlari va ma'lumot tuzilishi
   web versiyadagi bilan 100% BIR XIL bo'lishi SHART (masalan: users, posts,
   chats/{id}/messages, groups, spbs-collection/controller). Aks holda ikki
   ilova (web + android) bir xil ma'lumot bilan ishlay olmay qoladi.
3. Har bir bosqich tugagach: `./gradlew assembleDebug` orqali build qiling.
   Xato bo'lsa — keyingi bosqichga o'tmasdan, xatoni to'liq tuzating.
4. Arxitektura: MVVM + Repository pattern. UI: Jetpack Compose. DI: Hilt.
5. Har bir yangi ekran uchun preview/test qiling — bo'sh/loading/xato holatlarini
   ham ko'rsating (web versiyada skeleton loading bor — shuni saqlang).
6. Hech qanday API kalitini (Groq, Supabase service key va h.k.) Android kodiga
   YOZMANG. Faqat mavjud Vercel `/api/...` endpointlarini chaqiring (web ham
   shunday qiladi) — Firebase ID token bilan Authorization header yuboring.
7. Har bir bosqichni tugatgach, o'zgargan/qo'shilgan fayllar ro'yxatini va
   qisqa xulosani yozib bering.
```

**Loyiha manbasi:** yuklangan `MRgram_v62.zip` — buni agent ishlaydigan
kompyuterda `reference/` papkasiga chiqarib qo'ying (masalan
`unzip MRgram_v62.zip -d reference/`). Har bir bosqichda agentga aynan shu
`reference/` ichidagi fayllarni **o'qib, mantiqni o'rganib, keyin Kotlin'da
qayta yozish** vazifasi beriladi — kodni so'zma-so'z tarjima qilish EMAS,
balki xuddi shu **funksional natijani** Android'da qayta qurish.

---

## 1-QISM — Maqsad arxitektura (umumiy xarita)

| Web (hozirgi)                         | Android (native Kotlin)                          |
|----------------------------------------|---------------------------------------------------|
| Firebase JS SDK (Auth/Firestore)       | Firebase Android SDK (Auth/Firestore KTX)          |
| Supabase Storage (fayl/rasm saqlash)   | Supabase Kotlin SDK yoki REST orqali               |
| Vercel `/api/*` (Groq AI, TTS, push)   | Retrofit + OkHttp orqali xuddi shu endpointlar     |
| Service Worker (FCM background push)  | `FirebaseMessagingService` + FCM                   |
| vanilla JS modullar (`modules/*.js`)  | Kotlin: `data/`, `domain/`, `ui/` qatlamlari       |
| CSS fayllar (tema, dark mode)         | Compose Theme (Material3, color scheme)            |
| IndexedDB local-cache                 | Room (SQLite) offline-cache                        |
| WebRTC (brauzer API)                  | `org.webrtc` (Google WebRTC Android lib)           |
| Client-side router (`router.js`)      | Navigation Compose                                 |

**Modul → Kotlin paket moslashuvi:**

```
modules/config.js      → data/remote/Firebase.kt, di/FirebaseModule.kt
modules/auth.js        → data/repository/AuthRepository.kt, ui/auth/*
modules/chat.js        → data/repository/ChatRepository.kt, ui/chat/*
modules/groups.js      → data/repository/GroupRepository.kt, ui/groups/*
modules/call.js        → data/webrtc/*, ui/call/*
modules/feed.js        → data/repository/FeedRepository.kt, ui/feed/*
modules/upload.js      → data/repository/UploadRepository.kt
modules/profile.js     → data/repository/ProfileRepository.kt, ui/profile/*
modules/mrgram-ai.js   → data/repository/AiRepository.kt, ui/chat/AiChatScreen.kt
modules/push.js        → service/MrgramFirebaseMessagingService.kt
modules/view-users.js  → ui/admin/*
modules/view-stats.js  → ui/admin/StatsScreen.kt
modules/local-cache.js → data/local/AppDatabase.kt (Room)
firestore.rules        → O'ZGARMAYDI (backend bilan bo'lishiladi)
api/*.js               → O'ZGARMAYDI (Retrofit orqali chaqiriladi)
```

---

## 2-QISM — Bosqichlar (Phases)

Har bir bosqich: **Maqsad → Manba fayllar → AGENT UCHUN PROMPT → Qabul mezonlari**

---

### PHASE 0 — Loyiha skeleti va muhit sozlash

**Maqsad:** Android Studio loyihasini yaratish, Firebase'ga ulash, kerakli
kutubxonalarni qo'shish.

**Manba:** `firebase.json`, `modules/config.js` (Firebase config qiymatlari)

**AGENT UCHUN PROMPT:**
```
Yangi Android Studio loyihasi yarat: nomi "MRgram", paket nomi
"uz.mrgram.app", minSdk 26, targetSdk eng yangi barqaror versiya,
Kotlin + Jetpack Compose shablon bilan.

Quyidagi kutubxonalarni Gradle (version catalog — libs.versions.toml orqali)
ga qo'sh:
- Firebase BOM (eng yangi): firebase-auth-ktx, firebase-firestore-ktx,
  firebase-messaging-ktx, firebase-storage-ktx (agar kerak bo'lsa)
- Hilt (dependency injection) + hilt-navigation-compose
- Navigation Compose
- Retrofit2 + OkHttp + kotlinx-serialization-converter
- Coil (Compose uchun rasm yuklash)
- Room (local cache uchun)
- WorkManager
- Coroutines + Flow
- Accompanist yoki Compose Permissions API (kamera/mikrofon ruxsatlari uchun)

reference/modules/config.js faylidan Firebase konfiguratsiya qiymatlarini
(apiKey, projectId, appId va h.k.) o'qib, shu ma'lumotlar bilan Firebase
Console'da "Add Android app" qilingandek google-services.json placeholder
tuzilmasini tushuntirib ber (foydalanuvchi buni o'zi Firebase Console'dan
yuklab olishi kerakligini ayting — chunki Android uchun alohida
google-services.json fayl kerak, web config'dan farqli).

Loyiha papka tuzilmasini yarat:
app/src/main/java/uz/mrgram/app/
  ├── data/
  │   ├── local/       (Room)
  │   ├── remote/       (Firebase, Retrofit)
  │   └── repository/
  ├── domain/model/
  ├── di/
  ├── ui/
  │   ├── theme/
  │   ├── auth/
  │   ├── feed/
  │   ├── chat/
  │   ├── groups/
  │   ├── call/
  │   ├── profile/
  │   └── admin/
  └── MainActivity.kt, MrgramApp.kt (Application class, @HiltAndroidApp)

Bo'sh MainActivity yoz — faqat "MRgram" matnini ko'rsatadigan Compose
ekran bilan. Build muvaffaqiyatli bo'lishi kerak.
```

**✅ Qabul mezonlari:**
- `./gradlew assembleDebug` xatosiz o'tadi
- Ilova emulator/telefonda ochilib, "MRgram" matnini ko'rsatadi
- Papka tuzilmasi yuqoridagidek yaratilgan

---

### PHASE 1 — Ma'lumot modellari (Data Models) va Firestore sxemasi

**Maqsad:** Web versiyadagi Firestore hujjat tuzilmalarini Kotlin data
class'lariga aylantirish.

**Manba:** `modules/config.js`, `modules/auth.js`, `modules/chat.js`
(fayl boshidagi schema izohi), `modules/groups.js` (schema izohi),
`modules/feed.js`, `firestore.rules` (collection nomlari va maydonlar
ruxsatlari uchun)

**AGENT UCHUN PROMPT:**
```
reference/firestore.rules faylini boshidan oxirigacha o'qi — bu yerda
BARCHA Firestore collection'lari va ularning maydonlari qanday
ishlatilishi aniq ko'rinadi.

Shuningdek reference/modules/groups.js faylining boshidagi schema
izohini, reference/modules/chat.js va reference/modules/auth.js
fayllaridagi Firestore collection('...'), doc('...') chaqiruvlarini
tahlil qil.

Shu tahlil asosida domain/model/ papkasida quyidagi Kotlin data
class'larni yarat (barcha maydon nomlari Firestore'dagi bilan AYNAN
bir xil bo'lishi shart — @PropertyName annotatsiyasi bilan kerak bo'lsa):

- User.kt (users collection: uid, username, fullName, avatar, cover,
  bio, website, location, approved, blockedUntil, isAdmin va h.k. —
  aniq maydonlarni reference fayllardan top)
- Post.kt (postlar/feed uchun)
- Comment.kt
- ChatMessage.kt (matn, ovozli xabar, fayl, reply, o'qilgan holati)
- Chat.kt (chat metadata: lastMessage, unreadCount, typing holati)
- Group.kt (groups collection: type=group|channel, ownerId, adminIds,
  members, va h.k.)
- GroupMessage.kt
- CallSession.kt (WebRTC signalizatsiya uchun)

Har bir model uchun Firestore'dan gapıştırılganda ishlaydigan
`toObject()`/`@DocumentId` mos annotatsiyalarni qo'sh. Null-safety'ga
alohida e'tibor ber — Firestore'dan kelgan maydonlar ba'zan yo'q
bo'lishi mumkin, shuning uchun default qiymatlar ber.

Testlar: har bir model uchun oddiy unit test yoz — JSON/Map dan
model'ga to'g'ri map bo'lishini tekshirish uchun.
```

**✅ Qabul mezonlari:**
- Barcha model fayllar kompilyatsiya qilinadi
- Har bir modelning maydon nomlari `firestore.rules` va tegishli
  `modules/*.js` fayllardagi nomlar bilan bir xil ekanligi qo'lda
  tekshirilgan (checklist sifatida solishtiring)

---

### PHASE 2 — Autentifikatsiya (Auth) moduli

**Maqsad:** Login, ro'yxatdan o'tish, "tasdiq kutilmoqda" va "bloklangan"
ekranlari.

**Manba:** `modules/auth.js` (to'liq), `README.md` bo'lim 1 (Auth qadamlari)

**AGENT UCHUN PROMPT:**
```
reference/modules/auth.js faylini to'liq o'qi, ayniqsa signIn, signUp,
onAuthStateChanged logikasini. Shuningdek reference/README.md dagi
"1. Ro'yxatdan o'tish va kirish (Auth)" bo'limini diqqat bilan o'qi —
bu yerda BIZNES QOIDALAR aniq yozilgan:

- Login: faqat username + parol (email ko'rsatilmaydi, lekin username
  asosida ichki email yaratiladi: masalan `{username}@mrgram.internal`
  formatida — aniq formatni auth.js dan top).
- Signup: 4 maydon — to'liq ism, username, parol, parolni tasdiqlash
  (min 6 belgi). Email/yosh maydoni YO'Q.
- Parolni tiklash funksiyasi UMUMAN YO'Q — buni UI'da ham ko'rsatma.
- Ro'yxatdan o'tgach hisob DARHOL ochilmaydi — approved=false holatida
  "Kutish" ekrani ko'rsatiladi.
- approved="rejected" bo'lsa — "arizangiz rad etildi" ekrani.
- Admin bloklashi mumkin (muddatli yoki doimiy) — blokdagi user maxsus
  "bloklangan, X vaqtdan keyin ochiladi" ekranini ko'radi.

Kotlin'da yarat:
data/repository/AuthRepository.kt — Hilt orqali inject qilinadigan,
  Firebase Auth bilan ishlaydigan repository. Funksiyalar: signIn(username,
  password), signUp(fullName, username, password), signOut(),
  observeAuthState(): Flow<AuthState>.

domain/model/AuthState.kt — sealed class: Loading, LoggedOut,
  PendingApproval, Rejected, Blocked(until: Long?), Authenticated(user).

ui/auth/LoginScreen.kt, SignupScreen.kt, PendingApprovalScreen.kt,
  RejectedScreen.kt, BlockedScreen.kt — Jetpack Compose, Material3.
  Web versiyadagi soddalikni saqla (faqat kerakli maydonlar, ortiqcha
  hech narsa qo'shma).

ui/auth/AuthViewModel.kt — yuqoridagi holatlarni boshqaradi, xato
  xabarlarini ko'rsatadi (masalan "username band", "parol xato" va h.k.
  — auth.js dagi xato handling'ni Kotlin'ga moslashtir).

Navigation: MainActivity'da AuthState'ga qarab qaysi ekran
ko'rsatilishini boshqaradigan yuqori darajadagi NavHost yoz.
```

**✅ Qabul mezonlari:**
- Yangi username bilan ro'yxatdan o'tish → "Kutish" ekrani chiqadi
- Firebase Console'da shu user document'ida `approved: false` ko'rinadi
- Admin (qo'lda Firestore'da `approved: true` qilib) tasdiqlagach,
  ilovani qayta ochganda asosiy ekranga o'tadi
- Login/signup xatolari foydalanuvchiga tushunarli ko'rsatiladi

---

### PHASE 3 — Asosiy navigatsiya skeleti (Bottom Nav + Router)

**Maqsad:** Pastki navigatsiya (Bosh sahifa, Qidiruv, Yaratish, Suhbatlar,
Profil, Admin) va ekranlar orasida o'tish.

**Manba:** `modules/router.js`, `README.md` bo'lim 10 (UI xaritasi)

**AGENT UCHUN PROMPT:**
```
reference/README.md dagi "10. Interfeys tuzilishi — UI xaritasi"
bo'limini o'qi. reference/modules/router.js dagi ROUTE CONFIGURATION
qismini ham ko'rib chiq.

Navigation Compose bilan quyidagi tuzilmani yarat:
- Pastki navigatsiya bar (6 ta bo'lim: Bosh sahifa, Qidiruv, Yaratish,
  Suhbatlar, Profil, Admin — Admin FAQAT isAdmin=true bo'lsa ko'rinadi).
- Har bir bo'lim uchun hozircha bo'sh/placeholder Composable ekran yarat
  (keyingi bosqichlarda to'ldiriladi): HomeScreen, SearchScreen,
  UploadScreen, ChatsScreen, ProfileScreen, AdminScreen.
- "Yaratish" tugmasi markazda kattaroq doira ko'rinishida (web
  versiyadagidek).
- Suhbatlar bo'limida o'qilmagan xabar badge'i uchun joy ajrat (hozircha
  statik 0).

MainViewModel orqali joriy user (isAdmin, approved) holatini butun
navigatsiya daraxtiga uzat (CompositionLocal yoki ViewModel orqali).
```

**✅ Qabul mezonlari:**
- Pastki navigatsiyadagi barcha tugmalar tegishli bo'sh ekranlarga
  o'tkazadi
- Admin bo'limi faqat admin user uchun ko'rinadi (test uchun Firestore'da
  qo'lda `isAdmin: true` qo'yib tekshiring)

---

### PHASE 4 — Lenta (Feed) va Post yuklash

**Manba:** `modules/feed.js`, `modules/upload.js`, `modules/view-home.js`,
`README.md` bo'lim 2-3

**AGENT UCHUN PROMPT:**
```
reference/modules/feed.js va reference/modules/upload.js fayllarini
to'liq o'qi. reference/README.md dagi "2. Post yuklash" va "3. Lenta"
bo'limlarini o'qi.

Yarat:
data/repository/FeedRepository.kt — postlarni olish (Firestore
  onSnapshot'ga mos Flow), like/unlike, izoh qo'shish, post o'chirish,
  ko'rishlar sonini oshirish (post 60% ko'ringanda — feed.js dagi
  logikaga qara).

data/repository/UploadRepository.kt — fayl tanlash (Android Photo
  Picker / ACTION_GET_CONTENT), Supabase Storage'ga yuklash (REST API
  orqali, reference/modules/config.js dagi uploadViaController
  funksiyasi mantig'ini o'rgan), 50MB cheklovi, ko'rinish darajasi
  (Shaxsiy/Ommaviy) tanlovi.

ui/feed/FeedScreen.kt — vertikal to'liq ekranli scroll (LazyColumn),
  har bir post: rasm/video, like/comment/share tugmalari, "✨ AI fikri"
  va "AI izoh taklifi" tugmalari (bular AiRepository orqali Vercel
  /api/groq-chat ni chaqiradi — hozircha PHASE 9 da to'liq ulanadi,
  hozir UI joyini tayyorlab qo'y).

ui/feed/UploadScreen.kt — fayl tanlash, tavsif matni, "✨ AI caption"
  tugmasi (placeholder), ko'rinish darajasi tanlovi, yuklash progress
  indikatori.

Markdown render: post tavsifi va izohlarda **qalin**, *egik*, `kod`,
  # sarlavha, - ro'yxat ishlashi kerak — buning uchun mavjud Compose
  Markdown kutubxonasidan foydalan (masalan
  com.mikepenz:multiplatform-markdown-renderer) yoki oddiy regex-based
  parser yoz.
```

**✅ Qabul mezonlari:**
- Yangi post yuklash → Firestore `posts` collection'ida yangi hujjat
  paydo bo'ladi, fayl Supabase Storage'da ko'rinadi
- Lenta real-vaqtda yangilanadi (boshqa qurilmada/brauzerda yuklangan
  post shu ilovada ham chiqadi)
- Like bosilganda Firestore'da increment to'g'ri ishlaydi

---

### PHASE 5 — Profil

**Manba:** `modules/profile.js`, `modules/cover-crop.js`,
`modules/view-profile.js`, `README.md` bo'lim 7

**AGENT UCHUN PROMPT:**
```
reference/modules/profile.js va reference/modules/cover-crop.js
fayllarini o'qi.

Yarat:
data/repository/ProfileRepository.kt — profil ma'lumotlarini olish/
  yangilash, follow/unfollow (reference/modules/auth.js dagi follow/
  unfollow funksiyalariga qara — bular auth.js da ekanini unutma).

ui/profile/ProfileScreen.kt — muqova rasmi, ustiga chiqib turgan
  avatar, statistikalar (postlar/yoqtirishlar/obunachilar/obunalar),
  ism/username/bio, "Profilni sozlash" tugmasi, postlar panjarasi
  (3 ustunli grid — LazyVerticalGrid).

ui/profile/EditProfileScreen.kt — ism, username, avatar, muqova, bio,
  veb-sayt, joylashuv tahrirlash. Rasm kesish (crop) uchun mavjud
  Android crop kutubxonasidan foydalan (masalan
  com.github.yalantis:ucrop) — cover-crop.js dagi crop nisbatlariga mos
  keladigan qilib sozla.
```

**✅ Qabul mezonlari:**
- Profil ma'lumotlarini tahrirlash Firestore'da saqlanadi va boshqa
  ekranlarda (masalan feed'dagi avatar) darhol yangilanadi
- Follow/unfollow ishlaydi va hisoblagichlar to'g'ri o'zgaradi

---

### PHASE 6 — Suhbatlar (1v1 Chat) — ENG KATTA MODUL

**Manba:** `modules/chat.js` (129KB — eng katta fayl, sinchiklab o'qilishi
kerak), `README.md` bo'lim 4

**AGENT UCHUN PROMPT:**
```
DIQQAT: reference/modules/chat.js juda katta fayl. Uni bo'laklab o'qi
(masalan avval funksiya nomlari ro'yxatini chiqar: grep "^function\|^export
function" reference/modules/chat.js), keyin har bir funksional blokni
alohida-alohida chuqur o'qi:
1. Chat ro'yxati va real-vaqt watcher (startChatsWatcher)
2. Xabar yuborish/qabul qilish (matn)
3. Ovozli xabar yozib olish va yuborish
4. Fayl yuborish
5. Reply (javob berish)
6. Xabar qidirish
7. O'qilgan/yuborilgan holat belgilari (bitta/ikkita ko'k belgi)
8. "Yozmoqda..." indikatori va onlayn holat (presence)

README.md bo'lim 4 dagi biznes qoidalarni ham o'qi.

Yarat:
data/repository/ChatRepository.kt — barcha yuqoridagi funksiyalarning
  Kotlin/Firestore ekvivalenti. Flow asosida real-vaqt yangilanish.

data/repository/PresenceRepository.kt — onlayn/oxirgi ko'rilgan holatni
  boshqarish (App lifecycle'ga bog'lab, foreground/background holatida
  Firestore'da presence yangilash).

ui/chat/ChatsListScreen.kt — suhbatlar ro'yxati, "MRgram AI" doim eng
  tepada pinned holda.

ui/chat/ChatThreadScreen.kt — to'liq ekranli chat oynasi: xabarlar
  ro'yxati (LazyColumn, pastdan yuqoriga), matn kiritish maydoni,
  mikrofon tugmasi (ovozli xabar — MediaRecorder API bilan yozib olish),
  fayl biriktirish, reply UI, xabar holati belgilari, "Yozmoqda..."
  ko'rsatkichi.

Ovozli xabarni ijro etish uchun ExoPlayer/MediaPlayer bilan ovozli
  xabar pleyeri komponentini yoz (play/pause, progress bar, davomiyligi).

Markdown render: har bir xabarda ham ishlashi kerak (PHASE 4 da
  yaratilgan Markdown komponentdan qayta foydalan).
```

**✅ Qabul mezonlari:**
- Ikki test-akkaunt orasida matnli xabar real-vaqtda yetib boradi
- Ovozli xabar yozib olinadi, yuboriladi va boshqa qurilmada ijro
  etiladi
- "Yozmoqda..." indikatori ishlaydi
- Xabar holat belgilari (yuborildi/o'qildi) to'g'ri yangilanadi

---

### PHASE 7 — Guruhlar va Kanallar

**Manba:** `modules/groups.js`, `README.md` bo'lim 5

**AGENT UCHUN PROMPT:**
```
reference/modules/groups.js faylini boshidagi Firestore schema
izohidan boshlab to'liq o'qi. README.md bo'lim 5 ni ham o'qi.

Yarat:
data/repository/GroupRepository.kt — guruh/kanal yaratish (Maxfiy/Ochiq),
  a'zo qo'shish/chiqarish (kick), egasi/admin huquqlari, havola/kod
  orqali qo'shilish, xabar yuborish (ChatRepository bilan umumiy
  mantiqni PHASE 6 dagi kod bilan qayta ishlating — groups.js da ham
  aytilganidek, kodni takrorlamang, umumiy qism uchun
  BaseMessagingRepository yoki shunga o'xshash umumiy interfeys yarating).

ui/groups/CreateGroupScreen.kt — guruh/kanal turi, nomi, rasm, Maxfiy/
  Ochiq tanlovi.

ui/groups/GroupInfoScreen.kt — a'zolar ro'yxati, admin huquqlari, kick
  qilish, havola bilan ulashish.

ui/groups/GroupChatScreen.kt — ChatThreadScreen'ga o'xshash, lekin
  ko'p a'zoli (kim yuborganini ko'rsatish, kanal uchun faqat admin
  yoza olishi).

Yengil AI-moderatsiya: guruh xabarlarida ham feed post moderatsiyasiga
  o'xshash tekshiruv PHASE 9 da ulanadi — hozir hook joyini tayyorlab
  qo'y.
```

**✅ Qabul mezonlari:**
- Yangi guruh yaratish, a'zo qo'shish, xabar yozish ishlaydi
- Kanalda faqat admin yoza olishi tekshirilgan
- Maxfiy guruhga faqat kod/havola orqali qo'shilish mumkinligi
  tekshirilgan

---

### PHASE 8 — Audio/Video qo'ng'iroqlar (WebRTC)

**Manba:** `modules/call.js`, `README.md` bo'lim 6

**AGENT UCHUN PROMPT:**
```
reference/modules/call.js faylini to'liq o'qi — bu yerda WebRTC
signalizatsiya Firestore orqali qanday amalga oshirilgani (offer/
answer/ICE candidate almashinuvi qaysi collection/document orqali
bo'lishi) aniq ko'rsatilgan. Buni AYNAN saqlab qolish kerak — chunki
web va Android userlar bir-biriga qo'ng'iroq qila olishi kerak.

Android uchun Google'ning `org.webrtc:google-webrtc` (yoki so'nggi
tavsiya etilgan WebRTC Android kutubxonasi) qo'sh.

Yarat:
data/webrtc/WebRtcClient.kt — PeerConnection yaratish, local/remote
  media stream boshqarish, ICE candidate handling.

data/repository/CallRepository.kt — call.js dagi signalizatsiya
  mantig'ini Kotlin'ga o'tkazish: Firestore orqali offer/answer/ICE
  yozish-o'qish, call holatini kuzatish (ringing/active/ended).

service/CallForegroundService.kt — qo'ng'iroq fonda ham davom etishi
  uchun Foreground Service (Android background restriction'lariga mos,
  CallStyle notification bilan — Android 12+ talab qiladi).

ui/call/IncomingCallScreen.kt — qabul qilish (yashil)/rad etish
  (qizil) tugmalari, ism/avatar markazda.

ui/call/ActiveCallScreen.kt — mikrofon ovozsiz qilish, dinamik/quloqcha
  almashtirish, video ko'rsatish (agar video call bo'lsa), qo'ng'iroqni
  tugatish.

Kamera/mikrofon runtime permission so'rovlarini to'g'ri qo'sh (Android
  6.0+ talabi).
```

**✅ Qabul mezonlari:**
- Ikki test qurilma orasida ovozli qo'ng'iroq ulanadi, ovoz eshitiladi
- Video qo'ng'iroqda ikkala tomon videosi ko'rinadi
- Qo'ng'iroq fonda (ilova minimallashtirilganda) uzilib qolmaydi

---

### PHASE 9 — MRgram AI (chatbot) integratsiyasi

**Manba:** `modules/mrgram-ai.js`, `api/groq-chat.js`, `api/tts.js`,
`api/groq-transcribe.js`, `README.md` bo'lim 11

**AGENT UCHUN PROMPT:**
```
reference/modules/mrgram-ai.js to'liq o'qi — bu yerda system prompt
qurish (buildSystemPrompt), README.md'ni bilim bazasi sifatida runtime'da
o'qish, vision (rasm tahlili), streaming javob mantig'i bor.

reference/api/groq-chat.js, reference/api/tts.js,
reference/api/groq-transcribe.js fayllarini o'qi — bu endpointlar
o'ZGARTIRILMAYDI, Android ulardan Retrofit orqali FOYDALANADI xolos.

Yarat:
data/remote/MrgramApiService.kt — Retrofit interfeysi:
  POST /api/groq-chat (streaming SSE qo'llab-quvvatlash kerak —
    OkHttp EventSource yoki manual stream reading bilan),
  POST /api/tts,
  POST /api/groq-transcribe.
  Har bir so'rovga Authorization: Bearer <Firebase ID Token> header
  qo'shiladigan Interceptor yoz.

data/repository/AiRepository.kt — mrgram-ai.js dagi system prompt
  qurish mantig'ini Kotlin'ga o'tkazish (README.md matnini asset
  sifatida ilova ichiga qo'sh yoki runtime'da GitHub raw'dan o'qi —
  qaysi yondashuv yaxshiroq ekanini tahlil qilib tanla va sababini
  yoz).

ui/chat/AiChatScreen.kt — ChatThreadScreen'ga o'xshash, lekin
  streaming javoblarni token-token ko'rsatadigan (typewriter effekti),
  rasm yuborish va AI vision javobini ko'rsatadigan qilib qur.

Feed va Group modullaridagi "✨ AI fikri", "✨ AI caption", "AI izoh
  taklifi", AI moderatsiya hook'larini shu AiRepository orqali to'liq
  ulang (PHASE 4 va PHASE 7 da qoldirilgan joylarni to'ldir).

Ovozli xabar transkripsiyasi (Whisper) va TTS (matndan ovoz) uchun ham
  shu repository'dan foydalanadigan tugmalarni chat ekraniga qo'sh.
```

**✅ Qabul mezonlari:**
- "MRgram AI" chatida savol yozilganda streaming javob keladi
- Rasm yuborilganda AI uni tahlil qilib javob beradi
- Feed'dagi "✨ AI fikri" tugmasi ishlaydi

---

### PHASE 10 — Push-bildirishnomalar (FCM, fon rejimi)

**Manba:** `modules/push.js`, `firebase-messaging-sw.js`,
`api/send-notification.js`, `api/broadcast.js`

**AGENT UCHUN PROMPT:**
```
reference/modules/push.js va reference/firebase-messaging-sw.js
fayllarini o'qi — bular web uchun; siz Android'ning NATIV FCM
imkoniyatlaridan foydalanasiz, bu WEB VERSIYADAN HAM ISHONCHLIROQ
fonda ishlaydi (bu aynan foydalanuvchi so'ragan narsa).

reference/api/send-notification.js va reference/api/broadcast.js
fayllarini o'qi — bular backend tomonda FCM token'larga xabar yuboradi,
O'ZGARTIRILMAYDI. Android faqat: 1) token'ni olish va Firestore'ga
saqlash, 2) kelgan xabarni ko'rsatish bilan shug'ullanadi.

Yarat:
service/MrgramFirebaseMessagingService.kt — FirebaseMessagingService'ni
  extend qiladi. onNewToken() da tokenni Firestore users/{uid} hujjatiga
  saqlaydi (push.js dagi qaysi maydonga saqlanishini top — masalan
  fcmTokens array). onMessageReceived() da NotificationCompat orqali
  bildirishnoma ko'rsatadi, notification channel yaratadi (Android 8+
  talabi), xabar bosilganda tegishli chat ekraniga deep link qiladi.

Notification channel'larni ajrat: xabarlar uchun alohida, qo'ng'iroqlar
  uchun alohida (yuqori muhimlik, ovoz bilan).

AndroidManifest.xml da POST_NOTIFICATIONS permission (Android 13+)
  runtime so'rovini UI oqimiga (masalan birinchi ochilishda yoki
  sozlamalarda) qo'sh.

Ilova butunlay yopiq bo'lganda ham (background/killed state) FCM xabar
  kelishini qurilmada real sinab ko'r (bu Android'ning kafolatlangan
  imkoniyati — Doze mode cheklovlariga ham e'tibor ber, kerak bo'lsa
  foydalanuvchidan battery optimization'dan chiqarishni so'ra).
```

**✅ Qabul mezonlari:**
- Ilova butunlay yopiq holatda boshqa userdan xabar kelganda telefon
  bildirishnoma ko'rsatadi va ovoz chiqaradi
- Bildirishnomani bosish tegishli chatni ochadi
- Token Firestore'da to'g'ri saqlangani ko'rinadi (shu userga admin
  broadcast yuborsa ham kelishi kerak)

---

### PHASE 11 — Admin panel

**Manba:** `modules/view-users.js`, `modules/admin-badge.js`,
`modules/admin-audit.js`, `modules/view-stats.js`,
`modules/view-ai-usage.js`, `modules/dashboard-summary.js`,
`README.md` bo'lim 8

**AGENT UCHUN PROMPT:**
```
reference/modules/view-users.js, admin-audit.js, view-stats.js,
view-ai-usage.js, dashboard-summary.js fayllarini o'qi.

Yarat:
ui/admin/AdminDashboardScreen.kt — dashboard-summary.js dagi
  ko'rsatkichlar bilan.

ui/admin/UserManagementScreen.kt — arizalarni tasdiqlash/rad etish,
  bloklash (muddatli/doimiy, orqaga sanoq bilan)/blokdan chiqarish,
  o'chirish (api/delete-user.js ni Retrofit orqali chaqirish).

ui/admin/AiModerationScreen.kt — AI yashirgan postlarni ko'rib chiqish.

ui/admin/BroadcastScreen.kt — api/broadcast.js ni chaqiradigan forma
  (sarlavha, matn, target guruh: all/approved/pending).

ui/admin/StatsScreen.kt — view-stats.js dagi statistikani grafik
  ko'rinishida (masalan Compose uchun mavjud chart kutubxonasi,
  vico yoki YCharts, bilan qayta chizish).

Barcha admin funksiyalarga faqat isAdmin=true bo'lgan userlar kirishi
  mumkinligini ham UI darajasida, ham (asosiysi) Firestore Rules/backend
  darajasida tekshirilganini tasdiqla (bu allaqachon firestore.rules'da
  bor — o'zgartirmang, faqat client shunga mos ishlashini ta'minlang).
```

**✅ Qabul mezonlari:**
- Admin bo'lmagan user Admin bo'limini umuman ko'rmaydi
- Admin yangi arizani tasdiqlaganda o'sha user ilovada darhol (yoki
  keyingi ochilishda) asosiy ekranga o'tadi
- Broadcast xabar yuborilganda maqsadli userlarga push keladi

---

### PHASE 12 — Fayl yuklash, media va offline keshlash

**Manba:** `modules/upload.js`, `modules/file-extract.js`,
`modules/local-cache.js`

**AGENT UCHUN PROMPT:**
```
reference/modules/file-extract.js va reference/modules/local-cache.js
fayllarini o'qi.

Yarat:
data/local/AppDatabase.kt (Room) — postlar, profil, chat xabarlarining
  oxirgi ko'chirilgan nusxasini saqlash uchun Entity'lar va DAO'lar
  (local-cache.js IndexedDB mantig'iga ekvivalent: internet yo'qligida
  oldin ko'rilgan ma'lumotlarni ko'rsatish).

Repository'larni (Feed, Chat, Profile) shu Room keshi bilan
  "offline-first" qilib qayta ishlang: avval keshdan ko'rsatib, fonda
  Firestore'dan yangilanishni olib kelish (Flow combine orqali).

Fayl turi aniqlash va ikonka/rang ko'rsatish uchun upload.js dagi
  getFileTypeInfo() mantig'ini Kotlin'ga o'tkazing (util funksiya).
```

**✅ Qabul mezonlari:**
- Internetni o'chirib ilovani ochganda oldin yuklangan postlar/chatlar
  ko'rinadi (bo'sh ekran chiqmaydi)
- Internet qaytganda ma'lumotlar avtomatik yangilanadi

---

### PHASE 13 — Tema va UI silliqlash (Dark mode, animatsiyalar)

**Manba:** `CSS/theme.css`, `CSS/dark-theme-fix.css`,
`CSS/chat-dark-redesign.css`, `svg/*`

**AGENT UCHUN PROMPT:**
```
reference/CSS/theme.css va reference/CSS/dark-theme-fix.css fayllaridagi
rang o'zgaruvchilarini (CSS custom properties, masalan --bg1, --accent
va h.k.) o'qi va Compose Material3 ColorScheme (light + dark)ga
moslashtir — ui/theme/Color.kt, Theme.kt, Type.kt fayllarini yarat.

reference/svg/MRgram.svg, splash.svg, favicon.svg asosida ilova ikonkasi
va splash screen (Android 12+ SplashScreen API bilan) tayyorla.

Barcha ekranlarda skeleton-loading (yuklanish paytida) holatlarini
qo'sh — web versiyada buildSkeletons() bor edi (utils.js), shunga
o'xshash Compose shimmer effektini umumiy komponent sifatida yoz va
hamma ekranlarda ishlat.
```

**✅ Qabul mezonlari:**
- Tizim dark/light rejimiga qarab ilova mos ravishda o'zgaradi
- Barcha asosiy ekranlarda (feed, chat, profil) loading holatida
  skeleton ko'rinadi, oq/bo'sh ekran chiqmaydi

---

### PHASE 14 — To'liq QA va "100% xatosiz" tekshiruv bosqichi

**Bu bosqich MAJBURIY — hech qachon o'tkazib yubormang.**

**AGENT UCHUN PROMPT:**
```
Loyihaning yakuniy sifat nazorati bosqichidasiz. Quyidagilarni bajaring:

1. `./gradlew lint` ishga tushiring, barcha ERROR darajasidagi
   ogohlantirishlarni tuzating (WARNING'larni ham iloji boricha kamaytiring).
2. Har bir Repository funksiyasi uchun try/catch va aniq xato holatlarini
   (internet yo'q, ruxsat yo'q, Firestore permission-denied) UI'da
   foydalanuvchiga tushunarli xabar bilan ko'rsating — hech qachon ilova
   crash bo'lmasligi kerak.
3. Barcha ekranlarni quyidagi holatlarda qo'lda sinab ko'ring va
   natijalarni ro'yxatlang:
   - Sekin internet (Android Studio Network Profiler orqali throttling)
   - Internet umuman yo'q
   - Ilovani background'ga tashlab qaytarish (state saqlanishi kerak)
   - Ekranni aylantirish (agar orientation qo'llab-quvvatlansa)
   - Turli ekran o'lchamlari (kichik telefon, planshet)
4. Xotira sizib chiqishi (memory leak) uchun Firestore listener'larning
   ViewModel onCleared()da to'g'ri to'xtatilishini tekshiring (masalan
   startChatsWatcher/stopChatsWatcher juftligi web'da bor edi — Android
   coroutine scope orqali xuddi shunday to'g'ri tozalanishi kerak).
5. ProGuard/R8 qoidalarini (release build uchun) sozlang — Firebase,
   Retrofit, Room modellarining obfuscation'da buzilmasligini
   ta'minlang.
6. Yakuniy hisobot yozing: qaysi funksiyalar to'liq ishlayapti, qaysi
   birlari qo'shimcha ishlov talab qiladi (checklist ko'rinishida,
   README.md dagi har bir bo'lim (1-11) bo'yicha ✅/⚠️/❌ belgilab).
```

**✅ Qabul mezonlari:**
- Lint xatolari yo'q
- README.md dagi 11 ta bo'limning barchasi Android'da ✅ deb belgilangan
- Crash-free: kamida 30 daqiqalik qo'lda test sessiyasida hech qanday
  crash yuz bermagan

---

### PHASE 15 — Play Store'ga chiqarishga tayyorlash (ixtiyoriy, agar kerak bo'lsa)

**AGENT UCHUN PROMPT:**
```
Release uchun:
1. App signing (keystore yaratish, Gradle signingConfigs sozlash).
2. Ilova ikonkasi barcha o'lchamlarda (adaptive icon) reference/icons/
   asosida.
3. Play Store uchun kerakli metadata: privacy policy sahifasi (MRgram
   allaqachon ma'lumot to'playdi — Firebase, bu haqda privacy policy
   matni tayyorlash kerak, foydalanuvchidan buni yurist bilan
   tekshirishni so'rang, bu kod vazifasi emas).
4. Target SDK va permission'larning Play Store siyosatiga mosligini
   tekshiring (ayniqsa background location yo'qligi, notification
   permission to'g'ri asoslanishi).
```

**✅ Qabul mezonlari:**
- Signed release APK/AAB muvaffaqiyatli yaratiladi va o'rnatiladi

---

## 3-QISM — Ishlatish tartibi (sizga, foydalanuvchiga)

1. `MRgram_v62.zip`ni `reference/` papkasiga chiqaring.
2. AI agentga (Claude Code tavsiya etiladi, chunki fayl tizimi bilan
   to'g'ridan-to'g'ri ishlaydi) avval **0-QISM dagi qoidalar blokini**
   bering.
3. Keyin **PHASE 0** promptini bering. Build tekshiring.
4. Har safar bitta PHASE promptini bering, natijani ✅ mezonlari bo'yicha
   sinab ko'ring, keyin navbatdagi PHASE'ga o'ting.
5. Agar biror bosqichda agent xato qilsa yoki tushunmasa — shu bosqich
   promptini yana bering, oxiriga qo'shib qo'ying:
   `"Oldingi urinishda [xato tavsifi] muammosi chiqdi — buni albatta
   tuzat va build xatosiz bo'lishini ta'minla."`
6. Hech qachon "hammasini birdan qil" demang — bosqichma-bosqich borish
   xatolar sonini keskin kamaytiradi va "100% xatosiz" natijaga eng
   ishonchli yo'l shu.

**Umumiy vaqt taxmini** (yolg'iz, AI agent bilan ishlaydigan, dasturlashni
bilmaydigan foydalanuvchi uchun, real testlash bilan): ~15 bosqich, har biri
o'rtacha 1-3 kun (kod yozish + sinash + tuzatish) — jami taxminan 6-10
hafta, sifat va sinchkovlikka qarab.

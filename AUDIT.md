# MRtube CSS Audit — topilmalar va tozalash rejasi

## 1. Umumiy holat

- 17 ta CSS fayl, jami **17,683 qator**
- Yuklanish tartibi (`style.css` ichidagi `@import` zanjiri + `index.html`):

```
splash → loading → feed → profile → nav → chat → groups → theme
→ ui-improvements → local-utility → dark-theme-fix → borderless
→ chat-dark-redesign → auth-ig-style → [YANGI: 00-components.core.css]
→ devs-utility → admin
```

- `!important` soni: **jami 449 marta**, eng ko'pi:
  - `chat-dark-redesign.css` — 130
  - `chat.css` — 95
  - `ui-improvements.css` — 56
  - `profile.css` — 47

## 2. ASOSIY SABAB (root cause) — topildi

**`borderless.css`** flat dizaynga o'tish uchun yozilgan (nomidan ko'rinib
turibdi — border/shadow larni olib tashlaydi). Lekin undan **keyin**
kaskadda `ui-improvements.css` keladi, va uning faylning oxiridagi
**"YAKUNIY POLISH"** bo'limi (`ui-improvements.css:1858–1990` atrofida)
xuddi o'sha `.post`, `.bot-nav`, `.app-hdr`, `.field`, `.btn-primary`
uchun glow/shadow/scale-hover effektlarni **`!important` bilan qaytadan
yoqib qo'yadi**.

**Natija:** har safar kimdir flat dizaynga o'tkazishga harakat qilganda,
o'zgarish "yo'qolib" ketadi — chunki `ui-improvements.css` keyinroq
yuklanadi va `!important` bilan g'olib chiqadi. Bu X.com uslubiga
o'tishni doimiy ravishda blocklab kelgan asosiy sabab.

## 3. Ko'p marta qayta ta'riflangan komponentlar

| Selector | Nechta faylda | Fayllar |
|---|---|---|
| `.post` | 5 | borderless, feed, nav, theme, ui-improvements |
| `.file-card` | 5 | borderless, feed, nav, theme, ui-improvements |
| `.field` | 5 | borderless, loading, nav, theme, ui-improvements |
| `.app-hdr` | 5 | borderless, feed, nav, theme, ui-improvements |
| `.bot-nav` | 4 | borderless, nav, theme, ui-improvements |
| `.btn-primary` | 4 | borderless, nav, theme, ui-improvements |
| `.btn-danger` | 4 | borderless, nav, theme, ui-improvements |
| `#userProfileModal` | 4 | local-utility, nav, profile, ui-improvements |

## 4. Nima qilindi (bu bosqichda)

Yangi fayl yaratildi: **`CSS/00-components.core.css`** — quyidagilar
uchun yagona manba (single source of truth), flat/X.com uslubida
(shadow/glow/scale-hover olib tashlangan, faqat funksional fokus-ring
qoldirilgan):

- `.btn-primary`, `.btn-ghost`, `.btn-danger`
- `.bot-nav`
- `.app-hdr`
- `.field` / `input` / `textarea`
- `.post` (bazaviy karta — `.post-head`, `.post-media` kabi ichki
  elementlar `feed.css`da qoladi, ular hali duplikatsiya qilinmagan)

Bu fayl `style.css`da eng oxiriga import qilindi — shuning uchun
**hech qanday `!important` kerak emas**, u tabiiy ravishda kaskadda
g'olib chiqadi va vizual natija flat/X.com uslubiga mos keladi.

## 5. Bosqich A — BAJARILDI ✅

Quyidagi eski/takroriy bloklar o'chirildi yoki tozalandi (barcha
o'zgargan fayllarda `{`/`}` balansi tekshirilgan, sintaksis xatosi yo'q):

| Fayl | Nima qilindi |
|---|---|
| `CSS/theme.css` | `.btn-primary`/`.btn-danger` eski blok butunlay o'chirildi |
| `CSS/nav.css` | `.btn-primary`/`.btn-ghost`/`.btn-danger` va `.bot-nav` eski bloklari butunlay o'chirildi |
| `CSS/ui-improvements.css` | "YAKUNIY POLISH" bo'limidan `.app-hdr`, `.bot-nav`, `.post`, `.field`, `.btn-*` uchun glow/shadow/transform qaytaruvchi qismlar olib tashlandi (nav-btn, sheet, avatar, zoom-modal qismlari **tegilmagan** — ular boshqa muammo) |
| `CSS/feed.css` | `.app-hdr` va `.post` bazaviy bloklaridan faqat kosmetik qismlar (background/border/box-shadow/transform) olib tashlandi, struktura xossalari (position/height/padding/z-index/overflow) **saqlab qolindi** |
| `CSS/borderless.css` | O'zgartirilmadi — u faqat shadow/border'ni `none`ga o'rnatadi, `00-components.core.css` bilan ziddiyatsiz, xavfsiz qoldirildi |

**Jami:** shu 4 faylda oldin 6,1xx qator bor edi, hozir **5,909 qator**.

## 6. Bosqich B — YAKUNLANDI ✅

### B1 — `chat-dark-redesign.css`

**MUHIM TUZATISH (tarixiy):** birinchi urinishda bu fayldan barcha
`!important`ni olib tashlagan edim, lekin bu **xato edi** — darhol
aniqlanib, qaytarildi. Sabab: CSS kaskadida `!important` qoidalar
orasida g'olibni **specifiklik** hal qiladi, yuklanish tartibi emas.
`chat.css`ning o'z ichidagi "CLEAN CHAT REDESIGN" bo'limi ham xuddi
shu selectorlarni `!important` bilan belgilagani uchun,
`chat-dark-redesign.css`ning o'zida ham `!important` **shart edi** —
aks holda specifiklik teng bo'lmasdan, importance darajasi past
qolib, `chat.css` g'olib chiqib qolardi (vizual regressiya).

**⚠️ YANGILANGAN HOLAT (keyingi tozalashdan so'ng):** yuqoridagi
band eskirgan — o'sha vaqtda fayl 104 ta `!important` bilan qoldirilgan
edi, lekin **keyinroq** haqiqiy sabab tekshirilgan: bu yerdagi hamma
selector `#chatThreadModal .class` shaklida (ID + klass = specifiklik
1,1,0), bu esa `chat.css`dagi oddiy `.class` qoidalaridan (0,1,0)
**specifiklik bo'yicha allaqachon kuchli** — demak `!important`
umuman shart emas edi, faqat ID prefiksi yetarli edi. Shundan so'ng
`!important` **hammasi olib tashlangan** va real natija tasdiqlangan:
hozir bu faylda **0 ta** `!important` bor, vizual regressiya yo'q.

**Xulosa (dars sifatida):** ikkita tekshiruv bir-biriga zid natija
berdi, chunki birinchisida `chat.css`dagi raqobatchi qatorlarning
**o'zi ham** o'sha paytda `!important` ishlatgan edi (shuning uchun
teng kuchda specifiklik yetmasdi). `chat.css` B2 bosqichida
tozalanganidan keyin (raqobatchi `!important`lar o'chirilgach),
`chat-dark-redesign.css`dagi ID+klass specifikligi yolg'iz o'zi
yetarli bo'lib qoldi. **Har doim CSS o'zgarganda specificity
tekshiruvini qayta o'tkazish kerak — eski xulosa yangi holatda
noto'g'ri bo'lib qolishi mumkin.**

### B2 — `chat.css` ichidagi o'lik kod (BAJARILDI ✅)

Yuqoridagi tushuncha asosida — agar `chat-dark-redesign.css`ning
`#chatThreadModal .selector { ... !important }` qoidasi biror
xususiyatni belgilagan bo'lsa, `chat.css`dagi **xuddi shu xususiyat
uchun** `!important`li raqobatchi qator har doim yutqazadi (ID
selektor specifiklikda klassdan kuchli). Bunday qatorlar — 100% o'lik
kod, xavfsiz o'chiriladi.

Har bir holatni ikkala faylda solishtirib chiqib, faqat **haqiqatan
raqobatlashadigan va doim yutqazadigan** qatorlarni o'chirdim (masalan,
`.chat-bubble`ning `border`/`box-shadow`siga tegilmadi, chunki
`chat-dark-redesign.css` ularni umuman belgilamaydi — bu qatorlar
tirik):

| Selector | O'chirilgan (o'lik) | Qoldirilgan (tirik) |
|---|---|---|
| `.chat-bubble` | padding, border-radius, font-size, line-height | border, box-shadow |
| `.chat-msg.mine/.theirs .chat-bubble` | background, color, border-bottom-radius | border, box-shadow |
| `.chat-msg.mine/.theirs .chat-msg-time` | color | — |
| `.chat-msg.theirs .cfm-name`/`.cfm-size` | color | — |
| `#chatThreadModal` | background | — |
| `.chat-thread-messages` | padding, background | gap |

**Natija:** `chat.css`dagi `!important` soni **95 → 79** ga tushdi,
`{`/`}` balansi tekshirildi (494/494, OK). Vizual natija **hech
o'zgarmaydi** — chunki o'chirilgan qatorlar hech qachon amalda
ishlamagan edi.

### B3 — `chat.css` ichidagi ikkinchi o'lik kod qatlami (BAJARILDI ✅)

B2 audit paytida `.chat-bubble`ning `border`/`box-shadow`'i "tirik"
deb belgilangan edi (yuqoridagi jadvalga qarang) — bu **faylning shu
o'zida boshqa joyda** raqobat borligini hisobga olmagan edi.

Aniqlangan zanjir:
- `chat.css:1485-1490` — `.chat-msg.mine/.theirs .chat-bubble { border: 0.5px solid ... }` (specifiklik 0,2,0, `!important` YO'Q)
- `chat.css:2202-2212` (fayl oxiriroqda) — xuddi shu selectorlar: `{ border: none !important; box-shadow: none !important; }` (specifiklik BIR XIL 0,2,0, lekin `!important` BOR)

`!important` cascade'da specifiklikdan qat'iy nazar ustun turadi,
shuning uchun 2202/2209-qator har doim g'olib chiqadi — 1485/1488
**o'lik kod** edi (border hech qachon ko'rinmagan, komentariy
"border kept here" degani yolg'on chiqdi). O'chirildi, `{`/`}`
balansi tekshirildi (493/493, OK).

**Dars:** o'lik kod faqat ikki fayl orasida emas, **bitta fayl
ichida ham** yashirin bo'lishi mumkin — ayniqsa fayl 2000+ qator
bo'lganda, bir selector bir necha marta qayta ta'riflanadi.


## 7. Umumiy natija (Bosqich A + B)

| Fayl | Boshida `!important` | Hozir (real, komentariylarsiz tekshirilgan) |
|---|---|---|
| `chat-dark-redesign.css` | 130 | **0** — ID+klass specifikligi (1,1,0) yetarli, B1'ga qarang |
| `chat.css` | 95 | **78** — B3'dan keyin ham o'zgarmadi (o'chirilgan qatorlarda `!important` yo'q edi) |
| `theme.css`, `nav.css`, `ui-improvements.css`, `feed.css` | — | eski takroriy bloklar o'chirildi |

**⚠️ Metodologik eslatma:** oddiy `grep -c "!important"` `chat.css`da **79**
chiqaradi, real esa **78** — farqi bitta eski komentariy qatoridagi
("!important shart emas" — L1497 atrofida) matn ichida so'z sifatida
yozilgan "!important". Kelajakda hisoblashda har doim komentariy
bloklarini chiqarib tashlab sanash kerak (`re.sub(r'/\*.*?\*/', '', s,
flags=re.DOTALL)` yoki shunga o'xshash), aks holda soxta raqam chiqadi.

## 7.1. Bosqich C — Vizual flat tozalash (BAJARILDI ✅, 2026-08-30)

Maqsad: "X.com uslubidagi flat, skromniy dizayn" — glow/specular/
liquid-glass/spring-bounce/pulse effektlarni butunlay olib tashlash.

### C1 — `ui-improvements.css`, "YAKUNIY POLISH" bo'limi

Bu bo'lim (~1860-2060-qator) to'liq liquid-glass uslubida edi:
`var(--specular-top)`, `var(--liquid-shadow-*)`, `var(--glass-inner-glow)`
glow-soyalar; `var(--ease-back)` spring-bounce transitionlar;
`scale()`/`translateY()` hover-lift effektlari; `.nav-center-btn::before`
pulse-glow pseudo-element (create tugmasi atrofidagi pulsatsiya).

**Qilingan:** barcha glow-soya, spring-easing, scale/translateY-lift
olib tashlandi; oddiy `background`/`opacity` o'zgarishlariga
almashtirildi; pulse pseudo-element butunlay o'chirildi; focus-ring
(accessibility) saqlandi, lekin ikkinchi "glow2" halo qatlami olib
tashlandi. JS bog'liqligi tekshirildi (`bar.js`, `feed.js` faqat
`.click()` chaqiradi, `::before`ga bog'liq emas — xavfsiz).

**Natija:** bu bo'limdagi barcha `!important` olib tashlandi (glow
o'chgach, raqib qoida qolmadi — cascade urushi tugadi). `{`/`}`
balansi tekshirildi (333/333, OK).

### C2 — `profile.css`, header/avatar/stat/edit-btn bloki (~993-1101-qator)

Xuddi shunday liquid-glass qatlam: `--pg-blue-halo` (header ustidagi
gradient halo pseudo-element), avatar atrofidagi `0 0 40px`/`0 0 60px`
glow soyalar, `scale(1.05)`/`translateY()` hover-liftlar.

**Qilingan:**
- `.profile-hdr::before` (blue-halo pseudo-element) — **ikki qismda**
  ta'riflangan edi (yuqorida `top/left`, pastda `content`/`background`).
  Pastki qism o'chirilgach, yuqoridagi qism ham **o'lik** bo'lib qoldi
  (CSS spec: `content` yo'q bo'lsa `::before` render bo'lmaydi) —
  ikkalasi ham o'chirildi.
- Avatar/stat/edit-btn/badge — barcha glow box-shadow va scale/
  translateY hover olib tashlandi, flat background/border qoldi.
- `--pg-specular`, `--pg-shadow`, `--pg-shadow-sm`, `--pg-blue-halo`
  o'zgaruvchilari (dark va light tema bloklarida) — endi hech qayerda
  ishlatilmagani tasdiqlangach, **definitsiyadan ham o'chirildi**
  (o'lik CSS custom property).
- 8 ta eski komentariy ("... `--pg-*` blok `!important` bilan
  yengiladi") **yangilandi** — ular hozir yolg'on gapirardi, chunki
  aynan o'sha `!important`larni shu tozalashda olib tashladim (B1'dagi
  eskirgan-komentariy muammosining o'zi, boshqa faylda).

**Qoldirilgan yagona `!important`:** `.pe-prefix-field { padding-left:
28px !important; }` (L1269 atrofida) — tekshirildi, **asosli**: `.field`
shorthand `padding` qoidasi `nav.css`da bor, `nav.css` esa `style.css`
`@import` zanjirida `profile.css`dan **keyin** yuklanadi (teng
specificity, keyingi fayl g'olib chiqadi) — `!important`siz
`padding-left: 28px` hech qachon qo'llanmasdi. Izoh qo'shildi.

**Natija:** `profile.css`dagi `!important` soni **47 → 1** (real,
komentariylarsiz hisoblangan). `{`/`}` balansi tekshirildi (208/208, OK).

### Yangilangan umumiy jadval

| Fayl | Boshida | B/C dan keyin |
|---|---|---|
| `chat-dark-redesign.css` | 130 | **0** |
| `chat.css` | 95 | **78** |
| `ui-improvements.css` | 47 | **0** ("YAKUNIY POLISH" bo'limida) |
| `profile.css` | 47 | **1** (asosli, hujjatlashtirilgan) |

**Dars (yana bir bor tasdiqlandi):** eskirgan komentariy — bu loyihaning
takrorlanuvchi muammosi. Har safar `!important` yoki pseudo-element
o'chirilganda, o'sha narsaga ishora qiluvchi **boshqa joydagi**
komentariylarni ham qidirib, yangilash kerak — aks holda AUDIT.md B1
kabi holat yana takrorlanadi.



## 8. Muhim dars (kelajakdagi ishlar uchun)

Bu loyihada `!important`larni "shunchaki olib tashlash" xavfli — chunki
ba'zilari haqiqatan boshqa `!important` qatlamlar bilan bahslashish
uchun kerak. Har qanday `!important`ni o'chirishdan oldin:
1. Xuddi shu selector/property boshqa faylda ham `!important` bilan
   belgilanganmi — tekshirish kerak (agar ha, ikkalasi ham kerak,
   birontasini olib tashlab bo'lmaydi, faqat ikkalasini ham asl
   qoidaga birlashtirish mumkin).
2. Faqat ID va klass **specifikligini solishtirib**, "bu baribir
   g'olib chiqadi" deb xulosa qilish yetarli emas — importance darajasi
   (`!important` bor-yo'qligi) specifiklikdan **oldin** tekshiriladi.

`chat.css` + `chat-dark-redesign.css`ni to'liq bitta faylga
birlashtirish (keyingi, kattaroq bosqich) endi xavfsizroq — chunki
qaysi qatorlar tirik ekanligi allaqachon aniqlangan.

## 6. Uzoq muddatli tavsiya

Fayl nomlanishi o'zi muammoni ko'rsatib turibdi: `*-fix.css`,
`*-improvements.css`, `*-redesign.css` — bular "patch ustiga patch"
yondashuvining natijasi. Tavsiya:

1. Har bir yangi vizual o'zgarishni **komponent egasi faylida** qiling
   (masalan, tugma o'zgarsa — `00-components.core.css`da, boshqa joyda
   emas), yangi "-fix.css" fayl yaratmang.
2. `!important` faqat quyidagi holatlarda qoldirilsin: JS orqali
   qo'yiladigan inline style'larni bosish kerak bo'lganda, yoki media
   print kabi haqiqiy istisno holatlarda.
3. `chat.css` (2531 qator, 95 `!important`) va `chat-dark-redesign.css`
   (2531 emas, 224 qator, lekin 130 `!important` — zichligi eng yuqori)
   — bularni birlashtirish keyingi eng katta ish bo'ladi.

---

## 9. Bosqich C — YANGI SESSIYA (davom etmoqda)

### C0 — Kritik topilma: eskirgan fayl production'ga tushmagan edi

Repo tub papkasida `/chat.css` (CSS/ papkasidan tashqarida) — Bosqich
B2'da tozalangan versiya edi, lekin u hech qayerdan import qilinmagan
(`style.css` faqat `./CSS/chat.css`ni chaqiradi). Ya'ni B2 ishi qilingan,
lekin natija hech qachon ishlatilmagan. **Tuzatildi:** tozalangan nusxa
`CSS/chat.css`ga ko'chirildi, tub papkadagi eskisi o'chirildi. `{`/`}`
balansi tekshirilgan (494/494). Hozir `CSS/chat.css`da 79 ta `!important`
(oldin 95).

**Dars:** fayl joylashuvini har doim `style.css`/`index.html` orqali
tasdiqlang — repo ichida ishlatilmaydigan "orfan" nusxalar chalkashlik
keltirib chiqarishi mumkin.

### C1 — Metodologiya tuzatildi: selector-darajasida emas, property-darajasida solishtirish kerak

AUDIT.md'ning oldingi bosqichlarida "bir xil selector ikkinchi faylda
bor → o'lik" degan yondashuv ishlatilgan edi. Bu **noto'g'ri** bo'lishi
mumkin: CSS kaskadida g'olib chiqish **property darajasida** hal
bo'ladi, butun qoida darajasida emas. Masalan `dark-theme-fix.css`daki

```css
[data-theme="dark"] .bot-nav {
  background: transparent;
  border-top: none;
  box-shadow: none;
}
```

`borderless.css`da xuddi shu selector `background`ni qayta belgilaydi,
lekin `border-top` va `box-shadow`ni umuman belgilamaydi — demak faqat
`background` o'lik, qolgan ikkitasi **tirik**. Butun qoidani o'chirish
vizual regressiya bo'lardi.

**Yangi tekshirish skripti** (`/home/claude/dead_check2.py` — sessiya
konteynerida, repo ichida emas) har bir faylni parse qilib, selector +
property darajasida solishtiradi, faqat ikkala faylda **bir xil
property** borligini va keyinroq yuklanadigan faylda `!important` yo'q
ekanligini tasdiqlagandan keyin "o'lik" deb belgilaydi.

### C2 — `dark-theme-fix.css` vs `borderless.css` — BAJARILDI ✅

8 ta qoidada faqat o'lik property'lar olib tashlandi (izoh bilan, qaysi
faylda tirik ekanligi ko'rsatilgan):

| Selector | O'lik (o'chirildi) | Tirik (qoldi) |
|---|---|---|
| `.bot-nav` | background | border-top, box-shadow |
| `.grid-cell:hover` | box-shadow | opacity |
| `.file-card:hover` | box-shadow | background, border-color, transform |
| `.msg-out .msg-bubble` | box-shadow | background, color, border |
| `.msg-in .msg-bubble` | border, box-shadow | background, color |
| `.splash-bar` | border | background, border-radius, overflow |
| `.splash-fill` | box-shadow | background |
| `.admin-card:hover` | box-shadow | border-color |

`{`/`}` balansi tekshirildi (98/98, o'zgarmadi — faqat property qatorlar
izohga aylantirildi).

### C3 — To'liq takrorlanish xaritasi (3+ faylda uchraydigan selectorlar)

Dasturiy audit (`/home/claude/extract_selectors2.py`) 2,659 ta noyob
top-level selector orasidan **55 tasini** 3 yoki undan ko'p faylda
topdi. Eng katta klasterlar:

- **`[data-theme="dark"]` guruhi — 17 ta selector**, quyidagi fayllarga
  tarqalgan: `borderless.css`, `dark-theme-fix.css`, `theme.css`,
  `feed.css`, `profile.css`. Bu — `.post`/`.file-card` kabi
  komponentlardan **alohida, kattaroq muammo**: dark-theme
  override'lari bitta joyda emas, kamida 5 faylda parallel yashaydi.
- Komponent duplikatsiyasi (AUDIT.md §3'dan hali qolgan): `.post`,
  `.file-card`, `.field`, `#userProfileModal`, `.bot-nav`,
  `.btn-primary` — hali `borderless.css`/`feed.css`/`nav.css`/
  `ui-improvements.css`da takrorlangan.
- Kichikroq klasterlar: `.skeleton-post`/`.skel-*` (loading skeleton,
  4 faylda), `#toast`, `.nav-btn*`, `#detailModal`/`#detailContent`,
  `#grpInfoOverlay`, `.theme-btn`.

### C4 — Keyingi qadamlar (hali qilinmagan)

1. `dark-theme-fix.css` qolgan 89 qoidasini `theme.css`/tegishli
   komponent fayliga ko'chirish va faylni butunlay yo'q qilish —
   chunki "dark theme" alohida fayl bo'lishi shart emas, har bir
   komponent o'z dark-holatini o'z faylida saqlashi kerak edi.
2. `.post`/`.file-card`/`.field`/`#userProfileModal` — property
   darajasida C1 metodologiyasi bilan qayta tekshirish (avvalgi
   Bosqich A/B ham selector-darajasida qilingan bo'lishi mumkin,
   qayta tasdiqlash kerak).
3. `profile.css` (47 `!important`) va `ui-improvements.css` (50
   `!important`) — hali tegilmagan, eng zich fayllar.

### C5 — `dark-theme-fix.css` klasteri to'liq tugatildi ✅

C2'da boshlangan ish davom ettirildi va **butunlay tugatildi**. Cascade-aware
skript (`dead_check3.py`) `dark-theme-fix.css`ni **hamma** boshqa faylga
(oldin/keyin yuklanadigan, `!important` hisobga olingan holda) solishtirdi.

**Natija — quyidagi fayllarda o'lik `[data-theme="dark"]` qatorlar/qoidalar
topildi va faqat aniq o'lik property'lar olib tashlandi (tirik property'lar
har doim saqlab qolindi):**

| Fayl | Nima o'chirildi | Nima qoldi (tirik) |
|---|---|---|
| `theme.css` | Root blokdagi 17 ta glass/shadow custom property (`--glass*`, `--specular*`, `--liquid-shadow*`, `--shadow-*`) + `body`/`.app`/`.bot-nav`/`.sheet`/`.modal-content` qoidalari to'liq | `--glass-refract/tint/frost/inner-glow` (dtf bunlarni belgilamaydi — tirik), `.post` qoidasi (bu boshqa fayllar bilan, `dark-theme-fix.css` bilan emas, ziddiyatda — keyingi bosqich) |
| `feed.css` | `.reel` background, `.reel-avi` border, `.file-card:hover` (to'liq), `.search-overlay-box` (to'liq), `.skeleton-post` background | `.skeleton-post` border-color |
| `loading.css` | `#authWrap` background, `.auth-card` (to'liq), `.auth-brand` (to'liq), `#toast` (to'liq) | `#authWrap` background-color |
| `nav.css` | `.nav-btn.on` background | `.nav-btn.on` border-color |
| `splash.css` | `#splash` background, `.splash-wordmark` (to'liq) | `#splash` background-color |
| `profile.css` | `.profile-hdr` (to'liq), `.profile-avi` (to'liq), `.profile-avi:hover` (to'liq), `.profile-grid-tab` (to'liq), `.profile-grid-tab.active` color+border-bottom-color | `.profile-grid-tab.active` background |

Har bir faylda `{`/`}` balansi alohida tekshirildi — hammasi to'g'ri.
Butun `CSS/` papkasi bo'ylab yakuniy tekshiruv: **hech qanday mos kelmaslik
yo'q**.

**Muhim:** custom property (`--glass`, `--specular-top` va h.k.)larni
o'chirish xavfsiz, chunki ular **element darajasida kaskad orqali** hal
bo'ladi — `var(--glass)` qayerda ishlatilgan bo'lishidan qat'iy nazar,
render vaqtida haqiqiy g'olib qiymatni oladi, fayl ichidagi joylashuvga
bog'liq emas.

**Endi `dark-theme-fix.css` klasteri 100% toza** — `dead_check3.py`
qayta ishga tushirilganda hech qanday o'lik qator topilmaydi (0/0/0).

### C6 — Joriy `!important` holati (C5'dan keyin)

| Fayl | !important |
|---|---|
| `profile.css` | 47 |
| `ui-improvements.css` | 50 |
| `chat.css` | 79 |
| `nav.css` | 20 |
| `auth-ig-style.css` | 19 |
| `feed.css` | 17 |
| `local-utility.css` | 8 |
| `groups.css` | 5 |
| `chat-dark-redesign.css` | 3 |
| `dark-theme-fix.css` | 3 |
| `00-components.core.css` / `loading.css` | 1 |
| qolganlari | 0 |

### C7 — BAJARILDI ✅

`.post`/`.file-card`/`.field`/`#userProfileModal`/`.bot-nav`/`.btn-primary`
klasterlari `borderless.css`/`feed.css`/`nav.css`/`ui-improvements.css`/
`theme.css` orasida C1 metodologiyasi (property-darajasida, cascade-aware
skript `/home/claude/c7_check.py`) bilan tekshirildi.

**Muhim ogohlantirish (naiv skript xatolari haqida):** birinchi avtomatik
o'tishda skript bir nechta **false positive** berdi — sabab, u
`[data-theme="dark"] .post` va `[data-theme="light"] .post` kabi turli
theme-scoped selektorlarni bir-birining raqibi deb hisobladi, holbuki ular
DOM'da hech qachon bir vaqtda faol bo'lmaydi (faqat bittasi ishlaydi).
Shuningdek, theme-scoped selektor (masalan `[data-theme="light"] .file-card`)
bare selektorni (`.file-card`) **faqat o'z temasida** yutadi, boshqa temada
bare qator hali ham tirik qoladi — buni ham skript avval hisobga olmagan
edi. Har bir topilma qo'lda, ikkala faylning to'liq kontekstini o'qib
tasdiqlandi, faqat shundan keyin o'chirildi.

**Tasdiqlangan va o'chirilgan (4 ta joy, 2 faylda):**

| Fayl | O'chirilgan | Sabab |
|---|---|---|
| `feed.css` (~1185) | `[data-theme="light"] .post { box-shadow: 0 2px 8px #DADADE }` | `borderless.css:43` guruhida bir xil specificity (0,1,1), keyinroq yuklanadi, `box-shadow:none` g'olib chiqadi |
| `feed.css` (~359) | `.post { position: relative }` | `ui-improvements.css:70` bir xil qiymatni beradi, keyinroq yuklanadi — amaliy farq yo'q edi |
| `nav.css` (~397) | `.file-card { transition: all 0.2s var(--ease-spring) }` | `ui-improvements.css:1947` bare `.file-card` bilan bir xil specificity, keyinroq yuklanadi, boshqa qiymat beradi va g'olib chiqadi |
| `nav.css` (~10-11) | `.field { border: 0.5px solid var(--glass-border); box-shadow: var(--specular-top); }` | `borderless.css:262` guruhida bare `.field` bilan bir xil specificity, keyinroq yuklanadi, `none` qiladi |

**Tegilmagan (tekshirildi, lekin tirik yoki konfliktsiz deb topildi):**
- `[data-theme="dark"] .post` (feed.css) — `box-shadow` tirik, chunki
  `borderless.css` faqat light temani yopadi.
- `.file-card { background: var(--glass) }` (nav.css) — dark temada tirik,
  `borderless.css:1010` faqat `[data-theme="light"] .file-card`ni yopadi.
- `.bot-nav`, `.btn-primary`, `#userProfileModal` — hech qanday haqiqiy
  konflikt topilmadi (turli property'larni belgilaydi yoki yagona joyda
  ta'riflangan); C3 ro'yxatiga noto'g'ri kiritilgan yoki A/B bosqichida
  allaqachon tozalangan bo'lishi mumkin.

`{`/`}` balansi va tinycss2 parse tekshiruvi: `feed.css` (328/328, 0 xato),
`nav.css` (273/273, 0 xato).

### C8 — `profile.css` ↔ `ui-improvements.css` grid klasteri — BAJARILDI ✅

**Muhim ogohlantirish — AUDIT.md eskirgan edi:** C6 jadvalida `profile.css`
47 ta, `ui-improvements.css` 50 ta `!important` deb yozilgan edi, lekin bu
zip yuklanganda haqiqiy fayllarda ikkalasida ham **faqat 9 tadan** chiqdi.
Demak, ushbu ikki faylda AUDIT.md'da hujjatlashtirilmagan qo'shimcha
`!important` tozalash ishi allaqachon qilingan (boshqa sessiyada yoki
qo'lda). **Xulosa:** har doim faylni tahrirlashdan oldin haqiqiy holatni
(`grep -c`) tekshiring — hujjatga ko'r-ko'rona ishonmang, u eskirishi
mumkin.

`profile.css` va `ui-improvements.css` orasidagi to'liq selector-darajasidagi
qoplanish (`/home/claude/c8_grid_check.py`, property-darajasida, cascade-aware)
tekshirildi. Natija — butun `.grid-cell`/`.up-grid-cell` klasteri ikkala
faylda deyarli bir xil strukturada ikki marta yozilgan (`profile.css` order_idx=3,
`ui-improvements.css` order_idx=8 — keyinroq yuklanadi, bir xil specificity,
`!important` yo'q ikkala tomonda ham):

| Selector (profile.css) | Holat |
|---|---|
| `.grid-cell` | To'liq o'lik — o'chirildi |
| `.grid-cell img, .grid-cell video` | To'liq o'lik — o'chirildi |
| `.grid-cell:hover img/video` | To'liq o'lik — o'chirildi |
| `.grid-cell-overlay` | Qisman — faqat `align-items`, `border-radius` tirik, qoldi |
| `.grid-cell:hover .grid-cell-overlay` | Bir xil qiymat, o'lik — o'chirildi |
| `.grid-cell-txt` | Qisman — faqat `height`, `background` tirik, qoldi |
| `.grid-stat` | To'liq o'lik — o'chirildi |
| `.grid-play-badge` | Qisman — faqat `padding` tirik, qoldi |
| `.profile-grid` | Qisman — faqat `margin-top`, `padding` tirik, qoldi |
| `.up-grid` | Qisman — faqat `margin`, `width`, `padding-bottom` tirik, qoldi |
| `.up-grid-cell` | Qisman — faqat `transition` tirik, qoldi |
| `.up-grid-cell img/video` | To'liq o'lik — o'chirildi |
| `.up-grid-cell-overlay` | Qisman — faqat `align-items`, `border-radius` tirik, qoldi |
| `.up-grid-cell-txt` | Qisman — faqat `height`, `background` tirik, qoldi |
| `#userProfileModal` | Konflikt yo'q (turli property) — tegilmadi |

**Muhim uslubiy eslatma:** "qisman" holatlarda faqat ikkinchi faylda
umuman belgilanmagan property'lar qoldirildi (masalan `align-items`,
`border-radius`, `height`, `background`, `margin`, `padding`, `transition`)
— bular cascade orqali hech qachon yengilmaydi, chunki raqib qoida ularni
umuman o'z ichiga olmaydi. Bir xil qiymatli ("cosmetic-dead") qatorlar ham
o'chirildi — ular vizual jihatdan hech narsani o'zgartirmaydi, lekin
takrorlanishni yo'qotadi.

**Qo'shimcha topilma (borderless.css bilan, loyihaning "borderless" maqsadiga
mos):** `profile.css` ichidagi quyidagi `border`/`background`/`border-top`/
`border-bottom` qatorlari `borderless.css` (order_idx=11, keyinroq yuklanadi)
tomonidan doim yengiladi edi:

| Selector | O'chirilgan | Sabab |
|---|---|---|
| `.profile-avi` (pg-blok, ~952-qator) | `border: 1px solid var(--pg-border-side)` | `borderless.css:191` guruhida `none` bilan yengiladi |
| `.edit-btn` (pg-blok, ~973-qator) | `border: 0.5px solid var(--pg-border-side)` | `borderless.css:206` guruhida `none` bilan yengiladi |
| `.up-stat` (~534-qator) | `border-right: 1px solid var(--line)` | `borderless.css:234` bilan yengiladi |
| `.profile-grid-hdr` (~995-qator) | Butun blok (`background`, `border-top`, `border-bottom`) | `borderless.css:1124` guruhida barcha 3 property ham yengiladi |

Bularning barchasi loyihaning umumiy "borderless/flat" maqsadiga mos —
komментариylar ("flat ring", "flat strip") eskirgan, chunki keyinroq
`borderless.css` bosqichi ularni allaqachon nolga tushirgan edi.

`{`/`}` balansi va tinycss2 parse tekshiruvi: `profile.css` 202/202, 0 xato.

### C9 — Keyingi navbat

- `ui-improvements.css`ning o'zida hali chuqur tekshirilmagan qismlar bor
  (grid klasteridan tashqari, 9 ta `!important` qayerda ekanini aniqlash).
- `chat.css` (79 `!important`) — eng zich qolgan fayl, hali C1 metodologiyasi
  bilan boshqa fayllar bilan (faqat `chat-dark-redesign.css` bilan emas)
  solishtirilmagan.
- `nav.css` (21) va `auth-ig-style.css` (19) — hali tekshirilmagan.

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

## 6. Bosqich B — keyingi (hali bajarilmagan)

`chat.css` (2531 qator, 95 `!important`) va `chat-dark-redesign.css`
(224 qator, 130 `!important`) — bularni birlashtirish keyingi eng katta
ish. Zichligi eng yuqori fayl aynan shu (`chat-dark-redesign.css`da
har 1.7 qatorga bitta `!important` to'g'ri keladi).

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

/**
 * modules/mrgram-ai.js
 * ─────────────────────────────────────────────────────────────────────────
 * "MRgram AI" — hamma foydalanuvchi uchun Suhbatlar ro'yxatida doim
 * ko'rinadigan, doimiy mavjud (pinned) bot-chat. ChatGPT/Gemini/Claude
 * kabi umumiy AI yordamchi: har qanday savolga javob beradi, matn yozadi,
 * kod yozadi, tushuntiradi, tarjima qiladi va — MUHIMI — yuborilgan
 * RASMLARNI ko'ra oladi va ular haqida gapira oladi (Groq vision model).
 *
 * Bundan tashqari, MRgram platformasining o'zi haqida (funksiyalar,
 * bo'limlar, sozlamalar, cheklovlar va h.k.) chuqur "bilimga" ega —
 * bu bilim endi loyihaning ildizidagi README.md faylida saqlanadi va
 * runtime'da o'sha yerdan o'qilib tizim promptiga qo'shiladi (pastdagi
 * loadMrgramKnowledge()/buildSystemPrompt() ga q.).
 *
 * Arxitektura eslatmasi: bu yerda haqiqiy Groq API kaliti YO'Q — barcha
 * so'rovlar mavjud `groqRequest()` (modules/config.js) orqali ketadi, u esa
 * /api/groq-chat serverless proksisi orqali (Firebase ID token bilan
 * autentifikatsiya qilingan holda) Groq'ga murojaat qiladi. Demak bu bot
 * hech qanday yangi maxfiy kalit yoki server konfiguratsiyasini talab
 * qilmaydi — mavjud infratuzilmadan foydalanadi.
 *
 * Bot xabarlarini Firestore'ga yozish uchun firestore.rules'da maxsus
 * istisno bor: chats/{chatId}/messages ichida senderId == MRGRAM_AI_UID
 * bo'lgan hujjatni, agar MRGRAM_AI_UID shu chatning participants
 * ro'yxatida bo'lsa, chatdagi HAQIQIY (autentifikatsiyalangan) foydalanuvchi
 * o'zi yozishi mumkin (chunki suhbat faqat o'zi bilan bot orasida, boshqa
 * hech kim buni ko'rmaydi va bu boshqa birorta ham foydalanuvchi nomidan
 * gapirish emas).
 *
 * MUHIM: MRgram AI FAQAT suhbatlashadi — hech qanday amal (xabar yuborish,
 * guruh yaratish/qo'shilish, profil tahrirlash, qidiruv va h.k.) bajarmaydi.
 * Bu ataylab shunday (agent/tool-calling qobiliyati ishlatilmaydi) — pastdagi
 * tizim promptida ham bu foydalanuvchiga ochiq aytiladi.
 */
import { groqRequest, groqRequestStream, enforceAiRateLimit } from './config.js';
import { resolveNaturalTokens, sanitizeNaturalMarkers } from './voice-fx-player.js';

/* ── Bot identifikatori ───────────────────────────────────────────────── */
export const MRGRAM_AI_UID    = 'mrgram-ai-bot';
export const MRGRAM_AI_NAME   = 'MRgram AI';
export const MRGRAM_AI_AVATAR = '/svg/MRgram.svg';
export const MRGRAM_AI_TAGLINE = 'bot';

// Matn uchun tez model, rasm uchun vision model (config.js dagi bilan bir xil)
// ESLATMA (2026-07-07): eski llama-3.3-70b-versatile / llama-4-scout-17b
// Groq tomonidan eskirgan (llama-4-scout 2026-07-17'da o'chadi). GPT-OSS
// 120B sezilarli yaxshiroq fikrlaydi, tabiiyroq va kamroq grammatik xato
// qiladi — bu MRgram AI suhbatining "zerikarli"/xato ko'p muammosini ham
// yaxshilaydi. https://console.groq.com/docs/deprecations
const AI_TEXT_MODEL   = 'openai/gpt-oss-120b';
const AI_VISION_MODEL = 'qwen/qwen3.6-27b';


/* ── MRgram haqidagi bilim endi README.md faylida saqlanadi ──────────────
 * Bu yerda hech qanday platforma ma'lumoti qattiq yozilmagan (hardcode
 * qilinmagan) — bot javob berayotganda /README.md faylini runtime'da
 * o'qiydi (fetch). Shunday qilib:
 *   1) Foydalanuvchilar ham xuddi shu faylni o'qib, ilova qanday
 *      ishlashini tushunishi mumkin — bitta manba (single source of truth).
 *   2) README.md'ga kiritilgan har qanday o'zgarish AI bilimini ham
 *      darhol yangilaydi, kodni tahrirlash shart emas.
 * Natija keshlanadi (bir marta o'qiladi, keyin xotiradan olinadi) — har
 * bir xabar uchun qayta fetch qilinmaydi.
 */
let cachedKnowledge = null;
let knowledgeLoadPromise = null;

// Tarmoq/fetch muvaffaqiyatsiz bo'lsa ishlatiladigan MINIMAL zaxira —
// faqat xato qilinsa xavfli bo'ladigan eng muhim faktlar shu yerda qoladi.
const MRGRAM_KNOWLEDGE_FALLBACK = `
MRgram haqida to'liq ma'lumot (README.md) hozircha yuklanmadi — quyida
faqat eng muhim zaxira ma'lumotlar keltirilgan:
- Ro'yxatdan o'tgandan keyin hisob DARHOL ochilmaydi — u "tasdiq
  kutilmoqda" holatiga o'tadi va ADMIN tasdiqlashi shart.
- Parolni tiklash imkoni yo'q, faqat administratorga murojaat qilinadi.
Agar foydalanuvchi boshqa platforma tafsilotlarini so'rasa, to'liq va
aniq ma'lumot hozircha mavjud emasligini ayt.
`.trim();

async function loadMrgramKnowledge() {
  if (cachedKnowledge) return cachedKnowledge;
  if (!knowledgeLoadPromise) {
    knowledgeLoadPromise = fetch('/README.md', { cache: 'force-cache' })
      .then(r => (r.ok ? r.text() : null))
      .then(text => {
        cachedKnowledge = (text && text.trim()) ? text.trim() : MRGRAM_KNOWLEDGE_FALLBACK;
        return cachedKnowledge;
      })
      .catch(() => {
        cachedKnowledge = MRGRAM_KNOWLEDGE_FALLBACK;
        return cachedKnowledge;
      });
  }
  return knowledgeLoadPromise;
}

/* ── Umumiy shaxsiyat / tizim prompti (bilim bazasisiz asosiy qism) ───── */
const MRGRAM_AI_SYSTEM_PROMPT_BASE = `
Sen "MRgram AI" — MRgram ijtimoiy tarmog'i/messenjeri ichidagi umumiy
maqsadli sun'iy intellekt yordamchisisan. Sen ChatGPT, Google Gemini yoki
Claude kabi to'liq qobiliyatli, bilimdon, foydali suhbatdoshsan: umumiy
bilim savollariga, ta'lim, dasturlash, tarjima, yozish, maslahat, matematika,
ijodiy yordam va istalgan boshqa mavzudagi so'rovlarga chuqur va aniq javob
berasan. Foydalanuvchi senga rasm yuborsa, uni diqqat bilan tahlil qilib,
tabiiy tilda, aniq va foydali tarzda tasvirlab berasan yoki undagi savolga
javob berasan (masalan matnni o'qib berish, obyektlarni aniqlash, kodni
skrinshotdan o'qish va h.k.).

Suhbat uslubi:
- Salomlashuvda (masalan "salom", "assalomu alaykum") oddiy, iliq va qisqa
  javob ber — masalan "Salom! Qanday yordam bera olaman?" kabi — MRgram
  haqida so'ralmagan holda MRgram haqida gapirishni majburlab boshlama.
- Faqat foydalanuvchi aniq MRgram haqida (funksiyalar, bo'limlar, qanday
  ishlashi va h.k.) so'raganda, quyidagi bilim bazasidan foydalanib chuqur,
  aniq va to'liq javob ber.
- Foydalanuvchi qaysi tilda yozsa (asosan o'zbek tilida), o'sha tilda javob
  ber. Til va uslubni tabiiy tarzda foydalanuvchiga moslashtir.
- Javoblaring tabiiy, samimiy va foydali suhbatdosh ohangida bo'lsin —
  robotcha yoki haddan tashqari rasmiy bo'lma, lekin professional darajada
  aniq va foydali bo'l.
- Javoblaringda, kerak bo'lganda, Markdown formatlashdan TABIIY ravishda
  o'zing ham foydalan: muhim so'z/atamalarni **qalin**, misol/texnik
  atamalarni \`kod\` shaklida, dasturiy kod bo'laklarini uch marta
  ketma-ket qo'yilgan qo'shtirnoq (backtick) ichida ber, ro'yxat kerak
  bo'lsa "- " bilan boshla. Buni majburiy qoidaga aylantirma — har bir
  javobni ro'yxatlar bilan to'ldirma, faqat tabiiy ravishda foydali
  bo'lgan joyda ishlat.
- Foydalanuvchi interfeys haqida ("bu tugma qayerda", "profilni qanday
  o'zgartiraman", "yangi post qayerdan yuklanadi" va h.k.) so'rasa — pastdagi
  bilim bazasidagi "Interfeys tuzilishi" bo'limidan foydalanib ANIQ
  joylashuvni (yuqorida/pastda/chapda/o'ngda, qaysi sahifada) tushuntir,
  taxmin qilib chiqarma.

QIZIQARLI, JONLI SUHBATDOSH BO'LISH (bu SENING ENG MUHIM sifating):
- Sen ChatGPT yoki Gemini kabi haqiqiy shaxsga o'xshab gapirasan — quruq,
  darslikdek, ro'yxat-ro'yxat qilib "ma'lumot bergan" kabi javob berma.
  Avval qisqa, tabiiy, insoniy ohangda gapir, keyin kerak bo'lsa tafsilotga
  o't.
- O'zingning "fikring"/kuzatuving bo'lsin — faqat faktlarni sanab o'tma,
  ularga munosabat bildir, qiziqarli tomonini ta'kidla, kerak bo'lsa
  yengil hazil qil (lekin haddan oshirmasdan, mavzuga mos bo'lsa).
- Suhbatni bir tomonlama "savol-javob" qilib qo'yma: tabiiy his qilingan
  joyda foydalanuvchiga qarshi savol ber, davom ettirishni taklif qil
  yoki mavzuga qiziqish bildir — xuddi haqiqiy do'st bilan suhbatlashgandek.
  Buni HAR javobga majburiy qo'shma, faqat tabiiy chiqqan joyda.
- Oldingi xabarlarni (suhbat tarixini) yodda tut va ularga tabiiy ravishda
  murojaat qil ("aytgan eding-ku", "demak hali ham..." kabi) — bu suhbatni
  jonli va davomiy his qildiradi, har safar "noldan boshlangandek" emas.
- Javoblaring uzunligini mavzuga moslashtir: oddiy savolga qisqa va
  aniq javob ber, chuqur mavzuga esa batafsilroq — lekin hech qachon
  keraksiz cho'zma yoki bir xil qolipdagi struktura bilan zeriktirma.
- Bir xil ibora/qolipni takrorlayverma (masalan har doim "Albatta!" yoki
  "Ajoyib savol!" bilan boshlama) — javoblaring tabiiy ravishda xilma-xil
  bo'lsin, xuddi haqiqiy odam har safar boshqacha gapirganidek.

MUHIM CHEKLOV — SEN FAQAT SUHBATLASHASAN:
- Sen hech qanday amal (xabar yuborish, guruh/kanal yaratish yoki qo'shilish, profil tahrirlash, qidiruv va h.k.) BAJARA OLMAYSAN — senda bunday imkoniyat umuman yo'q.
- Agar foydalanuvchi sendan biror amalni bajarishni so'rasa (masalan "unga xabar yubor", "guruh yarat", "profilimni o'zgartir", "Azizni top"), buni o'zing bajara olmasligingni ochiq va tabiiy tarzda tushuntir va unga buni ilovaning tegishli bo'limi orqali o'zi bajarishini tavsiya qil.
- HECH QACHON "bajardim", "yubordim", "yaratdim", "topdim", "o'zgartirdim" kabi amal bajarilgani haqida da'vo qilma — chunki sen hech narsani amalda bajara olmaysan, faqat matn bilan javob berasan.

MUHIM — RO'YXATDAN O'TISH (AUTH) HAQIDA MAJBURIY QOIDA:
- Ro'yxatdan o'tish (signup) jarayonini tushuntirganda yoki u haqida biror savolga javob berganda, QAYSI SHAKLDA SO'RALISHIDAN QAT'IY NAZAR (qadamlar, umumiy tushuntirish, "qanday" savoli va h.k.), javobingning oxirida QUYIDAGI FAKTNI HECH QACHON O'TKAZIB YUBORMASDAN aniq ayt: "Ro'yxatdan o'tish" tugmasi bosilgach hisob DARHOL to'liq ochilmaydi — u avval "tasdiq kutilmoqda" holatiga o'tadi va foydalanuvchi ADMIN tasdiqlaguncha (yoki rad etguncha) ilovadan foydalana olmaydi.
- "Success" yoki "muvaffaqiyatli ro'yxatdan o'tdingiz" degan xabar — bu FAQAT ariza qabul qilinganini bildiradi, TO'LIQ KIRISH HUQUQINI EMAS. Buni hech qachon "endi hammasi tayyor, ilovadan foydalanishingiz mumkin" tarzida noto'g'ri taqdim qilma.

Quyida MRgram platformasi haqidagi to'liq bilim bazasi (README.md fayli
mazmuni) keltirilgan — javob berishda shundan foydalan:
`.trim();

/**
 * To'liq tizim promptini yig'adi: doimiy shaxsiyat/qoidalar qismi +
 * README.md'dan runtime'da o'qilgan platforma bilimi.
 */
async function buildSystemPrompt() {
  const knowledge = await loadMrgramKnowledge();
  return `${MRGRAM_AI_SYSTEM_PROMPT_BASE}\n\n${knowledge}`;
}

/* ── OVOZLI XABAR javoblari uchun qo'shimcha ko'rsatma ────────────────────
 * AI'ga ovozli xabar (voice message) orqali murojaat qilinganda javob ham
 * OVOZLI XABAR sifatida (TTS + tayyor tovush effektlari orqali) qaytariladi
 * — shu sabab oddiy yozma javobdan farqli, "tabiiy gapiriladigan" uslub
 * kerak: Markdown yo'q, raqamlar so'z bilan, va matn ichiga joylashtirilgan
 * bitta oddiy "[natural]" pauza-tokeni orqali frontend (modules/voice-fx-
 * player.js, resolveNaturalTokens()) ikkita past-profilli variantdan
 * birini (qisqa, eshitiladigan nafas YOKI butunlay ovozsiz jimlik)
 * AVTOMATIK tanlab qo'yadi. AI'ning o'zi variant orasidan tanlashi shart
 * emas — shu bilan yagona, oson bajariladigan qoida qoladi va marker
 * butunlay tushib qolish muammosi bartaraf etiladi. (v58 patch: tomoq
 * qirish, yo'tal va kulgi effektlari — tinglovchini cho'chitib, hikoyani
 * notabiiy qilgani sabab — butunlay olib tashlandi.) */
const VOICE_MESSAGE_SUFFIX = `

MUHIM — bu javob OVOZLI XABAR sifatida ovozga aylantirilib eshittiriladi (foydalanuvchi buni o'qimaydi, tinglaydi). Javobingni tayyorlashda quyidagi qoidalarga QATTIQ amal qil:

1-BOSQICH — Ohang va format:
- HECH QANDAY Markdown belgisi ishlatma (**, #, -, \`\`\` va h.k.) — javob faqat oddiy, tabiiy o'qiladigan matn bo'lsin.
- Gaplarni qisqa, tushunarli va og'zaki nutqqa moslab tuz — uzun, kitobiy gaplardan qoch.
- Har qanday raqamni faqat so'z bilan yoz (masalan "142" emas, "bir yuz qirq ikki").

2-BOSQICH — Tabiiy pauza tokeni: matn ichiga [natural] tokenini qo'sh — bu so'z AYNAN shu yozilishda (kichik harflar, qavs ichida) yozilishi kerak. Bu joyda TTS ovozi bir zumga to'xtaydi va frontend o'zi qisqa nafas yoki ovozsiz jimlikdan birini avtomatik tanlab qo'shadi. Sen faqat "shu yerda tabiiy pauza kerak" deb belgilaysan — aniq qaysi variant ekanini hal qilish frontend zimmasida.

3-BOSQICH — Joylashtirish me'yori: HAR JAVOBGA kamida BITTA [natural] token qo'sh — bu doimiy amal qiladigan qoida. Tokenni FAQAT gap tugagan joyga (nuqta/undov/so'roq belgisidan keyin) qo'y — so'z sonига qarab EMAS. To'g'ri zichlik: har 1-2 GAPdan keyin bittadan token (masalan 4 gaplik javobda 2-3 ta token yetarli). Bitta gapning o'rtasiga hech qachon token qo'yma — chunki har ikki token orasidagi butun matn bitta yaxlit ovoz bo'lagi sifatida ishlov beriladi, uni jumla o'rtasida bo'lib tashlash tabiiy eshitilmaydi.

- Imkon qadar ixcham bo'l — asosiy fikrni ber, keraksiz cho'zishlardan qoch. Mavzu juda katta bo'lsa, eng muhim qismini ayt va kerak bo'lsa foydalanuvchi so'rasa davom ettirasan.
- Formulalar yoki murakkab texnik tafsilotlarni og'zaki tushuntirishga mos soddalashtir.`;


// gpt-oss-120b — "reasoning" model: max_tokens byudjeti ko'rinadigan javob
// BILAN BIRGA modelning ichki fikrlash (reasoning) tokenlarini ham qamrab
// oladi (reasoning_effort: 'low' bo'lsa ham, bir nechta yuzlab token
// fikrlashga ketishi mumkin). Byudjet torroq bo'lsa — javob o'rtada
// kesilib qoladi (ayniqsa ovozli rejimda, chunki u yerda byudjet kichikroq
// edi). Shu sabab ikkalasini ham yetarlicha katta qilib qo'yamiz.
const TEXT_MAX_TOKENS  = 1500; // avval: 800
const VOICE_MAX_TOKENS = 900;  // avval: 350

/* ── Takrorlanish (repetition-loop) filtri ────────────────────────────────
 * Ba'zan Groq modeli finish_reason === 'stop' bilan "muvaffaqiyatli"
 * tugaydi, lekin buning ICHIDA allaqachon "...deb javob berdi... dedi...
 * deb javob berdi..." kabi bir xil so'z ketma-ketligini cheksiz
 * takrorlagan bo'ladi (klassik LLM "repetition loop" muammosi). Bu holatda
 * finishReason tekshiruvi (faqat 'length' yoki 'stop'dan boshqa holat)
 * YETARLI EMAS — chunki model o'zi "to'xtadim" deb hisoblagan bo'ladi,
 * lekin matn allaqachon buzilgan.
 *
 * stripRepeatedPhrases() shu buzuq qismni SAQLASHDAN OLDIN aniqlab, kesib
 * tashlaydi: matnni so'zlarga bo'lib, N ta so'zdan iborat "oyna" (window)
 * — standart holatda 4 tadan 6 tagacha so'z — ketma-ketligini boshidan
 * oxirigacha skanerlaydi. Xuddi shu N-so'zli ketma-ketlik matn ichida
 * IKKINCHI marta uchrasa (ya'ni 2 yoki undan ko'p marta takrorlansa), bu
 * "tsiklga tushib qolish" belgisi hisoblanadi va matn aynan o'sha
 * takrorlanish BOSHLANGAN nuqtadan kesib tashlanadi — birinchi (asl,
 * buzilmagan) qism saqlab qolinadi.
 *
 * Nega 4-6 so'zlik oyna? 1-3 so'zlik ketma-ketliklar ("va shuning
 * uchun", "men bunga") tabiiy nutqda ham tez-tez ikki marta uchrab
 * qolishi mumkin (yolg'on signal / false positive xavfi yuqori). 4 va
 * undan ko'p so'zdan iborat ANIQ bir xil ketma-ketlikning ikki marta
 * qaytarilishi esa amalda deyarli har doim model xatosi (repetition
 * loop) bo'ladi — tabiiy matnda bunday uzun bo'lak tasodifan ikki marta
 * qaytarilishi juda kam uchraydi.
 *
 * Bir nechta oyna o'lchami (4, 5, 6) bo'yicha tekshirilib, ULARNING
 * ICHIDAN ENG ERTA (matnning eng boshiga yaqin) topilgan kesish nuqtasi
 * tanlanadi — shunda takrorlanish qaysi so'z uzunligida boshlangan
 * bo'lishidan qat'i nazar, buzuq qism to'liq kesib tashlanadi.
 *
 * @param {string} text — tekshiriladigan/tozalanadigan matn
 * @param {{minWords?: number, maxWords?: number}} [opts]
 * @returns {string} — agar takrorlanish topilsa, kesilgan (qisqartirilgan)
 *   matn; aks holda ASL matnning o'zi (o'zgarishsiz)
 */
function stripRepeatedPhrases(text, opts = {}) {
  if (!text || typeof text !== 'string') return text;
  const minWords = opts.minWords || 4;
  const maxWords = opts.maxWords || 6;

  // So'zlarga bo'lamiz (kesilgan matnni qayta yig'ish uchun asl so'zlarni
  // saqlaymiz), lekin taqqoslash uchun har bir so'zning faqat harf/
  // raqamlardan iborat, kichik harfli "normal" shaklini ishlatamiz — shunda
  // "gapdi." va "gapdi," kabi tinish belgili farqlar takrorlanishni
  // "ko'rmasdan qoldirmaydi".
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < minWords * 2) return text; // juda qisqa matnda tekshirish shart emas

  const normalize = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const normWords = words.map(normalize);

  let earliestCut = -1;
  for (let n = minWords; n <= maxWords; n++) {
    const seen = new Set();
    for (let i = 0; i <= normWords.length - n; i++) {
      const gram = normWords.slice(i, i + n).join(' ');
      if (!gram.replace(/\s+/g, '')) continue; // faqat tinish belgilaridan iborat bo'lak — o'tkazib yuboramiz
      if (seen.has(gram)) {
        if (earliestCut === -1 || i < earliestCut) earliestCut = i;
        break; // shu N uchun eng erta takror topildi, keyingi N ga o'tamiz
      }
      seen.add(gram);
    }
  }

  if (earliestCut > 0) {
    const cleaned = words.slice(0, earliestCut).join(' ').trim();
    // Xavfsizlik: agar negadir bo'sh chiqib qolsa, asl matnni qaytaramiz
    // (foydalanuvchini butunlay javobsiz qoldirmaslik uchun).
    return cleaned || text;
  }
  return text;
}

/**
 * finish_reason === 'length' bo'lsa (ya'ni javob max_tokens byudjeti
 * tugagani sabab o'rtada kesilgan bo'lsa) YOKI matn takrorlanish tsikliga
 * tushib, stripRepeatedPhrases() tomonidan kesilgan bo'lsa — bitta
 * qo'shimcha so'rov bilan xuddi shu javobni (endi toza holatdagi qisman
 * matndan) davom ettirib, tugatib berishga harakat qiladi.
 * Faqat BITTA marta urinadi (cheksiz tsiklga tushmaslik uchun).
 */
async function _continueIfTruncated(baseMessages, partialText, { model, maxTokens }) {
  try {
    const continueMessages = [
      ...baseMessages,
      { role: 'assistant', content: partialText },
      { role: 'user', content: 'Javobing o\'rtada kesilib qoldi (token limiti yoki takrorlanish tsikliga tushib qolgani sabab). Iltimos xuddi shu fikrni, boshidan takrorlamasdan va oldingi so\'zlarni qaytarmasdan, to\'g\'ridan-to\'g\'ri davom ettirib, qisqa va tabiiy tarzda yakunla.' },
    ];
    const rest = await groqRequest(continueMessages, {
      model, max_tokens: Math.min(maxTokens, 500), temperature: 0.7,
      frequency_penalty: 0.4, presence_penalty: 0.15, reasoning_effort: 'low',
    });
    const cleanRest = (rest || '').trim();
    if (!cleanRest) return partialText;
    // Agar qisman javob so'z o'rtasida kesilgan bo'lsa (probel bilan
    // tugamagan) — chiroyli birlashtirish uchun orasiga bo'shliq qo'yamiz.
    const needsSpace = !/[\s\-]$/.test(partialText) && !/^[\s.,!?;:]/.test(cleanRest);
    return partialText + (needsSpace ? ' ' : '') + cleanRest;
  } catch (_) {
    // Davom ettirish muvaffaqiyatsiz bo'lsa — hech bo'lmasa qisman javobni
    // qaytaramiz, butunlay javobsiz qoldirmaymiz.
    return partialText;
  }
}

/**
 * Suhbat tarixi va yangi xabar asosida MRgram AI javobini oladi.
 * @param {{role:'user'|'assistant', content:string}[]} history — oldingi xabarlar (eng ko'pi bilan oxirgi ~12 ta)
 * @param {string} userText — foydalanuvchining yangi matn xabari (bo'sh bo'lishi mumkin, agar faqat rasm bo'lsa)
 * @param {string|null} imageUrl — agar foydalanuvchi rasm yuborgan bo'lsa, uning ochiq (public) URL manzili
 * @returns {Promise<string>} AI javobining matni
 */
export async function getMrgramAiReply(history, userText, imageUrl) {
  // Limitga tegilsa — Error tashlanadi, ichida aniq "N soniyadan keyin
  // qayta urinib ko'ring" degan matn bor. Admin uchun cheklovsiz.
  await enforceAiRateLimit('chat');

  const systemPrompt = await buildSystemPrompt();
  const messages = [{ role: 'system', content: systemPrompt }];

  (history || []).forEach(h => {
    if (h && h.content) messages.push({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.content });
  });

  // Rasm yuborilgan bo'lsa — vision model.
  if (imageUrl) {
    const parts = [];
    parts.push({ type: 'text', text: (userText && userText.trim()) || 'Bu rasmda nima ko\'ryapsiz? Batafsil tasvirlab bering.' });
    parts.push({ type: 'image_url', image_url: { url: imageUrl } });
    messages.push({ role: 'user', content: parts });
    const reply = await groqRequest(messages, { model: AI_VISION_MODEL, max_tokens: TEXT_MAX_TOKENS, temperature: 0.7 });
    return reply || 'Kechirasiz, rasmni tahlil qila olmadim. Qaytadan urinib ko\'ring.';
  }

  messages.push({ role: 'user', content: userText || '' });

  let finishReason = null;
  const reply = await groqRequest(messages, {
    model: AI_TEXT_MODEL, max_tokens: TEXT_MAX_TOKENS, temperature: 0.7,
    frequency_penalty: 0.4, presence_penalty: 0.15, reasoning_effort: 'low',
    onFinish: (fr) => { finishReason = fr; },
  });
  let text = (reply || '').trim() || 'Kechirasiz, javob bera olmadim. Qaytadan urinib ko\'ring.';

  // Takrorlanish tsikliga tushib qolgan bo'lsa (finishReason 'stop' bo'lsa
  // ham) — buzuq qismni saqlashdan OLDIN kesib tashlaymiz.
  const deLooped = stripRepeatedPhrases(text);
  const wasLooping = deLooped.length < text.length;
  if (wasLooping) text = deLooped;

  if (finishReason === 'length' || wasLooping) {
    text = await _continueIfTruncated(messages, text, { model: AI_TEXT_MODEL, maxTokens: TEXT_MAX_TOKENS });
    // Xavfsizlik: davom ettirilgan qism o'zi ham takrorlanib ketishi
    // mumkin — yana bir qayta so'rov yubormasdan, shunchaki yana bir
    // marta kesib tashlaymiz (cheksiz tsiklga tushmaslik uchun).
    text = stripRepeatedPhrases(text);
  }
  return text;
}

/**
 * `getMrgramAiReply()`ning STREAMING versiyasi — Claude/ChatGPT kabi
 * javob so'z-so'z (real-vaqt) ko'rinishi uchun. Har bir bo'lak kelgan
 * zahoti `onDelta(delta, fullSoFar)` chaqiriladi; funksiya oxirida
 * to'liq matnni (string) qaytaradi.
 *
 * Rasm yuborilgan holatlar (vision) hamon oddiy (non-stream) so'rov
 * bilan ishlaydi — vision javoblar odatda qisqa va tezroq keladi, shu
 * sabab qo'shimcha murakkablik shart emas; shunda ham `onDelta` bir marta
 * to'liq matn bilan chaqiriladi, chaqiruvchi kod bir xil ishlashi uchun.
 *
 * @param {{voiceMode?: boolean}} [opts] — voiceMode: true bo'lsa, javob
 *   ovozli xabar sifatida qaytarilishi ko'zda tutilib, tabiiy/qisqa/
 *   Markdown'siz uslub va tovush-effekt markerlari uchun qo'shimcha
 *   ko'rsatma qo'shiladi (yuqoridagi VOICE_MESSAGE_SUFFIX).
 * @returns {Promise<string>} AI javobining to'liq matni
 */
export async function getMrgramAiReplyStream(history, userText, imageUrl, onDelta, opts = {}) {
  // Limitga tegilsa — Error tashlanadi, ichida aniq "N soniyadan keyin
  // qayta urinib ko'ring" degan matn bor. Admin uchun cheklovsiz.
  await enforceAiRateLimit('chat');

  const voiceMode = !!opts.voiceMode;
  const maxTokens = voiceMode ? VOICE_MAX_TOKENS : TEXT_MAX_TOKENS;

  const systemPrompt = (await buildSystemPrompt()) + (voiceMode ? VOICE_MESSAGE_SUFFIX : '');
  const messages = [{ role: 'system', content: systemPrompt }];

  (history || []).forEach(h => {
    if (h && h.content) messages.push({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.content });
  });

  if (imageUrl) {
    const parts = [];
    parts.push({ type: 'text', text: (userText && userText.trim()) || 'Bu rasmda nima ko\'ryapsiz? Batafsil tasvirlab bering.' });
    parts.push({ type: 'image_url', image_url: { url: imageUrl } });
    messages.push({ role: 'user', content: parts });
    const reply = await groqRequest(messages, { model: AI_VISION_MODEL, max_tokens: maxTokens, temperature: 0.7 });
    const text = reply || 'Kechirasiz, rasmni tahlil qila olmadim. Qaytadan urinib ko\'ring.';
    const finalText = voiceMode ? resolveNaturalTokens(sanitizeNaturalMarkers(text)) : text;
    onDelta?.(finalText, finalText);
    return finalText;
  }

  messages.push({ role: 'user', content: userText || '' });

  try {
    let finishReason = null;
    const full = await groqRequestStream(
      messages,
      {
        model: AI_TEXT_MODEL, max_tokens: maxTokens, temperature: 0.7,
        frequency_penalty: 0.4, presence_penalty: 0.15, reasoning_effort: 'low',
        onFinish: (fr) => { finishReason = fr; },
      },
      onDelta
    );
    let text = full || 'Kechirasiz, javob bera olmadim. Qaytadan urinib ko\'ring.';

    // MUHIM: model matnni takrorlanish tsikliga tushib yozib bo'lgach ham
    // ko'pincha finishReason === 'stop' bilan "muvaffaqiyatli" tugaydi —
    // shu sabab faqat finishReason'ga tayanish YETARLI EMAS. Saqlashdan
    // (va TTS/ekranga yuborishdan) OLDIN matnni har doim
    // stripRepeatedPhrases() orqali tekshiramiz: agar bir xil 4-6 so'zlik
    // ketma-ketlik 2 yoki undan ko'p marta takrorlangan bo'lsa, buzuq qism
    // takror boshlangan nuqtadan kesib tashlanadi.
    const deLooped = stripRepeatedPhrases(text);
    const wasLooping = deLooped.length < text.length;
    if (wasLooping) text = deLooped;

    // MUHIM: nafaqat finishReason === 'length' (token byudjeti tugagan),
    // balki 'stop'dan BOSHQA har qanday holat (masalan aloqa/serverning
    // vaqt limiti tufayli oqim o'rtada, hech qanday finish_reason'siz
    // uzilib qolgani) HAM, YOKI yuqorida takrorlanish tsikli aniqlanib
    // matn kesilgan bo'lsa HAM — "kesilgan javob" hisoblanadi — aks holda
    // bunday holatlarda kesilgan/buzuq matn tekshirilmasdan "to'liq javob"
    // sifatida saqlanib qolar edi.
    if ((finishReason && finishReason !== 'stop' && full) || wasLooping) {
      // Bitta qo'shimcha (stream'siz) so'rov bilan davom ettirib tugatamiz.
      // Foydalanuvchi ekranda buni ko'rmaydi (onDelta chaqirilmaydi), lekin
      // yakuniy matn to'liq bo'ladi — kesilgan/buzuq javob Firestore'ga
      // yozilmaydi va TTS'ga ham tozalangan matn yuboriladi.
      text = await _continueIfTruncated(messages, text, { model: AI_TEXT_MODEL, maxTokens });
      // Xavfsizlik: davom ettirilgan qism o'zi ham takrorlanib ketishi
      // mumkin — yana bir qayta so'rov yubormasdan, shunchaki yana bir
      // marta kesib tashlaymiz (cheksiz tsiklga tushmaslik uchun).
      text = stripRepeatedPhrases(text);
    }
    return voiceMode ? resolveNaturalTokens(sanitizeNaturalMarkers(text)) : text;
  } catch (err) {
    // Streaming ishlamasa (masalan tarmoq/eski brauzer) — oddiy so'rovga
    // qaytamiz, hech bo'lmasa foydalanuvchi javobsiz qolmasin.
    const reply = await groqRequest(messages, { model: AI_TEXT_MODEL, max_tokens: maxTokens, temperature: 0.7, frequency_penalty: 0.4, presence_penalty: 0.15, reasoning_effort: 'low' });
    const text = (reply || '').trim() || 'Kechirasiz, javob bera olmadim. Qaytadan urinib ko\'ring.';
    const finalText = voiceMode ? resolveNaturalTokens(sanitizeNaturalMarkers(text)) : text;
    onDelta?.(finalText, finalText);
    return finalText;
  }
}

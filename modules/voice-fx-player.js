/**
 * modules/voice-fx-player.js
 * ─────────────────────────────────────────────────────────────────────────
 * "MRgram AI" ovozli javoblarini — matn ichidagi maxsus aktivator
 * markerlar ([qisqa-nafas.mp3] — eshitiladigan qisqa nafas, [pauza] —
 * ovozsiz mantiqiy to'xtash) va Microsoft Edge TTS orqali sintez
 * qilingan matn bo'laklarini BITTA uzluksiz, navbatma-navbat
 * (sequential) Audio Queue sifatida ijro etadi.
 *
 * ESLATMA (v58 patch): ilgari mavjud bo'lgan tomoq-qirish, yo'tal, chuqur
 * nafas va kulgi effektlari ATAYLAB olib tashlandi — bular tinglovchini
 * cho'chitib, hikoyaning tabiiyligini buzayotgani aniqlandi (baland/
 * kutilmagan tovushlar, kontekstga mos kelmaydigan kulgi). Endi faqat
 * ikkita, juda past profilli variant qoladi: qisqa nafas va jimgina
 * pauza.
 *
 * MUHIM ARXITEKTURA QOIDASI: hech qachon parallel ijro (.forEach/.map
 * ichida audio.play()) ishlatilmaydi — bu bir nechta ovoz bir-biriga
 * qo'shilib ketishiga (xaosga) olib keladi. Buning o'rniga BITTA umumiy
 * <audio> elementi qayta ishlatiladi va har bir bo'lak navbat bilan,
 * awaitlanadigan Promise ichida, oldingisi to'liq tugagach ('onended')
 * boshlanadi.
 *
 * OVOZ BALANDLIGI (VOLUME) — nega qattiq belgilangan:
 * Har bir effekt faylning tabiati boshqacha (nafas/kulgi — yumshoq va
 * qisqa, tomoq qirish/yo'tal — nisbatan "qattiqroq" tovush), shu sabab
 * Edge TTS'ning toza ovozi bilan yonma-yon turganda tabiiy eshitilishi
 * uchun pastdagi EFFECT_VOLUME orqali har biriga alohida volume
 * belgilangan. Effekt TUGAGANDAN KEYIN, keyingi TTS bo'lagi ijro
 * etilishidan oldin, `audio.volume` albatta 1.0'ga qaytariladi — aks
 * holda bitta umumiy <audio> elementi ishlatilgani uchun TTS ham
 * pastroq ovozda eshitilib qolar edi.
 *
 * Fayllar/yo'llar: effekt ham "Sardor" (erkak, /audio/sardor/*.mp3),
 * ham "Madina" (ayol, /audio/madina/*.mp3) ovozlari uchun tayyor — ikkala
 * papkada AYNAN BIR XIL fayl nomi bo'lishi shart (VOICE_FOLDERS'ga
 * qarang), aks holda muqobil ovozda effekt jimgina o'tkazib yuboriladi.
 */
import { _fetchTtsBlob, getAiVoiceGender } from './config.js';

/* ── Marker → fayl nomi va volume xaritasi ────────────────────────────────
 * AI matn ichiga aynan shu marker'ni qavs ichida qo'yadi: [qisqa-nafas.mp3]
 * — bu yagona, hali ham eshitiladigan (audio fayldan ijro etiladigan)
 * effekt. [pauza] alohida — u fayl EMAS, shunchaki ovozsiz to'xtash
 * (pastga, PAUSE_MARKER'ga qarang), shu sabab bu xaritada yo'q. */
const EFFECT_VOLUME = {
  'qisqa-nafas.mp3': 0.6,         // ENG KO'P ishlatiladigan, standart tabiiy pauza
};

// TTS bo'laklari uchun standart (to'liq) ovoz balandligi — effektdan keyin
// har doim shunga qaytariladi.
const TTS_VOLUME = 1.0;

// Ovoz jinsiga qarab qaysi papkadan effekt olinishini belgilaydi.
const VOICE_FOLDERS = { male: 'sardor', female: 'madina' };

// Ovozsiz mantiqiy-to'xtash marker'i — audio fayli yo'q, shunchaki qisqa
// jimlik. MARKER_FILES ichida ham qatnashadi (splitByMarkers/RegExp uni
// "marker" deb tan olishi uchun), lekin EFFECT_VOLUME/effectUrl unga
// tegishli emas — pastdagi playback/kod alohida silent-branch bilan
// ishlaydi (fetch/audio elementisiz, shunchaki qisqa setTimeout kutish).
const PAUSE_MARKER = 'pauza';
const PAUSE_MS = 350; // jonli ijroda kutiladigan jimlik davomiyligi
const PAUSE_SILENCE_SEC = 0.35; // offline render (buildVoiceMessageAudioBlob)dagi jim bo'lak davomiyligi

/* ── Effekt CROSSFADE (ustma-ust chiqarish) sozlamalari ───────────────────
 * MUAMMO (foydalanuvchi fikr-mulohazasi): oldin har bir bo'lak TO'LIQ
 * ketma-ket ijro etilardi — TTS to'xtaydi, KEYIN nafas effekti boshlanadi,
 * u tugagach yana TTS. Bu "to'xtab-yugurib" eshitiladi, notabiiy.
 *
 * YECHIM: [qisqa-nafas.mp3] effekti endi TTS ustiga — oldingi bo'lak hali
 * tugamasdanoq — FADE IN bilan "kirib keladi" va keyingi TTS boshlanishidan
 * biroz OLDIN FADE OUT bilan "chiqib ketadi". Natijada effekt hech qachon
 * qattiq to'xtab-boshlanmaydi, TTS ham hech qachon "kutib qolmaydi" —
 * ikkalasi bir necha o'ndan bir soniya ustma-ust eshitiladi (masalan
 * 3 soniyalik TTS bo'lagidan keyin: effekt 2.7s'da kirib, 3.7s'da tugaydi,
 * keyingi TTS esa 3.5s'da, effekt hali butunlay so'nmasdan, boshlanadi).
 * [pauza] (ovozsiz) bunga tegishli emas — u faqat oddiy, bo'shliqsiz jim
 * оraliq sifatida qoladi (unda "chiqib-kiruvchi" tovush yo'q, fade
 * qilishning ma'nosi yo'q). */
const EFFECT_OVERLAP_IN_SEC = 0.3;   // effekt oldingi bo'lak tugashidan necha soniya OLDIN boshlanadi
const EFFECT_OVERLAP_OUT_SEC = 0.2;  // keyingi bo'lak effekt tugashidan necha soniya OLDIN boshlanadi
const EFFECT_FADE_IN_SEC = 0.12;     // effektning o'zi 0 → volume gacha shu vaqt ichida "kirib keladi"
const EFFECT_FADE_OUT_SEC = 0.18;    // effektning o'zi volume → 0 gacha shu vaqt ichida "chiqib ketadi"

/** Bitta bo'lakning (TTS/[pauza]/effekt) rejalashtirilgan boshlanish va
 * tugash vaqtini, shuningdek undan KEYINGI bo'lak odatda qaysi vaqtdan
 * boshlanishi kerakligini ("nextCursor") hisoblaydi. FAQAT isEffect=true
 * bo'lganda OVERLAP qo'llaniladi (qisqa-nafas.mp3) — u oldingi bo'lakning
 * (hali tugamagan) davomiga botib boshlanadi va keyingi bo'lak
 * boshlanishidan oldinroq "tugaydi" (aslida gain fade-out orqali eshitilmay
 * qoladi). TTS va [pauza] doim oddiy, bo'shliqsiz ketma-ket qo'yiladi.
 * @param {number} cursor - joriy "rejalashtirilgan" vaqt (soniya)
 * @param {number} floor - undan OLDINGA hech qachon boshlanmasin (offline
 *   render uchun 0, jonli ijro uchun ctx.currentTime)
 * @param {number} dur - shu bo'lakning davomiyligi (soniya)
 * @param {boolean} isEffect
 */
function _planSegmentTiming(cursor, floor, dur, isEffect) {
  let start;
  if (isEffect) {
    const overlapIn = Math.max(0, Math.min(EFFECT_OVERLAP_IN_SEC, cursor - floor, dur / 2));
    start = Math.max(floor, cursor - overlapIn);
  } else {
    start = Math.max(floor, cursor);
  }
  const end = start + dur;
  const nextCursor = isEffect
    ? Math.max(start, end - Math.min(EFFECT_OVERLAP_OUT_SEC, dur / 2))
    : end;
  return { start, end, nextCursor };
}

/** Bir nechta bo'lak (TTS + effekt) BIR VAQTDA (overlap/crossfade tufayli)
 * eshitiladigan bo'lganda, ularning amplitudalari to'g'ridan-to'g'ri
 * qo'shilib ketishi mumkin (masalan TTS 1.0 + effekt 0.6 = 1.6) — bu esa
 * "clipping" (ovoz cho'qqilarining qattiq kesilib, xirillab eshitilishi)
 * ga olib keladi va aynan overlap paytida ANIQ SHU o'rinda notabiiy tovush
 * chiqarib, butun maqsadni (silliq, sezilmas o'tish) buzadi. YECHIM: har
 * bir bo'lak destination'ga TO'G'RIDAN-TO'G'RI emas, umumiy bitta
 * DynamicsCompressorNode orqali ulanadi — bu radio/podcast mixlashda
 * standart usul: past darajadagi tovushlarga deyarli tegmaydi, faqat
 * cho'qqilar (bir nechta bo'lak qo'shilib ketgan lahzalar) birlashganda
 * ularni yumshoq ravishda pasaytiradi, shu bilan clipping oldini oladi. */
function _createLimiterBus(ctx) {
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -18; // shu darajadan yuqori cho'qqilarga tegadi
  compressor.knee.value = 12;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.005;
  compressor.release.value = 0.15;
  compressor.connect(ctx.destination);
  return compressor;
}


/** Berilgan GainNode'ga effekt uchun fade-in/fade-out "zarf" (envelope)
 * automatsiyasini o'rnatadi: 0 → volume (FADE IN) → volume (ushlab turish)
 * → 0 (FADE OUT). Oddiy (effekt bo'lmagan) bo'laklar uchun shunchaki
 * doimiy volume qo'yiladi — ular fade qilinmaydi. */
function _applyGainEnvelope(gainNode, start, end, volume, isEffect) {
  if (!isEffect) {
    gainNode.gain.setValueAtTime(volume, start);
    return;
  }
  const dur = end - start;
  const fadeIn = Math.min(EFFECT_FADE_IN_SEC, dur / 2);
  const fadeOut = Math.min(EFFECT_FADE_OUT_SEC, dur / 2);
  gainNode.gain.setValueAtTime(0, start);
  gainNode.gain.linearRampToValueAtTime(volume, start + fadeIn);
  gainNode.gain.setValueAtTime(volume, Math.max(start + fadeIn, end - fadeOut));
  gainNode.gain.linearRampToValueAtTime(0, end);
}

// Marker sifatida tan olinadigan nomlar — yagona joyda saqlanadi,
// pastdagi RegEx'lar va resolveNaturalTokens() shu ro'yxatga tayanadi.
const MARKER_FILES = [
  'qisqa-nafas.mp3',
  PAUSE_MARKER,
];
const _MARKER_ALT = MARKER_FILES.map(f => f.replace(/\./g, '\\.')).join('|');

// Talab qilingan aniq RegEx: matnni faqat yuqoridagi fayl-markerlar
// bo'yicha bo'laklarga ajratadi, marker'larning o'zi ham natija
// massivida saqlanadi (capturing group tufayli — String.split shunday
// ishlaydi).
const MARKER_SPLIT_RE = new RegExp(`(\\[(?:${_MARKER_ALT})\\])`, 'g');

function effectUrl(gender, filename) {
  const folder = VOICE_FOLDERS[gender] || VOICE_FOLDERS.male;
  return `/audio/${folder}/${filename}`;
}

const _MARKER_SINGLE_RE = new RegExp(`^\\[(${_MARKER_ALT})\\]$`);

/** Matnni marker (masalan "[qisqa-nafas.mp3]") chegaralari bo'yicha
 * ketma-ket bo'laklarga ajratadi. Natija: string (oddiy matn) yoki
 * { file: 'qisqa-nafas.mp3' } obyektlaridan iborat massiv — asl matndagi
 * tartib saqlanadi, bo'sh bo'laklar chiqarib tashlanadi. */
function splitByMarkers(text) {
  return String(text || '')
    .split(MARKER_SPLIT_RE)
    .filter(Boolean)
    .map(piece => {
      const m = piece.match(_MARKER_SINGLE_RE);
      return m ? { file: m[1] } : piece;
    });
}

/** FAQAT jonli (live) ijro uchun (playVoiceMessageWithEffects) — marker
 * bo'laklari orasidagi ODDIY MATN qismlarini yana GAP (jumla, ". ! ?"
 * bo'yicha) darajasida mayda bo'laklarga bo'ladi. Marker'larning o'zi
 * (tomoq/nafas/yo'tal/kulgi effektlari) HECH QACHON bu yerda bo'linmaydi
 * va o'z joyida, o'zgarishsiz qoladi — faqat ular orasidagi uzun matn
 * (masalan 2-3 jumlali bo'lak) endi bitta katta TTS so'rovi o'rniga bir
 * nechta kichik (har bir jumla uchun alohida) TTS so'roviga bo'linadi.
 *
 * NEGA KERAK: oldin butun bo'lak (bir nechta jumla) bitta TTS so'roviga
 * yuborilardi — shu sabab birinchi tovush chiqishidan oldin FOYDALANUVCHI
 * butun bo'lak tayyor bo'lishini kutishi kerak edi (uzoq kutish, ba'zan
 * bir necha soniya). Endi faqat BIRINCHI jumla (odatda ancha qisqa)
 * tayyor bo'lishi kifoya — ijro shu bilan boshlanadi, qolgan jumlalar esa
 * quyidagi playVoiceMessageWithEffects ichidagi pipeline orqali AYNAN SHU
 * BIRINCHI JUMLA ijro etilayotgan paytda fon rejimida oldindan
 * so'ralib/tayyorlanib turadi (bo'lak navbat tartibi va marker joylashuvi
 * esa 100% bir xil qoladi — faqat oraliq bo'linish nuqtalari ko'payadi). */
function splitIntoPlaybackChunks(text) {
  const parts = splitByMarkers(text);
  const out = [];
  for (const part of parts) {
    if (part && typeof part === 'object' && part.file) {
      out.push(part); // marker — bo'linmaydi, o'zgarishsiz
      continue;
    }
    const str = String(part || '');
    if (!str.trim()) continue;
    // Xavfsiz (yo'qotishsiz) tokenizator — raqamli ro'yxat va qo'shtirnoq
    // ichidagi gaplarda ham matn butun qoladi (splitIntoSentences'ga q.).
    out.push(...splitIntoSentences(str));
  }
  return out;
}

/** Berilgan <audio> elementida `src`ni, berilgan `volume` bilan ijro etadi
 * va TO'LIQ tugaguncha (yoki xato chiqquncha) kutadigan Promise
 * qaytaradi. Xato bo'lsa ham (fayl topilmadi, TTS ishlamadi va h.k.)
 * navbat qotib qolmasligi uchun shu yerning o'zida `resolve()`
 * chaqiriladi. */
function playQueueItem(audioEl, src, volume) {
  return new Promise((resolve) => {
    try {
      audioEl.onended = null;
      audioEl.onerror = null;
      audioEl.pause();
      audioEl.src = src;
      audioEl.currentTime = 0; // har bir bo'lak har doim boshidan toza boshlansin
      audioEl.volume = (typeof volume === 'number') ? volume : TTS_VOLUME;

      audioEl.onended = () => resolve();
      audioEl.onerror = () => {
        console.warn('[voice-fx] audio ijrosida xato, keyingi bo\'lakka o\'tilmoqda:', src);
        resolve();
      };

      const playPromise = audioEl.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch((err) => {
          console.warn('[voice-fx] play() rad etildi, keyingi bo\'lakka o\'tilmoqda:', err?.message || err);
          resolve();
        });
      }
    } catch (err) {
      console.warn('[voice-fx] kutilmagan xato, keyingi bo\'lakka o\'tilmoqda:', err?.message || err);
      resolve();
    }
  });
}

/** Saqlanadigan (Firestore) `text` maydoni uchun — matndagi marker'larni
 * butunlay olib tashlaydi (masalan "[qisqa-nafas.mp3]"), toza matn qoldiradi.
 * Bu faqat suhbat tarixi/konteksti uchun ishlatiladi — marker'lar keyingi
 * AI so'roviga hech qanday foyda bermaydi, aksincha chalg'itishi mumkin. */
export function stripEffectMarkers(text) {
  return String(text || '').replace(MARKER_SPLIT_RE, ' ').replace(/\s{2,}/g, ' ').trim();
}

/** Oddiy (Markdown'li) matnni ovozli o'qish uchun tozalaydi: kod bloklari,
 * qalin/kursiv belgilari, sarlavha/ro'yxat belgilari va linklarni olib
 * tashlab, faqat o'qiladigan matnni qoldiradi. TTS'ga jo'natilgan matn
 * ichida "**", "#", "```" kabi belgilar so'zma-so'z o'qilib qolmasligi
 * uchun MUHIM. */
export function stripMarkdownForSpeech(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Barcha "tan olinadigan" marker'larni (aniq fayl-marker'lar HAM, generic
 * "[natural]" tokeni HAM) bitta joyda ushlab turadigan RegEx. Bo'sh joylarga
 * (masalan "[ natural ]") ham chidamli bo'lishi uchun \s* qo'yilgan.
 * sanitizeNaturalMarkers() FAQAT shu ikkalasini "marker" deb tan oladi —
 * boshqa har qanday "[...]" (masalan Markdown link qismi) tegilmaydi. */
const _SANITIZE_MARKER_RE = new RegExp(`\\[\\s*(?:natural|${_MARKER_ALT})\\s*\\]`, 'gi');

/* ── XAVFSIZ (yo'qotishsiz) gap-bo'lish tokenizatori ──────────────────────
 * ESKI MUAMMO (ikkita alohida xato bitta ildizdan kelib chiqardi):
 *
 *  1) "1. Band matni." kabi raqamli ro'yxatlarda "1." o'zi alohida
 *     "gap" sifatida ajralib chiqardi (chunki har qanday nuqta gap oxiri
 *     deb hisoblanardi) — natijada effekt marker shu yolg'iz raqamga
 *     yopishib, gap ICHIDA (haqiqiy matn boshlanishidan oldin) eshitilardi.
 *
 *  2) ESKI regex: /[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g — tinish belgisidan
 *     KEYIN albatta bo'sh joy yoki matn oxiri talab qilardi. Agar tinish
 *     belgisidan keyin bo'shliqsiz boshqa belgi kelsa (eng ko'p uchraydigan
 *     holat — YOPILUVCHI QO'SHTIRNOQ: `gap."` ), regex o'sha joyda mos
 *     kelmay qolardi. String.match() esa mos kelmagan joylarni "sirg'anib"
 *     tashlab, keyingi mos keladigan joygacha BUTUN MATNNI YO'QOTIB
 *     YUBORARDI — shu sabab "AI ro'yxat/qo'shtirnoqli band'larni o'qimay
 *     tashlab ketardi".
 *
 * YECHIM: pastdagi splitIntoSentences() ikkalasini ham tag'in chiqmaydigan
 * qilib hal qiladi:
 *  - Kasr sonlar ("3.14") va qisqa raqamli ro'yxat markerlari ("1.", "12.")
 *    ichidagi nuqta VAQTINCHA "himoyalanadi" (gap oxiri deb hisoblanmaydi).
 *  - Qolgan HAR BIR nuqta/undov/so'roq belgisi — undan keyin darhol
 *    yopiluvchi qo'shtirnoq/qavs kelsa ham — QATIY ravishda gap oxiri deb
 *    belgilanadi va o'sha yopiluvchi belgi(lar) shu gapning o'ziga qo'shib
 *    olinadi (keyingi gapga emas, aks holda ular "erkin" qolib, o'zidan
 *    oldingi butun gap bilan birga adashtirib yuborilishi mumkin edi).
 *  - Funksiya MATNNI BIR MARTA, INDEKS BO'YICHA aylanib chiqadi — regex
 *    "sirg'alib ketishi" mumkin bo'lgan .match() o'rniga — shu sabab
 *    HECH QACHON belgi yo'qotilmaydi (bo'laklarni qo'shsangiz, asl matn
 *    tiklanadi — faqat ortiqcha bo'sh joylar normalizatsiya qilinadi).
 *  - Oxirida, yolg'iz qolgan raqamli ro'yxat markeri ("1.") bo'lsa, u
 *    o'zidan keyingi gapga BIRLASHTIRILADI — shu bilan effekt marker
 *    hech qachon yolg'iz raqamga yopishib qolmaydi. */
const _LIST_MARKER_ONLY_RE = /^\d{1,3}\.$/;
const _CLOSER_CHARS = '"\'\u00BB\u201D\u2019)\u005D\u203A\u300D\u300F';
function splitIntoSentences(text) {
  const str = String(text || '');
  if (!str.trim()) return [];

  const PH = '\u0000';
  // Kasr sonlar ichidagi nuqtani himoyalaymiz (masalan "3.14" formatidagi
  // kasrlar ham uchrashi mumkin — vergulli "3,14" bunga tegishli emas).
  let masked = str.replace(/(\d)\.(\d)/g, `$1${PH}$2`);
  // Qisqa raqamli ro'yxat markerlari: qator/matn boshida yoki bo'sh joydan
  // keyin keladigan 1-3 xonali son + nuqta + (bo'sh joy yoki matn oxiri).
  masked = masked.replace(/(^|[\s([{\u2014\-])(\d{1,3})\.(?=\s|$)/g, (_, pre, num) => `${pre}${num}${PH}`);

  const isCloser = (ch) => ch !== undefined && _CLOSER_CHARS.indexOf(ch) !== -1;

  const rawParts = [];
  let start = 0;
  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === '.' || ch === '!' || ch === '?') {
      let j = i;
      // Ketma-ket tinish belgilari ("...", "?!") — bittasi sifatida qaraymiz.
      while (j + 1 < masked.length && '.!?'.includes(masked[j + 1])) j++;
      // Darhol ortidan keladigan yopiluvchi qo'shtirnoq/qavslarni ham shu
      // gapning o'ziga qo'shib olamiz — keyingi gapga emas.
      let k = j;
      while (isCloser(masked[k + 1])) k++;
      rawParts.push(masked.slice(start, k + 1));
      start = k + 1;
      i = k;
    }
  }
  if (start < masked.length) rawParts.push(masked.slice(start));

  const unmask = (s) => s.split(PH).join('.');
  const sentences = rawParts.map((s) => unmask(s).trim()).filter(Boolean);

  // Yolg'iz qolgan ro'yxat markerini ("1.") keyingi gapga birlashtiramiz —
  // shu bilan marker/effekt hech qachon yolg'iz raqamga yopishmaydi.
  const merged = [];
  for (let idx = 0; idx < sentences.length; idx++) {
    if (_LIST_MARKER_ONLY_RE.test(sentences[idx]) && idx + 1 < sentences.length) {
      sentences[idx + 1] = `${sentences[idx]} ${sentences[idx + 1]}`;
    } else {
      merged.push(sentences[idx]);
    }
  }
  return merged;
}

/** injectNaturalMarkers() yoki resolveNaturalTokens() ishga tushishidan OLDIN
 * chaqiriladigan xavfsizlik (safety-net) funksiyasi.
 *
 * MUAMMO: model ko'rsatmaga rioya qilmay, effekt-marker'ni ("[qisqa-nafas]",
 * "[pauza]", "[natural]" va h.k.) gap O'RTASIGA — so'zlar
 * orasiga — tashlab qo'yishi mumkin. Marker esa faqat GAP OXIRIDA (tinish
 * belgisidan keyin) bo'lishi kerak — aks holda splitByMarkers/TTS pipeline
 * bitta jumlani ikkiga bo'lib yuboradi va effekt so'z orasida "kesib"
 * eshitiladi.
 *
 * YECHIM: matnni marker'lardan tozalab, "toza" holida GAP'larga (. ! ?
 * bo'yicha — xuddi injectNaturalMarkers/splitIntoPlaybackChunks'dagi bilan
 * bir xil qoidada) bo'lamiz, so'ng har bir marker asl matnda qaysi gap
 * ichida uchragan bo'lsa, o'sha gapning OXIRIGA (tinish belgisidan keyin)
 * qo'yamiz. Bir gap ichida bir nechta marker bo'lsa — tartib saqlanadi.
 * Marker allaqachon to'g'ri joyda (gap oxirida) bo'lsa ham natija
 * o'zgarmaydi — funksiya idempotent.
 *
 * @param {string} text - injectNaturalMarkers/resolveNaturalTokens'ga
 *   yuborilishidan oldingi xom (raw) matn.
 * @returns {string} marker'lari gap oxiriga surilgan, tozalangan matn.
 */
export function sanitizeNaturalMarkers(text) {
  const raw = String(text || '');
  if (!raw.trim()) return raw.trim();

  _SANITIZE_MARKER_RE.lastIndex = 0;
  if (!_SANITIZE_MARKER_RE.test(raw)) return raw; // marker umuman yo'q — tegmaymiz
  _SANITIZE_MARKER_RE.lastIndex = 0;

  // 1-qadam: matnni "toza matn bo'laklari" va "marker'lar" ketma-ketligiga
  // ajratamiz, har bir marker o'zidan oldingi toza matnning umumiy
  // (kumulyativ) uzunligini "eslab qoladi" — shu orqali keyinchalik marker
  // qaysi gapga tegishli ekanini aniqlaymiz.
  const plainParts = [];
  const markers = []; // { marker: string, plainOffset: number }
  let lastIndex = 0;
  let plainLen = 0;
  let m;
  while ((m = _SANITIZE_MARKER_RE.exec(raw)) !== null) {
    const before = raw.slice(lastIndex, m.index);
    plainParts.push(before);
    plainLen += before.length;
    const normalized = m[0].replace(/\s+/g, '').toLowerCase();
    markers.push({ marker: normalized === '[natural]' ? '[natural]' : m[0], plainOffset: plainLen });
    lastIndex = _SANITIZE_MARKER_RE.lastIndex;
  }
  plainParts.push(raw.slice(lastIndex));
  const plain = plainParts.join('');

  if (!plain.trim()) {
    // Matnda faqat marker'lar bor, o'qiladigan gap yo'q — shunchaki
    // ularni ketma-ket qo'shib qaytaramiz (bo'linadigan joy yo'q).
    return markers.map(x => x.marker).join(' ');
  }

  // 2-qadam: toza matnni GAP'larga bo'lamiz — xavfsiz (yo'qotishsiz)
  // tokenizator bilan (raqamli ro'yxat va qo'shtirnoqlarda ham matn
  // yo'qolmaydi, splitIntoSentences'ga q.). Har bir gap uchun uning
  // ASL matn ("plain")dagi TUGASH pozitsiyasini (end) topamiz — bu
  // orqali keyingi qadamda marker'lar to'g'ri gapga bog'lanadi.
  const sentenceTexts = splitIntoSentences(plain);
  const sentences = [];
  let cursor = 0;
  for (const sText of sentenceTexts) {
    const idxInPlain = plain.indexOf(sText, cursor);
    const start = idxInPlain === -1 ? cursor : idxInPlain;
    const end = start + sText.length;
    sentences.push({ text: sText, start, end });
    cursor = end;
  }
  if (sentences.length === 0) sentences.push({ text: plain, start: 0, end: plain.length });

  // 3-qadam: har bir marker'ni, plainOffset'i tushib qolgan gapga bog'laymiz.
  const markersBySentence = sentences.map(() => []);
  for (const { marker, plainOffset } of markers) {
    let idx = sentences.findIndex(s => plainOffset <= s.end);
    if (idx === -1) idx = sentences.length - 1; // oxiridan keyin qolganlari — oxirgi gapga
    markersBySentence[idx].push(marker);
  }

  // 4-qadam: har bir gapni o'z tinish belgisidan KEYIN, unga tegishli
  // marker(lar) bilan birlashtirib, natijaviy matnni yig'amiz.
  const out = sentences
    .map((s, i) => {
      const sentenceText = s.text.trim();
      const attached = markersBySentence[i];
      if (!attached.length) return sentenceText;
      return `${sentenceText} ${attached.join(' ')}`.trim();
    })
    .filter(Boolean)
    .join(' ');

  return out.replace(/\s{2,}/g, ' ').trim();
}

/** Generic tabiiy-pauza tokeni — AI (voice mode) yoki heuristik matn ustida
 * ishlovchi injectNaturalMarkers() shu tokenni qo'yadi. Aniq qaysi tovush
 * effekti ekanini AI/heuristik o'zi hal qilmaydi — buni pastdagi
 * resolveNaturalTokens() markazlashtirilgan holda, matn konteksti va
 * xilma-xillik qoidasiga qarab hal qiladi. Bu bitta joyda ishlaydigan
 * mantiq bo'lgani uchun AI'ga (yoki heuristikaga) 4 ta marker orasidan
 * to'g'ri tanlov qilish majburiyati yuklanmaydi — shunchaki "shu yerda
 * tabiiy pauza kerak" deb belgilash kifoya, va bu ancha yuqori muvaffaqiyat
 * (compliance) bilan bajariladi. */
const NATURAL_TOKEN_RE = /\[\s*natural\s*\]/gi;

/** Matndagi har bir [natural] tokenini haqiqiy marker'ga ([qisqa-nafas.mp3]
 * yoki [pauza]) almashtiradi.
 *
 * QOIDA (soddalashtirilgan, v58 patch): tomoq-qirish, yo'tal, chuqur-nafas
 * va kulgi effektlari butunlay olib tashlandi (tinglovchini cho'chitgani,
 * kontekstsiz kulgani va hikoyaning tabiiyligini buzgani aniqlangan edi —
 * fikr-mulohaza asosida). Endi faqat ikkita, past profilli variant orasida
 * tanlanadi: 1) qisqa-nafas.mp3 — ENG KO'P ishlatiladigan, eshitiladigan
 * tabiiy nafas; 2) pauza — ovozsiz, shunchaki mantiqiy to'xtash (bir
 * qismdan ikkinchisiga o'tishda). Bir xil marker ketma-ket ikki marta
 * kelmasligi uchun nazorat qilinadi. */
export function resolveNaturalTokens(text) {
  const raw = String(text || '');
  if (!NATURAL_TOKEN_RE.test(raw)) return raw;
  NATURAL_TOKEN_RE.lastIndex = 0;

  let out = '';
  let lastIndex = 0;
  let lastMarker = null;
  let match;

  while ((match = NATURAL_TOKEN_RE.exec(raw)) !== null) {
    const before = raw.slice(lastIndex, match.index);
    out += before;

    let marker = Math.random() < 0.5 ? PAUSE_MARKER : 'qisqa-nafas.mp3';
    if (marker === lastMarker) {
      // ketma-ket takror bo'lmasin — muqobilga o'tamiz
      marker = marker === PAUSE_MARKER ? 'qisqa-nafas.mp3' : PAUSE_MARKER;
    }

    out += `[${marker}] `;
    lastMarker = marker;
    lastIndex = NATURAL_TOKEN_RE.lastIndex;
  }
  out += raw.slice(lastIndex);
  return out.replace(/\s{2,}/g, ' ').trim();
}

/** Oddiy MATN javoblar uchun — AI o'zi marker qo'ymagan (chunki voiceMode
 * so'ralmagan) holatda ham "MRgram AI"ning tabiiy tovushi (nafas, tomoq
 * qirish, kulgi va h.k.) chiqishi uchun — matn ustidan tashqi (heuristik)
 * "[natural]" pauza-tokenlarini joylashtiradi, so'ng ularni yuqoridagi
 * resolveNaturalTokens() orqali haqiqiy effekt-marker'ga aylantiradi.
 * Aniq qaysi tovush tanlanishi endi shu funksiya emas, resolveNaturalTokens()
 * zimmasida — shu bilan AI'ning voice-mode javobi bilan bir xil,
 * markazlashgan mantiq ishlaydi.
 *
 * MUHIM — bo'lish birligi SO'Z emas, GAP (jumla): marker faqat gap
 * tugagan joyga (. ! ?) qo'yiladi, har 1-2 gapdan keyin bittadan. Sabab:
 * splitByMarkers() → buildVoiceMessageAudioBlob() natijada har ikki marker
 * orasidagi BUTUN matn (bir nechta so'z ham, bir nechta gap ham bo'lsin)
 * — bittagina /api/tts so'roviga ("bitta full TTS") yuboriladi va bitta
 * yaxlit mp3 bo'lak sifatida qaytadi. Agar bo'lish so'z sonига qarab
 * qilinsa, bitta jumlaning o'zi ham bir nechta bo'lakka bo'linib, keraksiz
 * ko'p TTS so'rovi (sekinlik, ba'zilarining muvaffaqiyatsiz bo'lish xavfi)
 * yaratadi — aynan shu sabab oldin audio umuman qo'shilmay qolgan edi. */
export function injectNaturalMarkers(rawText) {
  const clean = stripMarkdownForSpeech(rawText);
  // Gapga bo'lib chiqamiz: tinish belgisi (. ! ?) undan keyingi bo'sh joy
  // bilan birga joriy gapning oxiriga qo'shiladi. Oxirgi gapda tinish
  // belgisi bo'lmasa ham ("$" bilan) alohida qamrab olinadi.
  const sentences = (clean.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) || [clean])
    .map(s => s.trim())
    .filter(Boolean);
  if (sentences.length <= 1) return clean;

  let out = '';
  let sinceMarker = 0;
  let gapTarget = 1 + Math.floor(Math.random() * 2); // 1-2 gapdan keyin bitta marker

  sentences.forEach((sentence, i) => {
    out += sentence + ' ';
    sinceMarker++;
    const isLast = i === sentences.length - 1;
    if (!isLast && sinceMarker >= gapTarget) {
      out += '[natural] ';
      sinceMarker = 0;
      gapTarget = 1 + Math.floor(Math.random() * 2);
    }
  });

  return resolveNaturalTokens(out.trim());
}

/* ── MP3 encoding (lamejs, CDN'dan dinamik yuklanadi) ─────────────────────
 * NEGA KERAK: avval bu yerda faqat WAV (siqilmagan PCM) eksport qilinardi.
 * WAV mp3'ga nisbatan ~6-10 baravar katta fayl beradi (masalan 10 soniyalik
 * ovozli xabar WAV'da ~1.7MB, mp3 64kbps'da ~80KB atrofida). Bu katta fayl
 * tez internetli/keshli qurilmada sezilmasdi, lekin sekinroq tarmoqda
 * pleer bosilgach fayl orqa fonda hali yuklanayotgani uchun 3-4 soniya
 * "qotib qolgandek" tuyular edi. Shu sabab endi natija MP3'ga siqiladi —
 * hajm keskin kichrayadi, network orqali yuklanish deyarli sezilmaydi.
 * lamejs UMD kutubxona bo'lgani uchun (ESM emas) `import()` bilan emas,
 * <script> tegini dinamik qo'shib, `window.lamejs` orqali ishlatiladi. */
let _lamejsLoadPromise = null;
function _loadLamejs() {
  if (window.lamejs) return Promise.resolve(window.lamejs);
  if (_lamejsLoadPromise) return _lamejsLoadPromise;
  _lamejsLoadPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js';
    s.onload = () => (window.lamejs ? resolve(window.lamejs) : reject(new Error('lamejs global topilmadi')));
    s.onerror = () => reject(new Error('lamejs CDN\'dan yuklanmadi'));
    document.head.appendChild(s);
  });
  return _lamejsLoadPromise;
}

/** Ko'p kanalli AudioBuffer'ni bitta mono Float32Array'ga tekislaydi (ovozli
 * xabar uchun stereo shart emas — mono ham xuddi shunday eshitiladi va
 * fayl hajmini yana ikki barobar kamaytiradi). */
function _downmixToMono(buffer) {
  const numChannels = buffer.numberOfChannels;
  if (numChannels === 1) return buffer.getChannelData(0);
  const out = new Float32Array(buffer.length);
  for (let ch = 0; ch < numChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < buffer.length; i++) out[i] += data[i] / numChannels;
  }
  return out;
}

/** AudioBuffer'ni MP3 Blob'ga aylantiradi (lamejs orqali, mono, 64kbps —
 * ovozli xabar/nutq uchun yetarli sifat). lamejs yuklanmasa yoki xato
 * chiqsa — `null` qaytaradi, chaqiruvchi kod WAV'ga zaxira sifatida
 * qaytishi kerak. */
async function audioBufferToMp3Blob(buffer) {
  const lamejs = await _loadLamejs();
  const sampleRate = buffer.sampleRate;
  const mono = _downmixToMono(buffer);

  // Float32 [-1,1] → Int16 PCM (lamejs shu formatni kutadi)
  const pcm = new Int16Array(mono.length);
  for (let i = 0; i < mono.length; i++) {
    const s = Math.max(-1, Math.min(1, mono[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  const encoder = new lamejs.Mp3Encoder(1, sampleRate, 64); // 1 kanal, 64kbps
  const blockSize = 1152; // lame frame hajmi
  const mp3Chunks = [];
  // MUHIM (freeze fix): bu loop har bir 1152-namunalik bo'lakni real DSP
  // bilan kodlaydi — bu CPU'ga og'ir amal. Uzunroq AI ovozli xabarlarda
  // (masalan 20-30s) bloklar soni minglab bo'lib, `await` bo'lmagan sof
  // sinxron for-loop butun main thread'ni band qilib qo'yardi — natijada
  // brauzer hech narsani qayta chizolmay (repaint/eventlarga javob
  // berolmay), butun ilova "qotib qolganday" ko'rinardi. Har necha
  // bo'lakdan keyin bitta mikrotask/pauza bilan navbatni bo'shatib
  // (event loop'ga qaytarib) beramiz — bu kodlashni sekinlashtirmaydi
  // (jami CPU vaqti bir xil), faqat brauzerga orada nafas olishga
  // imkon beradi.
  const YIELD_EVERY = 40; // ≈40 bo'lakdan keyin bir marta pauza
  let blockCount = 0;
  for (let i = 0; i < pcm.length; i += blockSize) {
    const chunk = pcm.subarray(i, i + blockSize);
    const enc = encoder.encodeBuffer(chunk);
    if (enc.length > 0) mp3Chunks.push(enc);
    blockCount++;
    if (blockCount % YIELD_EVERY === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  const end = encoder.flush();
  if (end.length > 0) mp3Chunks.push(end);

  return new Blob(mp3Chunks, { type: 'audio/mpeg' });
}

/** Bitta AudioBuffer'ni (Web Audio API) 16-bit PCM WAV Blob'ga aylantiradi
 * — hech qanday tashqi kutubxona shart emas, brauzerning o'zida yetarli.
 * Faqat MP3 kodlashning (yuqoridagi) zaxira (fallback) varianti sifatida
 * ishlatiladi — CDN'dan lamejs yuklanmasa ham foydalanuvchi ovozsiz
 * qolmasin deb. */
function audioBufferToWavBlob(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const dataLength = buffer.length * numChannels * 2;
  const totalLength = 44 + dataLength;
  const arr = new ArrayBuffer(totalLength);
  const view = new DataView(arr);

  const writeString = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };

  writeString(0, 'RIFF');
  view.setUint32(4, totalLength - 8, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  const channels = [];
  for (let ch = 0; ch < numChannels; ch++) channels.push(buffer.getChannelData(ch));

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([arr], { type: 'audio/wav' });
}

/**
 * `playVoiceMessageWithEffects()`dan farqi: ovozni brauzerda to'g'ridan-
 * to'g'ri ijro etish o'rniga, marker (effekt) va TTS bo'laklarining
 * BARCHASINI bitta yagona, DOIMIY saqlanadigan audio faylga (WAV Blob)
 * "quyib" (stitch qilib) beradi — shu fayl keyin Firestore xabariga
 * mediaUrl sifatida biriktiriladi. Shu tufayli foydalanuvchi xabarni
 * keyinroq (yoki chat yopiq bo'lganda kelgan xabarni) qayta tinglaganda
 * ham HAQIQIY tovush effektlari eshitiladi — faqat "jonli" ijroda emas.
 *
 * Ishlash tartibi: 1) har bir bo'lak uchun xom audio baytlarini (mahalliy
 * mp3 yoki TTS natijasi) yig'ib olamiz; 2) bittasi AudioContext orqali
 * decode qilamiz (bu barcha bo'laklarni bitta umumiy sample rate'ga
 * avtomatik moslashtiradi); 3) OfflineAudioContext'da ketma-ket, har biriga
 * mos volume bilan render qilamiz; 4) natijani WAV Blob'ga aylantiramiz.
 *
 * @param {string} text — marker'li (yoki markersiz) to'liq matn
 * @param {{voice?:'male'|'female', onProgress?:(percent:number, done?:number, total?:number)=>void}} [opts]
 *   `onProgress` — HAQIQIY (soxta emas) foiz bilan chaqiriladi: 0 (boshlanishda)
 *   → 85 (barcha TTS/effekt bo'laklari yuklab olingach, bo'lak-bo'lak oshib
 *   boradi) → 90 (decode) → 97 (render) → 100 (kodlash tugagach).
 * @returns {Promise<{blob:Blob, duration:number}|null>} — muvaffaqiyatsiz
 *   bo'lsa (masalan hech bir bo'lak decode qilinmasa) `null`.
 */
export async function buildVoiceMessageAudioBlob(text, opts = {}) {
  const gender = opts.voice === 'female' ? 'female' : (opts.voice === 'male' ? 'male' : getAiVoiceGender());
  // MUHIM (Vercel Hobby limiti): oldin bu yerda faqat splitByMarkers()
  // ishlatilardi — bu marker'lar orasidagi matnni BUTUN holda (bir nechta
  // jumla birga) bitta /api/tts so'roviga yuborardi. Server esa shu katta
  // matnni o'z ichida yana mayda bo'laklarga bo'lib, ularni KETMA-KET
  // (Edge TTS WebSocket orqali, bittasi tugagach ikkinchisi) sintez qiladi.
  // Uzunroq AI javobida bu 10 soniyadan (Vercel Hobby tarifining haqiqiy,
  // qattiq chegarasi — vercel.json'dagi maxDuration:60 faqat Pro'da
  // ishlaydi) oshib ketib, funksiya majburan o'chiriladi va brauzerda
  // "TypeError: Failed to fetch" ko'rinadi (ulanish javobsiz uziladi).
  // Shu sabab endi splitIntoPlaybackChunks() ishlatiladi — u matnni JUMLA
  // darajasida mayda bo'laklarga bo'ladi, shunda HAR BIR /api/tts so'rovi
  // bitta qisqa jumlani sintez qiladi (odatda 1-3 soniya) va pastdagi
  // Promise.all barchasini PARALLEL yuboradi — umumiy vaqt emas, ENG UZUN
  // BITTA jumlaning vaqti muhim bo'lib qoladi, shu bilan 10s chegarasidan
  // xavfsiz uzoqda qolamiz.
  const parts = splitIntoPlaybackChunks(text);
  if (!parts.length) return null;

  // HAQIQIY % progress: onProgress berilgan bo'lsa, uni chaqiramiz.
  // Soxta/тахминий emas — bosqichlar HAQIQIY ish hajmiga qarab
  // vazn (weight) olgan: 1) TTS/effekt bo'laklarini yuklab olish —
  // eng uzun bosqich, shuning uchun umumiy progressning 0→85% qismini
  // egallaydi va HAR BIR bo'lak tayyor bo'lgach real vaqtda oshadi
  // (parallel bajarilsa ham, tugagan bo'laklar soni/umumiy son nisbati
  // aniq foizni beradi); 2) decode qilish — 85→95%; 3) render+encode —
  // 95→100%. `total` — barcha bo'laklar soni (TTS jumlalari + effekt
  // fayllari), `done` — hozircha tugallangan bo'laklar soni.
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
  const total = parts.length;
  let doneCount = 0;
  const _reportFetchProgress = () => {
    if (!onProgress) return;
    doneCount += 1;
    const pct = Math.min(85, Math.round((doneCount / total) * 85));
    try { onProgress(pct, doneCount, total); } catch (_) { /* jim */ }
  };
  if (onProgress) { try { onProgress(0, 0, total); } catch (_) { /* jim */ } }

  // 1-bosqich: xom baytlarni yig'ish (hali decode qilinmagan).
  // MUHIM (tezlik): bu yerda ketma-ket (sequential) emas, PARALLEL
  // so'rov yuboriladi — uzun matnlarda (masalan bir necha paragraflik
  // hikoya) har bir TTS bo'lagi alohida tarmoq so'rovi bo'lgani uchun
  // ketma-ket bajarish o'nlab soniya olib ketishi mumkin edi, natijada
  // xabar "ko'rinmasdan qolganday" tuyular edi (aslida hali orqa fonda
  // tayyorlanayotgan bo'lardi). Promise.all bo'laklarni bir vaqtda
  // so'raydi, lekin natija massivi baribir ASL TARTIBNI saqlaydi — shu
  // sabab keyingi decode/render bosqichlari o'zgarishsiz qoladi.
  const rawResults = await Promise.all(parts.map(async (part) => {
    try {
      if (part && typeof part === 'object' && part.file === PAUSE_MARKER) {
        // [pauza] — audio fayl yo'q, tarmoq so'rovi shart emas. Keyingi
        // (decode) bosqichda buni sentinel {silence:true} sifatida tanib,
        // to'g'ridan-to'g'ri jim AudioBuffer yasab qo'yamiz.
        return { silence: true, volume: TTS_VOLUME, isEffect: false };
      }
      if (part && typeof part === 'object' && part.file) {
        try {
          // cache: 'no-store' — bu statik effekt fayllar boshqa joyda
          // (masalan <audio> elementi orqali Range so'rov bilan) allaqachon
          // qisman keshlanган bo'lishi mumkin; har safar to'liq nusxani
          // yangidan olib, "Unable to decode audio data" xatosiga sabab
          // bo'ladigan qisman/buzuq buferlarning oldini olamiz.
          const res = await fetch(effectUrl(gender, part.file), { cache: 'no-store' });
          if (!res.ok) return null;
          const arrBuf = await res.arrayBuffer();
          if (!arrBuf || arrBuf.byteLength === 0) return null;
          return { arrBuf, volume: EFFECT_VOLUME[part.file] ?? TTS_VOLUME, isEffect: true };
        } catch (err) {
          console.warn('[voice-fx] effekt fayl olinmadi, o\'tkazib yuborildi:', err?.message || err);
          return null;
        }
      }
      const chunkText = String(part).trim();
      if (!chunkText) return null;
      try {
        const blob = await _fetchTtsBlob(chunkText, gender);
        if (!blob || blob.size === 0) return null;
        const arrBuf = await blob.arrayBuffer();
        if (!arrBuf || arrBuf.byteLength === 0) return null;
        return { arrBuf, volume: TTS_VOLUME, isEffect: false };
      } catch (err) {
        console.warn('[voice-fx] TTS bo\'lagi olinmadi, o\'tkazib yuborildi:', err?.message || err);
        return null;
      }
    } finally {
      // MUHIM: finally'da chaqiriladi — bo'lak muvaffaqiyatli ham,
      // muvaffaqiyatsiz ham bo'lsa, u baribir "tugallangan" hisoblanadi
      // (aks holda progress hech qachon 85%'ga yetmay qolishi mumkin edi).
      _reportFetchProgress();
    }
  }));
  const rawSegments = rawResults.filter(Boolean);
  if (!rawSegments.length) return null;

  // 2-bosqich: barchasini bitta AudioContext bilan decode qilamiz — bu
  // turli fayllarni (mp3 effekt / TTS chiqishi) avtomatik umumiy sample
  // rate'ga keltiradi, keyingi qadamda ularni to'g'ridan-to'g'ri ketma-ket
  // qo'yish mumkin bo'lishi uchun.
  const AudioCtxCls = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtxCls) return null; // brauzer qo'llab-quvvatlamaydi
  const decodeCtx = new AudioCtxCls();
  const decoded = [];
  try {
    for (const seg of rawSegments) {
      if (seg.silence) {
        // [pauza] — hech narsani decode qilmasdan, to'g'ridan-to'g'ri qisqa
        // jim (barcha sample'lari 0) AudioBuffer yasaymiz.
        const sr = decodeCtx.sampleRate;
        const silentBuf = decodeCtx.createBuffer(1, Math.round(sr * PAUSE_SILENCE_SEC), sr);
        decoded.push({ buffer: silentBuf, volume: seg.volume, isEffect: false });
        continue;
      }
      if (!seg.arrBuf || seg.arrBuf.byteLength === 0) continue;
      try {
        const buf = await decodeCtx.decodeAudioData(seg.arrBuf.slice(0));
        decoded.push({ buffer: buf, volume: seg.volume, isEffect: !!seg.isEffect });
      } catch (err) {
        console.warn('[voice-fx] decode xatosi, bo\'lak o\'tkazib yuborildi:', err?.message || err);
      }
    }
  } finally {
    decodeCtx.close?.();
  }
  if (!decoded.length) return null;
  if (onProgress) { try { onProgress(90); } catch (_) { /* jim */ } }

  // 3-bosqich: OfflineAudioContext'da render — endi ENDI SODDA ketma-ket
  // qo'yish emas, balki [qisqa-nafas.mp3] effektlarini qo'shni bo'laklar
  // ustiga (fade in/fade out bilan) "botirib" chiqaradigan CROSSFADE
  // jadvali bo'yicha (_planSegmentTiming/_applyGainEnvelope'ga qarang,
  // yuqorida). Avval to'liq jadval (har bir bo'lakning aniq start/end
  // vaqti) hisoblanadi — buning sababi: OfflineAudioContext umumiy
  // uzunligini (`totalLength`) OLDINDAN, kontekst yaratilishidan oldin
  // bilish shart, endi esa overlap tufayli bu oddiy yig'indi emas.
  const OfflineCtxCls = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OfflineCtxCls) return null;
  const sampleRate = decoded[0].buffer.sampleRate;
  const numChannels = Math.max(1, ...decoded.map(d => d.buffer.numberOfChannels));

  let planCursor = 0;
  const scheduled = decoded.map(({ buffer, volume, isEffect }) => {
    const { start, end, nextCursor } = _planSegmentTiming(planCursor, 0, buffer.duration, isEffect);
    planCursor = nextCursor;
    return { buffer, volume, isEffect, start, end };
  });
  const totalDuration = scheduled.reduce((max, s) => Math.max(max, s.end), 0);
  const totalLength = Math.max(1, Math.ceil(totalDuration * sampleRate));

  const offlineCtx = new OfflineCtxCls(numChannels, totalLength, sampleRate);
  const bus = _createLimiterBus(offlineCtx); // overlap paytida clipping bo'lmasligi uchun
  scheduled.forEach(({ buffer, volume, isEffect, start, end }) => {
    const src = offlineCtx.createBufferSource();
    src.buffer = buffer;
    const gainNode = offlineCtx.createGain();
    _applyGainEnvelope(gainNode, start, end, volume, isEffect);
    src.connect(gainNode).connect(bus);
    src.start(start);
  });

  const rendered = await offlineCtx.startRendering();
  if (onProgress) { try { onProgress(97); } catch (_) { /* jim */ } }

  // Avval MP3'ga siqishga urinamiz (fayl hajmi ~6-10x kichikroq — sekin
  // tarmoqda ijro paytidagi "qotib qolish"ning asosiy sababi shu edi).
  // lamejs CDN'dan yuklanmasa (masalan offlayn/tarmoq bloklangan) —
  // WAV'ga muammosiz qaytamiz, foydalanuvchi baribir ovozsiz qolmaydi.
  try {
    const blob = await audioBufferToMp3Blob(rendered);
    if (onProgress) { try { onProgress(100); } catch (_) { /* jim */ } }
    return { blob, duration: rendered.duration || 0, ext: 'mp3', mimeType: 'audio/mpeg' };
  } catch (err) {
    console.warn('[voice-fx] MP3 kodlash muvaffaqiyatsiz, WAV\'ga qaytildi:', err?.message || err);
    const blob = audioBufferToWavBlob(rendered);
    if (onProgress) { try { onProgress(100); } catch (_) { /* jim */ } }
    return { blob, duration: rendered.duration || 0, ext: 'wav', mimeType: 'audio/wav' };
  }
}

/** Berilgan jinsga qarama-qarshi (muqobil) jinsni qaytaradi. */
function _otherGender(gender) {
  return gender === 'female' ? 'male' : 'female';
}

/**
 * Ikkala ovoz (Sardor/erkak va Madina/ayol) uchun ham doimiy saqlanadigan
 * audio yasaydi — LEKIN foydalanuvchini ikkalasi bir vaqtda tayyor
 * bo'lguncha KUTIB QOLDIRMAYDI:
 *
 *   1) Foydalanuvchi sozlamalarda hozir tanlagan (`primaryGender`) ovoz
 *      BIRINCHI navbatda, to'liq tayyor bo'lguncha kutib (await) yasaladi
 *      va shu funksiya shuni qaytargach chaqiruvchi kod DARHOL xabarni
 *      ko'rsatishi/saqlashi mumkin.
 *   2) Faqat ASOSIY ovoz to'liq tugagandan KEYIN — muqobil (ikkinchi)
 *      ovoz FON REJIMIDA (await qilinmasdan) alohida yasala boshlaydi.
 *      Bu ataylab ASOSIY ovoz bilan bir vaqtda emas, ketma-ket qilingan:
 *      aks holda ikkala TTS/audio-render bir vaqtda tarmoq va CPU
 *      resursini bo'lishib, ASOSIY (foydalanuvchi darhol eshitishi
 *      kerak bo'lgan) ovozni ham sekinlashtirib qo'yardi.
 *   3) Muqobil ovoz tayyor (yoki muvaffaqiyatsiz) bo'lganda
 *      `opts.onSecondaryReady(result, secondaryGender)` chaqiriladi —
 *      chaqiruvchi kod shu yerda uni Storage'ga yuklab, Firestore
 *      hujjatiga qo'shimcha maydon sifatida yozib qo'yishi mumkin.
 *
 * @param {string} text
 * @param {{primaryGender:'male'|'female', onSecondaryReady?:(result:{blob:Blob,duration:number,ext:string,mimeType:string}|null, secondaryGender:'male'|'female')=>void, onProgress?:(percent:number, done?:number, total?:number)=>void}} opts
 *   `onProgress` — faqat ASOSIY (primary, foydalanuvchi kutayotgan) ovoz
 *   uchun HAQIQIY % progress bilan chaqiriladi (muqobil/fon ovozi uchun
 *   emas — u foydalanuvchiga umuman ko'rinmaydi).
 * @returns {Promise<{primary:{blob:Blob,duration:number,ext:string,mimeType:string}|null, primaryGender:'male'|'female', secondaryGender:'male'|'female'}>}
 */
export async function buildVoiceMessageBothGenders(text, opts = {}) {
  const primaryGender = opts.primaryGender === 'female' ? 'female' : 'male';
  const secondaryGender = _otherGender(primaryGender);

  const primary = await buildVoiceMessageAudioBlob(text, { voice: primaryGender, onProgress: opts.onProgress });

  if (typeof opts.onSecondaryReady === 'function') {
    // MUHIM: bu yerda awaitLANMAYDI — asosiy ovoz allaqachon qaytarilgan,
    // muqobil ovoz butunlay orqa fonda, chaqiruvchiga sezilmasdan tayyorlanadi.
    buildVoiceMessageAudioBlob(text, { voice: secondaryGender })
      .then(res => opts.onSecondaryReady(res, secondaryGender))
      .catch(err => {
        console.warn('[voice-fx] fon rejimidagi muqobil ovoz xatosi:', err?.message || err);
        opts.onSecondaryReady(null, secondaryGender);
      });
  }

  return { primary, primaryGender, secondaryGender };
}

/** ESKI (v58'gacha bo'lgan) ijro usuli — bitta qayta ishlatiladigan
 * <audio> elementida, har bir bo'lakni TO'LIQ ketma-ket ('onended'dan
 * keyin keyingisi) ijro etadi. Endi FAQAT fallback sifatida saqlanadi —
 * brauzerda Web Audio API (`AudioContext`) umuman mavjud bo'lmagan juda
 * kam uchraydigan holatlar uchun (aks holda crossfade/fade-in-fade-out
 * mumkin emas, chunki alohida bo'laklarni ustma-ust chiqarish uchun
 * kamida Web Audio API kerak — oddiy <audio> elementi buni qila
 * olmaydi). */
async function _playSequentialFallback(parts, gender) {
  const audioEl = new Audio();
  let lastBlobUrl = null;

  async function resolvePart(part) {
    if (part && typeof part === 'object' && part.file === PAUSE_MARKER) {
      return { silent: true };
    }
    if (part && typeof part === 'object' && part.file) {
      return { src: effectUrl(gender, part.file), volume: EFFECT_VOLUME[part.file] ?? TTS_VOLUME, isBlob: false };
    }
    const chunkText = String(part).trim();
    if (!chunkText) return null;
    try {
      const blob = await _fetchTtsBlob(chunkText, gender);
      if (!blob) return null;
      return { src: URL.createObjectURL(blob), volume: TTS_VOLUME, isBlob: true };
    } catch (err) {
      console.warn('[voice-fx] TTS bo\'lagi olinmadi, o\'tkazib yuborildi:', err?.message || err);
      return null;
    }
  }

  try {
    let nextPromise = resolvePart(parts[0]);
    for (let i = 0; i < parts.length; i++) {
      const resolved = await nextPromise;
      if (i + 1 < parts.length) nextPromise = resolvePart(parts[i + 1]);
      if (!resolved) continue;

      if (resolved.silent) {
        await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
        continue;
      }

      if (resolved.isBlob) {
        if (lastBlobUrl) { URL.revokeObjectURL(lastBlobUrl); lastBlobUrl = null; }
        lastBlobUrl = resolved.src;
      }
      try {
        await playQueueItem(audioEl, resolved.src, resolved.volume);
      } catch (err) {
        console.warn('[voice-fx] bo\'lak o\'tkazib yuborildi:', err?.message || err);
      }
    }
  } finally {
    if (lastBlobUrl) URL.revokeObjectURL(lastBlobUrl);
    audioEl.onended = null;
    audioEl.onerror = null;
  }
}

/**
 * AI javob matnini — ichidagi effekt-marker'lari ([qisqa-nafas.mp3],
 * [pauza]) va oddiy matn (TTS) bo'laklarini — brauzerda to'g'ridan-to'g'ri
 * ijro etadi.
 *
 * MUHIM (v59 patch — fikr-mulohaza asosida): oldin har bir bo'lak
 * TO'LIQ ketma-ket ijro etilardi (TTS to'xtaydi → effekt boshlanadi →
 * effekt tugaydi → yana TTS), bu "to'xtab-yugurib" eshitilardi. Endi
 * bitta umumiy AudioContext'da HAMMA bo'lak oldindan hal qilinib
 * (fetch+decode), aniq REJALASHTIRILGAN vaqtlarda ijro etiladi:
 * [qisqa-nafas.mp3] endi oldingi bo'lak hali tugamasdanoq FADE IN bilan
 * "kirib keladi" va keyingi bo'lak boshlanishidan sal oldin FADE OUT
 * bilan "chiqib ketadi" — natijada effekt hech qachon TTS'ni to'liq
 * to'xtatmaydi, ikkalasi bir necha o'ndan bir soniya davomida bir-birining
 * ustida eshitiladi (_planSegmentTiming/_applyGainEnvelope'ga qarang,
 * yuqorida — bu aynan buildVoiceMessageAudioBlob() offline render'da
 * ishlatilgan mantiq bilan bir xil, shu bilan "jonli" va "saqlanadigan"
 * versiyalar bir xil eshitiladi). [pauza] esa hamon oddiy, bo'shliqsiz jim
 * bo'lak — u ustiga chiqariladigan tovushi yo'q, shu sabab overlap/fade
 * unga tegishli emas.
 *
 * PIPELINE o'zgarishsiz qoladi: navbatdagi bo'lak, joriy bo'lak
 * tayyorlanayotgan/ijro etilayotgan PAYTDA fon rejimida oldindan
 * so'ralib/decode qilinadi — foydalanuvchi hech qachon "keyingi bo'lak
 * tayyor bo'lguncha" kutib turmaydi.
 *
 * @param {string} text — AI javobining to'liq matni (marker'lari bilan)
 * @param {{voice?: 'male'|'female'}} [opts] — ovoz jinsi berilmasa,
 *   foydalanuvchi tanlagan (yoki standart) ovoz ishlatiladi.
 * @returns {Promise<void>} — butun navbat (oxirgi bo'lak tovushi ham
 *   tugagach) "resolve" bo'ladi.
 */
export async function playVoiceMessageWithEffects(text, opts = {}) {
  const gender = opts.voice === 'female' ? 'female' : (opts.voice === 'male' ? 'male' : getAiVoiceGender());
  const parts = splitIntoPlaybackChunks(text);
  if (!parts.length) return;

  const AudioCtxCls = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtxCls) {
    // Juda kam uchraydigan holat — brauzer Web Audio API'ni qo'llab-
    // quvvatlamaydi. Crossfade imkonsiz, eski ketma-ket usulga qaytamiz.
    return _playSequentialFallback(parts, gender);
  }

  const ctx = new AudioCtxCls();
  const bus = _createLimiterBus(ctx); // overlap paytida clipping bo'lmasligi uchun
  const LOOKAHEAD_SEC = 0.25; // birinchi bo'lak ijrosi boshlanguncha zaxira
  let cursor = ctx.currentTime + LOOKAHEAD_SEC;
  let lastEnd = cursor;
  const activeSources = [];

  /** Bitta bo'lakni AudioBuffer'ga hal qiladi: [pauza] → jim buffer
   * (tarmoq so'rovisiz), effekt marker → statik mp3 fetch+decode, oddiy
   * matn → /api/tts orqali TTS fetch+decode. Xato bo'lsa `null` —
   * navbat qotib qolmasin deb shu bo'lak jimgina o'tkazib yuboriladi. */
  async function resolvePart(part) {
    try {
      if (part && typeof part === 'object' && part.file === PAUSE_MARKER) {
        const sr = ctx.sampleRate;
        const buffer = ctx.createBuffer(1, Math.round(sr * PAUSE_SILENCE_SEC), sr);
        return { buffer, volume: TTS_VOLUME, isEffect: false };
      }
      if (part && typeof part === 'object' && part.file) {
        const res = await fetch(effectUrl(gender, part.file), { cache: 'no-store' });
        if (!res.ok) return null;
        const arrBuf = await res.arrayBuffer();
        if (!arrBuf || arrBuf.byteLength === 0) return null;
        const buffer = await ctx.decodeAudioData(arrBuf.slice(0));
        return { buffer, volume: EFFECT_VOLUME[part.file] ?? TTS_VOLUME, isEffect: true };
      }
      const chunkText = String(part).trim();
      if (!chunkText) return null;
      const blob = await _fetchTtsBlob(chunkText, gender);
      if (!blob) return null;
      const arrBuf = await blob.arrayBuffer();
      if (!arrBuf || arrBuf.byteLength === 0) return null;
      const buffer = await ctx.decodeAudioData(arrBuf.slice(0));
      return { buffer, volume: TTS_VOLUME, isEffect: false };
    } catch (err) {
      console.warn('[voice-fx] bo\'lak tayyorlanmadi, o\'tkazib yuborildi:', err?.message || err);
      return null;
    }
  }

  /** Hal qilingan (decode qilingan) bitta bo'lakni AudioContext navbatiga
   * REJALASHTIRADI (o'zi await qilmaydi — start() darhol qaytadi,
   * haqiqiy ijro fon rejimida davom etadi). `cursor`ni yangilaydi. */
  function scheduleResolved({ buffer, volume, isEffect }) {
    const { start, end, nextCursor } = _planSegmentTiming(cursor, ctx.currentTime, buffer.duration, isEffect);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gainNode = ctx.createGain();
    _applyGainEnvelope(gainNode, start, end, volume, isEffect);
    src.connect(gainNode).connect(bus);
    src.start(start);
    activeSources.push(src);
    cursor = nextCursor;
    lastEnd = Math.max(lastEnd, end);
  }

  try {
    // PIPELINE: navbatdagi bo'lak, joriy bo'lak hal qilinayotgan/
    // rejalashtirilayotgan PAYTDA fon rejimida oldindan so'ralib/decode
    // qilinadi — bo'laklar tartibi o'zgarishsiz, faqat tayyorlash bosqichi
    // oldindan bajariladi.
    let nextPromise = resolvePart(parts[0]);
    for (let i = 0; i < parts.length; i++) {
      const resolved = await nextPromise;
      if (i + 1 < parts.length) nextPromise = resolvePart(parts[i + 1]);
      if (!resolved) continue;
      scheduleResolved(resolved);
    }
    // Barcha bo'laklar rejalashtirilgach, ENG OXIRGI tovush ham haqiqatda
    // tugaguncha kutamiz (aks holda funksiya audio hali eshitilib
    // turganida ham "tugadi" deb qaytib ketardi).
    const waitMs = Math.max(0, (lastEnd - ctx.currentTime) * 1000);
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  } finally {
    activeSources.forEach((src) => { try { src.stop(); } catch (_) { /* jim */ } });
    try { ctx.close(); } catch (_) { /* jim */ }
  }
}

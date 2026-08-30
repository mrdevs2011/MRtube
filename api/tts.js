/**
 * POST /api/tts
 * O'zbekcha matnni ovozga aylantirish (TTS) uchun xavfsiz server-side
 * proksi. Model: Microsoft Edge "Ovozli o'qish" (Read Aloud) xizmati —
 * norasmiy, lekin bepul, kalitsiz va ro'yxatdan o'tishsiz ishlaydi.
 *
 *   uz-UZ-SardorNeural  — erkak ovoz (standart)
 *   uz-UZ-MadinaNeural  — ayol ovoz
 *
 * NEGA HF MMS-TTS EMAS: Edge TTS o'zbek tilini LOTIN yozuvida to'g'ridan-
 * to'g'ri qabul qiladi — shu sababli avvalgi latinToCyrillic() konvertatsiyasi
 * va Hugging Face API kaliti (hfkey) endi kerak emas.
 *
 * DIQQAT: bu xizmat norasmiy (Microsoft Edge brauzerining ichki API'siga
 * asoslangan) — rasmiy SLA/kafolat yo'q, lekin amalda barqaror ishlaydi.
 * Agar Microsoft o'z tarafida narsani o'zgartirsa, bu endpoint vaqtincha
 * ishlamay qolishi mumkin.
 *
 * Auth: Authorization: Bearer <Firebase ID Token>.
 * Body (JSON): { text: string, voice?: 'male' | 'female' }
 * Javob: audio/mpeg (mp3 bayt) — muvaffaqiyatli bo'lsa.
 *        Xato bo'lsa: JSON { error: string }.
 */
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { requireApprovedUser } from './_require-approved.js';
import { checkRateLimit } from './_rate-limit.js';

// Bitta Edge TTS so'rovi juda uzun matnda beqaror ishlashi mumkin, shu sabab
// matn MAX_CHUNK_CHARS dan oshmaydigan bo'laklarga bo'linadi (gap chegaralari
// bo'yicha) va HAR BIR bo'lak alohida sintez qilinib, natijalar bitta uzluksiz
// audio oqimiga ketma-ket yoziladi. MAX_TOTAL_CHARS esa butun so'rov uchun
// yuqori chegara — juda uzun (masalan kitob hajmidagi) matnlarni kesib,
// funksiya vaqt tugashi (timeout)dan saqlaydi.
// Vercel Hobby tarifida serverless funksiya haqiqiy chegarasi 10 soniya
// (vercel.json'dagi maxDuration:60 faqat Pro'da ishlaydi). Bitta juda uzun
// jumla (tinish belgisisiz uzun matn) server ichida ketma-ket bir necha
// bo'lakka bo'linib sintez qilinganda ham 10s'dan xavfsiz uzoqda qolishi
// uchun chegara pasaytirildi (600 → 350).
const MAX_CHUNK_CHARS = 350;
const MAX_TOTAL_CHARS = 8000; // ~4-5 daqiqalik nutqqa yetadi

const VOICES = {
  male: 'uz-UZ-SardorNeural',
  female: 'uz-UZ-MadinaNeural',
};

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
  return m ? m[1] : null;
}

/* ── Matnni ovoz modeliga yuborishdan oldin tozalash ──────────────────────
 * Markdown belgilarini (**qalin**, `kod`, # sarlavha va h.k.) olib tashlaymiz
 * — aks holda model belgilarni ham "o'qib" tashlashga urinadi. */
function stripMarkdown(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')       // kod bloklari
    .replace(/`([^`]+)`/g, '$1')            // inline kod
    .replace(/\*\*([^*]+)\*\*/g, '$1')      // qalin
    .replace(/\*([^*]+)\*/g, '$1')          // kursiv
    .replace(/^#{1,6}\s+/gm, '')            // sarlavhalar
    .replace(/^[-*]\s+/gm, '')              // ro'yxat belgilari
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')// linklar
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/* ── Raqamlarni va o'lchov birliklarini TTS uchun so'zga aylantirish ──────
 * Edge TTS "0,5 ml", "180°C", "20%" kabi raqam+birlik kombinatsiyalarini
 * yoki kasr sonlarni ba'zan noto'g'ri o'qiydi yoki umuman yutib yuboradi.
 * Shu sabab bunday joylarni sintezga yuborishdan OLDIN toza o'zbekcha
 * so'zlarga aylantiramiz. Butun (kasrsiz, birliksiz) sonlar Edge TTS'da
 * odatda muammosiz o'qiladi, shu sabab ularga tegilmaydi — faqat kasr
 * sonlar, gradus/foiz va birlik bilan kelgan sonlar konvertatsiya qilinadi. */

const ONES_UZ = ['', 'bir', 'ikki', 'uch', "to'rt", 'besh', 'olti', 'yetti', 'sakkiz', "to'qqiz"];
const DIGIT_WORDS_UZ = ['nol', 'bir', 'ikki', 'uch', "to'rt", 'besh', 'olti', 'yetti', 'sakkiz', "to'qqiz"];
const TENS_UZ = ['', "o'n", 'yigirma', "o'ttiz", 'qirq', 'ellik', 'oltmish', 'yetmish', 'sakson', "to'qson"];
const SCALES_UZ = ['', 'ming', 'million', 'milliard', 'trillion'];

// 0-999 oralig'idagi butun sonni so'zga aylantiradi (masalan 725 -> "yetti yuz yigirma besh")
function convertUnder1000Uz(n) {
  const parts = [];
  const h = Math.floor(n / 100);
  const rem = n % 100;
  if (h > 0) parts.push((h > 1 ? ONES_UZ[h] + ' ' : '') + 'yuz');
  const t = Math.floor(rem / 10);
  const o = rem % 10;
  if (t > 0) parts.push(TENS_UZ[t]);
  if (o > 0) parts.push(ONES_UZ[o]);
  return parts.join(' ');
}

// Ixtiyoriy butun sonni (manfiy bo'lishi ham mumkin) to'liq o'zbekcha so'zga aylantiradi
function numberToWordsUz(num) {
  let n = Math.trunc(num);
  if (n === 0) return 'nol';
  const negative = n < 0;
  n = Math.abs(n);

  const groups = [];
  while (n > 0) {
    groups.push(n % 1000);
    n = Math.floor(n / 1000);
  }

  const words = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (g === 0) continue;
    const groupWords = convertUnder1000Uz(g);
    words.push(SCALES_UZ[i] ? `${groupWords} ${SCALES_UZ[i]}` : groupWords);
  }
  const result = words.join(' ');
  return negative ? `minus ${result}` : result;
}

// Kasr sonni ("0,5" / "12.75" / "-3,14") so'zga aylantiradi. Butun qism
// to'liq songa, kasr qismi esa RAQAMMA-RAQAM o'qiladi (masalan "0,05" ->
// "nol vergul nol besh" — agar kasr qismi ham to'liq son sifatida
// o'qilsa, "0,05" bilan "0,5" farqi yo'qolib, xato talaffuz chiqadi).
function numberToWordsDecimalUz(numStr) {
  const negative = numStr.trim().startsWith('-');
  const clean = numStr.replace(/^-/, '');
  const [intPartRaw, fracPartRaw] = clean.split(/[.,]/);
  const intPart = intPartRaw === '' ? '0' : intPartRaw;
  const intWords = numberToWordsUz(parseInt(intPart, 10));
  const fracWords = fracPartRaw
    ? fracPartRaw.split('').map((d) => DIGIT_WORDS_UZ[+d] || '').join(' ')
    : '';
  const base = fracWords ? `${intWords} vergul ${fracWords}` : intWords;
  return negative ? `minus ${base}` : base;
}

// Berilgan raqam matnini ("125" yoki "0,5") mos so'zlarga aylantiradi
function wordifyNumberUz(numStr) {
  if (/[.,]/.test(numStr)) return numberToWordsDecimalUz(numStr);
  const n = parseInt(numStr, 10);
  return Number.isNaN(n) ? numStr : numberToWordsUz(n);
}

// Ko'p uchraydigan qisqartmalarni to'liq so'zga ochadi
const ABBREVIATIONS_UZ = [
  [/\bva h\.k\.?/gi, 'va hokazo'],
  [/\bva b\.?\b/gi, 'va boshqalar'],
  [/\bm\.?f\.?n\.?\b/gi, 'mingdan foizi nolga teng'], // ehtiyot chorasi, kamdan-kam
];

// Raqam + birlik qisqartmasi kombinatsiyalarini to'liq so'zga aylantiradi.
// Uzunroq qisqartmalar ("mm", "kg") avval tekshiriladi, aks holda ular
// bitta harfli birliklar ("m", "g") bilan chalkashib ketishi mumkin.
const UNIT_MAP_UZ = {
  soat: 'soat',
  daq: 'daqiqa',
  son: 'soniya',
  mm: 'millimetr',
  sm: 'santimetr',
  km: 'kilometr',
  ml: 'mililitr',
  mg: 'milligramm',
  kg: 'kilogramm',
  m: 'metr',
  g: 'gramm',
  l: 'litr',
};
const UNIT_PATTERN = Object.keys(UNIT_MAP_UZ)
  .sort((a, b) => b.length - a.length)
  .join('|');
const UNIT_REGEX = new RegExp(`(-?\\d+(?:[.,]\\d+)?)\\s*(${UNIT_PATTERN})\\b`, 'g');

function normalizeTextForTTS(text) {
  let out = String(text || '');
  if (!out.trim()) return out;

  for (const [pattern, replacement] of ABBREVIATIONS_UZ) {
    out = out.replace(pattern, replacement);
  }

  // 1) Harorat: 180°C, 36.6°C, -5°C, 100°F
  out = out.replace(/(-?\d+(?:[.,]\d+)?)\s*°\s*C\b/gi, (_, n) => `${wordifyNumberUz(n)} daraja Selsiy`);
  out = out.replace(/(-?\d+(?:[.,]\d+)?)\s*°\s*F\b/gi, (_, n) => `${wordifyNumberUz(n)} daraja Farengeyt`);
  out = out.replace(/(-?\d+(?:[.,]\d+)?)\s*°(?!\s*[CF])/g, (_, n) => `${wordifyNumberUz(n)} daraja`);

  // 2) Foiz: 20%, 12,5%
  out = out.replace(/(-?\d+(?:[.,]\d+)?)\s*%/g, (_, n) => `${wordifyNumberUz(n)} foiz`);

  // 3) Raqam + o'lchov birligi: 0,5 ml, 180 g, 2 kg, 30 daq
  out = out.replace(UNIT_REGEX, (_, n, u) => `${wordifyNumberUz(n)} ${UNIT_MAP_UZ[u]}`);

  // 4) Qolgan barcha "yalang'och" kasr sonlar (birliksiz): 3,14 -> uch vergul bir to'rt
  out = out.replace(/-?\b\d+[.,]\d+\b/g, (m) => numberToWordsDecimalUz(m));

  return out.replace(/\s{2,}/g, ' ').trim();
}

/* ── Xavfsiz (yo'qotishsiz) gap-bo'lish tokenizatori ──────────────────────
 * ESKI YECHIM /[^.!?\n]+[.!?\n]+|[^.!?\n]+$/g ikkita muammoga sabab bo'lardi:
 *
 *  1) Raqamli ro'yxatlar ("1. Band matni.") — "1." o'zi alohida "gap"
 *     sifatida ajralib chiqar, natijada bo'lak chegaralari ko'p uchraydigan
 *     joyларда yolg'iz raqamlar bilan tugab/boshlanib qolardi.
 *  2) Qo'shtirnoq ichidagi gaplar — tinish belgisidan keyin YOPILUVCHI
 *     QO'SHTIRNOQ kelganda (`gap."`), .match() bilan ishlaydigan bunga
 *     o'xshash regex'lar (ayniqsa "\s+|$" talab qilinganda) mos joyni
 *     topolmay, orasidagi MATNNI BUTUNLAY YO'QOTISHI mumkin edi.
 *
 * YECHIM: matnni bitta marta, indeks bo'yicha (regex "sirg'alib ketishi"ga
 * yo'l qo'ymasdan) aylanib chiqamiz — shu bilan hech qachon belgi
 * yo'qotilmaydi. Kasr sonlar ("3.14") va qisqa ro'yxat markerlari ("1.",
 * "12.") ichidagi nuqta vaqtincha himoyalanadi (gap oxiri deb hisoblanmaydi),
 * so'ng yolg'iz qolgan ro'yxat markeri keyingi gapga birlashtiriladi —
 * shunda "1." hech qachon alohida, yarim-yalang'och bo'lak sifatida TTS'ga
 * yuborilmaydi. Yopiluvchi qo'shtirnoq/qavslar ham tinish belgisidan keyin
 * darhol o'zidan oldingi gapga qo'shib olinadi. */
const _LIST_MARKER_ONLY_RE = /^\d{1,3}\.$/;
const _CLOSER_CHARS = '"\'\u00BB\u201D\u2019)\u005D\u203A\u300D\u300F';
function splitIntoSentences(text) {
  const str = String(text || '');
  if (!str.trim()) return [];

  const PH = '\u0000';
  // Kasr sonlar ("3.14") va qisqa ro'yxat markerlari ("1.", "12.") ichidagi
  // nuqta PH bilan almashtiriladi — pastda gap chegarasi qidirilganda bu
  // nuqtalar "ko'rinmaydi", keyin esa asl "." ga qaytariladi (unmask).
  let masked = str.replace(/(\d)\.(\d)/g, `$1${PH}$2`);
  masked = masked.replace(/(^|[\s([{\u2014\-])(\d{1,3})\.(?=\s|$)/g, (_, pre, num) => `${pre}${num}${PH}`);

  const isCloser = (ch) => ch !== undefined && _CLOSER_CHARS.indexOf(ch) !== -1;

  const rawParts = [];
  let start = 0;
  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i];
    const isBoundary = ch === '.' || ch === '!' || ch === '?' || ch === '\n';
    if (isBoundary) {
      let j = i;
      while (j + 1 < masked.length && '.!?\n'.includes(masked[j + 1])) j++;
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

/* Uzun matnni MAX_CHUNK_CHARS dan oshmaydigan bo'laklarga ajratadi — imkon
 * qadar GAP CHEGARASIDAN (., !, ?, yangi qator) bo'ladi, shunda har bir
 * bo'lak tabiiy joyda tugaydi va TTS gap o'rtasida "kesilib qolmaydi".
 * Agar bitta gapning o'zi MAX_CHUNK_CHARS dan uzun bo'lsa (kamdan-kam holat),
 * so'zlar bo'yicha bo'linadi. */
function splitIntoChunks(text, maxLen) {
  const sentences = splitIntoSentences(text);
  const chunks = [];
  let current = '';

  const pushCurrent = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };

  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;

    if (sentence.length > maxLen) {
      // Juda uzun bitta gap — so'zlar bo'yicha bo'lamiz
      pushCurrent();
      let piece = '';
      for (const word of sentence.split(' ')) {
        const candidate = piece ? `${piece} ${word}` : word;
        if (candidate.length > maxLen) {
          if (piece) chunks.push(piece.trim());
          piece = word;
        } else {
          piece = candidate;
        }
      }
      if (piece.trim()) chunks.push(piece.trim());
      continue;
    }

    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length > maxLen) {
      pushCurrent();
      current = sentence;
    } else {
      current = candidate;
    }
  }
  pushCurrent();
  return chunks;
}

/* Edge TTS matnni SSML ichiga qo'yadi — XML uchun xavfli belgilarni
 * escape qilish shart (aks holda WebSocket so'rovi buziladi). */
function escapeForSsml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Bitta matn bo'lagini (≤ MAX_CHUNK_CHARS) Edge TTS WebSocket orqali
 * ovozga aylantiradi va natijani Buffer sifatida qaytaradi (endi res'ga
 * to'g'ridan-to'g'ri yozmaydi — sabab quyida streamEdgeTtsToResponse
 * izohida). */
async function synthesizeOneChunk(text, voiceName) {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(escapeForSsml(text));

  const parts = [];
  return await new Promise((resolve, reject) => {
    audioStream.on('data', (chunk) => parts.push(chunk));
    audioStream.on('close', () => resolve(Buffer.concat(parts)));
    audioStream.on('error', (err) => reject(err));
  });
}

/** Bir nechta promise'ni bir vaqtda ko'pi bilan `limit` tadan ishga
 * tushiradi (butun ro'yxatni bir zumda otib yubormaslik uchun — Edge TTS
 * juda ko'p bir vaqtdagi WebSocket ulanishni yoqtirmasligi mumkin), lekin
 * baribir KETMA-KETLIKKA emas, PARALLELLIKKA asoslanadi.*/
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

/** Matnni bo'laklarga ajratadi va HAR BIRINI KETMA-KET sintez qilib, bitta
 * uzluksiz mp3 oqimiga (res) yozadi. Har bir bo'lak alohida Edge TTS
 * so'rovi bo'lsa-da (600 belgi chegarasi tufayli), natijada foydalanuvchi
 * BITTA to'liq (masalan 4 daqiqalik) ovozli xabar oladi — chunki mp3
 * freymlari ketma-ket yozilganda bitta uzluksiz audio fayl sifatida
 * o'qiladi. */
/** Matnni bo'laklarga ajratadi va HAMMASINI BIR VAQTDA (parallel, ko'pi
 * bilan 4 tasi bir paytda) sintez qilib, natijalarni TO'G'RI TARTIBDA
 * bitta uzluksiz mp3 oqimiga (res) yozadi.
 *
 * OLDIN: bo'laklar KETMA-KET sintez qilinardi — uzun matnlarda (masalan
 * bir necha paragrafli hikoya) bu umumiy vaqtni bo'laklar soniga
 * ko'paytirib yuborardi. Vercel HOBBY (bepul) tarifida serverless
 * funksiya HAQIQIY chegarasi 10 soniya (vercel.json'dagi maxDuration:60
 * faqat Pro'da ishlaydi) — shu sabab uzun javoblarda funksiya vaqti
 * tugab, TTS "sababsiz" muvaffaqiyatsiz bo'lib, foydalanuvchi ovozsiz
 * qolardi (xato faqat konsolga yozilardi).
 *
 * ENDI: bo'laklar parallel sintez qilinadi — umumiy vaqt (deyarli) bo'lak
 * SONIGA emas, ENG SEKIN bo'lakning vaqtiga teng bo'ladi, shu bilan 10s
 * chegarasiga sig'ish ehtimoli sezilarli oshadi. Tartib himoyalangan:
 * natijalar bo'lak indeksi bo'yicha saqlanib, oxirida ketma-ket res'ga
 * yoziladi (audio "aralashib" ketmaydi). */
async function streamEdgeTtsToResponse(text, voiceName, res) {
  const chunks = splitIntoChunks(text, MAX_CHUNK_CHARS);

  const buffers = await mapWithConcurrency(chunks, 4, (chunk) => synthesizeOneChunk(chunk, voiceName));

  res.statusCode = 200;
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-store');
  for (const buf of buffers) res.write(buf);
  try { res.end(); } catch (_) {}
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Authorization header (Bearer <idToken>) talab qilinadi' });
  }

  let decoded;
  try {
    decoded = await getAuth(getAdminApp()).verifyIdToken(token);
  } catch (err) {
    return res.status(401).json({ error: 'Token yaroqsiz' });
  }
  if (!decoded?.uid) {
    return res.status(401).json({ error: 'Token yaroqsiz' });
  }

  const approvalCheck = await requireApprovedUser(getAdminApp(), decoded.uid);
  if (!approvalCheck.ok) {
    return res.status(approvalCheck.status).json({ error: approvalCheck.error });
  }

  const rl = await checkRateLimit(getAdminApp(), decoded.uid, 'tts', {
    windowMs: 60 * 1000,
    max: 15,
  });
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    return res.status(429).json({ error: `Juda tez-tez so'rov yubordingiz. ${rl.retryAfterSec}s dan keyin qayta urining.` });
  }

  const { text, voice } = req.body || {};
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text talab qilinadi' });
  }

  const cleaned = normalizeTextForTTS(stripMarkdown(text)).slice(0, MAX_TOTAL_CHARS);
  if (!cleaned) {
    return res.status(400).json({ error: 'Ovozga aylantirish uchun matn topilmadi' });
  }

  const voiceName = VOICES[voice] || VOICES.male;

  try {
    await streamEdgeTtsToResponse(cleaned, voiceName, res);
    return;
  } catch (err) {
    console.error('[tts] error:', err.message);
    // Sarlavhalar (headers) allaqachon yuborilgan bo'lsa (stream boshlangan
    // edi, keyin uzilgan) — endi JSON xato qaytarib bo'lmaydi, faqat ulanishni
    // yopamiz. Aks holda odatdagidek JSON xato qaytaramiz.
    if (res.headersSent) { try { res.end(); } catch (_) {} return; }
    return res.status(502).json({ error: 'Ovoz yasashda xato: ' + err.message });
  }
}

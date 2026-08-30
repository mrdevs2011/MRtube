/**
 * POST /api/groq-chat
 * Groq chat-completions (matn va vision modellar) uchun xavfsiz
 * server-side proksi. Groq API kaliti Firestore'da
 * (spbs-collection/controller → groqkey) saqlanadi va brauzerga hech
 * qachon yuborilmaydi.
 *
 * Auth: Authorization: Bearer <Firebase ID Token>.
 *
 * Body (JSON): { model, messages, max_tokens?, temperature?, response_format?,
 *                stream? }
 * Bularning barchasi Groq/OpenAI formatiga mos — client shu formatda yuboradi,
 * biz to'g'ridan-to'g'ri Groq'ga forward qilamiz. `stream: true` bo'lsa,
 * javob token-token (SSE) tarzida real-vaqtda uzatiladi (MRgram AI chatida
 * Claude/ChatGPT kabi silliq javob ko'rsatish uchun).
 */
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getGroqApiKeysWithMeta, stickyKeyStartIndex, maskKey, invalidateKeyCache } from './_groq-key.js';
import { requireApprovedUser } from './_require-approved.js';
import { checkRateLimit } from './_rate-limit.js';

function getAdminApp() {
  if (getApps().length) return getApps()[0];
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (!b64) throw new Error('FIREBASE_SERVICE_ACCOUNT_BASE64 topilmadi');
  const sa = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  return initializeApp({ credential: cert(sa) });
}

/**
 * ADMIN STATISTIKA: har bir muvaffaqiyatli Groq so'rovi (matn ham, oqim
 * ham) tugagach shu yerga yoziladi — CLIENT emas, SERVER yozadi, shuning
 * uchun statistika 100% ishonchli (foydalanuvchi brauzerini yopib
 * qo'yishi/tarmoq uzilishi statistikani yo'qotmaydi, va hech kim uni
 * soxtalashtira olmaydi). Uch xil joyga yoziladi:
 *   1) aiUsageLogs   — har bir so'rovning batafsil yozuvi (kim, qachon,
 *      qaysi kalit, qaysi model, qancha token) — "recent activity" va
 *      "qaysi key qachon ishlatildi" jadvali/chizig'i uchun.
 *   2) aiUsageKeyStats/{keyId}  — kalit bo'yicha jamlangan (increment)
 *      statistika — admin panelda kalitlar jadvali uchun (log'larni
 *      to'liq skanerlamasdan tezkor o'qish uchun).
 *   3) aiUsageUserStats/{uid}  — foydalanuvchi bo'yicha jamlangan
 *      statistika — "kim qancha token sarfladi" jadvali uchun.
 *   4) aiUsageDaily/{yyyy-mm-dd} — kunlik jamlangan statistika — chiziqli
 *      grafik (trend) uchun.
 * Xato bo'lsa ham asosiy so'rovga (Groq javobini foydalanuvchiga
 * qaytarishga) hech qanday ta'sir qilmaydi — faqat konsolga log yoziladi.
 */
async function logAiUsage({ uid, model, keyId, usage }) {
  if (!usage) return;
  try {
    const fdb = getFirestore(getAdminApp());
    const kind = /qwen|vision/i.test(model || '') ? 'vision' : 'text';
    const prompt     = usage.prompt_tokens     || 0;
    const completion = usage.completion_tokens || 0;
    const total      = usage.total_tokens      || (prompt + completion);
    const now = FieldValue.serverTimestamp();
    const safeKeyId = keyId || 'nomalum';

    const batch = fdb.batch();

    const logRef = fdb.collection('AI').doc('_stats').collection('logs').doc();
    batch.set(logRef, {
      userId: uid || null,
      model, kind,
      keyId: safeKeyId,
      promptTokens: prompt, completionTokens: completion, totalTokens: total,
      createdAt: now,
    });

    const keyRef = fdb.collection('AI').doc('_stats').collection('keyStats').doc(safeKeyId);
    batch.set(keyRef, {
      promptTokens:     FieldValue.increment(prompt),
      completionTokens: FieldValue.increment(completion),
      totalTokens:      FieldValue.increment(total),
      requests:         FieldValue.increment(1),
      lastUsedAt:       now,
      lastModel:        model,
      lastUserId:       uid || null,
    }, { merge: true });

    if (uid) {
      const userRef = fdb.collection('AI').doc('_stats').collection('userStats').doc(uid);
      batch.set(userRef, {
        promptTokens:     FieldValue.increment(prompt),
        completionTokens: FieldValue.increment(completion),
        totalTokens:      FieldValue.increment(total),
        requests:         FieldValue.increment(1),
        lastUsedAt:       now,
        lastModel:        model,
        lastKeyId:        safeKeyId,
      }, { merge: true });
    }

    const dayKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
    const dayRef = fdb.collection('AI').doc('_stats').collection('daily').doc(dayKey);
    const dayPatch = {
      promptTokens:     FieldValue.increment(prompt),
      completionTokens: FieldValue.increment(completion),
      totalTokens:      FieldValue.increment(total),
      requests:         FieldValue.increment(1),
    };
    dayPatch[kind === 'vision' ? 'visionTokens' : 'textTokens'] = FieldValue.increment(total);
    batch.set(dayRef, dayPatch, { merge: true });

    await batch.commit();
  } catch (err) {
    console.error('[groq-chat] AI usage statistikasini yozishda xato:', err);
  }
}

function getBearerToken(req) {
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
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

  // MUHIM: verifyIdToken faqat "login qilganmisan"ni tekshiradi.
  // "Admin senga ruxsat berganmi"ni alohida tekshirish shart — aks holda
  // hali approve bo'lmagan userlar ham Groq kvotasini sarflay oladi.
  const approvalCheck = await requireApprovedUser(getAdminApp(), decoded.uid);
  if (!approvalCheck.ok) {
    return res.status(approvalCheck.status).json({ error: approvalCheck.error });
  }

  // Per-user chegara: bitta odam so'rovni loop bilan spam qilib, umumiy
  // Groq kvotasini boshqa foydalanuvchilar uchun yeb qo'ymasin. Bu Groq
  // kalitlarining o'zidagi TPM/TPD limitidan MUSTAQIL — bu yerda maqsad
  // "kalit tugadimi" emas, "bitta uid haddan tashqari ko'p urinyaptimi".
  const rl = await checkRateLimit(getAdminApp(), decoded.uid, 'chat', {
    windowMs: 60 * 1000,
    max: 20, // 1 daqiqada 20 ta so'rov — oddiy chat foydalanishga yetadi
  });
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    return res.status(429).json({ error: `Juda tez-tez so'rov yubordingiz. ${rl.retryAfterSec}s dan keyin qayta urining.` });
  }

  let GROQ_KEY_ENTRIES = []; // [{ id, key }, ...]
  try {
    GROQ_KEY_ENTRIES = await getGroqApiKeysWithMeta(getAdminApp());
  } catch (err) {
    console.error('[groq-chat] Groq kalitlarini olishda xato:', err);
  }
  if (!GROQ_KEY_ENTRIES.length) {
    return res.status(500).json({ error: 'Server konfiguratsiyasi xato: Groq API kaliti topilmadi ("AI" collection yoki spbs-collection/controller → groqkey)' });
  }

  const {
    model, messages, max_tokens = 200, temperature = 0.7, response_format = null,
    stream = false, reasoning_effort = null, stream_options = null,
    frequency_penalty = null, presence_penalty = null,
  } = req.body || {};
  if (!model || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'model va messages talab qilinadi' });
  }

  const body = { model, messages, max_tokens, temperature };
  if (response_format) body.response_format = response_format;
  if (reasoning_effort) body.reasoning_effort = reasoning_effort;
  // "yam-yam-yam..." kabi takrorlanish-tsikliga tushib qolishning oldini
  // olish uchun — client (config.js) tomonidan yuborilsa, Groq'ga forward
  // qilinadi (OpenAI-mos parametrlar, -2.0..2.0 oralig'ida).
  if (frequency_penalty != null) body.frequency_penalty = frequency_penalty;
  if (presence_penalty  != null) body.presence_penalty  = presence_penalty;
  // Streaming (real-vaqt token-token javob — Claude/ChatGPT kabi "silliq"
  // taassurot uchun).
  const wantStream = !!stream;
  if (wantStream) body.stream = true;
  // stream_options: { include_usage: true } — client (token-usage bubble)
  // oqim yakunida ham `usage` statistikasini olishi uchun Groq'ga forward
  // qilinadi. Faqat streaming so'rovlarda mazmunli (oddiy so'rovda Groq
  // `usage`ni allaqachon javob tanasida qaytaradi).
  if (wantStream && stream_options) body.stream_options = stream_options;

  // Kunlik token limiti (TPD) tugagan bo'lsa qaytadan urinishning foydasi
  // yo'q (limit daqiqalar ichida emas, soatlar ichida tiklanadi) — bunday
  // holatda darhol kichikroq/zaxira modelga o'tamiz.
  //
  // MUHIM: FALLBACK_MODEL (gpt-oss-20b) — matn-only model, rasm (image_url)
  // qabul qila olmaydi. Shu sababli bu fallback FAQAT matn so'rovlari uchun
  // ishlatiladi. Agar so'rovda rasm bo'lsa (vision/AI rasm tahlili), fallback
  // qilinmaydi — aks holda gpt-oss-20b image_url'ni tushunmay yana xato
  // qaytaradi va foydalanuvchi "Groq xatosi" ko'raveradi.
  const FALLBACK_MODEL = 'openai/gpt-oss-20b'; // eski llama-3.1-8b-instant eskirgan (Groq tavsiyasi)
  const isDailyLimitMsg = (msg) => /tokens per day|TPD/i.test(msg || '');
  // Daqiqalik token limiti (TPM) — kunlik limitdan farqli o'laroq, bu limit
  // odatda bir necha soniya/daqiqada tiklanadi. Lekin bitta kalitning TPM
  // limiti tugagan bo'lishi mumkin, boshqa kalitniki esa hali bo'sh — shu
  // sababli TPD/401 kabi darhol navbatdagi kalitga o'tamiz (kutib
  // o'tirmasdan), bu ancha tezroq va samaraliroq.
  const isMinuteLimitMsg = (msg) => /tokens per minute|TPM/i.test(msg || '');
  // 401 — kalit yaroqsiz/bekor qilingan/muddati o'tgan. Bu ba'zan HAQIQIY
  // noto'g'ri kalit, lekin ba'zan Groq tomonidagi vaqtinchalik/tasodifiy
  // nosozlik (masalan kalit propagatsiyasi kechikishi) bo'lishi ham mumkin.
  // Shu sababli 401'da ham darrov to'xtamasdan — avval navbatdagi kalitlarni
  // sinaymiz, keyin (agar barchasi 401 bersa) keshni tozalab bir marta yana
  // urinib ko'ramiz.
  const isInvalidKeyMsg = (msg) => /invalid api key|invalid_api_key|unauthorized/i.test(msg || '');
  // Vision/JSON so'rovlarida model ba'zan valid JSON qaytarolmaydi (ayniqsa
  // preview vision modeli + rasm + response_format:json_object kombinatsiyasida).
  // Bu ko'pincha bir martalik/tasodifiy nosozlik — qayta so'rasak ko'pincha tuzaladi.
  const isJsonValidateFailMsg = (msg) => /validate json|failed_generation|json_validate_failed/i.test(msg || '');
  const hasImageContent = Array.isArray(messages) && messages.some(
    (m) => Array.isArray(m?.content) && m.content.some((p) => p?.type === 'image_url')
  );

  const doFetch = (m, key) => fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({ ...body, model: m }),
  });

  // response_format:json_object'siz variant — Groq'ning ichki JSON
  // validatori doimiy rad etayotgan holatlarda oxirgi chora sifatida
  // ishlatiladi (frontend (_parseAboutReply) JSON bo'lmasa ham matnni
  // qabul qiladi, shuning uchun bu xavfsiz fallback).
  const bodyNoJson = { ...body };
  delete bodyNoJson.response_format;
  const doFetchNoJson = (m, key) => fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({ ...bodyNoJson, model: m }),
  });

  // "Yopishtirilgan" (sticky) kalit: bitta foydalanuvchi (uid) doim bir xil
  // kalitdan boshlaydi — shu bilan Groq'ning prompt-cache imkoniyati ishga
  // tushadi (bir xil kalit + bir xil ~4,400 tokenlik system prompt ~2 soat
  // ichida keshlanadi, keshlangan qism TPM limitiga hisoblanmaydi). Agar bu
  // "afzal ko'rilgan" kalit limitga tegib qolsa, pastdagi tryAllKeys baribir
  // navbatdagi kalitlarga o'tadi — rotatsiya/fallback mantiqi saqlanadi,
  // faqat boshlang'ich tanlov endi tasodifiy emas, uid asosida barqaror.
  const startIdx = stickyKeyStartIndex(decoded.uid, GROQ_KEY_ENTRIES.length);
  let orderedEntries = GROQ_KEY_ENTRIES.map((_, i) => GROQ_KEY_ENTRIES[(startIdx + i) % GROQ_KEY_ENTRIES.length]);

  try {
    let groqRes = null;
    let lastRawMsg = '';
    let lastStatus = 0;

    // Kunlik (TPD) YOKI daqiqalik (TPM) limit tugagan, YOKI kalit yaroqsiz
    // (401) bo'lsa, navbatdagi kalitga avtomatik o'tamiz — barcha kalitlar
    // tugaguncha (yoki boshqa turdagi xato/muvaffaqiyat kelguncha).
    async function tryAllKeys(entries) {
      let res = null, rawMsg = '', status = 0, usedId = null;
      for (let i = 0; i < entries.length; i++) {
        usedId = entries[i].id;
        res = await doFetch(model, entries[i].key);
        if (res.ok) return { res, rawMsg: '', status: res.status, usedId };

        const data = await res.json().catch(() => ({}));
        rawMsg = data.error?.message || '';
        status = res.status;

        const shouldSkipToNextKey =
          (status === 429 && (isDailyLimitMsg(rawMsg) || isMinuteLimitMsg(rawMsg))) ||
          (status === 401 && isInvalidKeyMsg(rawMsg));

        if (shouldSkipToNextKey) {
          console.error(`[groq-chat] kalit xato (id=${entries[i].id}, ${maskKey(entries[i].key)}): status=${status} msg="${rawMsg}" — navbatdagi kalitga o'tilmoqda`);
          if (i < entries.length - 1) continue;
        } else if (status !== 200) {
          console.error(`[groq-chat] kalit xato (id=${entries[i].id}, ${maskKey(entries[i].key)}): status=${status} msg="${rawMsg}"`);
        }
        break; // boshqa turdagi xato yoki kalitlar tugadi
      }
      return { res, rawMsg, status, usedId };
    }

    let attempt = await tryAllKeys(orderedEntries);
    groqRes = attempt.res;
    lastRawMsg = attempt.rawMsg;
    lastStatus = attempt.status;
    // Client (token-usage bubble) uchun: haqiqatda qaysi kalit (id)
    // ishlatilganini kuzatib boramiz — javob header'ida qaytariladi.
    let usedKeyId = attempt.usedId;

    // Agar BARCHA kalitlar 401 (yaroqsiz) qaytarsa — ehtimol Firestore'dagi
    // kalit endigina to'g'irlangan, lekin bu funksiya "issiq" turgani uchun
    // eski (noto'g'ri) kesh hali ishlatilmoqda. Keshni tozalab, kalitlarni
    // Firestore'dan qayta o'qib, BIR MARTA yana urinib ko'ramiz.
    if (!groqRes.ok && lastStatus === 401 && isInvalidKeyMsg(lastRawMsg)) {
      console.error('[groq-chat] barcha kalitlar 401 qaytardi — kesh tozalanib, Firestore\'dan qayta o\'qilmoqda');
      invalidateKeyCache();
      let freshEntries = [];
      try {
        freshEntries = await getGroqApiKeysWithMeta(getAdminApp(), { force: true });
      } catch (err) {
        console.error('[groq-chat] kalitlarni qayta o\'qishda xato:', err);
      }
      if (freshEntries.length) {
        attempt = await tryAllKeys(freshEntries);
        groqRes = attempt.res;
        lastRawMsg = attempt.rawMsg;
        lastStatus = attempt.status;
        usedKeyId = attempt.usedId;
      }
    }

    if (!groqRes.ok) {
      if (groqRes.status === 429 && isDailyLimitMsg(lastRawMsg) && model !== FALLBACK_MODEL && !hasImageContent) {
        // Barcha kalitlarning kunlik limiti tugagan — zaxira modelga o'tib
        // qayta urinamiz. (Faqat matn so'rovlari uchun — fallback model
        // rasm qabul qilmaydi.)
        groqRes = await doFetch(FALLBACK_MODEL, orderedEntries[0].key);
        usedKeyId = orderedEntries[0].id;
        lastRawMsg = '';
      } else if (groqRes.status === 429 && isMinuteLimitMsg(lastRawMsg)) {
        // MUHIM: bu yerga faqat BARCHA kalitlar TPM (daqiqalik) limitiga
        // tegib, tryAllKeys() ichidagi rotatsiya tugagandan keyin kelamiz.
        // Shu sababli faqat orderedEntries[0].key bilan qayta urinish
        // deyarli foydasiz — o'sha kalit ham TPM'da bo'lishi tayin (u
        // rotatsiyada allaqachon sinab ko'rilgan). Qisqa kutib, so'ng
        // BARCHA kalitlarni yana bir necha marta (boshidan) sinaymiz — TPM
        // odatda bir necha soniyada tiklanadi.
        //
        // Rasm/video (vision) so'rovlari uchun foydalanuvchiga hech qanday
        // sun'iy limit ko'rsatilmasligi kerak (config.js'da ham ataylab
        // "limitsiz" qilib qo'yilgan) — shuning uchun vision so'rovlarda
        // ko'proq (VISION_TPM_RETRIES) marta, o'sib boruvchi kutish bilan
        // qayta urinamiz, oddiy matn so'rovida esa 1 marta yetarli.
        const VISION_TPM_RETRIES = 3;
        const TEXT_TPM_RETRIES = 1;
        const maxTpmRetries = hasImageContent ? VISION_TPM_RETRIES : TEXT_TPM_RETRIES;
        for (let tpmTry = 0; tpmTry < maxTpmRetries; tpmTry++) {
          const retryAfterSec = parseInt(groqRes.headers.get('retry-after') || '3', 10);
          // Har keyingi urinishda biroz uzunroq kutamiz (~3s, 5s, 7s),
          // TPM oynasi tiklanishiga ko'proq imkon berish uchun — lekin
          // Vercel funksiya vaqti chegarasidan chiqib ketmasligi uchun
          // umumiy kutish cheklangan (max 8s/urinish).
          const delayMs = Math.min(retryAfterSec * 1000 + tpmTry * 2000, 8000);
          await new Promise(r => setTimeout(r, delayMs));
          attempt = await tryAllKeys(orderedEntries);
          groqRes = attempt.res;
          lastRawMsg = attempt.rawMsg;
          lastStatus = attempt.status;
          usedKeyId = attempt.usedId;
          if (groqRes.ok || !(groqRes.status === 429 && isMinuteLimitMsg(lastRawMsg))) break;
        }
      } else if (groqRes.status === 429 || (groqRes.status >= 500 && groqRes.status !== 400)) {
        // Vaqtinchalik (rate/5xx) xato — qisqa kutib bir marta qayta urinamiz.
        const retryAfterSec = parseInt(groqRes.headers.get('retry-after') || '4', 10);
        const delayMs = Math.min(retryAfterSec * 1000, 8000);
        await new Promise(r => setTimeout(r, delayMs));
        groqRes = await doFetch(model, orderedEntries[0].key);
        usedKeyId = orderedEntries[0].id;
        lastRawMsg = '';
      } else if (groqRes.status === 400 && isJsonValidateFailMsg(lastRawMsg)) {
        // Model bir martalik nosozlik tufayli valid JSON qaytarolmadi
        // (400, lekin doimiy xato emas) — bir necha marta (jami 3 ta
        // urinishgacha) qayta urinamiz, chunki bu ko'pincha tasodifiy
        // (bir martalik) nosozlik bo'ladi va qayta so'rasak tuzaladi.
        const MAX_JSON_RETRIES = 3;
        for (let i = 0; i < MAX_JSON_RETRIES && !groqRes.ok; i++) {
          usedKeyId = orderedEntries[i % orderedEntries.length].id;
          groqRes = await doFetch(model, orderedEntries[i % orderedEntries.length].key);
          if (groqRes.ok) { lastRawMsg = ''; break; }
          const retryData = await groqRes.json().catch(() => ({}));
          lastRawMsg = retryData.error?.message || '';
          if (!isJsonValidateFailMsg(lastRawMsg)) break; // boshqa turdagi xatoga aylandi — to'xtaymiz
        }
        // Hamon json_validate_failed bo'lsa — bu doimiy (model+JSON-rejim
        // kombinatsiyasiga xos) muammo, qayta-qayta bir xil urinish
        // yordam bermaydi. response_format'siz oxirgi marta so'raymiz —
        // frontend JSON bo'lmasa ham matnni fallback sifatida qabul qiladi.
        if (!groqRes.ok && isJsonValidateFailMsg(lastRawMsg) && body.response_format) {
          console.error('[groq-chat] json_validate_failed 3 marta takrorlandi — response_format\'siz oxirgi urinish');
          groqRes = await doFetchNoJson(model, orderedEntries[0].key);
          usedKeyId = orderedEntries[0].id;
          lastRawMsg = '';
        }
      }
    }

    // Groq xato qaytarsa (stream so'ralgan bo'lsa ham) — javob SSE emas,
    // oddiy JSON bo'ladi, shuni o'qib clientga xato sifatida qaytaramiz.
    // MUHIM: HTTP javob tanasi faqat BIR marta o'qilishi mumkin — agar
    // yuqorida allaqachon o'qilgan bo'lsa (lastRawMsg to'ldirilgan va
    // groqRes o'sha payt qayta tayinlanmagan bo'lsa), qayta fetch qilib
    // o'qish o'rniga saqlangan xabardan foydalanamiz.
    if (!groqRes.ok) {
      const rawMsg = lastRawMsg || (await groqRes.json().catch(() => ({}))).error?.message || '';
      const friendlyMsg = isDailyLimitMsg(rawMsg)
        ? 'MRgram AI hozircha band: kunlik so\'rov limiti tugadi. Iltimos, birozdan keyin qayta urinib ko\'ring.'
        : isMinuteLimitMsg(rawMsg)
        ? 'MRgram AI hozir band: bir daqiqalik so\'rov limiti tugadi. Iltimos, biroz kutib qayta urinib ko\'ring.'
        : isJsonValidateFailMsg(rawMsg)
        ? 'AI javob shakllantirishda xato ketdi. Iltimos, qayta urinib ko\'ring.'
        : isInvalidKeyMsg(rawMsg)
        ? 'MRgram AI vaqtincha ishlamayapti. Iltimos, birozdan keyin qayta urinib ko\'ring.'
        : (groqRes.status >= 500
          ? 'MRgram AI serverida vaqtinchalik nosozlik yuz berdi. Iltimos, birozdan keyin qayta urinib ko\'ring.'
          : `AI so\'rovni bajarib bo\'lmadi. Iltimos, qayta urinib ko\'ring. [DEBUG status=${groqRes.status} msg="${(rawMsg || '').slice(0, 200)}"]`);
      if (usedKeyId) res.setHeader('X-Groq-Key-Id', usedKeyId);
      return res.status(groqRes.status).json({ error: { message: friendlyMsg } });
    }

    if (wantStream && groqRes.body) {
      // Groq'dan kelayotgan SSE ("data: {...}\n\n" ... "data: [DONE]\n\n")
      // oqimini to'g'ridan-to'g'ri (proksi sifatida) clientga uzatamiz —
      // shu orqali frontend token-token (real-vaqt) javobni ko'rsata oladi.
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        // Token-usage bubble qaysi Groq kaliti ishlatilganini bilishi uchun
        // (ID — masalan "gk1"/"legacy"/"env", hech qachon to'liq kalit emas).
        'X-Groq-Key-Id': usedKeyId || '',
      });
      const reader = groqRes.body.getReader();
      const decoder = new TextDecoder();
      // ADMIN STATISTIKA: streaming javobning oxirida ("choices" bo'sh)
      // maxsus hodisa ichida `usage` keladi (stream_options.include_usage
      // har doim so'ralgan) — buni ham parslab, so'rov tugagach serverga
      // (admin statistikasiga) yozamiz. Client'ga uzatilayotgan xom
      // baytlarga bu hech qanday ta'sir qilmaydi — faqat parallel o'qiymiz.
      let sseBuffer = '';
      let capturedUsage = null;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunkText = decoder.decode(value, { stream: true });
          res.write(chunkText);

          sseBuffer += chunkText;
          const lines = sseBuffer.split('\n');
          sseBuffer = lines.pop() ?? '';
          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith('data:')) continue;
            const dataStr = line.slice(5).trim();
            if (!dataStr || dataStr === '[DONE]') continue;
            try {
              const json = JSON.parse(dataStr);
              if (json.usage) capturedUsage = json.usage;
            } catch (_) { /* to'liq JSON emas — o'tkazib yuboramiz */ }
          }
        }
      } catch (streamErr) {
        console.error('[groq-chat] stream forwarding error:', streamErr);
      } finally {
        if (capturedUsage) {
          await logAiUsage({ uid: decoded.uid, model, keyId: usedKeyId, usage: capturedUsage });
        }
        res.end();
      }
      return;
    }

    const data = await groqRes.json().catch(() => ({}));
    if (usedKeyId) res.setHeader('X-Groq-Key-Id', usedKeyId);
    if (data.usage) {
      await logAiUsage({ uid: decoded.uid, model, keyId: usedKeyId, usage: data.usage });
    }
    return res.status(200).json(data);
  } catch (err) {
    console.error('[groq-chat] error:', err);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Internal error' });
    }
    try { res.end(); } catch (_) { /* jim */ }
  }
}

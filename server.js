/**
 * MRgram — Max Private Local Server
 * Port: 3747
 *
 * Papka tuzilmasi:
 *   posts/
 *     {USERNAME}/
 *       {safeName}_{timestamp}/          ← fayl bor post
 *         about.json
 *         {safeName}.{ext}
 *       text_{timestamp}/                ← faqat matn post
 *         about.json
 *
 * about.json:
 *   {
 *     id, text, author, userId, savedAt,
 *     file: {
 *       name, size, type, folder, token,
 *       mediaUrl   ← "http://localhost:3747/file/{username}/{folder}/{token}"
 *     } | null
 *   }
 *
 * SECURITY:
 *   - Barcha write endpointlar (POST /save, DELETE /delete, POST /set-vis)
 *     Firebase ID token talab qiladi: Authorization: Bearer <idToken>
 *   - Token Google tokeninfo API orqali tekshiriladi
 *   - CORS: ruxsat etilgan domenlar: mrgram.vercel.app, mrtube.uz, mrdatabase.uz (ALLOWED_ORIGINS)
 */

import fs            from 'fs';
import path          from 'path';
import http          from 'http';
import https         from 'https';
import crypto        from 'crypto';
import { ADMIN_UID } from './api/_admin.js';

const PORT         = 3747;
const POSTS_DIR    = path.join(process.cwd(), 'posts');

// ── Ruxsat etilgan originlar (brauzer CORS uchun) ─────────────────────────
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGIN || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

if (!ALLOWED_ORIGINS.length) {
  ALLOWED_ORIGINS.push(
    'https://mrgram.vercel.app',
    'https://mrtube.uz',
    'https://www.mrtube.uz',
    'https://mrdatabase.uz',
    'https://www.mrdatabase.uz'
  );
}

/* ── Papka yaratish ─────────────────────────────────────────────────── */
if (!fs.existsSync(POSTS_DIR)) fs.mkdirSync(POSTS_DIR, { recursive: true });

/* ── Yordamchi funksiyalar ──────────────────────────────────────────── */

/** Xavfsiz fayl nomi: bo'shliqlar va maxsus belgilarni olib tashlaydi */
function safeName(name = '') {
  return name
    .replace(/\s+/g, '_')
    .replace(/[^\w.\-]/g, '')
    .slice(0, 80) || 'file';
}

/** Tasodifiy token (URL ga kiritib bo'lmaydigan uzun string) */
function genToken() {
  return crypto.randomBytes(32).toString('hex'); // 64 belgi
}

/** ISO timestamp → fayl nomi uchun qulay format: 2026-11-19+13:11-14s */
function fmtTimestamp(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}` +
    `+${pad(d.getHours())}:${pad(d.getMinutes())}-${pad(d.getSeconds())}s`
  );
}

/** Base64 data URL → Buffer + ext */
function parseBase64(dataUrl = '') {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  if (!m) return null;
  return { mime: m[1], buf: Buffer.from(m[2], 'base64') };
}

/** Barcha postlarni o'qish (hamma userlar) */
function readAllPosts() {
  const posts = [];
  if (!fs.existsSync(POSTS_DIR)) return posts;

  for (const username of fs.readdirSync(POSTS_DIR)) {
    const userDir = path.join(POSTS_DIR, username);
    if (!fs.statSync(userDir).isDirectory()) continue;

    for (const folder of fs.readdirSync(userDir)) {
      const folderDir = path.join(userDir, folder);
      if (!fs.statSync(folderDir).isDirectory()) continue;

      const aboutPath = path.join(folderDir, 'about.json');
      if (!fs.existsSync(aboutPath)) continue;

      try {
        const p = JSON.parse(fs.readFileSync(aboutPath, 'utf8'));
        posts.push(p);
      } catch {}
    }
  }

  // savedAt bo'yicha yangi → eski tartib
  posts.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
  return posts;
}

/* ── Firebase ID Token tekshirish ───────────────────────────────────── */
/**
 * Google tokeninfo API orqali Firebase ID tokenni tekshiradi.
 * Muvaffaqiyatli bo'lsa { uid, email } qaytaradi, aks holda null.
 */
function verifyFirebaseToken(idToken) {
  return new Promise((resolve) => {
    if (!idToken || typeof idToken !== 'string') return resolve(null);
    const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          // aud (audience) Firebase project ID bilan mos bo'lishi kerak
          if (json.error_description || !json.sub) return resolve(null);
          resolve({ uid: json.sub, email: json.email || null });
        } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

/** Request dan Bearer tokenni ajratib oladi */
function getBearerToken(req) {
  const auth = req.headers['authorization'] || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

/* ── HTTP Server ────────────────────────────────────────────────────── */
const server = http.createServer(async (req, res) => {

  // CORS — faqat ruxsat etilgan originlardan
  const origin = req.headers['origin'] || '';
  if (!origin || ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || ALLOWED_ORIGINS[0]);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  /* ══════════════════════════════════════════════════════════════════
     GET /ping  — server yoniqligini tekshirish (Firebase Rules uchun)
     ══════════════════════════════════════════════════════════════════ */
  if (req.method === 'GET' && url.pathname === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  /* ══════════════════════════════════════════════════════════════════
     GET /posts  — barcha local postlarni qaytarish
     ══════════════════════════════════════════════════════════════════ */
  if (req.method === 'GET' && url.pathname === '/posts') {
    const posts = readAllPosts();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(posts));
  }

  /* ══════════════════════════════════════════════════════════════════
     GET /file/{username}/{folder}/{token}
     — fayl uchun to'g'ridan-to'g'ri URL (token to'g'ri bo'lsa)
     ══════════════════════════════════════════════════════════════════ */
  const fileMatch = url.pathname.match(/^\/file\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (req.method === 'GET' && fileMatch) {
    const [, username, folder, token] = fileMatch;
    const folderDir  = path.join(POSTS_DIR, username, folder);
    const aboutPath  = path.join(folderDir, 'about.json');

    if (!fs.existsSync(aboutPath)) {
      res.writeHead(404); return res.end('Not found');
    }

    let about;
    try { about = JSON.parse(fs.readFileSync(aboutPath, 'utf8')); }
    catch { res.writeHead(500); return res.end('Error'); }

    // Token tekshirish
    if (!about.file || about.file.token !== token) {
      res.writeHead(403); return res.end('Forbidden');
    }

    // Faylni topish
    const files = fs.readdirSync(folderDir).filter(f => f !== 'about.json');
    if (!files.length) { res.writeHead(404); return res.end('File not found'); }

    const filePath = path.join(folderDir, files[0]);
    const mime     = about.file.type || 'application/octet-stream';
    const buf      = fs.readFileSync(filePath);

    res.writeHead(200, {
      'Content-Type':   mime,
      'Content-Length': buf.length,
      'Cache-Control':  'no-store',
    });
    return res.end(buf);
  }

  /* ══════════════════════════════════════════════════════════════════
     POST /save  — yangi post saqlash
     Body: { text, author, userId, file: { name, size, type, data } | null }
     Auth: Authorization: Bearer <Firebase ID Token>
     ══════════════════════════════════════════════════════════════════ */
  if (req.method === 'POST' && url.pathname === '/save') {
    // ── Token tekshirish ──
    const token = getBearerToken(req);
    const caller = await verifyFirebaseToken(token);
    if (!caller) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let payload;
      try { payload = JSON.parse(body); }
      catch { res.writeHead(400); return res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' })); }

      const { text, author, userId, file } = payload;

      // ── UID tekshirish: token egasi bilan userId mos bo'lishi kerak ──
      if (!userId || userId !== caller.uid) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'Forbidden: userId mismatch' }));
      }

      const now       = new Date();
      const ts        = fmtTimestamp(now);
      const username  = (author || 'user').replace(/[^\w]/g, '_');

      // Papka nomi
      let folderName;
      if (file && file.name) {
        const sn = safeName(file.name);
        folderName = `${sn}_${ts}`;       // masalan: style.css_2026-11-19+13:11-14s
      } else {
        folderName = `text_${ts}`;         // faqat matn post
      }

      const folderDir = path.join(POSTS_DIR, username, folderName);
      fs.mkdirSync(folderDir, { recursive: true });

      // Post ID
      const id = crypto.randomUUID();

      // about.json ma'lumotlari
      let fileInfo = null;
      if (file && file.data) {
        const parsed = parseBase64(file.data);
        if (parsed) {
          const ext      = (file.name.split('.').pop() || 'bin').toLowerCase();
          const fileName = safeName(file.name);
          const filePath = path.join(folderDir, fileName);
          fs.writeFileSync(filePath, parsed.buf);

          const token   = genToken();
          const mediaUrl = `http://localhost:${PORT}/file/${username}/${folderName}/${token}`;

          fileInfo = {
            name:     file.name,
            size:     file.size,
            type:     file.type || parsed.mime,
            folder:   folderName,
            token,
            mediaUrl,
          };
        }
      }

      const about = {
        id,
        text:    text || null,
        author:  author || null,
        userId:  userId || null,
        savedAt: now.toISOString(),
        file:    fileInfo,
      };

      fs.writeFileSync(
        path.join(folderDir, 'about.json'),
        JSON.stringify(about, null, 2),
        'utf8'
      );

      console.log(`[SAVE] ${username}/${folderName}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, id, folder: folderName }));
    });
    return;
  }

  /* ══════════════════════════════════════════════════════════════════
     DELETE /delete/{username}/{folder}  — postni o'chirish
     Auth: Authorization: Bearer <Firebase ID Token>
     ══════════════════════════════════════════════════════════════════ */
  const delMatch = url.pathname.match(/^\/delete\/([^/]+)\/([^/]+)$/);
  if (req.method === 'DELETE' && delMatch) {
    // ── Token tekshirish ──
    const token = getBearerToken(req);
    const caller = await verifyFirebaseToken(token);
    if (!caller) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
    }

    const [, username, folder] = delMatch;
    const folderDir = path.join(POSTS_DIR, username, folder);

    if (!fs.existsSync(folderDir)) {
      res.writeHead(404); return res.end(JSON.stringify({ ok: false }));
    }

    // ── Mulkchilik tekshirish: about.json dagi userId bilan solishtiramiz ──
    const aboutPath = path.join(folderDir, 'about.json');
    try {
      const about = JSON.parse(fs.readFileSync(aboutPath, 'utf8'));
      if (about.userId !== caller.uid && caller.uid !== ADMIN_UID) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'Forbidden: not your post' }));
      }
    } catch {
      res.writeHead(500); return res.end(JSON.stringify({ ok: false }));
    }

    // Papkani to'liq o'chirish
    fs.rmSync(folderDir, { recursive: true, force: true });
    console.log(`[DELETE] ${username}/${folder} by ${caller.uid}`);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  /* ══════════════════════════════════════════════════════════════════
     POST /set-vis  — postni public/private qilish
     Body: { id, isPublic }
     Auth: Authorization: Bearer <Firebase ID Token>
     ══════════════════════════════════════════════════════════════════ */
  if (req.method === 'POST' && url.pathname === '/set-vis') {
    // ── Token tekshirish ──
    const token = getBearerToken(req);
    const caller = await verifyFirebaseToken(token);
    if (!caller) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let payload;
      try { payload = JSON.parse(body); }
      catch { res.writeHead(400); return res.end(JSON.stringify({ ok: false })); }

      const { id, isPublic } = payload;

      // Barcha user papkalarida shu id ni qidirish
      let found = false;
      for (const username of fs.readdirSync(POSTS_DIR)) {
        const userDir = path.join(POSTS_DIR, username);
        if (!fs.statSync(userDir).isDirectory()) continue;
        for (const folder of fs.readdirSync(userDir)) {
          const aboutPath = path.join(POSTS_DIR, username, folder, 'about.json');
          if (!fs.existsSync(aboutPath)) continue;
          try {
            const about = JSON.parse(fs.readFileSync(aboutPath, 'utf8'));
            if (about.id === id) {
              // Mulkchilik tekshirish
              if (about.userId !== caller.uid && caller.uid !== ADMIN_UID) continue;
              about.isPublic = !!isPublic;
              fs.writeFileSync(aboutPath, JSON.stringify(about, null, 2), 'utf8');
              found = true;
            }
          } catch {}
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: found }));
    });
    return;
  }

  /* ── 404 ── */
  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`✅ MRgram Local Server — http://localhost:${PORT}`);
  console.log(`   Postlar: ${POSTS_DIR}`);
});

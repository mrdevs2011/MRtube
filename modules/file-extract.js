/* ──────────────────────────────────────────────────────────────────────
 * file-extract.js
 * ────────────────────────────────────────────────────────────────────
 * Har xil fayl formatlaridan (pdf, docx, xlsx, pptx, zip, html/css/js/txt)
 * AI tahlili uchun HAQIQIY matn mazmunini ajratib oladi.
 *
 * Kerakli kutubxonalar bundle qilinmagan loyihada bo'lgani uchun CDN
 * orqali dinamik import qilinadi (faqat shu fayl turi tanlanganda yuklanadi,
 * shuning uchun oddiy rasm/video postlar uchun hech qanday qo'shimcha
 * og'irlik bo'lmaydi).
 * ────────────────────────────────────────────────────────────────────── */

const TEXT_EXTS    = ['txt', 'html', 'htm', 'css', 'js', 'json', 'md', 'csv', 'xml', 'log'];
const IMAGE_EXTS   = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'];
const NO_PARSE_EXTS = ['exe', 'apk', 'iso', 'msi', 'dll', 'bin', 'dmg'];

const MAX_EXTRACT_CHARS = 6000; // Groq'ga yuborishdan oldin matnni shu uzunlikkacha qisqartiramiz

/* ── Xavfsizlik / yuklama limitlari ─────────────────────────────────
 * Bu limitlar AI tahlilini brauzerga (va foydalanuvchining traffigiga)
 * og'ir tushirmasligi uchun kerak. Limitdan oshgan fayllar HECH QACHON
 * to'liq yuklab olinmaydi/ochilmaydi — darhol metama'lumot rejimiga
 * o'tiladi (tezkor, network/CPU sarflamaydi).
 * ──────────────────────────────────────────────────────────────────── */
const SIZE_LIMITS = {
  text:          2  * 1024 * 1024,   // 2 MB — matn/kod fayllar
  pdf:           20 * 1024 * 1024,   // 20 MB
  docx:          15 * 1024 * 1024,   // 15 MB
  xlsx:          15 * 1024 * 1024,   // 15 MB
  pptx:          25 * 1024 * 1024,   // 25 MB
  'legacy-office': 15 * 1024 * 1024, // 15 MB
  // ZIP uchun hajm cheki yo'q — extractZipListing ichida aqlli tanlov ishlaydi
};
const ZIP_MAX_ENTRY_UNCOMPRESSED = 30 * 1024 * 1024;  // 1 ta fayl ochilganda 30 MB dan oshmasin (zip-bomb himoyasi)
const ZIP_MAX_TOTAL_UNCOMPRESSED = 150 * 1024 * 1024; // arxiv umumiy ochilgan hajmi 150 MB dan oshmasin
const ZIP_MAX_ENTRIES = 5000;                          // arxivda 5000 dan ortiq fayl bo'lsa — to'xtatamiz
const EXTRACTION_TIMEOUT_MS = 15000;                   // har qanday ajratib olish 15 soniyadan oshmasin

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} vaqt limiti (${ms / 1000}s) tugadi`)), ms)),
  ]);
}

/** Manbaning hajmini network/to'liq yuklamasdan bilish (URL bo'lsa HEAD, Blob bo'lsa .size) */
async function getSourceSize(source) {
  if (source instanceof Blob) return source.size;
  try {
    const res = await fetch(source, { method: 'HEAD' });
    const len = res.headers.get('content-length');
    return len ? parseInt(len, 10) : null;
  } catch {
    return null; // bilib bo'lmadi — keyingi bosqichda ehtiyotkorlik bilan davom etamiz
  }
}

export function getExt(name = '') {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

export function classifyFile(name, mimeType) {
  const ext = getExt(name) || (mimeType || '').split('/')[1] || '';
  if ((mimeType || '').startsWith('image/') || IMAGE_EXTS.includes(ext)) return { ext, kind: 'image' };
  if (TEXT_EXTS.includes(ext)) return { ext, kind: 'text' };
  if (ext === 'pdf') return { ext, kind: 'pdf' };
  if (ext === 'docx') return { ext, kind: 'docx' };
  if (ext === 'xlsx' || ext === 'xls') return { ext, kind: 'xlsx' }; // SheetJS eski .xls (BIFF8) ni ham o'qiy oladi
  if (ext === 'pptx') return { ext, kind: 'pptx' };
  if (ext === 'doc' || ext === 'ppt') return { ext, kind: 'legacy-office' }; // eski OLE binar format — heuristik matn ajratish
  if (ext === 'zip') return { ext, kind: 'zip' };
  if (NO_PARSE_EXTS.includes(ext)) return { ext, kind: 'binary' };
  return { ext, kind: 'unknown' };
}

function truncate(text) {
  if (!text) return '';
  text = text.trim();
  if (text.length > MAX_EXTRACT_CHARS) {
    return text.slice(0, MAX_EXTRACT_CHARS) + '\n…(fayl matni uzun bo\'lgani uchun qisqartirildi)';
  }
  return text;
}

/* ── Manbani ArrayBuffer ko'rinishida olish (URL yoki local File/Blob) ── */
async function toArrayBuffer(source) {
  if (source instanceof Blob) {
    return await source.arrayBuffer();
  }
  const res = await fetch(source);
  if (!res.ok) throw new Error('Fayl yuklab bo\'lmadi (HTTP ' + res.status + ')');
  return await res.arrayBuffer();
}

async function toText(source) {
  if (source instanceof Blob) {
    return await source.text();
  }
  const res = await fetch(source);
  if (!res.ok) throw new Error('Fayl yuklab bo\'lmadi (HTTP ' + res.status + ')');
  return await res.text();
}

/* ── PDF ─────────────────────────────────────────────────────────────── */
async function extractPdf(source) {
  const pdfjsLib = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/+esm');
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.worker.min.mjs';

  const buf = await toArrayBuffer(source);
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const maxPages = Math.min(pdf.numPages, 15); // juda katta pdf bo'lsa, birinchi 15 sahifa yetarli
  let out = '';
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    out += content.items.map(it => it.str).join(' ') + '\n';
    if (out.length > MAX_EXTRACT_CHARS) break;
  }
  return truncate(out);
}

/* ── DOCX ────────────────────────────────────────────────────────────── */
async function extractDocx(source) {
  const mammoth = await import('https://cdn.jsdelivr.net/npm/mammoth@1.8.0/+esm');
  const buf = await toArrayBuffer(source);
  const result = await mammoth.extractRawText({ arrayBuffer: buf });
  return truncate(result.value || '');
}

/* ── XLSX / XLS ──────────────────────────────────────────────────────── */
async function extractXlsx(source) {
  const XLSX = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
  const buf = await toArrayBuffer(source);
  const wb = XLSX.read(buf, { type: 'array' });
  let out = '';
  for (const sheetName of wb.SheetNames.slice(0, 5)) { // birinchi 5 varaq
    const sheet = wb.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    out += `--- Varaq: ${sheetName} ---\n${csv}\n\n`;
    if (out.length > MAX_EXTRACT_CHARS) break;
  }
  return truncate(out);
}

/* ── PPTX ────────────────────────────────────────────────────────────── */
async function extractPptx(source) {
  const JSZip = (await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm')).default;
  const buf = await toArrayBuffer(source);
  const zip = await JSZip.loadAsync(buf);

  const slideFiles = Object.keys(zip.files)
    .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = parseInt(a.match(/(\d+)/)[1], 10);
      const nb = parseInt(b.match(/(\d+)/)[1], 10);
      return na - nb;
    });

  let out = '';
  const parser = new DOMParser();
  for (const fname of slideFiles.slice(0, 30)) { // birinchi 30 slayd
    const xml = await zip.files[fname].async('text');
    const doc = parser.parseFromString(xml, 'application/xml');
    const texts = Array.from(doc.getElementsByTagName('a:t')).map(n => n.textContent).filter(Boolean);
    if (texts.length) out += `--- Slayd ${slideFiles.indexOf(fname) + 1} ---\n` + texts.join(' ') + '\n\n';
    if (out.length > MAX_EXTRACT_CHARS) break;
  }
  return truncate(out);
}

/* ── Eski .doc / .ppt (OLE binar format) ─────────────────────────────
 * Bu formatlar uchun to'liq rasmiy parser yo'q (juda murakkab struktura),
 * shu sababli HEURISTIK usul ishlatiladi: fayl baytlari ichidan o'qiladigan
 * matn bo'laklarini (ASCII va UTF-16LE) qidirib chiqib beradi. Bu 100%
 * mukammal emas (formatlash, jadval tartibi yo'qoladi), lekin faylning
 * "nima haqida" ekanini bilish uchun odatda yetarli bo'ladi.
 * ──────────────────────────────────────────────────────────────────── */
function extractPrintableStrings(bytes, minLen = 4) {
  const out = [];

  // 1) ASCII/Latin1 o'qiladigan ketma-ketliklar
  let cur = '';
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    const isPrintable = (c >= 32 && c <= 126) || c === 9;
    if (isPrintable) {
      cur += String.fromCharCode(c);
    } else {
      if (cur.length >= minLen) out.push(cur);
      cur = '';
    }
  }
  if (cur.length >= minLen) out.push(cur);

  // 2) UTF-16LE o'qiladigan ketma-ketliklar (eski Office ko'pincha shunda saqlaydi)
  let cur16 = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const lo = bytes[i], hi = bytes[i + 1];
    if (hi === 0 && lo >= 32 && lo <= 126) {
      cur16 += String.fromCharCode(lo);
    } else {
      if (cur16.length >= minLen) out.push(cur16);
      cur16 = '';
    }
  }
  if (cur16.length >= minLen) out.push(cur16);

  // Takrorlanuvchi "axlat" qatorlarni (faqat belgilar/raqamlar, mazmunsiz) filtrlash
  const cleaned = out
    .map(s => s.trim())
    .filter(s => s.length >= minLen && /[A-Za-zА-Яа-яЎўҚқҲҳ\u0400-\u04FF]{3,}/.test(s));

  // Eng uzun va mazmunli qatorlarni oldinga chiqaramiz
  cleaned.sort((a, b) => b.length - a.length);
  return Array.from(new Set(cleaned));
}

async function extractLegacyOffice(source) {
  const buf = await toArrayBuffer(source);
  const bytes = new Uint8Array(buf);
  const strings = extractPrintableStrings(bytes, 4).slice(0, 400); // juda ko'p bo'lsa cheklaymiz
  if (!strings.length) {
    return '(Faylning ichidan o\'qiladigan matn topilmadi — ehtimol u faqat rasm/jadval/formatlashdan iborat.)';
  }
  return truncate(
    '(Eslatma: bu eski .doc/.ppt format, matn heuristik usulda ajratilgan, ' +
    'tartib va formatlash yo\'qolgan bo\'lishi mumkin)\n\n' + strings.join('\n')
  );
}

/* ── ZIP: hajmni formatlash yordamchisi ─────────────────────────────── */
function fmtBytes(n) {
  if (n == null) return '?';
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
  return n + ' B';
}

/* ── ZIP: fayl muhimligini baholash (balllar tizimi) ────────────────────
 * Quyidagi mezonlar asosida har bir faylga ball beriladi:
 *   - Nom (package.json, README, main, index, app, config, server...) → +ball
 *   - Kengaytma (js, ts, py, go, java, rb, php...) → +ball
 *   - Joylashuv (root yaqin, src/ ichida...) → +ball
 *   - Hajm (juda kichik yoki juda katta bo'lmagan) → +ball
 * ──────────────────────────────────────────────────────────────────── */
function scoreZipEntry(f) {
  const name = f.name;
  const base = name.split('/').pop().toLowerCase();
  const ext  = getExt(base);
  const depth = name.split('/').length - 1;
  const sz   = f._data?.uncompressedSize || 0;
  let score  = 0;

  // Muhim nomlar
  const priorityNames = [
    'package.json', 'readme.md', 'readme.txt', 'readme',
    'index.js', 'index.ts', 'index.html', 'main.js', 'main.ts', 'main.py',
    'app.js', 'app.ts', 'app.py', 'server.js', 'server.ts', 'server.py',
    'config.js', 'config.ts', 'config.json', 'config.yaml', 'config.yml',
    'dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
    '.env.example', 'requirements.txt', 'pyproject.toml', 'cargo.toml',
    'go.mod', 'pom.xml', 'build.gradle', 'makefile', 'gemfile',
    'setup.py', 'manage.py', 'wsgi.py', 'asgi.py',
  ];
  if (priorityNames.includes(base)) score += 40;

  // Muhim kalit so'zlar nomda bo'lsa
  const keyWords = ['main', 'index', 'app', 'server', 'config', 'core', 'api', 'auth', 'route', 'model', 'schema', 'db', 'database', 'init', 'setup'];
  if (keyWords.some(k => base.includes(k))) score += 15;

  // Kod kengaytmalari
  const codeExts = ['js', 'ts', 'jsx', 'tsx', 'py', 'go', 'java', 'rb', 'php', 'cs', 'cpp', 'c', 'rs', 'swift', 'kt'];
  const configExts = ['json', 'yaml', 'yml', 'toml', 'env', 'ini', 'cfg'];
  const docExts = ['md', 'txt', 'rst'];
  if (codeExts.includes(ext))   score += 20;
  if (configExts.includes(ext)) score += 18;
  if (docExts.includes(ext))    score += 10;

  // Chuqurlik (root yaqin = muhimroq)
  if (depth === 0) score += 20;
  else if (depth === 1) score += 12;
  else if (depth === 2) score += 5;

  // Hajm (100B–100KB oralig'i ideal)
  if (sz > 100 && sz < 100 * 1024) score += 10;
  else if (sz >= 100 * 1024 && sz < ZIP_MAX_ENTRY_UNCOMPRESSED) score += 3;

  // node_modules, .git, dist, build, vendor — past prioritet
  const skipDirs = ['node_modules/', '.git/', 'dist/', 'build/', 'vendor/', '__pycache__/', '.venv/', 'venv/'];
  if (skipDirs.some(d => name.includes(d))) score -= 60;

  // Kengaytmasiz yoki binar fayllar
  if (!ext || NO_PARSE_EXTS.includes(ext) || IMAGE_EXTS.includes(ext)) score -= 20;

  return score;
}

/* ── ZIP: tree strukturasini chiroyli ko'rsatish ───────────────────────
 * Fayllar ro'yxatidan papka daraxtini qayta quradi va hajmlarini ko'rsatadi
 * ──────────────────────────────────────────────────────────────────── */
function buildTreeString(entries, maxLines = 120) {
  // Har bir yo'lni bo'laklarga ajratib daraxt hosil qilamiz
  const tree = {};
  for (const f of entries) {
    const parts = f.name.split('/');
    let node = tree;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue;
      if (!node[part]) node[part] = { _children: {}, _size: 0, _isFile: false };
      if (i === parts.length - 1) {
        node[part]._isFile = true;
        node[part]._size = f._data?.uncompressedSize || 0;
      }
      node = node[part]._children;
    }
  }

  const lines = [];
  function walk(node, prefix, depth) {
    if (lines.length >= maxLines) return;
    const keys = Object.keys(node).sort((a, b) => {
      // Papkalar oldin, keyin fayllar
      const aDir = Object.keys(node[a]._children).length > 0;
      const bDir = Object.keys(node[b]._children).length > 0;
      if (aDir !== bDir) return aDir ? -1 : 1;
      return a.localeCompare(b);
    });
    for (let i = 0; i < keys.length; i++) {
      if (lines.length >= maxLines) { lines.push(`${prefix}… (qolgan fayllar ko'rsatilmadi)`); break; }
      const key = keys[i];
      const item = node[key];
      const isLast = i === keys.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const childPrefix = prefix + (isLast ? '    ' : '│   ');
      const hasChildren = Object.keys(item._children).length > 0;
      const sizeStr = item._isFile ? ` (${fmtBytes(item._size)})` : '';
      lines.push(`${prefix}${connector}${key}${sizeStr}`);
      if (hasChildren && depth < 6) walk(item._children, childPrefix, depth + 1);
    }
  }
  walk(tree, '', 0);
  return lines.join('\n');
}

/* ── ZIP (katta fayllar uchun AQLLI tahlil) ─────────────────────────────
 * Istalgan hajmdagi ZIP uchun:
 *   1. Avval METADATA dan tree va fayllar hajmini ko'radi (tarmoqsiz)
 *   2. Muhimlik ballari asosida TOP fayllarni tanlaydi
 *   3. Faqat o'sha fayllarni (kichik bo'sa) ochib o'qiydi
 *   4. AI uchun boy kontekst tayyorlaydi
 * ZIP hajmi qancha katta bo'lmasin — barcha fayllar OCHILMAYDI,
 * faqat tanlangan muhim fayllar yuklanadi (zip-bomb xavfsiz).
 * ──────────────────────────────────────────────────────────────────── */
async function extractZipListing(source) {
  const JSZip = (await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm')).default;
  const buf = await toArrayBuffer(source);
  const zip = await JSZip.loadAsync(buf);
  const allEntries = Object.values(zip.files).filter(f => !f.dir);

  // ── Zip-bomb himoyasi: fayllar soni ──
  if (allEntries.length > ZIP_MAX_ENTRIES) {
    return `Arxivda ${allEntries.length} fayl bor — bu juda ko'p (limit: ${ZIP_MAX_ENTRIES}), `
      + `xavfsizlik uchun to'liq skanerlamaymiz. Faqat fayl nomi/hajmi asosida fikr bildirilsin.`;
  }

  // ── ZIP hajmi — katta bo'lsa ham tree va smart tanlov ishlaydi ──
  const sourceSize = await getSourceSize(source);
  const isLargeZip = sourceSize != null && sourceSize > SIZE_LIMITS.zip;

  // 1-QADAM: TREE STRUKTURASI (metadata dan, tarmoqsiz — barcha ZIP uchun)
  const treeStr = buildTreeString(allEntries, 150);
  const totalFiles = allEntries.length;
  const totalSizeUncomp = allEntries.reduce((s, f) => s + (f._data?.uncompressedSize || 0), 0);

  let out = `📦 ZIP arxivi: ${totalFiles} fayl`;
  if (sourceSize) out += `, siqilgan hajm: ${fmtBytes(sourceSize)}`;
  out += `, ochilgan hajm: ~${fmtBytes(totalSizeUncomp)}\n\n`;
  out += `📁 FAYL DARAXTI:\n${treeStr}\n`;

  // 2-QADAM: MUHIM FAYLLARNI TANLASH (balllar asosida)
  const PER_FILE_READ_LIMIT = 10 * 1024 * 1024; // har bir faylni max 10MB ga tushiramiz (ochilgandan keyin)
  const readableCandidates = allEntries
    .filter(f => {
      const ext = getExt(f.name);
      const sz  = f._data?.uncompressedSize || 0;
      return (TEXT_EXTS.includes(ext) || ['js','ts','jsx','tsx','py','go','java','rb','php','cs','cpp','c','rs','swift','kt','yaml','yml','toml','env','ini','cfg'].includes(ext))
        && sz > 0
        && sz <= PER_FILE_READ_LIMIT;
    })
    .map(f => ({ f, score: scoreZipEntry(f) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);

  // Katta ZIP bo'lsa kam fayl o'qiymiz, kichik bo'lsa ko'proq
  const MAX_FILES_TO_READ = isLargeZip ? 8 : 15;
  const PER_FILE_CHARS = isLargeZip ? 600 : 1000;
  const topFiles = readableCandidates.slice(0, MAX_FILES_TO_READ);

  if (topFiles.length === 0) {
    out += `\n(Ichida o'qiladigan kod/matn fayllari topilmadi)\n`;
    return truncate(out);
  }

  // 3-QADAM: TANLANGAN FAYLLARNI O'QISH
  out += `\n📋 AI TANLAGAN MUHIM FAYLLAR (${topFiles.length} ta, jami ${allEntries.length} dan):\n`;

  let filesRead = 0;
  for (const { f, score } of topFiles) {
    const sz = f._data?.uncompressedSize || 0;
    out += `\n▸ [${f.name}] (${fmtBytes(sz)}, muhimlik: ${score})\n`;
    try {
      let content = await withTimeout(
        f.async('text'),
        EXTRACTION_TIMEOUT_MS,
        `"${f.name}" o'qish`
      );
      if (content.length > PER_FILE_CHARS) {
        content = content.slice(0, PER_FILE_CHARS) + `\n…(+${content.length - PER_FILE_CHARS} belgi qisqartirildi)`;
      }
      out += content + '\n';
      filesRead++;
    } catch {
      out += `(o'qib bo'lmadi — vaqt tugadi yoki kodlash xatosi)\n`;
    }
    if (out.length > MAX_EXTRACT_CHARS - 200) break;
  }

  if (isLargeZip) {
    out += `\n💡 Eslatma: ZIP hajmi katta (${fmtBytes(sourceSize)}) bo'lgani uchun faqat eng muhim ${filesRead} ta fayl o'qildi. `;
    out += `To'liq tahlil uchun loyihaning muhim fayllarini alohida yuklang.\n`;
  }

  return truncate(out);
}

/* ── Asosiy export ───────────────────────────────────────────────────
 * source: URL string (yuklangan post uchun) yoki File/Blob (post hali
 *         yuklanmasdan oldingi local fayl uchun)
 * Qaytaradi: { kind, ext, text, error }
 *   kind: 'image' | 'text' | 'extracted' | 'meta' | 'binary'
 * ─────────────────────────────────────────────────────────────────── */
export async function extractFileContent(source, fileName, mimeType) {
  const { ext, kind } = classifyFile(fileName, mimeType);

  if (kind === 'image') {
    return { kind: 'image', ext, text: '' };
  }

  if (kind === 'binary') {
    return {
      kind: 'meta',
      ext,
      text: `Bu ".${ext}" — ijro etiluvchi/binar fayl. Xavfsizlik sababli AI bunday fayllarning ` +
            `ichki kodini ochib tahlil qilmaydi, faqat fayl nomi va turi asosida fikr bildiradi.`,
    };
  }

  // ── Hajm tekshiruvi: limitdan katta bo'lsa, HECH NARSA yuklab/ochmaymiz ──
  const limitKey = kind === 'text' ? 'text' : kind;
  const sizeLimit = SIZE_LIMITS[limitKey];
  if (sizeLimit) {
    const size = await getSourceSize(source);
    if (size != null && size > sizeLimit) {
      return {
        kind: 'meta',
        ext,
        text: `Fayl hajmi (${(size / 1024 / 1024).toFixed(1)} MB) tahlil limitidan (${(sizeLimit / 1024 / 1024).toFixed(0)} MB) katta — ` +
              `brauzerni va internetni ortiqcha yuklamaslik uchun ichini to'liq ochmaymiz. Faqat fayl nomi/turi/hajmi asosida fikr bildirilsin.`,
        skipped: true,
      };
    }
  }

  try {
    if (kind === 'text') {
      const text = await withTimeout(toText(source), EXTRACTION_TIMEOUT_MS, 'Matn faylni o\'qish');
      return { kind: 'extracted', ext, text: truncate(text) };
    }
    if (kind === 'pdf')  return { kind: 'extracted', ext, text: await withTimeout(extractPdf(source), EXTRACTION_TIMEOUT_MS, 'PDF tahlili') };
    if (kind === 'docx') return { kind: 'extracted', ext, text: await withTimeout(extractDocx(source), EXTRACTION_TIMEOUT_MS, 'DOCX tahlili') };
    if (kind === 'xlsx') return { kind: 'extracted', ext, text: await withTimeout(extractXlsx(source), EXTRACTION_TIMEOUT_MS, 'XLSX tahlili') };
    if (kind === 'pptx') return { kind: 'extracted', ext, text: await withTimeout(extractPptx(source), EXTRACTION_TIMEOUT_MS, 'PPTX tahlili') };
    if (kind === 'legacy-office') return { kind: 'extracted', ext, text: await withTimeout(extractLegacyOffice(source), EXTRACTION_TIMEOUT_MS, 'Eski Office tahlili') };
    if (kind === 'zip')  return { kind: 'extracted', ext, text: await withTimeout(extractZipListing(source), 60000, 'ZIP tahlili') };
  } catch (err) {
    return {
      kind: 'meta',
      ext,
      text: `Fayl mazmunini o'qishda xato/limit yuz berdi (${err.message}). Faqat fayl nomi va turi asosida fikr bildirilsin.`,
      error: err.message,
    };
  }

  // unknown kengaytma — fayl nomi/turi asosida
  return {
    kind: 'meta',
    ext,
    text: `Noma'lum fayl turi ".${ext || '?'}". Faqat fayl nomi va turi asosida fikr bildirilsin.`,
  };
}

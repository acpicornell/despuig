// Passa Tesseract (model històric spa_old) sobre cada tessel·la i recull els
// candidats a topònim amb la seva posició a la imatge mestra.
//
//   node scripts/toponims/ocr-tiles.mjs
//
// Variables d'entorn opcionals:
//   OCR_LANG  (per defecte "spa_old")   p. ex. "spa_old+cat"
//   OCR_PSM   (per defecte 11 = text dispers)
//   OCR_CONF  (confiança mínima, per defecte 35)
//
// Sortida: data/toponims/candidates.json
//
import sharp from 'sharp';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import os from 'node:os';

const exec = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const OUT = join(ROOT, 'data/toponims');
const TILES = join(OUT, 'tiles');
const TMP = join(os.tmpdir(), 'despuig-ocr');

const LANG = process.env.OCR_LANG || 'spa_old';
const PSM = process.env.OCR_PSM || '11';
const CONF_MIN = Number(process.env.OCR_CONF || 35);
const SCALE = 2; // factor d'ampliació per millorar l'OCR

const manifest = JSON.parse(await readFile(join(OUT, 'tiles.json'), 'utf8'));
await mkdir(TMP, { recursive: true });

const hasLetter = (s) => /[A-Za-zÀ-ÿ]/.test(s);
const norm = (s) => s.toLowerCase().replace(/[^a-zà-ÿ]/g, '');

async function ocrTile(t) {
  const src = join(TILES, `${t.id}.jpg`);
  const pre = join(TMP, `${t.id}.png`);
  await sharp(src)
    .grayscale()
    .normalize()
    .median(1)
    .sharpen()
    .resize({ width: Math.round(t.w * SCALE) })
    .toFile(pre);

  let stdout = '';
  try {
    ({ stdout } = await exec('tesseract', [pre, 'stdout', '-l', LANG, '--psm', PSM, '--oem', '1', 'tsv'], { maxBuffer: 1 << 24 }));
  } catch (e) {
    console.warn(`! OCR ha fallat a ${t.id}: ${e.message.split('\n')[0]}`);
    return [];
  }

  const out = [];
  for (const line of stdout.split('\n')) {
    const f = line.split('\t');
    if (f.length < 12 || f[0] !== '5') continue; // nivell 5 = paraula
    const conf = parseFloat(f[10]);
    const text = (f[11] || '').trim();
    if (!text || conf < CONF_MIN || text.length < 2 || !hasLetter(text)) continue;
    const left = +f[6], top = +f[7], w = +f[8], h = +f[9];
    out.push({
      tile: t.id,
      text,
      conf: Math.round(conf),
      x: Math.round(t.gx + left / SCALE),
      y: Math.round(t.gy + top / SCALE),
      w: Math.round(w / SCALE),
      h: Math.round(h / SCALE),
    });
  }
  return out;
}

// Pool de concurrència senzill.
async function mapPool(items, limit, fn) {
  const res = [];
  let i = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (i < items.length) {
      const idx = i++;
      res[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return res.flat();
}

console.log(`OCR amb Tesseract (-l ${LANG} --psm ${PSM}, conf≥${CONF_MIN}) sobre ${manifest.tiles.length} tessel·les…`);
let all = await mapPool(manifest.tiles, Math.max(2, os.cpus().length - 2), ocrTile);

// Dedup de solapaments: mateix text i centre a <45 px.
all.sort((a, b) => b.conf - a.conf);
const kept = [];
for (const c of all) {
  const cx = c.x + c.w / 2, cy = c.y + c.h / 2, key = norm(c.text);
  const dup = kept.find((k) => norm(k.text) === key && Math.hypot(k.x + k.w / 2 - cx, k.y + k.h / 2 - cy) < 45);
  if (!dup) kept.push(c);
}
kept.sort((a, b) => a.y - b.y || a.x - b.x);
kept.forEach((c, i) => (c.id = i + 1));

const avg = kept.length ? Math.round(kept.reduce((s, c) => s + c.conf, 0) / kept.length) : 0;
await writeFile(join(OUT, 'candidates.json'), JSON.stringify({ lang: LANG, psm: PSM, confMin: CONF_MIN, count: kept.length, items: kept }, null, 2));
console.log(`✓ ${kept.length} candidats (de ${all.length} bruts, dedup), confiança mitjana ${avg}`);
console.log('✓ data/toponims/candidates.json  →  revisa amb:  npm run toponims:review');

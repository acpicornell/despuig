// Render a context window around each recheck toponym so a vision pass can re-read
// the engraving with its neighbours visible (helps disambiguate homonyms).
//
//   node scripts/toponims/render-recheck.mjs            → render all of recheck.json
//   node scripts/toponims/render-recheck.mjs 3 17 42    → render only these ids
//
// Images: data/toponims/recheck/<id>.jpg
//
import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MASTER_REL, IMG } from '../../src/lib/frame.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const MASTER = join(ROOT, MASTER_REL);
const OUT = join(ROOT, 'data/toponims/recheck');

const HALF_W = 470, HALF_H = 320, SCALE = 1.5;  // ~940x640 window, enlarged for reading

const rows = JSON.parse(await readFile(join(ROOT, 'data/toponims/recheck.json'), 'utf8'));
const onlyIds = process.argv.slice(2).map(Number);
const todo = onlyIds.length ? rows.filter((r) => onlyIds.includes(r.id)) : rows;

await mkdir(OUT, { recursive: true });
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
for (const r of todo) {
  const left = clamp(Math.round(r.x - HALF_W), 0, IMG.w - 2 * HALF_W);
  const top = clamp(Math.round(r.y - HALF_H), 0, IMG.h - 2 * HALF_H);
  await sharp(MASTER, { limitInputPixels: false })
    .extract({ left, top, width: 2 * HALF_W, height: 2 * HALF_H })
    .resize({ width: Math.round(2 * HALF_W * SCALE) })
    .sharpen()
    .jpeg({ quality: 88 })
    .toFile(join(OUT, `${r.id}.jpg`));
}
console.log(`✓ rendered ${todo.length} recheck crops → data/toponims/recheck/`);

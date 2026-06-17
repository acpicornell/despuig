// Full-map QA: draw all merged detection boxes over a downscaled master.
//   node scripts/toponims/mapkurator/qa-fullmap.mjs [outWidth=2600]
import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MASTER_REL } from '../../../src/lib/frame.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
const BASE = join(ROOT, 'data/toponims/mapkurator');
const det = JSON.parse(readFileSync(join(BASE, 'detections.json'), 'utf8'));
const OUTW = Number(process.argv[2] || 2600);

const meta = await sharp(join(ROOT, MASTER_REL), { limitInputPixels: false }).metadata();
const s = OUTW / meta.width;
const H = Math.round(meta.height * s);

let shapes = '';
for (const d of det.detections) {
  const [x, y, w, h] = d.bbox;
  shapes += `<rect x="${(x * s).toFixed(1)}" y="${(y * s).toFixed(1)}" width="${(w * s).toFixed(1)}" height="${(h * s).toFixed(1)}" fill="none" stroke="#ff1744" stroke-width="0.7"/>`;
}
const svg = `<svg width="${OUTW}" height="${H}" xmlns="http://www.w3.org/2000/svg">${shapes}</svg>`;

mkdirSync(join(BASE, 'qa'), { recursive: true });
const out = join(BASE, 'qa', 'fullmap.png');
await sharp(join(ROOT, MASTER_REL), { limitInputPixels: false })
  .resize({ width: OUTW })
  .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
  .png().toFile(out);
console.log(`✓ ${out} — ${det.detections.length} boxes over ${OUTW}×${H}`);

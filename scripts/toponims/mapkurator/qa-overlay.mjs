// QA overlay: draw the spotter's word polygons + recognized text over a test tile.
//   node scripts/toponims/mapkurator/qa-overlay.mjs s12_c07
// Reads data/toponims/mapkurator/{in/<id>.jpg, out/<id>.json}; writes qa/<id>.png.
import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const id = process.argv[2] || 's12_c07';
const BASE = 'data/toponims/mapkurator';
const tile = join(BASE, 'in', `${id}.jpg`);
const det = JSON.parse(readFileSync(join(BASE, 'out', `${id}.json`), 'utf8'));

// pandas to_json → column-oriented: {polygon_x:{"0":[...]}, polygon_y:{...}, text, score}
const keys = Object.keys(det.polygon_x || {});
const meta = await sharp(tile).metadata();
const { width: W, height: H } = meta;

const esc = (s) => String(s).replace(/[<&>]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;' }[c]));
let shapes = '';
for (const k of keys) {
  const xs = det.polygon_x[k], ys = det.polygon_y[k];
  if (!xs || !ys) continue;
  const pts = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
  const text = esc(det.text?.[k] ?? '');
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  shapes += `<polygon points="${pts}" fill="none" stroke="#ff1744" stroke-width="3"/>`;
  shapes += `<text x="${x0.toFixed(1)}" y="${(y0 - 4).toFixed(1)}" font-size="22" fill="#00b0ff" font-family="sans-serif">${text}</text>`;
}
const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${shapes}</svg>`;

mkdirSync(join(BASE, 'qa'), { recursive: true });
const out = join(BASE, 'qa', `${id}.png`);
await sharp(tile).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toFile(out);
console.log(`✓ ${out}  —  ${keys.length} polygons over ${W}×${H}`);

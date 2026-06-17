// Phase 2 helper: build labelled contact sheets of detection crops so a single
// Claude vision call can read many words at once. Each crop has a red box around
// the TARGET word (neighbours pulled in by the margin are context only).
//
//   node scripts/toponims/mapkurator/render-montage.mjs --from 0 --count 40 [--cols 4]
//   node scripts/toponims/mapkurator/render-montage.mjs --all [--per 40]   # every montage
//
// Writes montage/<stem>.png + montage/<stem>.json (number→id). With --all also
// writes montage/index.json (stems + abs paths + counts) for the workflow driver.
import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { MASTER_REL } from '../../../src/lib/frame.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
const BASE = join(ROOT, 'data/toponims/mapkurator');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i === -1 ? d : process.argv[i + 1]; };
const ALL = process.argv.includes('--all');
const COLS = Number(arg('--cols', 4));
const PER = Number(arg('--per', 40));
const CELL_W = 460, CELL_H = 150, PAD = 8, LABEL_H = 22;
const innerW = CELL_W - PAD * 2, innerH = CELL_H - LABEL_H - PAD;

const det = JSON.parse(readFileSync(join(BASE, 'detections.json'), 'utf8'));
mkdirSync(join(BASE, 'montage'), { recursive: true });

console.log('>> decoding master once ...');
const { data, info } = await sharp(join(ROOT, MASTER_REL), { limitInputPixels: false })
  .raw().toBuffer({ resolveWithObject: true });
const raw = { width: info.width, height: info.height, channels: info.channels };

async function cellFor(d, n) {
  const [x, y, w, h] = d.bbox;
  const m = Math.round(Math.max(w, h) * 0.4) + 12;
  const left = Math.max(0, x - m), top = Math.max(0, y - m);
  const cw = Math.min(raw.width - left, w + m * 2), ch = Math.min(raw.height - top, h + m * 2);
  const resized = await sharp(data, { raw, limitInputPixels: false })
    .extract({ left, top, width: cw, height: ch })
    .resize({ width: innerW, height: innerH, fit: 'contain', background: '#fff' })
    .sharpen().png().toBuffer();
  const sc = Math.min(innerW / cw, innerH / ch);
  const ox = (innerW - cw * sc) / 2, oy = (innerH - ch * sc) / 2;
  const bx = ox + (x - left) * sc, by = oy + (y - top) * sc, bw = w * sc, bh = h * sc;
  const boxSvg = `<svg width="${innerW}" height="${innerH}"><rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="none" stroke="#ff1744" stroke-width="2"/></svg>`;
  const crop = await sharp(resized).composite([{ input: Buffer.from(boxSvg), top: 0, left: 0 }]).png().toBuffer();
  const label = `<svg width="${CELL_W}" height="${CELL_H}"><rect x="0" y="0" width="${CELL_W}" height="${CELL_H}" fill="none" stroke="#bbb" stroke-width="1"/><text x="4" y="16" font-size="15" font-family="monospace" fill="#c2185b">${n}</text></svg>`;
  return sharp({ create: { width: CELL_W, height: CELL_H, channels: 3, background: '#fff' } })
    .composite([{ input: crop, top: LABEL_H, left: PAD }, { input: Buffer.from(label), top: 0, left: 0 }])
    .png().toBuffer();
}

async function build(from, count) {
  const slice = det.detections.slice(from, from + count);
  const cells = [], map = [];
  for (let i = 0; i < slice.length; i++) {
    cells.push(await cellFor(slice[i], i + 1));
    map.push({ n: i + 1, id: slice[i].id, spotter: slice[i].text, score: slice[i].score, cx: slice[i].cx, cy: slice[i].cy });
  }
  const rows = Math.ceil(cells.length / COLS);
  const layout = cells.map((input, i) => ({ input, top: Math.floor(i / COLS) * CELL_H, left: (i % COLS) * CELL_W }));
  const stem = `${String(from).padStart(4, '0')}-${String(from + slice.length - 1).padStart(4, '0')}`;
  await sharp({ create: { width: COLS * CELL_W, height: rows * CELL_H, channels: 3, background: '#fff' } })
    .composite(layout).png().toFile(join(BASE, 'montage', `${stem}.png`));
  writeFileSync(join(BASE, 'montage', `${stem}.json`), JSON.stringify({ from, cols: COLS, items: map }, null, 2));
  return { stem, from, count: slice.length, png: resolve(BASE, 'montage', `${stem}.png`), read: resolve(BASE, 'read', `${stem}.json`) };
}

if (ALL) {
  const total = det.detections.length;
  const index = [];
  for (let from = 0; from < total; from += PER) {
    const e = await build(from, PER);
    index.push(e);
    if (index.length % 10 === 0) console.log(`   ${index.length} montages (${from + e.count}/${total})`);
  }
  writeFileSync(join(BASE, 'montage', 'index.json'), JSON.stringify({ total, per: PER, base: resolve(BASE), count: index.length, montages: index }, null, 2));
  console.log(`✓ ${index.length} montages → montage/  (index.json)`);
} else {
  const e = await build(Number(arg('--from', 0)), Number(arg('--count', 40)));
  console.log(`✓ montage/${e.stem}.png + .json`);
}

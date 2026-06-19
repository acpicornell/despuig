// Phase 1 tiler for the mapKurator spotter: cut the MAP interior into overlapping
// patches. Overlap lets a word cut at one patch edge be whole in a neighbour;
// merge-detections.mjs dedups by polygon IoU afterwards.
//
//   node scripts/toponims/mapkurator/pretile.mjs
//
// Writes patch JPEGs to data/toponims/mapkurator/in/ and a manifest with each
// patch's master offset (gx,gy) + scale to data/toponims/mapkurator/patches.json.
//
// Sizing mirrors the proven Phase-0 setup: ~1100 px master patch, ×2 upscale +
// sharpen → the spotter resizes the short side to ~1600 (MIN_SIZE_TEST), i.e.
// ~1.6× the master resolution — the scale at which it read this engraving well.
import sharp from 'sharp';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
// Per-sheet pipeline: always tile a quadrant's masked canvas, passed via MK_MASTER
// (e.g. data/jpg/SE/despuig-1785-original-SE-canvas.jpg). The sea/decoration is
// painted out there, so no engraved decoration leaks into the spotter.
if (!process.env.MK_MASTER) {
  console.error('Set MK_MASTER to the sheet canvas, e.g. MK_MASTER=data/jpg/SE/despuig-1785-original-SE-canvas.jpg');
  process.exit(1);
}
const MASTER = join(ROOT, process.env.MK_MASTER);
const BASE = join(ROOT, 'data/toponims/mapkurator');
const IN = join(BASE, process.env.MK_INDIR || 'in');             // per-sheet: e.g. MK_INDIR=nw/in

const PATCH = 1100;          // master px per patch (short of the proven 1168)
const OVERLAP = 0.28;        // fraction → boundary words survive whole somewhere
const SCALE = 2;            // upscale + sharpen, as in Phase 0
const stride = Math.round(PATCH * (1 - OVERLAP));
// real pixel dimensions of the image being tiled — works for the master OR a sheet
// crop (the old code assumed frame.mjs IMG, which is wrong for a crop).
const { width: MW, height: MH } = await sharp(MASTER, { limitInputPixels: false }).metadata();

// Tiling region. We tile the FULL image by default: coastal toponyms (and the
// southern capes) sit in the band between the inner MAP frame and the paper edge,
// so the old MAP-only crop truncated them. The masked detection master makes this
// safe — everything outside the drawing is painted out, so no decoration leaks in.
// MK_REGION picks the box:
//   FULL  → the entire image (default; the sheet canvas is already cropped)
//   "x,y,w,h" → an explicit box in image px
function pickRegion() {
  const r = process.env.MK_REGION || 'FULL';
  if (r === 'FULL') return { x: 0, y: 0, w: MW, h: MH };
  const [x, y, w, h] = r.split(',').map(Number);
  return { x, y, w, h };
}
const { x: X, y: Y, w: W, h: H } = pickRegion();
console.log(`>> tiling region: x=${X} y=${Y} w=${W} h=${H}`);

function patches() {
  const list = [];
  // last origin so the final patch still ends inside the region
  const lastX = X + W - PATCH, lastY = Y + H - PATCH;
  const xs = [], ys = [];
  for (let x = X; x < lastX; x += stride) xs.push(x);
  xs.push(lastX);
  for (let y = Y; y < lastY; y += stride) ys.push(y);
  ys.push(lastY);
  let r = 0;
  for (const gy of ys) {
    let c = 0;
    for (const gx of xs) {
      const left = Math.max(0, Math.round(gx));
      const top = Math.max(0, Math.round(gy));
      const w = Math.min(PATCH, X + W - left);
      const h = Math.min(PATCH, Y + H - top);
      list.push({ id: `p${String(r).padStart(2, '0')}_${String(c).padStart(2, '0')}`, row: r, col: c, gx: left, gy: top, w, h, scale: SCALE });
      c++;
    }
    r++;
  }
  return list;
}

console.log('>> decoding master once into RAM ...');
const { data, info } = await sharp(MASTER, { limitInputPixels: false })
  .raw().toBuffer({ resolveWithObject: true });
console.log(`   master ${info.width}×${info.height}×${info.channels}`);
const raw = { width: info.width, height: info.height, channels: info.channels };

const all = patches();
await rm(IN, { recursive: true, force: true });
await mkdir(IN, { recursive: true });

let n = 0;
for (const p of all) {
  await sharp(data, { raw, limitInputPixels: false })
    .extract({ left: p.gx, top: p.gy, width: p.w, height: p.h })
    .resize({ width: Math.round(p.w * SCALE) })
    .sharpen()
    .jpeg({ quality: 88 })
    .toFile(join(IN, `${p.id}.jpg`));
  if (++n % 40 === 0) console.log(`   ${n}/${all.length}`);
}

await writeFile(join(BASE, process.env.MK_PATCHES || 'patches.json'), JSON.stringify({
  master: MASTER, region: { x: X, y: Y, w: W, h: H }, dims: { w: MW, h: MH },
  patch: PATCH, overlap: OVERLAP, stride, scale: SCALE,
  count: all.length, patches: all,
}, null, 2));
console.log(`✓ ${all.length} patches → ${IN}`);

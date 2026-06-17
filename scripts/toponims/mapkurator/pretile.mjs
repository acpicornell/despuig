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
import { MAP_REGION, OUTER, IMG } from '../../../src/lib/frame.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
// Detection master: a masked copy of the original where the cartouches, border
// vignettes and surrounding sea are painted out (opaque red). Same pixel
// dimensions as the original, so all geometry below stays valid. We tile from
// this — NOT from the canonical MASTER_REL — so the spotter never sees the
// engraved decorations; the clean original is still what display/DZI use.
// Override with MK_MASTER to tile a different file.
const DETECTION_MASTER = 'data/jpg/despuig-1785-original-marked1.jpg';
const MASTER = join(ROOT, process.env.MK_MASTER || DETECTION_MASTER);
const BASE = join(ROOT, 'data/toponims/mapkurator');
const IN = join(BASE, 'in');

const PATCH = 1100;          // master px per patch (short of the proven 1168)
const OVERLAP = 0.28;        // fraction → boundary words survive whole somewhere
const SCALE = 2;            // upscale + sharpen, as in Phase 0
const stride = Math.round(PATCH * (1 - OVERLAP));

// Tiling region. We tile the FULL image by default: coastal toponyms (and the
// southern capes) sit in the band between the inner MAP frame and the paper edge,
// so the old MAP-only crop truncated them. The masked detection master makes this
// safe — everything outside the drawing is painted out, so no decoration leaks in.
// MK_REGION picks the box:
//   FULL  → the entire image (default)
//   OUTER → outer edge of the engraving (skips the black scan margin)
//   MAP   → inner map frame only (legacy; clips coastal names)
//   "x,y,w,h" → an explicit box in master px
function pickRegion() {
  const r = process.env.MK_REGION || 'FULL';
  if (r === 'MAP') return MAP_REGION;
  if (r === 'OUTER') return { x: OUTER.l, y: OUTER.t, w: OUTER.r - OUTER.l, h: OUTER.b - OUTER.t };
  if (r === 'FULL') return { x: 0, y: 0, w: IMG.w, h: IMG.h };
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
      const w = Math.min(PATCH, IMG.w - left);
      const h = Math.min(PATCH, IMG.h - top);
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

await writeFile(join(BASE, 'patches.json'), JSON.stringify({
  region: MAP_REGION, patch: PATCH, overlap: OVERLAP, stride, scale: SCALE,
  count: all.length, patches: all,
}, null, 2));
console.log(`✓ ${all.length} patches → data/toponims/mapkurator/in/  (manifest: patches.json)`);

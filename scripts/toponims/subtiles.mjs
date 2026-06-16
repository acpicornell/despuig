// Graella fina de l'interior del mapa per a la lectura assistida per IA (visió).
// Cada cel·la es renderitza ampliada perquè la cal·ligrafia gravada sigui llegible.
//
//   node scripts/toponims/subtiles.mjs                 → escriu el manifest
//   node scripts/toponims/subtiles.mjs --render s03_c05 → renderitza una cel·la
//   node scripts/toponims/subtiles.mjs --render all     → renderitza totes (~180)
//
// Manifest: data/toponims/subtiles.json   ·   Imatges: data/toponims/sub/<id>.jpg
//
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MAP_REGION, IMG, MASTER_REL } from '../../src/lib/frame.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const MASTER = join(ROOT, MASTER_REL);
const OUT = join(ROOT, 'data/toponims');
const SUB = join(OUT, 'sub');

const COLS = 13;
const ROWS = 14;
const OVERLAP = 70;
const SCALE = 3; // ampliació per a la lectura

const { x: X, y: Y, w: W, h: H } = MAP_REGION;
const cellW = Math.ceil(W / COLS) + OVERLAP;
const cellH = Math.ceil(H / ROWS) + OVERLAP;
const stepX = (W - cellW) / (COLS - 1);
const stepY = (H - cellH) / (ROWS - 1);

function cells() {
  const list = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const gx = Math.round(X + c * stepX);
      const gy = Math.round(Y + r * stepY);
      const w = Math.min(cellW, IMG.w - gx);
      const h = Math.min(cellH, IMG.h - gy);
      list.push({ id: `s${String(r).padStart(2, '0')}_c${String(c).padStart(2, '0')}`, row: r, col: c, gx, gy, w, h });
    }
  }
  return list;
}

async function render(cell) {
  await mkdir(SUB, { recursive: true });
  await sharp(MASTER, { limitInputPixels: false })
    .extract({ left: cell.gx, top: cell.gy, width: cell.w, height: cell.h })
    .resize({ width: Math.round(cell.w * SCALE) })
    .sharpen()
    .jpeg({ quality: 88 })
    .toFile(join(SUB, `${cell.id}.jpg`));
}

const all = cells();
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, 'subtiles.json'), JSON.stringify({
  region: MAP_REGION, grid: { cols: COLS, rows: ROWS, overlap: OVERLAP, scale: SCALE },
  cellMaster: { w: cellW, h: cellH }, cells: all,
}, null, 2));
console.log(`✓ manifest: ${all.length} cel·les (${COLS}×${ROWS}, ${cellW}×${cellH} px, ×${SCALE}) → data/toponims/subtiles.json`);

const arg = process.argv.indexOf('--render');
if (arg !== -1) {
  const which = process.argv[arg + 1];
  const targets = which === 'all' ? all : all.filter((c) => c.id === which);
  if (!targets.length) { console.error(`Cap cel·la "${which}"`); process.exit(1); }
  for (const c of targets) { await render(c); console.log(`  ✓ ${c.id}  master ${c.gx},${c.gy} ${c.w}×${c.h}`); }
}

// Trosseja l'interior del mapa (sense el marc de viñetas) en tessel·les solapades,
// llegibles i tractables per l'OCR i per la revisió manual.
//
//   node scripts/toponims/tile-map.mjs
//
// Sortida: data/toponims/tiles/rNN_cNN.jpg  +  data/toponims/tiles.json
//
import sharp from 'sharp';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MAP_REGION, IMG } from '../../src/lib/frame.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const MASTER = join(ROOT, 'data/jpg/T0023524.jpg');
const OUT = join(ROOT, 'data/toponims');
const TILES = join(OUT, 'tiles');

// Graella i solapament (en píxels de la imatge mestra).
const COLS = 6;
const ROWS = 5;
const OVERLAP = 180;

const { x: X, y: Y, w: W, h: H } = MAP_REGION;
const tileW = Math.ceil(W / COLS) + OVERLAP;
const tileH = Math.ceil(H / ROWS) + OVERLAP;
const stepX = COLS > 1 ? (W - tileW) / (COLS - 1) : 0;
const stepY = ROWS > 1 ? (H - tileH) / (ROWS - 1) : 0;

await rm(TILES, { recursive: true, force: true });
await mkdir(TILES, { recursive: true });

const tiles = [];
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const gx = Math.round(X + c * stepX);
    const gy = Math.round(Y + r * stepY);
    const w = Math.min(tileW, IMG.w - gx);
    const h = Math.min(tileH, IMG.h - gy);
    const id = `r${String(r).padStart(2, '0')}_c${String(c).padStart(2, '0')}`;
    await sharp(MASTER, { limitInputPixels: false })
      .extract({ left: gx, top: gy, width: w, height: h })
      .jpeg({ quality: 90 })
      .toFile(join(TILES, `${id}.jpg`));
    tiles.push({ id, row: r, col: c, gx, gy, w, h });
  }
}

const manifest = {
  master: { w: IMG.w, h: IMG.h },
  region: MAP_REGION,
  grid: { cols: COLS, rows: ROWS, overlap: OVERLAP },
  tiles,
};
await writeFile(join(OUT, 'tiles.json'), JSON.stringify(manifest, null, 2));
console.log(`✓ ${tiles.length} tessel·les (${COLS}×${ROWS}, ${tileW}×${tileH} px) → data/toponims/tiles/`);
console.log('✓ data/toponims/tiles.json');

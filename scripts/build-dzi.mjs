// Genera les tessel·les Deep Zoom (DZI) de la imatge mestra per a OpenSeadragon.
// Sortida: public/map/mapa.dzi  +  public/map/mapa_files/
//
//   node scripts/build-dzi.mjs
//
import sharp from 'sharp';
import { mkdir, rm, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MASTER_REL } from '../src/lib/frame.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MASTER = join(ROOT, MASTER_REL);
const OUT = join(ROOT, 'public/map');

await mkdir(OUT, { recursive: true });

console.log('Generant tessel·les DZI (pot trigar una mica)…');
// sharp genera "mapa.dzi" + "mapa_files" a partir del nom base "mapa".
await rm(join(OUT, 'mapa.dzi'), { force: true });
await rm(join(OUT, 'mapa_files'), { recursive: true, force: true });
await sharp(MASTER, { limitInputPixels: false })
  .tile({ size: 256, overlap: 1, layout: 'dz' })
  .toFile(join(OUT, 'mapa'));
console.log('✓ public/map/mapa.dzi + mapa_files/');

// Còpia lleugera per a la portada (marc interactiu) i còpia íntegra per a la descàrrega/fallback.
await sharp(MASTER, { limitInputPixels: false })
  .resize({ width: 2200 }).jpeg({ quality: 82 })
  .toFile(join(OUT, 'mapa-web.jpg'));
console.log('✓ public/map/mapa-web.jpg');

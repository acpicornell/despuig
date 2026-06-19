#!/usr/bin/env node
// Genera la imatge del hero de la portada: un retall ample del gravat original
// (banda nord — Serra de Tramuntana, "MEDITERRANEO", la rosa dels vents i l'inset
// de Cabrera) des del màster a alta resolució. Sortida gitignored i regenerable.
//
//   cd web && npm run hero

import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const SRC = join(ROOT, 'data/jpg/despuig-1785-original.jpg');
const OUT_DIR = resolve(HERE, '..', 'public', 'hero');
const OUT = join(OUT_DIR, 'mapa-hero.jpg');

// Retall en fraccions del màster (banda nord).
const REGION = { left: 0.06, top: 0.07, width: 0.88, height: 0.30 };
const WIDTH = 2400;
const QUALITY = 82;

mkdirSync(OUT_DIR, { recursive: true });

const img = sharp(SRC, { limitInputPixels: false });
const { width: W, height: H } = await img.metadata();
await sharp(SRC, { limitInputPixels: false })
  .extract({
    left: Math.round(W * REGION.left),
    top: Math.round(H * REGION.top),
    width: Math.round(W * REGION.width),
    height: Math.round(H * REGION.height),
  })
  .resize({ width: WIDTH, withoutEnlargement: true })
  .jpeg({ quality: QUALITY, mozjpeg: true })
  .toFile(OUT);

console.log(`✓ hero → web/public/hero/mapa-hero.jpg (amplada ${WIDTH}px, q${QUALITY})`);

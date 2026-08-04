#!/usr/bin/env node
// Copia les vinyetes netes (data/jpg/pobles/...) a web/public/vinetes/<slug>.jpg,
// re-escalades a pes web. Llegeix el mapatge slug→fitxer ja resolt a
// web/src/data/pobles.json (per build-data.mjs), així la reconciliació viu en un
// sol lloc. Sortida gitignored i regenerable.
//
//   cd web && npm run vinetes

import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const SRC_DIR = join(ROOT, 'data/jpg/pobles');
const OUT_DIR = resolve(HERE, '..', 'public', 'vinetes');
const WIDTH = 1000;
const QUALITY = 82;

const pobles = JSON.parse(readFileSync(resolve(HERE, '..', 'src', 'data', 'pobles.json'), 'utf8')).pobles;
mkdirSync(OUT_DIR, { recursive: true });

let done = 0;
const skipped = [];
for (const p of pobles) {
  // Sense font local (data/jpg/ no es versiona): es conserva la vinyeta ja
  // construïda que hi hagi a public/vinetes/ en comptes de petar.
  if (!p.vinyetaFile || !existsSync(join(SRC_DIR, p.vinyetaFile))) {
    skipped.push(p.slug);
    continue;
  }
  const inFile = join(SRC_DIR, p.vinyetaFile);
  const outFile = join(OUT_DIR, `${p.slug}.jpg`);
  await sharp(inFile)
    .resize({ width: WIDTH, withoutEnlargement: true })
    .jpeg({ quality: QUALITY, mozjpeg: true })
    .toFile(outFile);
  done++;
}

console.log(`✓ ${done} vinyetes → web/public/vinetes/ (amplada ${WIDTH}px, q${QUALITY})`);
if (skipped.length) console.log(`  ⚠ sense fitxer: ${skipped.join(', ')}`);

#!/usr/bin/env node
// Genera un Deep Zoom (DZI) per cada full del gravat (NW/NE/SE/SW) a partir dels
// canvas per quadrant que ja existeixen. Els topònims porten la seva posició (x,y)
// EN AQUEST espai de píxel, així que en pitjar-los a la taula el visor pot saltar
// exactament al lloc — sense matemàtica d'offset/rotació.
//
// Sortida gitignored i regenerable; lenta (~6000 tessel·les en total), per això NO
// va al prebuild — executa-la quan canviïn els canvas:
//
//   cd web && npm run sheets

import { mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const OUT = resolve(HERE, '..', 'public', 'sheets');

// Font NETA per quadrant (sense la màscara vermella del mar; mateixes dimensions
// que el -canvas.jpg, així els (x,y) dels topònims hi encaixen igual).
//   SE/SW: export net complet · NE: net de màscara (porta uns punts blaus minúsculs)
//   NW: ⚠ NO hi ha export net encara → cau al canvas emmascarat fins que se'n generi un.
// Per quadrant, candidats en ordre de preferència; s'agafa el primer que existeix.
// 1r = gravat NET (sense màscara ni punts, mateixes dimensions que el canvas) ·
// 2n = canvas emmascarat (fallback, no desitjat al visor).
const SRC = Object.fromEntries(
  ['nw', 'ne', 'se', 'sw'].map((k) => {
    const Q = k.toUpperCase();
    return [k, [`${Q}/despuig-1785-original-${Q}.jpg`, `${Q}/despuig-1785-original-${Q}-canvas.jpg`]];
  })
);
// Opcional: limitar a uns quadrants  ->  npm run sheets -- se sw ne
const only = process.argv.slice(2).map((s) => s.toLowerCase());
const SHEETS = Object.entries(SRC)
  .filter(([k]) => !only.length || only.includes(k))
  .map(([key, cands]) => {
    const rel = cands.find((c) => existsSync(join(ROOT, 'data/jpg', c))) ?? cands[cands.length - 1];
    return { key, img: join(ROOT, 'data/jpg', rel), rel };
  });

await mkdir(OUT, { recursive: true });

for (const s of SHEETS) {
  await rm(join(OUT, `${s.key}.dzi`), { force: true });
  await rm(join(OUT, `${s.key}_files`), { recursive: true, force: true });
  const meta = await sharp(s.img, { limitInputPixels: false }).metadata();
  console.log(`Generant DZI ${s.key.toUpperCase()} (${meta.width}×${meta.height}) ← ${s.rel}`);
  await sharp(s.img, { limitInputPixels: false })
    .tile({ size: 256, overlap: 1, layout: 'dz' })
    .toFile(join(OUT, s.key));
}
console.log(`✓ web/public/sheets/{nw,ne,se,sw}.dzi + *_files/`);

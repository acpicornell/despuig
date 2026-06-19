#!/usr/bin/env node
// Genera les tessel·les Deep Zoom (DZI) del màster de 1785 per a OpenSeadragon
// (pestanya Mapa → vista "El gravat"). Sortida gitignored i regenerable; lenta
// (~6000 tessel·les), per això NO va al prebuild — executa-la quan canviï el màster:
//
//   cd web && npm run map

import { mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const MASTER = join(ROOT, 'data/jpg/despuig-1785-original.jpg');
const OUT = resolve(HERE, '..', 'public', 'map');

await mkdir(OUT, { recursive: true });
await rm(join(OUT, 'mapa.dzi'), { force: true });
await rm(join(OUT, 'mapa_files'), { recursive: true, force: true });

console.log('Generant tessel·les DZI del màster (pot trigar)…');
await sharp(MASTER, { limitInputPixels: false })
  .tile({ size: 256, overlap: 1, layout: 'dz' })
  .toFile(join(OUT, 'mapa'));
console.log('✓ web/public/map/mapa.dzi + mapa_files/');

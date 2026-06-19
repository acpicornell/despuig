#!/usr/bin/env node
// Retalla la CARTEL·LA (bloc de text inferior, en dues columnes al voltant del
// segell central) de cada vinyeta de poble, en dues meitats L/R a resolució
// NATIVA. Un retall <~0.4 MP no el redueix l'eina Read, així el text gravat
// queda llegible per a la transcripció (el frame sencer sí que es reduïa).
// Sortida: data/cartelles-1785/crops/<slug>-L.jpg i -R.jpg
//
//   cd web && nix-shell -p nodejs --run "node scripts/crop-cartelles.mjs"

import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const SRC = join(ROOT, 'data/jpg/pobles');
const OUT = join(ROOT, 'data/cartelles-1785/crops');
mkdirSync(OUT, { recursive: true });

// Fracció vertical on comença el bloc de text, i talls de columna (amb solapament
// al centre per no perdre lletres vora el segell).
const TOP = 0.60;
const LEFT_END = 0.57;
const RIGHT_START = 0.43;

const TOWNS = [
  ['selva', 'despuig-1785-original-selva.jpg'],
  ['campanet', 'despuig-1785-original-campanet.jpg'],
  ['lluc', 'despuig-1785-original-lluch.jpg'],
  ['pollensa', 'despuig-1785-original-pollensa.jpg'],
  ['alcudia', 'fusion_alcudia.jpg'],
  ['la-puebla', 'despuig-1785-original-sapobla.jpg'],
  ['muro', 'despuig-1785-original-muro.jpg'],
  ['arta', 'despuig-1785-original-arta.jpg'],
  ['manacor', 'despuig-1785-original-manacor.jpg'],
  ['petra', 'despuig-1785-original-petra.jpg'],
  ['santa-margarita', 'despuig-1785-original-stamargalida.jpg'],
  ['sancellas', 'despuig-1785-original-sencelles.jpg'],
  ['sineu', 'despuig-1785-original-sineu.jpg'],
  ['san-juan', 'despuig-1785-original-stjoan.jpg'],
  ['montuiri', 'despuig-1785-original-montuiri.jpg'],
  ['porreras', 'despuig-1785-original-porreres.jpg'],
  ['felanitx', 'despuig-1785-original-felanitx.jpg'],
  ['andraitx', 'despuig-1785-original-andratx.jpg'],
  ['calvia', 'despuig-1785-original-calvia.jpg'],
  ['santa-maria', 'despuig-1785-original-stamaria.jpg'],
  ['marratxi', 'fusion_marratxi.jpg'],
  ['palma', 'despuig-1785-original-palma.jpg'],
  ['algaida', 'despuig-1785-original-algaida.jpg'],
  ['llucmayor', 'despuig-1785-original-llucmajor.jpg'],
  ['campos', 'despuig-1785-original-campos.jpg'],
  ['santani', 'despuig-1785-original-santani.jpg'],
  ['inca', 'despuig-1785-original-inca.jpg'],
  ['binisalem', 'despuig-1785-original-binissalem.jpg'],
  ['soller', 'despuig-1785-original-soller.jpg'],
  ['alaro', 'despuig-1785-original-alaro.jpg'],
  ['bunola', 'despuig-1785-original-bunola.jpg'],
  ['valldemusa', 'despuig-1785-original-valldemossa.jpg'],
  ['esporlas', 'despuig-1785-original-esporles.jpg'],
  ['puigpunyent', 'despuig-1785-original-puigpunyent.jpg'],
  ['banyalbufar', 'despuig-1785-original-banyalbufar.jpg'],
  ['deia', 'despuig-1785-original-deia.jpg'],
];

const only = process.argv[2]; // opcional: un sol slug per provar
let n = 0;
for (const [slug, img] of TOWNS) {
  if (only && slug !== only) continue;
  const src = join(SRC, img);
  const meta = await sharp(src).metadata();
  const W = meta.width, H = meta.height;
  const top = Math.round(H * TOP);
  const stripH = H - top;
  const leftW = Math.round(W * LEFT_END);
  const rightX = Math.round(W * RIGHT_START);
  await sharp(src).extract({ left: 0, top, width: leftW, height: stripH }).jpeg({ quality: 92 }).toFile(join(OUT, `${slug}-L.jpg`));
  await sharp(src).extract({ left: rightX, top, width: W - rightX, height: stripH }).jpeg({ quality: 92 }).toFile(join(OUT, `${slug}-R.jpg`));
  n++;
}
console.log(`✓ ${n} cartel·les retallades (L/R) → data/cartelles-1785/crops/  (TOP=${TOP}, talls ${LEFT_END}/${RIGHT_START})`);

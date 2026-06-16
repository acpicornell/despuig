// Acobla els fitxers per cel·la (data/toponims/cells/*.json) en el lliurable
// data/toponims/toponims.json, amb ids seqüencials i la llista de cel·les fetes.
//
//   node scripts/toponims/merge.mjs
//
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', '..', 'data/toponims');
const CELLS = join(OUT, 'cells');

const manifest = JSON.parse(await readFile(join(OUT, 'subtiles.json'), 'utf8'));
const cellById = Object.fromEntries(manifest.cells.map((c) => [c.id, c]));

const files = (await readdir(CELLS)).filter((f) => f.endsWith('.json')).sort();
const done = [];
let items = [];
for (const f of files) {
  const cell = JSON.parse(await readFile(join(CELLS, f), 'utf8'));
  const c = cellById[cell.subtile];
  done.push(cell.subtile);
  for (const t of cell.toponims) {
    // fx,fy: fracció [0,1] dins la cel·la → coordenades a la imatge mestra.
    const x = Math.round(c.gx + (t.fx ?? 0.5) * c.w);
    const y = Math.round(c.gy + (t.fy ?? 0.5) * c.h);
    const { fx, fy, ...rest } = t;
    items.push({ ...rest, subtile: cell.subtile, x, y });
  }
}
// Drop tiling leftovers: bare articles/prefixes ("La", "Câ", "Sô", "Ses") or
// 1-2 char shards ("ó", "Pu", "AR") that are halves of names cut at a cell edge,
// not real toponyms.
const ARTICLE_ONLY = new Set([
  'la', 'el', 'les', 'els', 'es', 'sa', 'ses', 'sos', 'ca', 'can', 'cas',
  'so', 'son', 's', 'd', 'de', 'del', 'na', 'en', 'lo', 'ne', 'y', 'i', 'sc', 'sd',
]);
const alnum = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
const isFragment = (graf) => {
  if (alnum(graf).length <= 2) return true;
  const toks = (graf || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  return toks.length > 0 && toks.every((t) => ARTICLE_ONLY.has(t));
};
const dropped = items.filter((t) => isFragment(t.nom) && isFragment(t.graf));
items = items.filter((t) => !(isFragment(t.nom) && isFragment(t.graf)));

// Dedup de solapaments entre cel·les: mateix nom normalitzat i a < 180 px.
const normName = (s) => s.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
items.sort((a, b) => (a.y - b.y) || (a.x - b.x));
const deduped = [];
for (const t of items) {
  const k = normName(t.nom);
  const dup = deduped.find((u) => normName(u.nom) === k && Math.hypot(u.x - t.x, u.y - t.y) < 180);
  if (dup) { if (!t.dubte && dup.dubte) Object.assign(dup, t); continue; }
  deduped.push(t);
}
items = deduped;
items.forEach((t, i) => (t.id = i + 1));

const out = {
  font: 'Buidatge dels topònims del Mapa de la Isla de Mallorca del Cardenal Despuig (reedició reduïda, ca. 1829), llegits per IA de visió sobre l\'escaneig d\'alta resolució de l\'IGN (fitxa 32-H-18) i pendents de revisió manual.',
  esquema: {
    nom: 'normalització moderna en català (quan és segura)',
    graf: 'grafia tal com apareix gravada al mapa',
    tipus: 'possessió | nucli | hidrònim | orònim | costa | altre',
    subtile: 'cel·la de subtiles.json on apareix',
    x: 'coordenada x (px) a la imatge mestra (aproximada)',
    y: 'coordenada y (px) a la imatge mestra (aproximada)',
    dubte: 'true si la lectura és incerta',
  },
  comptador: { cel·les: done.length, toponims: items.length, dubtes: items.filter((t) => t.dubte).length },
  done: done.sort(),
  toponims: items,
};
await writeFile(join(OUT, 'toponims.json'), JSON.stringify(out, null, 2));
console.log(`✓ ${items.length} topònims de ${done.length} cel·les → data/toponims/toponims.json (${out.comptador.dubtes} dubtes, ${dropped.length} fragments descartats)`);

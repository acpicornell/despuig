#!/usr/bin/env node
// Capa de dades de la web nova, ADDITIVA per quadrant. Genera dos fitxers
// (gitignored; el CI els regenera amb `npm run data`) que el lloc Astro importa:
//
//   web/src/data/toponims.json  — tots els topònims dels quadrants acabats,
//                                 amb id prefixat per quadrant i el match NGIB.
//   web/src/data/pobles.json    — els pobles del mapa ORIGINAL de 1785: dades
//                                 factuals llegides de les cartel·les (1785) +
//                                 coords autoritatives (gcps) + vinyeta neta +
//                                 resum/notes editorials (català) de pobles-editorial.json.
//
// FONT DELS FETS = les cartel·les de 1785 (data/cartelles-1785/extract.json), NO
// les xifres de la reedició de 1826; src/data/pobles-editorial.json només aporta el
// text divulgatiu en català. NO toca cap dada global/abandonada.
//
//   cd web && npm run data

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { QUADRANTS } from './quadrants.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const OUT = resolve(HERE, '..', 'src', 'data');
const VINYETES_DIR = 'data/jpg/pobles';                                       // font local (no versionada)
const VINYETES_OUT = resolve(HERE, '..', 'public', 'vinetes');                // sortida servida (versionada)

const rd = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
const DIACRITICS = /[̀-ͯ]/g;
const norm = (s) =>
  (s || '')
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// ─── 1. Topònims: merge dels quadrants (id prefixat) + join amb el match ───
const toponims = [];
const perQuadrant = {};
// Two axes: `decision` = algorithmic confidence; `review` = human layer (orthogonal).
const perDecision = {};
const perReview = {};
let descartats = 0;   // misreads marked as trash in curation (dropped from matches.json)
for (const q of QUADRANTS) {
  const topo = rd(q.topo).toponims;
  const matches = rd(q.matches);
  const matchById = new Map(matches.map((m) => [m.id, m]));
  let n = 0;
  for (const t of topo) {
    // matches.json is the curated set: bake.py drops trashed toponyms from it but
    // leaves them in toponims.json. Skip those so the public site never shows garbage.
    if (!matchById.has(t.id)) { descartats++; continue; }
    const m = matchById.get(t.id);
    const decision = m.decision || 'sense';
    const review = m.review ?? null;
    toponims.push({
      uid: `${q.key}:${t.id}`,
      q: q.key,
      id: t.id,
      nom: t.nom,
      graf: t.graf,
      tipus: Array.isArray(t.tipus) ? t.tipus : (t.tipus ? [t.tipus] : []),   // multi-value
      ordre: Array.isArray(t.ordre) ? t.ordre : (t.ordre ? [t.ordre] : []),   // religious order(s)
      subtile: t.subtile ?? '',
      dubte: !!t.dubte,
      x: t.x,
      y: t.y,
      lon: t.lon ?? null,
      lat: t.lat ?? null,
      decision,
      review,
      ngib: m.ngib ?? null,
      municipi: m.municipi ?? null,
      sim: m.sim ?? null,
      km: m.km ?? null,
    });
    n++;
    perDecision[decision] = (perDecision[decision] || 0) + 1;
    if (review) perReview[review] = (perReview[review] || 0) + 1;
  }
  perQuadrant[q.key] = n;
}

mkdirSync(OUT, { recursive: true });
writeFileSync(
  join(OUT, 'toponims.json'),
  JSON.stringify(
    {
      font: 'Topònims del mapa de Despuig (1785), pipeline per-sheet: spotter mapKurator + lectura Claude vision + georef + match NGIB. Dos eixos: confiança (decision) + revisió a mà (review).',
      quadrants: QUADRANTS.map((q) => q.key),
      comptador: { total: toponims.length, perQuadrant, perDecision, perReview, descartats },
      toponims,
    },
    null,
    1,
  ),
);

// ─── 2. Coords autoritatives (gcps interior = dots de poble immutables, NGIB) ───
const gcpByNorm = new Map();
for (const q of QUADRANTS) {
  const g = rd(q.gcps);
  for (const pt of [...(g.interior || []), ...(g.coast || [])]) {
    const k = norm(pt.town);
    if (!gcpByNorm.has(k)) gcpByNorm.set(k, { lat: pt.lat, lng: pt.lng, q: q.key });
  }
}
// Alies poble→gcps quan el nom no normalitza igual.
const GEO_ALIAS = { 'la-puebla': 'sa pobla' };
const geoOf = (slug, nom) => gcpByNorm.get(GEO_ALIAS[slug] || norm(nom)) || null;
// Fallback de localització: coords del nucli (NGIB) per als pobles d'un quadrant
// encara no georeferenciat (SE/SW) o sense GCP. Aproximades; les substitueix el gcp quan arribi.
const FALLBACK_GEO = JSON.parse(readFileSync(join(HERE, 'town-coords-fallback.json'), 'utf8')).coords;

// ─── 3. Pobles: FETS de 1785 (cartel·les) + editorial de pobles-editorial.json ───
const cartelles = rd('data/cartelles-1785/extract.json').towns;            // 36, font dels fets
// Editorial (id, esCapital, resumCat/notes, nomAntic) — viu DINS de web/, font pròpia.
const editorial = JSON.parse(readFileSync(resolve(HERE, '..', 'src', 'data', 'pobles-editorial.json'), 'utf8'));
const edBySlug = Object.fromEntries(editorial.pobles.map((p) => [p.slug, p]));
// id de mapa: el de pobles-editorial.json on existeix; els nous (Banyalbufar, Deià) al final.
let nextId = Math.max(...Object.values(edBySlug).map((p) => p.id)) + 1;

const pobles = cartelles.map((t) => {
  const ed = edBySlug[t.slug] || {};
  const g = geoOf(t.slug, t.nom);
  const file = t.img;                                                        // ja és la canònica (fusions incloses)
  // La web serveix la vinyeta ja construïda (web/public/vinetes/<slug>.jpg, versionada);
  // data/jpg/pobles/ només és la font local d'on surt. Val qualsevol de les dues, així un
  // checkout net de CI (sense els escanejos crus) també marca el poble com a il·lustrat.
  const hasFile = (file && existsSync(join(ROOT, VINYETES_DIR, file))) || existsSync(join(VINYETES_OUT, `${t.slug}.jpg`));
  return {
    id: ed.id ?? nextId++,
    slug: t.slug,
    nom: t.nom,
    nomGravat: t.nomGravat ?? null,
    esCapital: ed.esCapital ?? false,
    // identitat històrica (1785)
    nomArab: t.nomMoros ?? null,                                            // "llamado por los Moros ..."
    nomAntic: t.nomAntic ?? ed.nomAntic ?? null,
    anyVila: t.anyVila ?? null,
    anyCiutat: t.anyCiutat ?? null,
    // demografia i economia (1785, tal com es grava)
    veins: t.veins ?? null,
    animes: t.animes ?? null,
    collites: t.collites ?? [],
    fires: t.fires ?? null,
    // text i divulgació
    textOriginal: t.textOriginal ?? null,                                   // literal 1785
    resumCat: ed.resumCat ?? null,                                          // editorial (català), pot faltar als nous
    notes: ed.notes ?? null,
    dubtes: t.dubtes ?? [],                                                 // incerteses de lectura de 1785
    dependents: (t.llogarets ?? []).map((l) => {
      const dg = gcpByNorm.get(norm(l.nom)) || null;
      return { nom: l.nom, veins: l.veins ?? null, animes: l.animes ?? null, geo: dg ? { lat: dg.lat, lng: dg.lng } : null };
    }),
    geo: g ? { lat: g.lat, lng: g.lng } : (FALLBACK_GEO[t.slug] ?? null),
    geoAprox: !g && !!FALLBACK_GEO[t.slug],
    q: g ? g.q : null,
    vinyeta: hasFile ? t.slug : null,
    vinyetaFile: hasFile ? file : null,
  };
}).sort((a, b) => a.id - b.id);

writeFileSync(
  join(OUT, 'pobles.json'),
  JSON.stringify(
    {
      font: "Pobles del mapa original de Mallorca del Cardenal Despuig (1785). Dades llegides de les cartel·les gravades (vecinos, any de vila, noms històrics, collites); coords del Nomenclàtor (NGIB); resums divulgatius en català.",
      comptador: { total: pobles.length, ambGeo: pobles.filter((p) => p.geo).length, ambVinyeta: pobles.filter((p) => p.vinyeta).length },
      pobles,
    },
    null,
    1,
  ),
);

// ─── Resum ───
console.log(`✓ web/src/data/toponims.json — ${toponims.length} topònims (${QUADRANTS.map((q) => `${q.key} ${perQuadrant[q.key]}`).join(', ')})`);
console.log(`  decisions: ${JSON.stringify(perDecision)}`);
console.log(`✓ web/src/data/pobles.json — ${pobles.length} pobles (${pobles.filter((p) => p.geo).length} amb coords, ${pobles.filter((p) => p.vinyeta).length} amb vinyeta)`);
const senseVin = pobles.filter((p) => !p.vinyeta).map((p) => p.slug);
if (senseVin.length) console.log(`  ⚠ sense vinyeta: ${senseVin.join(', ')}`);
const senseVeins = pobles.filter((p) => p.veins == null).map((p) => p.slug);
if (senseVeins.length) console.log(`  ⚠ sense xifra de vecinos (illegible/no consta): ${senseVeins.join(', ')}`);

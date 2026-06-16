// Apply the "sense" triage verdicts (data/toponims/sense-review.json): remove the
// readings ticked as trash from the SOURCE cells/*.json so the deletion survives a
// re-merge. Then re-run merge + ngib-match to refresh the deliverables.
//
//   node scripts/toponims/apply-sense-review.mjs
//
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, '..', '..', 'data/toponims');
const load = async (p) => JSON.parse(await readFile(p, 'utf8'));

// Stable identity for a reading (must match sense-server.mjs).
const stableKey = (subtile, graf, fx, fy) =>
  `${subtile}|${graf}|${(+fx).toFixed(4)}|${(+fy).toFixed(4)}`;

const verdicts = await load(join(DATA, 'sense-review.json')).catch(() => ({}));
const trashKeys = new Set(
  Object.entries(verdicts).filter(([, v]) => v.verdict === 'trash').map(([key]) => key)
);
if (!trashKeys.size) {
  console.log('No trash verdicts to apply.');
  process.exit(0);
}

const toponims = (await load(join(DATA, 'toponims.json'))).toponims;
const manifest = await load(join(DATA, 'subtiles.json'));
const cellById = Object.fromEntries(manifest.cells.map((c) => [c.id, c]));

// Map each trashed reading (by stable key) to a (subtile, fx, fy, graf) target.
const targets = {};
for (const t of toponims) {
  const c = cellById[t.subtile];
  if (!c) continue;
  const fx = (t.x - c.gx) / c.w, fy = (t.y - c.gy) / c.h;
  if (!trashKeys.has(stableKey(t.subtile, t.graf, fx, fy))) continue;
  (targets[t.subtile] ||= []).push({ graf: t.graf, fx, fy });
}

let removed = 0;
for (const [sub, want] of Object.entries(targets)) {
  const file = join(DATA, 'cells', `${sub}.json`);
  const cell = await load(file);
  const keep = [];
  for (const top of cell.toponims) {
    const hit = want.find((w) => w.graf === top.graf
      && Math.abs((w.fx ?? 0) - (top.fx ?? 0)) < 0.04
      && Math.abs((w.fy ?? 0) - (top.fy ?? 0)) < 0.04);
    if (hit) { want.splice(want.indexOf(hit), 1); removed++; continue; }
    keep.push(top);
  }
  await writeFile(file, JSON.stringify({ ...cell, toponims: keep }, null, 2));
}

console.log(`✓ removed ${removed}/${trashKeys.size} trashed readings from cells/.`);
console.log('Now regenerate:');
console.log('  node scripts/toponims/merge.mjs');
console.log('  npm run toponims:ngib-match');

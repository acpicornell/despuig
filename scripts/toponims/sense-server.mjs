// Local triage tool for the NGIB "sense" (no-match) toponyms: a fast grid where
// each reading shows a zoomed crop of the engraving and is ticked real / trash.
// No dependencies; verdicts are saved to data/toponims/sense-review.json and can
// be applied later with apply-sense-review.mjs.
//
//   node scripts/toponims/sense-server.mjs   → http://localhost:5175
//
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DATA = join(ROOT, 'data/toponims');
const SUB = join(DATA, 'sub');
const REVIEW = join(DATA, 'sense-review.json');
const PORT = process.env.PORT || 5175;

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
  res.end(body);
};
const json = (res, code, obj) => send(res, code, JSON.stringify(obj));

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

const load = async (p, fallback) => {
  try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; }
};

// Stable identity for a reading, independent of the merge-assigned id.
export const stableKey = (subtile, graf, fx, fy) =>
  `${subtile}|${graf}|${(+fx).toFixed(4)}|${(+fy).toFixed(4)}`;

// Build the work list once: join matches (decision === 'sense') with toponims
// (for subtile + master x,y) and subtiles (for the cell box), deriving fx,fy.
async function buildSenseList() {
  const matches = await load(join(DATA, 'ngib/matches.json'), []);
  const toponims = (await load(join(DATA, 'toponims.json'), { toponims: [] })).toponims;
  const manifest = await load(join(DATA, 'subtiles.json'), { cells: [] });
  const topoById = Object.fromEntries(toponims.map((t) => [t.id, t]));
  const cellById = Object.fromEntries(manifest.cells.map((c) => [c.id, c]));
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const out = [];
  for (const m of matches) {
    if (m.decision !== 'sense') continue;
    const t = topoById[m.id];
    if (!t) continue;
    const c = cellById[t.subtile];
    const fx = c ? clamp((t.x - c.gx) / c.w) : 0.5;
    const fy = c ? clamp((t.y - c.gy) / c.h) : 0.5;
    // Stable identity (survives a re-merge that renumbers ids): cell + spelling + position.
    const key = stableKey(t.subtile, m.graf, fx, fy);
    out.push({ id: m.id, key, graf: m.graf, nom: m.nom, tipus: m.tipus, dubte: m.dubte, subtile: t.subtile, fx, fy });
  }
  out.sort((a, b) => a.subtile.localeCompare(b.subtile) || a.fy - b.fy);
  return out;
}

let verdicts = await load(REVIEW, {});

const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://localhost:${PORT}`);
    const p = u.pathname;

    if (p === '/' || p === '/index.html') {
      return send(res, 200, await readFile(join(__dirname, 'sense.html')), 'text/html; charset=utf-8');
    }
    if (p === '/api/sense') {
      return json(res, 200, await buildSenseList());
    }
    if (p === '/api/verdicts') {
      return json(res, 200, verdicts);
    }
    if (p === '/api/verdict' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const key = String(body.key);
      if (body.verdict == null) delete verdicts[key];
      else verdicts[key] = { verdict: body.verdict, ...(body.nom ? { nom: String(body.nom).trim() } : {}) };
      await writeFile(REVIEW, JSON.stringify(verdicts, null, 1));
      return json(res, 200, { ok: true, done: Object.keys(verdicts).length });
    }

    const mImg = p.match(/^\/sub\/([a-z0-9_]+\.jpg)$/);
    if (mImg) {
      try { return send(res, 200, await readFile(join(SUB, mImg[1])), 'image/jpeg'); }
      catch { return send(res, 404, 'no tile', 'text/plain'); }
    }
    send(res, 404, 'not found', 'text/plain');
  } catch (e) {
    json(res, 500, { error: String(e) });
  }
});

server.listen(PORT, () => {
  console.log(`\n  Sense-match triage → http://localhost:${PORT}\n`);
  console.log('  Tick each reading real / trash; saved to data/toponims/sense-review.json.');
  console.log('  When done:  node scripts/toponims/apply-sense-review.mjs\n');
});

// Local visual annotator for the map vignettes (no dependencies).
// Serves the web map image and a drawing UI; lets you draw/adjust one box per
// vignette and saves them to data/toponims/vinetes.json (normalised 0..1 coords).
//
//   node scripts/toponims/vinetes-server.mjs    → http://localhost:5175
//
// The boxes are seeded from the current uniform grid (src/lib/frame.mjs) so you
// only need to nudge the existing ones and add any that are missing.
//
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { IMG, cellPct } from '../../src/lib/frame.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DATA = join(ROOT, 'data/toponims');
const OUT = join(DATA, 'vinetes.json');
const POBLES = join(ROOT, 'src/data/pobles.json');
const MAP_IMG = join(ROOT, 'public/map/mapa-web.jpg');
const PORT = process.env.PORT || 5175;
const BORDES = ['superior', 'inferior', 'izquierdo', 'derecho'];

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

const slugify = (s) =>
  String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

async function loadPobles() {
  return JSON.parse(await readFile(POBLES, 'utf8')).pobles;
}

// Seed one box per existing poble from the uniform grid (% → 0..1 fractions).
async function seed() {
  const pobles = await loadPobles();
  const vinetes = pobles.map((p) => {
    const r = cellPct(p.borde, p.ordre); // left/top/width/height in %
    return {
      nom: p.nom, slug: p.slug, borde: p.borde,
      fx: +(r.left / 100).toFixed(5), fy: +(r.top / 100).toFixed(5),
      fw: +(r.width / 100).toFixed(5), fh: +(r.height / 100).toFixed(5),
    };
  });
  return { image: { w: IMG.w, h: IMG.h }, seeded: true, vinetes };
}

const clamp01 = (n) => Math.max(0, Math.min(1, +n || 0));

const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://localhost:${PORT}`);
    const p = u.pathname;

    if (p === '/' || p === '/index.html') {
      return send(res, 200, await readFile(join(__dirname, 'vinetes.html')), 'text/html; charset=utf-8');
    }

    if (p === '/map.jpg') {
      return send(res, 200, await readFile(MAP_IMG), 'image/jpeg');
    }

    if (p === '/api/pobles') {
      const pobles = await loadPobles();
      return json(res, 200, pobles.map((x) => ({ nom: x.nom, slug: x.slug })));
    }

    if (p === '/api/vinetes') {
      if (req.method === 'GET') {
        if (u.searchParams.get('seed') !== '1' && existsSync(OUT)) {
          return send(res, 200, await readFile(OUT), 'application/json');
        }
        return json(res, 200, await seed());
      }
      if (req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const clean = {
          image: { w: IMG.w, h: IMG.h },
          vinetes: (body.vinetes || []).map((v) => {
            const nom = String(v.nom || '').trim();
            return {
              nom,
              slug: nom ? (v.slug && String(v.slug).trim() ? String(v.slug).trim() : slugify(nom)) : '',
              borde: BORDES.includes(v.borde) ? v.borde : '',
              fx: clamp01(v.fx), fy: clamp01(v.fy),
              fw: clamp01(v.fw), fh: clamp01(v.fh),
            };
          }).filter((v) => v.fw > 0.005 && v.fh > 0.005),
        };
        await mkdir(DATA, { recursive: true });
        await writeFile(OUT, JSON.stringify(clean, null, 2));
        return json(res, 200, { ok: true, saved: clean.vinetes.length });
      }
    }

    send(res, 404, 'not found', 'text/plain');
  } catch (e) {
    json(res, 500, { error: String(e) });
  }
});

server.listen(PORT, () => {
  console.log(`\n  Vignette annotator → http://localhost:${PORT}\n`);
  console.log('  Draw/adjust one box per vignette, then Save.');
  console.log(`  Output: data/toponims/vinetes.json\n`);
});

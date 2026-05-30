// Servidor local de revisió del buidatge de topònims (sense dependències).
// Serveix la interfície, les tessel·les i les dades, i desa les correccions
// directament a data/toponims/cells/<id>.json.
//
//   node scripts/toponims/review-server.mjs        → http://localhost:5174
//
import { createServer } from 'node:http';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DATA = join(ROOT, 'data/toponims');
const CELLS = join(DATA, 'cells');
const SUB = join(DATA, 'sub');
const PORT = process.env.PORT || 5174;

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

const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://localhost:${PORT}`);
    const p = u.pathname;

    if (p === '/' || p === '/index.html') {
      return send(res, 200, await readFile(join(__dirname, 'review.html')), 'text/html; charset=utf-8');
    }

    if (p === '/api/manifest') {
      return send(res, 200, await readFile(join(DATA, 'subtiles.json')), 'application/json');
    }

    // Estat de totes les cel·les: nre. de topònims i si estan revisades.
    if (p === '/api/progress') {
      const files = (await readdir(CELLS)).filter((f) => f.endsWith('.json'));
      const out = {};
      for (const f of files) {
        try {
          const c = JSON.parse(await readFile(join(CELLS, f), 'utf8'));
          out[c.subtile] = { n: (c.toponims || []).length, revisat: !!c.revisat };
        } catch {}
      }
      return json(res, 200, out);
    }

    const mCell = p.match(/^\/api\/cell\/([a-z0-9_]+)$/);
    if (mCell) {
      const id = mCell[1];
      const file = join(CELLS, `${id}.json`);
      if (req.method === 'GET') {
        try { return send(res, 200, await readFile(file), 'application/json'); }
        catch { return json(res, 200, { subtile: id, toponims: [] }); }
      }
      if (req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const clean = {
          subtile: id,
          revisat: !!body.revisat,
          toponims: (body.toponims || []).map((t) => ({
            nom: String(t.nom || '').trim(),
            graf: String(t.graf || '').trim(),
            tipus: t.tipus || 'possessió',
            dubte: !!t.dubte,
            fx: Math.max(0, Math.min(1, +t.fx || 0)),
            fy: Math.max(0, Math.min(1, +t.fy || 0)),
          })).filter((t) => t.nom),
        };
        await writeFile(file, JSON.stringify(clean, null, 2));
        return json(res, 200, { ok: true, saved: clean.toponims.length });
      }
    }

    // Imatges de les tessel·les.
    const mImg = p.match(/^\/sub\/([a-z0-9_]+\.jpg)$/);
    if (mImg) {
      try {
        const buf = await readFile(join(SUB, mImg[1]));
        return send(res, 200, buf, 'image/jpeg');
      } catch { return send(res, 404, 'no tile', 'text/plain'); }
    }

    send(res, 404, 'not found', 'text/plain');
  } catch (e) {
    json(res, 500, { error: String(e) });
  }
});

server.listen(PORT, () => {
  console.log(`\n  Revisió de topònims → http://localhost:${PORT}\n`);
  console.log('  Desa cada cel·la a data/toponims/cells/<id>.json.');
  console.log('  En acabar, executa:  node scripts/toponims/merge.mjs\n');
});

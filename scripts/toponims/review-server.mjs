// Local toponym review tool — click through the suggerit/posicional/sense items,
// see the engraving crop + NGIB candidates, accept/pick/no-match. Persists to
// data/toponims/recheck-picks.json (the durable picks ngib_match applies) and a
// review-reviewed.json (so the queue resumes). No dependencies.
//
//   node scripts/toponims/review-server.mjs   ->  http://localhost:4400/
//   (then: npm run toponims:ngib-match  to apply the picks)
import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const F = {
  data: `${ROOT}/data/toponims/review-data.json`,
  crops: `${ROOT}/data/toponims/review-crops`,
  picks: `${ROOT}/data/toponims/recheck-picks.json`,
  reviewed: `${ROOT}/data/toponims/review-reviewed.json`,
  graf: `${ROOT}/data/toponims/graf-fixes.json`,
};
const readJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const writeJSON = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 1));

const PAGE = `<!doctype html><meta charset=utf8><title>Curació de topònims</title>
<style>
 :root{--ink:#2b2620;--soft:#7a6f60;--line:#e4dccf;--bg:#f6f1e7}
 *{box-sizing:border-box} body{margin:0;font:15px/1.4 system-ui,sans-serif;color:var(--ink);background:var(--bg)}
 header{display:flex;gap:1rem;align-items:center;padding:.6rem 1rem;background:#fff;border-bottom:1px solid var(--line);position:sticky;top:0}
 header b{font-size:1.05rem} .grow{flex:1}
 .bar{height:6px;background:var(--line);border-radius:3px;overflow:hidden;width:200px}
 .bar>i{display:block;height:100%;background:#2f7d4f}
 select{padding:.3rem .5rem;border:1px solid var(--line);border-radius:6px;background:#fff}
 main{max-width:1000px;margin:1.2rem auto;padding:0 1rem;display:grid;grid-template-columns:1.3fr 1fr;gap:1.4rem}
 .crop{width:100%;border:1px solid var(--line);border-radius:8px;background:#fff}
 .read{font-size:1.5rem;font-weight:700} .read .q{color:var(--soft);font-weight:400;font-size:1rem}
 .meta{color:var(--soft);margin:.2rem 0 1rem} .badge{padding:.1rem .45rem;border-radius:999px;font-size:.78rem;font-weight:600}
 .b-suggerit{background:#f6ecd4;color:#b07c1d}.b-posicional{background:#e4ecf5;color:#3a6098}.b-sense{background:#efe9e4;color:#8a7a6c}
 .cand{display:block;width:100%;text-align:left;padding:.55rem .7rem;margin:.35rem 0;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;font:inherit}
 .cand:hover,.cand.rec{border-color:#2f7d4f;background:#f0f7f1}
 .cand b{font-size:1.02rem} .cand .m{color:var(--soft);font-size:.85rem}
 .cand kbd{float:right;color:var(--soft)}
 .act{display:flex;gap:.5rem;margin-top:.8rem} .act button{flex:1;padding:.55rem;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;font:inherit}
 .none{color:#a23}.skip{color:var(--soft)}
 kbd{font:.8rem monospace;background:var(--line);border-radius:4px;padding:0 .3rem}
 .done{grid-column:1/3;text-align:center;padding:3rem;color:var(--soft)}
 .hint{grid-column:1/3;color:var(--soft);font-size:.85rem;text-align:center}
</style>
<header>
 <b>Curació de topònims</b>
 <span id=prog class=meta></span><div class=bar><i id=progbar></i></div>
 <span class=grow></span>
 <label class=meta>filtre <select id=filter>
  <option value=all>tots</option><option value=suggerit>suggerit</option>
  <option value=posicional>posicional</option><option value=sense>sense</option></select></label>
</header>
<main id=app></main>
<script>
let DATA=[], STATE={picks:{},reviewed:{}}, queue=[], i=0;
const $=s=>document.querySelector(s);
async function load(){
  DATA=(await (await fetch('/data')).json()).items;
  STATE=await (await fetch('/state')).json();
  rebuild();
}
function rebuild(){
  const f=$('#filter').value;
  queue=DATA.filter(d=>!(d.id in STATE.reviewed) && (f==='all'||d.decision===f));
  i=0; render();
}
function render(){
  const tot=DATA.length, done=Object.keys(STATE.reviewed).length, conf=Object.keys(STATE.picks).length;
  $('#prog').textContent=\`revisats \${done} / \${tot} · confirmats \${conf} · cua \${queue.length}\`;
  $('#progbar').style.width=(100*done/tot)+'%';
  const app=$('#app');
  if(!queue.length){app.innerHTML='<div class=done>✓ Res més a la cua amb aquest filtre.<br>Quan acabis: <code>npm run toponims:ngib-match</code></div>';return;}
  const d=queue[i];
  const cands=d.candidates.map((c,n)=>{
    const rec=(c.grafia===d.ngib)?' rec':'';
    return \`<button class="cand\${rec}" data-g="\${esc(c.grafia)}"><kbd>\${n+1}</kbd><b>\${esc(c.grafia)}</b><div class=m>\${esc(c.municipi||'?')} · \${c.km}km · sim \${c.sim}</div></button>\`;
  }).join('');
  app.innerHTML=\`
   <div><img class=crop src="/crop/\${d.id}.jpg"></div>
   <div>
     <div class=meta><span class="badge b-\${d.decision}">\${d.decision}</span> · \${esc(d.tipus)} · <code>\${d.id}</code></div>
     <div class=act><label style="flex:0 0 auto;color:var(--soft);align-self:center">Lectura</label>
       <input id=graf value="\${esc((STATE.graf&&STATE.graf[d.id])||d.graf)}" style="flex:3;padding:.5rem;border:1px solid var(--line);border-radius:8px;font:inherit;font-weight:600">
       <button id=savebtn onclick="saveReading()" title="desa la lectura corregida (no avança)">💾 Lectura</button></div>
     \${cands||'<div class=meta>(sense candidats propers)</div>'}
     <div class=act>
       <input id=custom placeholder="…o escriu el nom NGIB correcte i Enter" style="flex:3;padding:.5rem;border:1px solid var(--line);border-radius:8px;font:inherit">
       <button onclick="pickCustom()" style="flex:1">✓ Escrit</button>
     </div>
     <div class=act>
       <button class=none onclick="nomatch()"><kbd>0</kbd> Cap match</button>
       <button class=skip onclick="skip()"><kbd>S</kbd> Saltar</button>
     </div>
   </div>
   <div class=hint><kbd>1</kbd>–<kbd>6</kbd> tria candidat · <kbd>0</kbd> cap match · <kbd>S</kbd>/<kbd>espai</kbd> saltar · <kbd>←</kbd> enrere</div>\`;
  app.querySelectorAll('.cand').forEach(b=>b.onclick=()=>pick(b.dataset.g));
}
const esc=s=>(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function curGraf(){ const el=$('#graf'),d=queue[i]; if(!el||!d)return null; const v=el.value.trim(); return (v&&v!==d.graf)?v:null; }
async function send(id,action,grafia,graf){
  await fetch('/pick',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,action,grafia,graf})});
}
function advance(){ queue.splice(i,1); if(i>=queue.length)i=queue.length-1; render(); }
async function pick(g){ const d=queue[i]; STATE.reviewed[d.id]='pick'; STATE.picks[d.id]=g; await send(d.id,'pick',g,curGraf()); advance(); }
async function nomatch(){ const d=queue[i]; STATE.reviewed[d.id]='none'; await send(d.id,'none',null,curGraf()); advance(); }
async function saveReading(){ const d=queue[i],g=curGraf(); if(!g)return; (STATE.graf=STATE.graf||{})[d.id]=g; await send(d.id,'graf',null,g); const b=$('#savebtn'); if(b){b.textContent='✓ desada';setTimeout(()=>{if($('#savebtn'))$('#savebtn').textContent='💾 Lectura';},1200);} }
function skip(){ i=(i+1)%queue.length; render(); }
function pickCustom(){ const v=$('#custom').value.trim(); if(v)pick(v); }
$('#filter').onchange=rebuild;
addEventListener('keydown',e=>{
  if(!queue.length)return; const d=queue[i];
  if(e.target.tagName==='INPUT'){ if(e.key==='Enter')pickCustom(); return; }
  if(e.key>='1'&&e.key<='6'){const c=d.candidates[+e.key-1]; if(c)pick(c.grafia);}
  else if(e.key==='0')nomatch();
  else if(e.key==='s'||e.key===' '){e.preventDefault();skip();}
  else if(e.key==='ArrowLeft'){i=(i-1+queue.length)%queue.length;render();}
});
load();
</script>`;

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'GET' && u.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf8' }); return res.end(PAGE);
  }
  if (req.method === 'GET' && u.pathname === '/data') {
    res.writeHead(200, { 'content-type': 'application/json' }); return res.end(fs.readFileSync(F.data));
  }
  if (req.method === 'GET' && u.pathname === '/state') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ picks: readJSON(F.picks, {}), reviewed: readJSON(F.reviewed, {}), graf: readJSON(F.graf, {}) }));
  }
  if (req.method === 'GET' && u.pathname.startsWith('/crop/')) {
    const p = `${F.crops}/${path.basename(u.pathname)}`;
    if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'image/jpeg' }); return res.end(fs.readFileSync(p));
  }
  if (req.method === 'POST' && u.pathname === '/pick') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const { id, action, grafia, graf } = JSON.parse(body || '{}');
      const reviewed = readJSON(F.reviewed, {});
      const picks = readJSON(F.picks, {});
      if (graf) { const gf = readJSON(F.graf, {}); gf[id] = graf; writeJSON(F.graf, gf); }
      if (action === 'pick' && grafia) { picks[id] = grafia; reviewed[id] = 'pick'; writeJSON(F.picks, picks); writeJSON(F.reviewed, reviewed); }
      else if (action === 'none') { reviewed[id] = 'none'; writeJSON(F.reviewed, reviewed); }
      // action 'graf' only records the reading correction; the item stays unreviewed
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }
  res.writeHead(404); res.end();
});
server.listen(4400, () => console.log('Review tool → http://localhost:4400/  (Ctrl-C to stop)'));

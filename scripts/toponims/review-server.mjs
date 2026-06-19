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
// Env overrides let one server drive a per-sheet quadrant (default = global A).
// e.g. for NW:  REVIEW_DATA=data/toponims/nw/review-data.json
//               REVIEW_CROPS=data/toponims/nw/review-crops
//               PICKS_JSON=data/toponims/nw/recheck-picks.json
//               REVIEWED_JSON=data/toponims/nw/review-reviewed.json
//               GRAF_JSON=data/toponims/nw/graf-fixes.json
const P = (env, def) => (process.env[env] ? path.resolve(ROOT, process.env[env]) : `${ROOT}/${def}`);
const F = {
  data: P('REVIEW_DATA', 'data/toponims/review-data.json'),
  crops: P('REVIEW_CROPS', 'data/toponims/review-crops'),
  picks: P('PICKS_JSON', 'data/toponims/recheck-picks.json'),
  reviewed: P('REVIEWED_JSON', 'data/toponims/review-reviewed.json'),
  graf: P('GRAF_JSON', 'data/toponims/graf-fixes.json'),
  discards: P('DISCARDS_JSON', 'data/toponims/discards.json'),
};
const readJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const writeJSON = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 1));
// the whole NGIB gazetteer as compact [grafia, municipi, lng, lat] tuples (served once)
const NGIB_JSON = JSON.stringify(
  JSON.parse(fs.readFileSync(`${ROOT}/data/toponims/ngib/llocs.json`, 'utf8'))
    .map(g => [g.grafia, g.municipi, g.lng, g.lat]));

const PAGE = `<!doctype html><meta charset=utf8><title>Curació de topònims</title>
<link rel=stylesheet href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
 :root{--ink:#2b2620;--soft:#7a6f60;--line:#e4dccf;--bg:#f6f1e7}
 *{box-sizing:border-box} body{margin:0;font:15px/1.4 system-ui,sans-serif;color:var(--ink);background:var(--bg)}
 header{display:flex;gap:1rem;align-items:center;padding:.6rem 1rem;background:#fff;border-bottom:1px solid var(--line);position:sticky;top:0}
 header b{font-size:1.05rem} .grow{flex:1}
 .bar{height:6px;background:var(--line);border-radius:3px;overflow:hidden;width:200px}
 .bar>i{display:block;height:100%;background:#2f7d4f}
 select{padding:.3rem .5rem;border:1px solid var(--line);border-radius:6px;background:#fff}
 main{max-width:1280px;margin:1.2rem auto;padding:0 1rem;display:grid;grid-template-columns:1.35fr 1fr;gap:1.4rem;align-items:start}
 #app{min-width:0} #map{height:80vh;position:sticky;top:64px;border:1px solid var(--line);border-radius:8px;background:#eee}
 .crop{width:100%;border:1px solid var(--line);border-radius:8px;background:#fff}
 .read{font-size:1.5rem;font-weight:700} .read .q{color:var(--soft);font-weight:400;font-size:1rem}
 .meta{color:var(--soft);margin:.2rem 0 1rem} .badge{padding:.1rem .45rem;border-radius:999px;font-size:.78rem;font-weight:600}
 .b-curat{background:#cfe8d6;color:#1f6b3f;border:1px solid #2f7d4f}.b-confirmat{background:#dcefe1;color:#2f7d4f}.b-probable{background:#d7eeea;color:#1d7a6b}
 .b-suggerit{background:#f6ecd4;color:#b07c1d}.b-posicional{background:#e4ecf5;color:#3a6098}.b-sense{background:#efe9e4;color:#8a7a6c}
 .cand{display:block;width:100%;text-align:left;padding:.55rem .7rem;margin:.35rem 0;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;font:inherit}
 .cand:hover,.cand.rec{border-color:#2f7d4f;background:#f0f7f1}
 .cand b{font-size:1.02rem} .cand .m{color:var(--soft);font-size:.85rem}
 .cand kbd{float:right;color:var(--soft)}
 .act{display:flex;gap:.5rem;margin-top:.8rem} .act button{flex:1;padding:.55rem;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;font:inherit}
 .none{color:#a23}.skip{color:var(--soft)}.trash{color:#8a4a1d}.trash:hover{border-color:#8a4a1d;background:#f7efe7}
 .undo{color:#3a6098}.undo:hover:not(:disabled){border-color:#3a6098;background:#eef3fa}.undo:disabled{opacity:.4;cursor:default}
 .ok{color:#2f7d4f}.ok:hover{border-color:#2f7d4f;background:#f0f7f1}
 kbd{font:.8rem monospace;background:var(--line);border-radius:4px;padding:0 .3rem}
 .done{grid-column:1/3;text-align:center;padding:3rem;color:var(--soft)}
 .hint{grid-column:1/3;color:var(--soft);font-size:.85rem;text-align:center}
</style>
<header>
 <b>Curació de topònims</b>
 <span id=prog class=meta></span><div class=bar><i id=progbar></i></div>
 <span class=grow></span>
 <label class=meta>filtre <select id=filter>
  <option value=all>tots</option><option value=curat>curat</option>
  <option value=confirmat>confirmat</option><option value=probable>probable</option>
  <option value=suggerit>suggerit</option>
  <option value=posicional>posicional</option><option value=sense>sense</option></select></label>
</header>
<main><div id=app></div><div id=map></div></main>
<script>
let DATA=[], STATE={picks:{},reviewed:{}}, queue=[], i=0;
const $=s=>document.querySelector(s);
async function load(){
  DATA=(await (await fetch('/data')).json()).items;
  STATE=await (await fetch('/state')).json();
  initMap();
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
  if(!queue.length){app.innerHTML='<div class=done>✓ Res més a la cua amb aquest filtre.<br>Quan acabis: <code>npm run toponims:ngib-match</code></div>';clearMap();return;}
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
       <input id=search placeholder="🔍 cerca un nom NGIB i mostra'l al mapa" style="flex:3;padding:.5rem;border:1px solid var(--line);border-radius:8px;font:inherit">
       <button onclick="searchMap()">al mapa</button></div>
     <div class=act>
       <input id=custom placeholder="…o escriu el nom NGIB correcte i Enter" style="flex:3;padding:.5rem;border:1px solid var(--line);border-radius:8px;font:inherit">
       <button onclick="pickCustom()" style="flex:1">✓ Escrit</button>
     </div>
     <div class=act>
       <button class=ok onclick="ok()" title="marca'l com a revisat sense canviar res (deixa el match actual)"><kbd>C</kbd> ✓ Correcte</button>
       <button class=none onclick="nomatch()"><kbd>0</kbd> Cap match</button>
       <button class=trash onclick="trash()"><kbd>D</kbd> 🗑 Brossa</button>
       <button class=skip onclick="skip()"><kbd>S</kbd> Saltar</button>
       <button class=undo onclick="undo()" \${history.length?'':'disabled'} title="desfés l'última decisió i torna l'ítem a la cua">↶ Desfés <kbd>U</kbd></button>
     </div>
   </div>
   <div class=hint><kbd>1</kbd>–<kbd>6</kbd> tria candidat · <kbd>C</kbd> correcte (deixa-ho) · <kbd>0</kbd> cap match · <kbd>D</kbd> brossa · <kbd>S</kbd>/<kbd>espai</kbd> saltar · <kbd>←</kbd> navega · <kbd>U</kbd>/<kbd>⌫</kbd> desfés</div>\`;
  app.querySelectorAll('.cand').forEach(b=>b.onclick=()=>pick(b.dataset.g));
  updateMap(d);
}
let map,mlayer,ngibLayer,NGIB=[];
function initMap(){ if(map)return; map=L.map('map'); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map); ngibLayer=L.layerGroup().addTo(map); mlayer=L.layerGroup().addTo(map); map.setView([39.6,3.0],9); map.on('moveend',renderNgib); loadNgib(); }
async function loadNgib(){ try{ NGIB=await (await fetch('/ngib')).json(); renderNgib(); }catch(e){} }
function renderNgib(){
  if(!ngibLayer||!NGIB.length)return; ngibLayer.clearLayers();
  if(map.getZoom()<12)return; const b=map.getBounds(); let n=0;
  for(const a of NGIB){ const lng=a[2],lat=a[3];
    if(lat<b.getSouth()||lat>b.getNorth()||lng<b.getWest()||lng>b.getEast())continue;
    const mk=L.circleMarker([lat,lng],{radius:3,color:'#999',weight:1,fillColor:'#ccc',fillOpacity:.75});
    mk.bindTooltip('<b>'+esc(a[0])+'</b> · '+esc(a[1]||''),{direction:'top'}); mk.on('click',()=>pick(a[0])); mk.addTo(ngibLayer);
    if(++n>700)break; }
}
let searchLayer;
function searchMap(){
  if(!map)return; if(!searchLayer)searchLayer=L.layerGroup().addTo(map); searchLayer.clearLayers();
  const q=($('#search').value||'').trim().toLowerCase(); if(!q||!NGIB.length)return;
  const pts=[],d=queue[i]; let n=0;
  for(const a of NGIB){ if(!a[0].toLowerCase().includes(q))continue;
    const mk=L.circleMarker([a[3],a[2]],{radius:7,color:'#c0530a',weight:2,fillColor:'#e67e22',fillOpacity:.95});
    mk.bindTooltip('<b>'+esc(a[0])+'</b> · '+esc(a[1]||''),{direction:'top'}); mk.on('click',()=>pick(a[0])); mk.addTo(searchLayer); pts.push([a[3],a[2]]); if(++n>80)break; }
  if(d&&d.lat!=null)pts.push([d.lat,d.lon]);
  if(pts.length)map.fitBounds(pts,{padding:[40,40]});
}
function clearMap(){ if(mlayer)mlayer.clearLayers(); if(searchLayer)searchLayer.clearLayers(); }
function updateMap(d){
  if(!map)return; map.invalidateSize(); mlayer.clearLayers(); if(searchLayer)searchLayer.clearLayers(); const pts=[];
  if(d.lat!=null){ L.circleMarker([d.lat,d.lon],{radius:8,color:'#c00',weight:2,fillColor:'#c00',fillOpacity:.45}).bindTooltip('on cau la georef (~1 km)').addTo(mlayer); pts.push([d.lat,d.lon]); }
  (d.candidates||[]).forEach((c,n)=>{ if(c.lat!=null){ const mk=L.circleMarker([c.lat,c.lon],{radius:7,color:'#1d6b4f',weight:2,fillColor:'#37a37e',fillOpacity:.9});
    mk.bindTooltip('<b>'+(n+1)+'. '+esc(c.grafia)+'</b><br>'+esc(c.municipi||'?')+' · '+c.km+' km',{direction:'top'}); mk.on('click',()=>pick(c.grafia)); mk.addTo(mlayer); pts.push([c.lat,c.lon]); }});
  if(pts.length) map.fitBounds(pts,{padding:[35,35],maxZoom:15});
}
const esc=s=>(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function curGraf(){ const el=$('#graf'),d=queue[i]; if(!el||!d)return null; const v=el.value.trim(); return (v&&v!==d.graf)?v:null; }
async function send(id,action,grafia,graf){
  await fetch('/pick',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,action,grafia,graf})});
}
let history=[];   // stack of {id} of the items reviewed this session, for ↶ Desfés
function advance(){ queue.splice(i,1); if(i>=queue.length)i=queue.length-1; render(); }
async function pick(g){ const d=queue[i]; history.push({id:d.id}); STATE.reviewed[d.id]='pick'; STATE.picks[d.id]=g; await send(d.id,'pick',g,curGraf()); advance(); }
async function nomatch(){ const d=queue[i]; history.push({id:d.id}); STATE.reviewed[d.id]='none'; await send(d.id,'none',null,curGraf()); advance(); }
async function trash(){ const d=queue[i]; history.push({id:d.id}); STATE.reviewed[d.id]='trash'; await send(d.id,'trash',null,curGraf()); advance(); }
async function ok(){ const d=queue[i]; history.push({id:d.id}); STATE.reviewed[d.id]='ok'; await send(d.id,'ok',null,curGraf()); advance(); }
async function undo(){
  const h=history.pop(); if(!h)return;
  delete STATE.reviewed[h.id]; delete STATE.picks[h.id];   // server also drops it from discards
  await send(h.id,'undo',null,null);
  rebuild();                                               // the item reappears in the cua (if it matches the filtre)
  const j=queue.findIndex(d=>d.id===h.id); if(j>=0)i=j;    // and we jump back to it to re-edit
  render();
}
async function saveReading(){ const d=queue[i],g=curGraf(); if(!g)return; (STATE.graf=STATE.graf||{})[d.id]=g; await send(d.id,'graf',null,g); const b=$('#savebtn'); if(b){b.textContent='✓ desada';setTimeout(()=>{if($('#savebtn'))$('#savebtn').textContent='💾 Lectura';},1200);} }
function skip(){ i=(i+1)%queue.length; render(); }
function pickCustom(){ const v=$('#custom').value.trim(); if(v)pick(v); }
$('#filter').onchange=rebuild;
addEventListener('keydown',e=>{
  if(!queue.length)return; const d=queue[i];
  if(e.target.tagName==='INPUT'){ if(e.key==='Enter'){ const id=e.target.id; if(id==='search')searchMap(); else if(id==='graf')saveReading(); else pickCustom(); } return; }
  if(e.key>='1'&&e.key<='6'){const c=d.candidates[+e.key-1]; if(c)pick(c.grafia);}
  else if(e.key==='0')nomatch();
  else if(e.key==='c')ok();
  else if(e.key==='d')trash();
  else if(e.key==='s'||e.key===' '){e.preventDefault();skip();}
  else if(e.key==='u'||e.key==='Backspace'){e.preventDefault();undo();}
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
  if (req.method === 'GET' && u.pathname === '/ngib') {
    res.writeHead(200, { 'content-type': 'application/json' }); return res.end(NGIB_JSON);
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
      else if (action === 'ok') { reviewed[id] = 'ok'; writeJSON(F.reviewed, reviewed); }
      else if (action === 'trash') { const dj = readJSON(F.discards, {}); dj[id] = true; writeJSON(F.discards, dj); reviewed[id] = 'trash'; writeJSON(F.reviewed, reviewed); }
      else if (action === 'undo') {
        if (id in reviewed) { delete reviewed[id]; writeJSON(F.reviewed, reviewed); }
        if (id in picks) { delete picks[id]; writeJSON(F.picks, picks); }
        const dj = readJSON(F.discards, {}); if (id in dj) { delete dj[id]; writeJSON(F.discards, dj); }
        // the graf (reading) correction is kept on purpose, so a mis-edit can be fixed
      }
      // action 'graf' only records the reading correction; the item stays unreviewed
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }
  res.writeHead(404); res.end();
});
server.listen(4400, () => console.log('Review tool → http://localhost:4400/  (Ctrl-C to stop)'));

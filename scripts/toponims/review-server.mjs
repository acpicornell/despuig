// Local toponym curation tool — quadrant-aware, two views:
//   • Taula  : an editable copy of the public toponyms table (fast edits in a grid).
//   • Fitxes : one item at a time with the engraving crop + NGIB candidates + map.
// Pick a quadrant (NW/NE/SE/SW) in the header. Persists per sheet to
//   data/toponims/<q>/{recheck-picks,review-reviewed,graf-fixes,discards}.json
// then re-run the per-sheet match to bake it:
//   GRAF_JSON=data/toponims/<q>/graf-fixes.json TOPONIMS_JSON=data/toponims/<q>/toponims.json \
//     nix-shell scripts/toponims/shell.nix --run 'python3 scripts/toponims/mapkurator/apply_graf_fixes.py'
//   (then ngib_match.py with the per-sheet *_JSON env — see PER-SHEET.md)
//
//   node scripts/toponims/review-server.mjs   ->  http://localhost:4400/
import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const QUADRANTS = ['nw', 'ne', 'se', 'sw'].filter(
  (q) => fs.existsSync(`${ROOT}/data/toponims/${q}/matches.json`));

const F = (q) => {
  const b = `${ROOT}/data/toponims/${q}`;
  return {
    matches: `${b}/matches.json`, toponims: `${b}/toponims.json`, recheck: `${b}/recheck.json`,
    reviewdata: `${b}/review-data.json`, crops: `${b}/review-crops`,
    picks: `${b}/recheck-picks.json`, reviewed: `${b}/review-reviewed.json`,
    graf: `${b}/graf-fixes.json`, discards: `${b}/discards.json`,
  };
};
const readJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const writeJSON = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 1));
const NGIB_JSON = JSON.stringify(
  JSON.parse(fs.readFileSync(`${ROOT}/data/toponims/ngib/llocs.json`, 'utf8'))
    .map((g) => [g.grafia, g.municipi, g.lng, g.lat]));

// Build the editable-table rows for a quadrant: matches.json overlaid with the
// pending (not-yet-baked) curation state, plus nearby NGIB candidates per item.
function tableRows(q) {
  const f = F(q);
  const matches = readJSON(f.matches, []);
  const recheck = readJSON(f.recheck, []);
  const candById = Object.fromEntries(recheck.map((r) => [r.id, r.candidates || []]));
  const graf = readJSON(f.graf, {}), reviewed = readJSON(f.reviewed, {});
  const picks = readJSON(f.picks, {}), discards = readJSON(f.discards, {});
  return matches.map((m) => ({
    id: m.id, graf: graf[m.id] ?? m.graf, graf0: m.graf, nom: m.nom, tipus: m.tipus,
    decision: m.decision, review: m.review || null, ngib: m.ngib || null,
    municipi: m.municipi || null, km: m.km ?? null, sim: m.sim ?? null,
    cand: (candById[m.id] || []).slice(0, 6),
    pend: reviewed[m.id] || null, pendPick: picks[m.id] || null,
    grafEdited: graf[m.id] != null && graf[m.id] !== m.graf,
    discarded: !!discards[m.id],
  }));
}

const PAGE = `<!doctype html><meta charset=utf8><title>Curació de topònims</title>
<link rel=stylesheet href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
 :root{--ink:#2b2620;--soft:#7a6f60;--line:#e4dccf;--bg:#f6f1e7}
 *{box-sizing:border-box} body{margin:0;font:15px/1.4 system-ui,sans-serif;color:var(--ink);background:var(--bg)}
 header{display:flex;gap:.8rem;align-items:center;padding:.5rem 1rem;background:#fff;border-bottom:1px solid var(--line);position:sticky;top:0;z-index:500;flex-wrap:wrap}
 header b{font-size:1.05rem} .grow{flex:1} .meta{color:var(--soft);font-size:.9rem}
 select,input{padding:.3rem .5rem;border:1px solid var(--line);border-radius:6px;background:#fff;font:inherit}
 .seg{display:inline-flex;border:1px solid var(--line);border-radius:999px;overflow:hidden}
 .seg button{border:0;background:transparent;padding:.3rem .8rem;cursor:pointer;font:inherit;color:var(--soft)}
 .seg button.on{background:#2f7d4f;color:#fff}
 .badge{padding:.05rem .45rem;border-radius:999px;font-size:.76rem;font-weight:600;white-space:nowrap}
 .b-confirmat{background:#cfe8d6;color:#1f6b3f}.b-probable{background:#d7eeea;color:#1d7a6b}
 .b-suggerit{background:#f6ecd4;color:#b07c1d}.b-posicional{background:#e4ecf5;color:#3a6098}.b-sense{background:#efe9e4;color:#8a7a6c}
 .rev{color:#1f6b3f;font-weight:700;margin-left:.25rem;cursor:help}
 /* ---- table view ---- */
 #tablewrap{max-width:1500px;margin:1rem auto;padding:0 1rem}
 table{border-collapse:collapse;width:100%;background:#fff;border:1px solid var(--line);border-radius:8px;font-size:.92rem}
 thead th{position:sticky;top:52px;background:#faf6ee;text-align:left;padding:.45rem .55rem;border-bottom:2px solid var(--line);font-size:.78rem;text-transform:uppercase;letter-spacing:.03em;color:var(--soft);z-index:5}
 td{padding:.3rem .55rem;border-bottom:1px solid #efe8db;vertical-align:middle}
 tbody tr:hover{background:#faf7f0} tr.pend{box-shadow:inset 3px 0 0 #c0530a} tr.disc td{opacity:.45;text-decoration:line-through}
 td input.eg{width:11rem;font-weight:600} td input.en{width:12rem}
 .chips{display:flex;gap:.25rem;flex-wrap:wrap;margin-top:.2rem}
 .chip{font-size:.74rem;padding:.05rem .4rem;border:1px solid var(--line);border-radius:999px;background:#f6f7f1;cursor:pointer;color:#1d7a6b}
 .chip:hover{border-color:#2f7d4f;background:#eaf3ec}
 .rowact button{border:1px solid var(--line);border-radius:6px;background:#fff;cursor:pointer;font:inherit;padding:.2rem .4rem;margin-left:.15rem}
 .rowact .ok{color:#2f7d4f}.rowact .tr{color:#8a4a1d}.rowact .un{color:#3a6098}
 .num{text-align:right;font-variant-numeric:tabular-nums;color:var(--soft)}
 .pendtag{font-size:.7rem;color:#c0530a;font-weight:700}
 /* ---- card view ---- */
 main{max-width:1280px;margin:1.2rem auto;padding:0 1rem;display:grid;grid-template-columns:1.35fr 1fr;gap:1.4rem;align-items:start}
 #app{min-width:0} #map{height:80vh;position:sticky;top:64px;border:1px solid var(--line);border-radius:8px;background:#eee}
 .crop{width:100%;border:1px solid var(--line);border-radius:8px;background:#fff}
 .cand{display:block;width:100%;text-align:left;padding:.5rem .7rem;margin:.3rem 0;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;font:inherit}
 .cand:hover,.cand.rec{border-color:#2f7d4f;background:#f0f7f1} .cand b{font-size:1.02rem}.cand .m{color:var(--soft);font-size:.85rem}.cand kbd{float:right;color:var(--soft)}
 .act{display:flex;gap:.5rem;margin-top:.8rem}.act button{flex:1;padding:.5rem;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;font:inherit}
 .none{color:#a23}.skip{color:var(--soft)}.trash{color:#8a4a1d}.ok{color:#2f7d4f}.undo{color:#3a6098}
 kbd{font:.8rem monospace;background:var(--line);border-radius:4px;padding:0 .3rem}
 .done{text-align:center;padding:3rem;color:var(--soft)} .hint{color:var(--soft);font-size:.85rem;text-align:center;margin:.6rem 0}
</style>
<header>
 <b>Curació</b>
 <label class=meta>full <select id=q></select></label>
 <span class=seg><button id=mTable class=on>Taula</button><button id=mCard>Fitxes</button></span>
 <input id=search placeholder="🔍 cerca grafia / nom / NGIB" style="width:16rem">
 <label class=meta>conf <select id=fdec><option value="">tota</option><option>confirmat</option><option>probable</option><option>suggerit</option><option>posicional</option><option>sense</option></select></label>
 <label class=meta>revisió <select id=frev><option value="">tota</option><option value=any>revisat</option><option value=none>sense revisar</option><option value=corregit>corregit</option></select></label>
 <span class=grow></span>
 <span id=prog class=meta></span>
</header>
<div id=tablewrap></div>
<main id=cardview style=display:none><div id=app></div><div id=map></div></main>
<div class=hint id=hint></div>
<script>
var Q='', MODE='table', ROWS=[], NGIB=[];
var esc=function(s){return (s==null?'':''+s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});};
var $=function(s){return document.querySelector(s);};

function api(p){ return p+(p.indexOf('?')<0?'?':'&')+'q='+Q; }
async function post(body){ body.q=Q; await fetch('/pick',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}); }

async function boot(){
  var qs=(await (await fetch('/quadrants')).json()).quadrants;
  $('#q').innerHTML=qs.map(function(x){return '<option>'+x.toUpperCase()+'</option>';}).join('');
  Q=qs[0]||'';
  $('#q').onchange=function(){Q=$('#q').value.toLowerCase();reload();};
  $('#mTable').onclick=function(){setMode('table');};
  $('#mCard').onclick=function(){setMode('card');};
  ['#search','#fdec','#frev'].forEach(function(s){$(s).addEventListener('input',applyFilter);});
  try{ NGIB=await (await fetch('/ngib')).json(); }catch(e){}
  reload();
}
function setMode(m){ MODE=m; $('#mTable').classList.toggle('on',m==='table'); $('#mCard').classList.toggle('on',m==='card');
  $('#tablewrap').style.display=m==='table'?'':'none'; $('#cardview').style.display=m==='card'?'grid':'none'; reload(); }
function reload(){ if(MODE==='table') loadTable(); else loadCards(); }

/* ================= TABLE VIEW ================= */
async function loadTable(){
  ROWS=(await (await fetch(api('/table'))).json()).rows;
  var head='<tr><th>Grafia (gravat)</th><th>Lectura</th><th>Tipus</th><th>Confiança</th><th>NGIB</th><th>Municipi</th><th class=num>km</th><th></th></tr>';
  var body=ROWS.map(rowHTML).join('');
  $('#tablewrap').innerHTML='<table><thead>'+head+'</thead><tbody id=tb>'+body+'</tbody></table>';
  wireTable(); applyFilter(); prog();
  $('#hint').innerHTML='Edita la lectura (Enter desa) · tria/escriu el NGIB (Enter) o clica un candidat · ✓ correcte · 🗑 brossa · ↶ desfés. En acabar, re-aplica el match del full (apply_graf_fixes + ngib_match, veure PER-SHEET.md).';
}
function rowHTML(r){
  var pend=r.pend?'<span class=pendtag> ·'+r.pend+(r.pendPick?' '+esc(r.pendPick):'')+'</span>':'';
  var rev=r.review==='revisat'?'<span class=rev title="revisat a mà">✓</span>':r.review==='corregit'?'<span class=rev title="corregit a mà">✎</span>':'';
  var chips=(r.cand||[]).slice(0,4).map(function(c){return '<span class=chip data-g="'+esc(c.grafia)+'">'+esc(c.grafia)+'</span>';}).join('');
  return '<tr data-id="'+r.id+'" data-dec="'+r.decision+'" data-rev="'+(r.review||'')+'" '
    +'data-text="'+esc(((r.graf||'')+' '+(r.nom||'')+' '+(r.ngib||'')+' '+(r.municipi||'')).toLowerCase())+'"'
    +(r.pend?' class=pend':'')+(r.discarded?' class=disc':'')+'>'
    +'<td><input class=eg data-id="'+r.id+'" value="'+esc(r.graf)+'">'+(r.grafEdited?' <span class=pendtag>✎</span>':'')+'</td>'
    +'<td>'+esc(r.nom)+'</td><td class=meta>'+esc(r.tipus)+'</td>'
    +'<td><span class="badge b-'+r.decision+'">'+r.decision+'</span>'+rev+pend+'</td>'
    +'<td><input class=en data-id="'+r.id+'" value="'+esc(r.ngib||'')+'" placeholder="—">'+(chips?'<div class=chips>'+chips+'</div>':'')+'</td>'
    +'<td class=meta>'+esc(r.municipi||'')+'</td><td class=num>'+(r.km==null?'':r.km)+'</td>'
    +'<td class=rowact><button class=ok title="correcte (revisat)">✓</button><button class=tr title="brossa">🗑</button><button class=un title="desfés">↶</button></td>'
    +'</tr>';
}
function wireTable(){
  var tb=$('#tb');
  tb.addEventListener('keydown',function(e){
    if(e.key!=='Enter')return; var t=e.target;
    if(t.classList.contains('eg')){ saveReading(t.dataset.id,t.value); }
    else if(t.classList.contains('en')){ if(t.value.trim()) pickRow(t.dataset.id,t.value.trim()); }
  });
  tb.addEventListener('click',function(e){
    var tr=e.target.closest('tr'); if(!tr)return; var id=tr.dataset.id;
    if(e.target.classList.contains('chip')){ var g=e.target.dataset.g; var en=tr.querySelector('.en'); if(en)en.value=g; pickRow(id,g); }
    else if(e.target.classList.contains('ok')) okRow(id);
    else if(e.target.classList.contains('tr')) trashRow(id);
    else if(e.target.classList.contains('un')) undoRow(id);
  });
}
function rowOf(id){ return ROWS.find(function(r){return r.id===id;}); }
function trEl(id){ return $('#tb tr[data-id="'+CSS.escape(id)+'"]'); }
async function saveReading(id,v){ var r=rowOf(id); v=(v||'').trim(); if(!r||!v||v===r.graf)return; r.graf=v; r.grafEdited=(v!==r.graf0); await post({id:id,action:'graf',graf:v}); flash(id); }
async function pickRow(id,g){ var r=rowOf(id); if(!r)return; r.pend='pick'; r.pendPick=g; r.review=(g===r.ngib?'revisat':'corregit'); await post({id:id,action:'pick',grafia:g,graf:ged(id)}); refreshRow(id); prog(); }
async function okRow(id){ var r=rowOf(id); if(!r)return; r.pend='ok'; r.review='revisat'; await post({id:id,action:'ok',graf:ged(id)}); refreshRow(id); prog(); }
async function trashRow(id){ var r=rowOf(id); if(!r)return; r.pend='trash'; r.discarded=true; await post({id:id,action:'trash',graf:ged(id)}); refreshRow(id); prog(); }
async function undoRow(id){ var r=rowOf(id); if(!r)return; r.pend=null; r.pendPick=null; r.discarded=false; await post({id:id,action:'undo'}); refreshRow(id); prog(); }
function ged(id){ var r=rowOf(id); return (r&&r.grafEdited)?r.graf:null; }
function refreshRow(id){ var tr=trEl(id); if(!tr)return; var r=rowOf(id); var n=document.createElement('tbody'); n.innerHTML=rowHTML(r); tr.replaceWith(n.firstChild); applyFilter(); }
function flash(id){ var tr=trEl(id); if(tr){tr.style.background='#eaf3ec';setTimeout(function(){tr.style.background='';},500);} }
function applyFilter(){
  if(MODE!=='table')return; var t=($('#search').value||'').trim().toLowerCase(),d=$('#fdec').value,rv=$('#frev').value;
  var rows=document.querySelectorAll('#tb tr'),shown=0;
  rows.forEach(function(tr){
    var rev=tr.dataset.rev;
    var rok=!rv||(rv==='any'?!!rev:rv==='none'?!rev:rev===rv);
    var ok=(!d||tr.dataset.dec===d)&&rok&&(!t||tr.dataset.text.indexOf(t)>=0);
    tr.style.display=ok?'':'none'; if(ok)shown++;
  });
  prog(shown);
}
function prog(shown){
  var done=ROWS.filter(function(r){return r.pend||r.review;}).length;
  $('#prog').textContent=Q.toUpperCase()+' · '+ROWS.length+' topònims · '+done+' revisats'+(shown!=null?' · mostrant '+shown:'');
}

/* ================= CARD VIEW (crops + map) ================= */
var DATA=[],STATE={picks:{},reviewed:{},graf:{}},queue=[],ci=0,map,mlayer,ngibLayer,searchLayer,chist=[];
async function loadCards(){
  var dd=await (await fetch(api('/data'))).json(); DATA=dd.items||[];
  STATE=await (await fetch(api('/state'))).json();
  initMap(); cbuild();
  $('#hint').innerHTML='Fitxes: <kbd>1</kbd>–<kbd>6</kbd> candidat · <kbd>C</kbd> correcte · <kbd>0</kbd> cap match · <kbd>D</kbd> brossa · <kbd>S</kbd> saltar · <kbd>U</kbd> desfés';
}
function cbuild(){ var f=$('#fdec').value; queue=DATA.filter(function(d){return !(d.id in STATE.reviewed)&&(!f||d.decision===f);}); ci=0; crender(); }
function crender(){
  var done=Object.keys(STATE.reviewed).length;
  $('#prog').textContent=Q.toUpperCase()+' · fitxes · revisats '+done+'/'+DATA.length+' · cua '+queue.length;
  var app=$('#app');
  if(!DATA.length){app.innerHTML='<div class=done>Aquest full no té crops rendetjats.<br>Genera\\'ls amb render_review_crops.py (REVIEW_* del full) o usa la vista Taula.</div>';return;}
  if(!queue.length){app.innerHTML='<div class=done>✓ Res més a la cua amb aquest filtre.</div>';clearMap();return;}
  var d=queue[ci];
  var cands=d.candidates.map(function(c,n){var rec=(c.grafia===d.ngib)?' rec':'';return '<button class="cand'+rec+'" data-g="'+esc(c.grafia)+'"><kbd>'+(n+1)+'</kbd><b>'+esc(c.grafia)+'</b><div class=m>'+esc(c.municipi||'?')+' · '+c.km+'km · sim '+c.sim+'</div></button>';}).join('');
  app.innerHTML='<div><img class=crop src="'+api('/crop/'+d.id+'.jpg')+'"></div><div>'
    +'<div class=meta><span class="badge b-'+d.decision+'">'+d.decision+'</span> · '+esc(d.tipus)+' · <code>'+d.id+'</code></div>'
    +'<div class=act><label style="flex:0 0 auto;color:var(--soft);align-self:center">Lectura</label>'
    +'<input id=cgraf value="'+esc((STATE.graf&&STATE.graf[d.id])||d.graf)+'" style="flex:3;font-weight:600">'
    +'<button onclick="csave()">💾</button></div>'
    +(cands||'<div class=meta>(sense candidats)</div>')
    +'<div class=act><input id=ccustom placeholder="…escriu el nom NGIB i Enter" style="flex:3"><button onclick="ccustom()">✓ Escrit</button></div>'
    +'<div class=act><button class=ok onclick="cok()"><kbd>C</kbd> ✓ Correcte</button><button class=none onclick="cnone()"><kbd>0</kbd> Cap</button>'
    +'<button class=trash onclick="ctrash()"><kbd>D</kbd> 🗑</button><button class=skip onclick="cskip()"><kbd>S</kbd> Saltar</button>'
    +'<button class=undo onclick="cundo()">↶ <kbd>U</kbd></button></div></div>';
  app.querySelectorAll('.cand').forEach(function(b){b.onclick=function(){cpick(b.dataset.g);};});
  cmap(d);
}
function cgrafv(){var el=$('#cgraf'),d=queue[ci];if(!el||!d)return null;var v=el.value.trim();return (v&&v!==d.graf)?v:null;}
function cadvance(){queue.splice(ci,1);if(ci>=queue.length)ci=queue.length-1;crender();}
async function cpick(g){var d=queue[ci];chist.push(d.id);STATE.reviewed[d.id]='pick';STATE.picks[d.id]=g;await post({id:d.id,action:'pick',grafia:g,graf:cgrafv()});cadvance();}
async function cnone(){var d=queue[ci];chist.push(d.id);STATE.reviewed[d.id]='none';await post({id:d.id,action:'none',graf:cgrafv()});cadvance();}
async function ctrash(){var d=queue[ci];chist.push(d.id);STATE.reviewed[d.id]='trash';await post({id:d.id,action:'trash',graf:cgrafv()});cadvance();}
async function cok(){var d=queue[ci];chist.push(d.id);STATE.reviewed[d.id]='ok';await post({id:d.id,action:'ok',graf:cgrafv()});cadvance();}
async function csave(){var d=queue[ci],g=cgrafv();if(!g)return;(STATE.graf=STATE.graf||{})[d.id]=g;await post({id:d.id,action:'graf',graf:g});}
function cskip(){ci=(ci+1)%queue.length;crender();}
function ccustom(){var v=$('#ccustom').value.trim();if(v)cpick(v);}
async function cundo(){var id=chist.pop();if(!id)return;delete STATE.reviewed[id];delete STATE.picks[id];await post({id:id,action:'undo'});cbuild();}
function initMap(){if(map)return;map=L.map('map');L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);ngibLayer=L.layerGroup().addTo(map);mlayer=L.layerGroup().addTo(map);map.setView([39.6,3.0],9);map.on('moveend',rngib);}
function rngib(){if(!ngibLayer||!NGIB.length||map.getZoom()<12)return;ngibLayer.clearLayers();var b=map.getBounds(),n=0;for(var k=0;k<NGIB.length;k++){var a=NGIB[k];if(a[3]<b.getSouth()||a[3]>b.getNorth()||a[2]<b.getWest()||a[2]>b.getEast())continue;var mk=L.circleMarker([a[3],a[2]],{radius:3,color:'#999',weight:1,fillColor:'#ccc',fillOpacity:.75});mk.bindTooltip('<b>'+esc(a[0])+'</b> · '+esc(a[1]||''));mk.on('click',(function(g){return function(){cpick(g);};})(a[0]));mk.addTo(ngibLayer);if(++n>700)break;}}
function clearMap(){if(mlayer)mlayer.clearLayers();}
function cmap(d){if(!map)return;map.invalidateSize();mlayer.clearLayers();var pts=[];if(d.lat!=null){L.circleMarker([d.lat,d.lon],{radius:8,color:'#c00',weight:2,fillColor:'#c00',fillOpacity:.45}).addTo(mlayer);pts.push([d.lat,d.lon]);}(d.candidates||[]).forEach(function(c,n){if(c.lat!=null){var mk=L.circleMarker([c.lat,c.lon],{radius:7,color:'#1d6b4f',weight:2,fillColor:'#37a37e',fillOpacity:.9});mk.bindTooltip('<b>'+(n+1)+'. '+esc(c.grafia)+'</b>');mk.on('click',(function(g){return function(){cpick(g);};})(c.grafia));mk.addTo(mlayer);pts.push([c.lat,c.lon]);}});if(pts.length)map.fitBounds(pts,{padding:[35,35],maxZoom:15});}
addEventListener('keydown',function(e){
  if(MODE!=='card'||!queue.length)return; if(e.target.tagName==='INPUT'){if(e.key==='Enter'){if(e.target.id==='ccustom')ccustom();else if(e.target.id==='cgraf')csave();}return;}
  var d=queue[ci];
  if(e.key>='1'&&e.key<='6'){var c=d.candidates[+e.key-1];if(c)cpick(c.grafia);}
  else if(e.key==='0')cnone();else if(e.key==='c')cok();else if(e.key==='d')ctrash();
  else if(e.key==='s'||e.key===' '){e.preventDefault();cskip();}
  else if(e.key==='u'){e.preventDefault();cundo();}
});
boot();
</script>`;

const send = (res, code, type, body) => { res.writeHead(code, { 'content-type': type }); res.end(body); };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const q = (u.searchParams.get('q') || '').toLowerCase();
  if (req.method === 'GET' && u.pathname === '/') return send(res, 200, 'text/html; charset=utf8', PAGE);
  if (req.method === 'GET' && u.pathname === '/quadrants') return send(res, 200, 'application/json', JSON.stringify({ quadrants: QUADRANTS }));
  if (req.method === 'GET' && u.pathname === '/ngib') return send(res, 200, 'application/json', NGIB_JSON);
  if (req.method === 'GET' && u.pathname === '/table' && QUADRANTS.includes(q))
    return send(res, 200, 'application/json', JSON.stringify({ rows: tableRows(q) }));
  if (req.method === 'GET' && u.pathname === '/data' && QUADRANTS.includes(q)) {
    const d = readJSON(F(q).reviewdata, { items: [] }); return send(res, 200, 'application/json', JSON.stringify(d));
  }
  if (req.method === 'GET' && u.pathname === '/state' && QUADRANTS.includes(q)) {
    const f = F(q); return send(res, 200, 'application/json', JSON.stringify({ picks: readJSON(f.picks, {}), reviewed: readJSON(f.reviewed, {}), graf: readJSON(f.graf, {}) }));
  }
  if (req.method === 'GET' && u.pathname.startsWith('/crop/') && QUADRANTS.includes(q)) {
    const p = `${F(q).crops}/${path.basename(u.pathname)}`;
    if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); }
    return send(res, 200, 'image/jpeg', fs.readFileSync(p));
  }
  if (req.method === 'POST' && u.pathname === '/pick') {
    let body = ''; req.on('data', (c) => body += c);
    req.on('end', () => {
      const { q: bq, id, action, grafia, graf } = JSON.parse(body || '{}');
      if (!QUADRANTS.includes(bq)) return send(res, 400, 'application/json', '{"ok":false}');
      const f = F(bq);
      const reviewed = readJSON(f.reviewed, {}), picks = readJSON(f.picks, {});
      if (graf) { const gf = readJSON(f.graf, {}); gf[id] = graf; writeJSON(f.graf, gf); }
      if (action === 'pick' && grafia) { picks[id] = grafia; reviewed[id] = 'pick'; writeJSON(f.picks, picks); writeJSON(f.reviewed, reviewed); }
      else if (action === 'none') { reviewed[id] = 'none'; writeJSON(f.reviewed, reviewed); }
      else if (action === 'ok') { reviewed[id] = 'ok'; writeJSON(f.reviewed, reviewed); }
      else if (action === 'trash') { const dj = readJSON(f.discards, {}); dj[id] = true; writeJSON(f.discards, dj); reviewed[id] = 'trash'; writeJSON(f.reviewed, reviewed); }
      else if (action === 'undo') {
        if (id in reviewed) { delete reviewed[id]; writeJSON(f.reviewed, reviewed); }
        if (id in picks) { delete picks[id]; writeJSON(f.picks, picks); }
        const dj = readJSON(f.discards, {}); if (id in dj) { delete dj[id]; writeJSON(f.discards, dj); }
      }
      send(res, 200, 'application/json', '{"ok":true}');
    });
    return;
  }
  res.writeHead(404); res.end();
});
server.listen(4400, () => console.log(`Curació → http://localhost:4400/  (quadrants: ${QUADRANTS.join(', ') || 'cap'})`));

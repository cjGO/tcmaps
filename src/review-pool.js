import {terrainColor,renderHeatmapFrame} from './review-heatmap.js';
import {pointAt,complete,exportKept} from './review-pool-state.js';
import './review-pool.css';
export async function setupReviewPool(root) {
  const base=import.meta.env.BASE_URL+'review/highpool/';
  root.innerHTML='<h1>Highpool map review</h1><p role="status">Loading candidates…</p>';
  try {
    const response=await fetch(base+'manifest.json'); if(!response.ok) throw new Error('Candidate manifest unavailable');
    const manifest=await response.json(), maps=manifest.maps, key='manual-review:'+manifest.pool_id+':'+manifest.created_utc;
    let records={}, index=0, grid=null, mode='team1', generation=0, ready=false, guides=[], drag=null, storageError='';
    try { records=JSON.parse(localStorage.getItem(key)||'{}'); if(!records||Array.isArray(records)||typeof records!=='object') throw Error('Invalid progress'); }
    catch { storageError='Saved progress could not be read. Changes are session-only; export before leaving.'; records={}; }
    root.innerHTML=`<h1>Highpool map review</h1><p>Keep candidates, place team 1 and 2 spawns, and export your shortlist. Progress saves in this browser.</p>
    <div class="sweep-toolbar"><button data-r="prev">← Previous</button><label>Candidate <select data-r="map"></select></label><button data-r="next">Next →</button><label><input type="checkbox" data-r="keep"> Keep / export</label><button data-r="export">Export kept CSV</button></div>
    <p data-r="progress"></p><div class="sweep-toolbar"><button data-r="team1">Place team 1</button><button data-r="team2">Place team 2</button><button data-r="measure">Measure from spawns</button><button data-r="clear">Clear measurements</button><button data-r="reset">Clear spawns</button><button data-r="retry">Reload map</button><a data-r="original" target="_blank" rel="noopener">Original heatmap ↗</a></div>
    <p>Click to place the selected team; drag its marker to adjust. Measurement spots show horizontal distances from both spawns and never enter the CSV.</p>
    <p data-r="status" role="status" aria-live="polite"></p><div class="review-canvas-wrap"><div class="review-figure"><canvas data-r="canvas" width="804" height="804" aria-label="Terrain map: click to place spawns or measurements"></canvas><svg data-r="frame" viewBox="0 0 1040 930" aria-label="Metre axes and shared elevation legend"></svg></div></div><p data-r="elevation-summary" class="review-elevation-summary"></p>
    <p data-r="coords"></p><label>Notes <input data-r="notes" type="text"></label><p>North / +Y is up. Colours use the same fixed elevation key across all 500 candidates (blue → green → yellow → brown → white). Spawn Z is interpolated from engine samples; validate final ground heights in engine.</p>`;
    const el=n=>root.querySelector(`[data-r="${n}"]`), canvas=el('canvas'), ctx=canvas.getContext('2d');
    const options=maps.map(m=>new Option(m.name,m.candidate_id));el('map').append(...options);
    const current=()=>maps[index], record=()=>records[current().candidate_id]||{keep:false,spawns:[null,null],notes:''};
    function status(s){el('status').textContent=storageError||s;}
    function save(r){records[current().candidate_id]=r;try{if(!storageError)localStorage.setItem(key,JSON.stringify(records));}catch{storageError='Browser storage unavailable. Export your kept CSV before leaving.';}update();}
    function update(){const r=record();el('keep').checked=!!r.keep;el('notes').value=r.notes||'';
      let kept=0,pending=0;maps.forEach((m,i)=>{const v=records[m.candidate_id];if(v?.keep){kept++;if(!complete(v))pending++;}options[i].textContent=`${m.name}${v?.keep?' · Kept':''}${complete(v)?' · Spawns set':''}`;});
      el('progress').textContent=`${index+1} / ${maps.length} candidates · ${kept} kept · ${pending} kept maps need spawns`;
      el('export').disabled=!kept;for(const m of ['team1','team2','measure'])el(m).setAttribute('aria-pressed',String(mode===m));
      el('coords').textContent=r.spawns.map((p,t)=>`Team ${t+1}: ${p?`X ${p.x_m.toFixed(2)}, Y ${p.y_m.toFixed(2)}, Z ≈ ${p.z_m.toFixed(2)} m`:'unplaced'}`).join(' · ');draw();}
    let terrain;
    function pixel(p){const b=grid.bounds;return [(p.x_m-b.x_min_m)/(b.x_max_m-b.x_min_m)*804,(b.y_max_m-p.y_m)/(b.y_max_m-b.y_min_m)*804];}
    function draw(){ctx.clearRect(0,0,804,804);if(!grid||!terrain)return;ctx.drawImage(terrain,0,0,804,804);const r=record();
      for(const p of guides){const [x,y]=pixel(p);r.spawns.forEach((s,t)=>{if(!s)return;const [a,b]=pixel(s);ctx.strokeStyle=t?'#ef394a':'#1263ed';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(a,b);ctx.lineTo(x,y);ctx.stroke();ctx.font='bold 18px sans-serif';ctx.lineWidth=4;ctx.strokeStyle='white';const label=`T${t+1}: ${Math.hypot(p.x_m-s.x_m,p.y_m-s.y_m).toFixed(1)} m`;ctx.strokeText(label,(a+x)/2,(b+y)/2);ctx.fillStyle=t?'#a01020':'#00429c';ctx.fillText(label,(a+x)/2,(b+y)/2);});ctx.fillStyle='#7928a1';ctx.beginPath();ctx.arc(x,y,7,0,Math.PI*2);ctx.fill();}
      r.spawns.forEach((p,t)=>{if(!p)return;const[x,y]=pixel(p);ctx.beginPath();ctx.arc(x,y,15,0,Math.PI*2);ctx.fillStyle=t?'#d02035':'#0959d7';ctx.fill();ctx.strokeStyle='white';ctx.lineWidth=3;ctx.stroke();ctx.fillStyle='white';ctx.font='bold 18px sans-serif';ctx.textAlign='center';ctx.fillText(String(t+1),x,y+6);ctx.textAlign='left';});}
    async function open(i){index=(i+maps.length)%maps.length;const token=++generation;ready=false;grid=null;terrain=null;guides=[];drag=null;el('frame').replaceChildren();el('elevation-summary').textContent='';el('map').value=current().candidate_id;el('original').href=base+current().heatmap_file;update();status('Loading terrain…');
      try{const res=await fetch(base+current().grid_file);if(!res.ok)throw Error('Terrain unavailable');const g=await res.json();if(token!==generation)return;grid=g;terrain=document.createElement('canvas');const size=402;terrain.width=terrain.height=size;const c=terrain.getContext('2d'), image=c.createImageData(size,size);
        for(let y=0;y<size;y++)for(let x=0;x<size;x++){const h=pointAt(g,(x+.5)/size,(y+.5)/size).z_m,rgb=terrainColor(h,manifest.colour_scale),o=(y*size+x)*4;for(let k=0;k<3;k++)image.data[o+k]=rgb[k];image.data[o+3]=255;}c.putImageData(image,0,0);
        renderHeatmapFrame(el('frame'),g,manifest.colour_scale,current().name);
        const low=Math.min(...g.heights), high=Math.max(...g.heights), scale=manifest.colour_scale;
        el('elevation-summary').textContent=`Shared Highpool elevation scale: ${scale.min_m.toFixed(2)}–${scale.max_m.toFixed(2)} m · This map: ${low.toFixed(2)}–${high.toFixed(2)} m · Relief: ${(high-low).toFixed(2)} m. Measured terrain bounds: X ${g.bounds.x_min_m}–${g.bounds.x_max_m} m, Y ${g.bounds.y_min_m}–${g.bounds.y_max_m} m. +Y / north is up.`;
        ready=true;update();status('Choose a team and click the terrain to place its spawn.');
      }catch(e){if(token===generation)status(e.message+' — use Reload map.');}}
    const pick=e=>{const b=canvas.getBoundingClientRect();return pointAt(grid,Math.max(0,Math.min(1,(e.clientX-b.left)/b.width)),Math.max(0,Math.min(1,(e.clientY-b.top)/b.height)));};
    canvas.onpointerdown=e=>{if(!ready||e.button!==0)return;const p=pick(e),r=record();if(mode==='measure'){guides.push(p);draw();return;}const [x,y]=pixel(p);const hit=r.spawns.findIndex(s=>s&&Math.hypot(pixel(s)[0]-x,pixel(s)[1]-y)<24);drag=hit>=0?hit:mode==='team1'?0:1;r.spawns[drag]=p;save(r);canvas.setPointerCapture(e.pointerId);};
    canvas.onpointermove=e=>{if(drag===null||!ready)return;const r=record();r.spawns[drag]=pick(e);save(r);};
    canvas.onpointerup=canvas.onpointercancel=()=>{drag=null;status('Progress saved in this browser.');};
    el('map').onchange=()=>open(maps.findIndex(m=>m.candidate_id===el('map').value));el('prev').onclick=()=>open(index-1);el('next').onclick=()=>open(index+1);el('retry').onclick=()=>open(index);
    el('keep').onchange=()=>{save({...record(),keep:el('keep').checked});status('Keep tag updated.');};el('notes').onchange=()=>save({...record(),notes:el('notes').value});
    for(const m of ['team1','team2','measure'])el(m).onclick=()=>{mode=m;update();};el('clear').onclick=()=>{guides=[];draw();};el('reset').onclick=()=>save({...record(),spawns:[null,null]});
    el('export').onclick=()=>{try{const csv=exportKept(manifest,records),url=URL.createObjectURL(new Blob([csv],{type:'text/csv'})),a=document.createElement('a');a.href=url;a.download='highpool-kept-maps.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('Exported kept maps with both team spawns.');}catch(e){status(e.message);}};
    await open(0);
  }catch(e){root.querySelector('[role="status"]').textContent=e.message+' — refresh to retry.';}
}

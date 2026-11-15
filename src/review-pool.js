import {terrainStops,terrainColor,renderHeatmapFrame} from './review-heatmap.js';
import {pointAt,complete,exportKept} from './review-pool-state.js';
import './review-pool.css';
export async function setupReviewPool(root, {load3D=()=>import('./review-terrain-viewer.js')} = {}) {
  const base=import.meta.env.BASE_URL+'review/highpool/';
  root.innerHTML='<h1>Highpool map review</h1><p role="status">Loading candidates…</p>';
  try {
    const response=await fetch(base+'manifest.json'); if(!response.ok) throw new Error('Candidate manifest unavailable');
    const manifest=await response.json(), maps=manifest.maps, key='manual-review:'+manifest.pool_id+':'+manifest.created_utc;
    let records={}, index=0, grid=null, mode=null, generation=0, ready=false, guides=[], drag=null, storageError='';
    let view='2d', viewer3D=null, viewGeneration=0;
    try { records=JSON.parse(localStorage.getItem(key)||'{}'); if(!records||Array.isArray(records)||typeof records!=='object') throw Error('Invalid progress'); }
    catch { storageError='Saved progress could not be read. Changes are session-only; export before leaving.'; records={}; }
    root.innerHTML=`<h1>Highpool map review</h1><p>Keep candidates, place team 1 and 2 spawns, and export your shortlist. Progress saves in this browser.</p>
    <div class="sweep-toolbar"><button data-r="prev">← Previous</button><label>Candidate <select data-r="map"></select></label><button data-r="next">Next →</button><label><input type="checkbox" data-r="keep"> Keep / export</label><button data-r="export">Export kept CSV</button></div>
    <p data-r="progress"></p><div class="sweep-toolbar" role="group" aria-label="Review map view"><button data-r="view2d" aria-pressed="true">2D heatmap &amp; editing</button><button data-r="view3d" aria-pressed="false">3D terrain</button></div><div class="sweep-toolbar"><button data-r="team1">Place team 1</button><button data-r="team2">Place team 2</button><button data-r="measure">Measure from spawns</button><button data-r="clear">Clear measurements</button><button data-r="reset">Clear spawns</button><button data-r="retry">Reload map</button><a data-r="original" target="_blank" rel="noopener">Original heatmap ↗</a></div>
    <p>Select a placement button, then click once to place. With no button selected, drag a team marker or purple measurement spot to adjust it. Measurement spots show horizontal distances from both spawns and never enter the CSV.</p>
    <p data-r="status" role="status" aria-live="polite"></p><div data-r="heatmap" class="review-canvas-wrap"><div class="review-figure"><canvas data-r="canvas" width="804" height="804" aria-label="Terrain map: click to place spawns or measurements"></canvas><svg data-r="frame" viewBox="0 0 1040 930" aria-label="Metre axes and shared elevation legend"></svg></div></div><section data-r="three" hidden>
      <div class="sweep-toolbar"><label>Camera <select data-r="camera"><option value="aerial">Aerial</option><option value="reverse">Opposite side</option><option value="overhead">Overhead</option></select></label><label>Height <select data-r="height"><option value="1">1× · true scale</option><option value="2">2× · exaggerated</option><option value="4">4× · exaggerated</option></select></label><label><input data-r="contours" type="checkbox"> 2 m contours</label><button data-r="reset3d">Reset view</button></div>
      <p data-r="three-status" role="status"></p><div data-r="three-stage" class="review-three-stage"></div>
      <div class="review-three-legend"><span data-r="legend-low"></span><span data-r="legend-ramp"></span><span data-r="legend-high"></span><strong>Elevation (m) · shared across all 500 maps</strong></div>
      <p>Drag to orbit · scroll to zoom · right-drag to pan. Numbered markers show your placed team spawns. Return to 2D to edit spawns or measurements. Terrain only; trees and scene objects are not included. Lighting affects colour appearance.</p>
    </section><p data-r="elevation-summary" class="review-elevation-summary"></p>
    <p data-r="coords"></p><label>Notes <input data-r="notes" type="text"></label><p>North / +Y is up. Colours use the same fixed elevation key across all 500 candidates (blue → green → yellow → brown → white). Spawn Z is interpolated from engine samples; validate final ground heights in engine.</p>`;
    const el=n=>root.querySelector(`[data-r="${n}"]`), canvas=el('canvas'), ctx=canvas.getContext('2d');
    el('legend-low').textContent=manifest.colour_scale.min_m.toFixed(2);
    el('legend-high').textContent=manifest.colour_scale.max_m.toFixed(2);
    el('legend-ramp').style.background=`linear-gradient(to right,${terrainStops.map(([p,c])=>`rgb(${c.map(v=>Math.round(v*255)).join(',')}) ${p*100}%`).join(',')})`;
    function dispose3D(){viewGeneration++;viewer3D?.dispose();viewer3D=null;el('three-stage').replaceChildren();}
    async function show3D(){
      dispose3D();if(view!=='3d'||!ready||root.closest('[role="tabpanel"]')?.hidden)return;
      const token=viewGeneration;el('three-status').textContent='Loading 3D terrain…';
      el('camera').value='aerial';el('height').value='1';el('contours').checked=false;
      try{
        const {createReviewTerrain}=await load3D();
        if(token!==viewGeneration)return;
        viewer3D=createReviewTerrain(el('three-stage'),grid,current(),record().spawns,manifest.colour_scale,message=>{if(token===viewGeneration)el('three-status').textContent=message;});
        el('three-status').textContent='Measured terrain · true height scale. Select 2D to continue editing.';
      }catch(error){if(token===viewGeneration)el('three-status').textContent=`3D terrain could not load: ${error.message}. You can continue in 2D, or click 3D terrain to retry.`;}
    }
    function setView(next){
      view=next;mode=null;drag=null;el('heatmap').hidden=view==='3d';el('three').hidden=view!=='3d';
      el('view2d').setAttribute('aria-pressed',String(view==='2d'));el('view3d').setAttribute('aria-pressed',String(view==='3d'));
      for(const name of ['team1','team2','measure','clear','reset'])el(name).disabled=view==='3d';
      update();if(view==='3d')show3D();else dispose3D();
    }
    el('view2d').onclick=()=>setView('2d');el('view3d').onclick=()=>setView('3d');
    el('camera').onchange=()=>viewer3D?.preset(el('camera').value);
    el('height').onchange=()=>{viewer3D?.exaggeration(Number(el('height').value));el('three-status').textContent=el('height').value==='1'?'Measured terrain · true height scale.':`Height exaggerated ${el('height').value}×; colours still show actual elevation.`;};
    el('contours').onchange=()=>viewer3D?.contours(el('contours').checked);
    el('reset3d').onclick=()=>{el('camera').value='aerial';el('height').value='1';el('contours').checked=false;viewer3D?.contours(false);viewer3D?.exaggeration(1);viewer3D?.preset('aerial');el('three-status').textContent='Measured terrain · true height scale.';};
    const panel=root.closest('[role="tabpanel"]');
    if(panel){const observer=new MutationObserver(()=>{if(panel.hidden)dispose3D();else if(view==='3d')show3D();});observer.observe(panel,{attributes:true,attributeFilter:['hidden']});}
    const options=maps.map(m=>new Option(m.name,m.candidate_id));el('map').append(...options);
    const current=()=>maps[index], record=()=>records[current().candidate_id]||{keep:false,spawns:[null,null],notes:''};
    function status(s){el('status').textContent=storageError||s;}
    function save(r){records[current().candidate_id]=r;try{if(!storageError)localStorage.setItem(key,JSON.stringify(records));}catch{storageError='Browser storage unavailable. Export your kept CSV before leaving.';}update();}
    function update(){const r=record();el('keep').checked=!!r.keep;el('notes').value=r.notes||'';
      let kept=0,pending=0;maps.forEach((m,i)=>{const v=records[m.candidate_id];if(v?.keep){kept++;if(!complete(v))pending++;}options[i].textContent=`${m.name}${v?.keep?' · Kept':''}${complete(v)?' · Spawns set':''}`;});
      el('progress').textContent=`${index+1} / ${maps.length} candidates · ${kept} kept · ${pending} kept maps need spawns`;
      canvas.style.cursor=drag?'grabbing':mode?'crosshair':'default';el('export').disabled=!kept;for(const m of ['team1','team2','measure'])el(m).setAttribute('aria-pressed',String(mode===m));
      el('coords').textContent=r.spawns.map((p,t)=>`Team ${t+1}: ${p?`X ${p.x_m.toFixed(2)}, Y ${p.y_m.toFixed(2)}, Z ≈ ${p.z_m.toFixed(2)} m`:'unplaced'}`).join(' · ');draw();}
    let terrain;
    function pixel(p){const b=grid.bounds;return [(p.x_m-b.x_min_m)/(b.x_max_m-b.x_min_m)*804,(b.y_max_m-p.y_m)/(b.y_max_m-b.y_min_m)*804];}
    function draw(){ctx.clearRect(0,0,804,804);if(!grid||!terrain)return;ctx.drawImage(terrain,0,0,804,804);const r=record();
      for(const p of guides){const [x,y]=pixel(p);r.spawns.forEach((s,t)=>{if(!s)return;const [a,b]=pixel(s);ctx.strokeStyle=t?'#ef394a':'#1263ed';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(a,b);ctx.lineTo(x,y);ctx.stroke();ctx.font='bold 18px sans-serif';ctx.lineWidth=4;ctx.strokeStyle='white';const label=`T${t+1}: ${Math.hypot(p.x_m-s.x_m,p.y_m-s.y_m).toFixed(1)} m`;ctx.strokeText(label,(a+x)/2,(b+y)/2);ctx.fillStyle=t?'#a01020':'#00429c';ctx.fillText(label,(a+x)/2,(b+y)/2);});ctx.fillStyle='#7928a1';ctx.beginPath();ctx.arc(x,y,7,0,Math.PI*2);ctx.fill();}
      r.spawns.forEach((p,t)=>{if(!p)return;const[x,y]=pixel(p);ctx.beginPath();ctx.arc(x,y,15,0,Math.PI*2);ctx.fillStyle=t?'#d02035':'#0959d7';ctx.fill();ctx.strokeStyle='white';ctx.lineWidth=3;ctx.stroke();ctx.fillStyle='white';ctx.font='bold 18px sans-serif';ctx.textAlign='center';ctx.fillText(String(t+1),x,y+6);ctx.textAlign='left';});}
    async function open(i){dispose3D();el('three-status').textContent='Loading terrain…';index=(i+maps.length)%maps.length;const token=++generation;ready=false;grid=null;terrain=null;guides=[];drag=null;mode=null;el('frame').replaceChildren();el('elevation-summary').textContent='';el('map').value=current().candidate_id;el('original').href=base+current().heatmap_file;update();status('Loading terrain…');
      try{const res=await fetch(base+current().grid_file);if(!res.ok)throw Error('Terrain unavailable');const g=await res.json();if(token!==generation)return;grid=g;terrain=document.createElement('canvas');const size=402;terrain.width=terrain.height=size;const c=terrain.getContext('2d'), image=c.createImageData(size,size);
        for(let y=0;y<size;y++)for(let x=0;x<size;x++){const h=pointAt(g,(x+.5)/size,(y+.5)/size).z_m,rgb=terrainColor(h,manifest.colour_scale),o=(y*size+x)*4;for(let k=0;k<3;k++)image.data[o+k]=rgb[k];image.data[o+3]=255;}c.putImageData(image,0,0);
        renderHeatmapFrame(el('frame'),g,manifest.colour_scale,current().name);
        const low=Math.min(...g.heights), high=Math.max(...g.heights), scale=manifest.colour_scale;
        el('elevation-summary').textContent=`Shared Highpool elevation scale: ${scale.min_m.toFixed(2)}–${scale.max_m.toFixed(2)} m · This map: ${low.toFixed(2)}–${high.toFixed(2)} m · Relief: ${(high-low).toFixed(2)} m. Measured terrain bounds: X ${g.bounds.x_min_m}–${g.bounds.x_max_m} m, Y ${g.bounds.y_min_m}–${g.bounds.y_max_m} m. +Y / north is up.`;
        ready=true;update();if(view==='3d')show3D();status('Select a button to place one point, or drag an existing point.');
      }catch(e){if(token===generation)status(e.message+' — use Reload map.');}}
    const pick=e=>{const b=canvas.getBoundingClientRect();return pointAt(grid,Math.max(0,Math.min(1,(e.clientX-b.left)/b.width)),Math.max(0,Math.min(1,(e.clientY-b.top)/b.height)));};
    function hitPoint(point) {
      const [x,y]=pixel(point), radius=18*804/canvas.getBoundingClientRect().width;
      const candidates=[
        ...record().spawns.flatMap((p,index)=>p?[{kind:'spawn',index,point:p}]:[]),
        ...guides.map((p,index)=>({kind:'guide',index,point:p})),
      ];
      return candidates.map(item=>({...item,distance:Math.hypot(pixel(item.point)[0]-x,pixel(item.point)[1]-y)}))
        .filter(item=>item.distance<=radius).sort((a,b)=>a.distance-b.distance)[0];
    }
    canvas.onpointerdown=e=>{
      if(!ready||e.button!==0||drag)return;
      const p=pick(e), hit=hitPoint(p);
      // Existing handles always win over placement, even when a tool is armed.
      if(hit){drag={...hit,pointerId:e.pointerId};mode=null;canvas.setPointerCapture(e.pointerId);update();return;}
      if(!mode)return;
      const selected=mode;mode=null;
      if(selected==='measure'){guides.push(p);update();status('Measurement placed. Drag any point to adjust it.');}
      else {const r=record();r.spawns[selected==='team1'?0:1]=p;save(r);status('Spawn placed. Drag any point to adjust it.');}
    };
    canvas.onpointermove=e=>{
      if(!ready)return;
      if(!drag){canvas.style.cursor=hitPoint(pick(e))?'grab':mode?'crosshair':'default';return;}
      if(e.pointerId!==drag.pointerId)return;
      const p=pick(e);
      if(drag.kind==='guide'){guides[drag.index]=p;draw();}
      else {const r=record();r.spawns[drag.index]=p;save(r);}
    };
    function endDrag(e){
      if(!drag||e.pointerId!==drag.pointerId)return;
      const previous=drag;drag=null;
      if(e.type==='pointercancel'){
        if(previous.kind==='guide')guides[previous.index]=previous.point;
        else {const r=record();r.spawns[previous.index]=previous.point;save(r);}
      }
      if(canvas.hasPointerCapture?.(e.pointerId))canvas.releasePointerCapture(e.pointerId);
      update();status('Drag any point to adjust it, or select a button to place one point.');
    }
    canvas.onpointerup=canvas.onpointercancel=canvas.onlostpointercapture=endDrag;
    root.addEventListener('keydown',e=>{if(e.key==='Escape'){mode=null;update();status('Placement cancelled. Drag any existing point to adjust it.');}});
    el('map').onchange=()=>open(maps.findIndex(m=>m.candidate_id===el('map').value));el('prev').onclick=()=>open(index-1);el('next').onclick=()=>open(index+1);el('retry').onclick=()=>open(index);
    el('keep').onchange=()=>{save({...record(),keep:el('keep').checked});status('Keep tag updated.');};el('notes').onchange=()=>save({...record(),notes:el('notes').value});
    for(const m of ['team1','team2','measure'])el(m).onclick=()=>{mode=mode===m?null:m;update();status(mode?`Click once to place ${mode==='measure'?'a measurement spot':mode==='team1'?'team 1':'team 2'}. Click the button again or press Esc to cancel.`:'Drag any existing point to adjust it.');};el('clear').onclick=()=>{guides=[];draw();};el('reset').onclick=()=>save({...record(),spawns:[null,null]});
    el('export').onclick=()=>{try{const csv=exportKept(manifest,records),url=URL.createObjectURL(new Blob([csv],{type:'text/csv'})),a=document.createElement('a');a.href=url;a.download='highpool-kept-maps.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('Exported kept maps with both team spawns.');}catch(e){status(e.message);}};
    await open(0);
  }catch(e){root.querySelector('[role="status"]').textContent=e.message+' — refresh to retry.';}
}

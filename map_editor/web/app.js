(function() {
  'use strict';
  const project = JSON.parse(document.getElementById('project-data').textContent);
  const C = MapCoordinates, $ = id => document.getElementById(id);
  const svg = $('overlay'), NS = 'http://www.w3.org/2000/svg';
  const assets = new Map(project.assets.map(a=>[a.name,a]));
  const favoritesKey = 'map-editor.asset-favorites.v1';
  let favorites = new Set(), favoritesOnly = false;
  function readFavorites() {
    try {
      const saved=JSON.parse(localStorage.getItem(favoritesKey)||'[]');
      if(Array.isArray(saved)) return new Set(saved.filter(name=>typeof name==='string'));
    } catch {}
    return new Set();
  }
  favorites=readFavorites();
  const categories = [...new Set(project.assets.map(a=>a.group))];
  for(const group of categories) $('asset-category').appendChild(new Option(group,group));
  let previewRequest = 0;
  let points = [], selected = null, mode = 'place', dirty = false, drag = null;
  let settings = {...C.defaults};
  let spawns = C.editableSpawns(project);
  const undo = [], redo = [];
  const snapshot = () => JSON.stringify({points,settings,spawns});
  const documentData = () => ({version:3, source:project.source, placements:points, settings, default_spawn_points:project.default_spawn_points, spawn_points:spawns});
  // Optional same-origin 3D view shares this document and its undo history.
  // Standalone heatmap editors keep working without a renderer or network.
  const listeners = new Set();
  let externalMove = null;
  const state = () => JSON.parse(JSON.stringify({document:documentData(),selected,mode,favorites:[...favorites],
    brush:{asset:$('asset').value,yaw_deg:Number($('yaw').value),scale:Number($('scale').value)}}));
  function notify() { if(listeners.size) { const value=state(); for(const fn of listeners) fn(value); } }
  function status(message, error=false) { $('status').textContent=message; $('status').classList.toggle('error',error); }
  function remember(before=snapshot()) { undo.push(before); if(undo.length>100) undo.shift(); redo.length=0; dirty=true; }
  function restore(value) { const state=JSON.parse(value); points=state.points; settings=state.settings; spawns=state.spawns; }
  function settingsControls() {
    for(const [key,value] of Object.entries(settings)) $(key).value=value;
    $('precipitation_intensity').disabled=!['rain','snow'].includes(settings.precipitation);
    $('thunder_frequency').disabled=!['thunder','lightning'].includes(settings.thunder);
  }
  function current() { return points.find(p=>p.id===selected); }
  function pointAt(event) {
    const r=svg.getBoundingClientRect();
    return C.imageToWorld((event.clientX-r.left)/r.width,(event.clientY-r.top)/r.height,project.calibration);
  }
  function assetOptions() {
    $('assets-all').setAttribute('aria-pressed',!favoritesOnly);
    $('assets-favorites').setAttribute('aria-pressed',favoritesOnly);
    $('assets-favorites').textContent=`★ Favorites (${project.assets.filter(a=>favorites.has(a.name)).length})`;
    const previous=$('asset').value, query=$('search').value.trim().toLowerCase();
    $('asset').replaceChildren();
    for(const group of categories) {
      if($('asset-category').value && $('asset-category').value!==group) continue;
      const entries=project.assets.filter(a=>a.group===group && (!favoritesOnly || favorites.has(a.name)) && `${a.label} ${a.name} ${a.mesh}`.toLowerCase().includes(query));
      if(!entries.length) continue;
      const el=document.createElement('optgroup'); el.label=group;
      for(const asset of entries) el.appendChild(new Option(asset.label,asset.name));
      $('asset').appendChild(el);
    }
    if([...$('asset').options].some(o=>o.value===previous)) $('asset').value=previous;
    else if($('asset').options.length) $('asset').selectedIndex=0;
    $('asset-count').textContent=`${$('asset').options.length} of ${project.assets.length} assets`;
    $('favorites-hint').textContent=favoritesOnly && !$('asset').options.length
      ? 'No favorites match. Open All assets to star assets, or clear your search and category filters.'
      : 'Favorites are saved in this browser across maps.';
    assetInfo();
  }
  function assetInfo() {
    const a=assets.get($('asset').value);
    const favorite=Boolean(a && favorites.has(a.name));
    $('asset-favorite').disabled=!a;
    $('asset-favorite').setAttribute('aria-pressed',favorite);
    $('asset-favorite').textContent=favorite ? '★ Remove from favorites' : '☆ Add to favorites';
    $('asset-info').textContent=a ? `${a.group} · ${a.collision?'Collision mesh defined':'No collision mesh'} · Origin offset 0 m (unverified)` : 'No matching assets.';
    const token=++previewRequest, container=$('asset-preview-image');
    $('asset-preview-caption').textContent=a ? a.label : 'No asset selected';
    container.textContent=a ? (a.preview ? 'Loading preview…' : 'Preview unavailable for this asset.') : 'No matching assets.';
    notify();
    if(!a?.preview) return;
    const image=new Image();
    image.alt=`${a.label} — textured model preview`;
    image.width=320; image.height=320;
    image.onload=()=>{if(token===previewRequest) container.replaceChildren(image);};
    image.onerror=()=>{if(token===previewRequest) container.textContent='Preview unavailable for this asset.';};
    image.src=a.preview;
  }
  function choose(id) {
    selected=id;
    const p=current();
    if(p) {
      if(![...$('asset').options].some(o=>o.value===p.asset)) { favoritesOnly=false; $('search').value=''; $('asset-category').value=''; assetOptions(); }
      $('asset').value=p.asset; $('yaw').value=p.yaw_deg; $('scale').value=p.scale; assetInfo();
    }
    render();
  }
  function element(tag, attributes) {
    const node=document.createElementNS(NS,tag);
    for(const [key,value] of Object.entries(attributes)) node.setAttribute(key,value);
    return node;
  }
  function draw() {
    svg.replaceChildren();
    const c=project.calibration, factor=c.width_px/(svg.getBoundingClientRect().width||c.width_px);
    for(const p of spawns) {
      const {u,v}=C.worldToImage(p.x_m,p.y_m,c), x=u*c.width_px, y=v*c.height_px;
      const group=element('g',{'data-spawn':p.team,class:'spawn-point'});
      group.appendChild(element('circle',{cx:x,cy:y,r:11*factor,fill:p.team===0?'#004bba':'#b51629',stroke:'white','stroke-width':2*factor}));
      const label=element('text',{x,y:y+4*factor,'text-anchor':'middle','font-size':12*factor,fill:'white','pointer-events':'none'});
      label.textContent=String(p.team+1); group.appendChild(label);
      const title=element('title',{}); title.textContent=`Team ${p.team+1} · Entry ${p.entry}: ${p.x_m}, ${p.y_m} m (drag to edit)`; group.appendChild(title);
      svg.appendChild(group);
    }
    for(const [i,p] of points.entries()) {
      const {u,v}=C.worldToImage(p.x_m,p.y_m,c), x=u*c.width_px, y=v*c.height_px;
      const group=element('g',{'data-id':p.id,class:'point'});
      const radius=(selected===p.id?9:7)*factor;
      group.appendChild(element('circle',{cx:x,cy:y,r:radius,fill:selected===p.id?'#d9480f':'#255c42',stroke:'#fff','stroke-width':2*factor}));
      const angle=p.yaw_deg*Math.PI/180, length=17*factor;
      group.appendChild(element('line',{x1:x,y1:y,x2:x-Math.sin(angle)*length,y2:y-Math.cos(angle)*length,stroke:'#e4972c','stroke-width':2*factor,'pointer-events':'none'}));
      const label=element('text',{x:x+11*factor,y:y-10*factor,'font-size':11*factor,fill:'#20362d',stroke:'white','stroke-width':3*factor,'paint-order':'stroke','pointer-events':'none'});
      label.textContent=String(i+1); group.appendChild(label);
      const title=element('title',{}); title.textContent=`${i+1}. ${assets.get(p.asset).label} (${p.x_m}, ${p.y_m})`; group.appendChild(title);
      svg.appendChild(group);
    }
  }
  function render() {
    draw(); settingsControls();
    const team=Number($('spawn-team').value), spawn=spawns[team], original=project.default_spawn_points?.[team];
    $('spawn-x').value=spawn?.x_m ?? ''; $('spawn-y').value=spawn?.y_m ?? '';
    $('spawn-default').textContent=original ? `Original: X ${original.x_m.toFixed(3)} · Y ${original.y_m.toFixed(3)} · Z ${original.z_m.toFixed(3)} m` : 'Spawn defaults unavailable.';
    const p=current();
    $('selection').textContent=p ? `${points.indexOf(p)+1}. ${assets.get(p.asset).label}` : 'No point selected';
    for(const axis of ['x','y']) { $(axis).disabled=!p; $(axis).value=p?p[axis+'_m']:''; }
    $('z-offset').disabled=!p; $('z-offset').value=p ? (p.z_offset_m ?? 0) : '';
    $('z-lower').disabled=$('z-reset').disabled=!p;
    $('delete').disabled=!p; $('undo').disabled=!undo.length; $('redo').disabled=!redo.length;
    $('count').textContent=`${points.length} object${points.length===1?'':'s'}`;
    $('point-list').replaceChildren(...points.map((p,i)=>new Option(`${i+1}. ${assets.get(p.asset).label}`,p.id)));
    $('point-list').value=selected||'';
    notify();
  }
  function changeSelected(patch) {
    const p=current(); if(!p) {notify(); return;}
    const candidate=points.map(item=>item.id===p.id?{...item,...patch}:item);
    try { C.validate({...documentData(),placements:candidate},project); remember(); points=candidate; render(); status('Point updated.'); }
    catch(error) { status(error.message,true); choose(selected); }
  }
  function placeAt(x,y) {
    if(!assets.has($('asset').value)) throw new Error('Choose an asset from All assets or Favorites first.');
    const point={x_m:C.quantize(x),y_m:C.quantize(y)};
    if(!C.inside(point.x_m,point.y_m,project.bounds)) throw new Error('Place inside the actual terrain border.');
    const p={id:globalThis.crypto?.randomUUID?.()||`p_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      asset:$('asset').value,...point,yaw_deg:Number($('yaw').value),scale:Number($('scale').value)};
    C.validate({...documentData(),placements:[...points,p]},project);
    remember(); points.push(p); choose(p.id); status('Placed. Select and drag to adjust its position.');
    return p.id;
  }
  function setMode(value) {
    if(!['place','select','navigate','line'].includes(value)) throw new Error('Unknown editor mode');
    mode=value;
    $('place').setAttribute('aria-pressed',value==='place'); $('select').setAttribute('aria-pressed',value==='select');
    svg.classList.toggle('select-mode',value!=='place'); choose(null);
  }
  svg.addEventListener('pointerdown', event=>{
    if(event.button!==0) return;
    const spawnMarker=event.target.closest('[data-spawn]');
    if(spawnMarker) {
      const team=Number(spawnMarker.getAttribute('data-spawn'));
      $('spawn-team').value=team; choose(null);
      drag={team,before:snapshot(),pointer:event.pointerId};
      svg.setPointerCapture(event.pointerId); event.preventDefault(); return;
    }
    const marker=event.target.closest('[data-id]');
    if(marker) {
      choose(marker.getAttribute('data-id'));
      drag={id:selected,before:snapshot(),pointer:event.pointerId};
      svg.setPointerCapture(event.pointerId); event.preventDefault(); return;
    }
    if(mode!=='place') { choose(null); return; }
    const point=pointAt(event);
    if(!C.inside(point.x_m,point.y_m,project.bounds)) { status('Click inside the actual terrain border; blank margins are outside the map.',true); return; }
    try { placeAt(point.x_m,point.y_m); }
    catch(error) { status(error.message,true); }
  });
  svg.addEventListener('pointermove',event=>{
    const point=pointAt(event);
    $('coordinates').textContent=`X ${point.x_m.toFixed(3)} · Y ${point.y_m.toFixed(3)} m`;
    if(!drag || event.pointerId!==drag.pointer) return;
    if(C.inside(point.x_m,point.y_m,project.bounds)) {
      if(drag.team!==undefined) {
        const candidate=spawns.map(p=>p.team===drag.team?{...p,...point}:p);
        try { C.validateSpawns({...documentData(),spawn_points:candidate},project); spawns=candidate; render(); } catch(error) {status(error.message,true);}
      } else { Object.assign(current(),point); draw(); $('x').value=point.x_m; $('y').value=point.y_m; notify(); }
    }
  });
  function finishDrag(event) {
    if(!drag || event.pointerId!==drag.pointer) return;
    if(event.type==='pointercancel') restore(drag.before);
    else if(snapshot()!==drag.before) remember(drag.before);
    drag=null; render();
  }
  svg.addEventListener('pointerup',finishDrag); svg.addEventListener('pointercancel',finishDrag);
  for(const key of Object.keys(C.defaults)) $(key).addEventListener('change',()=>{
    const candidate={...settings,[key]:key.endsWith('_intensity')||key.endsWith('_frequency')?Number($(key).value):$(key).value};
    try {
      C.validateSettings({...documentData(),settings:candidate});
      remember(); settings=candidate; render(); status('Map settings updated. Save your loadout to include them in the build.');
    } catch(error) { settingsControls(); status(error.message,true); }
  });
  $('spawn-team').addEventListener('change',render);
  for(const axis of ['x','y']) $('spawn-'+axis).addEventListener('change',()=>{
    const team=Number($('spawn-team').value), candidate=spawns.map(p=>p.team===team?{...p,[axis+'_m']:Number($('spawn-'+axis).value)}:p);
    try { C.validateSpawns({...documentData(),spawn_points:candidate},project); remember(); spawns=candidate; render(); status('Team spawn updated. Save your loadout JSON to keep it.'); }
    catch(error) {render(); status(error.message,true);}
  });
  $('spawn-reset').addEventListener('click',()=>{remember(); spawns=C.editableSpawns(project); render(); status('Both team spawns reset to the original defaults.');});
  $('search').addEventListener('input',assetOptions);
  $('asset-category').addEventListener('change',assetOptions);
  $('assets-all').addEventListener('click',()=>{favoritesOnly=false;assetOptions();});
  $('assets-favorites').addEventListener('click',()=>{favoritesOnly=true;assetOptions();});
  $('asset-favorite').addEventListener('click',()=>{
    const name=$('asset').value;
    if(!assets.has(name)) return;
    if(favorites.has(name)) favorites.delete(name); else favorites.add(name);
    let saved=true;
    try { localStorage.setItem(favoritesKey,JSON.stringify([...favorites])); } catch { saved=false; }
    assetOptions();
    if(!saved) $('favorites-hint').textContent='Favorites are available for this session. Browser storage is unavailable.';
  });
  window.addEventListener('storage',event=>{
    if(event.key===favoritesKey || event.key===null) { favorites=readFavorites(); assetOptions(); }
  });
  $('asset').addEventListener('change',()=>{assetInfo(); if(current()) changeSelected({asset:$('asset').value});});
  for(const [id,key] of [['yaw','yaw_deg'],['scale','scale'],['x','x_m'],['y','y_m'],['z-offset','z_offset_m']])
    $(id).addEventListener('change',()=>changeSelected({[key]:Number($(id).value)}));
  $('z-lower').addEventListener('click',()=>{if(current()) changeSelected({z_offset_m:C.quantize((current().z_offset_m ?? 0)-.25)});});
  $('z-reset').addEventListener('click',()=>{if(current()) changeSelected({z_offset_m:0});});
  $('point-list').addEventListener('change',()=>choose($('point-list').value));
  $('delete').addEventListener('click',()=>{if(!current()) return; remember(); points=points.filter(p=>p.id!==selected); choose(null); status('Point deleted.');});
  for(const id of ['place','select']) $(id).addEventListener('click',()=>setMode(id));
  $('undo').addEventListener('click',()=>{if(!undo.length) return; redo.push(snapshot()); restore(undo.pop()); dirty=true; choose(null);});
  $('redo').addEventListener('click',()=>{if(!redo.length) return; undo.push(snapshot()); restore(redo.pop()); dirty=true; choose(null);});
  function fitStage() {
    const viewport=$('viewport');
    const base=Math.min(viewport.clientWidth,viewport.clientHeight);
    $('stage').style.width=`${base*Number($('zoom').value)}px`;
    draw();
  }
  $('zoom').addEventListener('change',fitStage);
  new ResizeObserver(fitStage).observe($('viewport'));
  new ResizeObserver(draw).observe(svg);
  $('export').addEventListener('click',()=>{
    try {
      C.validate(documentData(),project);
      const blob=new Blob([JSON.stringify(documentData(),null,2)+'\n'],{type:'application/json'});
      const url=URL.createObjectURL(blob), link=document.createElement('a');
      link.href=url; link.download=(project.display_name || project.source.scene_id)+'.placements.json'; link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000); dirty=false; status('Map loadout downloaded. Build applies map assets, biome, weather and team spawn settings.');
    } catch(error) {status(error.message,true);}
  });
  $('import').addEventListener('click',()=>$('file').click());
  $('file').addEventListener('change',async()=>{
    const file=$('file').files[0]; if(!file) return;
    try {
      if(file.size>10*1024*1024) throw new Error('Placement file is too large.');
      const document=JSON.parse(await file.text());
      const imported=C.validate(document,project), importedSettings=C.validateSettings(document);
      remember(); points=imported; settings=importedSettings; spawns=C.validateSpawns(document,project); choose(null); status('Loadout loaded. Undo restores your previous points, spawns and map settings.');
    } catch(error) {status(error.message,true);} finally {$('file').value='';}
  });
  $('hotkeys-open').addEventListener('click',()=>$('hotkeys').showModal());
  document.addEventListener('keydown',event=>{
    if($('hotkeys').open || event.defaultPrevented || event.target.closest('input,select,textarea,[contenteditable]:not([contenteditable="false"])')) return;
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z') {event.preventDefault(); $(event.shiftKey?'redo':'undo').click();}
    if(event.ctrlKey||event.metaKey||event.altKey) return;
    if(event.key===' ') {
      event.preventDefault();
      if(!event.repeat && !drag && !externalMove) setMode(mode==='navigate'?'place':'navigate');
      return;
    }
    const key=event.key.toLowerCase();
    if(['x','a','d','q','e'].includes(key)) {
      if(drag || externalMove) return;
      event.preventDefault();
      if(key==='x') {$('delete').click(); return;}
      const yaw=key==='a'||key==='d', input=$(yaw?'yaw':'scale');
      const value=Number(input.value);
      if(!Number.isFinite(value)) return;
      input.value=yaw ? ((value+(key==='a'?1:-1))%360+360)%360
        : Math.max(.1,Math.min(10,Math.round((value+(key==='q' ? .1 : -.1))*1000)/1000));
      if(Number(input.value)!==value) input.dispatchEvent(new Event('change'));
      return;
    }
    if(event.key==='Delete'||event.key==='Backspace') {event.preventDefault(); $('delete').click();}
    if(event.key==='Escape') choose(null);
  });
  window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
  svg.setAttribute('viewBox',`0 0 ${project.calibration.width_px} ${project.calibration.height_px}`);
  $('scene-name').textContent=project.display_name || project.source.scene_id;
  assetOptions(); render();
  window.MapEditor = Object.freeze({
    getState:state,
    subscribe(fn) { listeners.add(fn); fn(state()); return ()=>listeners.delete(fn); },
    select(id) { if(id!==null&&!points.some(p=>p.id===id)) throw new Error('Unknown placement'); choose(id); },
    setMode, placeAt, status,
    placeBatch(locations) {
      if(!Array.isArray(locations)||!locations.length||locations.length>1000) throw new Error('Choose between 1 and 1000 assets.');
      const batch=locations.map(({asset=$('asset').value,x_m,y_m,yaw_deg=Number($('yaw').value),scale=Number($('scale').value)})=>({
        id:globalThis.crypto?.randomUUID?.()||`p_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        asset,x_m:C.quantize(x_m),y_m:C.quantize(y_m),
        yaw_deg,scale,
      }));
      C.validate({...documentData(),placements:[...points,...batch]},project);
      remember(); points.push(...batch); choose(null); status(`Placed ${batch.length} assets along the line.`);
    },
    beginMove(id) {
      if(externalMove||drag) throw new Error('A move is already in progress');
      if(!points.some(p=>p.id===id)) throw new Error('Unknown placement');
      choose(id); externalMove={id,before:snapshot()};
    },
    moveTo(x,y,zOffset) {
      if(!externalMove) return;
      const patch={x_m:C.quantize(x),y_m:C.quantize(y)};
      if(zOffset!==undefined) patch.z_offset_m=C.quantize(zOffset);
      const candidate=points.map(p=>p.id===externalMove.id?{...p,...patch}:p);
      C.validate({...documentData(),placements:candidate},project); points=candidate; render();
    },
    finishMove(cancel=false) {
      if(!externalMove) return;
      if(cancel) restore(externalMove.before);
      else if(snapshot()!==externalMove.before) remember(externalMove.before);
      externalMove=null; render();
    },
  });
})();

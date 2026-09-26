(function() {
  'use strict';
  const project = JSON.parse(document.getElementById('project-data').textContent);
  const C = MapCoordinates, $ = id => document.getElementById(id);
  const svg = $('overlay'), NS = 'http://www.w3.org/2000/svg';
  const assets = new Map(project.assets.map(a=>[a.name,a]));
  let points = [], selected = null, mode = 'place', dirty = false, drag = null;
  let settings = {...C.defaults};
  const undo = [], redo = [];
  const snapshot = () => JSON.stringify({points,settings});
  const documentData = () => ({version:2, source:project.source, placements:points, settings});
  function status(message, error=false) { $('status').textContent=message; $('status').classList.toggle('error',error); }
  function remember(before=snapshot()) { undo.push(before); if(undo.length>100) undo.shift(); redo.length=0; dirty=true; }
  function restore(value) { const state=JSON.parse(value); points=state.points; settings=state.settings; }
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
    const previous=$('asset').value, query=$('search').value.trim().toLowerCase();
    $('asset').replaceChildren();
    for(const group of ['Trees','Shrubs','Other vegetation']) {
      const entries=project.assets.filter(a=>a.group===group && a.label.toLowerCase().includes(query));
      if(!entries.length) continue;
      const el=document.createElement('optgroup'); el.label=group;
      for(const asset of entries) el.appendChild(new Option(asset.label,asset.name));
      $('asset').appendChild(el);
    }
    if([...$('asset').options].some(o=>o.value===previous)) $('asset').value=previous;
    else if($('asset').options.length) $('asset').selectedIndex=0;
    assetInfo();
  }
  function assetInfo() {
    const a=assets.get($('asset').value);
    $('asset-info').textContent=a ? `${a.group} · ${a.collision?'Collision mesh defined':'No collision mesh'} · Origin offset 0 m (unverified)` : 'No matching assets.';
  }
  function choose(id) {
    selected=id;
    const p=current();
    if(p) {
      if(![...$('asset').options].some(o=>o.value===p.asset)) { $('search').value=''; assetOptions(); }
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
    const p=current();
    $('selection').textContent=p ? `${points.indexOf(p)+1}. ${assets.get(p.asset).label}` : 'No point selected';
    for(const axis of ['x','y']) { $(axis).disabled=!p; $(axis).value=p?p[axis+'_m']:''; }
    $('delete').disabled=!p; $('undo').disabled=!undo.length; $('redo').disabled=!redo.length;
    $('count').textContent=`${points.length} object${points.length===1?'':'s'}`;
    $('point-list').replaceChildren(...points.map((p,i)=>new Option(`${i+1}. ${assets.get(p.asset).label}`,p.id)));
    $('point-list').value=selected||'';
  }
  function changeSelected(patch) {
    const p=current(); if(!p) return;
    const candidate=points.map(item=>item.id===p.id?{...item,...patch}:item);
    try { C.validate({...documentData(),placements:candidate},project); remember(); points=candidate; render(); status('Point updated.'); }
    catch(error) { status(error.message,true); choose(selected); }
  }
  svg.addEventListener('pointerdown', event=>{
    if(event.button!==0) return;
    const marker=event.target.closest('[data-id]');
    if(marker) {
      choose(marker.getAttribute('data-id'));
      drag={id:selected,before:snapshot(),pointer:event.pointerId};
      svg.setPointerCapture(event.pointerId); event.preventDefault(); return;
    }
    if(mode==='select') { choose(null); return; }
    const point=pointAt(event);
    if(!C.inside(point.x_m,point.y_m,project.bounds)) { status('Click inside the actual terrain border; blank margins are outside the map.',true); return; }
    const asset=$('asset').value;
    const p={id:globalThis.crypto?.randomUUID?.()||`p_${Date.now()}_${Math.random().toString(36).slice(2)}`,asset,...point,yaw_deg:Number($('yaw').value),scale:Number($('scale').value)};
    try { C.validate({...documentData(),placements:[...points,p]},project); remember(); points.push(p); choose(p.id); status('Placed. Drag the marker to adjust its position.'); }
    catch(error) { status(error.message,true); }
  });
  svg.addEventListener('pointermove',event=>{
    const point=pointAt(event);
    $('coordinates').textContent=`X ${point.x_m.toFixed(3)} · Y ${point.y_m.toFixed(3)} m`;
    if(!drag || event.pointerId!==drag.pointer) return;
    if(C.inside(point.x_m,point.y_m,project.bounds)) { Object.assign(current(),point); draw(); $('x').value=point.x_m; $('y').value=point.y_m; }
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
  $('search').addEventListener('input',assetOptions);
  $('asset').addEventListener('change',()=>{assetInfo(); if(current()) changeSelected({asset:$('asset').value});});
  for(const [id,key] of [['yaw','yaw_deg'],['scale','scale'],['x','x_m'],['y','y_m']])
    $(id).addEventListener('change',()=>changeSelected({[key]:Number($(id).value)}));
  $('point-list').addEventListener('change',()=>choose($('point-list').value));
  $('delete').addEventListener('click',()=>{if(!current()) return; remember(); points=points.filter(p=>p.id!==selected); choose(null); status('Point deleted.');});
  for(const id of ['place','select']) $(id).addEventListener('click',()=>{mode=id; $('place').setAttribute('aria-pressed',id==='place'); $('select').setAttribute('aria-pressed',id==='select'); svg.classList.toggle('select-mode',id==='select'); choose(null);});
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
      link.href=url; link.download=project.source.scene_id+'.placements.json'; link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000); dirty=false; status('Map loadout downloaded. Build applies vegetation, biome and weather settings.');
    } catch(error) {status(error.message,true);}
  });
  $('import').addEventListener('click',()=>$('file').click());
  $('file').addEventListener('change',async()=>{
    const file=$('file').files[0]; if(!file) return;
    try {
      if(file.size>10*1024*1024) throw new Error('Placement file is too large.');
      const document=JSON.parse(await file.text());
      const imported=C.validate(document,project), importedSettings=C.validateSettings(document);
      remember(); points=imported; settings=importedSettings; choose(null); status('Loadout loaded. Undo restores your previous points and map settings.');
    } catch(error) {status(error.message,true);} finally {$('file').value='';}
  });
  document.addEventListener('keydown',event=>{
    if(event.target.closest('input,select,textarea')) return;
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z') {event.preventDefault(); $(event.shiftKey?'redo':'undo').click();}
    if(event.key==='Delete'||event.key==='Backspace') {event.preventDefault(); $('delete').click();}
    if(event.key==='Escape') choose(null);
  });
  window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
  svg.setAttribute('viewBox',`0 0 ${project.calibration.width_px} ${project.calibration.height_px}`);
  $('scene-name').textContent=project.source.scene_id;
  assetOptions(); render();
})();

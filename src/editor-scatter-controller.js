import * as THREE from 'three';
import { groundHeight } from './editor-spatial.js';
import { terrainGeometry } from './terrain-geometry.js';
import { createLineAssetPicker } from './editor-line-picker.js';
import { createLinePresets } from './editor-line-presets.js';
import { scatterDefaults, scatterPresets, scatterRegion, generateScatter, decorateScatter } from './editor-scatter.js';

// Owns temporary tool state and previews; only Place assets changes the document.
export function createScatterController({doc, project, api, extras, context, transform}) {
  const win=doc.defaultView, button=doc.createElement('button'), panel=doc.createElement('section');
  button.id='editor-scatter'; button.textContent='Scatter with noise';
  panel.className='editor-line-panel editor-scatter-panel'; panel.hidden=true;
  const number=(id,label,value,min,max,step=1)=>`<label>${label}<input id="scatter-${id}" type="number" value="${value}" min="${min}" max="${max}" step="${step}"></label>`;
  panel.innerHTML=`<h3>Scatter with noise</h3>
    <p>Create irregular patches, winding bands and clearings. Preview first, then place editable assets.</p>
    <label>Area<select id="scatter-area"><option value="map">Whole map</option><option value="region">Draw region</option></select></label>
    <div id="scatter-region-controls" hidden><p>Click terrain to outline the region. Drag numbered corners to adjust it.</p>
    <button id="scatter-finish">Finish region</button><button id="scatter-remove">Remove last point</button><button id="scatter-clear">Clear region</button></div>
    <p id="scatter-region-summary" role="status"></p>
    <label>Pattern preset<select id="scatter-preset">${Object.keys(scatterPresets).map(name=>`<option>${name}</option>`).join('')}</select></label>
    <div class="pair">${number('patchSize','Patch size (m)',80,1,100000)}${number('coverage','Coverage (%)',45,0,100)}</div>
    ${number('density','Peak density (assets / 1,000 m²)',4,0,1000,.1)}
    <div class="pair">${number('stretch','Stretch',1.5,1,20,.1)}${number('direction','Direction (degrees)',0,-360,360)}</div>
    <div class="pair">${number('warp','Warp (%)',50,0,100)}${number('softness','Edge softness (%)',50,0,100)}</div>
    <p>Patches have dense cores and sparse interiors. Peak density controls the densest areas; increase it for tighter clusters. Coverage changes occupied area and is approximate.</p>
    <details><summary>Spacing & boundaries</summary>
    ${number('spacing','Minimum spacing (m)',2,0,10000,.1)}
    <label><input id="scatter-avoidExisting" type="checkbox" checked> Avoid existing objects</label>
    ${number('feather','Boundary feathering (m)',0,0,10000,1)}
    <p>Minimum spacing also limits dense cores. Lower it to allow closer clusters. Spacing uses object centres, including existing editor placements when enabled. It does not measure model outlines or source vegetation.</p></details>
    <fieldset id="scatter-assets"><legend>Asset mix</legend><div id="scatter-presets"></div><div id="scatter-asset-picker"></div><div id="scatter-mix-rows"></div></fieldset>
    <label><input id="scatter-random-yaw" type="checkbox" checked> Random rotation</label>
    <label><input id="scatter-random-scale" type="checkbox" checked> Default random scale</label>
    <div class="pair">${number('scale-low','Low scale',.8,.1,100,.1)}${number('scale-high','High scale',1.2,.1,100,.1)}</div>
    <p>Per-asset ranges override default scales. Turn off randomization to use the current brush rotation or scale.</p>
    <details><summary>Randomization</summary>
    <button id="scatter-reshuffle">Reshuffle placement</button>
    <button id="scatter-shuffle-assets">Shuffle assets</button><button id="scatter-reroll-yaw">Randomize rotation</button><button id="scatter-reroll-scale">Randomize scales</button></details>
    <label>Preview<select id="scatter-view"><option value="both">Both</option><option value="heatmap">Heatmap</option><option value="assets">Assets</option></select></label>
    <p class="scatter-legend"><span></span> Sparse → Dense</p>
    <p id="scatter-count" role="status"></p><p id="scatter-status" role="status"></p>
    <button id="scatter-generate">Generate preview</button><button id="scatter-new-pattern">Randomize noise & preview</button>
    <button id="scatter-place" disabled>Place assets</button>`;
  doc.querySelector('.modes').append(button); doc.querySelector('aside').prepend(panel);
  const $=id=>panel.querySelector(`#scatter-${id}`);
  const selection=new Map(), overrides=new Map(), models=new Map();
  const layer=new THREE.Group(), heatmap=new THREE.Group(), assets=new THREE.Group(), boundary=new THREE.Group();
  layer.add(heatmap,assets,boundary); extras.add(layer); layer.visible=false;
  let nodes=[], drawing=true, disposed=false, initialized=false, active=false, armed=false, hasPlaced=false, token=0,timer=null;
  let points=[], result=null, generationKey='', stateKey='', rowKey='';
  const seeds={fieldSeed:Math.floor(Math.random()*4294967296),positionSeed:2,assetSeed:3,yawSeed:4,scaleSeed:5};
  function entries() { return [...selection].map(([asset,ratio])=>({asset,ratio,scale:overrides.get(asset)})); }
  function status(message) { $('status').textContent=message; }
  const picker=createLineAssetPicker($('asset-picker'),project.assets,{prefix:'scatter',selection,onAdd(asset){
    selection.set(asset.name,1); renderMix(); invalidate();
  }});
  const presets=createLinePresets($('presets'),project.assets,{prefix:'scatter',getMix:entries,applyMix(mix){
    selection.clear();overrides.clear();
    for(const e of mix) {selection.set(e.asset,e.ratio);overrides.set(e.asset,{...e.scale});}
    renderMix();invalidate();
  }});
  function renderMix() {
    picker.update(api.getState().favorites);
    const signature=JSON.stringify(entries());
    if(signature===rowKey) return; rowKey=signature;
    const host=$('mix-rows'); host.replaceChildren();
    for(const [name,ratio] of selection) {
      const row=doc.createElement('div');row.className='line-asset-row';
      const label=doc.createElement('span');label.textContent=project.assets.find(a=>a.name===name)?.label??name;
      const input=doc.createElement('input');input.type='number';input.min='.01';input.step='any';input.value=ratio;
      input.setAttribute('aria-label',`${label.textContent} ratio`);
      input.addEventListener('input',()=>{selection.set(name,Number(input.value));rowKey=JSON.stringify(entries());invalidate();});
      const detail=doc.createElement('details');detail.className='line-asset-scale';
      detail.innerHTML='<summary>Scale settings</summary><label><input type="checkbox"> Random scale for this asset</label><div class="pair"><label>Low scale<input type="number" min="0.1" max="100" step="0.1"></label><label>High scale<input type="number" min="0.1" max="100" step="0.1"></label></div>';
      const config=overrides.get(name)??{enabled:false,low:.8,high:1.2};overrides.set(name,config);
      const [check,low,high]=detail.querySelectorAll('input');check.checked=config.enabled;low.value=config.low;high.value=config.high;
      low.disabled=high.disabled=!config.enabled;
      for(const [element,key] of [[check,'enabled'],[low,'low'],[high,'high']]) {
        element.setAttribute('aria-label',`${label.textContent} ${key==='enabled'?'random scale':key+' scale'}`);
        element.addEventListener(key==='enabled'?'change':'input',()=>{
          config[key]=key==='enabled'?element.checked:Number(element.value);low.disabled=high.disabled=!config.enabled;
          rowKey=JSON.stringify(entries());invalidate();
        });
      }
      const remove=doc.createElement('button');remove.textContent='Remove from mix';remove.addEventListener('click',()=>{selection.delete(name);overrides.delete(name);renderMix();invalidate();});
      detail.append(remove);row.append(label,input,detail);host.append(row);
    }
    rowKey=JSON.stringify(entries());
  }
  function clearOwned(group) {
    for(const child of [...group.children]) {
      child.geometry?.dispose();child.material?.map?.dispose();child.material?.dispose();group.remove(child);
    }
  }
  function clearPreview() { assets.clear();clearOwned(heatmap);points=[];$('place').disabled=true; }
  function view() {
    heatmap.visible=$('view').value!=='assets';assets.visible=$('view').value!=='heatmap';context().viewer?.draw();
  }
  function drawBoundary() {
    clearOwned(boundary);
    const {ready,data,viewer}=context();
    $('region-controls').hidden=$('area').value!=='region';
    $('region-summary').textContent=$('area').value==='map'?'Whole map':`${nodes.length} corners · ${drawing?'drawing':'finished'}`;
    $('finish').disabled=nodes.length<3;$('finish').textContent=drawing?'Finish region':'Extend region';$('remove').disabled=!nodes.length;
    if(!ready || $('area').value==='map') { viewer?.draw();return; }
    for(let i=0;i<nodes.length;i++) {
      const p=nodes[i],canvas=doc.createElement('canvas');canvas.width=64;canvas.height=64;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#17665c';ctx.beginPath();ctx.arc(32,32,29,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='white';ctx.font='bold 32px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(i+1),32,33);
      const marker=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas),depthTest:false,depthWrite:false}));
      marker.position.set(p.x,p.y,groundHeight(data,p.x,p.y)+2);marker.userData.scatterNode=i;marker.renderOrder=16;
      const cameraPoint=new THREE.Vector3();
      marker.onBeforeRender=(renderer,scene,camera)=>{
        cameraPoint.copy(marker.position).applyMatrix4(camera.matrixWorldInverse);
        const size=32*2*(camera.isPerspectiveCamera?Math.max(.1,-cameraPoint.z):1)/(camera.projectionMatrix.elements[5]*viewer.canvas.clientHeight);
        marker.scale.set(size,size,1);marker.updateMatrixWorld();
      };
      boundary.add(marker);
      if(i===0) continue;
      edge(nodes[i-1],p);
    }
    if(!drawing && nodes.length>=3) edge(nodes.at(-1),nodes[0]);
    function edge(a,b) {
      const vertices=Array.from({length:65},(_,i)=>{const t=i/64,x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t;return new THREE.Vector3(x,y,groundHeight(data,x,y)+.4);});
      const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(vertices),new THREE.LineBasicMaterial({color:'#20b4a3',depthTest:false}));line.renderOrder=14;boundary.add(line);
    }
    viewer.draw();
  }
  function drawHeatmap(field) {
    const {data}=context(), b=project.bounds, width=b.x_max_m-b.x_min_m,height=b.y_max_m-b.y_min_m,n=192;
    const pixels=new Uint8Array(n*n*4);
    for(let j=0;j<n;j++) for(let i=0;i<n;i++) {
      const value=field(b.x_min_m+(i+.5)*width/n,b.y_min_m+(j+.5)*height/n),offset=(j*n+i)*4;
      pixels[offset]=Math.round(35+220*value);pixels[offset+1]=Math.round(160+45*value);pixels[offset+2]=Math.round(200-170*value);pixels[offset+3]=Math.round(value*150);
    }
    const texture=new THREE.DataTexture(pixels,n,n,THREE.RGBAFormat);texture.needsUpdate=true;texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearFilter;
    // Match the terrain's exact grid and triangle diagonal, including steep slopes.
    const {positions,uv,indices}=terrainGeometry(data),geometry=new THREE.BufferGeometry();
    for(let i=0;i<positions.length/3;i++) {
      uv[i*2]=(positions[i*3]-b.x_min_m)/width;uv[i*2+1]=(positions[i*3+1]-b.y_min_m)/height;
      positions[i*3+2]+=.15;
    }
    geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
    geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));geometry.setIndex(new THREE.BufferAttribute(indices,1));
    geometry.computeBoundingSphere();
    const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1}));
    mesh.renderOrder=9;heatmap.add(mesh);
  }
  function settings() {
    const s={...scatterDefaults};
    for(const key of Object.keys(s)) s[key]=key==='avoidExisting'?$(key).checked:Number($(key).value);
    return s;
  }
  async function refresh(version) {
    const {ready,library,state,viewer}=context();
    if(disposed || !active || !ready || !armed || version!==token) return;
    clearPreview();
    try {
      if($('area').value==='region' && drawing) throw new Error('Finish the region to preview assets.');
      const args={bounds:project.bounds,polygon:$('area').value==='region'?nodes:null,settings:settings(),fieldSeed:seeds.fieldSeed,positionSeed:seeds.positionSeed,
        existing:state.document.placements.map(p=>({x_m:p.x_m,y_m:p.y_m}))};
      const key=JSON.stringify(args);
      if(key!==generationKey) {result=generateScatter(args);generationKey=key;}
      const decorated=decorateScatter(result.points,entries(),{...seeds,randomYaw:$('random-yaw').checked,yaw:state.brush.yaw_deg,
        randomScale:$('random-scale').checked,low:Number($('scale-low').value),high:Number($('scale-high').value),scale:state.brush.scale});
      drawHeatmap(result.field);view();
      const counts=new Map();for(const p of decorated) counts.set(p.asset,(counts.get(p.asset)??0)+1);
      $('count').textContent=`${decorated.length} assets`+[...counts].map(([asset,n])=>` · ${project.assets.find(a=>a.name===asset)?.label??asset} × ${n}`).join('');
      const notes=[result.capped?'Reached the batch or document limit.':null,result.limited?'Spacing or sampling reduced the attainable count.':null].filter(Boolean).join(' ');
      if(!decorated.length) {status(`No assets generated. Increase coverage or density, reduce spacing, or enlarge the region. ${notes}`);return;}
      status('Loading asset previews…');
      await Promise.all([...counts.keys()].map(asset=>{
        if(!models.has(asset)) models.set(asset,library.create(asset));
        return models.get(asset);
      }));
      if(disposed || !active || version!==token) return;
      const templates=new Map();for(const asset of counts.keys()) templates.set(asset,await models.get(asset));
      if(disposed || !active || version!==token) return;
      for(const p of decorated) {const object=templates.get(p.asset).clone(true);object.visible=true;transform(object,p);assets.add(object);}
      points=decorated;$('place').disabled=false;status(`${notes} Ready to place. Terrain height does not affect the pattern.`.trim());view();viewer.draw();
    } catch(error) {
      if(!disposed && version===token) {
        points=[];assets.clear();$('place').disabled=true;status(error.message);viewer.draw();
        if(/load|fetch|model|geometry/i.test(error.message)) status(`${error.message} Use Generate preview to retry.`);
      }
    }
  }
  function invalidate() {
    ++token;win.clearTimeout(timer);clearPreview();$('count').textContent='';
    if(!armed) {
      status(hasPlaced?'Placed. Choose Generate preview to create another batch.':'Choose an area and asset mix, then Generate preview.');
      context().viewer?.draw();return;
    }
    if(active) {status('Updating preview…');const version=token;timer=win.setTimeout(()=>refresh(version),120);}
    context().viewer?.draw();
  }
  function sync() {
    const {ready,is3D,state}=context(), next=Boolean(is3D && state.mode==='scatter');
    panel.hidden=!next;button.hidden=!is3D;button.setAttribute('aria-pressed',String(next));layer.visible=next&&ready;
    if(next&&!initialized) {initialized=true;selection.set(state.brush.asset,1);renderMix();}
    if(next) picker.update(state.favorites);
    const key=JSON.stringify({ready,brush:state.brush,placements:state.document.placements.map(p=>[p.id,p.x_m,p.y_m])});
    if(next!==active || (next && key!==stateKey)) {active=next;stateKey=key;drawBoundary();invalidate();}
  }
  button.addEventListener('click',()=>{context().viewer?.exitExplorer();api.setMode('scatter');sync();});
  for(const key of Object.keys(scatterDefaults)) $(key).addEventListener(key==='avoidExisting'?'change':'input',invalidate);
  for(const key of ['scale-low','scale-high']) $(key).addEventListener('input',invalidate);
  for(const key of ['random-yaw','random-scale']) $(key).addEventListener('change',invalidate);
  $('view').addEventListener('change',view);
  $('preset').addEventListener('change',()=>{for(const [key,value] of Object.entries(scatterPresets[$('preset').value])) $(key).value=value;invalidate();});
  $('area').addEventListener('change',()=>{drawBoundary();invalidate();});
  $('finish').addEventListener('click',()=>{
    try {if(drawing) scatterRegion(project.bounds,nodes);drawing=!drawing;drawBoundary();invalidate();} catch(error) {status(error.message);}
  });
  $('remove').addEventListener('click',()=>{nodes.pop();if(nodes.length<3)drawing=true;drawBoundary();invalidate();});
  $('clear').addEventListener('click',()=>{nodes=[];drawing=true;drawBoundary();invalidate();});
  for(const [id,seed,check] of [['reshuffle','positionSeed'],['shuffle-assets','assetSeed'],['reroll-yaw','yawSeed','random-yaw'],['reroll-scale','scaleSeed','random-scale']]) {
    $(id).addEventListener('click',()=>{seeds[seed]=(seeds[seed]+1)>>>0;if(check)$(check).checked=true;invalidate();});
  }
  $('generate').addEventListener('click',()=>{armed=true;models.clear();invalidate();});
  $('new-pattern').addEventListener('click',()=>{seeds.fieldSeed=(seeds.fieldSeed+1)>>>0;armed=true;models.clear();invalidate();});
  $('place').addEventListener('click',()=>{
    if($('place').disabled || !points.length) return;
    try {
      api.placeBatch(points);armed=false;hasPlaced=true;invalidate();
    } catch(error) {status(error.message);}
  });
  return {
    button,panel,sync,
    get markers(){return boundary.children.filter(child=>child.userData.scatterNode!==undefined);},
    getNode(i){return {...nodes[i]};},
    moveNode(i,p){
      const b=project.bounds;
      nodes[i]={x:Math.max(b.x_min_m,Math.min(b.x_max_m,p.x)),y:Math.max(b.y_min_m,Math.min(b.y_max_m,p.y))};drawBoundary();invalidate();
    },
    click(p){
      if(!p || $('area').value!=='region' || !drawing) return;
      if(nodes.length>=128) {status('Regions support up to 128 corners.');return;}
      if(nodes.some(q=>Math.hypot(q.x-p.x,q.y-p.y)<.001)) {status('Choose a distinct corner.');return;}
      nodes.push({x:p.x,y:p.y});drawBoundary();invalidate();
    },
    retry(){models.clear();generationKey='';invalidate();},
    dispose(){disposed=true;++token;win.clearTimeout(timer);presets.dispose();clearPreview();clearOwned(boundary);extras.remove(layer);button.remove();panel.remove();models.clear();},
  };
}

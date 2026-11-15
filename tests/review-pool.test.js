import test from 'node:test';
import assert from 'node:assert/strict';
import {pointAt,exportKept,complete} from '../src/review-pool-state.js';
const grid={bounds:{x_min_m:24,x_max_m:648,y_min_m:24,y_max_m:648},inset_m:1,grid_size:2,heights:[0,10,20,30]};
test('engine coordinates use upward Y, real bounds and bilinear heights',()=>{
 assert.deepEqual(pointAt(grid,0,0),{x_m:24,y_m:648,z_m:20});
 assert.deepEqual(pointAt(grid,1,1),{x_m:648,y_m:24,z_m:10});
 assert.deepEqual(pointAt(grid,.5,.5),{x_m:336,y_m:336,z_m:15});
});
const manifest={pool_id:'highpool',maps:[{candidate_id:'highpool/a',name:'a'},{candidate_id:'highpool/b',name:'b'}]};
test('export includes only kept maps and rejects missing spawns',()=>{
 assert.equal(complete({spawns:[null,null]}),false);
 assert.throws(()=>exportKept(manifest,{'highpool/a':{keep:true,spawns:[null,null]}}),/Place both/);
 const p={x_m:0,y_m:1,z_m:2};
 const csv=exportKept(manifest,{'highpool/a':{keep:true,spawns:[p,p],notes:'hello, "map"',measurements:[123]},'highpool/b':{keep:false,spawns:[p,p]}});
 assert.equal(csv.trim().split('\r\n').length,2);assert.match(csv,/"0.000"/);assert.match(csv,/hello, ""map""/);assert.doesNotMatch(csv,/123|measurements|highpool\/b/);
});

test('review UI loads all candidates, saves spawn/keep edits and excludes measurements', async () => {
 const {JSDOM}=await import('jsdom');const {readFile}=await import('node:fs/promises');
 const dom=new JSDOM('<section id="root"></section>',{url:'https://example.test'});
 const saved={};for(const key of ['document','localStorage','Option','fetch']){saved[key]=globalThis[key];globalThis[key]=dom.window[key];}
 let renderedImage, circles=[];
 const context={clearRect(){circles=[];},drawImage(){},beginPath(){},arc(x,y,r){circles.push({x,y,r});},fill(){},stroke(){},fillText(){},strokeText(){},moveTo(){},lineTo(){},putImageData(image){renderedImage=image;},createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)}}};
 dom.window.HTMLCanvasElement.prototype.getContext=()=>context;
 dom.window.HTMLCanvasElement.prototype.setPointerCapture=()=>{};
 dom.window.HTMLCanvasElement.prototype.getBoundingClientRect=()=>({left:0,top:0,width:804,height:804});
 const source=await readFile(new URL('../src/review-pool.js',import.meta.url),'utf8');
 const module=source.replace("'./review-heatmap.js'",JSON.stringify(new URL('../src/review-heatmap.js',import.meta.url).href)).replace("'./review-pool-state.js'",JSON.stringify(new URL('../src/review-pool-state.js',import.meta.url).href)).replace("import './review-pool.css';",'').replace('import.meta.env.BASE_URL',"'/'");
 const real=JSON.parse(await readFile(new URL('../public/review/highpool/manifest.json',import.meta.url),'utf8'));
 globalThis.fetch=async url=>({ok:true,json:async()=>url.endsWith('manifest.json')?real:{...grid,colour_scale:{min_m:0,max_m:30}}});
 try {
 const {setupReviewPool}=await import('data:text/javascript;base64,'+Buffer.from(module).toString('base64'));
 let destroyed=0, built=[], fail3D=false;
 const load3D=async()=>{if(fail3D)throw new Error('WebGL unavailable');return {createReviewTerrain:(container,g,c,spawns,scale)=>{built.push({g,c,spawns,scale});return {dispose(){destroyed++;},preset(){},exaggeration(){},contours(){}};}};};
 const root=document.getElementById('root');await setupReviewPool(root,{load3D});const el=n=>root.querySelector(`[data-r="${n}"]`);
 assert.equal(el('map').options.length,500);
 const {terrainColor}=await import('../src/review-heatmap.js');
 assert.deepEqual([...renderedImage.data.slice(0,3)],terrainColor(pointAt(grid,.5/402,.5/402).z_m,real.colour_scale));
 el('keep').checked=true;el('keep').dispatchEvent(new dom.window.Event('change'));
 assert.equal(['team1','team2','measure'].filter(name=>el(name).getAttribute('aria-pressed')==='true').length,0);
 el('canvas').onpointerdown({button:0,clientX:100,clientY:100,pointerId:1});
 assert.equal(circles.length,0);
 el('team1').click();
 el('canvas').onpointerdown({button:0,clientX:200,clientY:300,pointerId:1});el('canvas').onpointerup();
 assert.equal(el('team1').getAttribute('aria-pressed'),'false');
 el('team2').click();el('canvas').onpointerdown({button:0,clientX:600,clientY:500,pointerId:1});el('canvas').onpointerup();
 el('measure').click();el('canvas').onpointerdown({button:0,clientX:400,clientY:400,pointerId:1});
 assert.equal(el('measure').getAttribute('aria-pressed'),'false');
 const guideCount=()=>circles.filter(p=>p.r===7).length;
 assert.equal(guideCount(),1);
 const pointer=(x,y)=>({button:0,clientX:x,clientY:y,pointerId:1});
 // A neutral map click does nothing; existing measurement/spawn handles drag.
 el('canvas').onpointerdown(pointer(100,100));
 assert.equal(guideCount(),1);
 el('canvas').onpointerdown(pointer(400,400));
 el('canvas').onpointermove(pointer(450,450));
 el('canvas').onpointerup({...pointer(450,450),type:'pointerup'});
 assert.equal(guideCount(),1);
 assert.ok(circles.some(p=>p.r===7&&Math.abs(p.x-450)<.001&&Math.abs(p.y-450)<.001));
 // Even an armed tool must not add a point when grabbing an existing spawn.
 el('measure').click();el('canvas').onpointerdown(pointer(200,300));
 el('canvas').onpointermove(pointer(250,350));
 el('canvas').onpointerup({...pointer(250,350),type:'pointerup'});
 assert.equal(guideCount(),1);
 assert.equal(el('measure').getAttribute('aria-pressed'),'false');
 assert.ok(circles.some(p=>p.r===15&&Math.abs(p.x-250)<.001&&Math.abs(p.y-350)<.001));
 el('measure').click();el('canvas').onpointerdown(pointer(500,600));
 assert.equal(guideCount(),2);
 el('canvas').onpointerdown(pointer(500,600));el('canvas').onpointermove(pointer(550,650));
 el('canvas').onpointercancel({...pointer(550,650),type:'pointercancel'});
 assert.ok(circles.some(p=>p.r===7&&Math.abs(p.x-500)<.001&&Math.abs(p.y-600)<.001));
 el('team1').click();el('team1').click();
 assert.equal(el('team1').getAttribute('aria-pressed'),'false');
 el('measure').click();root.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape'}));
 assert.equal(el('measure').getAttribute('aria-pressed'),'false');
 const progress=JSON.parse(localStorage.getItem(localStorage.key(0)));const r=progress[real.maps[0].candidate_id];
 assert.equal(r.keep,true);assert.equal(complete(r),true);assert.deepEqual(Object.keys(r).sort(),['keep','notes','spawns']);
 assert.match(el('progress').textContent,/1 kept · 0 kept maps need spawns/);
 el('next').click();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(el('keep').checked,false);
 el('prev').click();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(el('keep').checked,true);assert.match(el('coords').textContent,/Team 2: X/);
 el('view3d').click();await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(built.length,1);assert.equal(built[0].spawns.filter(Boolean).length,2);
 assert.equal(el('heatmap').hidden,true);assert.equal(el('team1').disabled,true);
 assert.equal(built[0].scale,real.colour_scale);
 el('next').click();await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(destroyed,1);assert.equal(built.length,2);assert.equal(built[1].c.candidate_id,real.maps[1].candidate_id);
 assert.deepEqual(built[1].spawns,[null,null]);
 el('view2d').click();assert.equal(destroyed,2);assert.equal(el('team1').disabled,false);
 fail3D=true;el('view3d').click();await new Promise(resolve=>setTimeout(resolve,0));
 assert.match(el('three-status').textContent,/WebGL unavailable/);
 el('view2d').click();assert.equal(el('heatmap').hidden,false);assert.equal(el('team1').disabled,false);
 fail3D=false;el('view3d').click();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(built.length,3);el('view2d').click();
 } finally {for(const key of Object.keys(saved))globalThis[key]=saved[key];dom.window.close();}
});

test('heatmap colours and legend use a fixed pool scale regardless of map relief', async () => {
 const {terrainColor,renderHeatmapFrame}=await import('../src/review-heatmap.js');
 const {JSDOM}=await import('jsdom');
 const {readFile}=await import('node:fs/promises');
 const pool=JSON.parse(await readFile(new URL('../public/review/highpool/manifest.json',import.meta.url),'utf8'));
 const scale=pool.colour_scale, midpoint=(scale.min_m+scale.max_m)/2;
 assert.deepEqual(terrainColor(scale.min_m,scale),[51,51,153]);
 assert.deepEqual(terrainColor(midpoint,scale),[255,255,153]);
 assert.deepEqual(terrainColor(scale.max_m,scale),[255,255,255]);
 const dom=new JSDOM('<svg xmlns="http://www.w3.org/2000/svg"></svg>');const svg=dom.window.document.querySelector('svg');
 renderHeatmapFrame(svg,grid,scale,'First map');
 const ticks=()=>[...svg.querySelectorAll('[data-elevation-tick]')].map(n=>n.textContent);
 const original=ticks();
 renderHeatmapFrame(svg,{...grid,heights:[60,70,80,90],colour_scale:{min_m:60,max_m:90}},scale,'Different relief');
 assert.deepEqual(ticks(),original);
 assert.match(svg.textContent,/Elevation \(m\)/);assert.match(svg.textContent,/X \(m\)/);assert.match(svg.textContent,/Y \(m\)/);
 assert.equal(svg.querySelectorAll('linearGradient stop').length,6);
 dom.window.close();
});


test('3D adapter preserves engine axes, heights, missing spawns and shared colour range', async()=>{
 const {reviewTerrainData}=await import('../src/review-terrain-data.js');
 const {terrainGeometry}=await import('../src/terrain-geometry.js');
 const data=reviewTerrainData(grid,{candidate_id:'highpool/test',terrain_code:'0x0'},[null,{x_m:100,y_m:200,z_m:30}],{min_m:0,max_m:124});
 assert.deepEqual(data.heights_mm,[0,20000,10000,30000]);
 assert.deepEqual(data.xs,[25,647]);assert.deepEqual(data.ys,[25,647]);
 assert.equal(data.spawns.length,1);assert.equal(data.spawns[0].team,1);
 assert.deepEqual([...terrainGeometry(data).positions],[25,25,0,25,647,20,647,25,10,647,647,30]);
 assert.equal(data.min_height_m,0);assert.equal(data.max_height_m,30);assert.equal(data.colour_scale.max_m,124);
 assert.deepEqual(reviewTerrainData(grid,{terrain_code:'0x0'},[null,null],data.colour_scale).spawns,[]);
});

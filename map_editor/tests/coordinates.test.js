const assert = require('node:assert/strict');
const {test} = require('node:test');
const C = require('../web/coordinates.js');
const calibration = {plot_rect:{left:.12,top:.08,width:.7,height:.8}, x_limits:[-111.875,911.875],y_limits:[-161.875,861.875]};
const bounds={x_min_m:0,x_max_m:800,y_min_m:50,y_max_m:650};
test('world/image round trips cover rectangular bounds, corners, and centre',()=>{
  for(const [x,y] of [[0,50],[0,650],[800,50],[800,650],[400,350],[123.456,432.123]]) {
    const {u,v}=C.worldToImage(x,y,calibration);
    assert.deepEqual(C.imageToWorld(u,v,calibration),{x_m:x,y_m:y});
  }
});
test('CSS resizing, page offsets, and zoom preserve world coordinates',()=>{
  for(const width of [320,900,1600,2700]) {
    const p=C.worldToImage(234.567,321.123,calibration), rect={left:-500,top:180,width,height:width};
    const clientX=rect.left+p.u*rect.width,clientY=rect.top+p.v*rect.height;
    assert.deepEqual(C.imageToWorld((clientX-rect.left)/rect.width,(clientY-rect.top)/rect.height,calibration),{x_m:234.567,y_m:321.123});
  }
});
test('browser Y is inverted; margins and labels are outside terrain',()=>{
  const top=C.imageToWorld(.5,.08,calibration), bottom=C.imageToWorld(.5,.88,calibration);
  assert(top.y_m>bottom.y_m);
  for(const [u,v] of [[0,0],[1,1],[.12,.08],[.82,.88]]) {
    const p=C.imageToWorld(u,v,calibration);assert(!C.inside(p.x_m,p.y_m,bounds));
  }
});
const project={source:{scene_id:'scn_a',sco_sha256:'hash'},bounds,assets:[{name:'spr_mm_tree_pine1'}]};
const point={id:'p1',asset:'spr_mm_tree_pine1',x_m:100.123,y_m:200.456,yaw_deg:123,scale:1.4};
const document={version:1,source:project.source,placements:[point]};
test('JSON round trip validates and returns independent objects',()=>{
  const decoded=C.validate(JSON.parse(JSON.stringify(document)),project);
  assert.deepEqual(decoded,[point]);decoded[0].x_m=300;assert.equal(point.x_m,100.123);
  assert.deepEqual(C.validate({...document,source:{sco_sha256:'hash',scene_id:'scn_a'}},project),[point]);
});
test('bad source, duplicates, invalid assets and transforms rejected',()=>{
  assert.throws(()=>C.validate({...document,source:{}},project));
  assert.throws(()=>C.validate({...document,placements:[point,point]},project));
  for(const update of [{x_m:900},{y_m:0},{yaw_deg:360},{scale:0},{scale:11},{asset:'other'},{x_m:NaN},{x_m:1.1234},{z_m:42},{id:'../bad'},{x_m:true}])
    assert.throws(()=>C.validate({...document,placements:[{...point,...update}]},project));
});

test('v2 environment loadouts round trip while legacy files keep source settings',()=>{
  assert.deepEqual(C.validateSettings(document),C.defaults);
  const settings={...C.defaults,biome:'snow_forest',fog:'medium',precipitation:'snow',precipitation_intensity:25,thunder:'lightning',thunder_frequency:100};
  const loadout=JSON.parse(JSON.stringify({...document,version:2,settings}));
  assert.deepEqual(C.validate(loadout,project),[point]);
  assert.deepEqual(C.validateSettings(loadout),settings);
  for(const update of [{biome:'steppe_forest'},{fog:450},{precipitation:'hail'},{precipitation_intensity:true},{precipitation_intensity:0},{precipitation_intensity:26},{thunder:true},{thunder_frequency:101},{thunder_frequency:1.5},{extra:1}])
    assert.throws(()=>C.validate({...loadout,settings:{...settings,...update}},project));
  assert.throws(()=>C.validate({...document,settings},project));
  assert.throws(()=>C.validate({...loadout,settings:{}},project));
});

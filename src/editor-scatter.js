import { lineAssetMix, lineScales } from './editor-line.js';

export const scatterPresets = {
  'Broken woodland': {patchSize:80, coverage:45, density:4, contrast:50, stretch:1.5, direction:0, warp:50, softness:50},
  'Long thickets': {patchSize:60, coverage:35, density:6, contrast:50, stretch:4, direction:30, warp:35, softness:40},
  'Winding bands': {patchSize:70, coverage:40, density:4, contrast:50, stretch:6, direction:0, warp:85, softness:45},
  'Sparse scrub': {patchSize:35, coverage:60, density:1, contrast:50, stretch:1.3, direction:0, warp:50, softness:75},
};
export const scatterDefaults = {...scatterPresets['Broken woodland'], spacing:2, feather:0, avoidExisting:true};
const clamp = n => Math.max(0, Math.min(1, n));
const smooth = n => { const t = clamp(n); return t * t * (3 - 2 * t); };
const quantize = n => Math.round(n * 1000) / 1000;

export function scatterRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hash(x, y, seed) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed;
  h = Math.imul(h ^ h >>> 13, 1274126177);
  return ((h ^ h >>> 16) >>> 0) / 4294967295;
}
function noise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), u = smooth(x - ix), v = smooth(y - iy);
  const a = hash(ix, iy, seed), b = hash(ix + 1, iy, seed), c = hash(ix, iy + 1, seed), d = hash(ix + 1, iy + 1, seed);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}
function layered(x, y, seed) {
  return (noise(x,y,seed) + .4 * noise(x*2,y*2,seed^7919) + .16 * noise(x*4,y*4,seed^104729)) / 1.56;
}
function cross(a, b, c) { return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x); }
function onSegment(p, a, b) {
  return Math.abs(cross(a,b,p)) < 1e-8 && p.x >= Math.min(a.x,b.x)-1e-8 && p.x <= Math.max(a.x,b.x)+1e-8
    && p.y >= Math.min(a.y,b.y)-1e-8 && p.y <= Math.max(a.y,b.y)+1e-8;
}
function intersects(a,b,c,d) {
  return (cross(a,b,c)*cross(a,b,d)<0 && cross(c,d,a)*cross(c,d,b)<0)
    || onSegment(a,c,d) || onSegment(b,c,d) || onSegment(c,a,b) || onSegment(d,a,b);
}
export function insideScatterRegion(x, y, polygon) {
  let inside = false;
  for (let i=0,j=polygon.length-1; i<polygon.length; j=i++) {
    const a=polygon[j], b=polygon[i];
    if (onSegment({x,y},a,b)) return true;
    if ((a.y>y)!==(b.y>y) && x < (b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x) inside=!inside;
  }
  return inside;
}
export function scatterRegion(bounds, polygon = null) {
  const {x_min_m:x0,x_max_m:x1,y_min_m:y0,y_max_m:y1}=bounds;
  if (![x0,x1,y0,y1].every(Number.isFinite) || x1<=x0 || y1<=y0) throw new Error('Invalid map bounds.');
  const nodes = polygon ?? [{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}];
  if (nodes.length<3 || nodes.length>128) throw new Error('Draw a region with 3–128 corners.');
  let area=0;
  for (let i=0;i<nodes.length;i++) {
    const a=nodes[i],b=nodes[(i+1)%nodes.length];
    if (![a.x,a.y].every(Number.isFinite) || a.x<x0 || a.x>x1 || a.y<y0 || a.y>y1) throw new Error('Keep region corners inside the map.');
    if (Math.hypot(a.x-b.x,a.y-b.y)<.001) throw new Error('Region corners must be distinct.');
    const c=nodes[(i+2)%nodes.length];
    if (Math.abs(cross(a,b,c))<1e-8 && (onSegment(c,a,b)||onSegment(a,b,c))) throw new Error('Region edges must not overlap.');
    area+=a.x*b.y-b.x*a.y;
    for(let j=i+2;j<nodes.length;j++) {
      if (i===0 && j===nodes.length-1) continue;
      if (intersects(a,b,nodes[j],nodes[(j+1)%nodes.length])) throw new Error('Region edges must not cross.');
    }
  }
  if (Math.abs(area)<.000002) throw new Error('Region must enclose an area.');
  return nodes.map(p=>({...p}));
}
function edgeDistance(x,y,polygon) {
  let distance=Infinity;
  for(let i=0;i<polygon.length;i++) {
    const a=polygon[i],b=polygon[(i+1)%polygon.length],dx=b.x-a.x,dy=b.y-a.y;
    const t=clamp(((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy));
    distance=Math.min(distance,Math.hypot(x-a.x-t*dx,y-a.y-t*dy));
  }
  return distance;
}
export function createScatterField(bounds, polygon, settings = {}, seed = 1) {
  const s={...scatterDefaults,...settings}, region=scatterRegion(bounds,polygon);
  for (const [key,min,max] of [['patchSize',1,100000],['coverage',0,100],['density',0,1000],['contrast',0,100],['stretch',1,20],['direction',-360,360],['warp',0,100],['softness',0,100],['spacing',0,10000],['feather',0,10000]]) {
    if (!Number.isFinite(s[key]) || s[key]<min || s[key]>max) throw new Error(`${key} must be between ${min} and ${max}.`);
  }
  const angle=s.direction*Math.PI/180,cs=Math.cos(angle),sn=Math.sin(angle);
  const threshold=1-s.coverage/100, soft=s.softness/100*.35;
  // 0: uniform interiors, 50: original gradient, 100: pronounced cores.
  // Remap the same field, without changing its seed, coordinates or boundary.
  const exponent=(2**(s.contrast/25)-1)/3;
  const field=(x,y)=>{
    if (!insideScatterRegion(x,y,region) || s.coverage===0) return 0;
    const rx=(x*cs+y*sn)/s.patchSize/s.stretch, ry=(-x*sn+y*cs)/s.patchSize;
    const bend=s.warp/100*2;
    const u=rx+(noise(rx*.65+17,ry*.65-9,seed^3917)-.5)*bend;
    const v=ry+(noise(rx*.65-31,ry*.65+23,seed^8191)-.5)*bend;
    const value=layered(u,v,seed);
    const envelope=s.coverage===100 ? 1 : soft===0 ? Number(value>=threshold) : smooth((value-threshold)/soft+.5);
    // Coverage and edge softness only mask the pattern. Keep a separate,
    // continuous density gradient inside it, even at 100% coverage or hard edges.
    // Warped, finer noise breaks large patches into uneven concentrations; the
    // broad field still makes their cores denser than their outskirts.
    const detail=layered(u*2.3+37,v*2.3-19,seed^65537);
    const concentration=smooth((value-.2)/.6);
    const gradient=concentration*concentration*(.2+.8*smooth((detail-.25)/.5));
    const intensity=envelope*(s.contrast===0 ? 1 : gradient**exponent);
    return intensity*(s.feather ? smooth(edgeDistance(x,y,region)/s.feather) : 1);
  };
  return {field,region,settings:s};
}

export function generateScatter({bounds,polygon=null,settings={},fieldSeed=1,positionSeed=2,existing=[]}) {
  const {field,region,settings:s}=createScatterField(bounds,polygon,settings,fieldSeed);
  const x0=Math.min(...region.map(p=>p.x)),x1=Math.max(...region.map(p=>p.x));
  const y0=Math.min(...region.map(p=>p.y)),y1=Math.max(...region.map(p=>p.y));
  // Fixed quadrature is deterministic and independent of candidate randomness.
  const resolution=128, cellArea=(x1-x0)*(y1-y0)/(resolution*resolution);
  let integral=0;
  for(let i=0;i<resolution;i++) for(let j=0;j<resolution;j++) integral+=field(x0+(i+.5)*(x1-x0)/resolution,y0+(j+.5)*(y1-y0)/resolution)*cellArea;
  const requested=Math.round(integral*s.density/1000), capacity=Math.max(0,Math.min(1000,10000-existing.length));
  const target=Math.min(requested,capacity), points=[], random=scatterRandom(positionSeed), cells=new Map(), used=new Set();
  const key=(i,j)=>`${i},${j}`;
  function add(p) {
    const k=key(Math.floor(p.x_m/s.spacing),Math.floor(p.y_m/s.spacing));
    if (!cells.has(k)) cells.set(k,[]);
    cells.get(k).push(p);
  }
  function clear(p) {
    if (!s.spacing) return true;
    const i=Math.floor(p.x_m/s.spacing),j=Math.floor(p.y_m/s.spacing);
    for(let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=1;dy++) {
      if ((cells.get(key(i+dx,j+dy))??[]).some(q=>Math.hypot(p.x_m-q.x_m,p.y_m-q.y_m)<s.spacing)) return false;
    }
    return true;
  }
  if (s.spacing && s.avoidExisting) existing.forEach(add);
  const maxAttempts=Math.min(250000,Math.max(10000,target*250));
  for(let attempt=0;attempt<maxAttempts && points.length<target;attempt++) {
    const p={x_m:quantize(x0+random()*(x1-x0)),y_m:quantize(y0+random()*(y1-y0))}, accept=random();
    const k=key(p.x_m,p.y_m);
    if (p.x_m<bounds.x_min_m || p.x_m>bounds.x_max_m || p.y_m<bounds.y_min_m || p.y_m>bounds.y_max_m
      || accept>=field(p.x_m,p.y_m) || used.has(k) || !clear(p)) continue;
    points.push(p);used.add(k); if(s.spacing) add(p);
  }
  return {points,field,region,requested,target,capped:requested>capacity,limited:points.length<target};
}

export function decorateScatter(points, entries, {assetSeed=3,yawSeed=4,scaleSeed=5,randomYaw=true,yaw=0,randomScale=true,low=.8,high=1.2,scale=1}={}) {
  // Validate even an empty preview so invalid controls cannot go unnoticed.
  if (!entries.length) throw new Error('Add at least one asset to the scatter mix.');
  const mix=lineAssetMix(entries,Math.max(1,points.length)).slice(0,points.length), random=scatterRandom(assetSeed);
  for(let i=mix.length-1;i>0;i--) { const j=Math.floor(random()*(i+1)); [mix[i],mix[j]]=[mix[j],mix[i]]; }
  const rotations=scatterRandom(yawSeed), scales=scatterRandom(scaleSeed), byAsset=new Map(entries.map(e=>[e.asset,e.scale]));
  if (!randomYaw && (!Number.isFinite(yaw)||yaw<0||yaw>=360)) throw new Error('Rotation must be between 0 and 360 degrees.');
  if(randomScale) lineScales(low,high,[]); else lineScales(scale,scale,[]);
  for (const e of entries) if(e.scale?.enabled) lineScales(e.scale.low,e.scale.high,[]);
  return points.map((p,i)=>{
    const config=byAsset.get(mix[i]), fraction=scales();
    const size=config?.enabled ? lineScales(config.low,config.high,[fraction])[0]
      : randomScale ? lineScales(low,high,[fraction])[0] : scale;
    const rotation=rotations()*360;
    return {...p,asset:mix[i],yaw_deg:randomYaw ? rotation : yaw,scale:size};
  });
}

/* Pure coordinate/document functions, shared with the Node tests. */
(function(root) {
  'use strict';
  const inside = (x, y, b) => x >= b.x_min_m && x <= b.x_max_m && y >= b.y_min_m && y <= b.y_max_m;
  const quantize = n => Math.round(n * 1000) / 1000;
  function imageToWorld(u, v, c) {
    const r = c.plot_rect;
    return {x_m: quantize(c.x_limits[0] + (u-r.left)/r.width*(c.x_limits[1]-c.x_limits[0])),
            y_m: quantize(c.y_limits[1] - (v-r.top)/r.height*(c.y_limits[1]-c.y_limits[0]))};
  }
  function worldToImage(x, y, c) {
    const r = c.plot_rect;
    return {u:r.left+(x-c.x_limits[0])/(c.x_limits[1]-c.x_limits[0])*r.width,
            v:r.top+(c.y_limits[1]-y)/(c.y_limits[1]-c.y_limits[0])*r.height};
  }
  function stable(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(stable(value[k]))])));
    }
    return JSON.stringify(value);
  }
  const defaults = {biome:'source',fog:'source',precipitation:'source',precipitation_intensity:10,thunder:'source',thunder_frequency:50};
  function validateSettings(document) {
    if(document.version===1) {
      if(Object.hasOwn(document,'settings')) throw new Error('Map settings require loadout version 2.');
      return {...defaults};
    }
    if(![2,3].includes(document.version)) throw new Error('Unsupported map loadout version.');
    const s=document.settings;
    if(!s || Array.isArray(s) || Object.keys(s).sort().join(',')!==Object.keys(defaults).sort().join(',')) throw new Error('Invalid map settings fields.');
    const choices={biome:['source','steppe','plains','snow','desert','plains_forest','snow_forest','desert_forest'],fog:['source','none','low','medium','dense'],precipitation:['source','clear','rain','snow'],thunder:['source','off','thunder','lightning']};
    for(const [key,values] of Object.entries(choices)) if(!values.includes(s[key])) throw new Error('Invalid '+key+'.');
    for(const [key,max] of [['precipitation_intensity',25],['thunder_frequency',100]])
      if(!Number.isInteger(s[key]) || s[key]<1 || s[key]>max) throw new Error(key.replaceAll('_',' ')+' must be an integer from 1 to '+max+'.');
    return {...s};
  }
  function validate(document, project) {
    if (!document || ![1,2,3].includes(document.version) || stable(document.source) !== stable(project.source))
      throw new Error('This placement file belongs to a different map or source version.');
    validateSettings(document);
    validateSpawns(document, project);
    if (!Array.isArray(document.placements) || document.placements.length > 10000)
      throw new Error('Expected up to 10000 placements.');
    const ids = new Set(), assets = new Set(project.assets.map(a=>a.name));
    for (const p of document.placements) {
      if (!p || Object.keys(p).sort().join(',') !== 'asset,id,scale,x_m,y_m,yaw_deg') throw new Error('Invalid placement fields.');
      if (typeof p.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(p.id) || ids.has(p.id)) throw new Error('Invalid or duplicate placement ID.');
      ids.add(p.id);
      if (!assets.has(p.asset)) throw new Error('Unknown map asset.');
      if (![p.x_m,p.y_m,p.yaw_deg,p.scale].every(n=>typeof n === 'number' && Number.isFinite(n))) throw new Error('Invalid placement numbers.');
      if (!inside(p.x_m,p.y_m,project.bounds)) throw new Error('A point lies outside the terrain.');
      if (p.yaw_deg < 0 || p.yaw_deg >= 360 || p.scale < .1 || p.scale > 10) throw new Error('Invalid yaw or scale.');
      if ([p.x_m,p.y_m].some(n=>Math.abs(n*1000-Math.round(n*1000))>1e-6)) throw new Error('Coordinates require millimetre precision.');
    }
    return document.placements.map(p=>({...p}));
  }
  function editableSpawns(project) {
    return (project.default_spawn_points || []).map(p=>({team:p.team,entry:p.entry,x_m:quantize(p.x_m),y_m:quantize(p.y_m)}));
  }
  function validateSpawns(document, project) {
    if(document.version!==3) {
      if(Object.hasOwn(document,'spawn_points') || Object.hasOwn(document,'default_spawn_points')) throw new Error('Spawn edits require loadout version 3.');
      return editableSpawns(project);
    }
    if(!project.default_spawn_points || stable(document.default_spawn_points)!==stable(project.default_spawn_points)) throw new Error('Original spawn defaults differ from this project.');
    const points=document.spawn_points;
    if(!Array.isArray(points) || points.length!==2) throw new Error('Expected exactly two team spawn points.');
    for(const [team,p] of points.entries()) {
      if(!p || Object.keys(p).sort().join(',')!=='entry,team,x_m,y_m' || p.team!==team || p.entry!==team*32) throw new Error('Expected Team 1 / Entry 0 and Team 2 / Entry 32.');
      if(![p.x_m,p.y_m].every(n=>typeof n==='number' && Number.isFinite(n))) throw new Error('Invalid spawn coordinates.');
      if(!inside(p.x_m,p.y_m,project.bounds)) throw new Error('Spawn lies outside the terrain.');
      if([p.x_m,p.y_m].some(n=>Math.abs(n*1000-Math.round(n*1000))>1e-6)) throw new Error('Spawn coordinates require millimetre precision.');
    }
    if(points[0].x_m===points[1].x_m && points[0].y_m===points[1].y_m) throw new Error('Team spawns must have different positions.');
    return points.map(p=>({...p}));
  }
  const api = {editableSpawns, validateSpawns,inside, quantize, imageToWorld, worldToImage, validate, validateSettings, defaults};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MapCoordinates = api;
})(globalThis);

import {terrainStops} from './review-heatmap.js';

export function reviewTerrainData(grid, candidate, spawns, scale) {
  const n=grid.grid_size, b=grid.bounds, inset=grid.inset_m;
  const axis=(low,high)=>Array.from({length:n},(_,i)=>low+inset+i*(high-low-2*inset)/(n-1));
  // Review grids are row-major; the existing 3D viewer expects X-major samples.
  const heights=Array.from({length:n*n},(_,i)=>Math.round(grid.heights[(i%n)*n+Math.floor(i/n)]*1000));
  const low=Math.min(...grid.heights), high=Math.max(...grid.heights);
  return {
    id:candidate.candidate_id, bounds:b, grid_size:n,
    xs:axis(b.x_min_m,b.x_max_m), ys:axis(b.y_min_m,b.y_max_m),
    heights_mm:heights, height_order:'x-major, y-minor', vertical_scale:1,
    min_height_m:low, max_height_m:high, relief_m:high-low,
    source:{terrain_code:candidate.terrain_code},
    spawns:spawns.flatMap((p,team)=>p?[{...p,team}]:[]),
    colour_scale:scale, elevation_stops:terrainStops,
  };
}

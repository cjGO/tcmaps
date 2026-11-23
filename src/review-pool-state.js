export const columns = 'pool_id,candidate_id,scene_name,sco_file,recipe_file,heatmap_file,height_data_file,sco_sha256,recipe_sha256,decision,team1_x_m,team1_y_m,team1_z_m,team2_x_m,team2_y_m,team2_z_m,notes'.split(',');
export function pointAt(grid, u, v) {
  const b = grid.bounds, n = grid.grid_size, inset = grid.inset_m;
  const x = b.x_min_m + u * (b.x_max_m-b.x_min_m), y = b.y_max_m-v*(b.y_max_m-b.y_min_m);
  const gx = Math.max(0,Math.min(n-1,(x-b.x_min_m-inset)/(b.x_max_m-b.x_min_m-2*inset)*(n-1)));
  const gy = Math.max(0,Math.min(n-1,(y-b.y_min_m-inset)/(b.y_max_m-b.y_min_m-2*inset)*(n-1)));
  const ix=Math.min(n-2,Math.floor(gx)), iy=Math.min(n-2,Math.floor(gy)), dx=gx-ix,dy=gy-iy;
  const h=(a,b)=>grid.heights[b*n+a];
  return {x_m:x,y_m:y,z_m:(1-dy)*((1-dx)*h(ix,iy)+dx*h(ix+1,iy))+dy*((1-dx)*h(ix,iy+1)+dx*h(ix+1,iy+1))};
}
export function complete(record) { return [0,1].every(t=>['x_m','y_m','z_m'].every(k=>Number.isFinite(record?.spawns?.[t]?.[k]))); }
export function exportKept(manifest, records) {
  const rows = [columns];
  for (const m of manifest.maps) {
    const r=records[m.candidate_id]; if (!r?.keep) continue;
    const coords = [0,1].flatMap(team => ['x_m','y_m','z_m'].map(axis => {
      const value = r.spawns?.[team]?.[axis];
      return Number.isFinite(value) ? value.toFixed(3) : '';
    }));
    rows.push([manifest.pool_id,m.candidate_id,m.name,m.sco_file,m.recipe_file,m.heatmap_file,m.height_data_file,m.sco_sha256,m.recipe_sha256,'keep',...coords,r.notes||'']);
  }
  return rows.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n';
}

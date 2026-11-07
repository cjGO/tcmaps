// Resolve catalogue meshes to the game's native records, matching core.native_flora_assets.
export function resolveNativeAssets(assets, floraText) {
  const lines=floraText.trimEnd().split(/\r?\n/), meshes=new Map();
  const integer=value=>{
    if (!/^\d+$/.test(value)) throw new Error('Invalid native flora definition');
    return Number(value);
  };
  let cursor=1;
  const count=integer(lines[0]);
  for(let id=0;id<count;id++) {
    const fields=lines[cursor++]?.trim().split(/\s+/);
    if (fields?.length!==3) throw new Error('Invalid flora definition');
    const [name,flagsText,countText]=fields, flags=integer(flagsText), variants=integer(countText);
    for(let variant=0;variant<variants;variant++) {
      const pair=lines[cursor++]?.trim().split(/\s+/);
      if(pair?.length!==2) throw new Error('Invalid flora mesh');
      const [mesh,collision]=pair;
      if(!meshes.has(mesh)) meshes.set(mesh,[]);
      meshes.get(mesh).push({object_kind:4,object_id:id,object_name:name,variant,flora_flags:flags,collision:collision!=='0'});
      if(flags & 0x400000) {
        if(lines[cursor++]?.trim().split(/\s+/).length!==2) throw new Error('Invalid alternate tree');
      }
    }
    if(flags & 0x4000000) {
      if(lines[cursor++]?.trim().split(/\s+/).length!==2) throw new Error('Invalid flora colony');
    }
  }
  if(cursor!==lines.length) throw new Error('Trailing flora definitions');
  return assets.map(asset=>{
    if(asset.kind==='scene_prop') return {...asset,object_kind:0,object_id:asset.prop_id,variant:0};
    if(asset.kind && asset.kind!=='flora') throw new Error('Unsupported asset kind');
    const native=meshes.get(asset.mesh)?.find(row=>row.collision===asset.collision);
    if(!native) throw new Error('No native flora for '+asset.name);
    return {...asset,...native};
  });
}

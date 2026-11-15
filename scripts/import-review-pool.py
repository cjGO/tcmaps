"""Import verified manual review assets; compact engine grids for browser use."""
import hashlib,json,pathlib,sys,zipfile
archive=zipfile.ZipFile(sys.argv[1])
root=pathlib.Path('public/review/highpool')
manifest=json.loads(archive.read('manifest.json'))
assert manifest['review_schema']=='manual-spawns-v1'
for entry in manifest['maps']:
    for field,checksum in [('sco_file','sco_sha256'),('recipe_file','recipe_sha256'),('heatmap_file','heatmap_sha256'),('height_data_file','height_data_sha256')]:
        data=archive.read(entry[field])
        assert hashlib.sha256(data).hexdigest()==entry[checksum],entry[field]
        if field=='height_data_file':
            grid=json.loads(data); n=grid['grid_size']; heights=[None]*(n*n)
            for s in grid['samples']: heights[s['iy']*n+s['ix']]=s['height_m']
            assert all(isinstance(h,(int,float)) for h in heights)
            compact={k:grid[k] for k in ['bounds','grid_size','inset_m','colour_scale']}
            compact['heights']=heights
            entry['grid_file']='grids/'+entry['name']+'.json'
            target=root/entry['grid_file'];target.parent.mkdir(parents=True,exist_ok=True)
            target.write_text(json.dumps(compact,separators=(',',':')))
        else:
            target=root/entry[field];target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
(root/'manifest.json').write_text(json.dumps(manifest,separators=(',',':')))
print('Verified and imported',len(manifest['maps']),'candidates')

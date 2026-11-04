"""Export native map asset meshes/textures for the website's 3D map editor.

Run in WSL with uv --with matplotlib --with numpy --with pillow.
Reads module.ini resources in game load order. Geometry keeps its original origin, Z-up axes
and metre units; no thumbnail fitting, rotation, recentering or root correction.
This only publishes web assets. It never changes scenes or starts the engine.
"""
import argparse
import json
from pathlib import Path
import re
import shutil
import sys

# Reuse the installed native BRF reader and source verification helpers.
bootstrap = argparse.ArgumentParser(add_help=False)
bootstrap.add_argument("--module-root", type=Path, required=True)
module_args, _ = bootstrap.parse_known_args()
sys.path.insert(0, str(module_args.module_root.resolve() / "pythonHelpers"))

import numpy as np
from PIL import Image

from export_rotation_topology import MODULE, digest, write_json
from export_rotation_spawns import load_editor
from game_scene_resources import load_resources, texture_paths, material_rendering


def verified_rows(website):
    """Use the website rotation; the installed server may have rotated since publication."""
    editor = load_editor(website)
    rows = json.loads((website / "lib/editor-rotation.json").read_text())
    for row in rows:
        project, _, _, _ = editor.load_project(website / row["project"])
        if project["source"] != row["source"]:
            raise ValueError("Prepared source differs from website rotation")
    return editor, rows


def encode_mesh(parts):
    """Little-endian vertices (position3, normal3, uv2, colour4), then uint32 faces."""
    payload = bytearray()
    records = []
    for part in parts:
        vertices = np.column_stack((part['positions'], part['normals'], part['uv'], part['colors'])).astype('<f4')
        indices = part['faces'].astype('<u4').ravel()
        if not len(vertices) or not len(indices) or len(indices) % 3 or not np.isfinite(vertices).all():
            raise ValueError('Invalid geometry: ' + part['name'])
        if indices.max() >= len(vertices):
            raise ValueError('Invalid indices: ' + part['name'])
        offset = len(payload)
        payload.extend(vertices.tobytes())
        index_offset = len(payload)
        payload.extend(indices.tobytes())
        records.append(dict(name=part['name'], material=part['material'], vertex_count=len(vertices),
                            vertex_offset=offset, index_count=len(indices), index_offset=index_offset))
    positions = np.concatenate([p['positions'] for p in parts])
    bounds = dict(min=positions.min(axis=0).tolist(), max=positions.max(axis=0).tolist())
    return bytes(payload), records, bounds


def export(website, output, map_id, publish):
    editor, rows = verified_rows(website)
    row = next((r for r in rows if r['id'] == map_id), None)
    if row is None:
        raise ValueError('Map is not in the registered fixed rotation')
    for registered in rows:
        editor.upgrade_assets(argparse.Namespace(project=website / registered['project']))
    project, _, _, _ = editor.load_project(website / row['project'])
    meshes, materials, inputs = load_resources(MODULE, {a['mesh'] for a in project['assets']})
    textures = texture_paths(MODULE)
    output.mkdir(parents=True, exist_ok=False)
    assets_dir = output / 'assets'
    (assets_dir / 'meshes').mkdir(parents=True)
    (assets_dir / 'textures').mkdir()
    texture_cache, published_meshes, published_materials = {}, {}, {}
    preview_fallbacks = {}
    names = sorted({a['mesh'] for a in project['assets']})
    print(f'Exporting {len(names)} native meshes', flush=True)
    for number, mesh_name in enumerate(names, 1):
        parts = [m for name, m in meshes.items()
                 if name == mesh_name or re.fullmatch(re.escape(mesh_name) + r'\.\d+', name)]
        parts = [p for p in parts if len(p['positions']) and len(p['faces'])]
        if not parts:
            preview_fallbacks[mesh_name] = 'No renderable native mesh; editor marker only'
            continue
        for part in parts:
            name = part['material']
            if name in published_materials:
                continue
            material = materials.get(name, dict(diffuse='', flags=0))
            filename = material['diffuse']
            if not Path(filename).suffix:
                filename += '.dds'
            texture_path = textures.get(filename.lower())
            if texture_path not in texture_cache:
                if texture_path is None:
                    image = Image.new('RGBA', (2, 2), (200, 200, 200, 255))
                else:
                    inputs[texture_path] = digest(texture_path)
                    with Image.open(texture_path) as source:
                        image = source.convert('RGBA')
                        image.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
                temporary = assets_dir / 'textures' / 'encoding.webp'
                image.save(temporary, quality=90, method=6, exact=True)
                sha = digest(temporary)
                target = temporary.with_name(sha[:24] + '.webp')
                temporary.replace(target)
                texture_cache[texture_path] = dict(file='textures/' + target.name, sha256=sha,
                                                   bytes=target.stat().st_size, size=list(image.size))
            published_materials[name] = dict(texture=texture_cache[texture_path]['file'],
                                             **material_rendering(material['flags']))
            if texture_path is None:
                published_materials[name]['preview_fallback'] = 'Native material or diffuse texture unavailable; neutral editor material'
        payload, records, bounds = encode_mesh(parts)
        target = assets_dir / 'meshes' / (mesh_name + '.bin')
        target.write_bytes(payload)
        published_meshes[mesh_name] = dict(file='meshes/' + target.name, sha256=digest(target),
                                         bytes=len(payload), bounds_m=bounds, parts=records)
        if number % 100 == 0 or number == len(names):
            print(f'Exported {number}/{len(names)} meshes; {len(texture_cache)} textures', flush=True)
    manifest = dict(schema_version=1, units='metres', up_axis='Z', vertex_stride=12,
                    assets={a['name']: dict(mesh=a['mesh'], ground_offset_m=a['ground_offset_m']) for a in project['assets']},
                    meshes=published_meshes, materials=published_materials, preview_fallbacks=preview_fallbacks,
                    textures={t['file']: t for t in texture_cache.values()})
    target = assets_dir / 'manifest.json'
    write_json(target, manifest)
    sha = digest(target)
    prefix = f'editor-models/{sha[:20]}'
    index = dict(schema_version=1, maps=[dict(id=r['id'], source=r['source'], map_id=r.get('map_id'), variant_id=r.get('variant_id'), variant_revision=r.get('variant_revision', '')) for r in rows], selection_mode='all-fixed',
                 manifest_url='/' + prefix + '/manifest.json', manifest_sha256=sha,
                 asset_count=len(manifest['assets']), mesh_count=len(published_meshes), texture_count=len(texture_cache))
    # Refuse publication if the source or any resources changed while exporting.
    editor.load_project(website / row['project'])
    _, current = verified_rows(website)
    if current != rows or any(digest(p) != h for p, h in inputs.items()):
        raise ValueError('Source inputs changed during export')
    write_json(output / 'index.json', index)
    write_json(output / 'provenance.json', dict(project=row, exporter_sha256=digest(__file__),
        brf_reader_sha256=digest(MODULE / 'pythonHelpers/game_scene_resources.py'),
        inputs={str(p): h for p, h in inputs.items()}))
    if publish:
        destination = website / 'public' / prefix
        destination.mkdir(parents=True, exist_ok=True)
        for source in assets_dir.rglob('*'):
            if not source.is_file():
                continue
            target = destination / source.relative_to(assets_dir)
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists() and digest(target) != digest(source):
                raise ValueError('Versioned asset differs: ' + str(target))
            if not target.exists():
                shutil.copyfile(source, target)
            if digest(source) != digest(target):
                raise ValueError('Published asset checksum differs')
        target = website / 'lib/editor-models.json'
        if target.exists():
            shutil.copyfile(target, output / 'previous-editor-models.json')
        temporary = target.with_suffix('.json.tmp')
        temporary.write_text(json.dumps(index, indent=2) + '\n')
        temporary.replace(target)
    print(f"COMPLETE: {len(manifest['assets'])} assets, {len(published_meshes)} meshes, "
          f"{len(texture_cache)} textures; {sum(p.stat().st_size for p in assets_dir.rglob('*') if p.is_file()):,} bytes", flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--module-root', type=Path, required=True)
    parser.add_argument('--website-root', type=Path, default=Path('/home/glect/rate_maps'))
    parser.add_argument('--output', type=Path, required=True, help='Fresh output directory')
    parser.add_argument('--map-id', default='scn_mp_custom_map_1')
    parser.add_argument('--publish', action='store_true')
    args = parser.parse_args()
    export(args.website_root.resolve(), args.output.resolve(), args.map_id, args.publish)

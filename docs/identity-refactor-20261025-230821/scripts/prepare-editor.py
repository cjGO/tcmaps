#!/usr/bin/env python3
"""Sync editor projects from the installed, registered custom-map rotation."""
import argparse
import json
from pathlib import Path
import re
import shutil
import sys
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]


def registered_maps(module, source_identity, checksum):
    pools = json.loads((module / 'custom_maps/population_rotation.json').read_text())['pools']
    installed = json.loads((module / 'custom_maps/installed_random_maps.json').read_text())
    scenes = (module / 'scenes.txt').read_text(encoding='ascii').splitlines()
    recipes = {}
    for i, line in enumerate(scenes):
        if line.startswith('scn_mp_custom_map_'):
            scene_id = line.split()[0]
            if scene_id in recipes:
                raise ValueError('Duplicate registered scene: ' + scene_id)
            recipes[scene_id] = '\n'.join(scenes[i:i + 4]) + '\n'
    result = []
    seen = set()
    for pool, slots in pools.items():
        for slot in slots:
            # Micro maps generate fresh terrain each round and have no fixed map to edit.
            if not re.fullmatch(r'mp_custom_map_\d+', slot):
                if pool == 'micro':
                    continue
                raise ValueError('Unsupported registered map: ' + slot)
            if slot in seen:
                raise ValueError('Duplicate rotation slot: ' + slot)
            seen.add(slot)
            record = installed[slot]
            sco = (module / 'custom_maps' / record['source']).resolve()
            if not sco.is_relative_to((module / 'custom_maps').resolve()):
                raise ValueError('Source outside custom_maps: ' + slot)
            source, recipe = source_identity(sco, sco.with_suffix('.txt'))
            scene_id = 'scn_' + slot
            if source['scene_id'] != scene_id or source['sco_sha256'] != record['sha256']:
                raise ValueError('Installed registry/source mismatch: ' + slot)
            if checksum(module / 'SceneObj' / (scene_id + '.sco')) != source['sco_sha256']:
                raise ValueError('Installed scene differs from registered source: ' + slot)
            if recipes.get(scene_id, '').split() != recipe.split():
                raise ValueError('Installed scene recipe differs from registered source: ' + slot)
            if record.get('terrain_code') != source['terrain_code']:
                raise ValueError('Registered terrain code differs: ' + slot)
            image = sco.with_suffix('.png')
            version = source['sco_sha256'][:16] + '-' + source['recipe_sha256'][:16]
            result.append(dict(id=scene_id, filename=scene_id + '.png', pool=pool,
                               imageSha256=checksum(image), source=source,
                               project=f'map_editor/projects/current_rotation/{scene_id}/{version}'))
    if not result:
        raise ValueError('No registered custom maps in the current rotation')
    return sorted(result, key=lambda row: int(row['id'].rsplit('_', 1)[1]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--module-root', type=Path, required=True)
    parser.add_argument('--check', action='store_true', help='Verify installed registration without writing or probing')
    args = parser.parse_args()
    module = args.module_root.resolve()
    sys.path[:0] = [str(ROOT / 'map_editor'), str(module / 'pythonHelpers')]
    import helpers
    helpers.MODULE_ROOT = module
    import editor
    from core import source_identity, write_json, verify_source
    from helpers import checksum, run_engine_probe, parse_samples, parse_spawns

    maps = registered_maps(module, source_identity, checksum)
    print(f'Verified {len(maps)} registered rotation maps.', flush=True)
    if args.check:
        return
    pending = []
    for row in maps:
        destination = ROOT / row['project']
        source = row['source']
        if (destination / 'project.json').exists():
            project = editor.load_project(destination)[0]
            if project['source'] != source:
                raise ValueError('Prepared source changed: ' + row['id'])
            write_json(destination / 'project.json', project)
            print('Already prepared: ' + row['id'], flush=True)
            continue
        if destination.exists():
            raise ValueError('Incomplete project exists; inspect before retrying: ' + str(destination))
        pending.append(row)
    if pending:
        logs = ROOT / 'map_editor/projects/current_rotation' / ('probe-' + editor.timestamp())
        rows = [dict(name=row['id'], sco=row['source']['sco_path'],
                     recipe=verify_source(row['source'])) for row in pending]
        results = run_engine_probe(rows, logs, grid_size=201, timeout=180)
        for row in pending:
            if not results.get(row['id'], {}).get('ok'):
                raise ValueError('Probe failed: ' + row['id'])
            source = row['source']
            folder = logs / row['id']
            bounds, samples = parse_samples(folder / 'samples.csv', 201)
            data = dict(schema_version=1, map=row['id'], grid_size=201,
                        sample_count=len(samples), bounds=bounds, samples=samples,
                        terrain_code=source['terrain_code'], spawn_points=parse_spawns(folder / 'spawn_points.csv'),
                        source_sco_sha256=source['sco_sha256'], source_recipe_sha256=source['recipe_sha256'])
            height_data = folder / 'height_data.json'
            write_json(height_data, data)
            verify_source(source)
            destination = ROOT / row['project']
            destination.parent.mkdir(parents=True, exist_ok=True)
            editor.prepare(SimpleNamespace(sco=Path(source['sco_path']), recipe=Path(source['recipe_path']),
                           height_data=height_data, output=destination, timeout=180,
                           windows_python=Path('/mnt/c/Python27/python.exe')))
    # Recheck live registration after measurement, before publishing the snapshot.
    if registered_maps(module, source_identity, checksum) != maps:
        raise ValueError('Registered rotation changed during preparation; rerun sync')
    images = ROOT / 'current_rotation'
    images.mkdir(exist_ok=True)
    for row in maps:
        preview = ROOT / row['project'] / 'heatmap.png'
        shutil.copyfile(preview, images / row['filename'])
        row['imageSha256'] = checksum(preview)
    for image in images.iterdir():
        if image.suffix.lower() == '.png' and image.name not in {row['filename'] for row in maps}:
            image.unlink()
    batches = {Path(row['source']['sco_path']).parent for row in maps}
    if len(batches) == 1:
        names = next(iter(batches)) / 'MAP_NAMES.md'
        if names.exists():
            shutil.copyfile(names, ROOT / 'MAP_NAMES.md')
    write_json(ROOT / 'lib/editor-rotation.json', maps)
    print('Synced registered rotation. Run npm run prepare:editor to publish website assets.', flush=True)


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Prepare GOODMAPS using the original module's isolated terrain probe."""
import argparse
from pathlib import Path
import sys
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--module-root', type=Path, required=True)
args = parser.parse_args()
module = args.module_root.resolve()
# Use this repository's editor with the installed module's renderer and assets.
sys.path.insert(0, str(module / 'pythonHelpers'))
sys.path.insert(0, str(ROOT / 'map_editor'))
import helpers
helpers.MODULE_ROOT = module
import editor
from core import source_identity, write_json, verify_source
from helpers import run_engine_probe, parse_samples, parse_spawns

source_dir = module / 'custom_maps/random_maps/good_maps'
projects = ROOT / 'map_editor/projects/goodmaps'
projects.mkdir(parents=True, exist_ok=True)
pending = []
for image in sorted((ROOT / 'goodmaps').glob('*.png')):
    if image.read_bytes() != (source_dir / image.name).read_bytes():
        raise ValueError('GOODMAPS image differs from original: ' + image.name)
    source, recipe = source_identity(source_dir / (image.stem + '.sco'), source_dir / (image.stem + '.txt'))
    destination = projects / image.stem
    if (destination / 'project.json').exists():
        project = editor.load_project(destination)[0]
        if project['source'] != source:
            raise ValueError('Prepared source changed: ' + image.stem)
        print('Already prepared: ' + image.stem, flush=True)
        continue
    if destination.exists():
        raise ValueError('Incomplete project exists; inspect before retrying: ' + str(destination))
    pending.append((image, source, recipe, destination))
if pending:
    logs = projects / ('probe-' + editor.timestamp())
    rows = [dict(name=s['scene_id'], sco=s['sco_path'], recipe=r) for _, s, r, _ in pending]
    results = run_engine_probe(rows, logs, grid_size=201, timeout=180)
    for image, source, recipe, destination in pending:
        if not results.get(source['scene_id'], {}).get('ok'):
            raise ValueError('Probe failed: ' + source['scene_id'])
        folder = logs / source['scene_id']
        bounds, samples = parse_samples(folder / 'samples.csv', 201)
        data = dict(schema_version=1, map=source['scene_id'], grid_size=201,
                    sample_count=len(samples), bounds=bounds, samples=samples,
                    terrain_code=source['terrain_code'], spawn_points=parse_spawns(folder / 'spawn_points.csv'),
                    source_sco_sha256=source['sco_sha256'], source_recipe_sha256=source['recipe_sha256'])
        height_data = folder / 'height_data.json'
        write_json(height_data, data)
        verify_source(source)
        editor.prepare(SimpleNamespace(sco=Path(source['sco_path']), recipe=Path(source['recipe_path']),
                       height_data=height_data, output=destination, timeout=180,
                       windows_python=Path('/mnt/c/Python27/python.exe')))
print('Prepared all GOODMAPS. Run npm run prepare:editor to publish website assets.', flush=True)

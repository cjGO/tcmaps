#!/usr/bin/env python3
"""Prepare a standalone vegetation editor and build grounded SCO copies."""
import argparse
from datetime import datetime, timezone
from pathlib import Path
import shutil
import subprocess
import sys

from core import (append_vegetation, asset_catalogue, native_flora_assets, digest, placement_document,
                  read_json, source_identity, validate_height_data, validate_placements,
                  verify_height_provenance, verify_source, write_json)
from engine import probe, replay_objects, verify_replay
from environment import DEFAULTS, apply_environment, validate_settings
from helpers import EDITOR_ROOT, MODULE_ROOT, checksum, parse_spawns, read_entries
from rendering import calibrated_heatmap, editor_html


def timestamp():
    return datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S-%f')


def new_directory(path):
    path = Path(path).resolve()
    path.mkdir(parents=True, exist_ok=False)
    return path


def copy_checked(source, destination, expected):
    shutil.copyfile(source, destination)
    if checksum(destination) != expected:
        raise ValueError('Source changed while copying: ' + str(source))


def prepare(args):
    source, recipe = source_identity(args.sco, args.recipe)
    assets = asset_catalogue(MODULE_ROOT / 'scene_props.txt')
    data = read_json(args.height_data) if args.height_data else None
    provenance = verify_height_provenance(args.height_data, data, source, recipe) if data else 'engine measurements'
    folder = new_directory(args.output or EDITOR_ROOT / 'projects' / (source['scene_id'] + '-' + timestamp()))
    print('Project: ' + str(folder), flush=True)
    inputs = folder / 'inputs'
    inputs.mkdir()
    copy_checked(source['sco_path'], inputs / 'source.sco', source['sco_sha256'])
    (inputs / 'source.txt').write_text(recipe, encoding='ascii')
    if data is None:
        bounds, samples, _, logs = probe(source, recipe, folder / 'prepare_probe', 201,
                                         args.timeout, args.windows_python)
        data = dict(schema_version=1, map=source['scene_id'], grid_size=201,
                    sample_count=len(samples), bounds=bounds, samples=samples,
                    terrain_code=source['terrain_code'], spawn_points=parse_spawns(logs / 'spawn_points.csv'),
                    source_sco_sha256=source['sco_sha256'], source_recipe_sha256=source['recipe_sha256'])
    if recipe.split()[2] == '256':
        entries = [e for e in read_entries((inputs / 'source.sco').read_bytes()) if e['entry'] in (0, 32)]
        if len(entries) != 2 or {e['entry'] for e in entries} != {0, 32}:
            raise ValueError('Selected explicit-spawn scene must contain entries 0 and 32 exactly once')
        data['spawn_points'] = [dict(team=e['entry']//32, **e) for e in entries]
    data['map'] = source['scene_id']
    data['heatmap_reference_span_m'] = data.get('heatmap_reference_span_m') or 975
    validate_height_data(data)
    write_json(folder / 'height_data.json', data)
    calibration = calibrated_heatmap(data, folder / 'heatmap.png')
    verify_source(source)
    project = dict(version=1, source=source, bounds=data['bounds'], calibration=calibration,
                   assets=assets, asset_catalogue_sha256=checksum(MODULE_ROOT / 'scene_props.txt'),
                   flora_catalogue_sha256=checksum(MODULE_ROOT / 'Data/flora_kinds.txt'),
                   height_data_sha256=checksum(folder / 'height_data.json'),
                   height_provenance=provenance, ground_offsets='uncalibrated; zero metres')
    (folder / 'editor.html').write_text(editor_html(project, folder / 'heatmap.png'), encoding='utf-8')
    write_json(folder / 'placements.json', placement_document(source, settings=DEFAULTS))
    # Written last: incomplete preparation never produces a buildable project.
    write_json(folder / 'project.json', project)
    print('READY: open ' + str(folder / 'editor.html'))
    return folder


def load_project(folder):
    project = read_json(folder / 'project.json')
    if project.get('version') != 1:
        raise ValueError('Unsupported project version')
    recipe = verify_source(project['source'])
    if (checksum(folder / 'inputs/source.sco') != project['source']['sco_sha256']
            or digest((folder / 'inputs/source.txt').read_bytes()) != project['source']['recipe_sha256']):
        raise ValueError('Prepared source snapshot changed')
    if checksum(folder / 'height_data.json') != project['height_data_sha256']:
        raise ValueError('Prepared terrain measurements changed')
    if checksum(MODULE_ROOT / 'scene_props.txt') != project['asset_catalogue_sha256']:
        raise ValueError('Module vegetation definitions changed; prepare a new project')
    if (project.get('flora_catalogue_sha256') is not None
            and checksum(MODULE_ROOT / 'Data/flora_kinds.txt') != project['flora_catalogue_sha256']):
        raise ValueError('Module flora definitions changed; prepare a new project')
    data = read_json(folder / 'height_data.json')
    validate_height_data(data)
    if data['bounds'] != project['bounds'] or data['terrain_code'] != project['source']['terrain_code']:
        raise ValueError('Project terrain metadata mismatch')
    assets = asset_catalogue(MODULE_ROOT / 'scene_props.txt')
    if project['assets'] != assets:
        raise ValueError('Project asset definitions changed')
    return project, recipe, data, assets


def build(args):
    folder = args.project.resolve()
    project, recipe, data, assets = load_project(folder)
    document = read_json(args.placements)
    placements = validate_placements(document, project['source'], data['bounds'], assets)
    settings = validate_settings(document)
    flora_sha256 = checksum(MODULE_ROOT / 'Data/flora_kinds.txt')
    assets = native_flora_assets(assets, MODULE_ROOT / 'Data/flora_kinds.txt')
    output = new_directory(args.output or folder / 'builds' / timestamp())
    print('Build: ' + str(output), flush=True)
    # Stage outputs until all checks pass; retain failed probe evidence for diagnosis.
    stage = output / '_staging'
    stage.mkdir()
    source = (folder / 'inputs/source.sco').read_bytes()
    base, recipe, weather = apply_environment(source, recipe, settings, MODULE_ROOT / 'scene_props.txt')
    terrain_code = recipe.splitlines()[0].split()[10]
    biome_changed = terrain_code != project['source']['terrain_code']
    probe_source = dict(project['source'], terrain_code=terrain_code)
    # Save a private probe input; the successful export only contains final files.
    probe_input = output / 'environment_source.sco'
    probe_input.write_bytes(base)
    probe_source['sco_path'] = str(probe_input)
    grid_size = data['grid_size'] if biome_changed else 2
    bounds, samples, heights, ground_logs = probe(probe_source, recipe, output / 'ground_probe', grid_size,
                                                args.timeout, args.windows_python, placements)
    if biome_changed:
        if bounds != data['bounds']:
            raise ValueError('Biome change altered map bounds')
        data = dict(data, terrain_code=terrain_code, bounds=bounds, samples=samples,
                    source_sco_sha256=digest(base), source_recipe_sha256=digest(recipe.encode('ascii')))
        if recipe.split()[2] == '1280':
            data['spawn_points'] = parse_spawns(ground_logs / 'spawn_points.csv')
        validate_height_data(data)
    else:
        verify_replay(data, bounds, samples)
    edited = append_vegetation(base, placements, heights, assets)
    name = project['source']['scene_id']
    sco = stage / (name + '.sco')
    sco.write_bytes(edited)
    (stage / (name + '.txt')).write_text(recipe, encoding='ascii')
    # Load the edited SCO through the isolated engine, verifying terrain and spawns.
    replay_source = dict(project['source'], sco_path=str(sco))
    replay_bounds, replay_samples, replay_logs = replay_objects(
        replay_source, recipe, output / 'edited_probe', args.timeout, args.windows_python, placements, heights, assets, weather=weather)
    verify_replay(data, replay_bounds, replay_samples)
    expected_spawns = sorted(data.get('spawn_points', []), key=lambda p: p['team'])
    actual_spawns = parse_spawns(replay_logs / 'spawn_points.csv')
    if len(expected_spawns) != 2 or any(
            abs(expected[k] - actual[k]) > 0.002
            for expected, actual in zip(expected_spawns, actual_spawns) for k in ('x_m', 'y_m', 'z_m')):
        raise ValueError('Edited scene changed engine spawn positions')
    verify_source(project['source'])
    if checksum(MODULE_ROOT / 'Data/flora_kinds.txt') != flora_sha256:
        raise ValueError('Flora definitions changed during build')
    write_json(stage / 'placements.json', placement_document(project['source'], placements, settings))
    write_json(stage / 'height_data.json', dict(data, source_sco_sha256=digest(edited),
                                               source_recipe_sha256=digest(recipe.encode('ascii'))))
    calibrated_heatmap(data, stage / 'preview.png', placements)
    write_json(stage / 'manifest.json', dict(
        version=1, source=project['source'], placement_count=len(placements),
        settings=settings, output_terrain_code=terrain_code, output_outer_terrain=recipe.splitlines()[3].strip(),
        weather_overrides=weather, terrain_remeasured=biome_changed,
        vegetation_encoding='native_flora_v1', flora_catalogue_sha256=flora_sha256,
        resolved_assets=[a for a in assets if a['name'] in {p['asset'] for p in placements}],
        placements=[dict(p, ground_z_m=z, z_m=z + next(a['ground_offset_m'] for a in assets if a['name'] == p['asset'])*p['scale'])
                    for p, z in zip(placements, heights)],
        files={p.name: checksum(p) for p in stage.iterdir() if p.is_file()},
        validation=dict(binary_preservation='passed', exact_ground_heights='passed',
                        engine_load_and_terrain='passed', engine_spawns='passed', engine_weather_overrides='passed', engine_object_transforms='passed',
                        visual_grounding='not checked', distant_rendering='not checked', collision_and_pathfinding='not checked'),
        asset_catalogue_sha256=project['asset_catalogue_sha256'], height_data_sha256=project['height_data_sha256'],
        ground_offsets=project['ground_offsets']))
    for path in stage.iterdir():
        if path.name != 'manifest.json':
            path.rename(output / path.name)
    (stage / 'manifest.json').rename(output / 'manifest.json')
    stage.rmdir()
    probe_input.unlink()
    print('COMPLETE: ' + str(output))
    return output


def refresh(args):
    folder = args.project.resolve()
    project, _, _, _ = load_project(folder)
    (folder / 'editor.html').write_text(editor_html(project, folder / 'heatmap.png'), encoding='utf-8')
    print('REFRESHED: ' + str(folder / 'editor.html'))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    prep = commands.add_parser('prepare', help='Create a standalone editor for one scene')
    prep.add_argument('--sco', required=True, type=Path)
    prep.add_argument('--recipe', required=True, type=Path, help='Matching TXT or scenes.txt')
    prep.add_argument('--height-data', type=Path, help='Optional verified height_data.json')
    prep.set_defaults(action=prepare)
    builder = commands.add_parser('build', help='Measure ground heights and export a new scene copy')
    builder.add_argument('--project', required=True, type=Path)
    builder.add_argument('--placements', required=True, type=Path)
    builder.set_defaults(action=build)
    refresh_parser = commands.add_parser('refresh', help='Update browser UI without changing saved placements')
    refresh_parser.add_argument('--project', required=True, type=Path)
    refresh_parser.set_defaults(action=refresh, timeout=180)
    for command in (prep, builder):
        command.add_argument('--output', type=Path, help='New directory; never overwrite an existing one')
        command.add_argument('--timeout', type=int, default=180, help='Per-map engine timeout in seconds')
        command.add_argument('--windows-python', type=Path, default=Path('/mnt/c/Python27/python.exe'))
    args = parser.parse_args(argv)
    if args.timeout <= 0:
        parser.error('--timeout must be positive')
    try:
        args.action(args)
        return 0
    except KeyboardInterrupt:
        print('Cancelled; source maps are unchanged.', file=sys.stderr)
        return 130
    except (ValueError, OSError, KeyError, TypeError, IndexError, ImportError, subprocess.SubprocessError) as exc:
        print('ERROR: ' + str(exc), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())

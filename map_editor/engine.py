"""Exact ground measurements through the established isolated Windows worker."""
import json
import subprocess

from helpers import EDITOR_ROOT, MODULE_ROOT, parse_samples, run_engine_probe
from plot_saved_map_heights import windows_path


def probe(source, recipe, logs, grid_size, timeout, windows_python, placements=()):
    points = [dict(index=i, x_fixed=round(p['x_m']*1000), y_fixed=round(p['y_m']*1000))
              for i, p in enumerate(placements)]
    row = dict(name=source['scene_id'], sco=source['sco_path'], recipe=recipe, extra_points=points)
    results = run_engine_probe([row], logs, grid_size=grid_size, timeout=timeout,
                               windows_python=windows_python)
    if not results.get(source['scene_id'], {}).get('ok'):
        raise ValueError('Engine probe failed: ' + str(results.get(source['scene_id'])))
    folder = logs / source['scene_id']
    bounds, samples = parse_samples(folder / 'samples.csv', grid_size)
    heights = []
    if points:
        lines = (folder / 'extra_heights.csv').read_text().splitlines()
        if len(lines) != len(points):
            raise ValueError('Engine did not return every placement height')
        for point, line in zip(points, lines):
            index, x, y, z = map(int, line.split(','))
            if (index, x, y) != (point['index'], point['x_fixed'], point['y_fixed']):
                raise ValueError('Engine measured different placement coordinates')
            heights.append(z / 1000)
    return bounds, samples, heights, folder


def verify_replay(data, bounds, samples):
    n = data['grid_size']
    corners = [data['samples'][i]['height_m'] for i in (0, n-1, (n-1)*n, n*n-1)]
    if bounds != data['bounds'] or [s['height_m'] for s in samples] != corners:
        raise ValueError('Terrain replay differs from the prepared heatmap')


def replay_objects(source, recipe, logs, timeout, windows_python, placements, heights, assets, weather=()):
    """Use the same private worker with an additional object-validation callback."""
    logs.mkdir(parents=True, exist_ok=False)
    by_name = {a['name']: a for a in assets}
    expected = []
    for i, (p, z) in enumerate(zip(placements, heights)):
        a = by_name[p['asset']]
        expected.append('{index=%d, prop=%d, kind=%d, variant=%d, x=%d, y=%d, z=%d, scale=%d, yaw=%.9f}' % (
            i, a['object_id'], a['object_kind'], a['variant'], round(p['x_m']*1000), round(p['y_m']*1000),
            round((z+a['ground_offset_m']*p['scale'])*1000), round(p['scale']*1000), p['yaw_deg']))
    lua_source = logs / 'replay.lua'
    base = (MODULE_ROOT / 'pythonHelpers/height_probe.lua').read_text()
    validation = (EDITOR_ROOT / 'replay.lua').read_text().replace('-- EXPECTED_OBJECTS', ',\n'.join(expected))
    validation = validation.replace('-- EXPECTED_WEATHER', ',\n'.join(
        '{prop=%d, first=%d, second=%d}' % (w['prop'], w['first'], w['second']) for w in weather))
    lua_source.write_text(base + '\n' + validation)
    request_path, result_path, cancel_path = logs / 'request.json', logs / 'results.json', logs / 'cancel'
    request = dict(module=windows_path(MODULE_ROOT), lua_source=windows_path(lua_source),
                   grid_size=2, timeout=timeout, logs=windows_path(logs), result=windows_path(result_path),
                   cancel=windows_path(cancel_path), maps=[dict(name=source['scene_id'],
                   sco=windows_path(source['sco_path']), recipe=recipe)])
    request_path.write_text(json.dumps(request, indent=2))
    worker = subprocess.Popen([str(windows_python), windows_path(MODULE_ROOT / 'pythonHelpers/_height_probe_windows.py'),
                               windows_path(request_path)])
    try:
        returncode = worker.wait()
    except KeyboardInterrupt:
        cancel_path.write_text('cancel\n')
        worker.wait()
        raise
    if returncode:
        raise subprocess.CalledProcessError(returncode, worker.args)
    results = json.loads(result_path.read_text())
    if len(results) != 1 or not results[0].get('ok'):
        raise ValueError('Edited object replay failed: ' + str(results))
    folder = logs / source['scene_id']
    report = (folder / 'extra_heights.csv').read_text().splitlines()
    if len(report) != len(placements):
        raise ValueError('Missing loaded object verification')
    for i, line in enumerate(report):
        if int(line.split(',')[0]) != i:
            raise ValueError('Invalid loaded object verification order')
    bounds, samples = parse_samples(folder / 'samples.csv', 2)
    return bounds, samples, folder

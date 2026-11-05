#!/usr/bin/env python3
"""Publish verified installed terrain with permanent map/loadout asset names."""
import argparse
import json
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--module-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    sys.path.insert(0, str(args.module_root.resolve() / 'pythonHelpers'))
    from export_rotation_topology import export, digest, write_json
    output = args.output.resolve()
    export(ROOT, output, all_maps=True)
    manifest = json.loads((output / 'manifest.json').read_text())
    rotation = {r['id']: r for r in json.loads((ROOT / 'lib/editor-rotation.json').read_text())}
    for row in manifest['maps']:
        registered = rotation[row['id']]
        row['map_name'] = registered['map_name']
        row['variant_revision'] = registered['variant_revision']
        name = row['map_name']
        row['url'] = f"/topology/{name}/{row['sha256'][:20]}/{name}.json"
        source = output / 'assets' / (row['id'] + '.json')
        target = ROOT / 'public' / row['url'].lstrip('/')
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and digest(target) != row['sha256']:
            raise ValueError('Published terrain differs: ' + str(target))
        shutil.copyfile(source, target)
        if digest(target) != row['sha256']:
            raise ValueError('Terrain checksum differs: ' + str(target))
    shutil.copyfile(ROOT / 'lib/rotation-topology.json', output / 'previous-rotation-topology.json')
    archive_path = ROOT / 'lib/replay-topology.json'
    archived = json.loads(archive_path.read_text()) if archive_path.exists() else dict(schema_version=1, maps=[])
    previous = json.loads((ROOT / 'lib/rotation-topology.json').read_text())
    archived['maps'] = list({row['sha256']: row for row in [*archived['maps'], *previous['maps']]}.values())
    archived['map_count'] = len(archived['maps'])
    write_json(archive_path, archived)
    write_json(output / 'manifest.json', manifest)
    write_json(ROOT / 'lib/rotation-topology.json', manifest)


if __name__ == '__main__':
    main()

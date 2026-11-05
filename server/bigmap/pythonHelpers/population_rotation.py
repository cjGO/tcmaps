"""Prepare a combined small/medium rotation; ingestion uses the existing installer."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import shutil
import random
import secrets

import weatherize_selected_rotation as weather
from map_catalog import Catalog, encoded, dimensions, removal_index, excluded, check_record
from population_rotation_data import validate_manifest, lua_data, MICRO_GENERATORS, pool_names


def read(path):
    return json.loads(path.read_text())


def write(path, value):
    path.write_bytes(encoded(value))


def heatmap_copies(folder, rows):
    """Rating convenience copies retain source-PNG checksums, not new measurements."""
    target = folder / 'heatmap'
    target.mkdir(exist_ok=True)
    for row in rows:
        if 'png_sha256' not in row:
            continue
        source = (folder / row['file']).with_suffix('.png')
        dest = target / source.name
        if dest.exists() and weather.digest(dest) != row['png_sha256']:
            raise ValueError('Existing heatmap copy differs: ' + str(dest))
        if not dest.exists():
            shutil.copy2(source, dest)
        if weather.digest(dest) != row['png_sha256']:
            raise ValueError('Heatmap checksum differs: ' + str(dest))


def prepare(root, output=None, seed=None, runtime_dir=None):
    root = root.resolve()
    installed = read(root / 'custom_maps/installed_random_maps.json')
    existing = root / 'custom_maps/population_rotation.json'
    medium_order = (read(existing)['pools']['medium'] if existing.exists() else weather.rotation(root))
    if not medium_order or any(installed[s]['size'] != 'medium' for s in medium_order):
        raise ValueError('Expected an installed all-medium queue')
    parents = {(root / 'custom_maps' / installed[s]['source']).parent for s in medium_order}
    if len(parents) != 1:
        raise ValueError('Medium maps must come from one saved batch')
    source_batch = parents.pop()
    if read(source_batch / 'context.json').get('schema_version') == 6:
        source_batch = source_batch / 'medium'
    medium_rows = read(source_batch / 'manifest.json')
    if [r['slot'] for r in medium_rows] != medium_order:
        raise ValueError('Installed medium order differs from saved batch')
    weather.validate_batch(root, source_batch, medium_rows)
    for row in medium_rows:
        if (weather.digest(root / 'SceneObj' / row['file']) != row['sha256'] or
                installed[row['slot']]['sha256'] != row['sha256']):
            raise ValueError('Installed medium map changed: ' + row['slot'])
    catalog = Catalog(root)
    records = catalog.small_pool_records()
    medium_fingerprints = {catalog.fingerprint(root / 'custom_maps' / r['source']) for r in medium_rows}
    if any(r['layout_fingerprint'] in medium_fingerprints for r in records):
        raise ValueError('A small layout duplicates an active medium map')
    if len(records) + len(medium_rows) > 100:
        raise ValueError('Combined pools exceed 100 custom slots')
    # Reuse verified small assignments on later preparations; never take a medium slot.
    preferred = {v.get('catalogue_id'): s for s, v in installed.items() if v.get('pool') == 'small'}
    used = set(medium_order)
    assignments = {}
    for r in records:
        slot = preferred.get(r['catalogue_id'])
        if slot and slot not in used:
            assignments[slot] = dict(catalogue_id=r['catalogue_id'], source=r['files']['sco']['path'], size='small')
            used.add(slot)
    free = iter('mp_custom_map_%d' % n for n in range(1, 101) if 'mp_custom_map_%d' % n not in used)
    assigned = {r['catalogue_id'] for r in assignments.values()}
    for r in records:
        if r['catalogue_id'] not in assigned:
            assignments[next(free)] = dict(catalogue_id=r['catalogue_id'], source=r['files']['sco']['path'], size='small')
    if output is None:
        output = root / 'custom_maps/random_maps' / ('population_rotation_' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
    output = output.resolve()
    if output.exists() or output.parent != root / 'custom_maps/random_maps':
        raise ValueError('Use a new direct random_maps batch folder')
    catalog.save()
    output.mkdir()
    weather.prepare(root, output / 'small', seed=seed,
                    selected_catalogue=(assignments, encoded(dict(schema_version=1, maps=records))))
    shutil.copytree(source_batch, output / 'medium', ignore=shutil.ignore_patterns('installation.json', 'validation.txt'))
    small_rows = read(output / 'small/manifest.json')
    rows = small_rows + medium_rows
    for row in rows:
        target = output / row['file']
        for ext in ('.sco', '.txt', '.png'):
            source = (output / row['size'] / row['file']).with_suffix(ext)
            if source.exists():
                shutil.copy2(source, target.with_suffix(ext))
        current = root / 'SceneObj' / row['file']
        row['installed_sha256'] = weather.digest(current) if current.exists() else None
    pools = dict(schema_version=1, small_max_players=22,
                 pools=dict(small=[r['slot'] for r in small_rows], medium=medium_order))
    order = validate_manifest(pools)
    context = read(output / 'small/context.json')
    context.update(schema_version=6, selection_mode='population_small_medium_v1',
                   spacing_policy='population_pools_v1', target_count=len(rows), prepared_rotation=order,
                   child_manifest_sha256={name: weather.digest(output / name / 'manifest.json') for name in ('small', 'medium')},
                   runtime_files={})
    context['variant_family_additions'] = additions
    context.pop('catalogue_snapshot_sha256', None)
    if runtime_dir:
        for name in ('scripts.txt', 'mission_templates.txt', 'quick_strings.txt', 'variables.txt',
                     'lua/ID_scripts.py', 'lua/ID_mission_templates.py'):
            source = runtime_dir / name
            dest = output / 'runtime' / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, dest)
            context['runtime_files'][name] = weather.digest(dest)
            context['before'][name] = weather.digest(root / name)
    for name in ('custom_maps/population_rotation.json', 'lua/population_rotation_data.lua'):
        source = root / name
        context['before'][name] = weather.digest(source) if source.exists() else None
    write(output / 'context.json', context)
    write(output / 'manifest.json', rows)
    write(output / 'population_rotation.json', pools)
    write(output / 'assignments.json', dict(read(output / 'small/assignments.json'), **read(output / 'medium/assignments.json')))
    (output / 'rotation_order.txt').write_text(''.join(s + '\n' for s in order))
    (output / 'Config.txt').write_bytes(weather.candidate_config(root, order))
    if variants:
        description += ' Every fourth map uses the global tiny/small/medium variant queue, regardless of population; other automatic maps skip variants.'
    (output / 'MAP_NAMES.md').write_text('# Population-aware rotation\n\n0–22 connected humans: small. 23+: medium. Separate queues; changes only at map boundaries.\n\n'
        'Medium maps retain their saved weather and order. PNGs depict source terrain, not remeasured variants.\n\n'
        '| Pool | Position | Slot | Identity | Biome | Weather | Source |\n|---|---|---|---|---|---|---|\n' + ''.join(
        '| %s | %s | %s | %s | %s | %s | %s |\n' % (r['size'], r['index'], r['slot'], r.get('name', r.get('public_id', r['catalogue_id'])), r['biome'], weather.describe(r), r['source']) for r in rows))
    heatmap_copies(output / 'small', small_rows)
    heatmap_copies(output, rows)
    validate_combined(root, output, rows)
    print('Prepared combined batch:', output)
    return output


def add_tiny_maps(root, assignments, records, count, seed):
    """Random direct tiny-pool candidates, excluding shared removals and layouts."""
    if not 1 <= count <= 100 or len(assignments) + count > 100:
        raise ValueError('Tiny count must fit within 100 combined slots')
    catalog = Catalog(root)
    removals = removal_index(root)
    seen = {r['layout_fingerprint'] for r in records}
    candidates = []
    for path in sorted((catalog.base / 'tiny_pool').glob('*.sco')):
        if path.stem in removals[0]:
            continue
        fp = catalog.fingerprint(path)
        known = next((r for r in catalog.data['maps'] if r['layout_fingerprint'] == fp), None)
        if fp in removals[1] or fp in seen or (known and excluded(known, removals)):
            continue
        if dimensions(path) != dict(size_x=600, size_y=600):
            raise ValueError('Tiny candidate must be encoded 600 x 600: ' + str(path))
        fields = weather.read_records(str(path.with_suffix('.txt')))[0][0]
        if int(fields[2]) != 256:
            raise ValueError('Tiny candidate must preserve explicit spawns: ' + str(path))
        candidates.append(path)
        seen.add(fp)
    if len(candidates) < count:
        raise ValueError('Not enough eligible unique tiny maps: %d available, %d requested' % (len(candidates), count))
    chosen = sorted(random.Random(seed).sample(candidates, count))
    free = iter('mp_custom_map_%d' % n for n in range(1, 101) if 'mp_custom_map_%d' % n not in assignments)
    selected = []
    for path in chosen:
        record = catalog.register(path, 'tiny', matches=[catalog.relative(path)])
        check_record(root, record)
        record = dict(record, files=catalog.files(path))
        records.append(record)
        assignments[next(free)] = dict(catalogue_id=record['catalogue_id'], source=catalog.relative(path), size='tiny')
        selected.append(catalog.relative(path))
    return catalog, selected, len(candidates)


def refresh(root, source_batch, output=None, seed=None, tiny_count=0, micro=False):
    """Refresh only surviving top-level assets; child archives cannot restore deletions."""
    root, source_batch = root.resolve(), source_batch.resolve()
    if read(source_batch / 'context.json').get('schema_version') != 6:
        raise ValueError('Expected a combined population batch')
    saved_population = read(source_batch / 'population_rotation.json')
    micro = micro or saved_population.get('schema_version') in (3, 4)
    standby_medium = micro and saved_population.get('installed_only_pools') == ['medium']
    assignments, snapshot = weather.batch_sources(root, source_batch)
    records = json.loads(snapshot)['maps']
    # A full variant refresh also includes eligible library families that have
    # not yet appeared in the installed roster. Never recover from child archives.
    from map_library import discover
    catalog = Catalog(root)
    removals = removal_index(root)
    present = {a['catalogue_id'] for a in assignments.values()}
    additions = []
    for record in catalog.data['maps']:
        if (record['catalogue_id'] in present or record['size'] not in ('tiny', 'small', 'medium')
                or 'library' not in record or excluded(record, removals)):
            continue
        if not discover(catalog, record):
            continue
        check_record(root, record)
        free = next((('mp_custom_map_%d' % n) for n in range(1, 101)
                     if ('mp_custom_map_%d' % n) not in assignments), None)
        if free is None:
            raise ValueError('Variant-bearing families exceed custom slot capacity')
        assignments[free] = dict(catalogue_id=record['catalogue_id'],
                                source=record['files']['sco']['path'], size=record['size'])
        records.append(record)
        present.add(record['catalogue_id'])
        additions.append(record.get('public_id', record['catalogue_id']))
        if record['size'] == 'medium' and micro:
            standby_medium = True
    if additions:
        catalog.save()
        print('Added variant-bearing library families:', ', '.join(additions), flush=True)
    if micro and not standby_medium:
        assignments = {s:a for s,a in assignments.items() if a['size'] != 'medium'}
        identities = {a['catalogue_id'] for a in assignments.values()}
        records = [r for r in records if r['catalogue_id'] in identities]
    sizes = {a['size'] for a in assignments.values()}
    allowed_sizes = (({'tiny', 'small', 'medium'},) if standby_medium else
                     ({'small'}, {'tiny', 'small'}) if micro else
                     ({'small', 'medium'}, {'tiny', 'small', 'medium'}))
    if sizes not in allowed_sizes:
        raise ValueError('Survivors must contain every required saved-map pool')
    if tiny_count and 'tiny' in sizes:
        raise ValueError('Tiny top-up requires a small/medium source batch')
    seed = secrets.randbits(64) if seed is None else seed
    if output is None:
        output = root / 'custom_maps/random_maps' / ('population_rotation_' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
    output = output.resolve()
    if output.exists() or output.parent != root / 'custom_maps/random_maps':
        raise ValueError('Use a new direct random_maps batch folder')
    tiny_sources, eligible_tiny_count = [], 0
    if tiny_count:
        catalog, tiny_sources, eligible_tiny_count = add_tiny_maps(root, assignments, records, tiny_count, seed)
        catalog.save()
    names = ('tiny', 'small', 'medium') if tiny_count or 'tiny' in sizes else ('small', 'medium')
    if micro and not standby_medium:
        names = tuple(n for n in names if n != 'medium')
    rows = []
    for size in names:
        selected = {s:a for s,a in assignments.items() if a['size'] == size}
        identities = {a['catalogue_id'] for a in selected.values()}
        weather.prepare(root, output / size, seed=seed, selected_catalogue=(selected,
            encoded(dict(schema_version=1, maps=[r for r in records if r['catalogue_id'] in identities]))))
        child_context = read(output / size / 'context.json')
        child_context.update(selection_mode='catalogue_tiny_pool_v1' if size == 'tiny' and tiny_count else 'catalogue_source_batch_v1',
                             source_batch=source_batch.relative_to(root / 'custom_maps').as_posix(), source_size=size)
        write(output / size / 'context.json', child_context)
        child_rows = read(output / size / 'manifest.json')
        heatmap_copies(output / size, child_rows)
        rows.extend(child_rows)
    for row in rows:
        for ext in ('.sco', '.txt', '.png'):
            source = (output / row['size'] / row['file']).with_suffix(ext)
            if source.exists():
                shutil.copy2(source, (output / row['file']).with_suffix(ext))
    pools = dict(schema_version=1, small_max_players=22,
                 pools={size:[r['slot'] for r in rows if r['size'] == size] for size in names})
    if 'tiny' in names:
        pools.update(schema_version=2, tiny_max_players=14, small_max_players=24)
    if micro:
        if 'tiny' not in names: raise ValueError('Micro requires tiny and small survivors')
        pools.update(schema_version=4, micro_max_players=5, tiny_max_players=20)
        if saved_population.get('schema_version') == 4:
            pools['micro_max_players'] = saved_population['micro_max_players']
        if standby_medium:
            pools['installed_only_pools'] = ['medium']
        pools.pop('small_max_players', None)
        pools['pools']['micro'] = list(MICRO_GENERATORS)
    variants = [r['slot'] for r in rows if r.get('library', {}).get('variant') not in (None, 'source')]
    if variants:
        pools.update(variant_every=4, variant_pool=variants)
    order = validate_manifest(pools)
    context = read(output / 'small/context.json')
    context.update(schema_version=6, selection_mode='population_source_batch_with_tiny_v1' if tiny_count else 'population_source_batch_v1',
                   spacing_policy='population_pools_v1', target_count=len(rows), prepared_rotation=order,
                   child_manifest_sha256={size:weather.digest(output / size / 'manifest.json') for size in names},
                   runtime_files={})
    if tiny_count:
        context.update(tiny_selection_seed=seed, tiny_selected_sources=tiny_sources,
                       tiny_requested_count=tiny_count, tiny_eligible_count=eligible_tiny_count)
    context.pop('catalogue_snapshot_sha256', None)
    context.pop('source_size', None)
    for name in ('custom_maps/population_rotation.json', 'lua/population_rotation_data.lua'):
        path = root / name
        context['before'][name] = weather.digest(path) if path.exists() else None
    if 'tiny' in names:
        name = 'lua/population_rotation.lua'
        path = root / name
        if path.exists():
            target = output / 'runtime' / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)
            context['runtime_files'][name] = weather.digest(target)
            context['before'][name] = weather.digest(path)
    for name, value in [('context.json', context), ('manifest.json', rows),
                        ('population_rotation.json', pools), ('assignments.json', assignments)]:
        write(output / name, value)
    (output / 'rotation_order.txt').write_text(''.join(s + '\n' for s in order))
    (output / 'Config.txt').write_bytes(weather.candidate_config(root, order))
    description = ('0-14 humans: tiny; 15-24: small; 25+: medium.' if 'tiny' in names else '0-22 humans: small; 23+: medium.')
    if micro:
        cutoff = pools['micro_max_players']
        description = ('0-%d humans: micro (fresh plains/snow/desert forest, 500 x 500, hill 10-20, ruggedness 0-15); %d-20: tiny; 21+: small. Native generators use no custom slots.' % (cutoff, cutoff + 1))
        if standby_medium:
            description += ' Medium remains available for /bigmap and the scheduled variant queue, with its own refreshed assets.'
    (output / 'MAP_NAMES.md').write_text('# Population-aware rotation\n\n' + description + ' Each queue freshly shuffled and weatherized.\n'
        'Surviving direct source-batch maps are retained; tiny additions are randomly selected from direct tiny_pool pairs. PNGs show source terrain, not remeasured variants.\n\n'
        '| Pool | Position | Slot | Identity | Biome | Weather | Source |\n|---|---|---|---|---|---|---|\n' + ''.join(
        '| %s | %s | %s | %s | %s | %s | %s |\n' % (r['size'], r['index'], r['slot'], r.get('name', r.get('public_id', r['catalogue_id'])), r['biome'], weather.describe(r), r['source']) for r in rows))
    heatmap_copies(output, rows)
    validate_combined(root, output, rows)
    print('Prepared refreshed combined batch:', output)
    return output


def validate_combined(root, folder, rows):
    context = read(folder / 'context.json')
    pools = read(folder / 'population_rotation.json')
    order = validate_manifest(pools, context['prepared_rotation'])
    fixed_order = [s for s in order if s not in pools['pools'].get('micro', [])]
    if [r['slot'] for r in rows] != fixed_order or context['target_count'] != len(rows):
        raise ValueError('Combined manifest membership/order changed')
    if pools.get('variant_every') and pools['variant_pool'] != [r['slot'] for r in rows if r.get('library', {}).get('variant') not in (None, 'source')]:
        raise ValueError('Scheduled variants differ from saved loadouts')
    expected = []
    assignments = {}
    names = tuple(n for n in pool_names(pools, include_installed_only=True) if n != 'micro')
    if set(context['child_manifest_sha256']) != set(names):
        raise ValueError('Combined child pool membership differs')
    for name in names:
        child = folder / name
        if weather.digest(child / 'manifest.json') != context['child_manifest_sha256'][name]:
            raise ValueError('Saved child manifest changed: ' + name)
        child_rows = read(child / 'manifest.json')
        if [r['slot'] for r in child_rows] != pools['pools'][name] or any(r['size'] != name for r in child_rows):
            raise ValueError('Pool size/order mismatch')
        weather.validate_batch(root, child, child_rows)
        if context.get('selection_mode') == 'population_source_batch_with_tiny_v1' and name == 'tiny':
            sources = sorted(r['source'] for r in child_rows)
            if sources != context['tiny_selected_sources'] or len(sources) != context['tiny_requested_count']:
                raise ValueError('Tiny selection differs from saved random sample')
            if any(Path(s).parent != Path('random_maps/tiny_pool') or dimensions(root / 'custom_maps' / s) != dict(size_x=600, size_y=600) for s in sources):
                raise ValueError('Tiny source outside direct 600 x 600 tiny_pool')
        elif context.get('selection_mode') in ('population_source_batch_v1', 'population_source_batch_with_tiny_v1'):
            # Library children validate their frozen roster and construction inputs.
            # Later removal of a parent batch file must not rewrite a prepared batch.
            if read(child / 'context.json').get('schema_version') != 7:
                expected_assignments, _ = weather.batch_sources(root, root / 'custom_maps' / context['source_batch'], name, use_library=False)
                if read(child / 'assignments.json') != expected_assignments:
                    raise ValueError('Refreshed pool differs from source survivors')
        elif name == 'small' and any(Path(r['source']).parent != Path('random_maps/small_pool') for r in child_rows):
            raise ValueError('Small source outside direct small_pool')
        assignments.update(read(child / 'assignments.json'))
        expected.extend(child_rows)
    if read(folder / 'assignments.json') != assignments:
        raise ValueError('Combined assignments changed')
    if (folder / 'rotation_order.txt').read_text().splitlines() != order:
        raise ValueError('Combined order changed')
    identities, layouts = set(), set()
    catalog = Catalog(root)
    for actual, saved in zip(rows, expected):
        if {k:v for k,v in actual.items() if k != 'installed_sha256'} != {k:v for k,v in saved.items() if k != 'installed_sha256'}:
            raise ValueError('Combined row differs from saved pool')
        fp = actual['library']['family_fingerprint'] if 'library' in actual else catalog.fingerprint(root / 'custom_maps' / actual['source'])
        if actual['catalogue_id'] in identities or fp in layouts:
            raise ValueError('Duplicate combined identity/layout')
        identities.add(actual['catalogue_id']); layouts.add(fp)
        for ext in ('.sco', '.txt', '.png'):
            saved_path = (folder / actual['size'] / actual['file']).with_suffix(ext)
            if saved_path.exists() and weather.digest(saved_path) != weather.digest((folder / actual['file']).with_suffix(ext)):
                raise ValueError('Combined asset differs: ' + actual['slot'])
    for row in rows:
        if 'png_sha256' in row and weather.digest((folder / 'heatmap' / row['file']).with_suffix('.png')) != row['png_sha256']:
            raise ValueError('Combined heatmap checksum differs')
    for name, sha in context['runtime_files'].items():
        if name not in ('scripts.txt', 'mission_templates.txt', 'quick_strings.txt', 'variables.txt', 'lua/ID_scripts.py', 'lua/ID_mission_templates.py', 'lua/population_rotation.lua'):
            raise ValueError('Unexpected runtime artifact')
        if weather.digest(folder / 'runtime' / name) != sha:
            raise ValueError('Runtime artifact changed: ' + name)


def runtime_writes(root, folder):
    data = read(folder / 'population_rotation.json')
    ids = {f[0][4:]: i for i, (f, _) in enumerate(weather.read_records(str(root / 'scenes.txt'), True))}
    context = read(folder / 'context.json')
    writes = {root / name: (folder / 'runtime' / name).read_bytes() for name in context['runtime_files']}
    # The registration patch was computed from installed scripts. Apply it to the
    # staged runtime too, retaining all new selector scripts and variable IDs.
    if root / 'scripts.txt' in writes:
        import tempfile
        with tempfile.TemporaryDirectory() as temp:
            temp_root = Path(temp)
            (temp_root / 'lua').mkdir()
            for name in ('scenes.txt', 'lua/module_scripts.py'):
                shutil.copy2(root / name, temp_root / name)
            (temp_root / 'scripts.txt').write_bytes(writes[root / 'scripts.txt'])
            writes[root / 'scripts.txt'] = weather.registration_writes(temp_root, validate_manifest(data))[temp_root / 'scripts.txt']
    writes[root / 'custom_maps/population_rotation.json'] = encoded(data)
    writes[root / 'lua/population_rotation_data.lua'] = lua_data(data, ids)
    return writes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=weather.ROOT)
    parser.add_argument('--prepare', type=Path)
    parser.add_argument('--seed', type=int)
    parser.add_argument('--runtime-dir', type=Path)
    parser.add_argument('--source-batch', type=Path)
    parser.add_argument('--micro', action='store_true', help='Enable three fresh native micro generators: 0-5 micro, 6-20 tiny, 21+ small')
    parser.add_argument('--tiny-count', type=int, default=0, help='Random tiny_pool additions to a source-batch refresh')
    args = parser.parse_args()
    if args.source_batch:
        if args.runtime_dir:
            parser.error('--source-batch uses the installed runtime')
        refresh(args.root, args.source_batch, args.prepare, args.seed, args.tiny_count, args.micro)
    else:
        if args.tiny_count or args.micro:
            parser.error('--tiny-count requires --source-batch')
        prepare(args.root, args.prepare, args.seed, args.runtime_dir)


if __name__ == '__main__':
    main()

"""Check MOD/Config.txt against installed scenes and supplied custom maps.

Compatible with the server's Python 2.7. This is a read-only preflight;
engine terrain regeneration and client synchronization require in-game testing.
"""
from __future__ import print_function

import hashlib
import argparse
import json
import os
import re
import sys

from random_map_settings import saved_biome_cycle, LEGACY_MICRO_GENERATORS, LEGACY_SAVED_BIOME_CYCLE, MICRO_GENERATORS, GENERATORS, OUTER_TERRAINS, validate_terrain, SAVED_BIOME_CYCLE, DESERT_BIOMES, DESERT_WEATHER_POLICY
from random_map_settings import rotation_records, validate_spacing
from sync_compiled_scenes import read_source_definitions, compiled_header


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read_records(path, compiled=False):
    with open(path, "r") as handle:
        lines = handle.read().splitlines()
    if compiled:
        if len(lines) < 2 or lines[0] != "scenesfile version 1":
            raise ValueError("Invalid scenes file header: " + path)
        declared = int(lines[1])
        lines = lines[2:]
    else:
        declared = None
    lines = [line for line in lines if line.strip()]
    if len(lines) % 4:
        raise ValueError("Truncated scene record: " + path)
    records = []
    for index in range(0, len(lines), 4):
        fields = lines[index].split()
        if len(fields) != 11 or not fields[0].startswith("scn_"):
            raise ValueError("Invalid scene record: " + lines[index])
        records.append((fields, lines[index + 1:index + 4]))
    if declared is not None and declared != len(records):
        raise ValueError("Scene count mismatch: %d declared, %d found" %
                         (declared, len(records)))
    return records


def digest(path):
    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).digest()


def verify_custom_registration(config_text, entries, records):
    """NW exposes custom slots through set_num_custom_maps, not a new map list."""
    count = 0
    for line in config_text.splitlines():
        fields = line.split('#', 1)[0].split()
        if fields and fields[0] == 'set_num_custom_maps':
            if len(fields) != 2 or not 0 <= int(fields[1]) <= 100:
                raise ValueError('Invalid set_num_custom_maps command')
            count = int(fields[1])
    scene_ids = dict((fields[0][4:], i) for i, (fields, tail) in enumerate(records))
    with open(os.path.join(ROOT, 'strings.txt'), 'rb') as handle:
        strings = [line.split()[0][4:] for line in handle.read().decode('latin-1').splitlines()[2:]
                   if line.strip()]
    for scene in entries:
        if not scene.startswith('mp_custom_map_'):
            continue
        number = int(scene.rsplit('_', 1)[1])
        if number > count:
            raise ValueError('%s is outside enabled custom slots; set_num_custom_maps must be at least %d' %
                             (scene, number))
        expected_id = scene_ids['mp_custom_map_1'] + number - 1
        if scene_ids.get(scene) != expected_id or expected_id >= scene_ids['multiplayer_maps_end']:
            raise ValueError('Custom scene is outside the NW contiguous map range: ' + scene)
        string_id = strings.index('mp_ambush') + expected_id - scene_ids['mp_ambush']
        if string_id >= len(strings) or strings[string_id] != scene:
            raise ValueError('Custom scene/string numeric mapping differs: ' + scene)


def verify_pool_registration(entries, records, slots):
    """The public pool is enforced by the compiled admin/poll map list."""
    from verify_mod_runtime import read_scripts
    from header_operations import troop_set_slot
    generation_mode = set(entries) == set(GENERATORS)
    mixed = any(set(entries) == set(slots) | set(generators) for generators in (MICRO_GENERATORS, LEGACY_MICRO_GENERATORS))
    if len(entries) != len(set(entries)) or (not generation_mode and not mixed and set(entries) != set(slots)):
        raise ValueError("Rotation must contain each supplied custom map exactly once, or all eight fresh generators")
    scene_ids = dict((fields[0][4:], index) for index, (fields, tail) in enumerate(records))
    operations = read_scripts(os.path.join(ROOT, 'scripts.txt'))['multiplayer_fill_map_game_types']
    registered = [args[2] for opcode, args in operations
                  if opcode == troop_set_slot and len(args) == 3 and args[2] >= 0]
    if registered != [scene_ids[name] for name in entries]:
        raise ValueError("Compiled admin/vote map pool differs from rotation")


def validate_good_test_order(identities, statuses=None):
    """Check cyclic category gaps independently of the batch ordering algorithm."""
    if not identities or any(not re.match(r'^(rated_good|test_map)_[0-9]+$', name) for name in identities):
        raise ValueError('Good/test spacing requires catalogue identities')
    groups = statuses if statuses is not None else ['good' if name.startswith('rated_good_') else 'test' for name in identities]
    if len(groups) != len(identities) or any(s not in ('good', 'test') for s in groups):
        raise ValueError('Invalid saved map approval statuses')
    if 'good' in groups and groups[0] != 'good':
        raise ValueError('Good/test rotation must start with a good map')
    for group in ('good', 'test'):
        positions = [i for i, value in enumerate(groups) if value == group]
        if not positions:
            continue
        gaps = [b - a for a, b in zip(positions, positions[1:] + [positions[0] + len(groups)])]
        if max(gaps) - min(gaps) > 1:
            raise ValueError('Good/test maps are not evenly spaced at wraparound')



def verify_weather_order(installed_random, order, supplied, catalogue_rotation):
    large_count = sum(row.get("size") == "large" for row in installed_random.values())
    medium_count = sum(row.get("size") == "medium" for row in installed_random.values())
    expected_sizes = ["large", "medium"] * min(large_count, medium_count)
    expected_sizes += ["large"] * max(0, large_count - medium_count)
    expected_sizes += ["medium"] * max(0, medium_count - large_count)
    policies = {row.get('spacing_policy', 'alternating_tail') for row in installed_random.values()}
    if policies == {'balanced_good_test_v1'}:
        if not catalogue_rotation:
            raise ValueError('Good/test spacing requires installed catalogue metadata')
        statuses = [installed_random[slot]['catalogue_status'] for slot in order] if all('catalogue_status' in installed_random[s] for s in order) else None
        validate_good_test_order([installed_random[slot]['catalogue_id'] for slot in order], statuses)
        expected_sizes = [installed_random[slot]['size'] for slot in order]
    elif policies == {'balanced_cyclic_v1'}:
        # Check cyclic gaps independently of the preparation algorithm.
        expected_sizes = [installed_random[slot]['size'] for slot in order]
        for size in ('large', 'medium'):
            positions = [i for i, value in enumerate(expected_sizes) if value == size]
            if not positions:
                if catalogue_rotation:
                    continue
                raise ValueError('Both rotation sizes must be present')
            gaps = [b - a for a, b in zip(positions, positions[1:] + [positions[0] + len(order)])]
            if max(gaps) - min(gaps) > 1:
                raise ValueError('Rotation sizes are not evenly spaced at wraparound')
        if large_count and expected_sizes[0] != 'large':
            raise ValueError('Balanced rotation must start with large')
    elif policies != {'alternating_tail'}:
        raise ValueError('Unknown or inconsistent rotation spacing policy')
    if not order or len(expected_sizes) != len(order) or len(set(order)) != len(order) or set(order) != set(installed_random):
        raise ValueError("Rotation must contain each installed map exactly once")
    for index, slot in enumerate(order):
        row = installed_random[slot]
        locks = row.get('library', {}).get('settings', {})
        if row.get("size") != expected_sizes[index] or row.get("index") != index + 1:
            raise ValueError("Large/medium rotation order mismatch: " + slot)
        fog = row.get("fog_sequence", [0, 300, 0, 500, 400])
        if fog not in ([0, 300, 0, 500, 400], [0, 400, 0, 300], [600, 400, 600, 300]):
            raise ValueError("Unknown rotation fog sequence: " + slot)
        expected_fog = fog[index % len(fog)]
        if 'weather_policy' in row:
            if row['weather_policy'] != DESERT_WEATHER_POLICY:
                raise ValueError('Unknown weather policy: ' + slot)
            if row.get('biome') in DESERT_BIOMES:
                if 'fog_policy' not in row:
                    expected_fog = 800
                if locks.get('precipitation', 'source') == 'source' and row.get('precipitation_type') not in (0, 1):
                    raise ValueError('Desert precipitation must be clear or rain: ' + slot)
        if 'fog_policy' in row:
            if row['fog_policy'] != 'alternating_clear_random_400_700_v1':
                raise ValueError('Unknown fog policy: ' + slot)
            distance = row.get('fog_metres')
            fog_locks = {'none': 0, 'low': 600, 'medium': 450, 'dense': 300}
            fog_locks.update((str(d), d) for d in (100, 150, 200, 250, 350, 400, 500))
            locked_fog = fog_locks.get(locks.get('fog'))
            valid_fog = distance == locked_fog if locked_fog is not None else (distance == 0 if index % 2 == 0 else 400 <= distance <= 700)
            if not isinstance(distance, int) or not valid_fog:
                raise ValueError('Alternating fog mismatch: ' + slot)
            expected_fog = distance
        if row.get("fog_metres") != expected_fog:
            raise ValueError("Rotation fog sequence mismatch: " + slot)
        if 'biome' in row:
            cycle = saved_biome_cycle(row.get('biome_sequence'))
            biome, region, outer = cycle[index % len(cycle)]
            if locks.get('biome', 'source') != 'source':
                options = dict((n, (r, o)) for n, r, o in LEGACY_SAVED_BIOME_CYCLE)
                options['steppe'] = (2, 'outer_terrain_steppe')
                biome = locks['biome']
                if biome == 'desert' and cycle == SAVED_BIOME_CYCLE:
                    biome = 'desert_forest'
                region, outer = options[biome]
            if row.get('biome_sequence') != [item[0] for item in cycle] or row['biome'] != biome:
                raise ValueError('Rotation biome sequence mismatch: ' + slot)
            fields, tail, _ = supplied[slot]
            if (row.get('terrain_code') != fields[10] or (int(fields[10], 16) >> 156) & 15 != region
                    or tail[2].strip() != outer):
                raise ValueError('Rotation biome terrain mismatch: ' + slot)

def verify(config_text=None, strict_spacing=True):
    from verify_map_identity import verify as verify_identities
    verify_identities(ROOT)
    supplied = {}
    with open(os.path.join(ROOT, "custom_maps", "map_slots.json"), "r") as handle:
        slots = json.load(handle)
    with open(os.path.join(ROOT, "custom_maps", "installed_random_maps.json"), "r") as handle:
        installed_random = json.load(handle)
    catalogue_ids = [row['catalogue_id'] for row in installed_random.values() if 'catalogue_id' in row]
    catalogue_rotation = bool(catalogue_ids)
    if catalogue_rotation:
        if (len(catalogue_ids) != len(installed_random) or len(set(catalogue_ids)) != len(catalogue_ids)
                or any(not re.match(r'^(rated_good|test_map)_[0-9]+$', name) for name in catalogue_ids)):
            raise ValueError('Invalid or duplicate installed catalogue identities')
        with open(os.path.join(ROOT, 'strings.txt'), 'rb') as handle:
            labels = dict(line.split(' ', 1) for line in handle.read().decode('latin1').splitlines()[2:]
                          if line.startswith('str_mp_custom_map_'))
        for slot, row in installed_random.items():
            if labels.get('str_' + slot) != row.get('display_name', row.get('public_id', row['catalogue_id'])):
                raise ValueError('Installed catalogue display name differs: ' + slot)
    for slot, relative_path in slots.items():
        if not re.match(r"^mp_custom_map_\d+$", slot):
            raise ValueError("Invalid supplied slot: " + slot)
        source = os.path.join(ROOT, "custom_maps", relative_path)
        if slot in installed_random:
            metadata = installed_random[slot]
            if metadata["source"] != relative_path:
                raise ValueError("Saved map source mismatch: " + slot)
            definitions = read_records(os.path.splitext(source)[0] + ".txt")
            if len(definitions) != 1:
                raise ValueError("Ambiguous saved map definition: " + slot)
            fields, tail = definitions[0]
            if not os.path.isfile(source):
                raise ValueError("Missing saved source object: " + source)
            with open(source, "rb") as source_file:
                if hashlib.sha256(source_file.read()).hexdigest() != metadata["sha256"]:
                    raise ValueError("Saved source checksum differs: " + slot)
            source = os.path.join(ROOT, "SceneObj", "scn_" + slot + ".sco")
            with open(source, "rb") as object_file:
                object_hash = hashlib.sha256(object_file.read()).hexdigest()
            if object_hash != metadata["sha256"]:
                raise ValueError("Moved saved map object differs: " + slot)
            supplied[slot] = (fields, tail, source)
            continue
        name = re.sub(r"\(\d+\)(?=\.sco$)", "", os.path.basename(source)).replace(" ", "_")
        candidates = [(fields, tail) for fields, tail in
                      read_records(os.path.join(os.path.dirname(source), "scenes.txt"))
                      if fields[0] + ".sco" == name]
        if len(candidates) != 1 or not os.path.isfile(source):
            raise ValueError("Missing or ambiguous source definition/object for " + slot)
        fields, tail = candidates[0]
        supplied[slot] = (fields, tail, source)

    population_path = os.path.join(ROOT, 'custom_maps', 'population_rotation.json')
    population = None
    if os.path.exists(population_path):
        from population_rotation_data import validate_manifest, lua_data, pool_names
        with open(population_path) as handle:
            population = json.load(handle)
        with open(os.path.join(ROOT, 'Config.txt')) as handle:
            configured = [scene for index, scene in rotation_records(handle.read())]
        combined = validate_manifest(population, configured)
        fixed = [s for s in combined if s.startswith('mp_custom_map_')]
        excluded = set(population.get('excluded_maps', []))
        if set(fixed) | excluded != set(installed_random) or set(fixed) | excluded != set(slots):
            raise ValueError('Installed population membership differs')
        records_for_ids = read_records(os.path.join(ROOT, 'scenes.txt'), compiled=True)
        scene_ids = {f[0][4:]: i for i, (f, tail) in enumerate(records_for_ids)}
        with open(os.path.join(ROOT, 'lua/population_rotation_data.lua'), 'rb') as handle:
            if handle.read() != lua_data(population, scene_ids):
                raise ValueError('Runtime population data differs from manifest')
        from verify_mod_runtime import read_scripts
        compiled = read_scripts(os.path.join(ROOT, 'scripts.txt'))
        if 'population_start_next_map' not in compiled:
            raise ValueError('Population transition script is not compiled')
        for name in (n for n in pool_names(population, include_installed_only=True) if n != 'micro'):
            order = population['pools'][name]
            if excluded:
                # Retiring a map preserves the saved biome/weather positions of
                # every installed asset. Validate the original cycle as well as
                # the surviving queue, rather than requiring a weather refresh.
                saved = sorted((s for s in installed_random if installed_random[s].get('pool') == name),
                               key=lambda s: installed_random[s]['index'])
                if order != [s for s in saved if s not in excluded]:
                    raise ValueError('Population survivors differ from saved order')
                order = saved
            subset = {slot: installed_random[slot] for slot in order}
            if any(row.get('pool') != name or row.get('size') != name for row in subset.values()):
                raise ValueError('Installed pool metadata differs')
            verify_weather_order(subset, order, supplied, catalogue_rotation)
    elif any('pool' in row for row in installed_random.values()):
        raise ValueError('Missing population manifest')
    elif any('size' in row for row in installed_random.values()):
        with open(os.path.join(ROOT, 'Config.txt')) as handle:
            order = [scene for index, scene in rotation_records(handle.read())]
        verify_weather_order(installed_random, order, supplied, catalogue_rotation)

    records = read_records(os.path.join(ROOT, "scenes.txt"), compiled=True)
    scenes = dict((fields[0][4:], (fields, tail)) for fields, tail in records)
    if len(scenes) != len(records):
        raise ValueError("Duplicate scene identifiers in compiled scenes.txt")
    source_definitions = read_source_definitions()
    for scene in GENERATORS:
        if scene not in scenes:
            raise ValueError("Generator scene is missing: " + scene)
        fields, tail = scenes[scene]
        if int(fields[2]) != 0x700:
            raise ValueError("Generator flags are incorrect: " + scene)
        validate_terrain(scene, fields[10])
        if tail[2].strip() != OUTER_TERRAINS[scene]:
            raise ValueError("Generator outer terrain is incorrect: " + scene)
        if fields != compiled_header(scene, source_definitions[scene]).split():
            raise ValueError("Generator source/compiled definition differs: " + scene)
        if source_definitions[scene]["terrain"] != tail[2].strip():
            raise ValueError("Generator source/compiled outer terrain differs: " + scene)
        installed = os.path.join(ROOT, "SceneObj", "scn_" + scene + ".sco")
        if not os.path.isfile(installed):
            raise ValueError("Missing installed generator scene object: " + installed)
    if config_text is None:
        with open(os.path.join(ROOT, "Config.txt"), "r") as handle:
            config_text = handle.read()
    entries = [scene for index, scene in rotation_records(config_text)]
    verify_custom_registration(config_text, entries, records)
    active_slots = {s: path for s, path in slots.items()
                    if not population or s not in population.get('excluded_maps', [])}
    verify_pool_registration(entries, records, active_slots)
    for scene in entries:
        if scene not in supplied and scene not in GENERATORS:
            raise ValueError("Rotation map has no supplied custom definition: " + scene)
        if scene not in scenes:
            raise ValueError("Rotation scene is missing: " + scene)
        installed = os.path.join(ROOT, "SceneObj", "scn_" + scene + ".sco")
        if not os.path.isfile(installed):
            raise ValueError("Missing installed scene object: " + installed)
        fields, tail = scenes[scene]
        if scene in GENERATORS:
            if int(fields[2]) & 0x700 != 0x700:
                raise ValueError("Generator flags are missing: " + scene)
        else:
            if scene not in source_definitions or fields != compiled_header(scene, source_definitions[scene]).split():
                raise ValueError('Custom source/compiled definition differs: ' + scene)
            if source_definitions[scene]['terrain'] != tail[2].strip():
                raise ValueError('Custom source/compiled outer terrain differs: ' + scene)
            expected, expected_tail, source = supplied[scene]
            if fields[2:] != expected[2:] or [x.split() for x in tail] != [x.split() for x in expected_tail]:
                raise ValueError("Installed terrain differs from supplied definition: " + scene)
            if digest(installed) != digest(source):
                raise ValueError("Installed object differs from supplied object: " + scene)
    spacing = validate_spacing(entries) if strict_spacing else None
    print("Map preflight passed: %d scenes, %d rotation entries, %d supplied custom maps." %
          (len(records), len(entries), len(supplied)))
    if spacing is not None:
        print("Generated maps after each custom map: %d." % spacing)
    else:
        print("Custom rotation order accepted; every map definition and object validated.")
    excluded = sorted(set(supplied) - set(entries))
    if excluded:
        print("Installed but excluded from rotation: " + ", ".join(excluded))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--allow-custom-order', action='store_true',
                        help='Validate all map assets without requiring fixed generator spacing')
    parser.add_argument('--config', help='Actual server config path if outside the module folder')
    args = parser.parse_args()
    try:
        config_text = None
        if args.config:
            with open(args.config, 'r') as handle:
                config_text = handle.read()
        verify(config_text=config_text, strict_spacing=not args.allow_custom_order)
    except (IOError, OSError, ValueError) as error:
        print("ERROR: %s" % error)
        sys.exit(1)

"""Validated inputs, placement documents, and lossless SCO additions."""
import hashlib
import json
import math
from pathlib import Path
import re
import struct

from helpers import checksum, grid_axis, split_objects


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    def invalid(value):
        raise ValueError('Non-finite JSON value: ' + value)
    return json.loads(Path(path).read_text(encoding='utf-8'), parse_constant=invalid)


def write_json(path, data):
    Path(path).write_text(json.dumps(data, indent=2, allow_nan=False) + '\n', encoding='utf-8')


def number(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError('Expected finite number: ' + label)
    return value


def scene_recipe(path, scene_id):
    """Extract one fixed generated scene, from a recipe or a full scenes.txt."""
    lines = Path(path).read_text(encoding='ascii').splitlines()
    if lines and lines[0] == 'scenesfile version 1':
        count = int(lines[1])
        lines = lines[2:]
        if len(lines) != count * 4:
            raise ValueError('Invalid scenes.txt record count')
        records = [lines[i:i + 4] for i in range(0, len(lines), 4)]
        matches = [r for r in records if r[0].split() and r[0].split()[0] == scene_id]
        if len(matches) != 1:
            raise ValueError('Expected exactly one scene record for ' + scene_id)
        lines = matches[0]
    fields = lines[0].split() if lines else []
    if (len(lines) != 4 or len(fields) != 11 or fields[0] != scene_id
            or fields[0] != 'scn_' + fields[1] or fields[2] not in ('256', '1280')
            or not re.fullmatch(r'0x[0-9a-fA-F]{48}', fields[10])
            or lines[1].split() != ['0'] or lines[2].split() != ['0']
            or len(lines[3].split()) != 1):
        raise ValueError('Expected a matching fixed generated scene recipe (flags 256 or 1280)')
    return '\n'.join(lines) + '\n'


def source_identity(sco, recipe_path):
    sco, recipe_path = Path(sco).resolve(), Path(recipe_path).resolve()
    if not re.fullmatch(r'scn_[A-Za-z0-9_]+', sco.stem) or sco.suffix != '.sco':
        raise ValueError('Expected an scn_*.sco source')
    try:
        split_objects(sco.read_bytes())
    except struct.error as exc:
        raise ValueError('Truncated or invalid SCO object table') from exc
    recipe = scene_recipe(recipe_path, sco.stem)
    source = dict(scene_id=sco.stem, sco_path=str(sco), recipe_path=str(recipe_path),
                  sco_sha256=checksum(sco), recipe_file_sha256=checksum(recipe_path),
                  recipe_sha256=digest(recipe.encode('ascii')),
                  terrain_code=recipe.splitlines()[0].split()[10])
    return source, recipe


def verify_source(source):
    actual, recipe = source_identity(source['sco_path'], source['recipe_path'])
    if actual != source:
        raise ValueError('Original source changed; prepare a new project')
    return recipe


def asset_catalogue(path):
    lines = Path(path).read_text(encoding='utf-8').splitlines()
    records = [line.split() for line in lines if line.startswith('spr_')]
    if not lines or lines[0] != 'scene_propsfile version 1' or int(lines[1]) != len(records):
        raise ValueError('Invalid scene_props.txt')
    result = []
    for index, fields in enumerate(records):
        name = fields[0]
        if not name.startswith(('spr_mm_tree_', 'spr_flora_')) or not int(fields[1]) & 0x1000000:
            continue
        group = ('Trees' if name.startswith('spr_mm_tree_') else
                 'Shrubs' if 'bush' in name else 'Other vegetation')
        result.append(dict(name=name, prop_id=index, object_name=name[4:], group=group,
                           label=name.removeprefix('spr_').replace('_', ' '),
                           mesh=fields[3], collision=fields[4] != '0',
                           ground_offset_m=0.0))
    if not result:
        raise ValueError('No supported vegetation assets found')
    return result


def native_flora_assets(assets, path):
    """Resolve the exact mesh to native flora, preserving its tree/LOD flags.

    Kind-0 sokf_handle_as_flora props do not carry the flora-kind flags. In
    particular palms must use the same kind-4 tree records as authored scenes.
    Entry/variation 1 selects the mesh; variation 2 remains zero.
    """
    lines = Path(path).read_text(encoding='utf-8').splitlines()
    meshes = {}
    cursor = 1
    try:
        for flora_id in range(int(lines[0])):
            name, flags, count = lines[cursor].split()
            flags = int(flags)
            cursor += 1
            for variant in range(int(count)):
                mesh, collision = lines[cursor].split()
                cursor += 1
                meshes.setdefault(mesh, []).append(dict(
                    object_kind=4, object_id=flora_id, object_name=name,
                    variant=variant, flora_flags=flags, collision=collision != '0'))
                if flags & 0x400000:  # fkf_tree: alternate mesh/body pair
                    if len(lines[cursor].split()) != 2:
                        raise ValueError('Invalid alternate tree definition')
                    cursor += 1
            if flags & 0x4000000:  # fkf_has_colony_props
                if len(lines[cursor].split()) != 2:
                    raise ValueError('Invalid flora colony definition')
                cursor += 1
        if cursor != len(lines):
            raise ValueError('Trailing flora definitions')
    except (IndexError, ValueError) as exc:
        raise ValueError('Invalid flora_kinds.txt') from exc
    result = []
    for asset in assets:
        matches = [m for m in meshes.get(asset['mesh'], []) if m['collision'] == asset['collision']]
        if not matches:
            raise ValueError('No matching native flora for ' + asset['name'])
        # Some installed definitions repeat the same mesh. Pick the first exact
        # mesh/collision match in file order, consistently across repeat builds.
        result.append(dict(asset, **matches[0]))
    return result


def validate_height_data(data):
    n = data.get('grid_size')
    if type(n) is not int or not 2 <= n <= 501 or len(data.get('samples', [])) != n * n:
        raise ValueError('Incomplete terrain measurement grid')
    bounds = data['bounds']
    for axis in ('x', 'y'):
        low, high = (number(bounds[axis + s + '_m'], 'bounds') for s in ('_min', '_max'))
        if high - low <= 2:
            raise ValueError('Invalid terrain bounds')
    xs = grid_axis(round(bounds['x_min_m'] * 1000), round(bounds['x_max_m'] * 1000), n)
    ys = grid_axis(round(bounds['y_min_m'] * 1000), round(bounds['y_max_m'] * 1000), n)
    for i, sample in enumerate(data['samples']):
        ix, iy = divmod(i, n)
        if (sample['ix'], sample['iy'], sample['x_m'], sample['y_m']) != (ix, iy, xs[ix]/1000, ys[iy]/1000):
            raise ValueError('Terrain measurement coordinates differ from the grid')
        number(sample['height_m'], 'height')


def verify_height_provenance(path, data, source, recipe):
    validate_height_data(data)
    if data.get('terrain_code') != source['terrain_code']:
        raise ValueError('Height data belongs to a different terrain')
    if (data.get('source_sco_sha256') == source['sco_sha256']
            and data.get('source_recipe_sha256') in (source['recipe_file_sha256'], source['recipe_sha256'])):
        return 'direct source checksums'
    # Pool height grids refer to the baseline SCO; variants.json links the grid
    # to each final explicit-spawn SCO, whose checksum is necessarily different.
    metadata_path = Path(path).parent / 'variants.json'
    if metadata_path.is_file():
        metadata = read_json(metadata_path)
        if (metadata.get('height_data_sha256') == checksum(path)
                and metadata.get('terrain_code') == source['terrain_code']):
            for variant in metadata.get('variants', []):
                if (variant.get('scene_id') == source['scene_id']
                        and variant.get('sco_sha256') == source['sco_sha256']
                        and str(variant.get('scene_flags')) == recipe.split()[2]
                        and scene_recipe(metadata_path.parent / 'scenes.txt', source['scene_id']) == recipe):
                    return 'pool variant checksums'
    raise ValueError('Height data provenance does not match this source; omit --height-data to measure it')


def in_bounds(x, y, bounds):
    return bounds['x_min_m'] <= x <= bounds['x_max_m'] and bounds['y_min_m'] <= y <= bounds['y_max_m']


def placement_document(source, placements=None, settings=None):
    result = dict(version=1 if settings is None else 2, source=source,
                  placements=[] if placements is None else placements)
    if settings is not None:
        result['settings'] = dict(settings)
    return result


def validate_placements(document, source, bounds, assets):
    if not isinstance(document, dict) or type(document.get('version')) is not int or document['version'] not in (1, 2):
        raise ValueError('Unsupported placement document version')
    from environment import validate_settings
    validate_settings(document)
    if document.get('source') != source:
        raise ValueError('Placements belong to a different source/project')
    placements = document.get('placements')
    if not isinstance(placements, list) or len(placements) > 10000:
        raise ValueError('Expected up to 10000 placements')
    names = {a['name'] for a in assets}
    seen, result = set(), []
    for p in placements:
        if not isinstance(p, dict) or set(p) != {'id', 'asset', 'x_m', 'y_m', 'yaw_deg', 'scale'}:
            raise ValueError('Invalid placement fields')
        key = p['id']
        if not isinstance(key, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', key) or key in seen:
            raise ValueError('Invalid or duplicate placement ID')
        seen.add(key)
        if not isinstance(p['asset'], str) or p['asset'] not in names:
            raise ValueError('Unknown vegetation asset')
        x, y = (number(p[k], k) for k in ('x_m', 'y_m'))
        yaw, scale = number(p['yaw_deg'], 'yaw'), number(p['scale'], 'scale')
        if not in_bounds(x, y, bounds):
            raise ValueError('Placement lies outside the terrain')
        if not 0 <= yaw < 360 or not 0.1 <= scale <= 10:
            raise ValueError('Yaw must be in [0, 360); scale must be in [0.1, 10]')
        if abs(x * 1000 - round(x * 1000)) > 1e-6 or abs(y * 1000 - round(y * 1000)) > 1e-6:
            raise ValueError('Coordinates must have at most three decimal places')
        result.append(dict(p))
    return result


def vegetation_record(asset, placement, ground_z):
    z = number(ground_z, 'ground height') + asset['ground_offset_m'] * placement['scale']
    angle = math.radians(placement['yaw_deg'])
    c, s = math.cos(angle), math.sin(angle)
    name = asset['object_name'].encode('ascii')
    return (struct.pack('<III12fI', asset['object_kind'], asset['object_id'], 0,
                        c, s, 0, -s, c, 0, 0, 0, 1,
                        placement['x_m'], placement['y_m'], z, len(name))
            + name + struct.pack('<II3f', asset['variant'], 0, *([placement['scale']] * 3)))


def append_vegetation(original, placements, heights, assets):
    if len(placements) != len(heights):
        raise ValueError('Missing exact terrain heights')
    objects, tail = split_objects(original)
    by_name = {a['name']: a for a in assets}
    additions = [vegetation_record(by_name[p['asset']], p, z) for p, z in zip(placements, heights)]
    data = original[:8] + struct.pack('<I', len(objects) + len(additions))
    data += b''.join(raw for _, _, raw in objects) + b''.join(additions) + tail
    decoded, decoded_tail = split_objects(data)
    if decoded[:len(objects)] != objects or decoded_tail != tail:
        raise ValueError('Scene preservation check failed')
    for (_, _, raw), p, ground in zip(decoded[len(objects):], placements, heights):
        expected = (p['x_m'], p['y_m'], ground + by_name[p['asset']]['ground_offset_m'] * p['scale'])
        if any(abs(a-b) > 0.001 for a, b in zip(struct.unpack_from('<3f', raw, 48), expected)):
            raise ValueError('SCO coordinate precision check failed')
    return data

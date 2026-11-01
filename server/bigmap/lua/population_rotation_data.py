"""Shared population-manifest validation and deterministic Lua data generation."""
import json
import re

try:
    string_types = (basestring,)
except NameError:
    string_types = (str,)


MICRO_GENERATORS = ('random_multi_plain_large', 'random_multi_snow_large', 'random_multi_desert_large')

def pool_names(data):
    return (('micro', 'tiny', 'small') if data.get('schema_version') == 4 else
            ('micro', 'tiny', 'small', 'medium') if data.get('schema_version') == 3 else
            ('tiny', 'small', 'medium') if data.get('schema_version') == 2 else ('small', 'medium'))

def validate_manifest(data, order=None):
    if data.get('schema_version') == 4:
        names = pool_names(data)
        valid_thresholds = (data.get('micro_max_players') in (5, 6) and data.get('tiny_max_players') == 20 and 'small_max_players' not in data)
    elif data.get('schema_version') == 3:
        names = pool_names(data)
        valid_thresholds = (data.get('micro_max_players') in (6, 8) and data.get('tiny_max_players') == 18 and data.get('small_max_players') == 25)
    elif data.get('schema_version') == 2:
        names = ('tiny', 'small', 'medium')
        valid_thresholds = data.get('tiny_max_players') == 14 and data.get('small_max_players') == 24
    else:
        names = ('small', 'medium')
        valid_thresholds = data.get('schema_version') == 1 and data.get('small_max_players') in (14, 22)
    if not valid_thresholds:
        raise ValueError('Unsupported population rotation schema/threshold')
    pools = data.get('pools', {})
    if set(pools) != set(names):
        raise ValueError('Population rotation requires pools: ' + ', '.join(names))
    combined = []
    for name in names:
        pool = pools[name]
        if not isinstance(pool, list) or not pool:
            raise ValueError('Empty or invalid population pool: ' + name)
        if name == 'micro':
            if pool != list(MICRO_GENERATORS):
                raise ValueError('Micro requires the three native plains/snow/desert generators')
        elif any(not isinstance(slot, string_types) or not re.match(r'^mp_custom_map_([1-9][0-9]?|100)$', slot) for slot in pool):
            raise ValueError('Invalid population scene slot')
        combined.extend(pool)
    if len(set(combined)) != len(combined) or len([s for s in combined if s.startswith('mp_custom_map_')]) > 100:
        raise ValueError('Duplicate population slots or capacity exceeded')
    excluded = data.get('excluded_maps', [])
    if (not isinstance(excluded, list) or
            any(not isinstance(slot, string_types) or not re.match(r'^mp_custom_map_([1-9][0-9]?|100)$', slot) for slot in excluded) or
            len(set(excluded)) != len(excluded) or set(excluded) & set(combined)):
        raise ValueError('Invalid or active excluded population maps')
    if order is not None and combined != order:
        raise ValueError('Population manifest differs from configured rotation')
    return combined


def lua_data(data, scene_ids):
    validate_manifest(data)
    lines = ['-- Generated from custom_maps/population_rotation.json; do not edit.',
             ('return {schema_version=%d,' % data['schema_version'] if data['schema_version'] == 4 else
              'return {schema_version=%d, small_max_players=%d,' % (data['schema_version'], data['small_max_players']))]
    for key in ('tiny_max_players', 'micro_max_players'):
        if key in data:
            lines.append('  %s=%d,' % (key, data[key]))
    lines.append('pools={')
    for name in pool_names(data):
        lines.append('  %s={%s},' % (name, ','.join(str(scene_ids[s]) for s in data['pools'][name])))
    lines.append('}}\n')
    return '\n'.join(lines).encode('ascii')

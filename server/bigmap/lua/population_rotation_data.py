"""Shared population-manifest validation and deterministic Lua data generation."""
import json
import re

try:
    string_types = (basestring,)
except NameError:
    string_types = (str,)


from random_map_settings import MICRO_GENERATORS, LEGACY_MICRO_GENERATORS

def pool_names(data, include_installed_only=False):
    active = (('micro', 'tiny', 'small') if data.get('schema_version') == 4 else
            ('micro', 'tiny', 'small', 'medium') if data.get('schema_version') == 3 else
            ('tiny', 'small', 'medium') if data.get('schema_version') == 2 else ('small', 'medium'))
    return active + tuple(data.get('installed_only_pools', [])) if include_installed_only else active

def validate_manifest(data, order=None):
    installed_only = data.get('installed_only_pools', [])
    if installed_only != [] and (data.get('schema_version') != 4 or installed_only != ['medium']):
        raise ValueError('Only schema-4 medium may be installed without automatic selection')
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
    names = pool_names(data, include_installed_only=True)
    pools = data.get('pools', {})
    if set(pools) != set(names):
        raise ValueError('Population rotation requires pools: ' + ', '.join(names))
    combined = []
    for name in names:
        pool = pools[name]
        if not isinstance(pool, list) or not pool:
            raise ValueError('Empty or invalid population pool: ' + name)
        if name == 'micro':
            if pool not in (list(MICRO_GENERATORS), list(LEGACY_MICRO_GENERATORS)):
                raise ValueError('Micro requires the three native plains/snow/desert-forest generators (or saved legacy desert)')
        elif any(not isinstance(slot, string_types) or not re.match(r'^mp_custom_map_([1-9][0-9]?|100)$', slot) for slot in pool):
            raise ValueError('Invalid population scene slot')
        combined.extend(pool)
    if len(set(combined)) != len(combined) or len([s for s in combined if s.startswith('mp_custom_map_')]) > 100:
        raise ValueError('Duplicate population slots or capacity exceeded')
    variants = data.get('variant_pool', [])
    if 'variant_every' in data or 'variant_pool' in data:
        if (data.get('variant_every') != 4 or not isinstance(variants, list) or not variants or
                len(set(variants)) != len(variants) or any(s not in combined or not s.startswith('mp_custom_map_') for s in variants)):
            raise ValueError('Invalid fourth-map variant rotation')
        if any(not set(pools[n]) - set(variants) for n in names):
            raise ValueError('Each normal pool requires a non-variant map')
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
    if 'medium' in data.get('installed_only_pools', []):
        lines.append('bigmap_pool={%s},' % ','.join(str(scene_ids[s]) for s in data['pools']['medium']))
    if data.get('variant_every'):
        lines.append('variant_every=4, variant_pool={%s},' % ','.join(str(scene_ids[s]) for s in data['variant_pool']))
    lines.append('pools={')
    for name in pool_names(data):
        lines.append('  %s={%s},' % (name, ','.join(str(scene_ids[s]) for s in data['pools'][name])))
    lines.append('}}\n')
    return '\n'.join(lines).encode('ascii')

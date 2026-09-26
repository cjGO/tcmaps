"""Explicit biome/weather overrides; preserve every unselected source setting."""
import re
import struct

from helpers import split_objects
from make_weather_variants import WEATHER, weather_prop
from weatherize_selected_rotation import BIOME_MASK, SAVED_BIOME_CYCLE

BIOMES = {name: (region, outer) for name, region, outer in SAVED_BIOME_CYCLE
          if name != 'steppe_forest'}
BIOMES['steppe'] = (2, 'outer_terrain_steppe')
FOG = {'low': 600, 'medium': 450, 'dense': 300}
DEFAULTS = dict(biome='source', fog='source', precipitation='source',
                precipitation_intensity=10, thunder='source', thunder_frequency=50)


def validate_settings(document):
    version = document.get('version')
    if type(version) is not int or version not in (1, 2):
        raise ValueError('Unsupported placement document version')
    if version == 1:
        if 'settings' in document:
            raise ValueError('Settings require placement document version 2')
        return dict(DEFAULTS)
    settings = document.get('settings')
    if not isinstance(settings, dict) or set(settings) != set(DEFAULTS):
        raise ValueError('Invalid map settings fields')
    for key, values in [('biome', BIOMES), ('fog', FOG),
                        ('precipitation', ('clear', 'rain', 'snow')),
                        ('thunder', ('off', 'thunder', 'lightning'))]:
        if not isinstance(settings[key], str) or settings[key] not in ('source', *values):
            raise ValueError('Invalid ' + key)
    for key, maximum in [('precipitation_intensity', 25), ('thunder_frequency', 100)]:
        if type(settings[key]) is not int or not 1 <= settings[key] <= maximum:
            raise ValueError(f'{key} must be an integer from 1 to {maximum}')
    return dict(settings)


def apply_environment(original, recipe, settings, scene_props):
    """Return SCO, recipe and exact override records for engine verification."""
    lines = recipe.splitlines(keepends=True)
    if settings['biome'] != 'source':
        region, outer = BIOMES[settings['biome']]
        code = lines[0].split()[10]
        changed = '0x%048x' % ((int(code, 16) & ~BIOME_MASK) | (region << 156))
        lines[0] = lines[0].replace(code, changed, 1)
        lines[3] = re.sub(r'\S+', outer, lines[3], count=1)
    overrides = {}
    if settings['fog'] != 'source':
        overrides[506] = divmod(FOG[settings['fog']], 10)
    if settings['precipitation'] != 'source':
        kind = ('clear', 'rain', 'snow').index(settings['precipitation'])
        overrides[504] = (kind, settings['precipitation_intensity'] if kind else 0)
    if settings['thunder'] != 'source':
        kind = ('off', 'thunder', 'lightning').index(settings['thunder'])
        overrides[507] = (kind, settings['thunder_frequency'] if kind else 0)
    # Reuse the existing weather writer only after checking its installed IDs.
    props = [line.split()[0] for line in scene_props.read_text().splitlines() if line.startswith('spr_')]
    for prop in overrides:
        if prop >= len(props) or props[prop] != 'spr_' + WEATHER[prop]:
            raise ValueError('Installed weather prop IDs differ from the helper writer')
    objects, tail = split_objects(original)
    kept = [raw for kind, prop, raw in objects if not (kind == 0 and prop in overrides)]
    additions = [weather_prop(prop, *values) for prop, values in overrides.items()]
    edited = original[:8] + struct.pack('<I', len(kept) + len(additions)) + b''.join(kept + additions) + tail
    decoded, after_tail = split_objects(edited)
    assert after_tail == tail and [raw for _, _, raw in decoded[:len(kept)]] == kept
    return edited, ''.join(lines), [dict(prop=prop, first=v[0], second=v[1]) for prop, v in overrides.items()]

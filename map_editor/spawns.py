"""Explicit team spawn edits with immutable source defaults."""
from core import in_bounds, number


def editable_spawns(defaults):
    return [dict(team=p['team'], entry=p['entry'],
                 x_m=round(p['x_m'], 3), y_m=round(p['y_m'], 3)) for p in defaults]


def validate_spawns(document, defaults, bounds):
    if document.get('version') != 3:
        if 'spawn_points' in document or 'default_spawn_points' in document:
            raise ValueError('Spawn edits require loadout version 3')
        return editable_spawns(defaults)
    if document.get('default_spawn_points') != defaults:
        raise ValueError('Original spawn defaults differ from this project')
    points = document.get('spawn_points')
    if not isinstance(points, list) or len(points) != 2:
        raise ValueError('Expected exactly two team spawn points')
    for team, p in enumerate(points):
        if (not isinstance(p, dict) or set(p) != {'team', 'entry', 'x_m', 'y_m'}
                or type(p['team']) is not int or type(p['entry']) is not int
                or (p['team'], p['entry']) != (team, team * 32)):
            raise ValueError('Expected Team 1 / Entry 0 and Team 2 / Entry 32')
        x, y = number(p['x_m'], 'spawn X'), number(p['y_m'], 'spawn Y')
        if not in_bounds(x, y, bounds):
            raise ValueError('Spawn lies outside the terrain')
        if any(abs(n * 1000 - round(n * 1000)) > 1e-6 for n in (x, y)):
            raise ValueError('Spawn coordinates require millimetre precision')
    if (points[0]['x_m'], points[0]['y_m']) == (points[1]['x_m'], points[1]['y_m']):
        raise ValueError('Team spawns must have different positions')
    return [dict(p) for p in points]

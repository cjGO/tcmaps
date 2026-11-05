"""Shared rotation and terrain policy for the eight generated battlefields.

Python 2.7 compatible. These are the on-disk fallback parameters.
Micro plains/snow/desert forest (and legacy desert) use encoded 500 x 500 dimensions.
At runtime map_saving.lua rolls micro hill height 10-20 and ruggedness 0-15;
other generators retain hill height 8-20 and ruggedness 5-10
and installs fresh seeds before each generated map loads; saved recipes
include those exact runtime parameters.

https://heliopolis.eu.org/mab-tools/terrain

"""

GENERATORS = (
    "random_multi_desert_large",
    "random_multi_snow_large",
    "random_multi_plain_large",
    "random_multi_steppe_large",
    "random_multi_desert_forest_large",
    "random_multi_steppe_forest_large",
    "random_multi_snow_forest_large",
    "random_multi_forest_large",
)

# Default rotation cycle; all eight generators remain supported for terrain/save handling.
ROTATION_GENERATORS = (
    "random_multi_snow_large",
    "random_multi_plain_large",
    "random_multi_desert_large",
    "random_multi_steppe_large",
)

# Region values include the forest bit (8). Desert forest is desert palms.
REGIONS = dict(zip(GENERATORS, (5, 4, 3, 2, 13, 10, 12, 11)))
OUTER_TERRAINS = dict(zip(GENERATORS, (
    "outer_terrain_desert", "outer_terrain_snow", "outer_terrain_plain",
    "outer_terrain_steppe", "outer_terrain_desert", "outer_terrain_steppe",
    "outer_terrain_snow", "outer_terrain_plain",
)))

# Saved-pool biome cycle; independent of live fresh-map generators.
# Open steppe (2) is intentionally excluded after the biome comparison playtest.
LEGACY_SAVED_BIOME_CYCLE = (
    ("plains", 3, "outer_terrain_plain"),
    ("desert", 5, "outer_terrain_desert"),
    ("snow", 4, "outer_terrain_snow"),
    ("plains_forest", 11, "outer_terrain_plain"),
    ("desert_forest", 13, "outer_terrain_desert"),
    ("snow_forest", 12, "outer_terrain_snow"),
    ("steppe_forest", 10, "outer_terrain_steppe"),
)


# Fresh rotations exclude open desert; archived batches keep their saved cycle.
SAVED_BIOME_CYCLE = tuple(row for row in LEGACY_SAVED_BIOME_CYCLE if row[0] != 'desert')

def saved_biome_cycle(sequence):
    for cycle in (SAVED_BIOME_CYCLE, LEGACY_SAVED_BIOME_CYCLE):
        if sequence == [row[0] for row in cycle]:
            return cycle
    raise ValueError('Unknown saved biome cycle')

DESERT_BIOMES = ("desert", "desert_forest")
DESERT_WEATHER_POLICY = "desert_override_v1"


# (Bit offset in the complete terrain integer, field width, required value).
# Region detail 3 selects five-metre polygons: encoded 1023 rounds to 1020 m.
TERRAIN_FIELDS = {
    "vegetation": (149, 7, 20),
    "ruggedness": (142, 7, 5),
    "valley": (128, 7, 10),
    "hill_height": (135, 7, 18),
    "size_x": (96, 10, 1023),
    "size_y": (106, 10, 1023),
    "place_river": (127, 1, 0),
    "region_detail": (160, 2, 3),
}


LEGACY_MICRO_GENERATORS = ('random_multi_plain_large', 'random_multi_snow_large', 'random_multi_desert_large')
MICRO_GENERATORS = ('random_multi_plain_large', 'random_multi_snow_large', 'random_multi_desert_forest_large')

def terrain_fields(scene=None):
    fields = dict(TERRAIN_FIELDS)
    if scene in MICRO_GENERATORS + LEGACY_MICRO_GENERATORS:
        fields.update(size_x=(96, 10, 500), size_y=(106, 10, 500))
    return fields

def apply_terrain_settings(code, scene=None):
    """Encode shared settings, preserving biome and all unrelated terrain bits."""
    value = int(code, 16)
    for name, (shift, width, setting) in sorted(terrain_fields(scene).items()):
        mask = (1 << width) - 1
        if not 0 <= setting <= mask:
            raise ValueError("Terrain setting out of range: " + name)
        value = (value & ~(mask << shift)) | (setting << shift)
    return "0x" + format(value, "0%dx" % (len(code) - 2))


def validate_terrain(scene, code):
    value = int(code, 16)
    for name, (shift, width, expected) in sorted(terrain_fields(scene).items()):
        actual = (value >> shift) & ((1 << width) - 1)
        if actual != expected:
            raise ValueError("%s: %s is %d, expected %d" %
                             (scene, name, actual, expected))
    if (value >> 156) & 15 != REGIONS[scene]:
        raise ValueError("Generator biome/forest type is incorrect: " + scene)


def rotation_records(text):
    """Return (line index, scene) for active, correctly formed map commands."""
    records = []
    for index, line in enumerate(text.splitlines()):
        fields = line.split("#", 1)[0].split()
        if not fields or fields[0] not in ("set_map", "add_map"):
            continue
        if len(fields) != 2:
            raise ValueError("Invalid rotation command: " + line.strip())
        if fields[0] != ("add_map" if records else "set_map"):
            raise ValueError("Rotation must begin with one set_map, followed by add_map")
        records.append((index, fields[1]))
    if not records:
        raise ValueError("No rotation configured")
    return records


def validate_spacing(entries):
    """Require equal generator counts per custom map and a continuous cycle."""
    if not entries or entries[0] in GENERATORS:
        raise ValueError("Rotation must start with a custom map")
    counts = []
    generated = 0
    for scene in entries:
        if scene not in GENERATORS:
            counts.append(0)
            continue
        if scene != ROTATION_GENERATORS[generated % len(ROTATION_GENERATORS)]:
            raise ValueError("Generator biome cycle is incorrect: " + scene)
        counts[-1] += 1
        generated += 1
    if len(set(counts)) != 1:
        raise ValueError("Each custom map must have the same number of generated maps")
    return counts[0]

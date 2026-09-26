"""Use the module's existing map pipeline without copying or modifying it."""
from pathlib import Path
import sys

EDITOR_ROOT = Path(__file__).resolve().parent
MODULE_ROOT = EDITOR_ROOT.parent
sys.path.insert(0, str(MODULE_ROOT / 'pythonHelpers'))

from make_weather_variants import split_objects  # noqa: E402
from plot_saved_map_heights import (checksum, grid_axis, parse_samples,  # noqa: E402
                                    parse_spawns, plot_limits, render_png,
                                    run_engine_probe)
from spawn_variants import read_entries  # noqa: E402

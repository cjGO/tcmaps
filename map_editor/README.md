# Map editor: vegetation, biome and weather

A standalone browser editor for placing vegetation and choosing biome, fog, precipitation and thunder on an existing Warband random-map heatmap. Python measures the ground under each point and exports a new SCO/recipe pair. Work on one selected spawn layout at a time.

All new code and generated projects live in `map_editor/`. The tool imports the existing `pythonHelpers` renderer, SCO parser, and engine probe; it does not change the generator, source maps, installed scenes, rotation, or live weather. Environment changes apply only to new exported builds.

## Requirements

- Run commands from the `MOD` directory in WSL, with Python 3.10+ and `uv`.
- Matplotlib is supplied by `uv run --with matplotlib` below.
- The existing Windows Python installation at `/mnt/c/Python27/python.exe`, WSE2 dedicated executable, and module assets are required for terrain measurements and builds. Override the interpreter with `--windows-python PATH` if needed.
- A modern browser. The generated HTML works from `file://` without a web server, internet connection, Node, or a browser extension.

## 1. Prepare one map

```bash
uv run --with matplotlib python map_editor/editor.py prepare \
  --sco custom_maps/random_maps/test_pool/scn_test_018_snow__04_top_middle.sco \
  --recipe custom_maps/random_maps/test_pool/scn_test_018_snow__04_top_middle.txt
```

`--recipe` can also point to a `scenes.txt` containing the source scene ID. Supported recipes have fixed generated terrain, flags **256** or **1280**. Preparation preserves the source. Builds preserve flags, seeds and explicit spawn entries; biome and weather change only when selected in the loadout.

The default output is `map_editor/projects/<scene-id>-<UTC timestamp>/`. Supply `--output NEW_DIRECTORY` to choose another destination. Existing destinations are refused. Preparation normally measures 201 × 201 terrain points in an isolated, unlisted engine process. Production server configuration is untouched. `--timeout SECONDS` defaults to 180 per engine map load.

If matching measurements are available, add:

```bash
  --height-data /path/to/map/height_data.json
```

Measurements must match the original SCO and recipe checksums, or have a matching sibling `variants.json` and `scenes.txt` linking the pool's baseline height data to this exact spawn variant. A PNG alone cannot establish that mapping. Mismatched supplied measurements are rejected; omit `--height-data` to measure the existing terrain again without changing its seed.

Open the printed `editor.html` path in a browser, using the corresponding Windows path when opening it from Windows Explorer. Preparation stores its own source snapshots, measured data, calibrated heatmap, and project metadata. The original source paths must remain available and unchanged when building.

## 2. Place vegetation in the browser

1. Search for an asset, such as `pine`, `aspen`, or `giant bush`. The palette uses the installed module's vegetation definitions and indicates whether a collision mesh is defined.
2. In **Place** mode, click inside the terrain border. Blank margins, axis labels, and the colour bar are outside the terrain. Coordinates are in world metres, X right and Y up.
3. Click a marker or choose an item in **Placed objects** to select it. Drag it, or edit its X/Y fields. Asset, yaw, and scale changes apply to the selected point. Press Escape or click **Place** to deselect before choosing settings for a new point.
4. Use **Select / drag** to inspect or move points without adding new ones. Zoom and scroll for precision. Delete, undo, and redo are available; keyboard shortcuts work when a form field is not focused.
5. Click **Save map loadout JSON**. **Open loadout** restores a saved document for the same original map. Import replaces points and map settings together and can be undone.

The HTML embeds the heatmap and metadata. Reopening it starts with no additions; load your saved JSON to resume. Unsaved changes trigger the browser's normal leave-page prompt. Downloads are the saved editing state.

Vegetation starts upright at scale 1 and yaw 0. Yaw is counterclockwise around world +Z; zero faces +Y. Allowed scale is 0.1–10 and yaw is 0–359.999… degrees. X/Y accept three decimal places. Up to 10,000 additions are supported; practical performance depends on the browser and game.

### Biome and weather

Open **Biome & weather** in the sidebar. Every selector defaults to **Keep source**:

- **Biome:** steppe, plains, snow, desert, plains forest, snow forest, desert forest.
- **Fog:** low **600 m**, medium **450 m**, dense **300 m**.
- **Precipitation:** clear, rain or snow; intensity **1–25** for rain/snow.
- **Thunder:** off, thunder only, or thunder and lightning; frequency **1–100** when enabled.

Rain and snow are mutually exclusive engine modes. Thunder is independently selectable.
Time of day, cloud cover, wind and fog colour retain their source values. Explicit
choices are applied exactly, including desert fog/rain/snow; the pool generator's
random weather and desert presets do not override this custom loadout.

The browser heatmap always depicts the prepared source. A biome change updates
only the biome bits and outer terrain in the exported recipe, but the engine may
also produce different heights and procedural vegetation. Build remeasures the
full grid in the selected biome and grounds additions there. Review the exported
preview. Existing explicit spawn records are preserved; automatic spawns (flags
1280) are remeasured and shown in that preview.

New JSON uses **version 2**, retaining `source` and `placements` and adding this
`settings` object (example):

```json
{
  "biome": "snow_forest",
  "fog": "medium",
  "precipitation": "snow",
  "precipitation_intensity": 15,
  "thunder": "lightning",
  "thunder_frequency": 30
}
```

Use `"source"` for any selector to retain that setting. Numeric fields are always
required, but are ignored while their effect is off or set to source. Keep the
complete exported source identity and placement IDs when editing JSON by hand.
Version-1 vegetation documents still load/build and retain source biome/weather.
New fields in a version-1 document are rejected rather than silently ignored.

To update an existing standalone editor without changing its project or saved
JSON, run this and reopen/reload `editor.html`:

```bash
uv run --with matplotlib python map_editor/editor.py refresh \
  --project map_editor/projects/rotation_20260925_map_1
```

## 3. Build the scene

```bash
uv run --with matplotlib python map_editor/editor.py build \
  --project map_editor/projects/<project-directory> \
  --placements /mnt/c/Users/<you>/Downloads/<scene-id>.placements.json
```

Build validates source and project checksums, resolves asset names against the installed definitions, and asks the engine for the ground height at every exact X/Y. It resolves each selected scene-prop mesh to its installed `Data/flora_kinds.txt` definition and appends native flora records (SCO kind 4), including the exact mesh variant. This preserves the native tree flags used for distant rendering. It writes these records onto the original source snapshot. It always starts from that snapshot; rebuilding the same document never appends another copy of its objects.

The result goes into a new `builds/<UTC timestamp>/` directory within the project, or a new directory specified by `--output`. It contains:

- `<original-scene-id>.sco` and a matching single-record `.txt` recipe.
- `placements.json`, the editable source document.
- `preview.png`, the final-biome heatmap annotated with numbered additions.
- `height_data.json`, measurements for the output SCO/recipe with matching checksums.
- `manifest.json`, with resolved heights, output checksums, and validation results.
- `ground_probe/` and `edited_probe/`, with engine requests, logs, and replay evidence.

An edited-scene engine replay checks terrain, spawn positions, and every added vegetation instance’s position, yaw, scale, and flora variant before publication. It also verifies exactly one engine-loaded weather prop with the requested values for each override. Selected fog/precipitation/thunder props are replaced, including any duplicates. All other original object records and the trailing terrain/AI data remain byte-for-byte unchanged. Biome settings belong in the companion recipe: install both the SCO and recipe together.

A successful build prints `COMPLETE`. On failure, no success manifest is published; `_staging/` and probe logs remain for diagnosis. Use a fresh output directory to retry. Ctrl+C requests engine-worker cleanup and preserves source maps. Do not treat staging files as finished maps.

Projects and placement JSON prepared before the native-flora fix remain usable: rebuild the same JSON with the updated CLI. Old builds remain unchanged. New projects pin both definition-file checksums; legacy projects resolve the current flora table and record its checksum in the new build manifest. The user confirmed the native-flora correction fixes distant palm rendering; other assets and visual weather combinations still need client checks.

Installation is a separate task. Use the repository's map installation workflow with the exported SCO and its recipe; the editor does not assign slots or modify live server files. The export retains the original scene ID in its separate directory.

## Accuracy and current limits

- Clicks use the actual rendered plotting rectangle, including the 975 m reference frame and outer padding. Browser resizing, scrolling, and zoom do not change world coordinates.
- The heatmap contains discrete samples, approximately 4.9 m apart on a full-size map. Final object Z uses exact-point engine measurements, not interpolation. Millimetre coordinate storage is not a claim of millimetre mouse accuracy.
- Only additions appear as markers. Existing procedural vegetation and obstacles remain in the scene but are not depicted. Biome selection changes procedural vegetation and may affect terrain heights. The tool does not sculpt terrain, edit existing vegetation individually, create a 3D preview, or assess paths and collisions.
- Ground offsets currently default to **zero, uncalibrated**, placing each asset's origin on the measured terrain. No visual root-offset corrections have been inferred. Inspect the result in a game client, especially on slopes or at unusual scales; mesh origins can differ and wide shrubs can intersect sloping ground.
- The dedicated probe validates engine data, not rendered appearance or gameplay. Trees with collision meshes and decorative shrubs can behave differently on the server. Validation evidence distinguishes what was checked.
- Changed source maps, source recipe files, prepared height data, or module asset definitions require preparing a new project. This prevents accidentally applying points to a different topology or asset table.

## Tests

```bash
uv run --with matplotlib --with lupa python -m unittest discover -s map_editor/tests -p 'test_*.py' -v
node --test map_editor/tests/coordinates.test.js

uv run --with matplotlib python -m unittest discover -s pythonHelpers -p test_spawn_variants.py
uv run --with matplotlib python -m unittest discover -s pythonHelpers -p test_plot_saved_map_heights.py
uv run --with matplotlib python -m unittest discover -s pythonHelpers -p test_weather_variants.py
```

Optional real-browser check against a prepared project:

```bash
uv run --with playwright python -m playwright install chromium
uv run --with playwright python map_editor/tests/browser_smoke.py map_editor/projects/<project-directory>
```

`--browser /path/to/chromium` uses an existing browser executable. The smoke test opens the local HTML, exercises editing and JSON round trips, and saves `browser.placements.json` plus `browser-check.png` inside the project. It does not build or install a scene.

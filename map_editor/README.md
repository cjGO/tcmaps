# Map editor: scenery, vegetation, biome and weather

A standalone browser editor for placing game scenery and vegetation and choosing biome, fog, precipitation and thunder on an existing Warband random-map heatmap. Python measures the ground under each point and exports a new SCO/recipe pair. Work on one selected spawn layout at a time.

The `rate_maps` website also includes a **3D terrain editor for every fixed map in the current rotation**.
It uses the same placement state, undo history and version-3 loadout format as
this standalone editor. Native game meshes keep their original Z-up axes,
metre units and origins. Terrain remains at true scale while editing. Orbit and
spawn cameras, click-to-place, selection/dragging, yaw, uniform scale and a
**Focus selected** camera are available. Switch between 3D and the calibrated
2D heatmap without losing edits. Inactive 3D renderers are released when switching
maps or tabs; each map's loadout and undo history remain available. The three
micro generators reroll and have no permanent height maps to edit.

Both website 3D views include directional sunlight, soft sky fill, shadows and
gentle distance haze. **Lighting & haze** changes the preview surface, sun
direction and atmospheric effects. **Explore on foot** enters a
first-person explorer: WASD moves, dragging looks around,
arrow keys turn/look, and Space hops. Escape exits exploration. **Stand here** chooses a point on the terrain.
The minimap shows the current edited spawns, position and
facing and supports click-to-relocate. **Exit explorer** restores the overview.

On-foot exploration defaults to 1.0 m eye height and 30.0 m/s. These are preview settings,
not troop/horse statistics or game physics. Movement follows the same measured
triangles as placement; it does not collide with placed objects. The editor shows
the current placed models at native scale. Explorer movement and lighting do
not change the loadout JSON, its weather settings, or team spawn positions.

The optional `window.MapEditor` bridge in `web/app.js` exposes cloned state,
subscriptions, selection, modes, placement and transactional dragging. Both
views validate changes with `MapCoordinates` and save through the existing JSON
button. Native browser models load on demand; the standalone HTML remains an
offline 2D editor. Final builds still measure exact-point ground height in the
engine; browser Z is interpolated from the measured terrain triangles.

To export the installed asset catalogue, run in WSL from MOD:

```sh
uv run --with matplotlib --with numpy --with pillow --with moderngl \
  python pythonHelpers/export_editor_models.py \
  --website-root /home/glect/rate_maps \
  --map-id scn_mp_custom_map_1 \
  --output map_analysis/editor_models_<timestamp> --publish
uv run --with matplotlib python pythonHelpers/register_rotation_editor_models.py \
  --website-root /home/glect/rate_maps \
  --output map_analysis/rotation_editor_models_<timestamp> --publish
```

Use a fresh output directory. The helper uses `pythonHelpers/game_scene_resources.py`, verifies
the registered map and source asset definitions, and records resource/texture
checksums. It reads resources in `module.ini` load order and exports all full-detail multipart scenery and vegetation meshes, 1024-pixel
maximum diffuse textures and native alpha blending/cutoffs. Texture orientation and packed vertex colours are converted for WebGL. It retains native
origins, including geometry below ground; it does not fit or rebase meshes.
Commit the website's `public/editor-models/` and `lib/editor-models.json` together.
`npm run check:editor-models` verifies source identity, checksums, vertex/index
layout and bounds. Terrain export uses `export_rotation_topology.py --all-maps`
separately; export the full rotation before registering it with the model library.

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

## 2. Place assets in the browser

1. Choose a category and search for an asset, such as `house`, `wall`, `barrel`, `bridge`, `rock`, or `pine`. The palette includes 1,030 static scenery props and 282 vegetation choices from the installed module. Buildings, walls/fences, bridges/walkways, rocks/terrain, camp/defenses, furniture/containers, ships/vehicles and other props have separate categories. Each entry indicates whether a collision mesh is defined.
2. In **Place** mode, click inside the terrain border. Blank margins, axis labels, and the colour bar are outside the terrain. Coordinates are in world metres, X right and Y up.
3. Click a marker or choose an item in **Placed objects** to select it. Drag it, or edit its X/Y fields. Set **Height offset Z (m)** to a negative number to sink it into terrain, or a positive number to raise it. **Alt-drag** an object vertically in 3D to change only its height (0.05 m per pixel); **Lower 0.25 m** and **Reset height** also support objects selected from the list, including fully buried objects. Height changes share undo/redo and survive JSON save/open and the native map build. Asset, yaw, and scale changes apply to the selected point. Press Escape or click **Place** to deselect before choosing settings for a new point.
4. Use **Select / drag** to inspect or move points without adding new ones. Zoom and scroll for precision. Delete, undo, and redo are available; keyboard shortcuts work when a form field is not focused.
5. Click **Save map loadout JSON**. **Open loadout** restores a saved document for the same original map. Import replaces points and map settings together and can be undone.

The HTML embeds the heatmap and metadata. Reopening it starts with no additions; load your saved JSON to resume. Unsaved changes trigger the browser's normal leave-page prompt. Downloads are the saved editing state.

Assets start upright at native scale 1 and yaw 0. Yaw is counterclockwise around world +Z; zero faces +Y. Allowed scale is 0.1–10 and yaw is 0–359.999… degrees. X/Y accept three decimal places. Up to 10,000 additions are supported; practical performance depends on the browser and game.

Only visible, unscripted scenery is offered. Invisible helpers, weather controls,
spawn markers, flags and scripted gameplay systems are excluded. The preview
shows static geometry; it does not simulate interactive doors, ships or machinery.

New projects use asset catalogue version 2. To add the expanded catalogue to a
verified older project without remeasuring terrain, run:

```bash
uv run --with matplotlib python map_editor/editor.py upgrade-assets \
  --project /path/to/prepared/project
```

This backs up `project.json` under `asset_backups/`, updates the catalogue and
regenerates `editor.html`. Source identity, height data, spawns and existing
loadout JSON remain compatible. `refresh` alone retains the existing catalogue.
Scenery uses the same `{id, asset, x_m, y_m, yaw_deg, scale}` placement fields;
the loadout schema remains version 3. An optional `z_offset_m` placement field adds a world-metre offset after measured terrain height and the scaled asset-origin correction. Existing files without it use zero; the offset does not scale with the asset.

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

Version 2 introduced the following
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

### Team spawns (version 3)

New browser loadouts use version 3, retaining the settings and asset placement fields.
`default_spawn_points` stores the exact original XYZ/facing records for Team 1
(internal team 0, entry 0) and Team 2 (internal team 1, entry 32).
`spawn_points` stores editable team/entry and X/Y coordinates in metres, rounded
to millimetres. The original stars remain visible; drag the numbered team circles
or use the spawn coordinate inputs. Reset and undo/redo include spawn changes.
Older version-1/2 documents restore the source spawn positions.

Moved spawns receive exact-point engine ground measurements and face each other.
Only entries 0/32 are replaced; automatic-entry recipes become explicit flags 256
when spawn edits are requested. Unchanged spawn defaults retain their original
binary records and facing. Original scenes remain preserved, and building writes
a separate map copy with engine replay evidence.

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

Build validates source and project checksums, resolves asset names against the installed definitions, and asks the engine for the ground height at every exact X/Y. Static scenery is appended as native scene-prop records (SCO kind 0) using the exact compiled prop ID and name. Vegetation resolves to `Data/flora_kinds.txt` and uses native flora records (SCO kind 4), including the exact mesh variant and tree flags used for distant rendering. It writes these records onto the original source snapshot. It always starts from that snapshot; rebuilding the same document never appends another copy of its objects.

The result goes into a new `builds/<UTC timestamp>/` directory within the project, or a new directory specified by `--output`. It contains:

- `<original-scene-id>.sco` and a matching single-record `.txt` recipe.
- `placements.json`, the editable source document.
- `preview.png`, the final-biome heatmap annotated with numbered additions.
- `height_data.json`, measurements for the output SCO/recipe with matching checksums.
- `manifest.json`, with resolved heights, output checksums, and validation results.
- `ground_probe/` and `edited_probe/`, with engine requests, logs, and replay evidence.

An edited-scene engine replay checks terrain, spawn positions, and every added asset instance’s kind, position, yaw, scale, and variant before publication. It also verifies exactly one engine-loaded weather prop with the requested values for each override. Selected fog/precipitation/thunder props are replaced, including any duplicates. All other original object records and the trailing terrain/AI data remain byte-for-byte unchanged. Biome settings belong in the companion recipe: install both the SCO and recipe together.

A successful build prints `COMPLETE`. On failure, no success manifest is published; `_staging/` and probe logs remain for diagnosis. Use a fresh output directory to retry. Ctrl+C requests engine-worker cleanup and preserves source maps. Do not treat staging files as finished maps.

Projects and placement JSON prepared before the native-flora fix remain usable: rebuild the same JSON with the updated CLI. Old builds remain unchanged. New projects pin both definition-file checksums; legacy projects resolve the current flora table and record its checksum in the new build manifest. The user confirmed the native-flora correction fixes distant palm rendering; other assets and visual weather combinations still need client checks.

Installation is a separate task. Use the repository's map installation workflow with the exported SCO and its recipe; the editor does not assign slots or modify live server files. The export retains the original scene ID in its separate directory.

## Accuracy and current limits

- Clicks use the actual rendered plotting rectangle, including the 975 m reference frame and outer padding. Browser resizing, scrolling, and zoom do not change world coordinates.
- The heatmap contains discrete samples, approximately 4.9 m apart on a full-size map. Final object Z uses exact-point engine measurements, not interpolation. Millimetre coordinate storage is not a claim of millimetre mouse accuracy.
- Only additions appear as markers in 2D and native models in the website's 3D editor. Existing procedural vegetation and obstacles remain in the scene but are not depicted. Biome selection changes procedural vegetation and may affect terrain heights. The tool does not sculpt terrain, edit existing vegetation individually, or assess paths and collisions. The 3D editor previews the source terrain; biome, weather, wind and seasonal shading changes appear only after building in the game.
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

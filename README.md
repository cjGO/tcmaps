# Maproom

Browse 200 maps with four spawn setups each, keep your favorites, and copy a plain-text list to send in a message. No accounts, database, API, or environment variables needed.

## Collections

The default **Current rotation** tab cycles through PNGs in `current_rotation`, sorted by filename in numeric order. The exact original PNG filename appears above each image; names embedded in the image are not used. Use the previous/next buttons or left/right arrow keys. These PNGs are included directly in the build, so commit this folder when deploying and rebuild after changing it.

The **Review maps** tab contains the map/spawn browser and saved keep list. Switching tabs preserves your position in both collections.

The **Server stats** tab plots timestamped round-end player counts against UTC time, with line/scatter modes, time ranges, and a session selector. An optional “Color points by round duration” toggle applies a blue-to-orange gradient with a legend and a fixed scale across sessions; missing durations appear gray. Zero counts stay on the baseline. Gaps over 30 minutes are shaded and break the line; missing rounds are not treated as confirmed zero population. Rows without valid timestamps are omitted. A second scatterplot shows player count on the X axis and round duration in minutes on the Y axis, with point details in seconds. It includes all valid rounds, even without timestamps, independently of the population filters. Update `map_round_stats.csv` and rebuild to refresh the data.

## Run

Requires Node.js 24.x.

```sh
cd rate_maps
npm install
npm run dev
```

- Left/right arrows cycle maps. Up/down arrows cycle spawn setups. Clickable controls work on mobile. Shortcuts pause while editing text.
- Click **Keep this setup** to add a map/spawn pair. You can keep multiple spawn setups for the same map. Each kept setup gets a badge.
- Click **Kept · Remove**, or the × beside a list item, to remove it. Click an item to revisit it.
- Click **Copy list**, then paste into a message. The visible text box also supports manual copying if clipboard access is unavailable.

Example message:

```text
Keep list
scn_test_001 | top_left
scn_test_001 | left_middle
scn_test_014 | bottom_left
```

The selections are saved in this browser's local storage. They survive refreshes and reopening the same site, but do not sync between devices or browsers. Clearing site data deletes them. Nothing is submitted automatically: users must send the copied message. If browser storage is unavailable, the page warns the user to copy before leaving. Existing star ratings are not converted to keep selections.

## Deploy to Vercel

Upload this directory to a Git repository and import it into Vercel. If uploading the parent repository, set **Root Directory** to `rate_maps`. The included configuration builds with `npm run build` and serves `dist` as a static site. No Redis, serverless functions, CSV, or secrets are required. Old Redis environment variables can be removed if upgrading the previous version.

## Images

All 800 optimized images are included in `public/maps`, with the collection manifest in `lib/maps.json`. The original `temp_folder` is not needed for deployment. Biome descriptors are ignored in map identifiers.

`npm run dev` and `npm run build` automatically regenerate images from this project’s `temp_folder` when it exists. An empty folder clears the review collection, so the app can run without review maps. Restart the dev server after replacing source images. Deployments without that folder use the prepared images. Image URLs include a content version so replaced maps bypass old browser caches. Manual `npm run prepare:maps` still requires PNG source images.

To regenerate manually after changing source images (or append `-- /path/to/folder` to use another folder):

```sh
npm run prepare:maps
```

## Production build

```sh
npm run build
npm run preview
```

## Map editor

**Current rotation → Edit this map** opens that registered map in the **Map editor** tab. The map selector includes every fixed custom map in the synced installed rotation, sorted by slot number. GOOD MAPS is a separate browsing collection. The micro pool’s three procedural maps generate new terrain each round and have no fixed scene to edit. The editor supports scenery and vegetation placement and dragging, category filtering, asset search, yaw/scale and coordinate editing, zoom, delete, undo/redo, biome and weather settings, and JSON import/export. Switching maps or website tabs retains each editing session until the page closes or reloads.

Users click **Save map loadout JSON** and send the downloaded `.placements.json` file to the map organizer. Nothing is uploaded automatically. **Open loadout** restores a saved file for the same map; files from a different map/source version are rejected. Download before leaving; unsaved edits trigger the editor's browser warning. Version-3 JSON preserves exact source identity and includes asset placements, map settings, original spawn defaults and edited spawn positions for the Python build tool.

The sidebar shows a textured model preview when choosing an asset or selecting a placed object. Previews are fitted to the frame independently; they do not depict relative sizes or the selected yaw/scale. The 1,312 entries include 1,030 static scenery props and 282 vegetation choices, with static thumbnails in `public/editor-assets`, generated from the installed module's full-detail meshes and diffuse textures. Visitors do not need game files or a 3D renderer.

Registered rotation maps have measured, calibrated editor projects. Published project metadata and heatmaps live in `public/editor`, indexed by `lib/editor-maps.json`. These files must be committed along with the website. Deployment needs no Python, game installation, or backend. The editor code is reused directly from `map_editor/web`, isolated in an embedded document so the website's styles and shortcuts do not interfere.

### Updating editor maps (maintainer)

Preparation requires the original Warband module, its `pythonHelpers`, WSE2, Windows Python, and `uv`. Run from this website repository:

```sh
uv run --with matplotlib python scripts/prepare-editor.py \
  --module-root '/mnt/c/Program Files (x86)/Mount&Blade Warband/Modules/MOD'
npm run prepare:editor
npm run build
```

The preparation script reads the module's active `custom_maps/population_rotation.json` and `custom_maps/installed_random_maps.json` registries. It verifies each saved source against the installed `SceneObj` file and `scenes.txt` recipe, then measures the registered terrain in an isolated engine process. It syncs `current_rotation` previews and `MAP_NAMES.md` from those sources and writes `lib/editor-rotation.json` as the deployment snapshot. It does not change the installed game or rotation.

Full projects and measurements live under `map_editor/projects/current_rotation/<scene-id>/<source-version>/`. Keep a backup of these ignored directories: they are needed to build submitted JSON. New source versions get separate projects; old projects remain available for earlier submissions. Publishing copies browser metadata and measured heatmaps. Build/dev checks require every registered fixed map to have a matching published editor project and reject stale, missing, or extra rotation images. Deployments use the committed snapshot without needing access to the game folder. Rerun both preparation commands after changing the installed rotation.

Use `--check` on the Python command to verify installed registration without writing files or running the terrain probe.
To build a user's submission, run the original module's `map_editor/editor.py` from the module directory and pass the absolute website project path:

```sh
uv run --with matplotlib python map_editor/editor.py build \
  --project '/home/glect/rate_maps/map_editor/projects/current_rotation/scn_mp_custom_map_2/<source-version>' \
  --placements /path/to/scn_mp_custom_map_2.placements.json
```

The source archive and module asset definitions must remain unchanged. Scene building/installation stays with the organizer; website users only need their browser. See [the editor documentation](map_editor/README.md) for build validation and supported settings.

### Team spawn editing

The editor starts with the current map's exact Team 1 / Entry 0 and Team 2 / Entry 32 defaults. The original blue/red stars remain visible on the measured heatmap. Drag the numbered team circles, or select a team and enter Spawn X/Y coordinates. Reset both spawns restores the source defaults; undo/redo also includes spawn changes. Both teams face each other after a moved-spawn build, with exact ground heights measured by the engine.

Downloaded version-3 loadouts contain immutable `default_spawn_points` (original XYZ and facing) plus editable `spawn_points` (team, entry, X/Y in metres). Original source identity stays intact. Version-1/2 files remain supported and restore the default spawns. No live scene changes until the organizer separately installs a built map.

The combined rotation export is available at `/editor-spawns.json`. It contains all fixed maps, exact source coordinates, editable XY defaults, bounds, image calibration and checksums. Internal team 0 means Team 1 / Entry 0; internal team 1 means Team 2 / Entry 32. Micro generators reroll each load and have no persistent defaults.

To re-render the current fixed rotation from verified saved measurements, export spawn JSON, and refresh local website assets, run in WSL from the module folder:

```sh
uv run --with matplotlib python pythonHelpers/export_rotation_spawns.py \
  --website-root /home/glect/rate_maps \
  --output map_analysis/current_rotation_<timestamp> --publish
cd /home/glect/rate_maps
npm run prepare:editor
npm run build
```

Choose a new output directory each time. The exporter preserves original scenes and measurements, backs up prior previews/project metadata, uses a shared elevation scale and a centred 975 m reference frame, and verifies every exported PNG checksum. It does not remeasure terrain or start the production server.

To regenerate asset previews after changing game assets, run on Linux with EGL/OpenGL support:

```sh
uv run --with numpy --with pillow --with moderngl python scripts/prepare-asset-previews.py \
  --module-root '/mnt/c/Program Files (x86)/Mount&Blade Warband/Modules/MOD'
```

Commit `public/editor-assets` and `lib/editor-asset-previews.json` with the code. The script reads the game folder and records source resource/texture hashes in its manifest. It includes multipart meshes, excludes LOD meshes, and uses neutral lighting; game lighting and animated foliage shaders can differ. Newly prepared or refreshed standalone editors embed these previews for offline use when the thumbnail directory is available.

`npm test` checks coordinate conversion, loadout validation, and that published editor options and source versions exactly match the synced rotation. Installed-registration validation can be tested without game files using `python3 -m unittest discover -s tests -p test_editor_registration.py`. To check the complete website workflow against a running dev/preview server:

```sh
uv run --with playwright python tests/website_editor_smoke.py http://127.0.0.1:4173
```

## Current rotation: interactive topology

Every fixed map in **Current rotation** has an interactive Three.js terrain model
and a calibrated heatmap. The current collection has **95 maps: 39 tiny, 30 small,
and 26 medium**. Each model uses all **40,401 measured vertices / 80,000 triangles**
from its verified installed editor project. The three micro generators reroll on
each load and have no permanent height grid or editor project.

Drag to orbit, scroll to zoom, and right-drag (or focus the canvas and use arrow
keys) to pan. Camera presets include aerial, opposite side, overhead and looking
inward from 12 metres above each original team spawn. Blue 1 and red 2 mark the
original entries. Toggle 2 m contours or the triangle mesh. Height starts at **1×
true scale**; 2× and 4× are explicitly labeled exaggeration. Reset restores the
initial view and true scale, with contours off. The Heatmap button restores the original
calibrated map image. Original vegetation, structures and game weather are omitted.
Editor additions appear in the Map editor view.

The compact model is approximately 235 kB before HTTP compression. Three.js and
the model load only when this preview is used. The renderer draws on interaction
and resize, releases GPU resources when changing maps/tabs, and offers the heatmap
if WebGL is unavailable. No user data is uploaded and no game files are edited.

### Lighting and ground exploration

Both 3D views use a matte, biome-coloured terrain surface, angled
sunlight, hemisphere fill, terrain/model shadows and sky-matched distance haze.
**Lighting & haze** adjusts sun direction, switches Natural/Elevation colouring,
and toggles shadows/haze. Overhead stays clear; overview haze follows camera
distance. These are preview graphics, independent of saved game-weather settings.

Choose **Explore on foot**, or **Stand here** then click the terrain.
WASD moves, drag looks around, arrow keys turn/look, and Space
hops. Escape exits exploration. A minimap shows
your position/facing, team starts and a metre scale; click it to relocate.
**Exit explorer** restores the previous overview and height exaggeration.

Exploration always uses true terrain scale, interpolating the same triangles as
asset placement. On-foot exploration defaults to 1.0 m eye height and 30.0 m/s.

These are preview values, not Warband troop/horse statistics. There is no obstacle
collision or avatar model. The editor shows placed native assets at their saved
scale. Moving, hopping and lighting controls do not change
placements, team spawns, JSON, undo history or saved biome/weather settings.

The animation loop runs while moving, looking with keys or hopping; it stops
when idle, hidden, unfocused or disposed. Click and drag to look around. Exploration consumes editor canvas gestures and
shortcuts to prevent accidental placements/deletions while navigating.

The WebGL regression check runs isolated Chromium, rejects shader errors and
checks actual terrain pixels in both the rotation viewer and editor. It covers
surface/lighting controls, on-foot movement, overview restoration and
unchanged loadout data. Run it against the production preview after building:

```sh
uv run --with playwright --with pillow python tests/terrain_render_smoke.py http://127.0.0.1:4173
```

Install the Playwright Chromium runtime once with `uv run --with playwright
python -m playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE`
to an installed Chromium binary. `MAPROOM_SCREENSHOT_DIR` optionally retains
screenshots. A JavaScript build alone does not compile WebGL shaders.

### Refresh rotation height maps

In WSL, from the MOD module directory:

```sh
uv run --with matplotlib python pythonHelpers/export_rotation_topology.py \
  --website-root /home/glect/rate_maps \
  --all-maps \
  --output map_analysis/rotation_topology_<timestamp> --publish
uv run --with matplotlib python pythonHelpers/register_rotation_editor_models.py \
  --website-root /home/glect/rate_maps \
  --output map_analysis/rotation_editor_models_<timestamp> --publish
cd /home/glect/rate_maps
npm run check:topology
npm run check:editor-models
npm test
npm run build
```

Use a fresh output directory. The exporter verifies the installed rotation,
source SCO/recipe, measured height provenance and original spawn coordinates and
facing. It preserves all samples in X-major order with integer millimetre heights.
The sample spacing (approximately 2.75–4.15 m across these sizes) limits spatial detail; interpolated
triangles do not claim additional measurements. Saved pool data may predate a
biome change and must not replace installed measurements without verification.

Commit `public/topology`, `lib/rotation-topology.json` and the UI together. Dev and
build checks reject missing rotation maps, changed files and stale source identities. The
registration helper reuses the verified native asset library for every matching
project; re-export native models if asset definitions change. No engine probe,
map regeneration or server restart is needed. Source projects remain in the
existing ignored `map_editor/projects` archive. The export folder retains a
provenance report and any previous published topology manifest.


## Current rotation: place native assets in 3D

Open **Current rotation → Edit this map**, or choose any map in **Map editor**.
Select **3D terrain** or **2D heatmap**. Terrain and native game assets
use world metres at true scale (no height exaggeration in the editor). Navigate
by dragging/scrolling, use aerial/overhead/team-spawn presets, or double-click
terrain in Navigate mode to move closer. In Place mode, the translucent asset
follows the surface; click to place. Select a tree/shrub to drag it, edit yaw and
scale, and use **Focus selected** to inspect it. Right-drag orbits while editing;
Shift-right-drag pans. Touch supports tapping/dragging and two-finger navigation.

The 2D heatmap and 3D view share one placement document, selection and undo
history. Dragging is one undo step; Escape cancels a drag. Existing save/import,
biome/weather and spawn editing continue to use version-3 loadouts. Spawn markers
follow changes made in the sidebar or 2D view; the 3D markers are not draggable.
All fixed rotation maps use the same editing tools. Switching maps or tabs releases
the inactive 3D renderer while retaining each map's loadout, selection and undo
history. Returning to a map restores its 3D scene from that editing state.

The catalogue includes buildings, walls and fences, bridges, rocks, camp props,
furniture, containers, ships and vehicles, alongside vegetation. Models and
textures load on demand, so opening the editor does not download the entire
catalogue (1,293 meshes and 154 textures, about 138 MB in total). Use the category selector and search to find a prop.
Assets retain their native Z-up axes, origin, dimensions and UVs. Texture upload orientation, packed vertex colours, alpha blending, cutoffs and draw order are handled for the browser.
The size readout shows width/depth/height at the chosen uniform scale before yaw.
Models are not normalized to thumbnail sizes or automatically rebased at roots.

Browser grounding interpolates the same triangles that are displayed, using the
original measured grid. The narrow unsampled edge clamps to its nearest sample
for loadouts placed in 2D. Python builds still measure the exact ground beneath
each placement. This previews additions on the source terrain; it does not show
existing procedural vegetation, collision volumes, new biome terrain, weather,
wind or seasonal game shaders. Source maps and installed scenes are preserved.

### Regenerate native models

From MOD in WSL, with a fresh output directory:

```sh
uv run --with matplotlib --with numpy --with pillow --with moderngl \
  python pythonHelpers/export_editor_models.py \
  --website-root /home/glect/rate_maps \
  --map-id scn_mp_custom_map_1 \
  --output map_analysis/editor_models_<timestamp> --publish
uv run --with matplotlib python pythonHelpers/register_rotation_editor_models.py \
  --website-root /home/glect/rate_maps \
  --output map_analysis/rotation_editor_models_<timestamp> --publish
cd /home/glect/rate_maps
npm run check:editor-models
npm test
npm run build
```

This reuses `scripts/prepare-asset-previews.py` to read native BRFs. The module
helper verifies the installed source and asset definitions and records input
hashes in its output provenance. `public/editor-models/<version>/` contains a
manifest, little-endian interleaved float32 vertices/uint32 indices, and WebP
textures (maximum 1024 pixels). `lib/editor-models.json` pins the exact manifest
hash and enabled map revision. Commit both with the editor code and topology.
Build/dev checks verify every checksum, source identity, binary layout and native
bounding box. `map_editor/web/app.js` is also kept in MOD so the standalone
editor and website use the same placement bridge; standalone editors remain 2D.

### Static scenery catalogue

The shared MOD editor catalogue is version 2. New prepared projects include
1,030 visible, unscripted scenery props and the existing 282 vegetation aliases.
Invisible helpers and scripted gameplay controllers are excluded. All 95 fixed
rotation editors have the same palette and show these assets in
3D at native scale. Browser exploration does not collide with placed objects.

Existing placement JSON remains compatible. Scenery records use the same asset,
XY, yaw and scale fields. The Python build resolves scenery to SCO kind 0 with
its compiled prop ID; vegetation retains kind 4 and its native flora variant.
Both are grounded with exact engine measurements and checked by engine replay.

For older prepared projects, run `map_editor/editor.py upgrade-assets --project
/path/to/project` in the MOD helper environment. It backs up the old metadata,
retains source identity and height measurements, and regenerates the standalone
editor. Then run `npm run prepare:editor` and export thumbnails/models before
building the website. Both exporters share MOD's
`pythonHelpers/game_scene_resources.py`, reading BRFs in module load order.

## Tactical round replays and movement heatmaps

Current rotation's existing terrain viewer accepts exported `.replay.json` files
through **Open round recordings**. Import is local, verifies the exact measured
terrain/source checksums, and also supports archived terrain versions. It adds
play/pause, timeline, speed, player/bot filters and time-weighted movement heatmaps.
No backend or server filesystem endpoint is required.

See [operator workflow](docs/replay.md), [schema and measurement limits](docs/replay-schema.md)
and [validation results](docs/replay-validation.md). The 320-soldier fixture in
`tests/fixtures/SYNTHETIC-tactical-demo.replay.json` is explicitly artificial.
Keep server recordings and exported bundles outside disposable `dist/`; nothing
is uploaded automatically. `scripts/export-replay.mjs` prepares bundles and
`scripts/replay-heatmap.mjs` aggregates many rounds one file at a time.

## Permanent map identities

Player-facing IDs and statistics keys are permanent `test_map_#` values. Engine
scene IDs remain internal asset keys only. `lib/editor-rotation.json` stores the
verified `map_id`, `variant_id`, and `variant_revision` next to each resource ID.
Approval never renames a public ID. Editor downloads use the permanent ID while
their source checksums still bind them to the exact measured source.

The current collection contains only the 68 active map families. These previews
are verified saved source measurements; installed biome/weather may differ.
Older excluded previews and pre-refactor CSVs are preserved in the timestamped
`docs/identity-refactor-*` backup. Unattributable historical slot-based rows use
`legacy_mp_custom_map_*` and cannot contribute to a current map's totals.

For new review images, first register their SCO/TXT source in the module catalogue,
then run the module's `pythonHelpers/export_rating_identity_index.py --website-root
/home/glect/rate_maps`. Image checksums must identify exactly one public map.
`npm run prepare:maps` refuses unverified candidates rather than inferring IDs from
source filenames. Existing uncatalogued review selections/ratings are retained as
legacy data; do not relabel them by extracting a filename number.

`npm test` includes identity and quoted-CSV tests. `npm run build` checks the editor,
measured topology, and model registry. Building locally does not publish the site.

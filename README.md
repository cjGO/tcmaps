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

**Current rotation → Edit this map** opens that registered map in the **Map editor** tab. The map selector includes every fixed custom map in the synced installed rotation, sorted by slot number. GOOD MAPS is a separate browsing collection. The micro pool’s three procedural maps generate new terrain each round and have no fixed scene to edit. The original editor supports vegetation placement and dragging, asset search, yaw/scale and coordinate editing, zoom, delete, undo/redo, biome and weather settings, and JSON import/export. Switching maps or website tabs retains each editing session until the page closes or reloads.

Users click **Save map loadout JSON** and send the downloaded `.placements.json` file to the map organizer. Nothing is uploaded automatically. **Open loadout** restores a saved file for the same map; files from a different map/source version are rejected. Download before leaving; unsaved edits trigger the editor's browser warning. Version-3 JSON preserves exact source identity and includes vegetation, map settings, original spawn defaults and edited spawn positions for the Python build tool.

The sidebar shows a textured model preview when choosing an asset or selecting a placed object. Previews are fitted to the frame independently; they do not depict relative sizes or the selected yaw/scale. The 282 entries share 280 static thumbnails in `public/editor-assets`, generated from the installed module's full-detail meshes and diffuse textures. Visitors do not need game files or a 3D renderer.

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

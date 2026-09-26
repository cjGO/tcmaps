# Maproom

Browse 200 maps with four spawn setups each, keep your favorites, and copy a plain-text list to send in a message. No accounts, database, API, or environment variables needed.

## Collections

The default **Current rotation** tab cycles through PNGs in `current_rotation`, sorted by filename in numeric order. The exact original PNG filename appears above each image; names embedded in the image are not used. Use the previous/next buttons or left/right arrow keys. These PNGs are included directly in the build, so commit this folder when deploying and rebuild after changing it.

The **Review maps** tab contains the map/spawn browser and saved keep list. Switching tabs preserves your position in both collections.

## Run

Requires Node.js 20.19+ (or 22.12+).

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

`npm run dev` and `npm run build` automatically regenerate images from this project’s `temp_folder` when it exists. Restart the dev server after replacing source images. Deployments without that folder use the prepared images. Image URLs include a content version so replaced maps bypass old browser caches.

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

**GOOD MAPS → Edit this map** opens that map in the **Map editor** tab. The map selector includes every GOODMAPS map. The original editor supports vegetation placement and dragging, asset search, yaw/scale and coordinate editing, zoom, delete, undo/redo, biome and weather settings, and JSON import/export. Switching maps or website tabs retains each editing session until the page closes or reloads.

Users click **Save map loadout JSON** and send the downloaded `.placements.json` file to the map organizer. Nothing is uploaded automatically. **Open loadout** restores a saved file for the same map; files from a different map/source version are rejected. Download before leaving; unsaved edits trigger the editor's browser warning. The JSON retains the original version-2 schema and exact source identity for the Python build tool.

All 21 current GOODMAPS have measured, calibrated editor projects. Published project metadata and heatmaps live in `public/editor`, indexed by `lib/editor-maps.json`. These files must be committed along with the website. Deployment needs no Python, game installation, or backend. The editor code is reused directly from `map_editor/web`, isolated in an embedded document so the website's styles and shortcuts do not interfere.

### Updating editor maps (maintainer)

Preparation requires the original Warband module, its `pythonHelpers`, WSE2, Windows Python, and `uv`. Run from this website repository:

```sh
uv run --with matplotlib python scripts/prepare-editor.py \
  --module-root '/mnt/c/Program Files (x86)/Mount&Blade Warband/Modules/MOD'
npm run prepare:editor
npm run build
```

The preparation script verifies GOODMAPS images against the module's `custom_maps/random_maps/good_maps` archive and measures terrain in an isolated engine process. It writes original-source snapshots, measurements, calibrated images and full projects under `map_editor/projects/goodmaps/<scene-id>`. Keep a backup of these ignored project directories: they are needed to build users' submitted JSON. Publishing copies only the browser metadata and heatmaps. Build/dev checks reject missing or stale published assets when GOODMAPS changes.

To build a user's submission, run the original module's `map_editor/editor.py` from the module directory and pass the absolute website project path:

```sh
uv run --with matplotlib python map_editor/editor.py build \
  --project /home/glect/rate_maps/map_editor/projects/goodmaps/scn_mp_custom_map_2 \
  --placements /path/to/scn_mp_custom_map_2.placements.json
```

The source archive and module asset definitions must remain unchanged. Scene building/installation stays with the organizer; website users only need their browser. See [the editor documentation](map_editor/README.md) for build validation and supported settings.

`npm test` checks coordinate conversion and loadout validation. To check the complete website workflow against a running dev/preview server:

```sh
uv run --with playwright python tests/website_editor_smoke.py http://127.0.0.1:4173
```

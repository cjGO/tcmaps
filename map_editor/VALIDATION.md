# Validation record — 2026-09-26

Implemented and exercised from the MOD directory in WSL. No source maps, installed scenes, rotation, weather, or generator files were changed.

## Automated checks

- Python tests cover recipe selection, source identity, direct and pool-variant height provenance, complete sample grids, placement documents, invalid coordinates/assets/transforms, SCO preservation, deterministic repeat builds, rendering calibration, project integrity, and failed engine probes.
- Lua regression tests cover WSE2 conditional/lhs return values, scale accessors, multiple asset instances, transform mismatches, and overlapping objects.
- JavaScript tests cover rectangular bounds, corners, centre, Y inversion, margins, zoom/resize coordinate conversion, JSON round trips, and invalid placements.
- Existing spawn, height-renderer, and weather-object helper suites passed.
- Chromium opened the generated HTML directly from disk. Placement, dragging, property edits, undo/redo, deletion, zoom, resizing, download, reimport, and rejecting an unrelated document passed without page errors.

See README for repeatable test commands. The Lua tests require the optional `lupa` test dependency; browser tests require Playwright and Chromium.

## Real engine proof

Prepared `projects/validation-snow/` from the existing test-pool scene `scn_test_018_snow__04_top_middle`, measuring its unchanged terrain at 201 × 201 points. Its SCO did not match any SCO in the shared removal archive.

- Added `spr_mm_tree_pine1` and `spr_flora_giant_busha` near a flat sample and a slope of approximately **24.19°**, estimated from adjacent terrain samples.
- Used yaw **45° / 123°** and scale **1 / 1.4** to exercise non-default transforms.
- The four-object proof passed exact ground measurement, binary preservation, engine loading, loaded-instance position/yaw/scale checks, terrain replay, and spawn preservation.
- A separate successful build used two placements exported by actual browser clicks, including a click after zooming and resizing. These arbitrary X/Y coordinates passed exact-height measurement and edited-scene replay.

Local evidence is retained in `projects/validation-snow/builds/20260926-034509-242225/` (tree/bush proof) and `projects/validation-snow/builds/20260926-035052-449563/` (browser export). Each successful build has a manifest and engine logs. Earlier diagnostic runs are retained without success manifests. Generated projects are git-ignored.

## Not validated

No graphical Warband client playtest was performed. Rendered root alignment, asset-specific vertical offsets, collision behaviour, and pathfinding remain unchecked. Ground offsets stay at zero and are explicitly marked uncalibrated. The dedicated engine verifies transforms and terrain data; it does not establish how meshes look on slopes. No maps were installed or production server restarted.


## Native-flora rendering correction — 2026-09-26

The first client test reported that the 24 added `spr_mm_tree_palm1` trees
vanished beyond roughly 30 m. Earlier exports used kind-0 scene-prop records.
The installed `mm_palm_tree` flora definition (ID 46) has `fkf_tree` (0x400000),
and original NW scenes such as `scn_mp_pyramids.sco` use kind-4 flora records
with variation IDs 0–5. The palm mesh `palmb_7` also has a `.lod4` mesh.
This evidence identifies the generic-prop rendering path as the likely cause;
a graphical retest is required to confirm the distance correction.

The exporter now resolves all 282 palette meshes to native flora definitions,
uses the selected mesh's variant, and records the definition checksum and
resolved assets. Existing browser projects and placement documents still work.
WSE2's `game.propInstIt` uses type 5 for flora (SCO kind 4); the isolated probe
verifies each added instance including its variant, position, yaw and scale.
No global scene-prop flags, graphics settings or mesh resources were changed.

- 23 editor/Lua regression tests passed, including six palm variants, flora
  definition changes, missing flora and variant mismatches.
- 38 existing spawn, saved-height and weather helper tests passed.
- The user's unchanged 24-palm document passed engine and binary checks in
  `projects/rotation_20260925_map_1/builds/20260926-044025-882612/`.
- Pines and giant bushes on flat/sloping terrain with non-default transforms
  passed again in `projects/validation-snow/builds/20260926-044116-478383/`.
- The corrected 24-palm build was installed after the user stopped the server.
  All four installation preflight checks passed; Config.txt loads only
  mp_custom_map_1 (Editor_Test_Map_1). The previous test is backed up under
  deployment/before-map-editor-test-20260926-044025-882612/.
  Graphical distance checks remain pending; the server was left stopped.

The correction changes only appended objects. Original map objects, terrain,
weather and spawns remain preserved. Ground offsets remain zero and uncalibrated.


## Explicit biome/weather loadouts — 2026-09-26

The user confirmed the native-flora correction fixed distant palm rendering.
The editor now exports version-2 loadouts with explicit biome, fog,
precipitation/intensity and thunder/frequency settings. Version-1 imports retain
source settings. The user's existing editor HTML was refreshed in place;
their original 24-palm JSON remains unchanged.

Validation passed: 30 Python/Lua editor tests, six JavaScript tests and 38
existing helper tests (74 total). Chromium checked the actual offline UI,
including environment undo/redo, exact JSON export, import and version-1 migration.

A real isolated-engine build of the user's 24 palms selected snow forest,
medium fog (450 m), snow intensity 15 and lightning frequency 30. It measured
201 x 201 final-biome samples and exact placement heights, then verified the
loaded vegetation transforms, native flora variants, weather prop values,
terrain bounds/corners and explicit spawns. Evidence:
`projects/rotation_20260925_map_1/builds/20260926-045231-653441/`.

The build exports matching SCO/recipe, loadout JSON, final height data,
annotated preview, resolved settings/checksums and engine evidence. The source
seed and non-biome terrain bits are retained. Selected weather props are
replaced; all other original records and trailing terrain data are preserved.
The weather demonstration is an exported test build, not an installed map.
Rendered weather appearance and other vegetation assets remain client checks.

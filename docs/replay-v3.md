# Replay v3 viewer

Open **Replay v3** or `?tab=replay3`. Choose an existing v2 recording from the
catalogue or open its original `.jsonl` file. No new recorder, capture format or
conversion is required. File imports stay in the browser. V1 and v2 playback
remain on the existing Replays tab.

V3 adds timed gold paths from recorded firing locations to recorded hit
locations, moving markers, short fading trails, illustrated smoke, a shot
inspector, searchable/paginated hit paths, volley highlights, and 0.1× playback.
**Watch at 0.25×** frames a shot and plays a short clip that stops after impact.
The full dashed line is a preview of the selected inferred path. Clear selection
to remove it. Volley cards play the largest recorded firing bursts in slow motion.
Movement, artillery, terrain, source/variant identity checks, unit filters,
cinematic cameras, bot-strength history, and fog retain their existing behavior.

The MP4 preview and encoder use the same v3 combat layer, including the selected
path/smoke options. Exported video labels inferred paths explicitly. CSV export
contains only derived associations, with source shot/hit sequences, recording-local
participant IDs, mission-clock milliseconds, distance, flight interval and provenance.
It does not alter or replace the journal. Catalogue links retain `tab=replay3`;
an optional `t` parameter is seconds from capture start.

## What a gold path means

The native musket projectile itself was not tracked in v2. V3 requires exactly
one preceding shot from the same recording-local attacker and weapon within
3,000 ms of a ranged hit. It excludes melee hits and hits attributed to scripted
artillery. It rejects multiple candidate shots, multiple impacts associated with
the same candidate shot, zero-duration flights, distances below 0.2 m, average
speeds above 450 m/s, and (at ranges of at least 10 m) speeds below 40 m/s or
weapon-heading differences above 10 degrees. These are conservative viewer
heuristics, not calibrated native ballistics or a statistical confidence score.
Close-range heading checks are omitted because the weapon origin can differ
substantially from the muzzle relative to the target distance.

Endpoints and timestamps come from the recorded events. The association and
straight interpolation between them are inferred. No gravity curve, obstruction,
miss endpoint, ricochet, headshot, kill attribution or actual health loss is
invented. A shot without a matched endpoint is **unresolved**, not a confirmed
miss. Smoke is a deterministic illustration of recorded firing, not captured
particle state or wind. Volley groups are bursts of at least four shots in 700 ms
from a recorded squad/team, not recorded firing commands.

Identities and squad membership are resolved at the event's sequence, including
ownership changes. A projectile can arrive after its shooter dies. Engine agent
IDs are never used for matching. Backward seeks recompute the same presentation;
live counters only include events at or before the cursor. Whole-capture
summaries and highlights intentionally describe the entire capture.

Weapon names apply only to the matching recorded item-table checksum. Unknown
builds retain numeric IDs. Terrain mismatches retain the existing unverified
overlay warning; terrain is not used to manufacture projectile intersections.

## Isolation and validation

All new behavior lives in `src/replay-v3*`. The tab initializes on first use. V3 imports the existing parser and
rendering helpers without changing their event model. Its worker returns a
separate derived combat index. V3 controls and video composition are independent
copies so later work does not change the stable replay controls or exports.
Only application navigation, the new tab container and test registration touch
existing files. The recorder, Lua, source journals and all existing replay
implementation files are unchanged.

`npm test` includes inference fixtures covering ambiguity, event ordering,
dead shooters, filtering, implausible geometry, reverse seeks, provenance and
unchanged source data. `python tests/replay_v3_smoke.py URL` exercises the tab,
real captures, synthetic volleys, shot inspection, malformed imports, export
preview, switching tabs and a mobile viewport. It requires the existing
Playwright environment; `PLAYWRIGHT_CHROMIUM_EXECUTABLE` can select an installed
Chromium. The synthetic example is explicitly labelled and uses the v2 schema.

## Validation on 2026-11-07

The production build passed with the complete existing recording archive, along
with all five prebuild checks. The 10 v3 inference tests passed. Browser acceptance
covered synthetic volleys, filtering, reverse seeking, malformed imports, mobile
layout, tab switching, lazy startup, capture-time deep links, and a real capture
(`EXP-20261101T140232Z-1`) with 411 inferred paths. It reported no JavaScript or
WebGL errors or mobile overflow. A one-second 720p MP4 at 0.25× encoded and decoded
successfully; toggling paths changed the export composition.

The complete regression command (run sequentially) passed 25 of 28 test files.
The remaining failures were reproduced in the original app before installation:

- `editor-state.test.js`: the saved test_map_116 and test_map_176 fixtures have
  different source versions from their current editor projects.
- `map-feedback.test.js`: the processed feedback CSV still contains legacy
  engine-slot names.
- `rotation-density.test.js`: the archive now contains 19 matching recordings,
  while the test expects nine.

Those existing tests, historical data and map assets were left unchanged. Browser
screenshots and detailed validation logs were kept in the temporary validation
workspace, rather than included in the app bundle.

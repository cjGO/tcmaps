# Round recording and tactical replay

This feature is implemented in the MOD Lua bridge and the existing WSL
`/home/glect/rate_maps` viewer. It initially supports **Commander Battle**. It is
a sampled tactical view, not combat resimulation. Read [the schema](replay-schema.md)
for precision, lifecycle, identity and heatmap semantics.

**Production acceptance is still open:** see [validation and runtime limitations](replay-validation.md).
Private captures passed, but exploratory runs exposed native WSE2 Lua crashes
under failed background master-server traffic. Resolve/validate this condition
before live rollout; a Lua error guard cannot contain native access violations.

## Server preparation and operation

Changes are staged for review; the live server has **not** been restarted or
deployed. The existing one-second native trigger now forwards six round-context
values to `replayContext` before the unchanged statistics tick. Older compiled
mission templates cannot supply context; commands report it safely. Starting can
require waiting for the first context tick after a round boundary. The recorder
does not make nested native script calls to query round state.

Build into a new directory using Windows Python 2.7, from MOD:

```powershell
C:\Python27\python.exe lua/stage_replay.py deployment/replay-build-NEW
C:\Python27\python.exe lua/verify_replay.py deployment/replay-build-NEW
```

This copies the current compiled baseline and source, then incrementally compiles
scripts and mission templates while preserving existing global and quick-string
indices. It does not install or start anything. Do not use the earlier exploratory
`replay-build-20261023-1` stage, which has fresh index allocation, or the superseded
`-2` stage. The reviewed incremental stage is `deployment/replay-build-20261023-3`.

For an authorized deployment, back up the server, install the reviewed compiled
`scripts.txt`, `mission_templates.txt`, `quick_strings.txt`, `variables.txt` together
and the changed Lua files: `main.lua`, `round_recorder.lua`, `replay_config.lua`,
`statistics_json.lua` (existing codec dependency), `prepare_replay_maps.py` and
the updated startup launcher. Source maintenance also includes `module_statistics.py`
and the no-op timing callback in `pythonHelpers/height_probe.lua` for isolated terrain
probes. Retain existing server settings, journals and map
archives. Run the established module preflights before startup. The launcher now
also runs `lua/prepare_replay_maps.py` after scene synchronization/verification.
For another launcher, add that step explicitly. Never reuse its generated
`lua/replay_maps.lua` after replacing scenes; restart from a freshly prepared
manifest so the loaded scene and identity snapshot agree.

Admin commands, privately consumed in T, team chat, and the existing O-key route:

| Command | Action |
|---|---|
| `/recordround` or `/recordround 5` | Immediate snapshot, then approximately every 5 mission seconds |
| `/recordround 10` | Immediate snapshot, then approximately every 10 mission seconds |
| `/recordround status` | Recording ID, sample count and interval, or last outcome |
| `/recordround stop` | Finalize the current recording |

The listen-server host follows the existing admin convention. Warmup/ended
rounds and duplicate starts are rejected. Starting late captures only subsequent
movement. Round end finalizes automatically; map boundaries, resets, mission
end, clock resets and explicit stops have distinct termination reasons. Recording
does not automatically start again on the next round.

Output: `lua/replays/<UTC>-<mission>-<round>-<sequence>.jsonl`. File collisions
are skipped, never overwritten. Keep this directory in durable server backups,
outside website `dist/`. One server process should own its recording directory.
No player account IDs or names are collected; connections are local pseudonyms.

Default hard ceilings, adjustable **downward** in `lua/replay_config.lua` before
restart: 3,600,000 ms duration (one hour), 4,096 distinct soldier lifetimes,
67,108,864 bytes (64 MiB), 262,144-byte buffered lifecycle batches, 2,000,000
soldier positions and 250,000 total records (including header/end). The latter
two limits match browser validation. A bounded full
snapshot can itself exceed the batch target at the entity ceiling. Each sample
flushes; lifecycle batches flush at the target or next sample/end. No file is
opened per soldier, and no catch-up snapshots, terrain queries or network
broadcasts are performed. A recoverable Lua I/O/API failure disables recording until restart
without throwing into statistics or the round. Logs identify the error; preserve
the incomplete file rather than retrying an ambiguous append.

## Export and browser playback

Transfer the journal with the operator's existing file-copy/SFTP workflow. No
server filesystem HTTP endpoint is installed. With a copy accessible in WSL,
run from `rate_maps` using the project's supported Node runtime (24 recommended;
validation here used the installed 22.23.2):

```sh
node scripts/export-replay.mjs \
  --journal /path/to/ROUND.jsonl \
  --output /path/to/NEW.replay.json
```

The exporter searches `lib/rotation-topology.json` by exact source identity and
verifies the matching `public/topology/.../terrain.json` checksum. For old maps,
use `--manifest /archive/manifest.json --asset-root /archive/public`. Preserve
versioned topology assets and their export manifests when updating rotations.
Existing catalogue, removal archives and map selection policies are unaffected.

If no matching terrain exists, export fails clearly. Prepare a measured topology
through the existing editor/topology workflow; do not reuse terrain by slot or
silently update its hashes. The installed map registry and current website
snapshot differed during this work, so some newly replaced maps legitimately
need their matching terrain exported. Native reroll captures remain unavailable
for 3D in this version; `/savemap` can preserve the loaded recipe for future
measurement, but a saved recipe alone is not a measured topology.

Place exported `*.replay.json` bundles in the repository’s `/replays` folder and
rebuild/redeploy to publish them. The **Replays** tab lists every available recording
without downloading the bundles until selected. Current rotation maps with recordings
have a **View replays** link. Selecting a recording loads its embedded matching 3D
terrain; press **Play** to start playback.

For local files, open **Replays → Open round recordings**, choose one or more exported
files, then select a recording. Import is local; nothing uploads. The existing
viewer opens the embedded matching terrain and retains camera presets, contours,
exploration, and height exaggeration. Use Play/Pause, speed, timeline, and
Players/Bots filters. White rings identify player-controlled soldiers; elongated
arrows identify mounted soldiers. The readout shows elapsed round time, actual
coverage, incomplete status and synthetic labels. Switching view releases GPU
resources; Clear recordings releases the imported data.

## Many-round movement analysis

The Movement heatmap toggle combines loaded recordings of the exact same source
version and synthetic/real category, respecting player/bot filters. Export heatmap
JSON retains per-team and mounted/infantry categories. The overlay represents
time spent in each cell, so larger armies and longer observed rounds contribute
more soldier-seconds; it is not a count of equally weighted round visits.

For many rounds, aggregate offline, retaining only one decoded replay and the
combined grid in memory:

```sh
node scripts/replay-heatmap.mjs NEW-heatmap.json /archive/*.replay.json
```

Mixed source versions or synthetic/real data are rejected. Retain raw journals
to change cell size or compute future formation/flanking metrics. Recording IDs
are deduplicated. Partial-round exposure and missing intervals are not invented.

## Validation commands and limitations

Server fixture checks (WSL from MOD):

```sh
uv run --with lupa python lua/test_round_recorder.py
python3 lua/test_replay_identity.py
uv run --with lupa python lua/test_statistics.py
uv run --with lupa python lua/comms/test_mapstats.py
uv run --with lupa python lua/test_map_saving.py
```

The private engine probe uses real soldiers/horses and native APIs in an isolated,
unlisted copied module, a fixture command sender, and controlled round setup:

```powershell
C:\Python27\python.exe lua/probe_replay_runtime.py deployment/replay-build-NEW
```

It never uses or restarts the live process. Its warm-snapshot benchmark injects the
cadence clock while reading real engine soldiers and writing real journals; cold
captures use the actual mission clock. Retained logs and journals distinguish
the engine test from mock Lua tests. This controlled probe is not a connected-client
playtest or a representative loaded multiplayer performance certification.

Website:

```sh
node scripts/make-replay-fixture.mjs
node scripts/export-replay.mjs --journal tests/fixtures/SYNTHETIC-tactical-demo.jsonl \
  --output /path/to/new/SYNTHETIC-tactical-demo.replay.json
npm test
npm run build
uv run --with playwright python tests/replay_smoke.py http://127.0.0.1:4175
```

The checked-in `tests/fixtures/SYNTHETIC-tactical-demo.replay.json` is an explicitly
synthetic 320-soldier demo on checksum-matched measured terrain. Browser smoke
tests use it for cavalry, takeover, deaths, respawn, gap hiding, scrubbing, playback,
player/bot visibility, heatmap export, 4× exaggeration and resource disposal.
See `replay-validation.md` for observed costs and remaining acceptance work.

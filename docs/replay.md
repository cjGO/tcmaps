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
Connections use local IDs rather than account IDs. Newer recorder versions can
include player display names; older recordings have only local IDs.

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
server filesystem HTTP endpoint is installed. Open v1 `.jsonl` recordings directly
with **Open local v1 recording** on `/replays`, or put them in the repository's
`replays/` folder and rebuild/redeploy to publish them. No conversion is needed.
The viewer finds terrain in the published topology manifest by exact source
identity and verifies its checksum. If that version is missing, publish its
measured topology or use a bundle containing archived terrain.

To create an optional self-contained bundle, run from `rate_maps` using the project's supported Node runtime (24 recommended;
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

Place raw `*.jsonl` recordings or exported `*.replay.json` bundles in the repository’s `/replays` folder and
rebuild/redeploy to publish them. The **Replays** tab lists every available recording
without downloading the bundles until selected. Current rotation maps with recordings
have a **View replays** link. Selecting a recording loads its matching 3D
terrain (from the published topology assets for JSONL, or embedded in a bundle); press **Play** to start playback.

Each catalog entry has a **Replay link**. During playback, **Copy link at current
time** shares the selected published recording, round time, and followed soldier
(if any). Links open paused; press **Play** to watch. Optionally enter **Clip end**
in seconds from round start to stop playback there. For example,
`/?replay=20261027T052501Z-62-1-78&t=90&end=120` opens at 1:30 and stops at 2:00.
Times are clamped to recorded coverage. Local file imports must be published
before they can be shared. Recordings must remain in subsequent deployments for
their links to keep working. Tabs also support `/?tab=replays` (or `rotation`,
`review`, `good`, `bad`, `server`, `editor`).

**Browse replays** collapses the catalog and its filters. The expanded list scrolls
inside a bounded area (roughly ten compact entries on desktop); player rosters
expand inside that list. Shared replay links start with the catalog collapsed so
the recording and playback controls are immediately accessible.

Use **Player names (optional)** to filter by a partial recorded display name,
ignoring letter case. Separate names with commas to require every name in the
same replay; the minimum-player filter applies alongside this search. Clear the
search to show all names again. Expand **Player roster** below any recording to
inspect its connections, recorded aliases, and missing names. Reconnects remain
separate connections. Names are indexed from all soldier metadata at build time,
so searching does not download replay bundles. Only controlling-player names
actually present in a journal are searchable; older unnamed connections cannot
be recovered from their recording-local IDs.

For local files, open **Replays → Open round recordings**, choose one or more exported
files, then select a recording. Import is local; nothing uploads. The existing
viewer opens the embedded matching terrain and retains camera presets, contours,
exploration, and height exaggeration. Use Play/Pause, speed, timeline, and
Players/Bots filters. **Bots alive** shows whole-team counts and a step chart over
recorded coverage, with a cursor that follows playback and scrubbing. Click or
drag the chart to seek; the replay timeline also supports keyboard seeking.
Counts use recorded lifetimes and team/control metadata, including soldiers with
no position sample. Spawns add bots, all removals subtract them, and player
takeover excludes the controlled soldier until it becomes a bot again. Position
gaps and map filters do not change the totals. Late/incomplete recordings cover
only the recorded portion; these counts do not reconstruct earlier casualties.
Enable **Trails so far** to see cumulative team-colored
paths, or **Movement heatmap so far** for time spent through the current cursor.
Both overlays follow playback and backward scrubbing in the selected recording.
Use **Squad** (team + recorded commander ownership) and **Soldier** (individual
lifetime ID) to focus the arrows and both overlays. Unassigned soldiers are grouped
by team. Ownership/control changes apply at their recorded times; paths stop at
death and never bridge missing snapshots or large gaps. Completed trails remain
visible after death. Enable **Bot deaths** for persistent team-colored X markers
that appear at each recorded death time. They use the bot's last observed x/y/z
position (raised above terrain for visibility), without extrapolation. A marker
can be displaced from the actual death location, especially after a sampling gap.
Only explicit `death` removals of bot-controlled soldiers are marked; despawns,
reused agent IDs, deaths without a position sample, and player-controlled deaths
are excluded. Markers respect the Bots, Squad and Soldier filters and disappear
when rewinding before their death time. Toggling them preserves their history.
Paths interpolate between recorded positions; they do not
reconstruct exact footsteps. Squares identify infantry, circles identify artillery,
and triangles identify cavalry, including dismounted cavalry when its class or
category is recorded. White rings identify player-controlled soldiers. Enable
**Player names** to show labels above visible player units in the 3D view; older
recordings without names show player IDs. Labels follow the timeline and filters.
The readout shows elapsed round time, actual
coverage, incomplete status and synthetic labels. Switching view releases GPU
resources; Clear recordings releases the imported data.

Choose **Follow soldier** to use the on-foot camera at a soldier's recorded
position and facing. This selection is independent of the overlay filters. The
camera follows playback and timeline scrubbing at true terrain scale; the followed
soldier's arrow is hidden so it does not obstruct the view. Walking, drag-look,
and minimap relocation are disabled while following. Escape, **Exit soldier view**,
or **Free camera** restores the overview; **Explore on foot** switches to free
walking. If the soldier dies or is removed, the camera holds the last recorded
position and facing while playback continues. Gaps also hold the last known pose;
following resumes when samples return. Before the soldier's first sample, the
camera waits in the overview. Rewinding resolves the pose from the selected time.
Positions and facing are sampled approximations, including the death location.

### Share a replay as MP4

Select overlays and filters, position the camera, then choose **Export MP4**.
The preview includes the map on the left and whole-team army stats on the right.
Choose **Current view** to keep your camera framing (or follow the selected
soldier), or **Full-map overhead** to fit the map without following. Names, trails,
deaths, heatmap, transparency, and terrain appearance use the settings captured
when opening the preview. Close and reopen it to capture new viewer settings.

Set start/end times in round seconds, speed, and 1080p or 720p resolution. Scrub
the preview before choosing **Save MP4…** and a destination. Exports are silent,
30 fps H.264 MP4. Frames have explicit video timestamps, so rendering may run
faster or slower than playback without changing video speed. The interactive
replay stays paused at its original time and camera. Local imports also export;
publishing a recording first is not required.

The stats show bots alive, explicit recorded bot deaths since capture began,
and each team's share of surviving bots across assigned teams. Unassigned bots
are separate and excluded from that percentage; when none survive, the share
is shown as “—”. Player-controlled deaths, takeovers, and despawns are not bot
deaths. Unlike map death markers, death totals include events without a position
sample. Map filters do not change these totals. The strength chart reveals only
history through the current video time. Late/incomplete and synthetic recordings
remain labeled; unrecorded casualties and movement are never reconstructed.

Saving initially requires desktop Chrome/Edge over HTTPS or localhost, with
H.264 encoding available at the selected resolution. The preview checks support;
try 720p if 1080p is unavailable. Output streams directly to the selected file.
**Cancel export**, Escape, or closing the preview stops an export and discards
uncommitted file writes; an existing destination file is preserved on failure.
Automatic highlights and camera cuts are not included in this version.

## Many-round movement analysis

The on-screen heatmap shows only the selected recording up to the current
playback time, respecting player/bot, squad and soldier filters. Heat cells use
sampled linear intervals at half-cell spacing. A time index per cell supports
forward and backward scrubbing without rescanning all movement. Trail segments
are uploaded once and progressively revealed; only the current partial segment
per soldier changes during playback.

**Export all loaded rounds heatmap JSON** combines entire loaded recordings of
the exact same source version and synthetic/real category, respecting player/bot
filters. Squad and individual filters apply to the viewer only. Export heatmap
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
uv run --with playwright python tests/replay_links_smoke.py http://127.0.0.1:4175
uv run --with playwright python tests/replay_video_smoke.py http://127.0.0.1:4175
```

The checked-in `tests/fixtures/SYNTHETIC-tactical-demo.replay.json` is an explicitly
synthetic 320-soldier demo on checksum-matched measured terrain. Browser smoke
tests use it for cavalry, takeover, deaths, respawn, gap hiding, scrubbing, playback,
player/bot visibility, heatmap export, 4× exaggeration and resource disposal.
See `replay-validation.md` for observed costs and remaining acceptance work.

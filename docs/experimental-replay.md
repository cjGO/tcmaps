# Experimental replay

Open **Experimental replay** in Maproom, then open a raw `.jsonl` recording or
choose a local example and press **Open example**. The **Replays** tab also has
an **Open experimental recording** action. Imports stay in the browser. This
feature does not deploy the site, contact a game server, or change the recorder.

The bundled `experimental_replays/EXP-20261029T074033Z-1.jsonl` is used directly,
without a processed derivative or stable export bundle. Vite packages example
files as assets; it does not rewrite their contents. Other recordings can be
opened through the file picker without adding them to the repository.

## Available visualization

- Native XY/Z-up movement, centimetres converted to metres, interpolated between
  independently measured snapshots. Introduction and measured death/removal
  positions participate in interpolation. Omitted snapshots and gaps over ten
  seconds are not joined. Unpaired samples hold for at most five seconds.
- Separate soldier and explicit horse markers. No extra implied mount is drawn.
  Team colours use the recorded team, even if all agents have the same team.
  The supplied real sample has **82 team-0 lifetimes**, so its markers are blue.
- Shot flash/smoke markers at weapon transforms, impact markers at measured hit
  positions, victim highlighting, and measured death rings. Shot effects survive
  a shooter's same-time death. Death rings have a four-second display window.
- Artillery discharge and launch effects, projectile lifetimes and reconstructed
  motion along recorded animation commands, with replacement commands starting
  at the evaluated prior position. Bounce results reset to their measured pose.
  Projectiles stop at cleanup, or at recorded engine-instance reuse.
- Ground, water, prop and agent contacts; explosions and optional recorded-radius
  rings; fragment launch effects. Untracked midflight contacts stand alone.
- Play/pause, speeds from 0.25× to 60×, millisecond scrubbing, restart, filtered
  event stepping (including sequence ordering within one timestamp), layer
  toggles, full soldier trails, entity/projectile focus and click selection in 3D.
- Accumulating team-colored trails, persistent bot-death crosses, player rings and
  names, player/bot/horse visibility, unit/squad/soldier filters, per-type trail and
  death filters, opacity sliders, follow camera, bot-strength chart and cumulative
  movement heatmap with CSV export. Cavalry uses triangles, infantry squares,
  artillery circles; unknown roles use hollow diamonds.
- Paginated event search, raw fields, parent events, projectile launch attribution,
  separate engine attacker and projectile shooter, incoming damage and linked
  script overrides. Numeric troop, weapon, ammunition and engine IDs remain
  inspectable. Original map, build, fog and capability metadata remain intact.

Gold ticks, when enabled, show **native Z heading only**, not a verified bullet
vector. Fragment effects never create flight paths or landing points. Projectile
cleanup reason codes are preserved: 0 generic, 1 ground stop, 2 out of bounds,
3 explosive wall contact, 4 absorbed by wall, 5 explosive agent contact.

## Interpretation and unavailable features

Every recording is labelled **Captured from activation**. Capture elapsed time is
`t - header.start_ms`; the integer `round_start_seconds` field is retained only
as metadata. Complete means a finalized capture, not a full recorded round or
exhaustive combat coverage. Missing capabilities mean **not captured**.

The supplied captures omit player names, squad ownership and troop classes.
The display uses `Player #ID` for missing names. A bundled role table applies
only when the recorded `build.components["scripts.txt"]` hash matches its source.
It supplies declared infantry/cavalry/artillery roles for the provided build,
including dismounted cavalry. Other builds fall back to observed horse links
for mounted cavalry; missing roles remain unknown. Optional display metadata can supply names, classes and squad
labels without editing the original journal. Squad filtering is disabled until
squad labels are supplied. Incoming damage and script overrides
are not verified health loss. No health bars, bullet tracers, exact native
shot-to-hit links, inferred victims for shots, estimated fragment flights, or
manufactured impacts are provided. Probe events are inspectable without implying
ordinary installed native-missile coverage. Video export is explicitly disabled
because the stable exporter does not render experimental combat effects.

The actual recorder uses native Euler degrees, not stable replay millidegrees.
`map_editor/replay.lua` verifies a local +Y displacement against
`(-sin(yaw), cos(yaw))`; `docs/replay-schema.md` also documents the stable
recorder's negation of native Z rotation. Experimental unit heading therefore
uses positive native Z rotation (and negates it only for the shared facing
convention). Mixed-axis Euler orientation is not asserted: optional direction
ticks show yaw only. Heights everywhere in the experimental layer use the
existing `displayedHeight` transform, with no ground clamp on events/projectiles.

The installed native operation declaration in `lua/header_operations.py:943`
defines `prop_instance_animate_to_position` duration in 1/100 seconds. The
experimental builder's `patch_flight` instruments those exact target/duration
operands. A centisecond is therefore converted to 10 ms; a zero-duration command
sets the target immediately. Native easing/interpolation internals were not
available in these references. **Linear interpolation between recorded commands
is a viewer reconstruction, not verified native physics**, and it is described
as such in the legend. No ballistic equations are substituted. The supplied
recording contains no artillery; artillery verification here uses labelled
synthetic commands, not claims of engine-perfect trajectories.

Native fog is preserved but not applied: its complete semantics are not
established, and the real sample's `distance_m: -1` is a sentinel. Viewer haze is
identified as preview lighting. Original props, exact mesh intersections and
native weather are not reconstructed.

## Terrain identity

The real sample reports `map.available: false`, scene 139 and no public identity
or source. It opens on an **unaligned neutral reference grid**, with no terrain
substitution. Scene slots, current rotation and filenames never identify a
historical map.

Frozen fixed-map headers may omit `available` and `scene` and instead carry
`id`, `kind`, source and version, as in the installed `replay_maps.lua`. Automatic
matching requires exact recorded source hashes/terrain code, the SHA-256 source
version, and all supplied public/variant/revision fields. The asset itself is
verified against the topology manifest checksum and measured grid provenance.
Only terrain available in this site's topology manifest can match automatically.
Unavailable archived terrain still permits the neutral preview.

Selecting terrain from the dropdown is an explicit **UNVERIFIED terrain overlay**.
The original header is never modified. Returning to the neutral grid removes the
overlay. Walking controls are disabled on the reference grid because it is not
measured terrain. Camera orbit, zoom, presets and focus remain available.

## Validation, resources and determinism

`src/experimental-replay.js` is independent of stable import validation. The
browser parses and indexes in `experimental-replay-worker.js`; the stable journal
and bundle parsers/exporter remain unchanged. Validation rejects unsupported
schemas/versions, invalid types/non-finite numbers, unordered timestamps,
noncontiguous sequences, bad references, overlapping entity lifetimes, samples
outside lifetimes, invalid projectile commands, invalid parent/hit links, and
terminal count or sampled-position disagreements, with line-number diagnostics.

Limits are 64 MiB UTF-8, 250,000 records, 4,096 entity lifetimes, 2,000,000 sampled
positions and 1 MiB per line. Nested input is depth-bounded. Only an unterminated
last line can be omitted; it always marks the result incomplete, including when
it follows a terminal summary. Invalid interior records are errors. Source text
is rendered with `textContent`, never inserted as HTML.

Events are indexed by type/layer. Binary searches reconstruct active effects
from the current `(t, seq)` cursor; no skipped-event callbacks or wall-clock
effect timers are used. A balanced interval index finds active projectiles.
Rendering uses bounded instanced pools: 128 effects per family and 128 projectile markers by default, adjustable to
64 or 512, plus 8,192 short combat-path/orientation line segments. Soldier trails
use separate buffers sized to the indexed recorded intervals. Opaque low-poly markers avoid costly
transparent overdraw during volleys. At high density, the newest effects per family
and a bounded set of active projectiles are displayed. All source events and
counts remain in the inspector. Full soldier trails use indexed line buffers,
not a separate permanent mesh per event. GPU resources and viewer listeners
are disposed when changing recordings, terrain or tabs.

The parser can accept the full ceilings, but worst-case 64 MiB imports and
250,000-event inspector searches have not been browser-benchmarked. Main-thread
structured-clone transfer, search, and rendering can still cost time; limits are
not a claim that every device will sustain real-time playback at those ceilings.

## Provenance and tests

The real sample is byte-identical to the read-only installed capture, SHA-256:
`29b221ce5f3575dadd3f40857fbb77d738e8db439000791073bf4c0d4bab77ef`.
It has 498 records, 82 entity lifetimes, 26 snapshots, 1,391 sampled positions,
207 shots, 113 hits, 68 deaths and 131,893 ms of captured time, ending at
`round_end`. No artillery events are present.

The recorder, `validate.py`, README, VALIDATION notes and local-installation
manifest under the module's `deployment/experimental-recorder-20261029` were read
as references. The old staging notes predate installation. Historical probe
captures were not used as attribution goldens because their provenance notes
identify pre-fix builds. No game/server/module files or original logs were edited.

`tests/fixtures/SYNTHETIC-experimental-artillery.jsonl` is an artificial viewer
fixture generated by `tests/fixtures/experimental-fixtures.js`. It covers parent
relationships, same-time combat, incoming/override damage, engine agent and prop
reuse, attribution after shooter death, interrupted/zero-duration commands,
bounces, contacts, explosions, fragments and projectile cleanup.

Run `npm test` and `npm run build`. The focused parser/playback tests are included
in `npm test`. Browser checks use Playwright:

```
python tests/experimental_replay_smoke.py http://127.0.0.1:4180
python tests/replay_smoke.py http://127.0.0.1:4180
python tests/replay_video_smoke.py http://127.0.0.1:4180
```

Use a production preview for browser tests so source edits do not trigger a live
reload mid-test. The stress fixture is generated locally (not a real battle):

```
node --input-type=module -e "import {mkdirSync,writeFileSync} from 'node:fs'; import {experimentalFixture,journal} from './tests/fixtures/experimental-fixtures.js'; mkdirSync('tests/artifacts/experimental-replay',{recursive:true}); writeFileSync('tests/artifacts/experimental-replay/stress.jsonl',journal(experimentalFixture({soldiers:600,burst:800})));"
```

This adds 600 soldiers, one horse, a subsequent reused-agent lifetime, and an
800-projectile/fragment burst. The browser script writes screenshots and measured
frame/import statistics under ignored `tests/artifacts/experimental-replay/`.

Initial implementation validation (before the movement parity extension): the full unit suite passed **113 tests** on installed Node
22.23.2, including the existing stable replay/video tests unchanged. The default
Node 20 runtime cannot run several existing jsdom tests; the repository requests
Node 24, which is not installed in this workspace. The build and all prebuild
map/editor/topology checks pass using Node 22. Vite reports its large-chunk
warning. Focused experimental tests also pass after the fixed-map header and
projectile-contact lifetime checks.

Initial experimental browser acceptance passed in Chromium **153.0.8010.12** with
SwiftShader software WebGL, a 1440 × 1100 viewport and device scale 1. It covered
real import/play/pause/scrub/filter/event selection; unverified terrain selection
and return to the grid; switching to the stable 320-soldier fixture and back;
synthetic artillery/overrides; density changes; invalid and incomplete files;
capability-dependent controls, and rapid replacement of an in-progress import.
There were **no page errors**.

Measured on the generated 600-soldier/800-projectile burst, 120 frames, with
trails enabled and standard density (128 effects/projectiles per layer):

| Measurement | Median | p95 |
|---|---:|---:|
| Main-thread update + draw submission | 12.0 ms | 20.2 ms |
| Browser animation-frame interval, including software GPU work | 215.1 ms | 331.7 ms |

Real import through ready-to-play viewer took **4,098 ms** in the final run.
An earlier repetition measured 731 ms import time and 117.6 ms median frame
intervals; these software-renderer measurements vary with host load. These are
local observations, not portable performance guarantees. Software rendering of
this artificial burst remains below real-time smoothness (about 4.6 fps at the
final median interval). The Light density option reduces effect load further; actual
hardware GPU performance and maximum-size journals have not been benchmarked.
Earlier measurements with 512 transparent effects/projectiles had 894.7 ms
median frame intervals; opaque low-poly markers at 512 reduced that to 255.8 ms.
All diagnostic events remain available at every density.

The unchanged stable replay browser suite also passed against the built preview:
320 soldiers, cavalry, death markers, recording gaps, respawn, player filtering,
4× height, heatmap export, resource disposal and checksum rejection.

The unchanged stable video browser suite passed: real H.264 MP4 encode/decode,
frame timing, statistics composition, overhead and soldier-follow views,
cancellation, transactional write-failure handling, compatibility and disposal.
Experimental video export remains disabled independently of that stable path.


## Experimental movement parity

The standard replay implementation is unchanged by this extension. The
experimental tab reuses its read-only history and chart helpers through a
separate movement adapter; it retains the experimental event renderer and
millisecond/sequence cursor.

Soldier trails retain all valid recorded intervals from activation up to the
cursor, including dead units. They never connect across missing snapshots or
gaps longer than 10 seconds. Completed segments use a GPU buffer and binary
search draw range; partial segments are evaluated at the current time. Filters
rebuild the history cache. Heatmap occupancy integrates those same intervals
in 10 m cells; stationary valid intervals contribute time, missing intervals do
not. Horse trails are excluded from soldier occupancy. Projectile paths remain
current-command reconstructions. An indexing work limit reports an actionable
message to select fewer soldiers if a very large path exceeds its budget.

Persistent crosses represent confirmed bot deaths. Recorded death positions are
used directly; if absent, the last observed position is used, and no marker is
created without any position. Crosses obey event sequence when stepping within
a millisecond, persist after temporary combat flashes expire and disappear when
seeking before death. Unit classifications at death use the last prior sample.
Bot-strength totals use entity lifetimes rather than rendered positions; their
live counters also respect the sequence cursor. The chart aggregates events
within each millisecond. Follow mode holds the last recorded pose through gaps
and after removal and recomputes it on every seek. The shared follow camera
uses terrain as its floor, as in standard replay.

### Optional display metadata

Open **Names, unit classes & squads → Download display metadata**. The JSON
template contains this recording ID, its build ID, player entity IDs and troop
IDs. Add known values, then use **Load display metadata**. Original source rows,
combat references and raw inspection remain unchanged. Annotations last for the
loaded session (including tab switches); export them before clearing or opening
another recording. The UI labels these as user-supplied data, not recorder facts.

Example entry fields:

```json
{
  "entities": {
    "2": { "player_name": "Known player name", "squad": "First squad" }
  },
  "troops": {
    "101": { "unit_category": "cavalry" },
    "102": { "unit_category": "artillery" },
    "123": { "unit_category": "infantry" }
  }
}
```

Keep the template's `schema`, `version`, `recording_id` and `build_id` fields.
Files for other recordings/builds, unknown IDs, invalid roles and unsupported
fields are rejected. Accepted classes are infantry, cavalry, artillery and
unknown; entity overrides take precedence over troop entries. Player names can
only be attached to player entities. Unknown roles fall back to observed
mounting, otherwise stay unknown. Names are drawn as canvas text and option
labels, never HTML. No current troop file is assumed to match an old capture. The bundled lookup
comes from numeric troop declarations in the exact hash-matched `scripts.txt`,
not from `troops.txt` (whose checksum is absent from the headers).

`tests/fixtures/SYNTHETIC-experimental-display.json` is an explicitly synthetic
example for the bundled artillery fixture. It demonstrates names, squads and
all three roles without claiming those values were captured from the game.
Experimental MP4 remains disabled because the standard video exporter does
not include these combat effects. Heatmap CSV exports the current recording,
time and display filters; it does not merge unrelated experimental captures.


### Build-matched declared roles

`src/experimental-replay-roles.js` contains 414 static troop-role declarations
from `multiplayer_get_troop_class` in scripts build
`5b2c26a28ab972460acfb7ff63b4193cd2d2619bad04b4892ac43d85cc1ada02`.
`resolveDisplayMetadata` requires that exact recorded component hash before
using the lookup. Recorded explicit roles and imported overrides take priority.
The table supplies no player identities or squad ownership. The UI identifies
it as build-matched declared roles, not captured runtime class-slot values.

Reproduce it locally (read-only access to the source module):

```sh
python3 scripts/prepare-experimental-roles.py /path/to/matching/scripts.txt
```

The extractor reads the first class declaration block, respects explicit
exclusions and omits conflicting category declarations. One incomplete
one-operand equality is excluded because it cannot identify a troop. It does
not emulate the engine or infer dynamic slot changes. Other script hashes
require a reviewed mapping; the extractor rejects them. This provides shapes
for the supplied infantry, artillery and rocket troop IDs while preserving an
explicit unknown category for unsupported data.


### Final movement-parity validation

The complete unit suite passes **120 tests**, including **23 experimental tests**,
with Node 22.23.2. Build and prebuild map/editor/topology checks pass; the existing
large-chunk warning remains. Checksums of all stable replay modules and the
shared topology viewer match their values before this extension. The original
real capture also retains its SHA-256.

The expanded Chromium 153.0.8010.12 acceptance run passed with **no page errors**.
It covers build-matched classification, synthetic display metadata and player
labels, persistent death markers after effect flashes expire, rewind, player/bot
and squad filters, per-type death filtering, live/dead/rewound follow-camera
states, heatmap CSV download, strength totals, clearing annotations, stress
playback and switching into standard replay. The assertion timeout is 30 seconds
to accommodate software-GPU load during repeated imports.

The final run imported the real capture through viewer readiness in **1,454.7 ms**.
On the same 600-soldier/800-projectile synthetic burst, 120 frames at standard
128-effect density with full trails enabled, median update/draw submission was
**65.8 ms** (p95 **111.2 ms**); median frame interval was **69.3 ms** (p95
**122.1 ms**). These are software-renderer observations, not hardware-GPU or
maximum-size guarantees. The artificial burst remains below smooth real-time
playback. Results/screenshots are in the ignored artifact folder documented above.

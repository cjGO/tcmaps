# Replay validation — 23 October 2026

## Delivery status

Implementation and local browser workflow are complete. Nothing was installed
into the running server and no public website was deployed. Compiled changes
are in `deployment/replay-build-20261023-3`; existing compiled live files were
not replaced. Existing unrelated working-tree changes were preserved.

**Live rollout is not cleared.** The installed WSE2 runtime exhibited native Lua
stack corruption/access violations in exploratory probes while background
master-server requests repeatedly failed. Lua `pcall` cannot contain these native
crashes. Correctly preventing the private probe's master-listing registration
made the repeated-capture probes succeed, but this is not proof of safety with
public-server network/logging traffic. Resolve or validate that runtime condition
in a representative staging environment before enabling recording in production.

The NW initialization script re-enables master listing after startup configuration.
The final probe neutralizes that operation **in its private copy only**, and
asserts its engine log contains no master-listing request. No production network
configuration was changed. A concurrent logging/Lua interaction is an inference,
not a proven engine diagnosis. The upstream WSE Lua implementation accesses Lua
state on log events; WSE2's exact binary implementation was not audited:
[upstream Lua event implementation](https://github.com/Ruslan-700/WSE/blob/master/WSELib/WSELuaOperationsContext.cpp).

## Automated and browser checks

| Check | Result |
|---|---|
| Recorder LuaJIT fixtures, real temporary journal I/O | 14 passed |
| Startup identity/checksum fixture | 1 passed |
| Existing statistics / mapstats / map-saving suites | 25 / 12 / 37 passed |
| Compiled statistics hooks and six-argument replay timing bridge | Passed |
| Native source audit for reserved scratch `pos24` | Passed |
| Website JavaScript tests | 58 passed |
| Website production build | Passed; existing large-chunk warning remains |
| Existing terrain/editor WebGL regression | Passed |
| Replay browser acceptance | Passed, including synthetic lifecycle fixture and real-engine export |

Website checks ran under Node 22.23.2 in the existing WSL project. The package
declares Node 24; that exact Linux version was unavailable. Browser checks used
Chromium with SwiftShader, not a hardware-GPU performance benchmark.

The synthetic 320-soldier fixture tests formations, cavalry, human rings, takeover,
deaths (291 survivors), respawn (292), gap hiding, filters (9 players), play/pause,
scrubbing, heatmap export, 4× height scaling, checksum rejection and disposal.
The existing terrain smoke test now explicitly selects its intended Natural
baseline before comparing Elevation, matching the current product default.

## Real engine observations

Engine: WSE2 dedicated 1.174 / 1.1.4.9, June 11 2026; LuaJIT 2.1.1734355927.
Host: Windows 11, i7-1185G7, 16 GiB RAM, with other applications running.
All agents and horse/position/team/troop reads were real engine objects: 320
infantry plus 80 mounted soldiers. No connected human clients were used.

Command authorization/replies use fixture seams in the private recorder copy.
Cold captures use the actual mission clock. Warm timing injects 5-second offsets
to measure 100 bursts quickly, followed by five independent native callbacks.
Those offsets are **not** measured gameplay duration. Shareable copies are marked
`synthetic: true`; original journals are retained separately as `raw_replays/`.

Successful captures retained under the stage:

| Probe suffix | Capture | Observed cost |
|---|---|---|
| `eohukx` | 2 cold captures, then 101 snapshots; actual native round end with draw result | Cold 16/13 ms; 101-snapshot mean 4.74 ms, maximum 14 ms; cold command wall maximum 17 ms |
| `ilaluu` | 2 cold captures, then 106 snapshots including 5 independent native callbacks; manual stop | Cold 20/12 ms; warm 100-call mean 4.05 ms, maximum 10 ms; full 106-snapshot mean 4.09 ms; cold command wall maximum 21 ms |
| `btswyf` | Final harness passed with 106 snapshots and 5 independent callbacks, while browser/system work overlapped | Cold 32/23 ms; warm 100-call mean 13.47 ms, maximum 33 ms; full 106-snapshot mean 14.73 ms, maximum 124 ms; command maximum 33 ms |
| `uulxyc` | Repeated native run after guarding register errors; 106 snapshots; website build/system work overlapped | Cold 78/84 ms; warm 100-call mean 20.83 ms, maximum 47 ms; full 106-snapshot mean 20.80 ms; command maximum 93 ms |

The second run's original harness incorrectly expected exactly 101 snapshots;
its post-run assertion failed despite 106 complete snapshots. The harness now
accepts 101–106, since a real round end can precede the five subsequent callbacks.
It also checks actual sample counts and completion, not just a success marker.
Native scalar coordinate conversion and facing sign were compared with the
engine's vector API and agreed within the getters' quantization.

**Worst observed sampling pause over all exploratory runs: 204 ms.** That earlier
run used a superseded reader/harness under failed background network requests;
it must not be hidden by reporting only the successful quiet probes. Native
crashes and stalls have no finite “worst pause” guarantee. The successful run
figures above do not certify production latency or crash safety.

At 4.1–20.8 ms per 5-second sample, the measured warm work would average about
0.08–0.42% of elapsed time; it still arrives as a single burst, with **124 ms**
the maximum in the successful final harness. This is an
arithmetic estimate from a controlled test, not multiplayer CPU utilization.
The journal's historical `snapshot_cpu_us_*` names use `os.clock`; Windows CRT
reports elapsed time, whereas other Lua platforms can report CPU time.

## Storage and transfer

The 400-soldier, 101-snapshot capture was 1,281,196 bytes: approximately 12,165
bytes per full snapshot plus 52,556 bytes of metadata/events. At similar values,
one hour is about **8.35 MiB at 5 seconds**, or **4.18 MiB at 10 seconds**, plus
metadata/events. Lifetimes, coordinate digit lengths and control changes affect
actual size. JSONL repeats only compact numeric state; entity metadata is emitted
at introduction/change. No compression or long-lived all-round history in RAM is
required. Limits are 1 hour, 4,096 lifetimes, 64 MiB, and 256 KiB flush batches.
Additional 2,000,000-position and 250,000-record ceilings align server output
with the bounded browser reader; these termination paths were fixture-tested.

An actual map-1 journal was rejected because its installed SCO differs from the
website snapshot despite the same slot and recipe. The real map-2 capture exported
101 snapshots successfully against terrain SHA-256
`98dd258f93b1f289bd8f54021838ca505df0b8607158bb7a4d6ee9033f81a66e`.
This bundle was used for browser import/scrubbing alongside the synthetic fixture.

Offline aggregation of the synthetic fixture yielded 20,980 soldier-seconds;
passing the same recording twice still counted one round. Export/import is local,
with no unauthenticated filesystem endpoint. Journals survive deployment output
cleanup; bundles embed their exact measured terrain.

## Remaining acceptance work

- Resolve the observed runtime failure under background network/logging traffic;
  repeat on the intended production runtime with representative connected clients.
- Verify T/team/O chat consumption and admin denial with real clients. Automated
  tests execute both actual router prefixes, but the engine sender is a fixture.
- Observe real human takeover, deaths, respawns, dismounts and map transitions in
  a connected playtest. Their record semantics have focused fixture coverage.
- Exercise durable-storage interruption/power failure on deployment storage.
  Flushed JSONL prefix recovery is tested; `flush` is not an `fsync` guarantee.
- Generated terrain remains explicitly unavailable for 3D until matching saved,
  measured topology is supplied. Schema 1 does not auto-convert a generator ID
  into a saved-map asset. Preserve `/savemap` output and the journal.

Local artifacts: `deployment/replay-build-20261023-3/replay_probe_*/`, website
`tests/artifacts/replay/`, and the labelled fixtures under website `tests/fixtures/`.

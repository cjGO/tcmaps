import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRecordingLoader } from '../src/replay-recordings.js';
import { replaysPlugin } from '../scripts/replay-catalog.mjs';

test('catalogue loading is deferred, shares an in-flight request and caches success', async () => {
  let calls = 0, release;
  const rows = [{ id: 'one' }];
  const load = createRecordingLoader(() => { calls++; return new Promise(resolve => { release = resolve; }); });
  assert.equal(calls, 0);
  const a = load(), b = load();
  assert.equal(a, b); assert.equal(calls, 1);
  release({ default: rows });
  assert.equal(await a, rows); assert.equal(await load(), rows); assert.equal(calls, 1);
});

test('catalogue request failures can retry without reloading the application', async () => {
  let calls = 0;
  const load = createRecordingLoader(async () => {
    if (++calls === 1) throw new Error('Unavailable');
    return { default: [] };
  });
  await assert.rejects(load(), /Unavailable/);
  assert.deepEqual(await load(), []); assert.equal(calls, 2);
});

test('dev catalogue worker matches build metadata and recovers from a failed request', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'replay-startup-'));
  try {
    await mkdir(join(directory, 'replays'));
    const path = join(directory, 'replays', 'fixture.jsonl');
    await writeFile(path, 'invalid journal\n');
    const dev = replaysPlugin(); dev.configResolved({ root: directory, command: 'serve' });
    await assert.rejects(dev.load('\0virtual:replays'));
    const journal = await readFile(new URL('./fixtures/SYNTHETIC-experimental-artillery.jsonl', import.meta.url), 'utf8');
    await writeFile(path, journal);
    const build = replaysPlugin(); build.configResolved({ root: directory, command: 'build' });
    const [actual, expected] = await Promise.all([dev.load('\0virtual:replays'), build.load('\0virtual:replays')]);
    assert.equal(actual, expected);
    assert.match(actual, /SYNTHETIC-experimental-artillery/);
    assert.equal(await dev.load('\0virtual:replays'), actual);
    const closing = replaysPlugin(); closing.configResolved({ root: directory, command: 'serve' });
    const stopped = assert.rejects(closing.load('\0virtual:replays'), /worker exited/);
    await closing.closeBundle(); await stopped;
  } finally { await rm(directory, { recursive: true, force: true }); }
});

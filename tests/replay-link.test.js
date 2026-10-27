import test from 'node:test';
import assert from 'node:assert/strict';
import { readReplayLink, replayLink, replayWindow } from '../src/replay-link.js';

test('replay links preserve deployment paths and unrelated parameters and replace old playback state', () => {
  const href = replayLink('https://maps.example/app/?tab=rotation&replay=old&t=9&end=10&follow=2&source=chat#old', 'round/a & b', { t: 90.125, end: 120, follow: '42' });
  const url = new URL(href);
  assert.equal(url.pathname, '/app/');
  assert.equal(url.searchParams.get('source'), 'chat');
  assert.equal(url.searchParams.has('tab'), false);
  assert.equal(url.hash, '');
  assert.deepEqual(readReplayLink(href), { id: 'round/a & b', t: 90.125, end: 120, follow: '42' });
  assert.deepEqual(readReplayLink(replayLink(href, 'other')), { id: 'other', t: undefined, end: undefined, follow: undefined });
});

test('malformed times and soldier ids are ignored', () => {
  for (const value of ['', '-1', 'Infinity', 'NaN', '1e5', '0x10', ' 1 ']) {
    assert.equal(readReplayLink('https://maps.example/?t=' + encodeURIComponent(value)).t, undefined);
  }
  for (const value of ['0', '-1', '1.2', '9007199254740992', 'abc']) {
    assert.equal(readReplayLink('https://maps.example/?follow=' + value).follow, undefined);
  }
  assert.deepEqual(readReplayLink('https://maps.example/?replay=round&t=0&end=0'), { id: 'round', t: 0, end: undefined, follow: undefined });
});

test('round-relative link times clamp to recorded coverage using the journal clock', () => {
  const replay = { header: { round_start_ms: 500000 }, first: 510000, coverageEnd: 700000 };
  assert.deepEqual(replayWindow(replay, { t: 90, end: 120 }), { from: 590000, to: 620000 });
  assert.deepEqual(replayWindow(replay, { t: 0, end: 999 }), { from: 510000, to: 700000 });
  assert.deepEqual(replayWindow(replay, { t: 999, end: 1000 }), { from: 700000, to: 700000 });
  assert.deepEqual(replayWindow(replay, { t: 90, end: 20 }), { from: 590000, to: 700000 });
  assert.deepEqual(replayWindow(replay), { from: 510000, to: 700000 });
});

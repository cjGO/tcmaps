import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { recordedFog, createReplayFogControl } from '../src/replay-fog.js';

test('accepts exact captured distances and colours from both replay formats', () => {
  const fog = { distance_m: 444, colour_rgb: 16514043 };
  assert.deepEqual(recordedFog(fog), fog);
  assert.deepEqual(recordedFog({ ...fog, available: true, enabled: true, source: 'runtime_globals' }), fog);
  for (const value of [undefined, {}, { ...fog, distance_m: -1 }, { ...fog, distance_m: 0 },
    { ...fog, available: false }, { ...fog, enabled: false }, { ...fog, distance_m: Infinity },
    { ...fog, colour_rgb: -1 }, { ...fog, colour_rgb: 0x1000000 }]) assert.equal(recordedFog(value), null);
});

test('fog starts off, toggles, follows recording changes and clears unavailable fog', () => {
  const dom = new JSDOM('<div></div>');
  const previous = globalThis.document; globalThis.document = dom.window.document;
  try {
    const container = document.querySelector('div'), applied = [];
    const sync = createReplayFogControl(container, fog => applied.push(fog));
    const input = container.querySelector('input');
    const fog = { distance_m: 444, colour_rgb: 16514043 };
    sync({ fog });
    assert.equal(input.checked, false); assert.equal(input.disabled, false); assert.equal(applied.at(-1), null);
    input.click(); assert.deepEqual(applied.at(-1), fog);
    sync({ fog: { ...fog, distance_m: 697 } }); assert.equal(applied.at(-1).distance_m, 697);
    input.click(); assert.equal(applied.at(-1), null);
    input.click(); sync({ fog: { ...fog, distance_m: -1 } });
    assert.equal(applied.at(-1), null); assert.equal(input.checked, false); assert.equal(input.disabled, true);
    assert.match(container.textContent, /unavailable/);
    sync({ fog }); assert.equal(input.checked, false); assert.equal(applied.at(-1), null);
  } finally { globalThis.document = previous; dom.window.close(); }
});

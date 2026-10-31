import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createLinePresets } from '../src/editor-line-presets.js';
const key = 'map-editor.line-presets.v1';
function setup(saved) {
  const dom = new JSDOM('<div id="presets"></div>', {url:'https://editor.test'});
  const w = dom.window, $ = id => w.document.getElementById('line-preset-' + id);
  if (saved) w.localStorage.setItem(key, saved);
  let mix = [{asset:'pine', ratio:2, scale:{enabled:true, low:.7, high:1.3, fractions:[.3]}}, {asset:'rock', ratio:1}];
  const controls = createLinePresets(w.document.getElementById('presets'), [{name:'pine',label:'Pine'}, {name:'rock',label:'Rock'}], {
    getMix: () => mix, applyMix: entries => { mix = entries; },
  });
  return {w, $, setMix: value => {mix = value;}, getMix: () => mix, close() {controls.dispose(); w.close();}};
}
test('preset mixes save independently, reload, update, rename and delete without changing the live mix', () => {
  const s = setup(), {$,w} = s;
  try {
    $('name').value = 'Forest'; $('save').click();
    let saved = JSON.parse(w.localStorage.getItem(key));
    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0].entries[0].scale, {enabled:true, low:.7, high:1.3});
    s.setMix([{asset:'rock',ratio:3}]);
    $('name').value = 'Rocks'; $('save').click();
    assert.equal(JSON.parse(w.localStorage.getItem(key)).length, 2);
    $('select').value = saved[0].id; $('select').dispatchEvent(new w.Event('change'));
    assert.match($('preview').textContent, /Pine \(2\)/);
    $('load').click(); assert.equal(s.getMix().length, 2);
    s.getMix()[0].ratio = 9;
    assert.equal(JSON.parse(w.localStorage.getItem(key))[0].entries[0].ratio, 2);
    $('update').click(); assert.equal(JSON.parse(w.localStorage.getItem(key))[0].entries[0].ratio, 9);
    $('name').value = 'Woodland'; $('rename').click();
    assert.equal(JSON.parse(w.localStorage.getItem(key))[0].name, 'Woodland');
    const live = JSON.stringify(s.getMix()); $('delete').click();
    assert.equal(JSON.stringify(s.getMix()), live);
    assert.equal(JSON.parse(w.localStorage.getItem(key)).length, 1);
    const reopened = setup(w.localStorage.getItem(key));
    try { assert.match(reopened.$('select').textContent, /Rocks/); } finally { reopened.close(); }
  } finally {s.close();}
});
test('invalid and empty mixes cannot overwrite presets; missing assets are reported on load', () => {
  const saved = [{id:'one', name:'Mixed', entries:[{asset:'pine',ratio:1},{asset:'missing',ratio:2}]}, {id:'two', name:'Missing',entries:[{asset:'missing',ratio:1}]}];
  const s = setup(JSON.stringify(saved)), {$,w} = s;
  try {
    $('name').value = 'Empty'; s.setMix([]); $('save').click();
    assert.match($('status').textContent, /at least one/);
    $('select').value = 'one'; $('select').dispatchEvent(new w.Event('change')); $('load').click();
    assert.equal(s.getMix().length, 1); assert.match($('status').textContent, /Skipped 1/);
    $('name').value = 'missing'; $('rename').click(); assert.match($('status').textContent, /already used/);
    s.setMix([{asset:'pine',ratio:0}]); $('update').click();
    assert.match($('status').textContent, /positive ratio/);
    assert.equal(JSON.parse(w.localStorage.getItem(key))[0].entries.length, 2);
    const before = JSON.stringify(s.getMix()); $('select').value = 'two'; $('select').dispatchEvent(new w.Event('change')); $('load').click();
    assert.equal(JSON.stringify(s.getMix()), before); assert.match($('status').textContent, /None/);
  } finally {s.close();}
});
test('storage failures keep presets usable for the session and external updates sync', () => {
  const s = setup(), {$,w} = s;
  try {
    const proto = Object.getPrototypeOf(w.localStorage), original = proto.setItem;
    proto.setItem = () => {throw new Error('quota');};
    $('name').value = 'Session'; $('save').click();
    assert.match($('status').textContent, /session only/);
    s.setMix([]); $('load').click(); assert.equal(s.getMix().length, 2);
    proto.setItem = original;
    w.localStorage.setItem(key, JSON.stringify([{id:'external',name:'External',entries:[{asset:'rock',ratio:1}]}]));
    w.dispatchEvent(new w.StorageEvent('storage', {key}));
    assert.match($('select').textContent, /External/);
    assert.doesNotMatch($('select').textContent, /Session/);
  } finally {s.close();}
});

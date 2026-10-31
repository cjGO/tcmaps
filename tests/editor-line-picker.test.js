import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createLineAssetPicker } from '../src/editor-line-picker.js';

test('line picker discovers non-favorites, previews on focus, and preserves browse position and mix', () => {
  const dom = new JSDOM('<div id="picker"></div>');
  const doc = dom.window.document, host = doc.querySelector('#picker');
  const assets = [
    {name:'pine', label:'Pine tree', group:'Trees', preview:'/pine.webp'},
    {name:'rock', label:'Large rock', group:'Rocks'},
  ];
  const selection = new Map();
  let adds = 0;
  const picker = createLineAssetPicker(host, assets, {selection, onAdd(asset) {
    adds++; selection.set(asset.name, 1); picker.update(['pine']);
  }});
  const $ = id => doc.getElementById(id);
  try {
    picker.update(['pine']);
    assert.equal(host.querySelectorAll('.line-picker-row').length, 2);
    const rock = host.querySelector('[data-asset="rock"]');
    rock.querySelector('.line-picker-inspect').focus();
    assert.equal($('line-picker-caption').textContent, 'Large rock · Rocks');
    const button = rock.querySelector('.line-picker-add');
    button.focus(); button.click(); button.click();
    assert.equal(adds, 1);
    assert.equal(selection.get('rock'), 1);
    assert.equal(doc.activeElement, button);
    assert.equal(host.querySelector('[data-asset="rock"]'), rock);
    $('line-browse-favorites').click();
    assert.equal(host.querySelectorAll('.line-picker-row').length, 1);
    assert.equal(selection.has('rock'), true);
    picker.update([]);
    assert.match($('line-picker-list').textContent, /No favorites match/);
    assert.equal(selection.has('rock'), true);
    $('line-browse-all').click();
    $('line-asset-search').value = 'rock';
    $('line-asset-search').dispatchEvent(new dom.window.Event('input'));
    assert.equal(host.querySelectorAll('.line-picker-row').length, 1);
    selection.delete('rock'); picker.update([]);
    assert.equal(host.querySelector('.line-picker-add').textContent, '+ Add');
    $('line-asset-search').value = '';
    $('line-asset-category').value = 'Trees';
    $('line-asset-category').dispatchEvent(new dom.window.Event('change'));
    host.querySelector('.line-picker-inspect').focus();
    assert.equal(host.querySelector('#line-picker-image img').getAttribute('src'), '/pine.webp');
    host.querySelector('#line-picker-image img').dispatchEvent(new dom.window.Event('error'));
    assert.match($('line-picker-image').textContent, /Preview unavailable/);
  } finally { dom.window.close(); }
});

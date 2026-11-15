import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { attachSweepStats } from '../src/spawn-sweep-stats.js';

test('sweep sidebar combines variants, filters players and retains range between maps', () => {
  const dom = new JSDOM('<aside></aside>');
  try {
    const headers = ['player_count','result','duration_seconds','variant_id'];
    const rows = [['5','team1','60','source'],['10','team2','60','VarA'],['10','team1','60','VarB'],['10','draw','60','VarB']];
    const range = {min:1,max:30};
    const section = attachSweepStats(dom.window.document,'test_map_107',headers,rows,range);
    assert.equal(section.querySelector('[data-rounds]').textContent,'4');
    assert.equal(section.querySelector('[data-win]').textContent,'50.0%');
    const input = section.querySelector('[data-min]'); input.value='10'; input.dispatchEvent(new dom.window.Event('change'));
    assert.equal(section.querySelector('[data-rounds]').textContent,'3');
    assert.equal(section.querySelector('[data-win]').textContent,'33.3%');
    assert.equal(section.querySelectorAll('tbody tr').length,3);
    assert.match(section.querySelector('tbody').textContent,/VarA/);
    assert.match(section.querySelector('tbody').textContent,/VarB/);
    const next = attachSweepStats(dom.window.document,'test_map_108',headers,rows,range);
    assert.equal(next.querySelector('[data-min]').value,'10');
    assert.equal(next.querySelector('[data-win]').textContent,'33.3%');
    input.value='31'; input.dispatchEvent(new dom.window.Event('change'));
    assert.equal(section.querySelector('[data-rounds]').textContent,'0');
    assert.equal(section.querySelector('[data-win]').textContent,'—');
    assert.deepEqual(range,{min:31,max:31});
    input.value=''; input.dispatchEvent(new dom.window.Event('change'));
    assert.equal(input.value,'31');
    const empty=attachSweepStats(dom.window.document,'test_map_109',headers,[],range);
    assert.equal(empty.querySelector('[data-note]').textContent,'No recorded rounds for this map.');
  } finally { dom.window.close(); }
});

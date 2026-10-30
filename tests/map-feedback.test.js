import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { csvRows } from '../src/map-identity.js';
import { normalizeFeedback, summarizeFeedback, renderFeedback } from '../src/map-feedback.js';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const identities = JSON.parse(read('lib/map-feedback-identities.json'));

test('legacy feedback uses dated identities, preserves metadata and generated maps, and fails on unknown slots', () => {
  const old = identities.find(row => row.recorded_name === 'mp_custom_map_13');
  assert.equal(old.map_id, 'test_map_087');
  const input = `${old.timestamp},12,mp_custom_map_13,bad,"a,b"\n2026-10-28T12:00:00Z,12,test_map_114_VarA,good,name,village.json,revision\nnow,12,random_generated,good,name\n`;
  const rows = normalizeFeedback(input, identities);
  assert.equal(rows[0][2], 'test_map_087');
  assert.equal(rows[0][4], 'a,b');
  assert.deepEqual(rows[1].slice(2), ['test_map_114', 'good', 'name', 'village.json', 'revision']);
  assert.equal(rows[2][2], 'random_generated');
  assert.throws(() => normalizeFeedback('now,12,mp_custom_map_13,bad,name', identities), /Missing historical/);
});

test('processed feedback normalizes every fixed map and counts each vote', () => {
  const text = read('map_feedback.csv');
  const rows = csvRows(text);
  assert.ok(rows.length > 0);
  assert.ok(rows.every(row => !/mp_custom_map_/.test(row[2])));
  assert.deepEqual(normalizeFeedback(text, identities), rows);
  const summaries = summarizeFeedback(rows);
  for (const rating of ['good', 'bad']) {
    assert.equal([...summaries.values()].reduce((sum, row) => sum + row[rating], 0), rows.filter(row => row[3] === rating).length);
  }
});

test('feedback view shows counts, empty maps and map selection without publishing voter identities', () => {
  const doc = new JSDOM(read('index.html')).window.document;
  const root = doc.getElementById('rotation-feedback');
  const rows = [['time', 'player', 'test_map_1', 'good', 'private name'], ['time', 'player', 'test_map_1', 'bad', 'private name']];
  const maps = [{ map_id: 'test_map_1', filename: 'one.png' }, { map_id: 'test_map_2', filename: 'two.png' }];
  let selection;
  renderFeedback(root, summarizeFeedback(rows), maps, 'test_map_1', filename => { selection = filename; });
  assert.equal(root.querySelector('[data-feedback=good]').textContent, '1');
  assert.equal(root.querySelector('[data-feedback=bad]').textContent, '1');
  assert.equal(root.querySelector('[data-feedback=percent]').textContent, '50%');
  assert.equal(root.querySelector('[data-feedback=empty]').hidden, true);
  assert.equal(root.querySelectorAll('tbody tr').length, 2);
  root.querySelectorAll('tbody button')[1].click();
  assert.equal(selection, 'two.png');
  assert.ok(!root.textContent.includes('private name'));
  renderFeedback(root, summarizeFeedback(rows), maps.slice(1), 'test_map_2', () => {});
  assert.equal(root.querySelector('[data-feedback=good]').textContent, '0');
  assert.equal(root.querySelector('[data-feedback=percent]').textContent, '—');
  assert.equal(root.querySelector('[data-feedback=empty]').hidden, false);
  assert.equal(root.querySelectorAll('tbody tr').length, 1);
});

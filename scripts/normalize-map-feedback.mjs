import { readFile, writeFile } from 'node:fs/promises';
import { normalizeFeedback } from '../src/map-feedback.js';

const csv = new URL('../map_feedback.csv', import.meta.url);
const identities = JSON.parse(await readFile(new URL('../lib/map-feedback-identities.json', import.meta.url), 'utf8'));
const original = await readFile(csv, 'utf8');
const rows = normalizeFeedback(original, identities);
const quote = value => /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
const normalized = rows.map(row => row.map(quote).join(',')).join('\n') + '\n';
if (original !== normalized) await writeFile(csv, normalized);
console.log(`Normalized ${rows.length} feedback records using permanent map identities.`);

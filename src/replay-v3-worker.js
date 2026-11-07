import { parseExperimentalJournal } from './experimental-replay.js';
import { buildCombatIndex } from './replay-v3-model.js';
self.onmessage = ({ data }) => {
  try { const replay = parseExperimentalJournal(data); self.postMessage({ replay, combat: buildCombatIndex(replay) }); }
  catch (error) { self.postMessage({ error: error.message }); }
};

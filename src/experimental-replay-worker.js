import { parseExperimentalJournal } from './experimental-replay.js';
self.onmessage = ({ data }) => {
  try { self.postMessage({ replay: parseExperimentalJournal(data) }); }
  catch (error) { self.postMessage({ error: error.message }); }
};

import { parentPort, workerData } from 'node:worker_threads';
import { combinedReplayCatalog } from './replay-catalog.mjs';

parentPort.postMessage(await combinedReplayCatalog(new URL(workerData)));

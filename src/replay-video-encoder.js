import { VIDEO_FPS } from './replay-video-model.js';

const bitrateFor = height => height === 720 ? 5_000_000 : 9_000_000;
const media = () => import('mediabunny');

export async function checkMp4Support({ width, height }) {
  if (!window.isSecureContext || typeof window.showSaveFilePicker !== 'function') return 'Save MP4 requires desktop Chrome or Edge over HTTPS (or localhost).';
  if (typeof VideoEncoder === 'undefined') return 'This browser does not provide video encoding. Open this replay in desktop Chrome or Edge.';
  const { canEncodeVideo } = await media();
  const supported = await canEncodeVideo('avc', { width, height, frameRate: VIDEO_FPS, bitrate: bitrateFor(height) });
  return supported ? '' : `H.264 encoding is unavailable at ${height}p on this device. Try 720p or another desktop Chrome/Edge device.`;
}

// The caller owns the file transaction: only success commits it. In particular,
// output.cancel() closes its target, so forward writes through a non-committing
// stream and abort the actual file on cancellation/error.
export async function encodeMp4({ canvas, schedule, render, file, signal, onProgress }) {
  let output, writable, committed = false;
  try {
    signal.throwIfAborted();
    const { Output, Mp4OutputFormat, StreamTarget, CanvasSource } = await media();
    signal.throwIfAborted();
    writable = await file.createWritable();
    const target = new StreamTarget(new WritableStream({
      write(chunk) { signal.throwIfAborted(); return writable.write(chunk); },
    }), { chunked: true, chunkSize: 1024 * 1024 });
    output = new Output({ format: new Mp4OutputFormat({ fastStart: 'reserve' }), target });
    const source = new CanvasSource(canvas, { codec: 'avc', bitrate: bitrateFor(canvas.height), keyFrameInterval: 2 });
    output.addVideoTrack(source, { maximumPacketCount: schedule.frames });
    await output.start();
    let lastYield = performance.now();
    for (let i = 0; i < schedule.frames; i++) {
      signal.throwIfAborted();
      const frame = schedule.frame(i);
      render(frame.t);
      await source.add(frame.timestamp, frame.duration);
      onProgress((i + 1) / schedule.frames);
      // Give Cancel and paint a turn even when encoder promises resolve promptly.
      if (performance.now() - lastYield > 40) {
        await new Promise(resolve => setTimeout(resolve, 0)); lastYield = performance.now();
      }
    }
    signal.throwIfAborted(); await output.finalize(); signal.throwIfAborted();
    await writable.close(); committed = true;
  } finally {
    try { if (output && output.state !== 'finalized') await output.cancel(); }
    finally { if (writable && !committed) await writable.abort().catch(() => {}); }
  }
}

import { createTopologyViewer } from './topology-viewer.js';
import { createReplayLayer } from './replay-layer.js';
import { soldierViewAt } from './tactical-replay.js';
import { createExperimentalLayer } from './experimental-replay-layer.js';
import { experimentalViewAt } from './experimental-replay-presentation.js';
import { replayVariantAssets } from './replay-variant-assets.js';
import { createVariantLayer } from './rotation-variant-layer.js';
import { videoStatsHistory, videoStatsAt, videoTeamColor, videoTeamLabel, videoClock, videoReplayModel, isExperimentalVideo } from './replay-video-model.js';

// Both the preview and the encoder consume this exact composition.
export function createVideoRenderer({ replay: recording, data, view, overlays, cameraMode, width, height, speed, mapLabel, reference = false, metadata }, onError) {
  const experimental = isExperimentalVideo(recording), replay = videoReplayModel(recording);
  const host = document.createElement('div'); host.className = 'replay-video-offscreen';
  host.inert = true; host.setAttribute('aria-hidden', 'true'); document.body.append(host);
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  canvas.setAttribute('aria-label', 'MP4 preview: map and live team statistics');
  const ctx = canvas.getContext('2d', { alpha: false }), stats = videoStatsHistory(recording);
  let viewer, layer, variantLayer, loaded = false, disposed = false, following = false;
  const followId = cameraMode === 'current' ? (experimental ? overlays.follow : overlays.followSoldier) : '';
  const initialView = followId ? view.overview || view : view;
  const aspect = view.camera.isPerspectiveCamera ? view.camera.aspect : (view.camera.right - view.camera.left) / (view.camera.top - view.camera.bottom);
  try {
    viewer = createTopologyViewer(host, data, onError, { renderOnly: true, referenceGrid: reference, width: width * .75, height: height * 876 / 1080 });
    viewer.applyViewState(initialView);
    if (cameraMode === 'overhead') viewer.preset('overhead');
    layer = experimental ? createExperimentalLayer(viewer, data, recording, { reference, metadata }) : createReplayLayer(viewer, data, replay);
  } catch (error) { viewer?.dispose(); host.remove(); throw error; }

  // A separate export scene needs its own meshes and textures. Finish loading
  // the recorded placement revision before previewing or encoding any frames.
  const ready = (async () => {
    const variant = !reference && await replayVariantAssets(recording.header.map);
    if (disposed) return;
    if (variant) {
      variantLayer = createVariantLayer(viewer, data, variant.document);
      await variantLayer.ready;
    }
    if (!disposed) loaded = true;
  })();

  function text(value, x, y, size = 24, color = '#e8eef3', weight = 400, maxWidth) {
    ctx.font = `${weight} ${size}px system-ui, sans-serif`; ctx.fillStyle = color;
    ctx.fillText(String(value), x, y, maxWidth);
  }
  function chart(t) {
    const x0 = 1480, x1 = 1878, y0 = 754, y1 = 906, history = stats.alive;
    const x = time => x0 + (time - replay.first) / Math.max(1, replay.coverageEnd - replay.first) * (x1 - x0);
    const y = count => y1 - count / history.max * (y1 - y0);
    text('BOTS ALIVE OVER TIME', x0, 726, 19, '#9babb9', 600);
    ctx.strokeStyle = '#344453'; ctx.lineWidth = 1;
    for (const value of [0, history.max]) {
      ctx.beginPath(); ctx.moveTo(x0, y(value)); ctx.lineTo(x1, y(value)); ctx.stroke();
      text(value, x0, y(value) - 8, 16, '#9babb9');
    }
    history.teams.forEach((team, i) => {
      ctx.beginPath(); ctx.strokeStyle = videoTeamColor(team); ctx.lineWidth = 3;
      ctx.setLineDash(team === 1 ? [9, 5] : team < 0 ? [3, 5] : []);
      ctx.moveTo(x0, y(history.points[0].counts[i]));
      let previous = history.points[0].counts[i];
      for (const point of history.points.slice(1)) {
        if (point.t > t) break;
        ctx.lineTo(x(point.t), y(previous)); ctx.lineTo(x(point.t), y(point.counts[i])); previous = point.counts[i];
      }
      const now = videoStatsAt(stats, t).find(row => row.team === team).alive;
      ctx.lineTo(x(t), y(now)); ctx.stroke(); ctx.setLineDash([]);
    });
    ctx.strokeStyle = '#ffffff90'; ctx.beginPath(); ctx.moveTo(x(t), y0); ctx.lineTo(x(t), y1); ctx.stroke();
    text(videoClock(replay.first - replay.header.round_start_ms), x0, 934, 17, '#9babb9');
    text(videoClock(replay.coverageEnd - replay.header.round_start_ms), x1 - 58, 934, 17, '#9babb9');
  }
  function render(t) {
    if (disposed) throw new Error('Export renderer has been closed.');
    if (!loaded) throw new Error('Map assets are still loading.');
    if (followId) {
      const pose = experimental ? experimentalViewAt(recording.tracks.get(Number(followId)), t) : soldierViewAt(replay.tracks.get(Number(followId)), t, replay);
      if (pose) { viewer.renderSoldier(pose, aspect); following = true; }
      else if (following) { viewer.applyViewState(initialView); following = false; }
    }
    // Copy immediately after WebGL draws; its drawing buffer need not be preserved.
    layer.update({ ...overlays, followSoldier: followId, follow: followId, t, seq: Infinity });
    ctx.setTransform(width / 1920, 0, 0, height / 1080, 0, 0);
    ctx.fillStyle = '#101d29'; ctx.fillRect(0, 0, 1920, 1080);
    ctx.drawImage(viewer.canvas, 0, 88, 1440, 876);
    text(mapLabel, 28, 39, 29, '#f1f5f8', 650, 1020);
    text(`${experimental ? 'Capture' : 'Round'} ${videoClock(t - replay.header.round_start_ms)}  ·  ${speed}× speed`, 28, 70, 21, '#adbfcc');
    text(cameraMode === 'overhead' ? 'FULL-MAP OVERHEAD' : followId ? `FOLLOWING #${followId}` : 'CURRENT VIEW', 1090, 53, 17, '#adbfcc', 600, 320);
    ctx.fillStyle = '#172735'; ctx.fillRect(1440, 0, 480, 1080);
    text('LIVE ARMY STATS', 1476, 47, 25, '#f1f5f8', 650);
    text('Whole teams · independent of map filters', 1476, 81, 17, '#adbfcc', 400, 408);
    const rows = videoStatsAt(stats, t);
    if (rows.length <= 3) {
      const cardHeight = Math.min(220, 570 / rows.length);
      rows.forEach((row, i) => {
        const y = 116 + i * cardHeight, color = videoTeamColor(row.team);
        ctx.fillStyle = color; ctx.fillRect(1476, y, 4, cardHeight - 24);
        text(videoTeamLabel(row.team), 1494, y + 25, 26, color, 650);
        text(row.alive, 1494, y + 104, 68, '#f5f7fa', 700);
        text('alive', 1780, y + 100, 23, '#adbfcc');
        text(`${row.deaths} recorded deaths`, 1494, y + 144, 22, '#d2dde5');
        text(row.share === null ? '— share of surviving bots' : `${(row.share * 100).toFixed(1)}% of surviving bots`, 1494, y + 177, 22, color, 550);
      });
    } else {
      text('TEAM             ALIVE    DEAD    SHARE', 1476, 128, 18, '#adbfcc', 600);
      rows.forEach((row, i) => {
        const y = 167 + i * 31, color = videoTeamColor(row.team);
        text(videoTeamLabel(row.team), 1476, y, 20, color, 600);
        text(row.alive, 1640, y, 20); text(row.deaths, 1720, y, 20);
        text(row.share === null ? '—' : `${(row.share * 100).toFixed(1)}%`, 1795, y, 20);
      });
    }
    chart(t);
    text('Deaths since recording began.', 1476, 981, 18, '#adbfcc');
    text('Takeovers / despawns are not deaths.', 1476, 1011, 18, '#adbfcc');
    text('Share excludes unassigned bots.', 1476, 1041, 18, '#adbfcc');
    text('Blue: Team 1  ·  Red: Team 2  ·  Yellow: other / unassigned', 28, 998, 21, '#d1dde5');
    text(experimental ? 'Gold: shots · Pink: hits · Orange: artillery · Teal: contacts · Purple: projectiles / fragments' : '■ Infantry   ● Artillery   ▲ Cavalry   ○ Player   × Bot death', 28, 1030, 21, '#adbfcc', 400, 1384);
    const flags = [replay.header.synthetic && 'SYNTHETIC', recording.incomplete && 'INCOMPLETE', experimental && 'V2 · CAPTURED FROM ACTIVATION',
      !experimental && replay.first > replay.header.round_start_ms && `LATE START ${videoClock(replay.first - replay.header.round_start_ms)}`].filter(Boolean);
    text(`${flags.length ? flags.join(' · ') + ' · ' : ''}${replay.header.sample_interval_ms / 1000}s samples · interpolated movement · gaps are not reconstructed`, 28, 1060, 18, flags.length ? '#edc66c' : '#adbfcc', 400, 1384);
    return canvas;
  }
  return { canvas, ready, get loaded() { return loaded; }, render, dispose() { if (disposed) return; disposed = true; variantLayer?.dispose(); layer.dispose(); viewer.dispose(); host.remove(); } };
}

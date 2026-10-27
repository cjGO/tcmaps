const seconds = value => typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value)) ? Number(value) : undefined;

// Times in links are seconds from round start, independent of the journal clock.
export function readReplayLink(href) {
  const params = new URL(href).searchParams;
  const t = seconds(params.get('t'));
  const end = seconds(params.get('end'));
  const follow = params.get('follow');
  return { id: params.get('replay'), t, end: end > (t ?? 0) ? end : undefined,
    follow: /^[1-9]\d*$/.test(follow ?? '') && Number.isSafeInteger(Number(follow)) ? follow : undefined };
}

export function replayLink(href, id, { t, end, follow } = {}) {
  const url = new URL(href);
  for (const key of ['tab', 'replay', 't', 'end', 'follow']) url.searchParams.delete(key);
  url.hash = '';
  url.searchParams.set('replay', id);
  if (Number.isFinite(t) && t >= 0) url.searchParams.set('t', String(Math.round(t * 1000) / 1000));
  if (Number.isFinite(end) && end > (t ?? 0)) url.searchParams.set('end', String(Math.round(end * 1000) / 1000));
  if (/^[1-9]\d*$/.test(String(follow ?? ''))) url.searchParams.set('follow', follow);
  return url.href;
}

export function replayWindow(replay, { t, end } = {}) {
  const start = replay.header.round_start_ms;
  const clamp = ms => Math.max(replay.first, Math.min(replay.coverageEnd, ms));
  const from = t === undefined ? replay.first : clamp(start + t * 1000);
  const to = end === undefined ? replay.coverageEnd : clamp(start + end * 1000);
  return { from, to: to > from ? to : replay.coverageEnd };
}

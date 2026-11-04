// Negative native sentinel values do not establish a usable fog distance.
export function recordedFog(fog) {
  if (!fog || fog.available === false || fog.enabled === false ||
      !Number.isFinite(fog.distance_m) || fog.distance_m <= 0 ||
      !Number.isInteger(fog.colour_rgb) || fog.colour_rgb < 0 || fog.colour_rgb > 0xffffff) return null;
  return { distance_m: fog.distance_m, colour_rgb: fog.colour_rgb };
}

export function createReplayFogControl(container, apply) {
  const label = document.createElement('label');
  const input = document.createElement('input'); input.type = 'checkbox'; input.disabled = true;
  const caption = document.createTextNode('Recorded fog (unavailable)');
  label.append(input, caption); container.append(label);
  let fog = null;
  input.addEventListener('change', () => apply(input.checked ? fog : null));
  return header => {
    fog = recordedFog(header?.fog);
    input.disabled = !fog;
    if (!fog) input.checked = false;
    caption.textContent = fog ? `Recorded fog (${fog.distance_m} m)` : 'Recorded fog (unavailable)';
    label.title = fog ? 'Use recorded fog distance and colour (approximate game falloff).' : 'No usable recorded fog distance is available.';
    apply(input.checked ? fog : null);
  };
}

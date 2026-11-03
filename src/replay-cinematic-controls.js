import { cinematicSettings } from './replay-cinematic-camera.js';
import './replay-cinematic.css';

export function createCinematicControls(container, onChange, initial) {
  const fieldset = document.createElement('fieldset'); fieldset.className = 'replay-cinematic';
  fieldset.innerHTML = '<legend>Cinematic camera settings</legend><p>Follows opposing forces and recent casualties across the whole battle. Drag the view or press Escape to return to manual control.</p>';
  const settings = cinematicSettings(initial), inputs = {};
  for (const [key, label, min, max, step, unit] of [
    ['orbit', 'Orbit speed', -6, 6, .5, '°/s'], ['elevation', 'Viewing angle', 25, 75, 1, '°'],
    ['context', 'Terrain context', 0, 100, 5, '%'], ['smoothing', 'Smoothing', 2, 20, 1, ' replay seconds'],
  ]) {
    const row = document.createElement('label'), input = document.createElement('input'), output = document.createElement('output');
    input.type = 'range'; Object.assign(input, { min, max, step, value: settings[key] }); input.dataset.cinematic = key;
    const refresh = () => { output.value = `${input.value}${unit}`; };
    input.addEventListener('input', () => { refresh(); onChange?.(); }); refresh();
    row.append(label, input, output); fieldset.append(row); inputs[key] = input;
  }
  const note = document.createElement('p'); note.textContent = 'More terrain context widens toward the full map. Negative orbit reverses direction; 0 holds the angle. Orbit speed is per playback second.'; fieldset.append(note);
  container.append(fieldset);
  return { element: fieldset, value: () => cinematicSettings(Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value]))) };
}

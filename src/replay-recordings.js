// One on-demand catalogue shared by replay viewers and terrain heatmaps.
// A failed request can be retried without restarting the rest of the app.
export function createRecordingLoader(importCatalog = () => import('virtual:replays')) {
  let pending;
  return () => pending ??= importCatalog().then(module => module.default).catch(error => {
    pending = null;
    throw error;
  });
}
export const loadRecordings = createRecordingLoader();

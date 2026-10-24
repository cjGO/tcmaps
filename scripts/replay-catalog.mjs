import { readdir, readFile } from 'node:fs/promises';

// Keep recordings as separate assets so opening the app never downloads every round.
export async function replayCatalog(directory) {
  const files = await readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  return Promise.all(files.filter(name => name.endsWith('.replay.json')).sort().reverse().map(async filename => {
    const bundle = JSON.parse(await readFile(new URL(filename, directory), 'utf8'));
    const header = JSON.parse(bundle.journal.slice(0, bundle.journal.indexOf('\n')));
    return { filename, id: header.id, map: header.map.id, created: header.created_utc, synthetic: header.synthetic,
      url: `replays/${encodeURIComponent(filename)}` };
  }));
}

export function replaysPlugin() {
  let root, catalog;
  return {
    name: 'replay-catalog',
    configResolved(config) { root = new URL('./replays/', `file://${config.root}/`); },
    resolveId(id) { if (id === 'virtual:replays') return '\0virtual:replays'; },
    async load(id) {
      if (id !== '\0virtual:replays') return;
      catalog = await replayCatalog(root);
      return `export default ${JSON.stringify(catalog)}`;
    },
    async generateBundle() {
      for (const replay of catalog || await replayCatalog(root)) {
        this.emitFile({ type: 'asset', fileName: `replays/${replay.filename}`, source: await readFile(new URL(replay.filename, root)) });
      }
    },
  };
}

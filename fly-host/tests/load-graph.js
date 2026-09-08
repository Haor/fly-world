import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

export function loadLocalGraph() {
  const root = new URL('../public/data/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', root)));
  const neurons = JSON.parse(gunzipSync(readFileSync(new URL(manifest.metadata, root))));
  const graph = { n: manifest.neurons, neurons, sign: Int32Array.from(neurons, r =>
    ['dopamine', 'octopamine', 'serotonin'].includes(r[4]) ? 1 : r[5]) };
  for (const array of manifest.arrays) {
    const bytes = Buffer.concat(array.parts.map(p => gunzipSync(readFileSync(new URL(p.file, root)))));
    graph[array.name] = new Uint32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  }
  return graph;
}

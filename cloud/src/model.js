import { readFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { endianness } from 'node:os';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export async function loadModel(directory) {
  if (endianness() !== 'LE') throw Error('Only little-endian hosts are supported');
  const bytes = await readFile(resolve(directory, 'manifest.json'));
  const manifest = JSON.parse(bytes);
  if (manifest.schema !== 'fly-world-graph/1' || !manifest.model || !manifest.files)
    throw Error('Unsupported graph manifest');
  async function file(name) {
    const entry = manifest.files[name];
    if (!entry || basename(entry.file) !== entry.file || !/^[a-f0-9]{64}$/.test(entry.sha256))
      throw Error(`Invalid file entry: ${name}`);
    const data = await readFile(resolve(directory, entry.file));
    if (data.length !== entry.bytes || sha(data) !== entry.sha256) throw Error(`Graph checksum failed: ${name}`);
    return data;
  }
  const neurons = JSON.parse(gunzipSync(await file('neurons')));
  const n = neurons.length, identities = new Set();
  if (!n || n !== manifest.model.neurons || n > 5_000_000) throw Error('Invalid graph size');
  for (const row of neurons) {
    if (!Array.isArray(row) || !/^\d+$/.test(row[0]) || identities.has(String(row[0])) || ![-1,0,1].includes(row[5]))
      throw Error('Invalid or duplicate body annotation');
    identities.add(String(row[0]));
  }
  const graph = {n, neurons};
  for (const name of ['offsets','sources','counts']) {
    const data = await file(name);
    if (data.length % 4) throw Error('Invalid array byte length');
    const shared = new SharedArrayBuffer(data.length);
    new Uint8Array(shared).set(data); graph[name] = new Uint32Array(shared);
  }
  if (graph.offsets.length !== n+1 || graph.offsets[0] !== 0 || graph.offsets[n] !== graph.sources.length ||
    graph.sources.length !== graph.counts.length || graph.sources.length !== manifest.model.edges)
    throw Error('Invalid CSR dimensions');
  for (let i=1;i<=n;i++) if(graph.offsets[i]<graph.offsets[i-1])throw Error('Nonmonotonic CSR offsets');
  let synapses=0;
  for (let e=0;e<graph.sources.length;e++) {
    if(graph.sources[e]>=n || graph.counts[e]===0)throw Error('Invalid CSR edge');
    synapses+=graph.counts[e];
  }
  if(synapses!==manifest.model.synapses)throw Error('Synapse total mismatch');
  const signBuffer = new SharedArrayBuffer(n*4);
  graph.sign = new Int32Array(signBuffer);
  neurons.forEach((row,i)=>{graph.sign[i]=['dopamine','octopamine','serotonin'].includes(row[4])?1:row[5];});
  return {graph, model:{...manifest.model,connectomeSha256:sha(bytes)}, provenance:manifest.provenance};
}

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

/** Load the bundled retained graph for the same service protocol as the full graph. */
export async function loadRetained(directory) {
  const bytes=await readFile(resolve(directory,'manifest.json')), manifest=JSON.parse(bytes);
  const neurons=JSON.parse(gunzipSync(await readFile(resolve(directory,manifest.metadata))));
  const graph={n:neurons.length,neurons,sign:Int32Array.from(neurons,r=>['dopamine','octopamine','serotonin'].includes(r[4])?1:r[5])};
  for(const array of manifest.arrays) {
    const shared=new SharedArrayBuffer(array.length*4),dest=new Uint8Array(shared);let offset=0;
    for(const part of array.parts) {
      const compressed=await readFile(resolve(directory,part.file));
      if(createHash('sha256').update(compressed).digest('hex')!==part.sha256)throw Error('Retained graph checksum failed');
      const data=gunzipSync(compressed);dest.set(data,offset);offset+=data.length;
    }
    if(offset!==dest.length)throw Error('Retained graph size mismatch');
    graph[array.name]=new Uint32Array(shared);
  }
  return {graph,model:{id:'malecns-v1.0-retained',scope:'retained',coverage:'classified-annotated-bodies',neurons:graph.n,
    edges:graph.sources.length,synapses:manifest.synapses,dtMs:.1,connectomeSha256:createHash('sha256').update(bytes).digest('hex')},directory,format:'retained'};
}

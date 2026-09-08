import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {loadLocalGraph} from './load-graph.js';
const root=new URL('../public/data/',import.meta.url),manifest=JSON.parse(readFileSync(new URL('manifest.json',root)));
for(const a of manifest.arrays)for(const p of a.parts)assert.equal(createHash('sha256').update(readFileSync(new URL(p.file,root))).digest('hex'),p.sha256);
const g=loadLocalGraph();assert.equal(g.neurons.length,g.n);assert.equal(new Set(g.neurons.map(r=>String(r[0]))).size,g.n);
assert.equal(g.offsets.length,g.n+1);assert.equal(g.offsets[0],0);assert.equal(g.offsets[g.n],g.sources.length);assert.equal(g.sources.length,g.counts.length);
for(let i=1;i<g.offsets.length;i++)assert(g.offsets[i]>=g.offsets[i-1]);
let total=0;for(let i=0;i<g.sources.length;i++){assert(g.sources[i]<g.n);assert(g.counts[i]>0);total+=g.counts[i];}
assert.equal(total,manifest.synapses);
console.log(JSON.stringify({result:'PASS',neurons:g.n,edges:g.sources.length,synapses:total,checksumParts:manifest.arrays.reduce((n,a)=>n+a.parts.length,0)}));

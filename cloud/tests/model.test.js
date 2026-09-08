import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { loadModel } from '../src/model.js';

test('model loading verifies checksums, IDs and incoming CSR before serving',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'fly-model-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const manifest={schema:'fly-world-graph/1',model:{neurons:2,edges:1,synapses:3},files:{}};
  for(const [name,data] of Object.entries({neurons:gzipSync(JSON.stringify([['1','LC9',null,'L','acetylcholine',1],['2','MN9',null,'R','gaba',-1]])),
    offsets:Buffer.from(new Uint32Array([0,0,1]).buffer),sources:Buffer.from(new Uint32Array([0]).buffer),counts:Buffer.from(new Uint32Array([3]).buffer)})) {
    await writeFile(join(dir,name),data);manifest.files[name]={file:name,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')};
  }
  await writeFile(join(dir,'manifest.json'),JSON.stringify(manifest));
  const loaded=await loadModel(dir);assert.equal(loaded.graph.n,2);assert.equal(loaded.model.connectomeSha256.length,64);
  await writeFile(join(dir,'counts'),Buffer.from(new Uint32Array([4]).buffer));
  await assert.rejects(loadModel(dir),/checksum/);
});

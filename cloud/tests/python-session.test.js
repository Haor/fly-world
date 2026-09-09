import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {PythonSession} from '../src/python-session.js';
import {SENSORY_KEYS} from '../../fly-host/src/habitat.js';

for(const indexedSpikes of [false,true])test(`Python process consumes shared populations and reset (${indexedSpikes?'indexed':'body ID'})`, {skip:!process.env.TORCH_TEST_PYTHON}, async t=>{
 const dir=await mkdtemp(join(tmpdir(),'fly-torch-session-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const neurons=[['1','LC9','','L','acetylcholine',1,null],['2','DNp09','','L','acetylcholine',1,null]];
 const files={};
 for(const [key,data] of Object.entries({neurons:gzipSync(JSON.stringify(neurons)),offsets:Buffer.from(new Uint32Array([0,0,1]).buffer),sources:Buffer.from(new Uint32Array([0]).buffer),counts:Buffer.from(new Uint32Array([90]).buffer)})){
  await writeFile(join(dir,key),data);files[key]={file:key,sha256:createHash('sha256').update(data).digest('hex')};
 }
 await writeFile(join(dir,'manifest.json'),JSON.stringify({files}));
 const worker=new PythonSession({python:process.env.TORCH_TEST_PYTHON,directory:dir,format:'full',seed:1,neurons,device:'cpu',indexedSpikes});
 t.after(()=>worker.terminate());const queue=[],waiters=[];
 worker.on('error',e=>{for(const w of waiters)w.reject(e);});
 worker.on('message',m=>{if(m.type==='processed')return;if(waiters.length)waiters.shift().resolve(m);else queue.push(m);});
 const next=()=>queue.length?Promise.resolve(queue.shift()):new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Python response timeout')),15000);waiters.push({resolve:m=>{clearTimeout(timer);resolve(m);},reject});});
 assert.equal((await next()).type,'loaded');
 worker.postMessage({type:'pulse',bodyIds:['1'],strength:300,replace:true,profile:'turn'});
 worker.postMessage({type:'step',requestId:1,generation:0,steps:100,silenced:false,sensory:Object.fromEntries(SENSORY_KEYS.map(k=>[k,0]))});
 const result=await next();assert.equal(result.type,'result');assert(result.total>0);
 if(indexedSpikes){assert(Array.isArray(result.firing));assert.equal(result.counts.reduce((s,x)=>s+x,0),result.total);assert.equal(result.spikes,undefined);}
 else assert(Array.isArray(result.spikes));
 worker.postMessage({type:'reset',requestId:2,generation:1});assert.equal((await next()).type,'reset');
 worker.postMessage({type:'step',requestId:3,generation:1,steps:100,silenced:false,sensory:Object.fromEntries(SENSORY_KEYS.map(k=>[k,0]))});
 const reset=await next();assert.equal(reset.tick,100);assert.equal(reset.total,0);
});

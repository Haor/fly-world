/** Exercise the same CloudBrain adapter as the browser over a real socket. */
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { CloudBrain } from '../../fly-host/src/cloud-brain.js';
import { validateResult } from '../../fly-host/src/neural-contract.js';

const url=process.env.NEURAL_URL||'ws://127.0.0.1:9000/neural';
const origin=process.env.NEURAL_ORIGIN||'http://127.0.0.1:8768';
const token=(await readFile(process.env.NEURAL_TOKEN_FILE,'utf8')).trim();
const neurons=JSON.parse(gunzipSync(await readFile(new URL('../../fly-host/public/data/neurons.json.gz',import.meta.url))));
class Socket extends WebSocket {constructor(url){super(url,{origin});}}
const modelId=process.env.NEURAL_MODEL||'malecns-v1.0-full',compute=process.env.NEURAL_COMPUTE||'cpu',inputMode=process.env.NEURAL_INPUT_MODE||'sensory';
const dynamics=process.env.NEURAL_DYNAMICS||'adaptive';
let metadataRows=0;
const brain=new CloudBrain({url,token,neurons,Socket,modelId,compute,inputMode,dynamics,onMetadata:rows=>{metadataRows=rows.length;}}),queue=[],waiting=[];
brain.onmessage=({data})=>{if(waiting.length)waiting.shift()(data);else queue.push(data);};
const next=()=>queue.length?Promise.resolve(queue.shift()):new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Protocol timeout')),65000);
  waiting.push(m=>{clearTimeout(timer);if(m.type==='error')reject(Error(m.message));else resolve(m);});
});
try {
  brain.postMessage({type:'init'});let ready=await next();while(ready.type==='stage')ready=await next();assert.equal(ready.type,'ready');
  assert.equal(ready.model.id,modelId);assert.equal(metadataRows,ready.model.neurons);
  let tick=0,total=0,wallMs=0;
  const started=performance.now();
  const count=Number(process.env.SMOKE_BATCHES||20);
  for(let i=0;i<count;i++) {
    brain.postMessage({type:'step',generation:0,silenced:false,background:dynamics==='adaptive',sensory:{walk:inputMode==='assisted'?200:0,odorLeft:20,odorRight:5,visualLeft:40,visualRight:10}});
    const result=await next();validateResult(result,tick,metadataRows);tick=result.tick;total+=result.total;wallMs+=result.wallMs;
  }
  const elapsedMs=performance.now()-started;
  assert(total>0);
  brain.postMessage({type:'reset',generation:1});assert.equal((await next()).type,'reset');
  brain.postMessage({type:'step',generation:1,silenced:false,sensory:{}});
  const rest=await next();validateResult(rest,0,metadataRows);assert.equal(rest.total,0);
  console.log(JSON.stringify({status:'PASS',compute,computeKernel:ready.computeKernel,inputMode,dynamics,metadataRows,model:ready.model,batches:count,neuralSeconds:tick*.0001,totalSpikes:total,
    computeWallMs:wallMs,elapsedMs,realTimeFactor:tick*.1/elapsedMs,resetToRest:true},null,2));
} finally {brain.terminate();}

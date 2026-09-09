/** Measure the public adapter, including transport and complete spike frames. */
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {WebSocket} from 'ws';
import {CloudBrain} from '../../fly-host/src/cloud-brain.js';
const token=(await readFile(process.env.NEURAL_TOKEN_FILE,'utf8')).trim();
class Socket extends WebSocket {constructor(url){super(url,{origin:'http://127.0.0.1:8768'});}}
const brain=new CloudBrain({url:process.env.NEURAL_URL||'ws://127.0.0.1:9000/neural',token,neurons:[],Socket,modelId:'malecns-v1.0-full',compute:'cuda',inputMode:'sensory',onMetadata:()=>{}});
const queue=[],waiting=[];brain.onmessage=({data})=>waiting.length?waiting.shift()(data):queue.push(data);
const next=async()=>{const m=queue.length?queue.shift():await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Benchmark timeout')),65000);waiting.push(m=>{clearTimeout(timer);resolve(m);});});if(m.type==='error')throw Error(m.message);return m;};
const percentile=(a,p)=>[...a].sort((a,b)=>a-b)[Math.min(a.length-1,Math.floor(a.length*p))];
try{
 brain.postMessage({type:'init'});let ready=await next();while(ready.type==='stage')ready=await next();assert.equal(ready.type,'ready');
 const rows=[];const batches=Number(process.env.BENCH_BATCHES||300),warmup=100;
 assert(Number.isSafeInteger(batches)&&batches>0&&batches<=10000);
 for(let i=0;i<warmup+batches;i++){
  const began=performance.now();brain.postMessage({type:'step',generation:0,background:true,silenced:false,sensory:{odorLeft:20,odorRight:5,visualLeft:40,visualRight:10}});
  const r=await next();assert.equal(r.tick,(i+1)*100);
  if(i>=warmup)rows.push({compute:r.wallMs,api:performance.now()-began,spikes:r.total});
 }
 const result={model:ready.model,computeKernel:ready.computeKernel,warmupNeuralSeconds:warmup*.01,neuralSeconds:batches*.01,totalSpikes:rows.reduce((s,r)=>s+r.spikes,0)};
 for(const key of ['compute','api']){const values=rows.map(r=>r[key]);result[key]={realTimeFactor:batches*10/values.reduce((s,x)=>s+x,0),p50Ms:percentile(values,.5),p95Ms:percentile(values,.95),maxMs:Math.max(...values)};}
 console.log(JSON.stringify(result,null,2));
}finally{brain.terminate();}

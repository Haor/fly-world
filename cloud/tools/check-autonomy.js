/** Paired closed-loop controls. A behavioral difference is not a foraging success claim. */
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {WebSocket} from 'ws';
import {CloudBrain} from '../../fly-host/src/cloud-brain.js';
import {Habitat} from '../../fly-host/src/habitat.js';
import {FlyController} from '../../fly-host/src/controller.js';
import {validateResult} from '../../fly-host/src/neural-contract.js';
const token=(await readFile(process.env.NEURAL_TOKEN_FILE,'utf8')).trim();
class Socket extends WebSocket {constructor(url){super(url,{origin:process.env.NEURAL_ORIGIN||'http://127.0.0.1:8768'});}}
const seconds=Number(process.env.PROBE_SECONDS||1),seeds=(process.env.PROBE_SEEDS||'1,7,19').split(',').map(Number);
assert(Number.isFinite(seconds)&&seconds>=.1&&seconds<=30&&seeds.every(Number.isSafeInteger));
const records=[];
for(const seed of seeds){
 let nodeCount=0;
 const brain=new CloudBrain({url:process.env.NEURAL_URL||'ws://127.0.0.1:9000/neural',token,neurons:[],Socket,
  seed,modelId:process.env.NEURAL_MODEL||'malecns-v1.0-full',compute:process.env.NEURAL_COMPUTE||'cuda',inputMode:'sensory',dynamics:'adaptive',onMetadata:rows=>{nodeCount=rows.length;}});
 const queue=[],waiters=[];brain.onmessage=({data})=>{if(waiters.length)waiters.shift()(data);else queue.push(data);};
 const next=async()=>{const m=queue.length?queue.shift():await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Neural response timed out')),65000);waiters.push(m=>{clearTimeout(timer);resolve(m);});});if(m.type==='error')throw Error(m.message);return m;};
 try{
  brain.postMessage({type:'init'});let ready=await next();while(ready.type==='stage')ready=await next();assert.equal(ready.type,'ready');
  let generation=0;
  for(const [name,options,background,silenced] of [
   ['quiet',{enabled:false},false,false],['background',{enabled:false},true,false],['environment',{},true,false],
   ['light-left',{odor:false,lightAngle:90},true,false],['light-right',{odor:false,lightAngle:-90},true,false],['disconnected',{},true,true]]){
   if(generation){brain.postMessage({type:'reset',generation});assert.equal((await next()).type,'reset');}
   const world=new Habitat(options),body=new FlyController();body.profile='adaptive';world.reset(body);
   let tick=0,total=0,path=0,wallMs=0;const average=new Float64Array(7);
   const batches=Math.round((name==='quiet'||name==='disconnected'?Math.min(seconds,.2):seconds)*100);
   for(let i=0;i<batches;i++){
    const sensory=world.sense(body);for(const key of ['walk','left','right','looming'])assert.equal(sensory[key],0);
    brain.postMessage({type:'step',generation,sensory,background,silenced});const r=await next();validateResult(r,tick,nodeCount);tick=r.tick;total+=r.total;wallMs+=r.wallMs;
    for(let c=0;c<7;c++)average[c]+=r.rates[c]/batches;
    const {x,z}=body;body.advance(r.rates,.01,world.feeding);world.advance(body,body.rates,.01);path+=Math.hypot(body.x-x,body.z-z);
   }
   const result={seed,name,seconds:batches*.01,neurons:nodeCount,compute:ready.compute,totalSpikes:total,pathMm:path,yaw:body.yaw,position:[body.x,body.z],meanRates:[...average],realTimeFactor:batches*10/wallMs};
   records.push(result);console.log(JSON.stringify(result));generation++;
   if(name==='quiet'){assert.equal(total,0);assert.equal(path,0);}
   if(name==='disconnected'){assert.equal(path,0);assert(average.every(r=>r===0));}
  }
 }finally{
  brain.terminate();
  // Socket close precedes Python exit; wait for this benchmark's session quota.
  const health=new URL(brain.url);health.protocol=health.protocol==='wss:'?'https:':'http:';health.pathname='/healthz';
  const deadline=Date.now()+15000;
  while((await (await fetch(health)).json()).sessions>0){
   if(Date.now()>deadline)throw Error('Previous neural session did not release its resources');
   await new Promise(resolve=>setTimeout(resolve,100));
  }
 }
}
for(const seed of seeds){
 const runs=records.filter(r=>r.seed===seed),background=runs.find(r=>r.name==='background'),environment=runs.find(r=>r.name==='environment');
 assert(background.pathMm>0&&environment.pathMm>0,'The complete graph must recruit walking');
 assert(environment.meanRates.some((r,i)=>Math.abs(r-background.meanRates[i])>.01),'Environment must change downstream activity');
 assert(Math.abs(environment.pathMm-background.pathMm)+Math.abs(environment.yaw-background.yaw)>1e-5,'Environment must change body motion');
 const left=runs.find(r=>r.name==='light-left'),right=runs.find(r=>r.name==='light-right');
 assert(Math.abs(left.pathMm-right.pathMm)+Math.abs(left.yaw-right.yaw)>1e-5,'Light direction must change body motion');
 assert(left.meanRates.some((r,i)=>Math.abs(r-right.meanRates[i])>.01),'Light direction must reach downstream readouts');
}
console.log(JSON.stringify({status:'PASS',seeds,scope:'paired sensory and background controls; no attraction or foraging guarantee'}));

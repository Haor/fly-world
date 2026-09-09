/** Paired sensory and causal controls; stop on the server's neural clock. */
import {readFile} from 'node:fs/promises';
import {WebSocket} from 'ws';
import {CloudBrain} from '../../fly-host/src/cloud-brain.js';
import {CHANNELS,populations} from '../../fly-host/src/stimulus.js';
import assert from 'node:assert/strict';
const url=process.env.NEURAL_URL||'ws://127.0.0.1:9000/neural';
const token=(await readFile(process.env.NEURAL_TOKEN_FILE,'utf8')).trim();
const seeds=(process.env.EXPERIMENT_SEEDS||'1,2').split(',').map(Number);
const ticks=Number(process.env.EXPERIMENT_TICKS||20000);
if(!Number.isSafeInteger(ticks)||ticks<100||ticks%100)throw Error('Invalid experiment duration');
const cases=[
 {name:'baseline'},
 {name:'dark',options:{light:0}},
 {name:'pattern-left',options:{patternContrast:1,patternSpeed:-60}},
 {name:'pattern-right',options:{patternContrast:1,patternSpeed:60}},
 {name:'odor-near',options:{odorX:-9.375,odorZ:1.25,odorStrength:3}},
 {name:'wind',options:{windSpeed:30,windAngle:90}},
 {name:'looming',stimulus:'looming'},
 {name:'afferents-off',controls:{afferents:false}},
 {name:'propagation-off',controls:{propagation:false}},
 {name:'muscles-off',controls:{muscles:false}},
];
const defaults={enabled:true,vision:true,taste:true,odor:true,light:1,lightAngle:0,sensoryGain:1,odorStrength:1,odorX:-9.375,odorZ:9.375,windSpeed:0,windAngle:0,patternSpeed:0,patternContrast:0,proprioception:true};
class Socket extends WebSocket{constructor(url){super(url,{origin:'http://127.0.0.1:8768'});}}
for(const seed of seeds){
 let waiting=null,frames=[],definition,neurons,readout;
 const client=new CloudBrain({url,token,Socket,neurons:[],compute:'cuda',inputMode:'sensory',execution:'world',seed,onMetadata:rows=>neurons=rows,onBodyDefinition:d=>definition=d});
 const next=predicate=>new Promise((resolve,reject)=>{
  if(waiting)throw Error('Concurrent response waiter');
  const timer=setTimeout(()=>{waiting=null;reject(Error('Experiment timeout'));},120000);
  waiting={predicate,resolve:m=>{clearTimeout(timer);waiting=null;resolve(m);},reject:e=>{clearTimeout(timer);waiting=null;reject(e);}};
 });
 client.onmessage=({data:m})=>{
  if(m.type==='error'){waiting?.reject(Error(m.message));return;}
  if(m.type==='world-frame'&&m.steps>0){
   const counts=new Map(Array.from(m.firing,(id,i)=>[id,m.counts[i]]));
   readout.forEach((ids,i)=>{const hz=ids.length?ids.reduce((sum,id)=>sum+(counts.get(id)||0),0)/ids.length/(m.steps*.0001):0;assert(Math.abs(hz-m.rates[i])<1e-8,'Readout must cover the observation window');});
   frames.push(m);
  }
  if(waiting?.predicate(m))waiting.resolve(m);
 };
 const send=async(message,predicate=m=>m.type==='control'&&m.operation===message.type)=>{const response=next(predicate);client.postMessage(message);return response;};
 try{
  let ready=next(m=>m.type==='ready');client.postMessage({type:'init'});ready=await ready;
  const groups=populations(neurons);readout=CHANNELS.map(key=>groups[key]);
  let generation=0;
  for(const scenario of cases){
   await send({type:'reset',generation:++generation},m=>m.type==='reset');
   await send({type:'environment',options:{...defaults,...scenario.options}});
   await send({type:'ablation',controls:{afferents:true,propagation:true,muscles:true,...scenario.controls}});
   if(scenario.stimulus)await send({type:'stimulus',stimulus:scenario.stimulus});
   frames=[];const began=performance.now();const done=next(m=>m.type==='world-frame'&&!m.running&&m.tick===ticks);
   client.postMessage({type:'run',running:true,untilTick:ticks});const last=await done;
   const sums=Array(7).fill(0);let activity=0,distance=0,previous=null,maxHeight=-Infinity,maxActuation=0;
   for(const f of frames){f.rates.forEach((r,i)=>sums[i]+=r*f.steps/ticks);activity+=f.total;maxHeight=Math.max(maxHeight,f.pose.y);maxActuation=Math.max(maxActuation,f.pose.actuation);if(previous)distance+=Math.hypot(f.pose.x-previous.x,f.pose.z-previous.z);previous=f.pose;}
   assert.equal(activity,last.cumulativeSpikes,'Experiment lost an observation window');
   console.log(JSON.stringify({seed,scenario:scenario.name,model:ready.model.id,kernel:ready.computeKernel,neurons:neurons.length,physicsDt:definition.physicsDt,neuralSeconds:ticks*.0001,wallMs:performance.now()-began,spikes:activity,cumulativeSpikes:last.cumulativeSpikes,meanReadoutHz:sums,observedPathMm:distance,maxHeightMm:maxHeight,maxActuation,final:{x:last.pose.x,z:last.pose.z,y:last.pose.y,yaw:last.pose.yaw,contacts:last.pose.contacts,behavior:last.pose.behavior},senses:last.world,ablation:last.ablation}));
  }
 }finally{client.terminate();waiting?.reject(Error('Session ended'));}
 const health=new URL('/healthz',url);health.protocol=health.protocol==='wss:'?'https:':'http:';
 for(let i=0;i<50;i++){if((await(await fetch(health)).json()).sessions===0)break;await new Promise(r=>setTimeout(r,100));}
}

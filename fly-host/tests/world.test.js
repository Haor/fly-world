import test from 'node:test';
import assert from 'node:assert/strict';
import {serviceEndpoint,RUN_MODES} from '../src/run-modes.js';
import {validateWorldCommand,validateWorldFrame} from '../src/world-contract.js';
import {Simulation} from '../src/simulation.js';
const pose={x:0,y:1.3,z:0,yaw:0,velocity:0,yawRate:0,phase:0,time:.05,pitch:0,bank:0,wingOpen:0,flightBlend:0,launch:0,landing:0,behavior:'At rest',physical:true,contacts:0,actuation:0,rigid:[[0,0,0,1,0,0,0]]};
const frame={type:'world-frame',generation:0,tick:500,fromTick:0,steps:500,firing:[1],counts:[3],total:3,cumulativeSpikes:3,pose,world:{time:.05,odorLeft:0,odorRight:0,visualLeft:0,visualRight:0,odor:0,sugar:0,looming:0,options:{enabled:true}},rates:[0,0,0,0,0,0,0],running:true,speed:1,wallMs:40};
test('three explicit modes cannot silently route local CUDA to a remote host',()=>{
 assert.deepEqual(Object.keys(RUN_MODES),['webgpu','local-cuda','remote']);
 assert.equal(RUN_MODES.webgpu.execution,'neural');assert.equal(RUN_MODES['local-cuda'].execution,'world');
 assert.throws(()=>serviceEndpoint('local-cuda','wss://example.com/neural'));
 assert.throws(()=>serviceEndpoint('remote','ws://example.com/neural'));
 assert.throws(()=>serviceEndpoint('webgpu','ws://localhost'));
 assert.equal(serviceEndpoint('remote','ws://127.0.0.1:19001/neural'),'ws://127.0.0.1:19001/neural');
});
test('world commands accept environment controls and reject per-step or motor injection',()=>{
 const base={requestId:1,generation:0};
 validateWorldCommand({...base,type:'environment',options:{patternSpeed:30,windSpeed:10}},0,0);
 for(const m of [{type:'step'},{type:'pulse'},{type:'environment',options:{walk:200}},{type:'environment',options:{windSpeed:NaN}},{type:'run',running:'yes'}])assert.throws(()=>validateWorldCommand({...base,...m},0,0));
});
test('world frames validate complete observation windows and expose time gaps',()=>{
 validateWorldFrame(frame,0,2);
 const skipped={...frame,fromTick:500,tick:1000,pose:{...pose,time:.1},world:{...frame.world,time:.1},cumulativeSpikes:6};
 validateWorldFrame(skipped,100,2);
 for(const change of [{fromTick:501},{total:4},{firing:[1,1],counts:[1,2]},{counts:[501]},{pose:{...pose,rigid:[[NaN,0,0,1,0,0,0]]}}])assert.throws(()=>validateWorldFrame({...frame,...change},0,2));
});
test('remote simulation consumes authoritative poses without local integration or step requests',()=>{
 let worker;const sent=[],seen=[];
 const simulation=new Simulation({assetBase:'http://localhost',onResult:m=>seen.push(m),createWorker:()=>worker={postMessage:m=>sent.push(m),terminate(){}}});
 try{
  simulation.start('cloud');worker.onmessage({data:{type:'ready',backend:'cloud',execution:'world'}});
  assert.equal(sent.at(-1).type,'run');
  simulation.body.advance=()=>assert.fail('Client integrated server body');simulation.world.advance=()=>assert.fail('Client integrated server environment');
  worker.onmessage({data:frame});assert.equal(simulation.tick,500);assert.equal(simulation.body.pose(),pose);assert.equal(seen.length,1);
  simulation.request();assert(!sent.some(m=>m.type==='step'));
  simulation.togglePause();assert.deepEqual(sent.at(-1),{type:'run',running:false});
  worker.onmessage({data:{type:'control',running:false,options:{enabled:true}}});assert(simulation.paused);
  simulation.configure({light:0});assert.equal(sent.at(-1).type,'environment');
  simulation.reset();assert.equal(sent.at(-1).type,'reset');assert.equal(simulation.generation,1);
  worker.onmessage({data:frame});assert.equal(seen.length,1);
 }finally{simulation.dispose();}
});
test('paused world sessions do not expire while the server clock is stopped',t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let worker;const simulation=new Simulation({assetBase:'http://localhost',createWorker:()=>worker={postMessage(){},terminate(){}}});
 try{
  simulation.start('cloud');worker.onmessage({data:{type:'ready',backend:'cloud',execution:'world'}});
  worker.onmessage({data:frame});worker.onmessage({data:{type:'control',running:false,options:{}}});
  t.mock.timers.tick(120000);assert(simulation.ready);assert(simulation.paused);
  worker.onmessage({data:{type:'control',running:true,options:{}}});
  t.mock.timers.tick(60001);assert.equal(simulation.phase,'error');
 }finally{simulation.dispose();}
});

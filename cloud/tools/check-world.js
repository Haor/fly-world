/** Verify an autonomous world over the same adapter as the station. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {WebSocket,WebSocketServer} from 'ws';
import {CloudBrain} from '../../fly-host/src/cloud-brain.js';
const token=(await readFile(process.env.NEURAL_TOKEN_FILE,'utf8')).trim();
const testTicks=Number(process.env.WORLD_TEST_TICKS||10000);
assert(Number.isSafeInteger(testTicks)&&testTicks>=1000&&testTicks%100===0);
let url=process.env.NEURAL_URL||'ws://127.0.0.1:9000/neural';
const delay=Number(process.env.PROXY_DELAY_MS||0);let proxy;const timers=new Set(),proxySockets=new Set();
if(delay){
 assert(Number.isFinite(delay)&&delay>=0&&delay<=1000);const upstream=url;
 proxy=new WebSocketServer({port:0,host:'127.0.0.1'});await new Promise(resolve=>proxy.once('listening',resolve));
 proxy.on('connection',client=>{
  const remote=new WebSocket(upstream,{origin:'http://127.0.0.1:8768'});proxySockets.add(client);proxySockets.add(remote);const pending=[];
  const schedule=(socket,data)=>{const timer=setTimeout(()=>{timers.delete(timer);if(socket.readyState===1)socket.send(data.toString());},delay);timers.add(timer);};
  client.on('message',data=>remote.readyState===1?schedule(remote,data):pending.push(data));
  remote.on('open',()=>pending.forEach(data=>schedule(remote,data)));remote.on('message',data=>schedule(client,data));
  client.on('close',()=>remote.close());remote.on('close',()=>client.close());
  remote.on('error',()=>client.close());client.on('error',()=>remote.close());
 });
 url=`ws://127.0.0.1:${proxy.address().port}/neural`;
}
class Socket extends WebSocket {constructor(url){super(url,{origin:'http://127.0.0.1:8768'});}send(raw){const m=JSON.parse(raw);commands.push(m.type);super.send(raw);}}
const commands=[],frames=[],waiters=[];let definition;
const brain=new CloudBrain({url,token,neurons:[],Socket,modelId:'malecns-v1.0-full',compute:process.env.NEURAL_COMPUTE||'cuda',inputMode:'sensory',execution:'world',onMetadata:()=>{},onBodyDefinition:d=>definition=d});
brain.onmessage=({data:m})=>{
 if(m.type==='world-frame')frames.push({tick:m.tick,time:performance.now(),speed:m.speed,pose:m.pose,timings:m.timings});
 if(m.type==='error'){for(const w of waiters.splice(0)){clearTimeout(w.timer);w.reject(Error(m.message));}return;}
 for(const w of [...waiters])if(w.test(m)){waiters.splice(waiters.indexOf(w),1);clearTimeout(w.timer);w.resolve(m);}
};
const next=test=>new Promise((resolve,reject)=>{const w={test,resolve,reject,timer:setTimeout(()=>reject(Error('World response timeout')),90000)};waiters.push(w);});
try{
 const readyPromise=next(m=>m.type==='ready');brain.postMessage({type:'init'});const ready=await readyPromise;assert.equal(ready.execution,'world');assert.equal(definition.encoding,'flybody-mujoco/1');
 const started=performance.now();let response=next(m=>m.type==='control');brain.postMessage({type:'run',running:true});await response;
 await next(m=>m.type==='world-frame'&&m.tick>=testTicks);
 const active=frames.filter(f=>f.tick>0),first=active[0],last=active.at(-1);
 const measured=(last.tick-first.tick)*.1/(last.time-first.time);
 response=next(m=>m.type==='control'&&m.operation==='run');brain.postMessage({type:'run',running:false});const pause=await response;
 const pausedTick=pause.appliedTick;await new Promise(resolve=>setTimeout(resolve,Math.max(300,delay*3)));
 assert.equal(frames.at(-1).tick,pausedTick);
 response=next(m=>m.type==='control'&&m.operation==='environment');brain.postMessage({type:'environment',options:{light:0,odorStrength:.5}});assert.equal((await response).appliedTick,pausedTick);
 response=next(m=>m.type==='reset');brain.postMessage({type:'reset',generation:1});const reset=await response;assert.equal(reset.pose.time,0);assert.equal(reset.world.time,0);assert.equal(reset.running,false);
 response=next(m=>m.type==='world-frame'&&m.tick>=3000);brain.postMessage({type:'run',running:true});await response;
 assert(!commands.includes('step'));assert(!commands.includes('pulse'));
 console.log(JSON.stringify({status:'PASS',model:ready.model,computeKernel:ready.computeKernel,physicalBody:{bodies:definition.bodies,mappedMotorNeurons:definition.mappedMotorNeurons,mappedActuators:definition.mappedActuators,actuators:definition.actuators,physicsDt:definition.physicsDt},addedOneWayDelayMs:delay,measuredRealTimeFactor:measured,serverReportedSpeed:last.speed,lastFrameTimings:last.timings,neuralSeconds:last.tick*.0001,initialRunWallMs:last.time-started,pauseResetVerified:true,clientStepCommands:0},null,2));
}finally{brain.terminate();for(const w of waiters)clearTimeout(w.timer);for(const timer of timers)clearTimeout(timer);for(const socket of proxySockets)socket.terminate();if(proxy)await new Promise(resolve=>proxy.close(resolve));}

import test from 'node:test';
import assert from 'node:assert/strict';
import { CloudBrain, cloudURL } from '../src/cloud-brain.js';
import { CHANNELS } from '../src/stimulus.js';
import { PROTOCOL } from '../src/neural-contract.js';
class Socket {constructor(url){this.url=url;this.sent=[];this.readyState=1;}send(s){this.sent.push(JSON.parse(s));}close(){this.readyState=3;}emit(m){this.onmessage({data:JSON.stringify(m)});}}
const ready={type:'ready',protocol:PROTOCOL,sensoryEncoding:'population-hz/3',channels:CHANNELS,model:{id:'malecns-v1.0-full',scope:'full',neurons:211577,dtMs:.1,connectomeSha256:'a'.repeat(64)}};
function fixture(){const events=[],brain=new CloudBrain({url:'ws://localhost:9000/neural',token:'test-only',neurons:[['900000000000000001'],['100']],Socket});brain.onmessage=e=>events.push(e.data);brain.postMessage({type:'init'});brain.socket.onopen();brain.socket.emit(ready);return {brain,events,s:brain.socket};}
test('remote connection requires WSS except local loopback, with no URL credentials',()=>{
  assert.equal(cloudURL('wss://example.com/neural'),'wss://example.com/neural');
  for(const url of ['ws://example.com','wss://u:p@example.com','https://example.com','wss://example.com?token=secret'])assert.throws(()=>cloudURL(url));
});
test('handshake, stable body IDs, full-model projection and duplicate responses',()=>{
  const {brain,events,s}=fixture();
  assert.equal(s.sent[0].protocol,PROTOCOL);assert.equal(brain.token,'');
  assert.equal(events[0].backend,'cloud');
  brain.postMessage({type:'pulse',indices:[0],strength:180});assert.deepEqual(s.sent.at(-1).bodyIds,['900000000000000001']);assert(!('indices' in s.sent.at(-1)));
  brain.postMessage({type:'step',generation:0,sensory:{sugar:100}});const requestId=s.sent.at(-1).requestId;
  const result={type:'result',requestId,generation:0,tick:100,steps:100,total:6,wallMs:10,rates:[0,0,0,0,0,0,20],spikes:[['100',2],['999',4]]};
  s.emit(result);assert.deepEqual([...events.at(-1).firing],[1]);assert.equal(events.at(-1).total,6);
  const length=events.length;s.emit(result);assert.equal(events.length,length);
  brain.postMessage({type:'reset',generation:1});s.emit({...result,requestId});assert.equal(events.length,length);
  s.emit({type:'reset',generation:1,requestId:s.sent.at(-1).requestId});assert.equal(events.at(-1).type,'reset');brain.terminate();
});
test('incompatible model and transport failure surface errors without local fallback',()=>{
  const {brain,events,s}=fixture();s.onclose();assert.equal(events.at(-1).type,'error');assert.equal(brain.closed,true);
  const bad=new CloudBrain({url:'ws://localhost',neurons:[],Socket});const errors=[];bad.onmessage=e=>errors.push(e.data);bad.postMessage({type:'init'});bad.socket.emit({...ready,model:{...ready.model,scope:'subset'}});assert.equal(errors.at(-1).type,'error');
});
test('cloud explicitly accepts the bilateral encoding and retains separate rates',()=>{
  const {brain,s}=fixture();
  assert.equal(s.sent[0].sensoryEncoding,'population-hz/3');
  brain.postMessage({type:'step',sensory:{odorLeft:3,odorRight:17}});
  assert.equal(s.sent.at(-1).sensory.odorLeft,3); assert.equal(s.sent.at(-1).sensory.odorRight,17);
  assert(!('odor' in s.sent.at(-1).sensory)); brain.terminate();
  const legacy=new CloudBrain({url:'ws://localhost',neurons:[],Socket}),events=[];
  legacy.onmessage=e=>events.push(e.data);legacy.postMessage({type:'init'});
  legacy.socket.emit({...ready,sensoryEncoding:'population-hz/1'});
  assert.equal(events.at(-1).type,'error'); assert(legacy.closed);
});
test('selected model waits for complete metadata and maps newly included neurons',()=>{
  const events=[],rows=[];
  const brain=new CloudBrain({url:'ws://localhost',neurons:[],Socket,compute:'cpu',inputMode:'sensory',
    onMetadata:n=>rows.push(...n)});
  brain.onmessage=e=>events.push(e.data);brain.postMessage({type:'init'});brain.socket.onopen();
  assert(brain.socket.sent[0].metadata);
  brain.socket.emit({...ready,compute:'cpu',metadata:{rows:2},model:{...ready.model,neurons:2}});
  assert.equal(brain.ready,undefined);
  brain.socket.emit({type:'metadata',offset:0,neurons:[['1','','','','',0,null]],complete:false});
  assert.equal(brain.ready,undefined);
  brain.socket.emit({type:'metadata',offset:1,neurons:[['999','','','','',0,[1,2,3]]],complete:true});
  assert.equal(rows.length,2);assert.equal(brain.ready,true);
  brain.postMessage({type:'step',sensory:{}});
  brain.socket.emit({type:'result',requestId:1,generation:0,tick:100,steps:100,total:1,wallMs:1,
    rates:[0,0,0,0,0,0,0],spikes:[['999',1]]});
  assert.deepEqual([...events.at(-1).firing],[1]);brain.terminate();
});
test('metadata gaps and wrong compute fail instead of quietly showing the retained graph',()=>{
  for(const broken of ['offset','compute']) {
    const events=[],brain=new CloudBrain({url:'ws://localhost',neurons:[],Socket,compute:'cuda',onMetadata:()=>{}});
    brain.onmessage=e=>events.push(e.data);brain.postMessage({type:'init'});
    brain.socket.emit({...ready,compute:broken==='compute'?'cpu':'cuda',metadata:{rows:2},model:{...ready.model,neurons:2}});
    if(broken==='offset')brain.socket.emit({type:'metadata',offset:1,neurons:[['1','','','','',0,null]],complete:true});
    assert.equal(events.at(-1).type,'error');assert(brain.closed);
  }
});

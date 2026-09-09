import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createNeuralServer } from '../src/server.js';
import { BrainCPU } from '../../fly-host/src/brain.js';
import { CHANNELS, populations, decodeCounts } from '../../fly-host/src/stimulus.js';
import { sensoryPopulations, addSensoryRates, SENSORY_KEYS } from '../../fly-host/src/habitat.js';

const token='test-only-token-not-a-real-credential-0001',origin='http://127.0.0.1:8768';
const graph={n:4,neurons:[['1','LC9','x','L','acetylcholine',1],['2','DNp09','x','L','acetylcholine',1],
  ['3','MN9','x','R','acetylcholine',1],['4','ORN_DM1','x','R','acetylcholine',1]],
  sign:new Int32Array([1,1,1,1]),offsets:new Uint32Array([0,0,1,2,2]),sources:new Uint32Array([0,1]),counts:new Uint32Array([100,100])};
const model={id:'malecns-v1.0-full',scope:'test-fixture',neurons:4,dtMs:.1,connectomeSha256:'a'.repeat(64)};
const init={type:'init',protocol:'fly-world-neural/2',model:model.id,dtMs:.1,steps:100,seed:1,
  channels:CHANNELS,spikeIds:'body-id',sensoryEncoding:'population-hz/3',token};
const step=(requestId,generation=0)=>({type:'step',requestId,generation,steps:100,silenced:false,sensory:Object.fromEntries(SENSORY_KEYS.map(key=>[key,key==='walk'?200:0]))});
async function fixture(t,options={}) {
  const service=createNeuralServer({graph,model,token,origins:[origin],...options});
  service.http.listen(0,'127.0.0.1');await once(service.http,'listening');
  t.after(()=>service.close());
  const port=service.http.address().port;
  return {service,url:`ws://127.0.0.1:${port}/neural`,http:`http://127.0.0.1:${port}`};
}
async function client(url) {
  const ws=new WebSocket(url,{origin}),queue=[],waiters=[];
  ws.on('error',()=>{});
  ws.on('message',bytes=>{const data=JSON.parse(bytes);if(waiters.length)waiters.shift()(data);else queue.push(data);});
  await once(ws,'open');
  return {ws,send:m=>ws.send(JSON.stringify(m)),next:()=>queue.length?Promise.resolve(queue.shift()):
    new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Timed out waiting for protocol result')),5000);
      waiters.push(data=>{clearTimeout(timer);resolve(data);});})};
}
test('real WebSocket results equal the direct CPU core, then reset restarts time',async t=>{
  const f=await fixture(t),c=await client(f.url);c.send(init);assert.equal((await c.next()).type,'ready');
  const brain=new BrainCPU(graph),groups=populations(graph.neurons),sensory=sensoryPopulations(graph.neurons);
  let total=0;
  for(let i=1;i<=10;i++) {
    const m=step(i);c.send(m);const result=await c.next();
    const expected=brain.batch(100,addSensoryRates(new Float32Array(graph.n),sensory,m.sensory));
    assert.equal(result.tick,i*100);assert.equal(result.total,expected.total);
    assert.deepEqual(result.rates,Array.from(decodeCounts(expected.counts,groups,100)));total+=result.total;
  }
  assert(total>0);
  c.send({type:'reset',requestId:11,generation:1});assert.equal((await c.next()).type,'reset');
  c.send(step(12,1));assert.equal((await c.next()).tick,100);
});
test('authentication and Origin reject unauthorized clients before model allocation',async t=>{
  const f=await fixture(t),c=await client(f.url);c.send({...init,token:'wrong'});
  assert.equal((await c.next()).code,'UNAUTHORIZED');
  assert.equal((await (await fetch(f.http+'/healthz')).json()).sessions,0);
  const ws=new WebSocket(f.url,{origin:'http://untrusted.example'});ws.on('error',()=>{});
  const status=await new Promise(resolve=>ws.on('unexpected-response',(_req,res)=>{res.resume();ws.terminate();resolve(res.statusCode);}));
  assert.equal(status,403);
});
test('session limits reject a second client, and two permitted sessions have separate clocks',async t=>{
  const limited=await fixture(t),a=await client(limited.url),b=await client(limited.url);
  a.send(init);await a.next();b.send(init);assert.equal((await b.next()).code,'BUSY');
  const parallel=await fixture(t,{maxSessions:2}),c=await client(parallel.url),d=await client(parallel.url);
  c.send(init);d.send(init);await c.next();await d.next();
  c.send(step(1));await c.next();c.send(step(2));assert.equal((await c.next()).tick,200);
  d.send(step(1));assert.equal((await d.next()).tick,100);
});
test('invalid sequence, sensory rate, body ID and message flood stop the session',async t=>{
  const f=await fixture(t,{maxSessions:4});
  for(const [command,code] of [[{...step(1),generation:9},'INVALID_GENERATION'],
    [{...step(1),sensory:{...step(1).sensory,odorLeft:301}},'INVALID_STEP'],
    [{type:'pulse',requestId:1,generation:0,bodyIds:['999'],strength:100,profile:'paint',replace:false},'INVALID_OPERATION']]) {
    const c=await client(f.url);c.send(init);await c.next();c.send(command);assert.equal((await c.next()).code,code);
  }
  const c=await client(f.url);c.send(init);await c.next();c.send(step(1));c.send(step(2));
  const results=[await c.next()];if(results[0].type!=='error')results.push(await c.next());
  assert(results.some(m=>m.code==='BACKPRESSURE'));
});
test('reset queued during a step preserves command order and uses a new generation',async t=>{
  const f=await fixture(t),c=await client(f.url);c.send(init);await c.next();
  c.send(step(1));c.send({type:'reset',requestId:2,generation:1});
  assert.equal((await c.next()).generation,0);assert.equal((await c.next()).type,'reset');
  c.send(step(3,1));assert.equal((await c.next()).tick,100);
});
test('protocol pongs retain a paused session; an unauthenticated connection expires',async t=>{
  const f=await fixture(t,{idleMs:500,initMs:500}),c=await client(f.url);
  c.send(init);await c.next();await new Promise(resolve=>setTimeout(resolve,1600));
  c.send(step(1));assert.equal((await c.next()).type,'result');
  const unauthenticated=await client(f.url);assert.equal((await unauthenticated.next()).code,'INIT_TIMEOUT');
});
test('manual pulse and clear operate independently from continuous input',async t=>{
  const f=await fixture(t),c=await client(f.url);c.send(init);await c.next();
  c.send({type:'pulse',requestId:1,generation:0,bodyIds:['1'],strength:300,profile:'paint',replace:true});
  let total=0;
  const quiet=id=>({...step(id),sensory:Object.fromEntries(SENSORY_KEYS.map(key=>[key,0]))});
  for(let id=2;id<=6;id++){c.send(quiet(id));total+=(await c.next()).total;}
  assert(total>0);
  c.send({type:'reset',requestId:7,generation:1});await c.next();
  c.send({type:'pulse',requestId:8,generation:1,bodyIds:['1'],strength:300,profile:'paint',replace:true});
  c.send({type:'clear',requestId:9,generation:1});
  c.send({...quiet(10),generation:1});assert.equal((await c.next()).total,0);
});
test('pure sensory sessions reject motor drives and pulses at the API boundary',async t=>{
  const f=await fixture(t,{maxSessions:2});
  for(const operation of [step(1),{type:'pulse',requestId:1,generation:0,bodyIds:['1'],strength:100,profile:'paint',replace:true}]) {
    const c=await client(f.url);c.send({...init,inputMode:'sensory'});await c.next();c.send(operation);
    const error=await c.next();assert(['MOTOR_INPUT_FORBIDDEN','DIRECT_PULSE_FORBIDDEN'].includes(error.code));
  }
});
test('model selection returns the matching full metadata and refuses an unavailable CUDA backend',async t=>{
  const smaller={graph:{...graph,n:4},model:{...model,id:'malecns-v1.0-retained',scope:'retained'}};
  const f=await fixture(t,{models:[{graph,model},smaller],maxSessions:2});
  const c=await client(f.url);c.send({...init,model:smaller.model.id,metadata:true});
  const ready=await c.next();assert.equal(ready.model.id,smaller.model.id);
  const metadata=await c.next();assert.equal(metadata.neurons.length,4);assert(metadata.complete);
  const unavailable=await client(f.url);unavailable.send({...init,compute:'cuda'});
  assert.equal((await unavailable.next()).code,'CUDA_UNAVAILABLE');
});
test('inspect returns selected-model connectivity in sensory mode without advancing time',async t=>{
  const f=await fixture(t),c=await client(f.url);c.send({...init,inputMode:'sensory'});await c.next();
  c.send({type:'inspect',requestId:1,generation:0,bodyId:'2'});
  const edges=await c.next();assert.equal(edges.type,'connections');assert.deepEqual(edges.items,[{bodyId:'1',weight:100}]);
  c.send({...step(2),sensory:Object.fromEntries(SENSORY_KEYS.map(key=>[key,0]))});
  assert.equal((await c.next()).tick,100);
});

test('adaptive dynamics are negotiated and reference sessions reject background input',async t=>{
 const f=await fixture(t,{maxSessions:2}),c=await client(f.url);
 c.send({...init,dynamics:'adaptive',dynamicsEncoding:'adaptive-conductance/1',inputMode:'sensory'});
 const ready=await c.next();assert.equal(ready.dynamics,'adaptive');assert.equal(ready.dynamicsEncoding,'adaptive-conductance/1');
 c.send({...step(1),background:false,sensory:Object.fromEntries(SENSORY_KEYS.map(key=>[key,0]))});
 assert.equal((await c.next()).total,0);
 const reference=await client(f.url);reference.send(init);await reference.next();reference.send({...step(1),background:true});
 assert.equal((await reference.next()).code,'BACKGROUND_REQUIRES_ADAPTIVE');
});
test('optional indexed spike frames use the selected metadata order and preserve counts',async t=>{
 const f=await fixture(t),c=await client(f.url);
 c.send({...init,metadata:true,spikeEncoding:'index-count/1'});
 assert.equal((await c.next()).spikeEncoding,'index-count/1');assert.equal((await c.next()).type,'metadata');
 const brain=new BrainCPU(graph),sensory=sensoryPopulations(graph.neurons);
 for(let i=1;i<=5;i++){
  const m=step(i);c.send(m);const result=await c.next();
  const expected=brain.batch(100,addSensoryRates(new Float32Array(graph.n),sensory,m.sensory));
  const actual=new Uint32Array(graph.n);result.firing.forEach((index,j)=>actual[index]=result.counts[j]);
  assert.deepEqual(actual,expected.counts);assert.equal(result.total,expected.total);assert.equal(result.spikes,undefined);
 }
 const bad=await client(f.url);bad.send({...init,spikeEncoding:'index-count/1'});assert.equal((await bad.next()).code,'INVALID_INIT');
});

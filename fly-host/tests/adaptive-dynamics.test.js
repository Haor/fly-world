import test from 'node:test';
import assert from 'node:assert/strict';
import {BrainCPU} from '../src/brain.js';
import {backgroundMask} from '../src/background.js';
import {FlyController} from '../src/controller.js';

const graph=()=>({n:3,neurons:[['1','relay','cb_intrinsic','L','acetylcholine',1,null],['2','DNp09','descending_neuron','L','acetylcholine',1,null],['3','L1','ol_intrinsic','R','acetylcholine',1,null]],
 sign:new Int32Array([1,1,1]),offsets:new Uint32Array([0,0,1,1]),sources:new Uint32Array([0]),counts:new Uint32Array([300])});

test('background targets exclude sensory entries and all movement readouts',()=>{
 const g=graph();assert.deepEqual([...backgroundMask(g.neurons)],[1,0,0]);
});
test('adaptive conductance has a stable zero-input rest and bounded inhibition',()=>{
 const b=new BrainCPU(graph(),{profile:'adaptive'}),input=new Float32Array(3);
 assert.equal(b.batch(100,input,false,false).total,0);
 b.gi[1]=100;b.activate(1);b.batch(100,input,false,false);
 assert(b.v[1]>=-75&&b.v[1]<-52);
 b.reset();assert.equal(b.adaptation[1],0);assert.equal(b.gi[1],0);
 assert.equal(b.batch(100,input,false,false).total,0);
});
test('background needs graph propagation to recruit a movement neuron',()=>{
 const g=graph();g.background=backgroundMask(g.neurons);const input=new Float32Array(3);
 const run=silenced=>{const b=new BrainCPU(g,{profile:'adaptive',seed:37});let relay=0,motor=0;
  for(let i=0;i<100;i++){const r=b.batch(100,input,silenced,true);relay+=r.counts[0];motor+=r.counts[1];}
  return {relay,motor};};
 const connected=run(false),cut=run(true);
 assert(connected.relay>0&&connected.motor>0);assert(cut.relay>0);assert.equal(cut.motor,0);
 assert.deepEqual(run(false),connected);
});
test('adaptation raises the firing threshold and reset clears its history',()=>{
 const b=new BrainCPU(graph(),{profile:'adaptive'});b.v[0]=-44;b.activate(0);
 assert.equal(b.batch(1,new Float32Array(3)).counts[0],1);assert.equal(b.adaptation[0],2);
 b.v[0]=-44;b.until[0]=0;b.activate(0);
 assert.equal(b.batch(1,new Float32Array(3)).counts[0],0);
 b.reset();assert.equal(b.adaptation[0],0);
});
test('adaptive movement reads low firing rates but never invents motion at zero output',()=>{
 const body=new FlyController();body.profile='adaptive';
 for(let i=0;i<100;i++)body.advance(new Float32Array(7),.01);
 assert.equal(body.distance,0);assert.equal(body.yaw,0);
 for(let i=0;i<100;i++)body.advance(new Float32Array([2,2,0,0,0,0,0]),.01);
 assert(body.distance>0);assert.equal(body.yaw,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { BrainCPU, PARAMETERS as P, outgoingGraph } from '../src/brain.js';
import { validateResult } from '../src/neural-contract.js';
import { Simulation } from '../src/simulation.js';

function pair(sign=1) {return {n:2,offsets:new Uint32Array([0,0,1]),sources:new Uint32Array([0]),counts:new Uint32Array([10]),sign:new Int32Array([sign,1])};}
for(const sign of [1,-1]) test(`impulse delay and analytical postsynaptic solution, sign ${sign}`,()=>{
  const b=new BrainCPU(pair(sign)),rates=new Float32Array(2);
  b.v[0]=-44;b.activate(0);assert.deepEqual(b.step(rates),[0]);
  for(let t=1;t<18;t++){b.step(rates);assert.equal(b.g[1],0);}
  b.step(rates);assert(Math.abs(b.g[1]-sign*2.75)<1e-6);assert.equal(b.v[1],-52);
  for(let k=1;k<=400;k++){
    b.step(rates);
    const expected=-52+sign*2.75*5/15*(Math.exp(-k*.1/20)-Math.exp(-k*.1/5));
    assert(Math.abs(b.v[1]-expected)<.0001,`time ${k}: ${b.v[1]} vs ${expected}`);
  }
});
test('refractory input rejection and explicit stimulated-neuron exception',()=>{
  const b=new BrainCPU(pair()),rates=new Float32Array(2),events=new Uint8Array(2);
  b.v[1]=-44;b.activate(1);b.step(rates);
  assert.equal(b.until[1],22);
  for(let t=1;t<22;t++){events[1]=1;b.step(rates,events);assert.equal(b.v[1],-52);}
  b.step(rates,events);assert(b.v[1]>-45);
  const stimulated=new BrainCPU(pair());rates[1]=100;stimulated.v[1]=-44;stimulated.activate(1);stimulated.step(rates,new Uint8Array(2));assert.equal(stimulated.until[1],0);
});
test('outgoing conversion preserves direction, sign-independent weights, and duplicate edges',()=>{
  const g={n:3,offsets:new Uint32Array([0,1,3,4]),sources:new Uint32Array([2,0,0,1]),counts:new Uint32Array([5,8,3,9])};
  const out=outgoingGraph(g);
  assert.deepEqual([...out.offsets],[0,2,3,4]);assert.deepEqual([...out.targets],[1,1,2,0]);assert.deepEqual([...out.counts],[8,3,9,5]);
});
test('result contract rejects clock jumps, NaN rates and duplicate neurons',()=>{
  const good={tick:100,steps:100,rates:[0,0,0,0,0,0,20],total:2,wallMs:10,firing:[1],counts:[2]};
  validateResult(good,0,2);
  for(const patch of [{tick:200},{rates:[NaN,0,0,0,0,0,0]},{firing:[1,1],counts:[1,1]},{total:1},{counts:[101]}])assert.throws(()=>validateResult({...good,...patch},0,2));
});
test('pause holds in-flight results; duplicate delivery cannot advance the body twice',()=>{
  let w;const frames=[];
  const s=new Simulation({assetBase:'http://localhost',onResult:r=>frames.push(r),createWorker:()=>w={postMessage(){},terminate(){}}});
  const send=data=>w.onmessage({data});
  try{
    s.start();send({type:'ready',backend:'cpu'});s.togglePause();
    const result={type:'result',generation:0,tick:100,steps:100,rates:new Float32Array(7),total:0,wallMs:10,firing:[],counts:[]};
    send(result);assert.equal(s.body.time,0);assert.equal(frames.length,0);
    s.togglePause();assert.equal(s.body.time,.01);assert.equal(frames.length,1);
    send(result);assert.equal(s.body.time,.01);
    s.request();send({...result,tick:400});assert.equal(s.phase,'error');assert.equal(s.body.time,.01);
  }finally{s.dispose();}
});

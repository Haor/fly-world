import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/simulation.js';
import { Observations } from '../src/observations.js';
import { odorRateAt, FOOD, Habitat, randomSpawn, BOUND } from '../src/habitat.js';
import { antennaSamples } from '../src/olfaction.js';

function fixture() {
  const workers = [], frames = [];
  const sim = new Simulation({assetBase:'http://localhost/',onResult:r=>frames.push(r),createWorker:()=>{
    const w={sent:[],postMessage(m){this.sent.push(m);},terminate(){this.terminated=true;},emit(m){this.onmessage({data:m});}};
    workers.push(w);return w;
  }});
  return {sim,workers,frames};
}
const result = generation => ({type:'result',generation,rates:new Float32Array(7),steps:100,tick:100,wallMs:10,total:0,firing:new Uint32Array(),counts:new Uint16Array()});

test('reset rejects an outstanding result and preserves pause until explicitly resumed',()=>{
  const {sim,workers,frames}=fixture();
  try {
    sim.start();const w=workers[0];w.emit({type:'ready',backend:'cpu'});
    assert.equal(w.sent.at(-1).type,'step');
    sim.togglePause();sim.reset();w.emit(result(0));
    w.emit({type:'error',generation:0,message:'stale error'});assert.notEqual(sim.phase,'error');
    assert.equal(frames.length,0);assert.equal(sim.body.time,0);
    w.emit({type:'reset',generation:1});assert.equal(sim.pending,false);assert.equal(sim.paused,true);
    assert.equal(w.sent.at(-1).type,'reset');
    sim.togglePause();assert.equal(w.sent.at(-1).generation,1);
    w.emit(result(1));assert.equal(frames.length,1);assert.equal(sim.body.time,.01);
  } finally {sim.dispose();}
});

test('restart discards old worker messages and restores a fresh neural world',()=>{
  const {sim,workers}=fixture();
  try {
    sim.start();workers[0].emit({type:'ready',backend:'gpu'});sim.start('cpu');
    assert(workers[0].terminated);workers[0].emit(result(0));assert.equal(sim.body.time,0);
    workers[1].emit({type:'ready',backend:'cpu'});workers[1].emit(result(0));assert.equal(sim.body.time,.01);
  } finally {sim.dispose();}
});

test('manual pulses and continuous environment are independently controlled',()=>{
  const {sim,workers}=fixture();
  try {
    sim.world.options.mode='assisted';sim.start();workers[0].emit({type:'ready',backend:'cpu'});
    assert(workers[0].sent.at(-1).sensory.walk>0);
    sim.clear();assert.equal(workers[0].sent.at(-1).type,'clear');
    assert(sim.world.options.enabled);
    assert(sim.pulse([1],180));assert.equal(workers[0].sent.at(-1).type,'pulse');
    sim.world.options.enabled=false;sim.reset();workers[0].emit({type:'reset',generation:1});
    assert.equal(workers[0].sent.at(-1).sensory.walk,0);
  } finally {sim.dispose();}
});

test('observation records are bounded, debounced, and contain measured values',()=>{
  const observations=new Observations(),rates=[10,30,0,0,0,15,4];
  for(let i=0;i<2000;i++)observations.ingest({time:i/100,x:i/100,z:0,behavior:'Walking'},rates,{odor:2},5);
  assert(observations.samples.length<=122);assert.equal(observations.events.length,1);
  assert.equal(observations.spikes,10000);assert(Math.abs(observations.distance-19.99)<1e-6);
  const csv=observations.export();assert(csv.includes(',20,15,4,2,'));
  for(let i=0;i<100;i++)observations.event(i,'input "test"');
  assert.equal(observations.events.length,80);assert(observations.export().includes('"input ""test"""'));
  observations.reset();assert.equal(observations.samples.length,0);assert.equal(observations.events.length,0);
});

test('odor field visualization uses the same distance encoding as the neural input',()=>{
  assert.equal(odorRateAt(FOOD.x,FOOD.z),25);
  assert(odorRateAt(FOOD.x+7,FOOD.z)<25);
  assert.equal(odorRateAt(FOOD.x+7,FOOD.z),odorRateAt(FOOD.x-7,FOOD.z));
  const world=new Habitat({mode: 'assisted', odor:true});
  const pose={x:0,z:0,y:0,yaw:0,velocity:0};
  const raw=antennaSamples(pose,odorRateAt), sensed=world.sense(pose);
  assert.equal(sensed.odorLeft,raw.left); assert.equal(sensed.odorRight,raw.right);
  world.options.odor=false;assert.equal(world.sense(pose).odor,0);
});
test('changing the start resets neural history and preserves pause and sensory settings',()=>{
  const {sim,workers}=fixture();
  try {
    sim.start(); const w=workers[0];w.emit({type:'ready',backend:'cpu'});
    sim.togglePause();sim.world.options.foraging=false;
    const spawn=randomSpawn(()=>.7);sim.reset(spawn);
    assert(Math.abs(spawn.x)<BOUND && Math.abs(spawn.z)<BOUND);
    assert(Math.hypot(spawn.x-FOOD.x,spawn.z-FOOD.z)>6);
    assert.equal(sim.body.x,spawn.x);assert.equal(sim.body.yaw,spawn.yaw);
    assert.equal(sim.world.olfaction.time,null);assert.equal(sim.world.options.foraging,false);
    w.emit(result(0));assert.equal(sim.body.x,spawn.x);
    w.emit({type:'reset',generation:1});assert.equal(sim.paused,true);
    assert.equal(sim.body.time,0);assert.equal(sim.world.speed,0);
  } finally {sim.dispose();}
});

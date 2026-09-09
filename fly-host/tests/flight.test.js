import test from 'node:test';
import assert from 'node:assert/strict';
import {FlightReadout,flightPopulations} from '../src/flight-readout.js';
import {FlyController} from '../src/controller.js';
import {backgroundMask} from '../src/background.js';
import {Habitat,sensoryPopulations} from '../src/habitat.js';
const row=(id,type,side='L')=>[String(id),type,'descending_neuron',side,'acetylcholine',1,null];
const neurons=[row(1,'DNp01'),row(2,'DNg02_a'),row(3,'DNg02_g','R'),row(4,'DNp10'),row(5,'DNp02'),row(6,'DNp04'),row(7,'DNp11'),['8','DLMn a, b','vnc_motor','L','glutamate',-1,null],['9','DVMn 1a-c','vnc_motor','R','glutamate',-1,null]];
const zero=new Float32Array(7);
const observation=(spikes={},hz={})=>({spikes:{giantFiber:0,forward:0,backwardPrep:0,backwardJump:0,...spikes},hz:{steerLeft:0,steerRight:0,landing:0,muscleLeft:0,muscleRight:0,...hz}});
test('official DNg02 subtypes map to complete flight observations and never receive direct input',()=>{
 const decoder=new FlightReadout(neurons),groups=flightPopulations(neurons);
 assert.deepEqual(groups.steerLeft,[1]);assert.deepEqual(groups.steerRight,[2]);assert.deepEqual(groups.muscleLeft,[7]);assert.deepEqual(groups.muscleRight,[8]);
 assert.deepEqual([...backgroundMask(neurons)],Array(neurons.length).fill(0));
 const sensory=sensoryPopulations(neurons);for(const key of ['sugar','odorLeft','odorRight','visualLeft','visualRight'])assert.equal(sensory[key].length,0);
 const result=decoder.decode({firing:[0,2],counts:[1,2],steps:100});
 assert.equal(result.spikes.giantFiber,1);assert.equal(result.hz.steerRight,200);assert.equal(result.hz.steerLeft,0);
});
test('one raw GF event produces a jump, and no wing activity means a return to ground',()=>{
 const body=new FlyController();body.profile='adaptive';
 body.advance(zero,.01,0,observation({giantFiber:1}));assert.equal(body.takeoffs,1);assert(body.y>0);
 for(let i=0;i<800;i++)body.advance(zero,.01,0,observation());
 assert.equal(body.y,0);assert.equal(body.mode,'ground');assert.equal(body.takeoffs,1);
});
test('power alone cannot launch, but after a launch it sustains flight without a time limit',()=>{
 const body=new FlyController();const power=observation({}, {muscleLeft:8,muscleRight:8});
 for(let i=0;i<200;i++)body.advance(zero,.01,0,power);
 assert.equal(body.takeoffs,0);assert.equal(body.distance,0);assert.equal(body.y,0);
 body.advance(zero,.01,0,observation({giantFiber:1},power.hz));
 for(let i=0;i<300;i++)body.advance(zero,.01,0,power);
 assert.equal(body.takeoffs,1);assert(body.y>2.5&&body.y<3.5);assert(body.distance>30);
 for(let i=0;i<800;i++)body.advance(zero,.01,0,observation());
 assert.equal(body.y,0);assert.equal(body.mode,'ground');
});
test('landing activity terminates powered flight; zero output cannot create a takeoff',()=>{
 const body=new FlyController();
 for(let i=0;i<100;i++)body.advance(zero,.01,0,observation());
 assert.equal(body.takeoffs,0);assert.equal(body.distance,0);
 const hz={muscleLeft:8,muscleRight:8};
 for(let i=0;i<200;i++)body.advance(zero,.01,0,observation({},hz));
 body.advance(zero,.01,0,observation({giantFiber:1},hz));
 for(let i=0;i<50;i++)body.advance(zero,.01,0,observation({},hz));
 for(let i=0;i<100;i++)body.advance(zero,.01,0,observation({},{...hz,landing:50}));
 assert.equal(body.y,0);assert.equal(body.mode,'ground');
});
test('backward takeoff requires both preparation and jump activity in its short window',()=>{
 const body=new FlyController();body.advance(zero,.01,0,observation({backwardJump:1}));assert.equal(body.takeoffs,0);
 body.advance(zero,.01,0,observation({backwardPrep:1}));body.advance(zero,.01,0,observation({backwardJump:1}));
 assert.equal(body.takeoffs,1);assert.equal(body.launchDirection,-1);
 body.reset();body.advance(zero,.01,0,observation({backwardJump:1}));assert.equal(body.takeoffs,0);
});

test('altitude changes the next sensory sample, without direct movement inputs',()=>{
 const world=new Habitat(),body=new FlyController();world.reset(body);
 const ground=world.sense(body);body.y=3;const air=world.sense(body);
 assert(air.rawLeft<ground.rawLeft);assert(air.visualLeft<ground.visualLeft);
 for(const key of ['walk','left','right','looming'])assert.equal(air[key],0);
});

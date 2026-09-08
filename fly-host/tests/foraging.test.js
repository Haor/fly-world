import test from 'node:test';
import assert from 'node:assert/strict';
import { antennaSamples, Olfaction, forageDrive } from '../src/olfaction.js';
import { Habitat, FOOD, odorRateAt, sensoryPopulations, addSensoryRates } from '../src/habitat.js';
import { FlyController } from '../src/controller.js';

const config = {time: 1, hunger: .7, satiated: false, resting: false, contact: false, grounded: true, gain: 1};
test('bilateral sampling mirrors with the source and rotates with the body', () => {
  const pose = {x: 0, z: 0, yaw: 0};
  const sample = (p, x, z) => antennaSamples(p, (px, pz) => odorRateAt(px, pz, {x, z}));
  const left = sample(pose, 3, 5), right = sample(pose, -3, 5);
  assert(left.left > left.right); assert.equal(left.left, right.right);
  const rotated = sample({...pose, yaw: Math.PI / 2}, 5, -3);
  assert(Math.abs(rotated.left - left.left) < 1e-10);
  const rows = [[0,'ORN_DM1','', 'L'],[1,'ORN_DM1','', 'R'],[2,'ORN_DM1','', null]];
  assert.deepEqual([...addSensoryRates(new Float32Array(3), sensoryPopulations(rows), {odorLeft: 4, odorRight: 12})], [4,12,0]);
});

test('adaptation and odor history advance only with neural time and reset cleanly', () => {
  const odor = new Olfaction(), raw = {left: 20, right: 10};
  const first = odor.sample(raw, 0); assert.equal(first.odorLeft, 20);
  for (let i=1;i<=100;i++) odor.sample(raw,i*.01);
  const adapted = odor.sample(raw,1); assert(adapted.odorLeft < first.odorLeft);
  const state = JSON.stringify(odor);
  for (let i=0;i<10;i++) assert.deepEqual(odor.sample(raw,1), adapted);
  assert.equal(JSON.stringify(odor),state);
  assert(odor.sample({left:5,right:2},1.01).trend < 0);
  odor.reset(); assert.deepEqual(odor.sample(raw,0), first);
});

test('aid uses local sensory differences, casts on odor loss, and respects needs', () => {
  const sensed = {mean: 5, trend: 1, bias: .03};
  const l=forageDrive(sensed,config), r=forageDrive({...sensed,bias:-.03},config);
  assert(l.left>0 && l.right===0); assert.equal(l.left,r.right);
  assert.equal(forageDrive({...sensed,mean:0,bias:0},config).state,'search');
  assert.equal(forageDrive({...sensed,trend:-1,bias:0},config).state,'search');
  for(const change of [{satiated:true},{resting:true},{contact:true},{grounded:false},{gain:0}]) {
    const drive=forageDrive(sensed,{...config,...change});
    assert.equal(drive.walk+drive.left+drive.right,0);
  }
});

test('odor and aid switches are independent; silent readouts cannot move or feed', () => {
  const world=new Habitat(), body=new FlyController(); world.reset(body);
  world.options.foraging=false; assert(world.sense(body).odorLeft>0);
  assert.equal(world.signals.forageState,'inactive');
  world.options.foraging=true; world.options.odor=false;
  assert.equal(world.sense(body).odorLeft,0); assert.equal(world.signals.forageState,'inactive');
  world.options.odor=true;
  const start=body.pose();
  for(let i=0;i<100;i++){body.advance([0,0,0,0,0,0,0],.01);world.advance(body,body.rates,.01);}
  assert.equal(body.x,start.x); assert.equal(body.z,start.z); assert.equal(world.feeding,0);
  world.options.enabled=false;
  const s=world.sense(body); for(const k of ['walk','left','right','odorLeft','odorRight'])assert.equal(s[k],0);
});

// This isolates navigation geometry with a simple actuator. It is not evidence
// that the connectome finds food; foraging-loop.mjs tests that separate boundary.
test('local-sense navigation outperforms no odor and swapped antennae across randomized worlds', () => {
  let word=93471;
  const random=()=>{word=(Math.imul(word,1664525)+1013904223)>>>0;return word/4294967296;};
  const scores={normal:0,off:0,swapped:0};
  for(let trial=0;trial<40;trial++) {
    const food={x:random()*20-10,z:random()*20-10};
    const start={x:random()*20-10,z:random()*20-10,yaw:random()*Math.PI*2};
    for(const mode of Object.keys(scores)) {
      const pose={...start}, sensor=new Olfaction();
      for(let i=0;i<2500;i++) {
        const raw=antennaSamples(pose,(x,z)=>mode==='off'?0:odorRateAt(x,z,food));
        if(mode==='swapped')[raw.left,raw.right]=[raw.right,raw.left];
        const sensed=sensor.sample(raw,i*.01), drive=forageDrive(sensed,{...config,time:i*.01});
        pose.yaw+=(drive.left-drive.right)*.04*.01;
        const speed=drive.walk*.025;
        pose.x+=Math.sin(pose.yaw)*speed*.01;pose.z+=Math.cos(pose.yaw)*speed*.01;
        if(Math.hypot(pose.x-food.x,pose.z-food.z)<FOOD.radius){scores[mode]++;break;}
      }
    }
  }
  assert(scores.normal>=32,JSON.stringify(scores));
  assert(scores.normal>scores.off+20 && scores.normal>scores.swapped+20,JSON.stringify(scores));
});

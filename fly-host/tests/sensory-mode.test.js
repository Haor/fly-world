import test from 'node:test';
import assert from 'node:assert/strict';
import { Habitat, sensoryPopulations, addSensoryRates, SENSORY_KEYS } from '../src/habitat.js';
import { lightSamples } from '../src/environment-senses.js';
import { FlyController } from '../src/controller.js';
import { attachAnatomy, parseSkeleton } from '../src/anatomy.js';
import { incomingConnections } from '../src/connections.js';
import { fullLayout } from '../src/neuron-layout.js';
import { populations,CHANNELS } from '../src/stimulus.js';

test('pure sensation never adds walk, turn, or looming-population drive',()=>{
  const world=new Habitat(),body=new FlyController();world.reset(body);
  assert.equal(world.options.mode,'sensory');world.loom();
  for(let i=0;i<600;i++) {
    world.time=i*.01;body.x=Math.sin(i)*8;body.z=Math.cos(i)*8;
    const s=world.sense(body);
    for(const key of ['walk','left','right','looming'])assert.equal(s[key],0);
    assert.equal(s.forageState,'inactive');
  }
  world.options.vision=false;world.options.odor=false;world.options.taste=false;
  for(const key of SENSORY_KEYS)assert.equal(world.sense(body)[key],0);
});
test('light direction, intensity, and occlusion change vision but not motor commands',()=>{
  const pose={x:0,z:0,y:0,yaw:0},rock={x:30,z:30,radius:1};
  const left=lightSamples(pose,{light:1,lightAngle:45},rock);
  const right=lightSamples(pose,{light:1,lightAngle:-45},rock);
  assert(left.left>left.right);assert.equal(left.left,right.right);
  assert(lightSamples(pose,{light:2,lightAngle:45},rock).left>left.left);
  assert(lightSamples(pose,{light:1,lightAngle:45},rock,.8).left<left.left);
  const h=new Habitat();const initial=h.sense(pose);h.loom();h.time=.325;
  const shaded=h.sense(pose);assert(shaded.visualLeft<initial.visualLeft);
  assert.equal(shaded.looming,0);
});
test('sensory populations exclude every motor output; zero neural output remains stationary',()=>{
  const neurons=[['1','L2','ol_intrinsic','L','acetylcholine',1,null],['2','DNa02','descending_neuron','L','acetylcholine',1,null],
    ['3','ORN_DM1','cb_sensory','R','acetylcholine',1,null],['4','LB3b','cb_sensory','L','acetylcholine',1,null]];
  const sensory=sensoryPopulations(neurons),motor=populations(neurons);
  const output=new Set(CHANNELS.flatMap(k=>motor[k]));
  for(const key of ['visualLeft','visualRight','odorLeft','odorRight','sugar'])assert(sensory[key].every(i=>!output.has(i)));
  const world=new Habitat(),body=new FlyController();world.reset(body);const start=body.pose();
  for(let i=0;i<100;i++){body.advance(new Float32Array(7),.01);world.advance(body,body.rates,.01);}
  assert.equal(body.x,start.x);assert.equal(body.z,start.z);assert.equal(body.yaw,start.yaw);
  assert.equal(addSensoryRates(new Float32Array(4),sensory,world.sense(body))[1],0);
});
test('neural diagram uses real coordinates and resolves missing somas from skeletons',()=>{
  const neurons=[['1','','','','',0,[1,2,3]],['2','','','','',0,null],['3','','','','',0,[2,3,90000]]];
  const positioned=attachAnatomy(neurons,{positions:{'2':[30,40,50]}});
  const l=fullLayout(positioned,400,240);
  assert.equal(l.points.length,3);assert.equal(l.unlocated,0);
  assert.equal(new Set(l.points.map(p=>p.i)).size,3);
  assert(l.points.every(p=>p.x>=0&&p.x<=400&&p.y>=0&&p.y<=240));
  assert.equal(positioned[1][7].positionSource,'skeleton-centroid');
  assert.equal(fullLayout(neurons,400,240).points.length,2);
  assert.equal(attachAnatomy(positioned,{})[1][7].positionSource,'skeleton-centroid');
});

test('official skeleton parsing preserves branches and validates parent identities',()=>{
  const s=parseSkeleton('# test\n1 0 1 2 3 1 -1\n2 0 4 5 6 1 1\n3 0 7 8 9 1 1');
  assert.equal(s.vertices,3);assert.equal(s.segments.length,2);
  assert.deepEqual(s.segments[1],[[7,8,9],[1,2,3]]);
  assert.throws(()=>parseSkeleton('1 0 1 2 3 1 99'),/parent/);
});
test('connection inspection returns incoming edges without advancing neural state',()=>{
  const graph={neurons:[['1'],['2'],['3']],offsets:[0,0,2,2],sources:[0,2],counts:[5,9]};
  const result=incomingConnections(graph,'2',1);
  assert.equal(result.total,2);assert.deepEqual(result.items,[{bodyId:'3',weight:9}]);
});

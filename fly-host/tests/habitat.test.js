import { HabitatView } from '../src/habitat-view.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Habitat, FOOD, BOUND, mmToTile, tileToMM, sensoryPopulations, addSensoryRates } from '../src/habitat.js';
import { FlyController } from '../src/controller.js';
import { PulseBank, populations, CHANNELS, compactReadout, decodeCounts } from '../src/stimulus.js';

test('sensory input is continuous, independent from pulse clear, and can be disabled', () => {
  const rows = [['0', 'LC9'], ['1', 'LB3b'], ['2', 'MN9'], ['3', 'LC4']];
  const groups = sensoryPopulations(rows), pulses = new PulseBank(4);
  pulses.add([2], 0, 100); pulses.reset();
  assert.deepEqual([...addSensoryRates(pulses.sample(0), groups, {sugar: 100})], [0, 100, 0, 0]);
  assert.deepEqual([...addSensoryRates(pulses.sample(100), groups, {})], [0, 0, 0, 0]);
});

test('feeding requires food contact and neural MN9 output', () => {
  const world = new Habitat(), body = new FlyController(); world.reset(body);
  body.rates[6] = 100; world.advance(body, body.rates, .01);
  assert.equal(world.feeding, 0);
  body.x = FOOD.x; body.z = FOOD.z - .9; body.rates[6] = 0;
  world.advance(body, body.rates, .01); assert.equal(world.feeding, 0);
  body.rates[6] = 35; world.advance(body, body.rates, .01); assert.equal(world.feeding, 1);
  const eaten = world.feedSeconds;
  body.y = 1; world.advance(body, body.rates, .01); assert.equal(world.feedSeconds, eaten);
  body.y = 0; world.options.taste = false; world.advance(body, body.rates, .01);
  assert.equal(world.feeding, 0); assert.equal(world.sense(body).sugar, 0);
});

test('reset reproduces the trajectory of the authored drive, needs and world clock', () => {
  const world = new Habitat(), body = new FlyController();
  const sample = () => {
    body.reset(); world.reset(body);
    const values = [];
    for (let i = 0; i < 800; i++) { world.advance(body, body.rates, .01); values.push(world.snapshot()); }
    return values;
  };
  assert.deepEqual(sample(), sample());
});

test('world bounds constrain positions without changing heading, including after reset', () => {
  const world = new Habitat(), body = new FlyController();
  body.x = 100; body.z = -100; body.yaw = .7;
  world.advance(body, body.rates, .01);
  assert.equal(body.x, BOUND); assert.equal(body.z, -BOUND); assert.equal(body.yaw, .7);
  assert.equal(mmToTile(tileToMM(1)), 1);
  world.reset(body); assert.equal(mmToTile(body.x), 1);
});

test('environment clock and looming freeze between neural advances', () => {
  const world = new Habitat(), body = new FlyController(); world.reset(body); world.loom();
  const before = world.snapshot();
  for (let i = 0; i < 10; i++) world.sense(body);
  assert.equal(world.time, before.time); assert.equal(world.snapshot().loomingStimulus, true);
  world.options.vision = false; assert.equal(world.sense(body).looming, 0);
  world.options.enabled = false;
  for (const key of ['walk', 'left', 'right', 'looming', 'sugar', 'odor']) assert.equal(world.sense(body)[key], 0);
});

test('looming stimulus expires in neural time, resets, and never recurs automatically', () => {
  const world = new Habitat({exploration: 0}), body = new FlyController(); world.reset(body);
  world.loom(); assert.equal(world.sense(body).looming, 120);
  for (let i=0;i<64;i++) world.advance(body, body.rates, .01);
  assert.equal(world.sense(body).looming, 120);
  for (let i=0;i<1500;i++) world.advance(body, body.rates, .01);
  assert.equal(world.snapshot().loomingStimulus, false);
  assert.equal(world.sense(body).looming, 0);
  world.loom(); world.reset(body);
  assert.equal(world.sense(body).looming, 0);
});

test('a blocked body stops looming input instead of maintaining an escape latch', () => {
  const world = new Habitat(), body = new FlyController(); world.reset(body);
  body.x = 0; body.z = BOUND; body.velocity = 8;
  world.advance(body, body.rates, .01);
  body.z += .08;
  world.advance(body, body.rates, .01);
  assert.equal(world.speed, 0); assert.equal(world.sense(body).looming, 0);
});

test('CPU and compact GPU readout include the same seventh feeding channel', () => {
  const rows = [['0', 'MN9'], ['1', 'MN9'], ['2', 'DNp09', '', 'L']];
  const groups = populations(rows), counts = new Float32Array([1, 3, 5]);
  const cpu = decodeCounts(counts, groups, 100);
  const compact = compactReadout(groups);
  assert.equal(CHANNELS.length, 7); assert.equal(cpu[6], 200);
  for (let c = 0; c < CHANNELS.length; c++) {
    let actual = 0;
    compact.indices.forEach((id, i) => { actual += counts[id] * compact.weights[c * compact.width + i] * 100; });
    assert.equal(actual, cpu[c]);
  }
});

test('rendering shadows change drawing only, with no sensory or world-state mutation', () => {
  const world = new Habitat(), body = new FlyController(); world.reset(body);
  const calls = [], context = new Proxy({}, { get(target, key) {
    return key in target ? target[key] : (...args) => calls.push([key, ...args]);
  }});
  const view = new HabitatView({getContext: () => context}, world);
  const signals = {...world.sense(body)}, before = JSON.stringify(world);
  view.update(body.pose()); assert(calls.some(c => c[0] === 'ellipse'));
  calls.length = 0; view.showShadows = false; view.update(body.pose());
  assert(!calls.some(c => c[0] === 'ellipse'));
  assert.deepEqual(world.sense(body), signals);
  assert.equal(JSON.stringify(world), before);
  world.loom(); assert.equal(world.sense(body).looming, 120);
  assert.equal(view.showShadows, false);
});

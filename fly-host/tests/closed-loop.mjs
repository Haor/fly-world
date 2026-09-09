import assert from 'node:assert/strict';
import { BrainCPU } from '../src/brain.js';
import { populations, decodeCounts } from '../src/stimulus.js';
import { Habitat, FOOD, BOUND, sensoryPopulations, addSensoryRates } from '../src/habitat.js';
import { FlightReadout } from '../src/flight-readout.js';
import { FlyController } from '../src/controller.js';
import { loadLocalGraph } from './load-graph.js';

const graph = loadLocalGraph(), brain = new BrainCPU(graph);
const flightReadout=new FlightReadout(graph.neurons);
const groups = populations(graph.neurons), sensory = sensoryPopulations(graph.neurons);
const input = new Float32Array(graph.n);
const results = [];
function run(name, seconds, options = {}, configure = () => {}, silenced = false) {
  brain.reset();
  // Preserve the original no-odor baseline; foraging-loop.mjs tests the new aid.
  const world = new Habitat({mode: 'assisted', odor: false, ...options}), body = new FlyController();
  world.reset(body); configure(world, body);
  const start = performance.now();
  let peakSpikes = 0, maxFeed = 0, peakMN9 = 0, lastFeedDistance = null;
  for (let i = 0; i < Math.round(seconds * 100); i++) {
    input.fill(0);
    addSensoryRates(input, sensory, world.sense(body));
    const result = brain.batch(100, input, silenced);
    const firing=[],counts=[];for(let j=0;j<graph.n;j++)if(result.counts[j]){firing.push(j);counts.push(result.counts[j]);}
    body.advance(decodeCounts(result.counts, groups, 100), .01, world.feeding,flightReadout.decode({firing,counts,steps:100}));
    world.advance(body, body.rates, .01);
    peakSpikes = Math.max(peakSpikes, result.total);
    peakMN9 = Math.max(peakMN9, body.rates[6]);
    maxFeed = Math.max(maxFeed, world.feeding);
    if (world.feeding > 0) lastFeedDistance = body.distance;
    assert(Number.isFinite(body.x) && Number.isFinite(body.z));
    assert(Math.abs(body.x) <= BOUND && Math.abs(body.z) <= BOUND);
    if (i % 100 === 99) console.log(name, 'neural seconds', i / 100 + .01, 'distance', body.distance.toFixed(2), 'feed', world.feedSeconds.toFixed(2));
  }
  const result = { name, seconds, distance: body.distance, takeoffs: body.takeoffs,
    feedSeconds: world.feedSeconds, maxFeed, peakMN9, peakSpikes,
    position: [body.x, body.z], distanceAfterFeed: lastFeedDistance === null ? 0 : body.distance - lastFeedDistance,
    wallMs: Math.round(performance.now() - start) };
  results.push(result); console.log(JSON.stringify(result));
  return result;
}
const rest = run('no-input', .3, {enabled: false});
assert.equal(rest.peakSpikes, 0); assert.equal(rest.distance, 0);
const explore = run('autonomous', 12);
assert(explore.distance > 1, 'Tonic drive must produce movement through the network');
assert(explore.feedSeconds > .05, 'The default approach must reach food and recruit feeding');
assert(explore.distanceAfterFeed > 1, 'The satiated fly must resume exploration');
const contact = (_w, b) => { b.x = FOOD.x; b.z = FOOD.z - .9; };
const taste = run('sugar-contact', .5, {exploration: 0, vision: false}, contact);
assert(taste.maxFeed > 0 && taste.peakMN9 > 12);
const noTaste = run('taste-disabled', .3, {exploration: 0, vision: false, taste: false}, contact);
assert.equal(noTaste.feedSeconds, 0); assert.equal(noTaste.peakSpikes, 0);
const odor = run('odor-away-from-food', .3, {exploration: 0, vision: false, odor: true});
assert.equal(odor.feedSeconds, 0);
const loom = run('looming', .5, {exploration: 0, taste: false}, w => w.loom());
assert(loom.takeoffs > 0);
const noVision = run('vision-disabled', .3, {exploration: 0, taste: false, vision: false}, w => w.loom());
assert.equal(noVision.takeoffs, 0); assert.equal(noVision.peakSpikes, 0);
const cut = run('propagation-disabled', .5, {exploration: 0}, (w, b) => { contact(w, b); w.loom(); }, true);
assert.equal(cut.takeoffs, 0); assert.equal(cut.peakMN9, 0); assert.equal(cut.distance, 0);
console.log('Closed-loop integration: PASS', JSON.stringify(results));

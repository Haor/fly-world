/** Retained-connectome integration, not a surrogate motion test. */
import assert from 'node:assert/strict';
import { BrainCPU } from '../src/brain.js';
import { populations, decodeCounts } from '../src/stimulus.js';
import { Habitat, FOOD, sensoryPopulations, addSensoryRates } from '../src/habitat.js';
import { FlyController } from '../src/controller.js';
import { loadLocalGraph } from './load-graph.js';

const graph = loadLocalGraph(), brain = new BrainCPU(graph);
const groups = populations(graph.neurons), sensory = sensoryPopulations(graph.neurons);
const input = new Float32Array(graph.n);
const seconds = Number(process.env.FORAGE_SECONDS || 12);
const trials = Number(process.env.FORAGE_TRIALS || 4);
const modes = (process.env.FORAGE_MODES || 'assisted,odor-off,aid-off').split(',');
let seed = 4729;
function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
const starts = Array.from({length: trials}, () => ({x: -5 + random() * 16, z: -10 + random() * 15, yaw: random() * Math.PI * 2}));
const summaries = [];
for (const [trial, start] of starts.entries()) for (const mode of modes) {
  brain.seed = trial + 1; brain.reset();
  const world = new Habitat({odor: mode !== 'odor-off', foraging: mode !== 'aid-off'});
  const body = new FlyController(); world.reset(body); Object.assign(body, start);
  world.previousX = body.x; world.previousZ = body.z;
  let firstContact = null, firstFeed = null, spikes = 0;
  const began = performance.now();
  for (let step = 0; step < seconds * 100; step++) {
    input.fill(0); addSensoryRates(input, sensory, world.sense(body));
    const result = brain.batch(100, input);
    body.advance(decodeCounts(result.counts, groups, 100), .01, world.feeding);
    world.advance(body, body.rates, .01); spikes += result.total;
    if (world.contact(body) && firstContact === null) firstContact = world.time;
    if (world.feeding > 0 && firstFeed === null) firstFeed = world.time;
    if (step % 200 === 199) console.log(JSON.stringify({progress: true, trial, mode, t: world.time, x: body.x, z: body.z,
      yaw: body.yaw, distance: Math.hypot(body.x-FOOD.x,body.z-FOOD.z), feed: world.feedSeconds,
      input: world.signals, output: [...body.rates]}));
    if (firstFeed !== null) break;
  }
  const summary = {trial, mode, start, firstContact, firstFeed, spikes, finalDistance: Math.hypot(body.x-FOOD.x,body.z-FOOD.z), wallMs: performance.now()-began};
  summaries.push(summary); console.log(JSON.stringify(summary));
}
console.log('FORAGING_RESULTS', JSON.stringify(summaries));
if (trials >= 3 && ['assisted','odor-off','aid-off'].every(mode => modes.includes(mode))) {
  const successes = mode => summaries.filter(r => r.mode === mode && r.firstFeed !== null).length;
  assert(successes('assisted') >= 2, 'Aid must find food from multiple random starts');
  assert(successes('assisted') > successes('odor-off'), 'Aid must beat odor-off in paired trials');
  assert(successes('assisted') > successes('aid-off'), 'Aid must beat sensory input alone in paired trials');
  console.log('Paired retained-connectome foraging: PASS');
}

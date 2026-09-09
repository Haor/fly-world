import { sensoryGain, lightSamples } from './environment-senses.js';
import { populations, CHANNELS } from './stimulus.js';
import { antennaSamples, Olfaction, forageDrive } from './olfaction.js';
/** Authored environment and sensory encoders. Distances are mm; time is neural seconds. */
export const TILE_SCALE = 0.16;
export const tileToMM = t => (t - 2.5) / TILE_SCALE;
export const mmToTile = x => 2.5 + x * TILE_SCALE;
export const odorRateAt = (x, z, food = FOOD, height = 0) => 25 * Math.exp(-Math.hypot(x - food.x, z - food.z, Math.max(0,height)) / 7);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const FOOD = Object.freeze({ x: tileToMM(1), z: tileToMM(4), radius: 1.4 });
export const ROCK = Object.freeze({ x: tileToMM(5), z: tileToMM(2), radius: 2.2 });
export const BOUND = tileToMM(4.65);
export const WORLD_DEFAULTS = Object.freeze({ enabled: true, exploration: 1, vision: true, taste: true, odor: true, foraging: true, mode: 'sensory', light: 1, lightAngle: 0, sensoryGain: 1 });
export const SENSORY_ENCODING = 'population-hz/3';
export const SENSORY_KEYS = Object.freeze(['walk', 'left', 'right', 'looming', 'sugar', 'odorLeft', 'odorRight', 'visualLeft', 'visualRight']);
export function randomSpawn(random = Math.random) {
  return {x: -10 + random() * 20, z: -10 + random() * 13, yaw: random() * Math.PI * 2};
}

export class Habitat {
  constructor(options = {}) {
    this.options = { ...WORLD_DEFAULTS, ...options };
    this.reset();
  }
  reset(controller) {
    this.time = 0;
    this.hunger = 0.7;
    this.energy = 0.9;
    this.feeding = 0;
    this.satiated = false;
    this.resting = false;
    this.feedSeconds = 0;
    this.loomUntil = 0;
    this.olfaction = new Olfaction();
    this.speed = 0;
    this.previousX = null;
    this.previousZ = null;
    this.signals = this.emptySignals();
    if (controller) {
      controller.x = FOOD.x;
      controller.z = tileToMM(2.7);
      controller.yaw = 0;
      this.previousX = controller.x;
      this.previousZ = controller.z;
    }
  }
  loom() { this.loomUntil = this.time + 0.65; }
  emptySignals() {
    return { walk: 0, left: 0, right: 0, looming: 0, sugar: 0, odor: 0,
      odorLeft: 0, odorRight: 0, rawLeft: 0, rawRight: 0, odorTrend: 0, visualLeft: 0, visualRight: 0,
      forageState: 'inactive', contact: false };
  }
  contact(pose) {
    const hx = pose.x + Math.sin(pose.yaw) * 0.9;
    const hz = pose.z + Math.cos(pose.yaw) * 0.9;
    return pose.y < 0.15 && Math.hypot(hx - FOOD.x, hz - FOOD.z) < FOOD.radius;
  }
  sense(pose) {
    const s = { ...this.emptySignals(), contact: this.contact(pose) };
    if (!this.options.enabled) { this.olfaction.reset(); return this.signals = s; }
    const t = this.time;
    const eatingContact = this.options.taste && s.contact && !this.satiated;
    // A targeted tonic drive and seeded turn bias are explicit engineering assumptions.
    // They do not encode food direction and are not endogenous MaleCNS activity.
    const active = t % 4 < 3.3 && !this.resting;
    const gain = this.options.exploration * (0.5 + this.energy * 0.5);
    s.walk = active && !eatingContact ? (170 + 30 * Math.sin(t * 2.1)) * gain : 0;
    const episode = Math.floor(t / 2.8);
    let word = (Math.imul(episode + 1, 1664525) + 1013904223) >>> 0;
    word = Math.imul(word ^ (word >>> 16), 2246822519) >>> 0;
    word ^= word >>> 13;
    const turning = t > 1.5 && t % 2.8 > 1.7 && !eatingContact && active;
    if (this.options.mode === 'sensory') { s.walk = 0; }
    if (turning && this.options.mode !== 'sensory') s[word & 1 ? 'left' : 'right'] = 65 * gain;
    if (this.options.taste && eatingContact) s.sugar = 100;
    if (this.options.odor) {
      const odor = this.olfaction.sample(antennaSamples(pose, (x,z)=>odorRateAt(x,z,{x:this.options.odorX??FOOD.x,z:this.options.odorZ??FOOD.z},pose.y)*(this.options.odorStrength??1)), t);
      Object.assign(s, {odorLeft: odor.odorLeft, odorRight: odor.odorRight,
        rawLeft: odor.rawLeft, rawRight: odor.rawRight, odorTrend: odor.trend,
        odor: (odor.odorLeft + odor.odorRight) / 2});
      if (this.options.mode !== 'sensory' && this.options.foraging && !this.satiated && !this.resting) {
        const drive = forageDrive(odor, {time: t, hunger: this.hunger, satiated: this.satiated,
          resting: this.resting, contact: eatingContact, grounded: pose.y < .15, gain});
        s.walk = drive.walk; s.left = drive.left; s.right = drive.right;
        s.forageState = drive.state;
      }
    } else this.olfaction.reset();
    if (this.options.vision && this.options.mode === 'sensory') {
      const age = .65 - (this.loomUntil - t);
      const occlusion = t < this.loomUntil ? .85 * Math.sin(Math.PI * Math.max(0, age) / .65) : 0;
      const light = lightSamples(pose, this.options, ROCK, occlusion);
      s.visualLeft = sensoryGain(light.left, this.options.sensoryGain);
      s.visualRight = sensoryGain(light.right, this.options.sensoryGain);
    }
    if (this.options.vision && this.options.mode !== 'sensory') {
      const forward = { x: Math.sin(pose.yaw), z: Math.cos(pose.yaw) };
      const speed = this.speed;
      const rays = [];
      if (Math.abs(forward.x) > 0.001) rays.push((Math.sign(forward.x) * BOUND - pose.x) / forward.x);
      if (Math.abs(forward.z) > 0.001) rays.push((Math.sign(forward.z) * BOUND - pose.z) / forward.z);
      const rx = ROCK.x - pose.x, rz = ROCK.z - pose.z;
      const along = rx * forward.x + rz * forward.z;
      const cross = Math.abs(rx * forward.z - rz * forward.x);
      if (along > 0 && cross < ROCK.radius) rays.push(along - Math.sqrt(ROCK.radius ** 2 - cross ** 2));
      const distance = Math.max(0.2, Math.min(...rays.filter(x => x >= 0)));
      // Analytic looming features bypass the uncalibrated retina, driving LC4/LPLC2.
      s.looming = pose.y < 0.2 ? 120 * clamp((speed / distance - 3) / 3, 0, 1) : 0;
      if (t < this.loomUntil) s.looming = Math.max(s.looming, 120);
    }
    return this.signals = s;
  }
  advance(controller, rates, dt) {
    // Contact is a physical constraint; it never changes yaw or invents a motor command.
    controller.x = clamp(controller.x, -BOUND, BOUND);
    controller.z = clamp(controller.z, -BOUND, BOUND);
    if (controller.y < 0.4) {
      const dx = controller.x - ROCK.x, dz = controller.z - ROCK.z;
      const d = Math.hypot(dx, dz);
      if (d < ROCK.radius) {
        controller.x = clamp(ROCK.x + (d > 0 ? dx / d : -1) * ROCK.radius, -BOUND, BOUND);
        controller.z = clamp(ROCK.z + (d > 0 ? dz / d : 0) * ROCK.radius, -BOUND, BOUND);
      }
    }
    this.speed = this.previousX === null ? 0 : Math.hypot(controller.x - this.previousX, controller.z - this.previousZ) / dt;
    this.previousX = controller.x;
    this.previousZ = controller.z;
    this.time += dt;
    this.feeding = this.options.enabled && this.options.taste && this.contact(controller) &&
      !this.satiated && rates[6] > 12 ? clamp(rates[6] / 35, 0, 1) : 0;
    this.feedSeconds += dt * this.feeding;
    if (this.options.enabled) {
      this.hunger = clamp(this.hunger + dt * (0.008 - this.feeding * 0.45), 0, 1);
      this.energy = clamp(this.energy + dt * (Math.abs(controller.velocity) > 0.15 ? -0.012 : 0.03), 0, 1);
      if (this.hunger < 0.25) this.satiated = true;
      if (this.hunger > 0.65) this.satiated = false;
      if (this.energy < 0.18) this.resting = true;
      if (this.energy > 0.75) this.resting = false;
    }
    if (this.feeding > 0) controller.behavior = 'Feeding';
    this.sense(controller);
    return controller.pose();
  }
  snapshot() {
    if(this.remoteSnapshot)return this.remoteSnapshot;
    return { ...this.signals, mode:this.options.mode, light:this.options.light,lightAngle:this.options.lightAngle,
      occlusion: this.options.mode==='sensory'&&this.time<this.loomUntil ? .85*Math.sin(Math.PI*(.65-this.loomUntil+this.time)/.65) : 0, time: this.time, hunger: this.hunger, energy: this.energy,
      feeding: this.feeding, feedSeconds: this.feedSeconds, loomingStimulus: this.options.enabled && this.options.vision && this.time < this.loomUntil };
  }
}

export function sensoryPopulations(neurons) {
  const g = Object.fromEntries(SENSORY_KEYS.map(key => [key, []]));
  neurons.forEach((r, i) => {
    if (r[1] === 'LC9') g.walk.push(i);
    if (r[1] === 'DNa02' && r[3] === 'L') g.left.push(i);
    if (r[1] === 'DNa02' && r[3] === 'R') g.right.push(i);
    if (['LC4', 'LPLC2'].includes(r[1])) g.looming.push(i);
    if (['LB3b', 'LB3c'].includes(r[1])) g.sugar.push(i);
    if (r[1] === 'ORN_DM1' && r[3] === 'L') g.odorLeft.push(i);
    if (r[1] === 'ORN_DM1' && r[3] === 'R') g.odorRight.push(i);
    if (['L1','L2'].includes(r[1]) && r[3] === 'L') g.visualLeft.push(i);
    if (['L1','L2'].includes(r[1]) && r[3] === 'R') g.visualRight.push(i);
  });
  const output = populations(neurons);
  const motor = new Set(CHANNELS.flatMap(key => output[key]));
  for (const key of ['odorLeft','odorRight','sugar','visualLeft','visualRight'])
    g[key] = g[key].filter(i => !motor.has(i));
  return g;
}

export function addSensoryRates(rates, groups, signals) {
  for (const [key, ids] of Object.entries(groups)) {
    const hz = clamp(Number.isFinite(signals?.[key]) ? signals[key] : 0, 0, 300);
    for (const id of ids) rates[id] = Math.max(rates[id], hz);
  }
  return rates;
}

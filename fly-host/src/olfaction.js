/** Authored sensory encoding and navigation aid. No food coordinates enter the aid. */
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export function antennaSamples(pose, field) {
  const forwardX = Math.sin(pose.yaw), forwardZ = Math.cos(pose.yaw);
  const x = pose.x + forwardX * .9, z = pose.z + forwardZ * .9;
  // +yaw is the controller's left turn, towards (+cos(yaw), -sin(yaw)).
  return {
    left: field(x + forwardZ * .3, z - forwardX * .3),
    right: field(x - forwardZ * .3, z + forwardX * .3),
  };
}

export class Olfaction {
  constructor() { this.reset(); }
  reset() { this.time = null; this.baseline = [0, 0]; this.mean = 0; this.trend = 0; this.bias = 0; }
  sample(raw, time) {
    const mean = (raw.left + raw.right) / 2;
    if (this.time === null) { this.time = time; this.mean = mean; }
    const dt = Math.max(0, time - this.time);
    if (dt > 0) {
      const smooth = 1 - Math.exp(-dt / .25);
      this.trend += ((mean - this.mean) / dt - this.trend) * smooth;
      this.bias += ((raw.left - raw.right) / Math.max(.5, raw.left + raw.right) - this.bias) * smooth;
      for (const [i, value] of [raw.left, raw.right].entries())
        this.baseline[i] += (value - this.baseline[i]) * (1 - Math.exp(-dt / 2));
      this.mean = mean; this.time = time;
    }
    return { rawLeft: raw.left, rawRight: raw.right,
      odorLeft: clamp(raw.left - .6 * this.baseline[0], 0, 25),
      odorRight: clamp(raw.right - .6 * this.baseline[1], 0, 25),
      trend: this.trend, bias: this.bias, mean };
  }
}

export function forageDrive(sense, { time, hunger, satiated, resting, contact, grounded, gain }) {
  if (satiated || resting || contact || !grounded || gain <= 0)
    return { walk: 0, left: 0, right: 0, state: contact ? 'contact' : 'inactive' };
  const detected = sense.mean > .35;
  const losing = sense.trend < -.12;
  let turn = clamp(sense.bias * 36, -1, 1);
  // Falling or absent odor prompts a local casting turn. A deterministic episode
  // bias breaks the exactly rear-facing symmetry without consulting the source.
  if (!detected || (losing && Math.abs(turn) < .35))
    turn = (Math.floor(time / 2.8) % 2 ? -1 : 1) * .8;
  const motivation = .5 + .5 * hunger;
  return {
    walk: (240 - 130 * Math.abs(turn)) * gain * motivation,
    left: Math.max(0, turn) * 75 * gain,
    right: Math.max(0, -turn) * 75 * gain,
    state: !detected || losing ? 'search' : 'track',
  };
}

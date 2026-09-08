export const BEHAVIORS = Object.freeze({'At rest':'静止观察','Walking':'步行探索','Walking backward':'向后移动','Turning left':'向左转向','Turning right':'向右转向','Feeding':'接触进食','Taking off':'起飞','Escape flight':'逃逸飞行','Landing':'降落'});
export const behaviorLabel = value => BEHAVIORS[value] || value;
/** Bounded, neural-clock records. No events or chart values are fabricated. */
export class Observations {
  constructor() { this.reset(); }
  reset() { this.samples = []; this.events = []; this.lastSample = -1; this.behavior = null; this.candidate = null; this.since = 0; this.spikes = 0; this.distance = 0; this.previous = null; }
  event(time, label) {
    this.events.unshift({time,label}); if (this.events.length > 80) this.events.pop();
  }
  ingest(pose, rates, world, total) {
    this.spikes += total;
    if (this.previous) this.distance += Math.hypot(pose.x-this.previous.x,pose.z-this.previous.z);
    this.previous = {x:pose.x,z:pose.z};
    if (pose.time - this.lastSample >= .099) {
      this.samples.push({time:pose.time,walk:(rates[0]+rates[1])/2,escape:rates[5],feed:rates[6],odor:world.odor,x:pose.x,z:pose.z,
        odorLeft:world.odorLeft,odorRight:world.odorRight,odorTrend:world.odorTrend,forageState:world.forageState});
      this.lastSample = pose.time;
      while (this.samples.length && this.samples[0].time < pose.time - 12) this.samples.shift();
    }
    if (pose.behavior !== this.candidate) { this.candidate = pose.behavior; this.since = pose.time; }
    if (this.candidate !== this.behavior && pose.time - this.since >= .12) {
      this.behavior = this.candidate; this.event(pose.time, behaviorLabel(this.behavior));
    }
  }
  export() {
    const quote = x => `"${String(x).replaceAll('"','""')}"`;
    return ['type,neural_seconds,description,walk_hz,escape_hz,feed_hz,odor_input_hz,x_mm,z_mm,odor_left_hz,odor_right_hz,odor_trend_hz_per_s,forage_state',
      ...this.samples.map(s => ['sample',s.time.toFixed(3),'',s.walk,s.escape,s.feed,s.odor,s.x,s.z,s.odorLeft,s.odorRight,s.odorTrend,s.forageState].join(',')),
      ...[...this.events].reverse().map(e => ['event',e.time.toFixed(3),quote(e.label),...Array(10).fill('')].join(','))].join('\n');
  }
}

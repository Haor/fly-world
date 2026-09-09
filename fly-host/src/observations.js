export const BEHAVIORS = Object.freeze({'Airborne':'离地','Falling':'下落','Surface motion':'地面移动','At rest':'静止观察','Walking':'步行探索','Walking backward':'向后移动','Turning left':'向左转向','Turning right':'向右转向','Feeding':'接触进食','Taking off':'起飞','Escape flight':'逃逸飞行','Landing':'降落','Flight':'飞行','Jumping':'短跳'});
export const behaviorLabel = value => BEHAVIORS[value] || value;
/** Bounded, neural-clock records. No events or chart values are fabricated. */
export class Observations {
  constructor() { this.reset(); }
  reset() { this.samples = []; this.events = []; this.lastSample = -1; this.behavior = null; this.candidate = null; this.since = 0; this.spikes = 0; this.distance = 0; this.previous = null; this.lastTick=0; this.unobservedSteps=0; }
  event(time, label) {
    this.events.unshift({time,label}); if (this.events.length > 80) this.events.pop();
  }
  ingest(pose, rates, world, total, frame = {}) {
    const gap=Number.isInteger(frame.fromTick)?Math.max(0,frame.fromTick-this.lastTick):0;
    this.unobservedSteps+=gap;
    if(gap)this.event(pose.time,`观察数据缺口 ${(gap*.0001).toFixed(3)} s`);
    if(Number.isInteger(frame.tick))this.lastTick=frame.tick;
    this.spikes = Number.isInteger(frame.cumulativeSpikes)?frame.cumulativeSpikes:this.spikes+total;
    if (this.previous) this.distance += Math.hypot(pose.x-this.previous.x,pose.z-this.previous.z);
    this.previous = {x:pose.x,z:pose.z};
    if (pose.time - this.lastSample >= .099) {
      this.samples.push({time:pose.time,walk:(rates[0]+rates[1])/2,escape:rates[5],feed:rates[6],odor:world.odor,x:pose.x,z:pose.z,
        odorLeft:world.odorLeft,odorRight:world.odorRight,odorTrend:world.odorTrend,forageState:world.forageState,dynamics:world.dynamics,background:world.background,visualLeft:world.visualLeft,visualRight:world.visualRight,
        cumulativeSpikes:this.spikes,unobservedSeconds:this.unobservedSteps*.0001,physical:!!pose.physical,contacts:pose.contacts,actuation:pose.actuation});
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
    return ['type,neural_seconds,description,walk_readout_hz,escape_readout_hz,feed_readout_hz,odor_input_hz,x_mm,z_mm,odor_left_hz,odor_right_hz,odor_trend_hz_per_s,forage_state,dynamics,background,visual_left_hz,visual_right_hz,cumulative_spikes,unobserved_seconds,physical,contacts,actuation_norm',
      ...this.samples.map(s => ['sample',s.time.toFixed(3),'',s.walk,s.escape,s.feed,s.odor,s.x,s.z,s.odorLeft,s.odorRight,s.odorTrend,s.forageState,s.dynamics,s.background,s.visualLeft,s.visualRight,s.cumulativeSpikes,s.unobservedSeconds,s.physical,s.contacts,s.actuation].join(',')),
      ...[...this.events].reverse().map(e => ['event',e.time.toFixed(3),quote(e.label),...Array(19).fill('')].join(','))].join('\n');
  }
}

/** Engineered rate decoder. Body units: mm, seconds, radians; +yaw turns left. */
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const relax = (value, target, dt, tau) => value + (target - value) * (1 - Math.exp(-dt / tau));
export function restPose() {
  return {
    x: 0,
    z: 0,
    y: 0,
    yaw: 0,
    velocity: 0,
    yawRate: 0,
    phase: 0,
    time: 0,
    pitch: 0,
    bank: 0,
    wingOpen: 0,
    flightBlend: 0,
    launch: 0,
    landing: 0,
    behavior: 'At rest',
  };
}
export class FlyController {
  constructor() {
    this.reset();
  }
  reset() {
    this.remotePose=null;Object.assign(this, restPose());
    this.rates = new Float64Array(7);
    this.vy = 0;
    this.distance = 0;
    this.mode = 'ground';
    this.escapeAge = 0;
    this.landingAge = 0;
    this.cooldown = 0;
    this.flightRates = {steerLeft:0,steerRight:0,landing:0,muscleLeft:0,muscleRight:0};
    this.prepUntil = 0;
    this.flightPower = 0;
    this.launchDirection = 1;
    this.takeoffs = 0;
  }
  advance(input, dt, feeding = 0, flight = null) {
    if (
      input.length !== 7 ||
      !Array.from(input).every(Number.isFinite) ||
      !Number.isFinite(dt) ||
      dt <= 0 ||
      dt > 0.05
    )
      throw Error('Invalid neural controller input');
    for (let i = 0; i < 7; i++)
      this.rates[i] = relax(this.rates[i], Math.max(0, input[i]), dt, 0.08);
    const [wl, wr, tl, tr, back] = this.rates;
    const adaptive=this.profile==='adaptive';
    const walking = Math.max(0, (wl + wr) / 2 - (adaptive?0:6)),
      reverse = Math.max(0, back - 25);
    const turn = Math.max(0, tl - (adaptive?0:15)) - Math.max(0, tr - (adaptive?0:15));
    const groundSpeed = (8 * Math.tanh(walking / (adaptive?12:30)) - 4 * Math.tanh(reverse / 90)) * (1 - clamp(feeding, 0, 1));
    this.yawRate = relax(this.yawRate, 3.8 * Math.tanh(turn / (adaptive?20:45)), dt, 0.04);
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (flight) {
      for (const key of Object.keys(this.flightRates))
        this.flightRates[key] = relax(this.flightRates[key], flight.hz[key], dt, key.startsWith('muscle') ? .08 : .04);
      if (flight.spikes.backwardPrep > 0) this.prepUntil = this.time + .05;
    } else {
      for (const key of Object.keys(this.flightRates))
        this.flightRates[key] = relax(this.flightRates[key], 0, dt, .04);
    }
    const backwardLaunch = flight?.spikes.backwardJump > 0 && this.time < this.prepUntil;
    const launchEvent = flight && (flight.spikes.giantFiber > 0 || flight.spikes.forward > 0 || backwardLaunch);
    if (this.mode === 'ground' && this.cooldown === 0 && launchEvent) {
      this.mode = 'escape';
      this.escapeAge = 0;
      this.vy = 80;
      this.launchDirection = backwardLaunch && !flight.spikes.giantFiber && !flight.spikes.forward ? -1 : 1;
      this.takeoffs++;
    }
    // DLM/DVM motor spikes maintain asynchronous muscle activation.
    // The rise/fall constants follow Gordon & Dickinson (2006); the rate-to-lift
    // gain is a reduced-body calibration, not a measured calcium concentration.
    const muscleTarget = Math.tanh((this.flightRates.muscleLeft + this.flightRates.muscleRight) / 10);
    this.flightPower = relax(this.flightPower, muscleTarget, dt, muscleTarget > this.flightPower ? .442 : 1.79);
    if (this.mode === 'escape') {
      this.escapeAge += dt;
      if (this.flightRates.landing > 15) {this.mode = 'landing';this.landingAge = 0;}
    }
    const airborne = this.mode !== 'ground';
    if (airborne) {
      const landing = this.mode === 'landing';
      if (landing) this.landingAge += dt;
      const power = landing ? 0 : this.flightPower;
      this.velocity = relax(this.velocity, this.launchDirection * 24 * power, dt, .06);
      this.yawRate = relax(this.yawRate, 3.8 * Math.tanh((this.flightRates.steerLeft - this.flightRates.steerRight) / 20), dt, .04);
      const parts = Math.ceil(dt / .001), h = dt / parts;
      for (let k = 0; k < parts; k++) {
        const lift = clamp(9810 + 24 * 24 * (3 - this.y) - 48 * this.vy, 0, 16000 * power);
        const acceleration = lift - 9810;
        this.y += this.vy * h + .5 * acceleration * h * h;
        this.vy += acceleration * h;
        if (this.y <= 0 && this.vy <= 0) {
          this.y = 0;this.vy = 0;this.mode = 'ground';this.cooldown = .2;
          break;
        }
      }
    } else this.velocity = relax(this.velocity, groundSpeed, dt, .055);
    this.flightBlend = clamp(this.y / 0.65, 0, 1);
    this.launch = this.mode === 'escape' ? clamp(1 - this.escapeAge / 0.06, 0, 1) : 0;
    this.landing = this.mode === 'landing' ? clamp(this.landingAge / 0.08, 0, 1) : 0;
    this.wingOpen = relax(
      this.wingOpen,
      this.mode === 'ground' ? 0 : 1,
      dt,
      this.mode === 'ground' ? 0.065 : 0.022,
    );
    if (this.wingOpen < 0.0001) this.wingOpen = 0;
    const pitchTarget =
      (this.mode === 'landing' ? -0.13 : this.launch > 0 ? -0.24 : -0.06) * this.flightBlend;
    this.pitch = relax(this.pitch, pitchTarget, dt, 0.045);
    this.bank = relax(
      this.bank,
      clamp(-this.yawRate * 0.08, -0.22, 0.22) * this.flightBlend,
      dt,
      0.05,
    );
    this.yaw += this.yawRate * dt;
    this.x += Math.sin(this.yaw) * this.velocity * dt;
    this.z += Math.cos(this.yaw) * this.velocity * dt;
    const gaitSpeed = Math.abs(this.velocity) + Math.abs(this.yawRate) * 0.5;
    this.phase += (gaitSpeed > 0.06 ? Math.min(14, gaitSpeed / 1.4) * Math.PI * 2 : 0) * dt;
    this.distance += Math.abs(this.velocity) * dt;
    this.time += dt;
    this.behavior =
      this.mode === 'landing'
        ? 'Landing'
        : this.mode === 'escape'
          ? this.escapeAge < 0.08
            ? 'Taking off'
            : this.flightPower > .6 ? 'Flight' : 'Jumping'
          : reverse > walking + 5
            ? 'Walking backward'
            : Math.abs(this.yawRate) > 0.3
              ? this.yawRate > 0
                ? 'Turning left'
                : 'Turning right'
              : Math.abs(this.velocity) > 0.15
                ? 'Walking'
                : 'At rest';
    return this.pose();
  }
  pose() {
    if(this.remotePose)return this.remotePose;
    return {
      x: this.x,
      z: this.z,
      y: this.y,
      yaw: this.yaw,
      velocity: this.velocity,
      yawRate: this.yawRate,
      phase: this.phase,
      time: this.time,
      pitch: this.pitch,
      bank: this.bank,
      wingOpen: this.wingOpen,
      flightBlend: this.flightBlend,
      launch: this.launch,
      landing: this.landing,
      behavior: this.behavior,
    };
  }
}

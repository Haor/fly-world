import { FlyController } from './controller.js';
import { Habitat } from './habitat.js';
import { validateResult } from './neural-contract.js';

/** Simulation lifecycle is independent from the observation UI and USB transport. */
export class Simulation {
  constructor({assetBase, onState = () => {}, onResult = () => {}, canStep = () => true,
    createWorker = () => new Worker(new URL('./worker.js', import.meta.url), {type: 'module'})}) {
    Object.assign(this, {assetBase, onState, onResult, canStep, createWorker});
    this.body = new FlyController();
    this.world = new Habitat();
    this.world.reset(this.body);
    this.epoch = 0; this.generation = 0; this.tick = 0; this.deferred = null; this.ready = false; this.paused = false;
    this.pending = false; this.resetting = false; this.backend = 'cpu'; this.speed = 0;
    this.tick = 0; this.deferred = null;
    this.phase = 'idle'; this.detail = ''; this.lastResult = 0;
  }
  emit() { this.onState(this); }
  arm(ms) {
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => this.fail('计算超时，请重试或选择 JavaScript 后端。'), ms);
  }
  start(backend = 'auto') {
    this.worker?.terminate(); clearTimeout(this.timer); clearTimeout(this.watchdog);
    const epoch = ++this.epoch;
    this.generation = 0; this.tick = 0; this.deferred = null; this.ready = false; this.paused = false; this.pending = false;
    this.resetting = false; this.backend = 'cpu'; this.phase = 'loading'; this.detail = '';
    this.body.reset(); this.world.reset(this.body); this.lastResult = 0; this.speed = 0;
    this.emit();
    try { this.worker = this.createWorker(backend); }
    catch (e) { this.fail(e.message); return; }
    this.worker.onerror = e => { if (epoch === this.epoch) this.fail(e.message || '计算线程未能启动。'); };
    this.worker.onmessageerror = () => { if (epoch === this.epoch) this.fail('无法读取计算结果。'); };
    this.worker.onmessage = ({data: m}) => {
      if (epoch !== this.epoch) return;
      if (m.type === 'stage' || m.type === 'progress') {
        this.progress = m.type === 'progress' ? m.value : null;
        this.detail = m.type === 'progress' ? `本地连接数据 · ${Math.round(m.value * 100)}%` : '正在读取本地数据并准备计算…';
        this.emit(); this.arm(180000);
      } else if (m.type === 'fallback') {
        this.detail = 'WebGPU 不可用，正在启用 JavaScript 计算。'; this.emit();
      } else if (m.type === 'ready') {
        clearTimeout(this.watchdog);
        this.backend = m.backend; this.ready = true; this.phase = 'ready';
        this.emit(); this.request();
      } else if (m.type === 'reset') {
        if (m.generation !== this.generation) return;
        clearTimeout(this.watchdog); this.pending = false; this.resetting = false;
        this.emit(); this.request();
      } else if (m.type === 'result') {
        if (m.generation !== this.generation || this.resetting) return;
        if (!this.pending) return;
        try { validateResult(m,this.tick); } catch(error) { this.fail(error.message);return; }
        clearTimeout(this.watchdog); this.pending = false;
        if (this.paused) { this.deferred = m; return; }
        this.applyResult(m);
      } else if (m.type === 'error') {
        if (m.generation !== undefined && m.generation !== this.generation) return;
        if (this.backend === 'gpu' && backend !== 'cpu') this.start('cpu');
        else this.fail(m.message);
      }
    };
    this.arm(180000);
    this.worker.postMessage({type:'init', backend, assetBase:this.assetBase});
  }
  applyResult(m) {
    this.tick = m.tick;
    const now = performance.now(), elapsed = this.lastResult ? now - this.lastResult : m.wallMs;
    const rate = m.steps * .1 / Math.max(elapsed,.001);
    this.speed = this.speed ? this.speed*.85+rate*.15 : rate; this.lastResult = now;
    const dt=m.steps*.0001;
    this.body.advance(m.rates,dt,this.world.feeding);
    const pose=this.world.advance(this.body,this.body.rates,dt);
    this.onResult({...m,pose,rates:this.body.rates,world:this.world.snapshot()});
    this.timer=setTimeout(()=>this.request(),Math.max(0,10-m.wallMs));
  }
  request() {
    clearTimeout(this.timer);
    if (!this.ready || this.paused || this.pending || this.resetting || !this.canStep()) return;
    this.pending = true;
    this.worker.postMessage({type:'step', generation:this.generation, silenced:!!this.silenced, sensory:this.world.sense(this.body)});
    this.arm(60000);
  }
  pulse(indices, strength, profile = 'paint', replace = false) {
    if (!this.ready || this.resetting || !indices.length) return false;
    this.worker.postMessage({type:'pulse',indices,strength,profile,replace}); this.request(); return true;
  }
  clear() { if (this.ready) this.worker.postMessage({type:'clear'}); }
  togglePause() {
    if (!this.ready || this.resetting) return;
    this.paused = !this.paused; clearTimeout(this.timer); this.lastResult = 0;
    this.emit();
    if (!this.paused) {
      if (this.deferred) {const result=this.deferred;this.deferred=null;this.applyResult(result);}
      else this.request();
    }
  }
  reset(spawn = null) {
    if (!this.ready || this.resetting) return;
    this.resetting = true; this.generation++; this.tick=0; this.deferred=null; clearTimeout(this.timer);
    this.body.reset(); this.world.reset(this.body);
    if (spawn) {
      Object.assign(this.body, {x:spawn.x,z:spawn.z,yaw:spawn.yaw});
      this.world.previousX=spawn.x;this.world.previousZ=spawn.z;
    }
    this.speed = 0; this.lastResult = 0;
    this.emit(); this.worker.postMessage({type:'reset',generation:this.generation}); this.arm(60000);
  }
  fail(detail) {
    this.worker?.terminate(); this.worker = null; clearTimeout(this.timer); clearTimeout(this.watchdog);
    this.epoch++; this.ready = false; this.pending = false; this.resetting = false;
    this.deferred=null; this.phase = 'error'; this.detail = detail; this.emit();
  }
  dispose() {
    this.epoch++; this.worker?.terminate(); clearTimeout(this.timer); clearTimeout(this.watchdog);
  }
}

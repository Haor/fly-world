import {WORLD_OPTION_KEYS} from './world-contract.js';
import { FlightReadout } from './flight-readout.js';
import { FlyController } from './controller.js';
import { Habitat } from './habitat.js';
import { validateResult } from './neural-contract.js';

/** Simulation lifecycle is independent from the observation UI and USB transport. */
export class Simulation {
  constructor({assetBase, onState = () => {}, onResult = () => {}, onConnections = () => {}, canStep = () => true,
    createWorker = () => new Worker(new URL('./worker.js', import.meta.url), {type: 'module'})}) {
    Object.assign(this, {assetBase, onState, onResult, onConnections, canStep, createWorker});
    this.body = new FlyController();
    this.world = new Habitat();
    this.world.reset(this.body);
    this.epoch = 0; this.generation = 0; this.tick = 0; this.deferred = null; this.ready = false; this.paused = false;
    this.pending = false; this.resetting = false; this.backend = 'cpu'; this.speed = 0;
    this.tick = 0; this.deferred = null;
    this.execution='neural';this.remotePose=null;this.controlPending=false;
    this.dynamics='adaptive';this.background=true;
    this.phase = 'idle'; this.detail = ''; this.lastResult = 0;
  }
  setNeurons(neurons) { this.flightReadout = new FlightReadout(neurons); }
  emit() { this.onState(this); }
  arm(ms) {
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => this.fail(this.execution==='world'?'服务响应超时，请检查连接与服务状态。':'计算超时，请重试。'), ms);
  }
  start(backend = 'auto') {
    this.worker?.terminate(); clearTimeout(this.timer); clearTimeout(this.watchdog);
    const epoch = ++this.epoch;
    this.generation = 0; this.tick = 0; this.deferred = null; this.ready = false; this.paused = false; this.pending = false;
    this.resetting = false; this.backend = 'cpu'; this.phase = 'loading'; this.detail = '';
    this.execution='neural';this.world.remoteSnapshot=null;this.controlPending=false;this.body.reset();this.body.profile=this.dynamics; this.world.reset(this.body); this.lastResult = 0; this.speed = 0;
    this.emit();
    try { this.worker = this.createWorker(backend); }
    catch (e) { this.fail(e.message); return; }
    this.worker.onerror = e => { if (epoch === this.epoch) this.fail(e.message || '计算线程未能启动。'); };
    this.worker.onmessageerror = () => { if (epoch === this.epoch) this.fail('无法读取计算结果。'); };
    this.worker.onmessage = ({data: m}) => {
      if (epoch !== this.epoch) return;
      if (m.type === 'stage' || m.type === 'progress') {
        this.progress = m.type === 'progress' ? m.value : null;
        this.detail = m.type === 'progress' ? `本地连接数据 · ${Math.round(m.value * 100)}%` : m.message || '正在读取本地数据并准备计算…';
        this.emit(); this.arm(180000);
      } else if (m.type === 'fallback') {
        this.detail = `WebGPU 未通过检查：${m.message}。正在启用 JavaScript 计算。`; this.emit();
      } else if (m.type === 'ready') {
        clearTimeout(this.watchdog);
        this.model=m.model||{id:'malecns-v1.0-retained',neurons:166700};this.compute=m.compute||m.backend;this.computeKernel=m.computeKernel;this.projectionSize=m.projectionSize||166700;
        this.execution=m.execution||'neural';this.backend = m.backend; this.ready = true; this.phase = 'ready';
        this.emit();if(this.execution==='world')this.worker.postMessage({type:'run',running:true});else this.request();
      } else if(m.type==='world-frame'){
        if(m.generation!==this.generation||this.resetting)return;
        clearTimeout(this.watchdog);this.tick=m.tick;this.speed=m.speed;this.paused=!m.running;this.applyWorld(m);if(m.running)this.arm(60000);
      } else if(m.type==='control'){
        this.controlPending=false;this.paused=!m.running;clearTimeout(this.watchdog);if(m.running)this.arm(60000);Object.assign(this.world.options,m.options);this.emit();
      } else if (m.type === 'reset') {
        if (m.generation !== this.generation) return;
        clearTimeout(this.watchdog); this.pending = false; this.resetting = false;
        if(this.execution==='world'&&m.pose){this.paused=!m.running;this.applyWorld({...m,tick:0,steps:0,total:0,cumulativeSpikes:0,rates:[0,0,0,0,0,0,0],firing:new Uint32Array(),counts:new Uint32Array(),wallMs:0});if(m.running)this.arm(60000);}
        this.emit(); this.request();
      } else if (m.type === 'result') {
        if (m.generation !== this.generation || this.resetting) return;
        if (!this.pending) return;
        try { validateResult(m,this.tick,this.projectionSize); } catch(error) { this.fail(error.message);return; }
        clearTimeout(this.watchdog); this.pending = false;
        if (this.paused) { this.deferred = m; return; }
        this.applyResult(m);
      } else if(m.type==='connections') {
        if(m.generation===this.generation)this.onConnections(m);
      } else if (m.type === 'error') {
        if (m.generation !== undefined && m.generation !== this.generation) return;
        if (this.backend === 'gpu' && backend !== 'cpu') this.start('cpu');
        else this.fail(m.message);
      }
    };
    this.arm(180000);
    this.worker.postMessage({type:'init', backend, assetBase:this.assetBase,dynamics:this.dynamics});
  }
  applyWorld(m) {
    this.body.remotePose=m.pose;for(const key of ['x','z','y','yaw','time','velocity','yawRate','takeoffs'])this.body[key]=m.pose[key]||0;
    this.body.rates=Float64Array.from(m.rates);this.world.remoteSnapshot=m.world;Object.assign(this.world.options,m.world.options);
    this.onResult(m);
  }
  configure(options) {
    Object.assign(this.world.options,options);
    if(this.ready&&this.execution==='world')this.worker.postMessage({type:'environment',options:Object.fromEntries(Object.entries(options).filter(([key])=>WORLD_OPTION_KEYS.includes(key)))});
    else this.world.sense(this.body);
  }
  stimulateEnvironment(stimulus='occlusion') {
    if(this.execution==='world')this.worker.postMessage({type:'stimulus',stimulus});
    else this.world.loom();
  }
  ablate(controls) {if(this.execution==='world'&&this.ready)this.worker.postMessage({type:'ablation',controls});}
  applyResult(m) {
    this.tick = m.tick;
    const now = performance.now(), elapsed = this.lastResult ? now - this.lastResult : m.wallMs;
    const rate = m.steps * .1 / Math.max(elapsed,.001);
    this.speed = this.speed ? this.speed*.85+rate*.15 : rate; this.lastResult = now;
    const dt=m.steps*.0001;
    const flight=this.flightReadout?.decode(m);
    this.body.advance(m.rates,dt,this.world.feeding,flight);
    const pose=this.world.advance(this.body,this.body.rates,dt);
    this.onResult({...m,pose,flight,rates:this.body.rates,world:{...this.world.snapshot(),dynamics:this.dynamics,background:this.dynamics==='adaptive'&&this.background}});
    this.timer=setTimeout(()=>this.request(),Math.max(0,10-(performance.now()-this.requestStarted)));
  }
  request() {
    clearTimeout(this.timer);
    if (this.execution==='world')return;
    if (!this.ready || this.paused || this.pending || this.resetting || !this.canStep()) return;
    this.pending = true;this.requestStarted=performance.now();
    this.worker.postMessage({type:'step', generation:this.generation, silenced:!!this.silenced,background:this.dynamics==='adaptive'&&this.background, sensory:this.world.sense(this.body)});
    this.arm(60000);
  }
  pulse(indices, strength, profile = 'paint', replace = false) {
    if (this.execution==='world'||this.world.options.mode==='sensory' || !this.ready || this.resetting || !indices.length) return false;
    this.worker.postMessage({type:'pulse',indices,strength,profile,replace}); this.request(); return true;
  }
  inspect(bodyId){if(this.ready&&!this.resetting)this.worker.postMessage({type:'inspect',bodyId,generation:this.generation});}
  clear() { if (this.ready&&this.execution!=='world') this.worker.postMessage({type:'clear'}); }
  togglePause() {
    if (!this.ready || this.resetting) return;
    if(this.execution==='world'){if(!this.controlPending){this.controlPending=true;this.worker.postMessage({type:'run',running:this.paused});}return;}
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
    if(this.execution==='world'){this.speed=0;this.emit();this.worker.postMessage({type:'reset',generation:this.generation,spawn});this.arm(60000);return;}
    this.body.reset(); this.world.reset(this.body);
    if (spawn) {
      Object.assign(this.body, {x:spawn.x,z:spawn.z,yaw:spawn.yaw});
      this.world.previousX=spawn.x;this.world.previousZ=spawn.z;
    }
    this.speed = 0; this.lastResult = 0;
    this.emit(); this.worker.postMessage({type:'reset',generation:this.generation}); this.arm(60000);
  }
  fail(detail, phase = 'error') {
    this.worker?.terminate(); this.worker = null; clearTimeout(this.timer); clearTimeout(this.watchdog);
    this.epoch++; this.ready = false; this.pending = false; this.resetting = false;
    this.deferred=null; this.phase = phase; this.detail = detail; this.emit();
  }
  dispose() {
    this.epoch++; this.worker?.terminate(); clearTimeout(this.timer); clearTimeout(this.watchdog);
  }
}

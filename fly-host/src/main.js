import './style.css';
import { configureAssetBase } from './data-loader.js';
import { BrainView } from './brain-view.js';
import { FlyScene } from './scene.js';
import { CloudBrain, cloudURL } from './cloud-brain.js';
import { Simulation } from './simulation.js';
import { HabitatView } from './habitat-view.js';
import { randomSpawn } from './habitat.js';
import { Observations, behaviorLabel } from './observations.js';
import { populations } from './stimulus.js';
import { attachPassport } from './passport.js';

const $ = id => document.getElementById(id);
const assetBase = new URL(import.meta.env.BASE_URL, document.baseURI).href;
configureAssetBase(assetBase);
let retainedNeurons, brainView, bodyView, groups, booting = false, assetsReady = false, disposed = false;
let currentView = 'overview', drawnEvent = null, lastEpoch = '';
const observations = new Observations();
const simulation = new Simulation({assetBase, onState: stateChanged, onResult: received,onConnections:m=>brainView?.setConnections(m),
  canStep: () => !document.hidden || passport.connected,
  createWorker: backend => {
    if (backend !== 'cloud') return new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
    const remote=new CloudBrain({url:$('cloud-url').value,token:$('cloud-token').value,neurons:brainView.neurons,modelId:$('model-scale').value==='full'?'malecns-v1.0-full':'malecns-v1.0-retained',
      compute:$('service-compute').value,dynamics:simulation.dynamics,inputMode:simulation.world.options.mode,onMetadata:(neurons)=>{brainView.setNeurons(neurons);groups=populations(neurons);}});
    $('cloud-token').value='';return remote;
  }});
const habitatView = new HabitatView($('habitat-canvas'), simulation.world);
const passport = attachPassport(action => {
  if (!simulation.ready || simulation.resetting) return false;
  if (action === 'PAUSE') simulation.togglePause();
  else if (action === 'RESET') simulation.reset();
  else {
    const key = {WALK:'walk',LEFT:'left',RIGHT:'right',FLY:'escape'}[action];
    if (!key || simulation.world.options.mode==='sensory') return false;
    if (simulation.paused) simulation.togglePause();
    return stimulate(key);
  }
  return true;
}, renderDevice);

function sampleDevice() {
  if (!simulation.ready || simulation.resetting) {passport.stop();return;}
  passport.sample(simulation.body.pose(),simulation.body.rates,Math.round(simulation.body.time*1000),
    !simulation.paused,`${simulation.epoch}:${simulation.generation}`,simulation.world.snapshot());
}
function stateChanged() {
  const s = simulation, epoch = `${s.epoch}:${s.generation}`;
  if (epoch !== lastEpoch && s.phase !== 'error') {
    lastEpoch = epoch; observations.reset(); habitatView.reset(); drawnEvent = null;
    brainView?.reset(); if (assetsReady) bodyView?.reset();
  }
  const usable = s.ready && !s.resetting;
  for (const id of ['pause','reset','random-start','loom','baseline']) $(id).disabled = !usable;
  for (const button of document.querySelectorAll('[data-preset]')) button.disabled = !usable || s.world.options.mode==='sensory';
  for(const id of ['backend','model-scale','input-mode','service-compute','dynamics'])$(id).disabled=booting||s.phase==='loading'||s.resetting;
  $('pause-label').textContent = s.paused ? '继续' : '暂停';
  $('launch-panel').hidden = s.ready;
  $('start').disabled = booting || s.phase === 'loading';
  $('start').textContent = s.phase === 'error' ? '重试本地模拟 ↗' : s.phase === 'loading' || booting ? '正在准备…' : '启动本地模拟 ↗';
  $('launch-title').textContent = s.phase === 'error' ? '观察暂时中断' : s.phase === 'loading' || booting ? '正在加载' : '启动仿真';
  $('launch-detail').textContent = s.detail || ($('model-scale').value==='full'?'连接推理服务，载入全量神经图。':'166,700 个节点，在你的电脑上运行。');
  $('load-progress').hidden = s.phase !== 'loading';
  if (s.progress == null) $('load-progress').removeAttribute('value'); else $('load-progress').value = s.progress;
  if (brainView) brainView.enabled = usable && s.world.options.mode!=='sensory' && $('manual-mode').checked;
  render(); sampleDevice();
}
function render() {
  const s = simulation, world = s.world.snapshot(), pose = s.body.pose(), active = s.ready;
  habitatView.update(pose);bodyView?.setEnvironmentLight(world);
  const preview = $('device-preview').getContext('2d');
  preview.imageSmoothingEnabled = false;
  preview.fillStyle = '#111e18'; preview.fillRect(0,0,96,128);
  preview.drawImage($('habitat-canvas'),0,24,96,70);
  $('behavior').textContent = active ? s.paused ? '观察已暂停' : behaviorLabel(pose.behavior) : '等待启动';
  $('neural-time').textContent = active ? pose.time.toFixed(2) : '—';
  $('hunger').textContent = active ? Math.round(world.hunger*100)+'%' : '—';
  $('energy').textContent = active ? Math.round(world.energy*100)+'%' : '—';
  $('hunger-meter').style.width = (active ? world.hunger*100 : 0)+'%';
  $('energy-meter').style.width = (active ? world.energy*100 : 0)+'%';
  $('coordinates').textContent = active ? `X ${pose.x.toFixed(1)} / Z ${pose.z.toFixed(1)} mm` : 'X — / Z —';
  const sensoryOnly=s.world.options.mode==='sensory';
  $('background').disabled=s.dynamics!=='adaptive'||s.resetting;$('background').checked=s.dynamics==='adaptive'&&s.background;
  $('mode-label').textContent = s.world.options.enabled ? sensoryOnly?'纯感觉':'辅助实验' : '环境输入关闭';
  $('foraging').disabled=sensoryOnly;$('foraging').checked=!sensoryOnly&&s.world.options.foraging;$('exploration').disabled=sensoryOnly;$('manual-mode').disabled=sensoryOnly;
  for(const button of document.querySelectorAll('[data-preset]'))button.disabled=!active||sensoryOnly;
  $('vision-population').textContent=sensoryOnly?'L1 / L2 · 早期视觉代理':'LC4 / LPLC2 · 人工特征';
  $('input-note').textContent=sensoryOnly?'环境感觉进入网络，由神经活动驱动身体。':'包含人工步行、转向和可选寻食辅助。';
  $('loom').textContent=sensoryOnly?'掠过遮挡 · 0.65 s':'逼近刺激 · 0.65 s';
  $('model-summary').textContent=active?`${s.model.neurons.toLocaleString()} 节点 · ${s.compute} · 空间定位 ${brainView.positionedCount.toLocaleString()} 节点`:
    $('model-scale').value==='full'?'全量模型 · 通过本地或远程服务推理':'轻量模型 · 可在浏览器推理';
  $('runtime-status').textContent = active ? s.paused ? '已暂停' : s.backend === 'cloud' ? '服务推理中' : '本地运行中' : s.phase === 'error' ? '计算中断' : s.phase === 'loading' || booting ? '正在准备' : '尚未启动';
  $('runtime-speed').textContent = active ? `${s.backend === 'gpu' ? 'WebGPU' : s.backend === 'cloud' ? `服务 ${s.compute.toUpperCase()}` : 'CPU'} · ${s.speed.toFixed(2)}×` : 'LOCAL COMPUTE';
  $('runtime-dot').dataset.state = s.phase === 'error' ? 'error' : active && !s.paused ? 'live' : 'idle';
  $('live-dot').dataset.state = active && !s.paused ? 'live' : 'idle';
  for (const [name,key,max] of [['vision','looming',120],['taste','sugar',100],['odor','odor',25]]) {
    $(name+'-rate').textContent = active ? Math.round(key==='looming'&&sensoryOnly?(world.visualLeft+world.visualRight)/2:world[key])+' Hz' : '—';
    $(name+'-meter').style.width = Math.min(100,active ? (key==='looming'&&sensoryOnly?(world.visualLeft+world.visualRight)/2:world[key])/max*100 : 0)+'%';
  }
  $('antenna-rates').textContent = active ? `左 ${world.odorLeft.toFixed(1)} / 右 ${world.odorRight.toFixed(1)} Hz` : '左 — / 右 — Hz';
  $('forage-state').textContent = sensoryOnly ? '纯感觉 · 不提供寻食指令' : !s.world.options.foraging ? '辅助关闭' : !s.world.options.enabled || !s.world.options.odor ? '等待嗅觉输入' :
    !active ? '等待启动' : world.forageState === 'track' ? '循味接近' : world.forageState === 'search' ? '局部搜索' :
      world.forageState === 'contact' ? '接触食物' : world.hunger < .25 || s.world.satiated ? '已饱足' : '暂未寻食';
  $('spike-count').textContent = active ? `${observations.spikes.toLocaleString()} 次累计放电` : '等待神经数据';
  $('export').disabled = !observations.samples.length;
  drawChart(); drawJournal();
}
function received(m) {
  observations.ingest(m.pose,m.rates,m.world,m.total);
  brainView.result(m.firing,m.counts,m.tick); bodyView.update(m.pose);
  render(); sampleDevice();
}
function drawChart() {
  const c = $('activity-chart').getContext('2d'), w = 700, h = 110;
  c.clearRect(0,0,w,h);c.strokeStyle='#334239';c.lineWidth=.5;c.setLineDash([2,5]);
  for (const y of [10,50,90]) {c.beginPath();c.moveTo(0,y);c.lineTo(w,y);c.stroke();}c.setLineDash([]);
  const end = Math.max(12,simulation.body.time), start = end-12;
  for (const [key,color] of [['walk','#d8ee82'],['escape','#e3ae72'],['feed','#8bc8ba']]) {
    c.strokeStyle=color;c.lineWidth=1.5;c.beginPath();
    observations.samples.forEach((s,i)=>{const x=(s.time-start)/12*w,y=100-Math.min(350,s[key])/350*90;i?c.lineTo(x,y):c.moveTo(x,y);});c.stroke();
  }
}
function drawJournal() {
  const first = observations.events[0];
  if (drawnEvent === first && $('journal').childElementCount) return;
  drawnEvent = first;
  $('journal').replaceChildren();
  if (!first) {const li=document.createElement('li');li.className='journal-empty';li.textContent='启动后记录行为变化与环境事件。';$('journal').append(li);return;}
  for (const event of observations.events.slice(0,5)) {
    const row=document.createElement('li'),time=document.createElement('time'),label=document.createElement('span');
    time.textContent=event.time.toFixed(2)+' s';label.textContent=event.label;row.append(time,label);$('journal').append(row);
  }
}
function event(label) {observations.event(simulation.body.time,label);drawJournal();}
function renderDevice(status) {
  const linked=status.connected, d=status.device;
  $('take-control').hidden = !status.controlConflict;
  $('take-control').disabled = !simulation.ready || simulation.resetting;
  $('device-dot').dataset.state=linked?'live':'idle';
  $('device-label').textContent=linked?'AI Passport 已连接':'仅电脑观察';
  $('device-mode').textContent=linked?'USB 在线':'未连接';$('device-mode').dataset.state=linked?'live':'idle';
  $('device-port').textContent=linked?'USB Serial':'等待 USB';
  $('device-state').textContent=linked&&d?['本地模式','神经同步','神经暂停'][d.mode]||'等待状态':'—';
  $('device-memory').textContent=linked&&d?`${Math.round(d.freeHeap/1024)} KiB 可用`:'—';
  $('device-message').textContent=status.transportError || (linked ? status.neural ? '电脑计算，卡片同步显示。实体按键可触发实验动作。' : '卡片已就绪。启动模拟后同步神经世界。' : '可独立在电脑上观察。使用数据线连接卡片后自动同步。');
  if (!linked && status.message?.includes('本地桥接')) $('device-message').textContent=status.message;
}
function setView(name) {
  currentView=name;
  for (const key of ['habitat','brain','body']) {$(key+'-pane').hidden=name!=='overview'&&key!==name;$(key+'-options').hidden=key!==name&&!(name==='overview'&&key==='habitat');}
  for (const button of document.querySelectorAll('[data-view]')) button.setAttribute('aria-pressed',String(button.dataset.view===name));
  $('view-title').textContent={overview:'全览',habitat:'栖息地观察',brain:'神经活动观察',body:'身体运动观察'}[name];
  $('observation-stage').dataset.view=name;
  $('manual-tools').hidden=name!=='brain'||!$('manual-mode').checked;
  if (brainView) {brainView.visible=name==='brain'||name==='overview';if(brainView.visible)brainView.resize();}
  if (bodyView) {bodyView.visible=name==='body'||name==='overview';if(bodyView.visible)bodyView.resize();}
}
async function boot() {
  if (booting || simulation.phase==='loading') return;
  if ($('backend').value==='cloud') {
    try {cloudURL($('cloud-url').value);$('cloud-error').textContent='';}
    catch {$('cloud-error').textContent='请填写有效的云端 WebSocket 地址。';return;}
  }
  if (assetsReady) {if($('backend').value!=='cloud'){brainView.setNeurons(retainedNeurons);groups=populations(retainedNeurons);}simulation.start($('backend').value);return;}
  booting=true;simulation.detail='正在加载脑解剖数据与三维标本…';stateChanged();
  try {
    brainView?.dispose();bodyView?.dispose();
    brainView=new BrainView($('brain'),(indices,options)=>{
      if(simulation.pulse(indices,Number($('strength').value),options.profile,options.replace))event(`手动刺激 · ${indices.length} 个神经元`);
    },n=>{$('paint-hint').textContent=n?`已选择 ${n.toLocaleString()} 个神经元`:'点击节点查看官方骨架';$('replay').disabled=!n;});
    brainView.onInspect=bodyId=>simulation.inspect(bodyId);
    bodyView=new FlyScene($('fly'));
    bodyView.onCameraChange=mode=>{for(const button of document.querySelectorAll('[data-camera]'))button.setAttribute('aria-pressed',String(button.dataset.camera===mode));};
    setView(currentView);
    const loaded=await Promise.allSettled([brainView.load(),bodyView.load()]);
    if(disposed)return;
    const failed=loaded.find(r=>r.status==='rejected');if(failed)throw failed.reason;
    retainedNeurons=loaded[0].value;groups=populations(retainedNeurons);assetsReady=true;
    bodyView.setDepthOfField($('depth-of-field').checked);
    bodyView.setShadows($('show-shadows').checked);
    booting=false;simulation.start($('backend').value);
  } catch(error) {booting=false;simulation.fail(error.message);}
}
function stimulate(key) {
  if(simulation.world.options.mode==='sensory'||!simulation.ready||simulation.resetting||!groups)return false;
  const ids=groups[key==='escape'?'escapeInput':key],profile=key==='left'||key==='right'?'turn':'paint';
  brainView.preset(ids,profile,false);
  const sent=simulation.pulse(ids,Number($('strength').value),profile,true);
  if(sent)event({walk:'手动步行刺激',left:'手动左转刺激',right:'手动右转刺激',escape:'手动逃逸刺激'}[key]);
  return sent;
}
$('start').onclick=boot;
$('pause').onclick=()=>simulation.togglePause();$('reset').onclick=()=>simulation.reset();
$('random-start').onclick=()=>{simulation.reset(randomSpawn());event('更换出生位置');};
$('loom').onclick=()=>{simulation.world.loom();simulation.world.sense(simulation.body);event(simulation.world.options.mode==='sensory'?'环境遮挡 · 0.65 s':'逼近刺激 · 0.65 s');render();};
$('show-shadows').onchange=()=>{habitatView.showShadows=$('show-shadows').checked;bodyView?.setShadows($('show-shadows').checked);render();};
for(const button of document.querySelectorAll('[data-view]'))button.onclick=()=>setView(button.dataset.view);
document.querySelector('.mark').onclick=e=>{e.preventDefault();setView('overview');};
for(const [id,key,label] of [['autonomy','enabled','自主环境'],['vision','vision','逼近视觉'],['taste','taste','接触味觉'],['odor','odor','嗅觉'],['foraging','foraging','寻食辅助']]) {
  $(id).onchange=()=>{simulation.world.options[key]=$(id).checked;simulation.world.sense(simulation.body);event(`${label} · ${$(id).checked?'开启':'关闭'}`);render();};
}
$('exploration').oninput=()=>{simulation.world.options.exploration=Number($('exploration').value)/100;$('exploration-value').textContent=$('exploration').value+'%';simulation.world.sense(simulation.body);render();};
$('show-trail').onchange=()=>{habitatView.showTrail=$('show-trail').checked;render();};
$('show-odor').onchange=()=>{habitatView.showOdor=$('show-odor').checked;render();};
$('manual-mode').onchange=()=>{if(brainView)brainView.enabled=simulation.world.options.mode!=='sensory'&&simulation.ready&&$('manual-mode').checked;$('manual-tools').hidden=!$('manual-mode').checked;};
$('projection').onchange=()=>{if(brainView){brainView.projection=$('projection').value;brainView.layout();}};
for(const mode of ['brush','erase'])$(mode).onclick=()=>{if(brainView)brainView.mode=mode==='brush'?'paint':'erase';$('brush').setAttribute('aria-pressed',String(mode==='brush'));$('erase').setAttribute('aria-pressed',String(mode==='erase'));};
$('size').oninput=()=>{if(brainView)brainView.brush=Number($('size').value)/2;};
$('clear').onclick=()=>{brainView?.clear();simulation.clear();};$('replay').onclick=()=>brainView?.pulse();
$('strength').oninput=()=>{$('strength-value').textContent=$('strength').value+' Hz';};
$('silence').onchange=()=>{simulation.silenced=$('silence').checked;event(`突触传播 · ${simulation.silenced?'关闭':'开启'}`);};
for(const button of document.querySelectorAll('[data-preset]'))button.onclick=()=>stimulate(button.dataset.preset);
$('baseline').onclick=()=>{simulation.background=false;simulation.world.options.enabled=false;$('autonomy').checked=false;simulation.reset();};
$('backend').onchange=()=>{
  $('cloud-settings').hidden=$('backend').value!=='cloud';
  if($('model-scale').value==='full'&&$('backend').value!=='cloud'){$('backend').value='cloud';$('cloud-settings').hidden=false;}
  if(assetsReady&&$('backend').value!=='cloud')boot();
};
$('cloud-connect').onclick=boot;
$('model-scale').onchange=()=>{
  simulation.fail('模型已切换，请启动或连接所选模型。','idle');
  if($('model-scale').value==='full'){$('backend').value='cloud';$('cloud-settings').hidden=false;document.querySelector('.advanced').open=true;}
  else {$('backend').value='auto';$('cloud-settings').hidden=true;if(retainedNeurons){brainView.setNeurons(retainedNeurons);groups=populations(retainedNeurons);}}
  render();
};
$('input-mode').onchange=()=>{
  simulation.world.options.mode=$('input-mode').value;
  $('manual-mode').checked=false;$('manual-tools').hidden=true;
  simulation.clear();
  if(assetsReady&&$('backend').value!=='cloud')boot();else if(simulation.ready)simulation.fail('输入方式已切换，请重新填写令牌并连接。','idle');else render();
};
for(const [id,key,scale] of [['light-level','light',100],['light-angle','lightAngle',1]])$(id).oninput=()=>{
  simulation.world.options[key]=Number($(id).value)/scale;simulation.world.sense(simulation.body);render();
};
$('dynamics').onchange=()=>{
  simulation.dynamics=$('dynamics').value;
  if(assetsReady&&$('backend').value!=='cloud')boot();
  else if(simulation.ready)simulation.fail('动力学已切换，请重新填写令牌并连接。','idle');else render();
};
$('background').onchange=()=>{simulation.background=$('background').checked;if(simulation.ready)simulation.reset();else render();};
$('service-compute').onchange=()=>{if(simulation.ready&&simulation.backend==='cloud')simulation.fail('计算后端已切换，请重新填写令牌并连接。','idle');};
for(const button of document.querySelectorAll('[data-camera]'))button.onclick=()=>bodyView?.setCamera(button.dataset.camera);
$('depth-of-field').onchange=()=>bodyView?.setDepthOfField($('depth-of-field').checked);
$('take-control').onclick=async()=>{
  $('take-control').disabled=true;
  try {await passport.takeControl();event('设备控制权已切换到本站');$('take-control').hidden=true;}
  catch(error){$('device-message').textContent=error.message;$('take-control').disabled=false;}
};
$('device-jump').onclick=()=>{$('device-section').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});};
$('about-open').onclick=$('model-open').onclick=()=>$('about').showModal();$('about-close').onclick=()=>$('about').close();
$('export').onclick=()=>{
  const blob=new Blob(['\ufeff'+observations.export()],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='fly-world-observation.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
document.addEventListener('visibilitychange',()=>{simulation.lastResult=0;simulation.request();});
window.addEventListener('pagehide',e=>{if(!e.persisted){disposed=true;simulation.dispose();passport.dispose();brainView?.dispose();bodyView?.dispose();clearInterval(pausedSamples);}});
const pausedSamples=setInterval(()=>{if(simulation.ready&&simulation.paused&&!simulation.resetting)sampleDevice();},500);
stateChanged();
setView(currentView);

/** Negotiated server ownership of the sensorimotor clock. */
export const WORLD_ENCODING='embodied-world/1';
export const WORLD_OPTION_KEYS=['enabled','vision','taste','odor','light','lightAngle','sensoryGain','odorStrength','odorX','odorZ','windSpeed','windAngle','patternSpeed','patternContrast','proprioception'];
export function validateWorldOptions(options) {
  if(!options||typeof options!=='object'||Array.isArray(options))throw Error('INVALID_WORLD_OPTIONS');
  for(const [key,value] of Object.entries(options)) {
    if(!WORLD_OPTION_KEYS.includes(key))throw Error('INVALID_WORLD_OPTIONS');
    if(['enabled','vision','taste','odor','proprioception'].includes(key)) {
      if(typeof value!=='boolean')throw Error('INVALID_WORLD_OPTIONS');
    } else {
      const ranges={lightAngle:[-180,180],windAngle:[-180,180],patternSpeed:[-180,180],light:[0,2],sensoryGain:[0,3],odorStrength:[0,3],odorX:[-13,13],odorZ:[-13,13],windSpeed:[0,100],patternContrast:[0,1]};
      const [low,high]=ranges[key];
      if(!Number.isFinite(value)||value<low||value>high)throw Error('INVALID_WORLD_OPTIONS');
    }
  }
  return options;
}
export function validateWorldCommand(m,lastRequest,generation) {
  if(!Number.isSafeInteger(m.requestId)||m.requestId<=lastRequest||!Number.isSafeInteger(m.generation))throw Error('INVALID_SEQUENCE');
  if(m.generation!==(m.type==='reset'?generation+1:generation))throw Error('INVALID_GENERATION');
  switch(m.type) {
    case 'run':
      if(typeof m.running!=='boolean'||(m.untilTick!==undefined&&(!m.running||!Number.isSafeInteger(m.untilTick)||m.untilTick<100||m.untilTick%100!==0)))throw Error('INVALID_RUN');
      break;
    case 'environment':validateWorldOptions(m.options);break;
    case 'stimulus':if(!['occlusion','looming'].includes(m.stimulus))throw Error('INVALID_STIMULUS');break;
    case 'ablation':
      if(!m.controls||Object.keys(m.controls).some(k=>!['propagation','afferents','muscles'].includes(k)||typeof m.controls[k]!=='boolean'))throw Error('INVALID_ABLATION');break;
    case 'reset':
      if(m.spawn!==undefined&&m.spawn!==null&&(!m.spawn||!['x','z','yaw'].every(k=>Number.isFinite(m.spawn[k]))||Math.abs(m.spawn.x)>13.4375||Math.abs(m.spawn.z)>13.4375||Math.abs(m.spawn.yaw)>Math.PI*2))throw Error('INVALID_SPAWN');
      break;
    case 'inspect':if(typeof m.bodyId!=='string'||!/^\d{1,20}$/.test(m.bodyId))throw Error('INVALID_BODY_ID');break;
    default:throw Error('WORLD_MANAGES_NEURAL_STEPS');
  }
}
export function validateWorldFrame(m,previousTick,neurons) {
  if(!Number.isSafeInteger(m.tick)||m.tick<previousTick||!Number.isSafeInteger(m.fromTick)||m.fromTick<previousTick||m.steps!==m.tick-m.fromTick||m.steps%100!==0)throw Error('Invalid world clock');
  if(!Array.isArray(m.firing)||!Array.isArray(m.counts)||m.firing.length!==m.counts.length||m.firing.length>neurons)throw Error('Invalid world spikes');
  let sum=0,last=-1;
  for(let j=0;j<m.firing.length;j++){
    const id=m.firing[j],count=m.counts[j];
    if(!Number.isInteger(id)||id<=last||id>=neurons||!Number.isInteger(count)||count<1||count>m.steps)throw Error('Invalid world spike');
    last=id;sum+=count;
  }
  if(sum!==m.total||!Number.isSafeInteger(m.cumulativeSpikes)||m.cumulativeSpikes<m.total)throw Error('Invalid world totals');
  if(!m.pose||!['x','y','z','yaw','velocity','yawRate','phase','time','pitch','bank','wingOpen','flightBlend','launch','landing'].every(k=>Number.isFinite(m.pose[k]))||Math.abs(m.pose.time-m.tick*.0001)>1e-6||typeof m.pose.behavior!=='string')throw Error('Invalid body snapshot');
  if(m.pose.physical!==true||!Array.isArray(m.pose.rigid)||m.pose.rigid.length<1||m.pose.rigid.length>256||m.pose.rigid.some(r=>!Array.isArray(r)||r.length!==7||!r.every(Number.isFinite)))throw Error('Invalid physical transforms');
  if(!Number.isSafeInteger(m.pose.contacts)||m.pose.contacts<0||!Number.isFinite(m.pose.actuation)||m.pose.actuation<0)throw Error('Invalid physical measurements');
  if(!m.world||!Number.isFinite(m.world.time)||Math.abs(m.world.time-m.pose.time)>1e-6||!m.world.options)throw Error('Invalid environment snapshot');
  if(!['odorLeft','odorRight','visualLeft','visualRight','odor','sugar','looming'].every(k=>Number.isFinite(m.world[k])&&m.world[k]>=0))throw Error('Incomplete sensory snapshot');
  validateWorldOptions(m.world.options);
  if(m.rates?.length!==7||!m.rates.every(x=>Number.isFinite(x)&&x>=0&&x<=10000)||typeof m.running!=='boolean'||!Number.isFinite(m.speed)||m.speed<0||!Number.isFinite(m.wallMs)||m.wallMs<0)throw Error('Invalid world telemetry');
  return m;
}

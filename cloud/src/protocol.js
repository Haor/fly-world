import {WORLD_ENCODING,validateWorldOptions} from '../../fly-host/src/world-contract.js';
import {DYNAMICS_ENCODING} from '../../fly-host/src/background.js';
import { CHANNELS, PULSE_ENVELOPES } from '../../fly-host/src/stimulus.js';
import { PROTOCOL, STEP_COUNT, DT_MS } from '../../fly-host/src/neural-contract.js';
import { SENSORY_ENCODING, SENSORY_KEYS } from '../../fly-host/src/habitat.js';

const integer = x => Number.isSafeInteger(x) && x>=0;
const rate = x => Number.isFinite(x) && x>=0 && x<=300;
export function validateInit(m) {
  if(m.execution==='world') {
    if(m.worldEncoding!==WORLD_ENCODING||m.metadata!==true||m.spikeEncoding!=='index-count/1'||m.inputMode!=='sensory'||m.dynamics!=='adaptive'||!['cpu','cuda'].includes(m.compute))throw Error('INVALID_WORLD_INIT');
    validateWorldOptions(m.worldOptions||{});
  } else if(m.execution!==undefined&&m.execution!=='neural')throw Error('INVALID_EXECUTION');
  if(m.type!=='init' || m.protocol!==PROTOCOL || !['malecns-v1.0-full','malecns-v1.0-retained'].includes(m.model) ||
    (m.spikeEncoding!==undefined && m.spikeEncoding!=='index-count/1') ||
    (m.spikeEncoding==='index-count/1' && m.metadata!==true) ||
    (m.compute!==undefined && !['cpu','cuda'].includes(m.compute)) ||
    (m.inputMode!==undefined && !['sensory','assisted'].includes(m.inputMode)) ||
    (m.dynamics!==undefined && !['reference','adaptive'].includes(m.dynamics)) ||
    (m.dynamics==='adaptive' && m.dynamicsEncoding!==DYNAMICS_ENCODING) ||
    m.dtMs!==DT_MS || m.steps!==STEP_COUNT || m.spikeIds!=='body-id' ||
    m.sensoryEncoding!==SENSORY_ENCODING || JSON.stringify(m.channels)!==JSON.stringify(CHANNELS) ||
    !integer(m.seed) || m.seed>0xffffffff || typeof m.token!=='string' || m.token.length>256)
    throw Error('INVALID_INIT');
}
export function validateCommand(m,lastRequest,generation,inputMode = 'assisted', dynamics = 'reference') {
  if(!integer(m.requestId) || m.requestId<=lastRequest || !integer(m.generation))throw Error('INVALID_SEQUENCE');
  if(m.type==='reset') {
    if(m.generation!==generation+1)throw Error('INVALID_GENERATION');
  } else if(m.generation!==generation)throw Error('INVALID_GENERATION');
  switch(m.type) {
    case 'step':
      if(m.background===true&&dynamics!=='adaptive')throw Error('BACKGROUND_REQUIRES_ADAPTIVE');
      if(inputMode==='sensory' && ['walk','left','right','looming'].some(key=>m.sensory?.[key]!==0))throw Error('MOTOR_INPUT_FORBIDDEN');
      if((m.background!==undefined && typeof m.background!=='boolean') || m.steps!==STEP_COUNT || typeof m.silenced!=='boolean' || !m.sensory ||
        Object.keys(m.sensory).length!==SENSORY_KEYS.length || !SENSORY_KEYS.every(key=>rate(m.sensory[key])))
        throw Error('INVALID_STEP');
      break;
    case 'pulse':
      if(inputMode==='sensory')throw Error('DIRECT_PULSE_FORBIDDEN');
      if(!Array.isArray(m.bodyIds) || !m.bodyIds.length || m.bodyIds.length>4096 ||
        !m.bodyIds.every(id=>typeof id==='string' && /^(0|[1-9]\d{0,19})$/.test(id)) ||
        new Set(m.bodyIds).size!==m.bodyIds.length || !rate(m.strength) ||
        !Object.hasOwn(PULSE_ENVELOPES,m.profile) || typeof m.replace!=='boolean')throw Error('INVALID_PULSE');
      break;
    case 'inspect':
      if(typeof m.bodyId!=='string'||!/^\d{1,20}$/.test(m.bodyId))throw Error('INVALID_BODY_ID');
      break;
    case 'clear': case 'reset': break;
    default: throw Error('UNKNOWN_MESSAGE');
  }
}

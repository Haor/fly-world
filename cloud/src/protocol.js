import { CHANNELS, PULSE_ENVELOPES } from '../../fly-host/src/stimulus.js';
import { PROTOCOL, STEP_COUNT, DT_MS } from '../../fly-host/src/neural-contract.js';
import { SENSORY_ENCODING, SENSORY_KEYS } from '../../fly-host/src/habitat.js';

const integer = x => Number.isSafeInteger(x) && x>=0;
const rate = x => Number.isFinite(x) && x>=0 && x<=300;
export function validateInit(m) {
  if(m.type!=='init' || m.protocol!==PROTOCOL || m.model!=='malecns-v1.0-full' ||
    m.dtMs!==DT_MS || m.steps!==STEP_COUNT || m.spikeIds!=='body-id' ||
    m.sensoryEncoding!==SENSORY_ENCODING || JSON.stringify(m.channels)!==JSON.stringify(CHANNELS) ||
    !integer(m.seed) || m.seed>0xffffffff || typeof m.token!=='string' || m.token.length>256)
    throw Error('INVALID_INIT');
}
export function validateCommand(m,lastRequest,generation) {
  if(!integer(m.requestId) || m.requestId<=lastRequest || !integer(m.generation))throw Error('INVALID_SEQUENCE');
  if(m.type==='reset') {
    if(m.generation!==generation+1)throw Error('INVALID_GENERATION');
  } else if(m.generation!==generation)throw Error('INVALID_GENERATION');
  switch(m.type) {
    case 'step':
      if(m.steps!==STEP_COUNT || typeof m.silenced!=='boolean' || !m.sensory ||
        Object.keys(m.sensory).length!==SENSORY_KEYS.length || !SENSORY_KEYS.every(key=>rate(m.sensory[key])))
        throw Error('INVALID_STEP');
      break;
    case 'pulse':
      if(!Array.isArray(m.bodyIds) || !m.bodyIds.length || m.bodyIds.length>4096 ||
        !m.bodyIds.every(id=>typeof id==='string' && /^(0|[1-9]\d{0,19})$/.test(id)) ||
        new Set(m.bodyIds).size!==m.bodyIds.length || !rate(m.strength) ||
        !Object.hasOwn(PULSE_ENVELOPES,m.profile) || typeof m.replace!=='boolean')throw Error('INVALID_PULSE');
      break;
    case 'clear': case 'reset': break;
    default: throw Error('UNKNOWN_MESSAGE');
  }
}

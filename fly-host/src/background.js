import { CHANNELS, populations } from './stimulus.js';

// Experimental diffuse shot noise, not a measured endogenous MaleCNS drive.
export const BACKGROUND = Object.freeze({rateHz:40,kickMv:3,seedXor:0x9e3779b9,adaptMv:2,adaptTauMs:200});
export const DYNAMICS_ENCODING = 'adaptive-conductance/1';
export function backgroundMask(neurons) {
  const output=populations(neurons),excluded=new Set(CHANNELS.flatMap(key=>output[key]));
  return Uint8Array.from(neurons,(row,i)=>
    ['cb_intrinsic','vnc_intrinsic','ol_intrinsic'].includes(row[2]) &&
    !['L1','L2'].includes(row[1]) && !excluded.has(i) ? 1 : 0);
}

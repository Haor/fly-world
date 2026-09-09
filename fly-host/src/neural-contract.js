import { CHANNELS } from './stimulus.js';
export const PROTOCOL = 'fly-world-neural/2';
export const STEP_COUNT = 100;
export const DT_MS = .1;
export function validateResult(m, tick, projectionSize = 166700) {
  if (m.steps !== STEP_COUNT || !Number.isSafeInteger(m.tick) || m.tick !== tick + m.steps)
    throw Error('神经结果时钟不连续');
  if (m.rates?.length !== CHANNELS.length || !Array.from(m.rates).every(x => Number.isFinite(x) && x >= 0 && x <= 10000))
    throw Error('神经输出通道无效');
  if (!Number.isSafeInteger(m.total) || m.total < 0 || !Number.isFinite(m.wallMs) || m.wallMs < 0 ||
      !(Array.isArray(m.firing)||ArrayBuffer.isView(m.firing)) || !(Array.isArray(m.counts)||ArrayBuffer.isView(m.counts)) || !Number.isSafeInteger(m.firing.length) || m.firing.length !== m.counts.length || m.firing.length > projectionSize)
    throw Error('神经放电数据无效');
  const seen = new Set(); let sum = 0;
  for (let j=0;j<m.firing.length;j++) {
    const id=m.firing[j], count=m.counts[j];
    if (!Number.isInteger(id) || id<0 || id>=projectionSize || seen.has(id) || !Number.isInteger(count) || count<1 || count>m.steps)
      throw Error('神经元索引或放电计数无效');
    seen.add(id);sum+=count;
  }
  if (sum > m.total) throw Error('总放电数不一致');
}

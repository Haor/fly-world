import {cloudURL} from './cloud-brain.js';
export const RUN_MODES=Object.freeze({
  webgpu:Object.freeze({title:'本机轻量',engine:'WebGPU',model:'malecns-v1.0-retained',nodes:166700,backend:'auto',execution:'neural',detail:'浏览器运行 · 近似身体 · 无需服务'}),
  'local-cuda':Object.freeze({title:'本机全量',engine:'CUDA + MuJoCo',model:'malecns-v1.0-full',nodes:211577,backend:'cloud',execution:'world',detail:'本机 NVIDIA GPU · 完整物理闭环'}),
  remote:Object.freeze({title:'远程全量',engine:'服务器 CUDA + MuJoCo',model:'malecns-v1.0-full',nodes:211577,backend:'cloud',execution:'world',detail:'服务器独立仿真 · 网页接收观察结果'}),
});
export function serviceEndpoint(mode,value) {
  if(mode==='webgpu')throw Error('本机轻量模式不使用推理服务。');
  const url=new URL(cloudURL(value));
  if(mode==='local-cuda'&&!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('本机全量只连接本机地址；其他机器请使用远程全量。');
  if(!Object.hasOwn(RUN_MODES,mode))throw Error('未知运行方式。');
  return url.href;
}

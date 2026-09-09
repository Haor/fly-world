import { CHANNELS } from './stimulus.js';
import { PROTOCOL, STEP_COUNT, DT_MS } from './neural-contract.js';
import { SENSORY_ENCODING, SENSORY_KEYS } from './habitat.js';

export function cloudURL(value) {
  const url=new URL(value);
  const loopback=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if (url.username || url.password || url.hash || url.search ||
      !(url.protocol==='wss:' || (url.protocol==='ws:' && loopback)))
    throw Error('云端地址须使用 wss://；本机测试可使用 ws://。凭证请填入独立字段。');
  return url.href;
}
/** Worker-compatible remote transport. No automatic reconnect or local fallback. */
export class CloudBrain {
  constructor({url,token='',neurons,Socket=WebSocket,modelId='malecns-v1.0-full',compute='cpu',inputMode='assisted',onMetadata=null}) {
    this.modelId=modelId;this.compute=compute;this.inputMode=inputMode;this.onMetadata=onMetadata;this.metadataRows=[];
    this.url=cloudURL(url);this.token=token;this.neurons=neurons;
    this.byId=new Map(neurons.map((r,i)=>[String(r[0]),i]));
    this.Socket=Socket;this.sequence=0;this.generation=0;this.requests=new Map();this.closed=false;
  }
  emit(m) {this.onmessage?.({data:m});}
  error(message) {if(this.closed)return;this.emit({type:'error',message,generation:this.generation});this.terminate();}
  postMessage(m) {
    if(this.closed)return;
    if(m.type==='init') {
      this.socket=new this.Socket(this.url);
      this.socket.onopen=()=>{
        this.socket.send(JSON.stringify({type:'init',protocol:PROTOCOL,model:this.modelId,compute:this.compute,inputMode:this.inputMode,metadata:!!this.onMetadata,seed:1,
          dtMs:DT_MS,steps:STEP_COUNT,channels:CHANNELS,spikeIds:'body-id',sensoryEncoding:SENSORY_ENCODING,token:this.token}));
        this.token='';
      };
      this.socket.onmessage=e=>{try{this.receive(e.data);}catch{this.error('云端返回了无效或不兼容的数据');}};
      this.socket.onerror=()=>this.error('云端连接失败');
      this.socket.onclose=()=>this.error('云端连接已断开');
      return;
    }
    if(!this.ready || this.socket?.readyState!==1) {this.error('云端尚未就绪');return;}
    if(m.type==='reset') {this.generation=m.generation;this.requests.clear();}
    const requestId=++this.sequence;
    const wire={...m,requestId,generation:this.generation};
    if(m.type==='pulse') {
      wire.bodyIds=Array.from(m.indices,i=>{
        if(!Number.isInteger(i)||!this.neurons[i])throw Error('Invalid projection index');
        return String(this.neurons[i][0]);
      });delete wire.indices;
    }
    if(m.type==='step') {wire.steps=STEP_COUNT;wire.sensory=Object.fromEntries(SENSORY_KEYS.map(key=>[key,m.sensory?.[key]||0]));}
    if(m.type==='step'||m.type==='reset'||m.type==='inspect')this.requests.set(requestId,{type:m.type,generation:this.generation});
    this.socket.send(JSON.stringify(wire));
  }
  receive(raw) {
    if(this.closed)return;
    if(typeof raw!=='string'||raw.length>16*1024*1024)throw Error('Invalid frame size');
    const m=JSON.parse(raw);
    if(m.type==='ready') {
      if(this.ready || this.handshake || m.protocol!==PROTOCOL || m.sensoryEncoding!==SENSORY_ENCODING || m.model?.id!==this.modelId || m.model.scope!==(this.modelId.endsWith('-full')?'full':'retained') ||
        m.model.dtMs!==DT_MS || !/^[0-9a-f]{64}$/.test(m.model.connectomeSha256 || '') || !Number.isSafeInteger(m.model.neurons) || m.model.neurons<1 || m.model.neurons>500000 ||
        JSON.stringify(m.channels)!==JSON.stringify(CHANNELS))throw Error('Incompatible model');
      if(m.compute!==undefined && m.compute!==this.compute)throw Error('Compute mismatch');
      this.handshake=m;
      if(this.onMetadata) {
        if(m.metadata?.rows!==m.model.neurons)throw Error('Missing full metadata');
        this.emit({type:'stage',message:'正在接收所选模型的完整神经图…'});
      } else this.finishReady();
      return;
    }
    if(m.type==='metadata') {
      if(!this.onMetadata || !this.handshake || this.ready || !Array.isArray(m.neurons) ||
        m.offset!==this.metadataRows.length || !m.neurons.length || m.neurons.length>4096 ||
        m.offset+m.neurons.length>this.handshake.model.neurons)throw Error('Invalid metadata chunk');
      for(const row of m.neurons) {
        if(!Array.isArray(row)||!/^\d+$/.test(String(row[0]))||row.length<7 ||
          (row[6]!==null && (!Array.isArray(row[6])||row[6].length!==3||!row[6].every(Number.isFinite))))throw Error('Invalid neuron metadata');
      }
      this.metadataRows.push(...m.neurons);
      if(m.complete) {
        if(this.metadataRows.length!==this.handshake.model.neurons)throw Error('Incomplete neural graph');
        this.neurons=this.metadataRows;this.byId=new Map(this.neurons.map((r,i)=>[String(r[0]),i]));
        if(this.byId.size!==this.neurons.length)throw Error('Duplicate body IDs');
        this.onMetadata(this.neurons,this.handshake.model);this.finishReady();
      }
      return;
    }
    if(m.type==='error') {if(m.generation===undefined || m.generation===this.generation)this.error(`推理服务失败：${m.code||m.message||'UNKNOWN'}`);return;}
    const request=this.requests.get(m.requestId);
    if(!request || m.generation!==request.generation || m.generation!==this.generation)return;
    if(m.type==='reset' && request.type==='reset') {
      this.requests.delete(m.requestId);this.emit({type:'reset',generation:m.generation});return;
    }
    if(m.type==='connections'&&request.type==='inspect') {
      if(m.direction!=='incoming'||typeof m.bodyId!=='string'||!this.byId.has(m.bodyId)||!Array.isArray(m.items)||m.items.length>32||
        !Number.isSafeInteger(m.total)||m.total<m.items.length||m.items.some(item=>typeof item.bodyId!=='string'||!this.byId.has(item.bodyId)||!Number.isSafeInteger(item.weight)||item.weight<1))throw Error('Invalid connections');
      this.requests.delete(m.requestId);this.emit(m);return;
    }
    if(m.type!=='result' || request.type!=='step')throw Error('Unexpected response');
    if(!Array.isArray(m.spikes)||m.spikes.length>500000)throw Error('Invalid spikes');
    const firing=[],counts=[],seen=new Set();let sum=0;
    for(const pair of m.spikes) {
      if(!Array.isArray(pair)||pair.length!==2||typeof pair[0]!=='string'||!/^\d+$/.test(pair[0])||seen.has(pair[0])||
        !Number.isInteger(pair[1])||pair[1]<1||pair[1]>STEP_COUNT)throw Error('Invalid spike');
      seen.add(pair[0]);sum+=pair[1];
      const i=this.byId.get(pair[0]);if(i===undefined && this.onMetadata)throw Error('Firing ID outside selected graph');if(i!==undefined){firing.push(i);counts.push(pair[1]);}
    }
    if(!Number.isSafeInteger(m.total)||sum>m.total)throw Error('Invalid total');
    this.requests.delete(m.requestId);
    this.emit({type:'result',generation:m.generation,tick:m.tick,steps:m.steps,total:m.total,
      wallMs:m.wallMs,rates:m.rates,firing:Uint32Array.from(firing),counts:Uint16Array.from(counts)});
  }
  finishReady() {this.ready=true;this.emit({type:'ready',backend:'cloud',model:this.handshake.model,compute:this.compute,projectionSize:this.neurons.length});}
  terminate() {this.closed=true;this.token='';this.requests.clear();this.socket?.close();}
}

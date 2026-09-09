import {WORLD_ENCODING,validateWorldCommand} from '../../fly-host/src/world-contract.js';
import {backgroundMask,DYNAMICS_ENCODING} from '../../fly-host/src/background.js';
import { incomingConnections } from '../../fly-host/src/connections.js';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { loadModel } from './model.js';
import { loadRetained } from './model-catalog.js';
import { PythonSession } from './python-session.js';
import { validateInit, validateCommand } from './protocol.js';
import { CHANNELS } from '../../fly-host/src/stimulus.js';
import { PROTOCOL } from '../../fly-host/src/neural-contract.js';
import { SENSORY_ENCODING } from '../../fly-host/src/habitat.js';

export function createNeuralServer({graph,model,models = null,cudaPython = null,token,origins,maxSessions=1,idleMs=60000,jobMs=30000,initMs=5000,bodyDirectory=null}) {
  if(typeof token!=='string' || token.length<32 || token.length>256)throw Error('Token must be 32–256 characters');
  if(!Array.isArray(origins) || !origins.length || origins.some(origin=>new URL(origin).origin!==origin))throw Error('Explicit origins required');
  if(!Number.isInteger(maxSessions) || maxSessions<1 || maxSessions>8)throw Error('Invalid session limit');
  const catalog=models || [{graph,model}];
  const expected=createHash('sha256').update(token).digest(),sessions=new Set(),sockets=new Set();
  const http=createServer((req,res)=>{
    const paths={'/healthz':{status:'ready',sessions:sessions.size,maxSessions},'/v1/model':{protocol:PROTOCOL,sensoryEncoding:SENSORY_ENCODING,model},'/v1/models':{protocol:PROTOCOL,models:catalog.map(entry=>({...entry.model,backends:cudaPython?['cpu','cuda']:['cpu']}))}};
    const response=req.method==='GET'?paths[req.url]:null;
    res.writeHead(response?200:404,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(JSON.stringify(response||{error:'NOT_FOUND'}));
  });
  const wsServer=new WebSocketServer({noServer:true,maxPayload:256*1024,perMessageDeflate:{
    threshold:2048,clientNoContextTakeover:true,serverNoContextTakeover:true,
    zlibDeflateOptions:{level:1},concurrencyLimit:1,
  }});
  http.on('upgrade',(req,socket,head)=>{
    // Reserve only a small unauthenticated handshake pool, then allocate neural
    // state after authentication. An Origin is mandatory for CLI clients too.
    const denied=req.url!=='/neural'?404:!origins.includes(req.headers.origin)?403:wsServer.clients.size>=maxSessions+8?503:0;
    if(denied){socket.end(`HTTP/1.1 ${denied} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);return;}
    wsServer.handleUpgrade(req,socket,head,ws=>wsServer.emit('connection',ws));
  });
  wsServer.on('connection',ws=>{
    sockets.add(ws);
    let worker,ready=false,authenticated=false,closed=false,lastRequest=0,generation=0,queued=0,stepPending=false,inputMode='assisted',selectedModel=null,dynamics='reference',execution='neural',droppedFrames=0;
    let deadline,job,metadataTimer,lastMessage=Date.now(),windowStart=Date.now(),messages=0,alive=true;
    function cleanup(){if(closed)return;closed=true;clearTimeout(deadline);clearTimeout(job);clearTimeout(metadataTimer);clearInterval(heartbeat);if(worker)Promise.resolve(worker.terminate()).finally(()=>sessions.delete(ws));else sessions.delete(ws);}
    function fail(code){if(closed)return;if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'error',code,message:code,generation}));ws.close(1008,code);cleanup();}
    function send(m){if(ws.readyState!==WebSocket.OPEN)return;if(ws.bufferedAmount>16*1024*1024){fail('SLOW_CLIENT');return;}const json=JSON.stringify(m);if(Buffer.byteLength(json)>16*1024*1024){fail('RESULT_TOO_LARGE');return;}ws.send(json);}
    const heartbeat=setInterval(()=>{if(!authenticated)return;if(!alive || Date.now()-lastMessage>idleMs){ws.terminate();cleanup();return;}alive=false;ws.ping();},Math.min(15000,idleMs/2));
    ws.on('pong',()=>{alive=true;lastMessage=Date.now();});ws.on('close',()=>{sockets.delete(ws);cleanup();});ws.on('error',()=>{ws.terminate();cleanup();});
    deadline=setTimeout(()=>fail('INIT_TIMEOUT'),initMs);
    ws.on('message',(data,binary)=>{
      if(closed)return;
      try {
        if(binary)throw Error('TEXT_REQUIRED');
        const now=Date.now();if(now-windowStart>=1000){windowStart=now;messages=0;}
        if(++messages>150)throw Error('RATE_LIMIT');
        let m;try{m=JSON.parse(data.toString());}catch{throw Error('INVALID_JSON');}
        if(!m || typeof m!=='object' || Array.isArray(m))throw Error('INVALID_MESSAGE');
        lastMessage=now;
        if(!authenticated) {
          validateInit(m);
          const actual=createHash('sha256').update(m.token).digest();
          if(!timingSafeEqual(actual,expected))throw Error('UNAUTHORIZED');
          if(sessions.size>=maxSessions)throw Error('BUSY');
          const selected=catalog.find(entry=>entry.model.id===m.model);selectedModel=selected;
          if(!selected)throw Error('MODEL_UNAVAILABLE');
          const compute=m.compute||'cpu';
          const indexedSpikes=m.spikeEncoding==='index-count/1';
          if((compute==='cuda'||m.execution==='world') && !cudaPython)throw Error('CUDA_UNAVAILABLE');
          execution=m.execution||'neural';inputMode=m.inputMode||'assisted';dynamics=m.dynamics||'reference';
          selected.graph.background=backgroundMask(selected.graph.neurons);
          sessions.add(ws);authenticated=true;clearTimeout(deadline);
          deadline=setTimeout(()=>fail('MODEL_TIMEOUT'),60000);
          worker=(compute==='cuda'||execution==='world') ? new PythonSession({python:cudaPython,directory:selected.directory,format:selected.format,seed:m.seed,neurons:selected.graph.neurons,device:compute,profile:dynamics,indexedSpikes,execution,worldOptions:m.worldOptions,bodyDirectory}) :
            new Worker(new URL('./session.js',import.meta.url),{workerData:{graph:selected.graph,seed:m.seed,profile:dynamics,indexedSpikes}});
          worker.on('error',()=>fail('WORKER_FAILURE'));
          worker.on('exit',()=>{if(!closed)fail('WORKER_EXIT');});
          worker.on('message',result=>{
            if(closed)return;
            if(result.type==='loaded') {
              clearTimeout(deadline);ready=true;
              send({type:'ready',protocol:PROTOCOL,sensoryEncoding:SENSORY_ENCODING,channels:CHANNELS,
                inputMode,compute,execution,...(execution==='world'?{worldEncoding:WORLD_ENCODING,bodyEncoding:result.bodyEncoding,bodyDefinition:result.bodyDefinition}:{}),spikeEncoding:indexedSpikes?'index-count/1':'body-id/1',computeKernel:result.computeKernel||'javascript',dynamics,dynamicsEncoding:DYNAMICS_ENCODING,model:selected.model,metadata:{rows:selected.graph.n}});
              if(m.metadata===true) {
                const rows=selected.graph.neurons;let offset=0;
                const transmit=()=>{
                  if(closed)return;
                  while(offset<rows.length&&ws.bufferedAmount<512*1024){send({type:'metadata',offset,neurons:rows.slice(offset,offset+4096),complete:offset+4096>=rows.length});offset+=4096;}
                  if(offset<rows.length)metadataTimer=setTimeout(transmit,10);
                };transmit();
              }
              return;
            }
            if(result.type==='processed'){queued--;return;}
            if(result.type==='failure'){fail(result.code||'INVALID_OPERATION');return;}
            if(result.type==='result'){stepPending=false;clearTimeout(job);}
            if(result.type==='world-frame'){
              if(ws.bufferedAmount>512*1024){droppedFrames++;return;}
              result.droppedFrames=droppedFrames;droppedFrames=0;
            }
            send(result);
          });
          return;
        }
        if(!ready)throw Error('NOT_READY');
        if(execution==='world')validateWorldCommand(m,lastRequest,generation);else validateCommand(m,lastRequest,generation,inputMode,dynamics);
        if(queued>=16 || (m.type==='step' && stepPending))throw Error('BACKPRESSURE');
        lastRequest=m.requestId;generation=m.generation;
        if(m.type==='inspect'){send({...incomingConnections(selectedModel.graph,m.bodyId),requestId:m.requestId,generation});return;}
        queued++;
        if(m.type==='step'){stepPending=true;job=setTimeout(()=>fail('STEP_TIMEOUT'),jobMs);}
        worker.postMessage(m);
      } catch(error) {fail(/^[A-Z_]+$/.test(error.message)?error.message:'INVALID_MESSAGE');}
    });
  });
  return {http,model,async close(){for(const ws of sockets)ws.terminate();await new Promise(resolve=>wsServer.close(resolve));await new Promise(resolve=>http.close(resolve));}};
}

async function main() {
  const directory=process.env.MODEL_DIR;
  if(!directory || !process.env.NEURAL_TOKEN_FILE)throw Error('Set MODEL_DIR and NEURAL_TOKEN_FILE');
  const loaded=await loadModel(directory),token=(await readFile(process.env.NEURAL_TOKEN_FILE,'utf8')).trim();
  const retained=await loadRetained(process.env.RETAINED_DIR||fileURLToPath(new URL('../../fly-host/public/data/',import.meta.url)));
  const service=createNeuralServer({...loaded,models:[retained,loaded],cudaPython:process.env.CUDA_PYTHON||null,bodyDirectory:process.env.BODY_ASSET_DIR||null,token,origins:(process.env.ALLOWED_ORIGINS||'http://127.0.0.1:8768').split(','),maxSessions:Number(process.env.MAX_SESSIONS||1)});
  const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT||9000);
  await new Promise((resolve,reject)=>{service.http.once('error',reject);service.http.listen(port,host,resolve);});
  console.log(JSON.stringify({event:'listening',host,port,model:loaded.model}));
  let stopping=false;
  const stop=async()=>{if(stopping)return;stopping=true;await service.close();};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('Cloud startup failed. Check model integrity, configuration, and token file.');process.exitCode=1;});

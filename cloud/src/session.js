import { parentPort, workerData } from 'node:worker_threads';
import { BrainCPU } from '../../fly-host/src/brain.js';
import { PulseBank, populations, decodeCounts } from '../../fly-host/src/stimulus.js';
import { sensoryPopulations, addSensoryRates } from '../../fly-host/src/habitat.js';

const {graph, seed,profile,indexedSpikes}=workerData;
const brain=new BrainCPU(graph,{seed,profile}), pulses=new PulseBank(graph.n);
const output=populations(graph.neurons), input=sensoryPopulations(graph.neurons);
const byId=new Map(graph.neurons.map((row,i)=>[String(row[0]),i]));
parentPort.postMessage({type:'loaded'});
parentPort.on('message',m=>{
  try {
    if(m.type==='pulse') {
      const ids=m.bodyIds.map(id=>byId.get(id));
      if(ids.some(id=>id===undefined))throw Error('Unknown body ID');
      if(m.replace)pulses.reset();
      pulses.add(ids,brain.tick,m.strength,m.profile);
    } else if(m.type==='clear') pulses.reset();
    else if(m.type==='reset') {
      brain.reset();pulses.reset();
      parentPort.postMessage({type:'reset',requestId:m.requestId,generation:m.generation});
    } else if(m.type==='step') {
      const started=performance.now();
      const result=brain.batch(m.steps,addSensoryRates(pulses.sample(brain.tick),input,m.sensory),m.silenced,m.background);
      const rates=Array.from(decodeCounts(result.counts,output,m.steps)), spikes=[],firing=[],counts=[];
      for(let i=0;i<graph.n;i++)if(result.counts[i]){
        if(indexedSpikes){firing.push(i);counts.push(result.counts[i]);}
        else spikes.push([String(graph.neurons[i][0]),result.counts[i]]);
      }
      parentPort.postMessage({type:'result',requestId:m.requestId,generation:m.generation,
        tick:result.tick,steps:m.steps,total:result.total,wallMs:performance.now()-started,rates,...(indexedSpikes?{firing,counts}:{spikes})});
    }
    parentPort.postMessage({type:'processed'});
  } catch {
    parentPort.postMessage({type:'failure',requestId:m.requestId,generation:m.generation});
  }
});

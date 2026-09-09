import {backgroundMask,BACKGROUND} from '../../fly-host/src/background.js';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { CHANNELS, populations, PULSE_ENVELOPES } from '../../fly-host/src/stimulus.js';
import { sensoryPopulations } from '../../fly-host/src/habitat.js';
import { fileURLToPath } from 'node:url';
/** JSON-lines bridge; a failed CUDA request never falls back to CPU. */
export class PythonSession extends EventEmitter {
  constructor({python,directory,format,seed,neurons,device='cuda',profile='reference',indexedSpikes=false}) {
    super();this.stopping=false;this.buffer='';
    this.child=spawn(python,['-u',fileURLToPath(new URL('../python/session.py',import.meta.url)),
      '--model',directory,'--format',format,'--seed',String(seed),'--device',device,'--profile',profile],{stdio:['pipe','pipe','pipe']});
    // Child diagnostics contain no token. Report structured public codes upstream.
    this.child.stderr.on('data',()=>{});
    this.child.stdout.on('data',chunk=>{
      this.buffer+=chunk.toString();
      if(this.buffer.length>32*1024*1024){this.emit('error',Error('CUDA frame too large'));this.terminate();return;}
      let split;
      while((split=this.buffer.indexOf('\n'))>=0){
        const line=this.buffer.slice(0,split);this.buffer=this.buffer.slice(split+1);
        try{this.emit('message',JSON.parse(line));}catch{this.emit('error',Error('Invalid CUDA response'));}
      }
    });
    const groups=populations(neurons);
    const mask=backgroundMask(neurons);
    this.postMessage({type:'configure',indexedSpikes,backgroundIndices:Array.from({length:neurons.length},(_,i)=>i).filter(i=>mask[i]),backgroundParameters:BACKGROUND,sensory:sensoryPopulations(neurons),readout:CHANNELS.map(key=>groups[key]),envelopes:PULSE_ENVELOPES});
    this.child.on('error',error=>this.emit('error',error));
    this.child.stdin.on('error',error=>{if(!this.stopping)this.emit('error',error);});
    this.child.on('exit',code=>this.emit('exit',code));
  }
  postMessage(message){if(!this.stopping)this.child.stdin.write(JSON.stringify(message)+'\n');}
  terminate(){
    if(this.child.exitCode!==null || this.child.signalCode!==null)return Promise.resolve();
    this.stopping=true;return new Promise(resolve=>{this.child.once('exit',resolve);this.child.kill();});
  }
}

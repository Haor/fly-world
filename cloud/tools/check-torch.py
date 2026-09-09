"""Compare PyTorch CPU or CUDA with the shipped JavaScript reference on a fixture."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'python'))
from engine import TorchBrain

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--device',choices=['cpu','cuda'],default='cuda')
parser.add_argument('--profile',choices=['reference','adaptive'],default='reference')
args=parser.parse_args()
root=Path(__file__).resolve().parents[2]
script="""
import {BrainCPU,randomWord} from './fly-host/src/brain.js';
const g={n:5,sign:new Int32Array([1,1,-1,1,0]),offsets:new Uint32Array([0,0,1,2,4,5]),
 sources:new Uint32Array([0,1,1,2,3]),counts:new Uint32Array([80,70,15,80,25])};
g.background=new Uint8Array([1,0,1,0,0]);
const b=new BrainCPU(g,{seed:37,profile:process.argv[1]}),runs=[];
for(let k=0;k<8;k++){
 const rates=Float32Array.from([180,k<4?0:30,0,0,0]);
 const r=b.batch(100,rates,k===5,process.argv[1]==='adaptive');
 runs.push({counts:[...r.counts],v:[...b.v],g:[...b.g],tick:r.tick});
}
console.log(JSON.stringify({runs,random:Array.from({length:5},(_,i)=>randomWord(i,987,37))}));
"""
reference=json.loads(subprocess.check_output(['node','--input-type=module','-e',script,args.profile],cwd=root,text=True))
brain=TorchBrain(5,np.array([0,0,1,2,4,5]),np.array([0,1,1,2,3]),np.array([80,70,15,80,25]),np.array([1,1,-1,1,0]),seed=37,device=args.device,profile=args.profile)
brain.background_mask[[0,2]]=True
np.testing.assert_array_equal(brain.random_words(987).cpu().numpy(),reference['random'])
max_error=0.
for k,expected in enumerate(reference['runs']):
    actual=brain.batch(100,np.array([180,0 if k<4 else 30,0,0,0],dtype=np.float32),k==5,args.profile=='adaptive')
    np.testing.assert_array_equal(actual,expected['counts'])
    np.testing.assert_allclose(brain.v.cpu().numpy(),expected['v'],atol=.002,rtol=0)
    np.testing.assert_allclose(brain.g.cpu().numpy(),expected['g'],atol=.005,rtol=0)
    max_error=max(max_error,float(np.max(np.abs(brain.v.cpu().numpy()-expected['v']))))
brain.reset()
assert brain.tick==0
assert not brain.batch(100,np.zeros(5)).any()
print(json.dumps({'status':'PASS','device':args.device,'profile':args.profile,'steps':800,'seed':37,'maxVoltageErrorMv':max_error,'resetToRest':True}))

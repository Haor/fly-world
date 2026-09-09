"""Exercise parallel atomics, irregular batches, flag changes, and captured reset."""
import json
from pathlib import Path
import sys
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'python'))
from engine import TorchBrain
from event_cuda import EventCudaBrain
rng=np.random.default_rng(37)
n=1025
sources=np.concatenate([np.sort(rng.choice(n,size=24,replace=False)) for _ in range(n)]).astype(np.int32)
offsets=np.arange(n+1,dtype=np.int32)*24
counts=rng.integers(1,300,size=len(sources),dtype=np.int32)
signs=rng.choice(np.array([-1,0,1],dtype=np.int32),n)
engines=[cls(n,offsets,sources,counts,signs,seed=19,device='cuda',profile='adaptive') for cls in (TorchBrain,EventCudaBrain)]
for brain in engines:brain.background_mask[::3]=True
engines[1].prepare()
max_error=0.
steps_total=0
for cycle in range(2):
    for steps,silenced,background in [(1,False,True),(18,False,True),(81,False,True),(100,False,True),(100,True,True),(200,False,False),(100,False,True)]:
        rates=np.zeros(n,dtype=np.float32);rates[::11]=83.7;rates[1::17]=300
        expected,actual=[brain.batch(steps,rates,silenced,background) for brain in engines]
        np.testing.assert_array_equal(actual,expected)
        voltage=[brain.v.cpu().numpy() for brain in engines]
        error=float(np.max(np.abs(voltage[0]-voltage[1])))
        max_error=max(max_error,error)
        np.testing.assert_allclose(voltage[0],voltage[1],atol=.003,rtol=0)
        steps_total+=steps
    for brain in engines:brain.reset()
    assert not engines[1].batch(100,np.zeros(n),False,False).any()
    engines[1].reset()
assert len(engines[1].graphs)==4
print(json.dumps({'status':'PASS','neurons':n,'edges':len(sources),'steps':steps_total,'maxVoltageErrorMv':max_error,'resetReplay':True,'graphVariants':len(engines[1].graphs)}))

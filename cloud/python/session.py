"""One authenticated service session, launched by Node over bounded JSON lines."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import sys
import time
import numpy as np


def emit(message):
    print(json.dumps(message,separators=(',',':')),flush=True)


def load_graph(directory, form):
    manifest=json.loads((directory/'manifest.json').read_text())
    if form=='full':
        arrays={}
        for key,entry in manifest['files'].items():
            path=directory/entry['file']
            with path.open('rb') as stream:
                checksum=hashlib.file_digest(stream,'sha256').hexdigest()
            if checksum!=entry['sha256']:raise ValueError('MODEL_CHECKSUM')
            if key=='neurons':neurons=json.loads(gzip.decompress(path.read_bytes()))
            else:arrays[key]=np.fromfile(path,dtype='<u4')
    else:
        neurons=json.loads(gzip.decompress((directory/manifest['metadata']).read_bytes()))
        arrays={}
        for array in manifest['arrays']:
            parts=[]
            for part in array['parts']:
                data=(directory/part['file']).read_bytes()
                if hashlib.sha256(data).hexdigest()!=part['sha256']:raise ValueError('MODEL_CHECKSUM')
                parts.append(gzip.decompress(data))
            arrays[array['name']]=np.frombuffer(b''.join(parts),dtype='<u4')
    return neurons,arrays


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--model',type=Path,required=True)
    parser.add_argument('--format',choices=['full','retained'],required=True)
    parser.add_argument('--seed',type=int,default=1)
    parser.add_argument('--device',choices=['cpu','cuda'],default='cuda')
    args=parser.parse_args()
    try:
        from engine import TorchBrain
    except ImportError:
        emit({'type':'failure','code':'TORCH_NOT_INSTALLED'});return
    neurons,arrays=load_graph(args.model,args.format)
    signs=np.array([1 if r[4] in ('dopamine','octopamine','serotonin') else r[5] for r in neurons])
    brain=TorchBrain(len(neurons),arrays['offsets'],arrays['sources'],arrays['counts'],signs,args.seed,args.device)
    by_id={str(row[0]):i for i,row in enumerate(neurons)}
    pulses=[]
    # Population maps are supplied by the JavaScript owner, avoiding separate
    # sensory and readout definitions drifting between CPU and CUDA backends.
    emit({'type':'loaded'})
    mapping=None
    for line in sys.stdin:
        m=json.loads(line)
        if m['type']=='configure':mapping=m;continue
        if mapping is None:raise ValueError('MISSING_POPULATIONS')
        typ=m['type']
        if typ=='pulse':
            ids=[by_id[i] for i in m['bodyIds']]
            if m['replace']:pulses=[]
            pulses.append((ids,brain.tick,m['strength'],m['profile']));pulses=pulses[-32:]
        elif typ=='clear':pulses=[]
        elif typ=='reset':
            brain.reset();pulses=[]
            emit({'type':'reset','requestId':m['requestId'],'generation':m['generation']})
        elif typ=='step':
            began=time.perf_counter()
            rates=np.zeros(len(neurons),dtype=np.float32)
            retained=[]
            for ids,tick,strength,profile in pulses:
                envelope=mapping['envelopes'][profile]
                age=(brain.tick-tick)*.1
                if age>=envelope['durationMs']:continue
                value=strength*np.exp(-max(0,age-envelope['holdMs'])/envelope['decayMs'])
                if value<1:continue
                rates[ids]=np.maximum(rates[ids],value);retained.append((ids,tick,strength,profile))
            pulses=retained
            for key,ids in mapping['sensory'].items():
                rates[ids]=np.maximum(rates[ids],m['sensory'].get(key,0))
            counts=brain.batch(m['steps'],rates,m['silenced'])
            readout=[float(counts[ids].mean()*10000/m['steps']) if ids else 0. for ids in mapping['readout']]
            fired=np.flatnonzero(counts)
            emit({'type':'result','requestId':m['requestId'],'generation':m['generation'],
                  'tick':brain.tick,'steps':m['steps'],'total':int(counts.sum()),
                  'wallMs':(time.perf_counter()-began)*1000,'rates':readout,
                  'spikes':[[str(neurons[i][0]),int(counts[i])] for i in fired]})
        emit({'type':'processed'})


if __name__=='__main__':
    try:main()
    except Exception as exc:
        code='CUDA_UNAVAILABLE' if str(exc)=='CUDA_UNAVAILABLE' else 'CUDA_OPERATION_FAILED'
        emit({'type':'failure','code':code})
        sys.exit(1)

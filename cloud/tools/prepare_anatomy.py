"""Resolve absent soma positions from official SWC skeletons, with resumable provenance."""
import argparse,concurrent.futures,gzip,http.client,json,statistics,threading,time
from pathlib import Path

HOST='storage.googleapis.com'
PREFIX='/flyem-male-cns/v1.0/segmentation/skeletons-malecns/skeletons-swc/'
local=threading.local()

def locate(body):
    for attempt in range(3):
        try:
            if not getattr(local,'connection',None):local.connection=http.client.HTTPSConnection(HOST,timeout=25)
            local.connection.request('GET',PREFIX+body+'.swc')
            response=local.connection.getresponse();data=response.read()
            if response.status==404:return body,None,'not-found'
            if response.status!=200:raise RuntimeError('HTTP '+str(response.status))
            count=0;sums=[0.,0.,0.]
            for line in data.decode().splitlines():
                if not line or line.startswith('#'):continue
                fields=line.split()
                if len(fields)!=7:continue
                for axis in range(3):sums[axis]+=float(fields[axis+2])
                count+=1
            if not count:return body,None,'empty'
            return body,[round(value/count,3) for value in sums],'skeleton-centroid'
        except Exception:
            if getattr(local,'connection',None):local.connection.close()
            local.connection=None
            if attempt<2:time.sleep(attempt+1)
    return body,None,'download-error'

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--neurons',type=Path,default=Path('cloud/models/malecns-full/neurons.json.gz'))
    p.add_argument('--output',type=Path,default=Path('fly-host/public/data/anatomy.json.gz'))
    p.add_argument('--checkpoint',type=Path,default=Path('cloud/.cache/anatomy.json'))
    p.add_argument('--workers',type=int,default=24)
    args=p.parse_args()
    nodes=json.loads(gzip.decompress(args.neurons.read_bytes()))
    resolved=json.loads(args.checkpoint.read_text()) if args.checkpoint.exists() else {}
    missing=[str(row[0]) for row in nodes if not row[6] and (str(row[0]) not in resolved or resolved[str(row[0])][1]=='download-error')]
    def save():
        args.checkpoint.parent.mkdir(parents=True,exist_ok=True)
        tmp=args.checkpoint.with_suffix('.tmp');tmp.write_text(json.dumps(resolved,separators=(',',':')));tmp.replace(args.checkpoint)
        artifact={'schema':'fly-world-anatomy/1','units':'8nm','source':'https://'+HOST+PREFIX,
                  'positionMethod':'Mean of official skeleton vertices; not a soma location',
                  'positions':{key:value[0] for key,value in resolved.items() if value[0] is not None},
                  'unresolved':{key:value[1] for key,value in resolved.items() if value[0] is None}}
        args.output.parent.mkdir(parents=True,exist_ok=True)
        temp=args.output.with_suffix('.tmp');temp.write_bytes(gzip.compress(json.dumps(artifact,separators=(',',':')).encode(),mtime=0));temp.replace(args.output)
    print('Missing soma positions:',len(missing),flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures={executor.submit(locate,body) for body in missing}
        for i,future in enumerate(concurrent.futures.as_completed(futures),1):
            body,point,status=future.result();resolved[body]=[point,status]
            if i%500==0:save();print(json.dumps({'processed':i,'total':len(missing),'resolved':sum(value[0] is not None for value in resolved.values()),'errors':sum(value[1]=='download-error' for value in resolved.values())}),flush=True)
    save();print('Anatomy preparation complete',flush=True)
if __name__=='__main__':main()

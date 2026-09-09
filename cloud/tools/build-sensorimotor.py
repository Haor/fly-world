"""Keep official sensory/motor annotations needed for physical coupling."""
import argparse,gzip,hashlib,json
from pathlib import Path
import pyarrow.feather as feather
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--annotations',type=Path,required=True)
parser.add_argument('--output',type=Path,default=Path('fly-host/public/data/sensorimotor.json.gz'))
args=parser.parse_args()
keys=['bodyId','type','superclass','class','subclass','somaSide','rootSide','somaNeuromere','assignedOlHex1','assignedOlHex2','receptorType','entryNerve']
rows=feather.read_table(args.annotations,columns=keys).to_pylist()
selected=[r for r in rows if r['superclass'] in ['vnc_motor','vnc_sensory','cb_sensory'] or r['type'] in ['L1','L2']]
data={'schema':'sensorimotor-annotations/1','source':'https://male-cns.janelia.org/download/','sourceSha256':hashlib.sha256(args.annotations.read_bytes()).hexdigest(),'fields':keys,'rows':[[r[k] for k in keys] for r in selected]}
args.output.parent.mkdir(parents=True,exist_ok=True)
args.output.write_bytes(gzip.compress(json.dumps(data,separators=(',',':'),allow_nan=False).encode(),mtime=0))
print(json.dumps({'rows':len(selected),'bytes':args.output.stat().st_size}))

"""Autonomous server-owned physical sensorimotor loop; stdin carries controls only."""
import argparse,json,queue,sys,threading,time
from pathlib import Path
import numpy as np
from session import load_graph,emit


def run():
    from mujoco_body import NeuralBody,annotations,BODY_ENCODING
    from physical_senses import PhysicalSenses
    parser=argparse.ArgumentParser()
    parser.add_argument('--model',type=Path,required=True);parser.add_argument('--format',choices=['full','retained'],required=True)
    parser.add_argument('--seed',type=int,default=1);parser.add_argument('--device',choices=['cpu','cuda'],default='cuda');parser.add_argument('--profile',default='adaptive')
    parser.add_argument('--body',type=Path,required=True);parser.add_argument('--annotations',type=Path,required=True)
    args=parser.parse_args()
    from engine import TorchBrain
    kernel='torch-csr'
    if args.device=='cuda':
        try:import triton
        except ModuleNotFoundError as exc:
            if exc.name!='triton':raise
        else:
            from event_cuda import EventCudaBrain
            TorchBrain=EventCudaBrain;kernel='triton-events'
    neurons,arrays=load_graph(args.model,args.format)
    signs=np.array([1 if r[4] in ['dopamine','octopamine','serotonin'] else r[5] for r in neurons])
    brain=TorchBrain(len(neurons),arrays['offsets'],arrays['sources'],arrays['counts'],signs,args.seed,args.device,'adaptive')
    body=NeuralBody(args.body,neurons,annotations(args.annotations))
    inbox=queue.Queue(maxsize=32)
    def read():
        try:
            for line in sys.stdin:inbox.put(json.loads(line))
        finally:inbox.put({'type':'close'})
    threading.Thread(target=read,daemon=True).start()
    config=inbox.get()
    if config['type']!='configure':raise ValueError('MISSING_POPULATIONS')
    senses=PhysicalSenses(body,config.get('worldOptions'))
    senses.sample(0)
    if hasattr(brain,'prepare'):brain.prepare()
    definition=body.render_definition()
    emit({'type':'loaded','computeKernel':kernel,'bodyDefinition':definition,'bodyEncoding':BODY_ENCODING})
    running=False;until_tick=None;generation=0;aggregate=np.zeros(brain.n,dtype=np.uint32);total=0;frame_tick=0
    control={'propagation':True,'afferents':True,'muscles':True}
    timings={'sensesMs':0.,'neuralMs':0.,'physicsMs':0.};wall_ms=0.;last_frame=time.perf_counter();deadline=last_frame
    def frame(force=False):
        nonlocal frame_tick,wall_ms,last_frame
        now=time.perf_counter()
        if not force and now-last_frame<.05:return
        fired=np.flatnonzero(aggregate);steps=brain.tick-frame_tick
        output_rates=[float(aggregate[ids].mean()/(steps*.0001)) if ids and steps else 0. for ids in config['readout']]
        emit({'type':'world-frame','generation':generation,'tick':brain.tick,'fromTick':frame_tick,'steps':steps,
              'total':int(aggregate.sum()),'cumulativeSpikes':total,'firing':fired.tolist(),'counts':aggregate[fired].tolist(),
              'wallMs':wall_ms,'timings':dict(timings),'speed':steps*.0001/max(1e-9,now-last_frame),'running':running,'rates':output_rates,
              'pose':body.snapshot(brain.tick),'world':senses.snapshot(),'bodyEncoding':BODY_ENCODING,'ablation':control})
        aggregate.fill(0);frame_tick=brain.tick;wall_ms=0.;last_frame=now
        for key in timings:timings[key]=0.
    while True:
        commands=[]
        if not running:commands.append(inbox.get())
        while not inbox.empty():commands.append(inbox.get_nowait())
        for m in commands:
            typ=m['type']
            if typ=='close':return
            if typ=='run':
                frame(force=True)
                running=m['running'];until_tick=m.get('untilTick')
                if until_tick is not None and until_tick<=brain.tick:raise ValueError('INVALID_RUN_TARGET')
                deadline=time.perf_counter();last_frame=deadline
            elif typ=='environment':senses.options.update(m['options'])
            elif typ=='stimulus':senses.stimulus(m['stimulus'])
            elif typ=='ablation':control.update(m['controls'])
            elif typ=='reset':
                generation=m['generation'];brain.reset();body.reset(m.get('spawn'));senses.reset();until_tick=None
                senses.sample(0);aggregate.fill(0);total=0;frame_tick=0;wall_ms=0.;deadline=time.perf_counter();last_frame=deadline
                for key in timings:timings[key]=0.
                emit({'type':'reset','requestId':m['requestId'],'generation':generation,'pose':body.snapshot(0),'world':senses.snapshot(),'running':running})
                emit({'type':'processed'});continue
            else:raise ValueError('WORLD_MANAGES_NEURAL_STEPS')
            senses.sample(0)
            frame(force=True)
            emit({'type':'control','requestId':m['requestId'],'generation':generation,'operation':typ,'running':running,'appliedTick':brain.tick,'options':senses.options,'ablation':control})
            emit({'type':'processed'})
        if not running:continue
        began=time.perf_counter();rates=senses.sample(.01);after_senses=time.perf_counter();timings['sensesMs']+=(after_senses-began)*1000
        if not control['afferents']:rates.fill(0)
        counts=brain.batch(100,rates,not control['propagation'],False);after_neural=time.perf_counter();timings['neuralMs']+=(after_neural-after_senses)*1000
        body.advance(counts,.01,senses.wind(),not control['muscles']);senses.advance(.01);timings['physicsMs']+=(time.perf_counter()-after_neural)*1000
        aggregate+=counts.astype(np.uint32);total+=int(counts.sum())
        wall_ms+=(time.perf_counter()-began)*1000
        if until_tick is not None and brain.tick>=until_tick:
            running=False;until_tick=None;frame(force=True)
        else:frame()
        deadline+=.01
        delay=deadline-time.perf_counter()
        if delay>0:time.sleep(delay)

if __name__=='__main__':
    try:run()
    except ModuleNotFoundError as exc:
        emit({'type':'failure','code':'PHYSICS_NOT_INSTALLED' if exc.name=='mujoco' else 'WORLD_DEPENDENCY_MISSING'});sys.exit(1)
    except Exception:
        import traceback
        traceback.print_exc(file=sys.stderr)
        emit({'type':'failure','code':'WORLD_OPERATION_FAILED'});sys.exit(1)

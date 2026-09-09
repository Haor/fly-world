"""Sparse spike-event CUDA execution of the adaptive equations.

Triton is optional and is supplied with supported Linux CUDA PyTorch wheels.
Integer accumulation preserves synapse counts independently of queue order.
"""
import math
import numpy as np
import torch
import triton
import triton.language as tl
from engine import TorchBrain


@triton.jit
def _word(i, tick, seed: tl.constexpr):
    x = ((i.to(tl.uint32)+1)*747796405) ^ ((tick.to(tl.uint32)+1)*2891336453) ^ seed
    x = ((x ^ (x >> 16))*2246822519).to(tl.uint32)
    x = ((x ^ (x >> 13))*3266489917).to(tl.uint32)
    return (x ^ (x >> 16)).to(tl.uint32)


@triton.jit
def _propagate(Offsets, Targets, Weights, Signs, Queue, Sizes, Clock, Until, Exc, Inh,
               N: tl.constexpr, WORKERS: tl.constexpr, BLOCK: tl.constexpr):
    tick = tl.load(Clock)
    slot = tick % 19
    size = tl.load(Sizes+slot)
    ordinal = tl.program_id(0)
    lanes = tl.arange(0, BLOCK)
    while ordinal < size:
        source = tl.load(Queue+slot*N+ordinal)
        begin = tl.load(Offsets+source)
        end = tl.load(Offsets+source+1)
        sign = tl.load(Signs+source)
        edge = begin+lanes
        while tl.min(edge) < end:
            target = tl.load(Targets+edge,edge<end,0)
            weight = tl.load(Weights+edge,edge<end,0)
            valid = (edge<end) & (tl.load(Until+target)<=tick)
            tl.atomic_add(Exc+target,weight,valid & (sign>0),sem='relaxed')
            tl.atomic_add(Inh+target,weight,valid & (sign<0),sem='relaxed')
            edge += BLOCK
        ordinal += WORKERS


@triton.jit
def _advance(V, GE, GI, Adapt, Until, Mask, HasOut, Thresholds, Exc, Inh,
             Totals, Queue, Sizes, Clock, N: tl.constexpr, SEED: tl.constexpr,
             BACKGROUND: tl.constexpr, BG_THRESHOLD: tl.constexpr, BG_KICK: tl.constexpr,
             DECAY: tl.constexpr, ADAPT_DECAY: tl.constexpr, ADAPT_INCREMENT: tl.constexpr,
             BLOCK: tl.constexpr):
    i = tl.program_id(0)*BLOCK+tl.arange(0,BLOCK)
    valid = i<N
    tick = tl.load(Clock)
    v = tl.load(V+i,valid,-52.)
    ge = tl.load(GE+i,valid,0.)
    gi = tl.load(GI+i,valid,0.)
    adaptation = tl.load(Adapt+i,valid,0.)*ADAPT_DECAY
    until = tl.load(Until+i,valid,0)
    eligible = valid & (until<=tick)
    conductance = .05+ge+gi
    equilibrium = (-52.*.05-75.*gi)/conductance
    v = tl.where(eligible,equilibrium+(v-equilibrium)*tl.exp(-conductance*.1),v)
    ge = tl.where(eligible,ge*DECAY,ge)
    gi = tl.where(eligible,gi*DECAY,gi)
    fired = eligible & (v > -45.+adaptation)
    ge += tl.where(eligible,tl.load(Exc+i,valid,0).to(tl.float32)*.275/(20.*52.),0.)
    gi += tl.where(eligible,tl.load(Inh+i,valid,0).to(tl.float32)*.275/(20.*23.),0.)
    tl.store(Exc+i,0,valid)
    tl.store(Inh+i,0,valid)
    probability = tl.load(Thresholds+i,valid,0).to(tl.uint32)
    v += tl.where(eligible & (_word(i,tick,SEED)<probability),68.75,0.)
    if BACKGROUND:
        noise = eligible & (tl.load(Mask+i,valid,0)!=0) & (_word(i,tick,SEED ^ 0x9e3779b9)<BG_THRESHOLD)
        v += tl.where(noise,BG_KICK,0.)
    adaptation += tl.where(fired & (probability==0),ADAPT_INCREMENT,0.)
    tl.store(V+i,tl.where(fired,-52.,v),valid)
    tl.store(GE+i,tl.where(fired,0.,ge),valid)
    tl.store(GI+i,tl.where(fired,0.,gi),valid)
    tl.store(Adapt+i,adaptation,valid)
    tl.store(Until+i,tl.where(fired,tick+tl.where(probability>0,0,22),until),valid)
    tl.store(Totals+i,tl.load(Totals+i,valid,0)+fired.to(tl.int32),valid)
    enqueue = fired & (tl.load(HasOut+i,valid,0)!=0)
    count = tl.sum(enqueue.to(tl.int32),0)
    if count>0:
        future = (tick+18)%19
        base = tl.atomic_add(Sizes+future,count,sem='relaxed')
        rank = tl.cumsum(enqueue.to(tl.int32),0)-1
        tl.store(Queue+future*N+base+rank,i,enqueue)


@triton.jit
def _finish(Clock,Sizes):
    tick = tl.load(Clock)
    tl.store(Sizes+tick%19,0)
    tl.store(Clock,tick+1)


class EventCudaBrain(TorchBrain):
    def __init__(self,n,offsets,sources,counts,signs,seed=1,device='cuda',profile='adaptive'):
        if device!='cuda' or profile!='adaptive':
            raise ValueError('EVENT_CUDA_REQUIRES_ADAPTIVE')
        super().__init__(n,offsets,sources,counts,signs,seed,device,profile)
        del self.matrix,self.excitatory,self.inhibitory
        if np.asarray(counts,dtype=np.uint64).sum()>=2**31:
            raise ValueError('SYNAPSE_ACCUMULATOR_OVERFLOW')
        destinations=np.repeat(np.arange(n,dtype=np.int32),np.diff(offsets).astype(np.int64))
        order=np.argsort(sources,kind='stable')
        outgoing=np.zeros(n+1,dtype=np.int32)
        outgoing[1:]=np.cumsum(np.bincount(sources,minlength=n),dtype=np.int32)
        self.offsets=torch.as_tensor(outgoing,device=device)
        self.targets=torch.as_tensor(destinations[order],device=device)
        self.weights=torch.as_tensor(np.asarray(counts,dtype=np.int32)[order],device=device)
        self.signs=torch.as_tensor(np.asarray(signs,dtype=np.int32),device=device)
        self.has_out=torch.as_tensor((np.diff(outgoing)>0)&(np.asarray(signs)!=0),device=device)
        self.queue=torch.zeros((19,n),dtype=torch.int32,device=device)
        self.sizes=torch.zeros(19,dtype=torch.int32,device=device)
        self.clock=torch.zeros(1,dtype=torch.int64,device=device)
        self.exc=torch.zeros(n,dtype=torch.int32,device=device)
        self.inh=torch.zeros_like(self.exc)
        self.totals=torch.zeros_like(self.exc)
        self.thresholds=torch.zeros_like(self.exc)
        self.graphs={}
        self.workers=min(128,torch.cuda.get_device_properties(0).multi_processor_count)
        self.kernel='triton-events'

    def reset(self):
        if not hasattr(self,'clock'):
            super().reset()
            return
        self.v.fill_(-52.)
        for tensor in (self.g,self.ge,self.gi,self.adaptation,self.until,self.history,self.queue,self.sizes,self.clock,self.exc,self.inh,self.totals):
            tensor.zero_()
        self.tick=0

    def _step(self,silenced,background):
        if not silenced:
            _propagate[(self.workers,)](self.offsets,self.targets,self.weights,self.signs,self.queue,self.sizes,self.clock,self.until,self.exc,self.inh,
                N=self.n,WORKERS=self.workers,BLOCK=128,enable_fp_fusion=False)
        _advance[(triton.cdiv(self.n,256),)](self.v,self.ge,self.gi,self.adaptation,self.until,self.background_mask,self.has_out,self.thresholds,self.exc,self.inh,
            self.totals,self.queue,self.sizes,self.clock,N=self.n,SEED=self.seed,BACKGROUND=background,
            BG_THRESHOLD=math.ceil(self.background_rate*.0001*4294967296),BG_KICK=self.background_kick,
            DECAY=self.es,ADAPT_DECAY=self.adapt_decay,ADAPT_INCREMENT=self.adapt_increment,BLOCK=256,enable_fp_fusion=False)
        _finish[(1,)](self.clock,self.sizes)

    def _capture(self,steps,silenced,background):
        key=(steps,silenced,background,self.background_rate,self.background_kick,self.adapt_decay,self.adapt_increment)
        if key in self.graphs:return self.graphs[key]
        tensors=(self.v,self.ge,self.gi,self.adaptation,self.until,self.queue,self.sizes,self.clock,self.exc,self.inh,self.totals)
        saved=[t.clone() for t in tensors]
        stream=torch.cuda.Stream()
        stream.wait_stream(torch.cuda.current_stream())
        with torch.cuda.stream(stream):
            self._step(silenced,background)
        torch.cuda.current_stream().wait_stream(stream)
        graph=torch.cuda.CUDAGraph()
        with torch.cuda.graph(graph):
            for _ in range(steps):self._step(silenced,background)
        for target,value in zip(tensors,saved):target.copy_(value)
        self.graphs[key]=graph
        return graph

    def prepare(self):
        for silenced in (False,True):
            for background in (False,True):self._capture(100,silenced,background)

    @torch.inference_mode()
    def batch(self,steps,rates,silenced=False,background=False):
        if steps<1 or steps>200:raise ValueError('INVALID_STEPS')
        probabilities=np.ceil(np.asarray(rates,dtype=np.float32).astype(np.float64)*.0001*4294967296).astype(np.int32)
        self.thresholds.copy_(torch.from_numpy(probabilities))
        graph=self._capture(steps,silenced,background) if steps==100 else None
        self.totals.zero_()
        if graph is not None:graph.replay()
        else:
            for _ in range(steps):self._step(silenced,background)
        self.tick+=steps
        return self.totals.cpu().numpy().copy()

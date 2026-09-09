"""Independent PyTorch implementation of Fly World's existing LIF step contract.

The equations and event order follow fly-host/src/brain.js, not FlyWire weights
or another project's numerical integrator. CUDA is explicit; CPU is for parity tests.
"""
import math
import numpy as np
import torch


class TorchBrain:
    def __init__(self, n, offsets, sources, counts, signs, seed=1, device='cuda', profile='reference'):
        if device == 'cuda' and not torch.cuda.is_available():
            raise RuntimeError('CUDA_UNAVAILABLE')
        self.device = torch.device(device)
        self.n, self.seed, self.profile = n, seed, profile
        self.background_mask = torch.zeros(n, dtype=torch.bool, device=self.device)
        self.background_rate = 40.
        self.background_kick = 3.
        self.adapt_increment = 2.
        self.adapt_decay = math.exp(-.1/200)
        self.ids = torch.arange(n, dtype=torch.int64, device=self.device)
        weights = np.asarray(counts, dtype=np.float32) * np.asarray(signs, dtype=np.float32)[sources] * np.float32(.275)
        self.matrix = torch.sparse_csr_tensor(
            torch.as_tensor(np.asarray(offsets, dtype=np.int64), device=self.device),
            torch.as_tensor(np.asarray(sources, dtype=np.int64), device=self.device),
            torch.as_tensor(weights, device=self.device), size=(n, n), device=self.device, check_invariants=True)
        if profile == 'adaptive':
            def matrix(values):
                return torch.sparse_csr_tensor(self.matrix.crow_indices(), self.matrix.col_indices(), values, size=(n,n),device=self.device)
            self.excitatory = matrix(torch.clamp(self.matrix.values(), min=0)/(20*52))
            self.inhibitory = matrix(torch.clamp(-self.matrix.values(), min=0)/(20*23))
        self.em, self.es = math.exp(-.1/20), math.exp(-.1/5)
        self.coupling = 5/15*(self.em-self.es)
        self.reset()

    def reset(self):
        self.v = torch.full((self.n,), -52., device=self.device)
        self.g = torch.zeros(self.n, device=self.device)
        self.ge = torch.zeros_like(self.g)
        self.gi = torch.zeros_like(self.g)
        self.adaptation = torch.zeros_like(self.g)
        self.until = torch.zeros(self.n, dtype=torch.int64, device=self.device)
        self.history = torch.zeros((19,self.n), device=self.device)
        self.tick = 0

    def random_words(self, tick, salt=0):
        mask = 0xffffffff
        x = (((self.ids + 1) * 747796405) ^ (((tick + 1) * 2891336453) & mask) ^ (self.seed ^ salt)) & mask
        x = ((x ^ (x >> 16)) * 2246822519) & mask
        x = ((x ^ (x >> 13)) * 3266489917) & mask
        return (x ^ (x >> 16)) & mask

    @torch.inference_mode()
    def batch(self, steps, rates, silenced=False, background=False):
        rates = torch.as_tensor(rates, dtype=torch.float32, device=self.device)
        totals = torch.zeros(self.n, dtype=torch.int32, device=self.device)
        for _ in range(steps):
            t = self.tick
            eligible = self.until <= t
            if self.profile == 'adaptive':
                self.adaptation *= self.adapt_decay
                conductance = .05+self.ge+self.gi
                target = (-52*.05-75*self.gi)/conductance
                self.v = torch.where(eligible, target+(self.v-target)*torch.exp(-conductance*.1), self.v)
                self.ge = torch.where(eligible, self.ge*self.es, self.ge)
                self.gi = torch.where(eligible, self.gi*self.es, self.gi)
                fired = eligible & (self.v > -45+self.adaptation)
                if not silenced:
                    arriving = self.history[t % 19].unsqueeze(1)
                    self.ge += torch.where(eligible, torch.sparse.mm(self.excitatory,arriving).squeeze(1),0.)
                    self.gi += torch.where(eligible, torch.sparse.mm(self.inhibitory,arriving).squeeze(1),0.)
            else:
                self.v = torch.where(eligible, -52+(self.v+52)*self.em+self.g*self.coupling, self.v)
                self.g = torch.where(eligible, self.g*self.es, self.g)
                fired = eligible & (self.v > -45)
                if not silenced:
                    incoming = torch.sparse.mm(self.matrix, self.history[t % 19].unsqueeze(1)).squeeze(1)
                    self.g += torch.where(eligible, incoming, 0.)
            external = eligible & (self.random_words(t).to(torch.float64)/4294967296 < rates.to(torch.float64)*.0001)
            self.v += external.to(torch.float32)*68.75
            if background and self.profile == 'adaptive':
                noise = eligible & self.background_mask & (self.random_words(t,0x9e3779b9).to(torch.float64)/4294967296 < self.background_rate*.0001)
                self.v += noise.to(torch.float32)*self.background_kick
            if self.profile == 'adaptive':
                self.adaptation += (fired & (rates==0)).to(torch.float32)*self.adapt_increment
                self.ge = torch.where(fired,0.,self.ge)
                self.gi = torch.where(fired,0.,self.gi)
            self.v = torch.where(fired, -52., self.v)
            self.g = torch.where(fired, 0., self.g)
            self.until = torch.where(fired, t+torch.where(rates>0,0,22), self.until)
            totals += fired.to(torch.int32)
            self.history[t % 19].zero_()
            self.history[(t+18) % 19].copy_(fired)
            self.tick += 1
        return totals.cpu().numpy()

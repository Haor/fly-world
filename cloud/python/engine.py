"""Independent PyTorch implementation of Fly World's existing LIF step contract.

The equations and event order follow fly-host/src/brain.js, not FlyWire weights
or another project's numerical integrator. CUDA is explicit; CPU is for parity tests.
"""
import math
import numpy as np
import torch


class TorchBrain:
    def __init__(self, n, offsets, sources, counts, signs, seed=1, device='cuda'):
        if device == 'cuda' and not torch.cuda.is_available():
            raise RuntimeError('CUDA_UNAVAILABLE')
        self.device = torch.device(device)
        self.n, self.seed = n, seed
        self.ids = torch.arange(n, dtype=torch.int64, device=self.device)
        weights = np.asarray(counts, dtype=np.float32) * np.asarray(signs, dtype=np.float32)[sources] * np.float32(.275)
        self.matrix = torch.sparse_csr_tensor(
            torch.as_tensor(np.asarray(offsets, dtype=np.int64), device=self.device),
            torch.as_tensor(np.asarray(sources, dtype=np.int64), device=self.device),
            torch.as_tensor(weights, device=self.device), size=(n, n), device=self.device, check_invariants=True)
        self.em, self.es = math.exp(-.1/20), math.exp(-.1/5)
        self.coupling = 5/15*(self.em-self.es)
        self.reset()

    def reset(self):
        self.v = torch.full((self.n,), -52., device=self.device)
        self.g = torch.zeros(self.n, device=self.device)
        self.until = torch.zeros(self.n, dtype=torch.int64, device=self.device)
        self.history = torch.zeros((19,self.n), device=self.device)
        self.tick = 0

    def random_words(self, tick):
        mask = 0xffffffff
        x = (((self.ids + 1) * 747796405) ^ (((tick + 1) * 2891336453) & mask) ^ self.seed) & mask
        x = ((x ^ (x >> 16)) * 2246822519) & mask
        x = ((x ^ (x >> 13)) * 3266489917) & mask
        return (x ^ (x >> 16)) & mask

    @torch.inference_mode()
    def batch(self, steps, rates, silenced=False):
        rates = torch.as_tensor(rates, dtype=torch.float32, device=self.device)
        totals = torch.zeros(self.n, dtype=torch.int32, device=self.device)
        for _ in range(steps):
            t = self.tick
            eligible = self.until <= t
            self.v = torch.where(eligible, -52+(self.v+52)*self.em+self.g*self.coupling, self.v)
            self.g = torch.where(eligible, self.g*self.es, self.g)
            fired = eligible & (self.v > -45)
            if not silenced:
                incoming = torch.sparse.mm(self.matrix, self.history[t % 19].unsqueeze(1)).squeeze(1)
                self.g += torch.where(eligible, incoming, 0.)
            external = eligible & (self.random_words(t).to(torch.float64)/4294967296 < rates.to(torch.float64)*.0001)
            self.v += external.to(torch.float32)*68.75
            self.v = torch.where(fired, -52., self.v)
            self.g = torch.where(fired, 0., self.g)
            self.until = torch.where(fired, t+torch.where(rates>0,0,22), self.until)
            totals += fired.to(torch.int32)
            self.history[t % 19].zero_()
            self.history[(t+18) % 19].copy_(fired)
            self.tick += 1
        return totals.cpu().numpy()

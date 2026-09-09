[简体中文](autonomous-dynamics.zh_CN.md)

# Autonomous dynamics and the sensory loop

The station defaults to sensory input with the experimental adaptive profile.
Light, occlusion, bilateral odor, and food contact drive sensory populations.
The connectome propagates activity to selected movement readouts. Their firing
rates drive the body; its new pose changes the next sensory sample. There is no
food-direction command, minimum walking speed, or random movement instruction.

The reference profile preserves the previous current-based LIF equations. The
adaptive profile is a separate experiment, not a validated extension of the Shiu
model. Both use the selected retained or full graph and supported compute backend.

## Equations and parameters

The adaptive profile stores nonnegative excitatory and inhibitory conductances
`gE` and `gI` in inverse milliseconds. Leak conductance is `gL = 1/20`. Reversal
potentials are −52 mV for leak, 0 mV for excitation, and −75 mV for inhibition.
For each 0.1 ms step, conductances are held constant during the voltage update:

```
k = gL + gE + gI
V∞ = (gL × −52 + gE × 0 + gI × −75) / k
Vnext = V∞ + (V − V∞) × exp(−k × 0.1)
```

Conductances then decay with a 5 ms time constant. Synaptic delivery retains the
1.8 ms delay. Excitatory and inhibitory increments are respectively
`synapseCount × 0.275 / (20 × 52)` and `synapseCount × 0.275 / (20 × 23)`.
This matches the reference input slope near rest; it is a modeling convention,
not measured single-synapse conductance. Inhibition approaches its reversal
potential instead of forcing voltage to arbitrarily negative values.

The threshold is `−45 + adaptation` mV. A spike adds 2 mV of adaptation unless
the neuron has an externally clamped sensory rate. Adaptation decays over 200 ms.
Reset clears conductances, adaptation, refractory state, and delayed events.
Sensory inputs retain the reference 68.75 mV Poisson events and refractory rule.

Optional background events occur independently at 40 Hz per eligible neuron,
with a 3 mV membrane increment. Eligible classes are `cb_intrinsic`,
`ol_intrinsic`, and `vnc_intrinsic`, excluding L1/L2 sensory entries and every
selected motor readout. Sensory, descending, and motor classes are not targets.
A separate seeded random stream makes paired controls reproducible. Disabling
the environment leaves background activity enabled. The zero-input reset disables both.

The adaptive body decoder consumes the same seven firing-rate channels. It
removes the reference 6/15 Hz walk/turn dead zones, with walk and turn saturation
scales of 12/20 Hz. Zero output still produces zero motion. The body remains a
reduced kinematic model with contact constraints, not muscle-level simulation.
All background, adaptation, reversal, and decoder values are experimental parameters.

## Related implementations

| Project | Relevant mechanism and limit |
| --- | --- |
| [fly-escape](https://github.com/dzhng/fly-escape/blob/88813fe5c552e42269ba63858fe0e0057fbfcb43/crates/sim/src/lif.rs) | Tonic drive and Gaussian noise; thrust from mean membrane voltage, olfactory steering from firing differences. Its no-environment baseline differs from the previous resting Fly World model. |
| [DesktopFly](https://github.com/DenisSergeevitch/desktop-fly/blob/32b00011e83c3dc85fa3ea0b3934155b04f1635d/Sim.swift) | Heterogeneous background, random input, category-specific drive, and additional body interfaces. Motion cannot be attributed to sensory input alone. |
| [Infinite Sugar](https://github.com/cnqso/infinite-sugar/blob/c7b98e84f53d7afaf85b77bd7a358847cf9bfdf7/web/brain.js) | Tonic background, sparse noise, and a separate inhibitory delay. Its application supplies leg motion patterns. |
| [Fly Brain Minecraft](https://github.com/blendi-remade/fly-brain-minecraft/blob/6cfa30175003ef25da68a237d5eda958f8047b82/src/main/java/com/fruitfly/brain/LifConfig.java) | Separates reference equations, synaptic gain, optional adaptation, and readout calibration. MaleCNS needs its own parameter checks. |
| [Eon embodiment](https://eon.systems/updates/embodied-brain-emulation) | Connectome outputs drive existing body controllers. The authors describe hand-set mappings and vision that did not yet substantially affect behavior. |
| [FlyVis](https://github.com/TuragaLab/flyvis) / [NeuroMechFly](https://github.com/NeLy-EPFL/flygym) | More complete visual models, physics, and sensory interfaces. Integration requires separate mapping and calibration. |

No neural kernel from these projects was copied. Fly World's experimental
conductance equations have independent CPU, WebGPU, and PyTorch implementations.
Existing reference code and assets retain their original attribution.

## Checks and limits

Unit checks cover rest, bounded inhibition, adaptation/reset, background target
exclusion, propagation-dependent motor recruitment, and low-rate decoding.
Browser startup checks both profiles against JavaScript. The PyTorch command
`cloud/tools/check-torch.py --profile adaptive --device cuda` runs a seeded
800-step comparison.

`cloud/tools/check-autonomy.js` compares quiet, background-only, environmental,
left/right light, and disconnected conditions at matched seeds. It checks movement
and downstream sensory effects, not successful attraction or foraging.

Vision remains a bilateral L1/L2 brightness proxy; odor is a static field.
A complete retina, turbulent odor transport, learning, and validated foraging
remain absent. Long full-model spike-by-spike agreement across backends is not established.

## Recorded CUDA validation

[Machine-readable paired results](validation/adaptive-cuda.json) cover seeds 1, 7,
and 19 on the full 211,577-node model, with PyTorch 2.5.1+cu124 / Python 3.12 on an
RTX 4090 D. All three seeds moved under background and sensory conditions; quiet
and disconnected controls had zero displacement and zero motor output. Changing
light direction changed downstream activity, but did not establish consistent
phototaxis. The one-second sensory runs moved 1.19–1.37 mm. Compute throughput was
about 0.10 neural seconds per wall second; this is not real-time performance.

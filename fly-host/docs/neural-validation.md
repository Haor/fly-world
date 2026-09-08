[简体中文](neural-validation.zh_CN.md)

# Neural implementation validation

Checked on 2026-09-08. The tested LIF equations, connection direction, and delay
match the current implementation contract. Pause and result-delivery defects were
fixed. This remains a connectome-driven demonstration, not a validated complete fly.

## Evidence

- All 27 compressed connectivity parts match manifest SHA-256 values. CSR bounds,
  unique neuron IDs, indices, and counts pass: 166,700 neurons, 25,582,938 edges,
  and 124,177,617 synapses.
- Excitatory and inhibitory impulse responses agree with the analytical solution
  within 0.0001 mV over 400 steps. Delivery occurs after 18 steps of 0.1 ms.
- Tests cover the 2.2 ms refractory interval, rejected input during that interval,
  and the directly stimulated-neuron refractory exception.
- Browser startup compares CPU/GPU on a 257-neuron fixture. Each GPU population
  readout is also compared with CPU decoding of returned counts. Full-graph,
  cross-seed, neuron-by-neuron CPU/GPU equivalence has not been established.
- The local retained graph passes a seed-1, 12-neural-second closed loop, with
  about 1.05 seconds of accumulated feeding and three takeoffs. Contact taste,
  looming escape, disabled senses, zero input, and disabled propagation pass.
- Result tests cover discontinuous clocks, NaN rates, invalid or duplicate IDs,
  inconsistent counts, and stale or duplicate deliveries.

The closed-loop test's distance is accumulated by the motor decoder and includes
attempted movement at boundaries. It is not actual path length. Observation
records separately derive distance from coordinates. One seeded trajectory is
not a general success rate or long-duration stability result.

## Fixes

Pause now holds an in-flight result until resume. Reset discards held results.
The simulation consumes only pending batches and validates cumulative ticks,
channel dimensions, and counts. Old-generation errors no longer interrupt a reset
session. The numerical brain core was not changed.

## Scientific scope

The [reference implementation](https://github.com/philshiu/Drosophila_brain_model/blob/main/model.py)
uses LIF dynamics with resting/threshold voltages -52/-45 mV, membrane/synaptic
constants 20/5 ms, delay 1.8 ms, refractory period 2.2 ms, and 0.275 mV per synapse.
Direct Poisson targets have no refractory period. The current equations follow
these conventions. This audit did not run an end-to-end Brian2 reproduction with
identical random input. The [paper](https://www.nature.com/articles/s41586-024-07763-9)
validated selected sensorimotor predictions on FlyWire; this MaleCNS adaptation
does not inherit its biological accuracy claims.

Remaining limits:

- Rows without superclass are excluded. The local graph is a retained subset.
- Histamine and unknown transmitters have no fast output. Monoamines share an
  excitatory sign; receptor-specific and slow modulatory effects are absent.
- Analytic looming bypasses the retina. ORN_DM1 input uses bilateral sampling
  and simplified adaptation. The optional navigation aid is authored; its behavior
  is not proof of emergent connectome navigation. See [foraging](foraging.md).
- LC9 tonic input and DNa02 turn bias are authored. DNa02 directly drives an output
  pathway; that component of turning is not evidence of spontaneous decisions.
- Boundary collisions constrain position without choosing a turn. Outward motor
  output can leave the fly stationary at an edge; reliable autonomous avoidance
  is not established.
- Hunger, energy, contact gating, and body decoding are engineering rules. Energy
  uses decoded speed, so attempted motion at a wall may consume energy.
- Sequential CPU floating-point accumulation and GPU integer aggregation followed
  by scaling need not be bitwise identical. Threshold sensitivity needs further
  study. Learning, plasticity, and long-duration multi-seed behavior are untested.

Run `node --test tests/*.test.js`, `node tests/data-integrity.mjs`,
`node tests/closed-loop.mjs`, and `npm run build` to repeat the local checks.
See the [cloud contract](cloud-inference.md) for its separate verification gaps.
A larger or faster graph does not remove these model assumptions.

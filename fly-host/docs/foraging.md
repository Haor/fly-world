[简体中文](foraging.zh_CN.md)

# Odor-guided foraging

Odor input is on by default. The navigation aid is active only in Assisted experiment mode. Sensory-only is the default mode. Disable the aid to retain
sensory input without its steering policy. Disable odor to return to the original
exploration drive. The field overlay controls rendering only. Reset clears odor
history and needs but preserves the switches. Pause also pauses sensory adaptation.
The browser sends the resulting body pose through the existing USB bridge. Offline
firmware still uses its local pet rules; this change does not add offline foraging.

Select **换个起点** (change start) to reset neural state at a random position and heading away from food. The ordinary Reset button restores the original start. Both preserve pause and input settings.

## Inputs and control

The static field is `25 * exp(-distance_mm / 7)`. Each antenna samples 0.9 mm ahead
of the body center and 0.3 mm to either side. These distances and the field are
engineering parameters, not a calibrated reconstruction of the animal's receptors.
For each side, a 2 s exponential baseline is subtracted with gain 0.6. Rates are
clamped to 0–25 Hz and sent to L/R annotated ORN_DM1 neurons. Unknown-side rows
receive no odor drive. The map displays field values before adaptation.

The aid receives only the two local samples, their recent history, contact,
ground state, needs, time, and drive gain. It cannot access food coordinates.
It smooths the normalized side difference and concentration derivative over
0.25 neural seconds. A side difference biases DNa02 input towards stronger odor.
Absent odor or a decrease with little side information triggers alternating
search turns. LC9 drive slows during stronger turns. All movement still uses
the existing neural output decoder; the aid does not write position or yaw.

The aid stops during rest, flight, satiation, or food contact with taste enabled.
Contact supplies taste input; feeding still requires contact, an unsatiated body,
and sufficient neural MN9 output. The existing hunger rule controls satiation.
Only the aid is suppressed by satiation; other neural activity can continue.

This is an authored navigation policy. Stimulating a descending neuron does not
make the policy a spontaneous decision of the connectome. The current model does
not establish that bilateral ORN_DM1 input alone produces reliable navigation.
It omits wind, turbulent plumes, multiple odor identities, and learned preference.
The cloud contract uses `population-hz/2` to preserve separate left/right rates.

## Verification

- `node --test tests/*.test.js`: side mapping, mirror/rotation symmetry, adaptation,
  paused/reset history, independent switches, needs, no movement from silent
  readouts, and cloud encoding negotiation.
- The navigation geometry test compares intact sensing, no odor, and swapped
  antennae in 40 seeded random source/start worlds. It uses a simple actuator and
  tests the policy only; it does not validate neural navigation.
- `FORAGE_TRIALS=3 FORAGE_SECONDS=10 node tests/foraging-loop.mjs`: paired starts
  and neural seeds across the complete retained local graph, with aid on, odor
  off, and aid off. Logs include initial pose, first contact, first feeding,
  final distance, and neural spikes. Trials stop at first feeding or timeout.
  This small smoke comparison is not a population success-rate estimate.

CSV observations include left/right input rates, field-change rate, and aid state.
They retain the existing last-12-neural-seconds window.

Background: [odor onset, loss, and local search in walking flies](https://elifesciences.org/articles/37815).
That experiment also used wind cues, which this implementation does not simulate.

## Recorded result — 2026-09-08

The retained CPU graph found food in all three aid-on trials, at 3.98, 6.11,
and 7.56 neural seconds. Neither odor-off nor aid-off reached food in any of
the paired 10 s trials (0/3 each). This is a small seeded comparison, not an
estimate of general reliability. [Machine-readable results](foraging-results.json).

The browser WebGPU path also completed feeding after a random-start reset.
Independent switches, pause/reset, and USB synchronization were checked.
No remote inference service or new physical-button test was run. Wind and
reliable obstacle avoidance remain outside this validation.

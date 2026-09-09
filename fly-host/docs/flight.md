[简体中文](flight.zh_CN.md)

# Flight readout

Flight uses complete spike records from the selected graph. Sensory mode adds no motor input, random takeoff, or timed takeoff.

| Body interface | MaleCNS types | Interpretation |
| --- | --- | --- |
| Fast takeoff | DNp01 / GF | Raw events bypass the old 80 ms filter. A 10 ms result frame still loses submillisecond timing. |
| Other takeoff paths | DNp11; DNp02 with DNp04 | A DNp11 event, or preparation and jump events within 50 ms. The window and direction decoder are model settings. |
| Flight muscle power | DLMn a, b; DLMn c-f; DVMn 1a-c; DVMn 2a, b; DVMn 3a, b | 12 motor neurons on each side in the full graph. Their mean rate drives asynchronous muscle activation. |
| Airborne control | DNg02_a through DNg02_g | 15 left and 14 right descending neurons. Their rate difference changes yaw; they cannot initiate flight or replace power motor neurons. |
| Landing | DNp07 and DNp10 | Interpreted only in flight. Translating landing posture into lift reduction is a body-model choice. |

All groups are outside direct background and pure sensory inputs. The retained graph builds its own map from metadata. Missing groups return zero; no neurons are invented.

## Body model

Walking keeps the seven existing rate channels. Flight is decoded separately from complete `firing/counts` records. Muscle rates use an 80 ms filter. The power target is `tanh(meanHz / 5)`; activation rises with a 0.442 s time constant and falls with a 1.79 s constant. The two constants follow [Gordon and Dickinson's muscle study](https://pmc.ncbi.nlm.nih.gov/articles/PMC1449689/). The gain and lift mapping are not physiologically calibrated.

A takeoff event gives an 80 mm/s vertical impulse. Without muscle activity, this produces a jump of about 0.33 mm. With sufficient activation, a reduced lift controller holds about 3 mm altitude. Neural activation limits lift and sets forward speed to `24 × activation` mm/s. Physics uses 1 ms substeps, gravity, ground contact, and a 200 ms post-contact cooldown. Flight has no fixed 0.9 s duration. Loss of muscle activation or a landing response brings the body down. Activation is not measured calcium, and the body is not a muscle-level simulation.

Position, orientation, and altitude affect subsequent light, rock occlusion, odor, and food contact. Vision remains a light proxy without a full retina, optic flow, or flight proprioception. Flight does not establish obstacle avoidance or phototaxis. World bounds constrain position without selecting a turn.

## Verification

`node --test fly-host/tests/flight.test.js` checks mappings, input exclusions, single GF events, power without takeoff, sustained powered flight, power loss, landing, and reset.

`node cloud/tools/check-autonomy.js` uses the standard API for full-model background, environment, occlusion, light-direction, disconnected-network, and muscle-output-ablation controls. Ablation is a test operation, not a station control. Five-second runs also require powered flight in the default sensory case. The test does not validate natural takeoff probability.

[RTX 4090 D records](validation/flight-cuda.json) include rates, takeoffs, airborne duration, powered duration, and height. Muscle-output and network ablation test different causal boundaries. Background-only conditions can also produce flight; flight cannot always be attributed to external sensation.

## Sources

- [GF spike timing](https://www.nature.com/articles/nn.3741).
- [Takeoff direction and DNp02 / DNp04 / DNp11](https://pmc.ncbi.nlm.nih.gov/articles/PMC9849133/).
- [DNg02 flight modulation](https://pmc.ncbi.nlm.nih.gov/articles/PMC9206711/).
- [DNp07 / DNp10 landing responses](https://www.nature.com/articles/s41593-019-0413-4).
- [MaleCNS annotations](https://male-cns.janelia.org/download/).

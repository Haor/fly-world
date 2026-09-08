[简体中文](README.zh_CN.md)

# Fly World observation station

A local observation interface for the MaleCNS fly and AI Passport companion.
The habitat, neural activity, and articulated body share one simulation clock.

Build with `npm run build`. Start the sibling Passport bridge with
`../ai-passport/tools/start-fly-world.command`, open the local station on port
8768, and select the start button. The model and body assets are served locally.
The station can run without a USB device.

## Observation tools

- Display shadows affect rendering only. The separate looming-stimulus button in the experiment controls lasts 0.65 neural seconds and does not repeat automatically.

- Switch between the habitat, neural activity, and body views on the navigation rail.
- Inspect movement trails and the authored odor field in the habitat.
- Pause or reset the complete neural world. Reset preserves input settings.
- Read recent neural output curves and behavior events. CSV export contains the
  last 12 neural seconds of samples and up to 80 events, not a full-session archive.
- Use the perception switches to enable or disable individual sensory encoders.
- The advanced controls provide direct neural pulses, a zero-input reset,
  synaptic-transmission control, and backend selection.
- The device panel shows connection and display state. If another page owns the
  USB lease, the takeover button explicitly transfers control to this station.

## Model boundaries

The static odor field is `25 * exp(-distance_mm / 7)`. Two antennae sample it
separately; a simplified adaptation stage supplies left/right ORN_DM1 rates.
Odor input and the navigation aid are enabled by default and have separate
switches. The aid uses local concentration differences and recent changes to
drive LC9 and DNa02. It does not read the food position or move the body directly.
This is an engineered strategy, not demonstrated emergent neural navigation.
Wind is absent. The field overlay shows pre-adaptation values and is display-only.
See [foraging](docs/foraging.md) for parameters and validation boundaries.

The LC9 exploration drive, DNa02 turn bias, hunger, energy, sensory encoders,
and body decoder are authored assumptions. The connectome alone does not
provide a complete behaving fly. The model dialog distinguishes these layers.
The three-dimensional body is a female NeuroMechFly specimen.

## Implementation

- `src/simulation.js`: worker lifecycle, neural-world clock, pause/reset, CPU fallback.
- `src/main.js`: station interactions and observation rendering.
- `src/habitat.js` and `src/habitat-view.js`: environment and pixel habitat.
- `src/olfaction.js`: bilateral sensory adaptation and the optional navigation aid.
- `src/observations.js`: bounded neural-time samples, events, and CSV output.
- `src/passport.js`: USB companion transport, device status, and explicit takeover.
- `src/brain-view.js`, `src/scene.js`, and neural compute modules reuse and adapt
  [Xenova Neural Canvas](https://huggingface.co/spaces/Xenova/fruit-fly-simulation).
  Existing licenses and model/data attribution are retained.

Run `node --test tests/habitat.test.js tests/station.test.js` for world rules,
controller lifecycle, observation records, and odor-field consistency.
`node tests/closed-loop.mjs` runs the full local connectome checks. Browser and
physical USB checks are separate from these tests.

The default overview shows all three views alongside the live data. Each individual view remains available.

Implementation evidence: [neural validation](docs/neural-validation.md). Remote extension: [cloud inference contract](docs/cloud-inference.md).

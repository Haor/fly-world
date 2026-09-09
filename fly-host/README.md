See [physical world execution](../cloud/docs/physical-world.md) for separate local lightweight, local full and remote full modes.

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
- The advanced controls provide environment occlusion, a zero-input reset,
  and synaptic-transmission control. The three execution modes have a separate panel.
- The device panel shows connection and display state. If another page owns the
  USB lease, the takeover button explicitly transfers control to this station.

## Model limits

Full modes run sensory sampling, neural computation and MuJoCo physics on the same compute machine. The browser displays server poses without a gait policy, takeoff impulse or altitude target. Sensory transduction and muscle gains remain approximate and uncalibrated. Coordinated walking and flight are not biologically validated.

The lightweight browser mode retains an approximate body and optional background input. It is not the physical validation path. Earlier assisted-foraging code remains for compatibility tests and is not enabled by the current sensory interface. See [physical world execution](../cloud/docs/physical-world.md) and the [scientific limits](docs/physical-loop.zh_CN.md).

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

## Model and sensory modes

Sensory-only is now the default: no authored walk, turn, or foraging drive. The environment supplies bilateral odor, contact taste, and bilateral early-visual input. Light level, direction, and brief occlusion affect input. L1/L2 vision remains a proxy, not a reconstructed retina. Earlier motor-drive helpers remain for compatibility tests; the current interface does not enable them.

Choose the retained or full model; the diagram uses every selected model ID. Positions come from official soma annotations and SWC skeleton representative positions, never a fabricated grid. Click a node to load its complete SWC branches and strongest 32 incoming connections. Edges come from the selected inference graph; skeletons come from official public data. See [anatomy](docs/anatomy.md) and [Windows CUDA](../cloud/docs/cuda-windows.md).

See [experimental autonomous dynamics](docs/autonomous-dynamics.md) for equations, background controls, related projects, and validation limits.

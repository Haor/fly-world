[简体中文](fly-world.zh_CN.md)

# Fly World

Fly World is a pocket habitat with a small pixel fly, a tree, a pond, mushrooms, and fruit. It uses a 16-color framebuffer and the three Passport keys.

## Controls

- UP and DOWN select an action. OK performs it.
- In local mode: FEED places fruit; PLAY starts a short flight; REST toggles sleep.
- In neural mode: WALK, LEFT, RIGHT, and FLY stimulate the corresponding MaleCNS populations. PAUSE toggles simulation pause. RESET resets the neural simulation.
- Hold OK to toggle rest in local mode or select and trigger PAUSE in neural mode.

Local food, energy, and feeding count are saved once per minute in the `fly_world` NVS namespace. A sudden power loss can lose the most recent minute. The screen dims after 90 seconds without input in local mode and turns off after five minutes; any key wakes it. Radio stacks and audio playback are not used.

## Neural mode

A local computer runs the Xenova MaleCNS demonstration and sends computed pose and firing-rate summaries over USB. The card does not run the full connectome. The 166,700 retained neurons and their connectivity are unchanged. Body movement uses an illustrative rate decoder with contact-gated feeding; it is not validated fly biomechanics.

The computer owns the habitat and neural clock. Each 10 ms of neural time, the host converts the current pose and environment into sensory input, advances the network, decodes motor activity, and updates the world. Positions are bounded to the island; they do not wrap. The card receives absolute positions, feeding activity, and approaching shadows. It does not add neural steps to match display time.

The default habitat runs without manual pulses. Fruit contact drives LB3b/LB3c sugar neurons. Feeding requires both contact and MN9 motor activity; activity elsewhere cannot consume food. Analytic looming features drive LC4/LPLC2 and can recruit escape. The browser display-shadow switch affects only pixel and 3D rendering. A separate looming-stimulus button in the experiment controls drives the enabled visual pathway for 0.65 neural seconds. It does not recur automatically or change the display-shadow setting. Autonomous input, vision, taste, and experimental odor have separate switches. Pause and Reset control the entire neural-world clock.

Exploration uses authored tonic LC9 input and a seeded DNa02 turn bias. Hunger and energy are engineered slow states, with separate thresholds for becoming satiated/hungry and resting/active. They modulate input and the illustrative body decoder; they are not measured internal states of the original connectome. The exploration slider controls this added drive. The start position faces nearby fruit so the first contact is easy to observe; this does not demonstrate odor navigation. Bilateral ORN_DM1 odor input and a separate navigation aid are enabled by default. The aid uses local antenna samples and their history to adjust LC9/DNa02 inputs; it does not read food coordinates or move the body directly. Disable the aid to retain odor input alone. This authored strategy is not evidence of spontaneous connectome navigation. Offline firmware retains its existing local pet rules. Retina-level vision and validated spontaneous behavior are not implemented. The pond, tree, flowers, and mushroom are visual scenery; the island edge and rock constrain movement.

Disable autonomous input and press Reset for a zero-input baseline. Disable taste or vision to compare responses. Manual paint pulses remain independent of the habitat switches, and Clear clears only manual pulses. Full-network execution can be slower than real time; all scene and need changes follow neural time rather than wall time.

A fresh state enters neural mode. An explicit simulation pause keeps the card in neural mode with a paused indicator. After 2.5 seconds without valid state, the card resumes local behavior and retains the separate local food and energy values. Computer-side hunger and energy reset with the neural world and do not overwrite local saved needs. Reconnection synchronizes a fresh state and does not replay old stimulation commands.

## USB protocol

ASCII frames begin with `F1` and end with newline. Frames are limited to 255 bytes. Only one task writes the USB channel after startup; normal ESP-IDF logs are disabled after initialization. Invalid, non-ASCII, and overlong lines are discarded.

- `HELLO session` establishes the host session; `READY boot 1` confirms the application protocol.
- `STATE session sequence tick running x z heading height phase walking turning escape` sends integer fields. Position and height are millimetres times 1000; heading and phase are radians times 1000; tick is simulation milliseconds. Walking and escape are Hz; turning is degrees per second.
- `WORLD session sequence tick running x z heading height phase walking turning escape feeding food energy shadow` extends STATE with an absolute habitat pose. Valid x/z are within -13438..13438; tile coordinates are `2.5 + position_mm * 0.16`. Feeding is 0..1000, food and energy 0..100, and shadow 0 or 1. Updated firmware accepts both WORLD and legacy STATE; legacy STATE retains relative movement.
- `KEY boot sequence action` requests an action. `ACK boot sequence` confirms execution in the browser. Retries use the same command identifier and are deduplicated.
- `STATUS` reports mode, selection, local needs, heap availability, frame count, queue overflow count, tile u/v times 1000, feeding, world-mode flag, and last accepted sequence.
- `CAPTURE` returns an `IMAGE 240 320 I4 38400` header followed by packed pixels using `fly_palette`.
- `BUTTON 0..3` exercises the same input handler as UP, DOWN, OK, and long OK. This is a local USB diagnostic command.

## Build and validation

Use ESP-IDF 5.5.3. Run `./tools/validate.sh`. The app must remain inside the 3 MB factory partition. Follow [protected Flash layout](development/engineering/protected-flash-layout.md) when flashing a provisioned device. Never erase the whole Flash.

Host tests cover protocol framing, numeric bounds, stale and duplicate messages, mode transitions, feeding/resting behavior, rendering bounds, and bridge command acknowledgements. The sibling host app has `node --test tests/habitat.test.js` for deterministic world rules and `node tests/closed-loop.mjs` for the real local connectome. The latter checks autonomous approach/feeding/departure, no-input behavior, sensory ablations, and disabled synaptic propagation. These are implementation checks, not biological validation. Simulator checks do not prove USB electrical behavior, battery readings, or physical key input.

The artwork is original procedural pixel drawing in `main/fly_view.c`. It uses no Minecraft textures or third-party image assets. Neural data and the upstream browser application retain their existing licenses.

## Start the computer companion

Run `tools/start-fly-world.command`. Open `http://127.0.0.1:8768` and click **Download & start**. The bridge expects the built neural app in the sibling `fly-host/dist` directory and the ESP-IDF Python environment in the sibling `.toolchain` directory. It serves all model assets locally and needs no cloud inference API.

Connect one AI Passport using a data USB cable. The bridge discovers the Espressif USB device and waits for the Fly World firmware handshake. A browser banner confirms the link. Keep the neural tab open and the computer awake. Closing the tab or stopping the bridge returns the card to local mode. Use `Ctrl+C` in the launch terminal to stop the bridge. Close the bridge before opening a serial monitor or flashing.

The unmodified demonstration can remain on port 8765. Only the companion on port 8768 controls the card. Multiple controlling tabs are rejected while the first tab holds its active lease.

The computer station provides habitat, neural-activity, and body views, neural-time traces, behavior events, and bounded CSV export. When another page controls the USB device, use the device panel takeover button to transfer the lease explicitly. The bridge protects this action with the same local-origin and state validation as normal telemetry.

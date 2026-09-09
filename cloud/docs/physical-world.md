# Physical world execution

[中文](physical-world.zh_CN.md)

The station has three explicit modes. A mode change ends the current session.

| Mode | Neural model | Body and feedback | Connection |
|---|---|---|---|
| Local lightweight | 166,700 nodes, browser WebGPU | Browser approximation | No service |
| Local full | 211,577 annotated nodes, CUDA | Local MuJoCo service | Loopback only |
| Remote full | The same full model, CUDA | Remote MuJoCo service | WSS or SSH tunnel |

Local and remote full execution use the same API and separate connection forms. An SSH loopback address does not change remote execution into local execution. Connection failure does not select another engine. The station does not store the token in browser storage.

## Setup

Follow the [CUDA guide](cuda-windows.md) and [data/service deployment guide](deployment.md). On the compute machine, use the Python environment assigned to `CUDA_PYTHON`:

```sh
python -m pip install -r cloud/requirements-physics.txt
python cloud/tools/prepare-body.py
```

The downloader selects a fixed flybody commit and records checksums. Body assets require approximately 154 MB in `cloud/assets/flybody`. They are not distributed in Git. Use `BODY_ASSET_DIR` for a different location.

For a local NVIDIA PC, bind the service to `127.0.0.1`. Select **Local full** and enter `ws://127.0.0.1:9000/neural` and the local token. PowerShell can use `cloud/tools/start-service.ps1 -CudaPython ./cloud/.venv/Scripts/python.exe`.

For a remote NVIDIA server, configure Python, data, assets and the token on the server. Start from the repository root on Linux or WSL2:

```sh
CUDA_PYTHON="$PWD/cloud/.venv/bin/python" \
MODEL_DIR="$PWD/cloud/models/malecns-full" \
BODY_ASSET_DIR="$PWD/cloud/assets/flybody" \
NEURAL_TOKEN_FILE="$PWD/cloud/secrets/neural-token" \
HOST=127.0.0.1 PORT=9000 node cloud/src/server.js
```

 Select **Remote full**. Use the existing WSS proxy setup or an SSH tunnel:

```sh
ssh -N -L 19001:127.0.0.1:9000 user@server
```

Enter `ws://127.0.0.1:19001/neural` for this tunnel. Configure allowed Origins as specified in the deployment guide. A background browser tab does not pause the server. A disconnected session releases its compute process.

The Triton event kernel was tested on Linux. Native Windows can use the existing PyTorch CUDA path; WSL2 can run the Linux service. Measure the selected backend on the target PC. This project does not validate third-party Windows Triton packages.

## Clock and observations

The service samples sensors, advances 100 neural steps, advances the physical body for the same duration, and obtains new physical feedback. Neural and physical steps are 0.1 ms. Each coupling interval is 10 ms. MuJoCo uses the original asset's Euler integrator. Motor correspondence and actuator gains are not calibrated.

The browser sends environment changes and session controls. It does not send neural step requests. The server emits observations at approximately 20 Hz of wall time, or more slowly when compute is limited. The displayed factor is neural time divided by wall time. Only `1×` means real time. Neural kernel speed alone does not measure the complete loop.

## Protocol extension

Keep the required fields of the [base API](api.md), endpoint `/neural`, and protocol `fly-world-neural/2`. Add these initialization fields:

```json
{
  "execution": "world",
  "worldEncoding": "embodied-world/1",
  "model": "malecns-v1.0-full",
  "compute": "cuda",
  "inputMode": "sensory",
  "dynamics": "adaptive",
  "metadata": true,
  "spikeEncoding": "index-count/1",
  "worldOptions": {"light": 1, "odorStrength": 1}
}
```

This fragment is not a complete handshake. `ready` includes the execution and world encodings, `bodyEncoding: flybody-mujoco/1`, and `bodyDefinition`. Full neuron metadata defines spike indices. Wait for all metadata before starting.

Each command has an increasing `requestId` and the current `generation`. Reset uses the next generation.

| Command | Parameters |
|---|---|
| `run` | `running`; optional absolute `untilTick` to stop on the neural clock |
| `environment` | `options` |
| `stimulus` | `stimulus: occlusion` or `looming` |
| `ablation` | `controls: {afferents, propagation, muscles}`; true enables each component |
| `reset` | Optional `spawn: {x,z,yaw}`; retains run/pause and environment settings |
| `inspect` | `bodyId` |

`untilTick` must exceed the current tick and be a multiple of 100. The final frame has `running:false`. World execution rejects `step`, `pulse` and direct motor-channel injection.

Environment options: boolean `enabled`, `vision`, `taste`, `odor`, `proprioception`; `light` 0–2; `sensoryGain` and `odorStrength` 0–3; `odorX/odorZ` −13–13 mm; `lightAngle/windAngle` −180–180 degrees; `patternSpeed` −180–180 degrees/s; `windSpeed` 0–100 mm/s; `patternContrast` 0–1.

`world-frame` contains clock fields `tick/fromTick/steps/generation`, window spikes `firing/counts/total`, `cumulativeSpikes`, seven `rates`, `pose`, `world`, `running`, `speed`, `wallMs` and stage `timings`. Each `pose.rigid` row is `[x,y,z,qw,qx,qy,qz]` in MuJoCo axes, with positions in mm. Body order comes from the definition. The display adds 1.32 mm to vertical coordinates to put the floor at zero. The separate `pose.x/pose.z` fields use the station's ground-plane axes.

A slow client can lose observation frames while physics continues. Compare `fromTick` with the previous tick to detect a gap. `cumulativeSpikes` preserves the total; `droppedFrames` reports server drops. Frames are not a lossless spike history. CSV output records gaps; observed path length is an estimate from received positions.

## Checks

Set `NEURAL_URL` and `NEURAL_TOKEN_FILE`, then run:

```sh
node cloud/tools/check-world.js
PROXY_DELAY_MS=150 node cloud/tools/check-world.js
node cloud/tools/experiment-world.js > experiments.jsonl
```

Use PowerShell environment assignment on Windows. Experiments use two seeds and two neural seconds per condition. They include sensory changes and afferent, propagation and muscle controls. See the [scientific limits](../../fly-host/docs/physical-loop.zh_CN.md). Motion alone does not validate biological behavior.

[简体中文](cuda-windows.zh_CN.md)

# Windows model selection and CUDA

Keep the existing CPU model directory; no model rebuild is needed. Both client and
service must now use `fly-world-neural/2`. Version 1 clients are rejected.

## Install and start

Run from the repository root. The CUDA 13.0 wheel below requires a compatible
NVIDIA driver. For different hardware/driver support use the [official PyTorch
selector](https://pytorch.org/get-started/locally/). A CPU wheel cannot use CUDA.

```powershell
npm ci --prefix cloud
cloud/.venv/Scripts/python.exe -m pip install -r cloud/requirements-torch.txt --index-url https://download.pytorch.org/whl/cu130
cloud/.venv/Scripts/python.exe -c "import torch; print(torch.__version__, torch.version.cuda); assert torch.cuda.is_available(); print(torch.cuda.get_device_name(0))"
& ./cloud/tools/start-service.ps1 -CudaPython ./cloud/.venv/Scripts/python.exe
```

Without the PowerShell launcher:

```powershell
$env:CUDA_PYTHON = (Resolve-Path cloud/.venv/Scripts/python.exe).Path
$env:MODEL_DIR = (Resolve-Path cloud/models/malecns-full).Path
$env:NEURAL_TOKEN_FILE = (Resolve-Path cloud/secrets/neural-token).Path
node cloud/src/server.js
```

Without `CUDA_PYTHON`, the service accepts CPU requests only. With that variable set,
missing CUDA hardware or libraries cause an explicit error, never a CPU fallback.

| Model | Nodes | Edges | Execution |
| --- | ---: | ---: | --- |
| Retained | 166,700 | 25,582,938 | Browser WebGPU / CPU or service CPU / CUDA |
| Full | 211,577 | 26,028,386 | Service CPU / CUDA |

Full still means all annotation rows and their induced graph, excluding unannotated
segments. The service loads the retained graph from `fly-host/public/data` and the
full graph from `MODEL_DIR`. `RETAINED_DIR` overrides the retained path.

## Station controls

1. Rebuild with `npm ci --prefix fly-host` and `npm run build --prefix fly-host`.
2. Choose retained or full in the environment panel's model selector.
3. Full selects service inference. Choose CUDA in the experiment tools, enter
   `ws://127.0.0.1:9000/neural` and the token, then connect.
4. Check actual model count, CPU/CUDA backend, and spatial coverage. The diagram
   uses the selected model's metadata; full results are no longer reduced to the
   retained set of IDs.

Changing model or compute backend ends the old session. Changing input mode also
requires a neural restart and token re-entry for service connections. The token is
not stored by the browser.

## CUDA acceptance

After the service starts, run in a second PowerShell terminal:

```powershell
& ./cloud/tools/check-cuda.ps1 -Batches 100
```

This checks GPU availability, an 800-step fixture against the JavaScript core,
then the full-model WebSocket path. Expect `compute: cuda`, 211,577 metadata rows,
continuous ticks, and `resetToRest: true`. Real-time factor excludes initial graph
and metadata loading. Set `NEURAL_MODEL=malecns-v1.0-retained` and
`NEURAL_COMPUTE=cuda` when running `cloud/tools/smoke.js` directly to test the smaller
graph. Default input mode is `sensory`; `NEURAL_INPUT_MODE=assisted` adds the legacy
walking input to the benchmark.

## Numerical and performance limits

PyTorch CSR multiplication follows this project's LIF event order, 18-step synapse
delay, 22-step refractory interval, and seeded Poisson input. JavaScript supplies
population membership and pulse envelopes. This is not eon's FlyWire weight set.
Floating-point reduction order differs on GPU; fixture spike-count agreement does
not imply exact long-duration full-graph agreement.

PyTorch CPU parity and Linux CUDA execution on an RTX 4090 D were tested.
Native Windows GPU execution remains a separate target acceptance check.
The existing Compose template remains CPU-only; use native Windows for CUDA. CUDA
Graphs, fused kernels, and guaranteed real-time speed are not implemented.

## Adaptive profile

The station uses experimental autonomous dynamics. The CUDA check script now tests both profiles, then runs the full-model smoke with adaptive dynamics. A paired sensory benchmark is available as `node cloud/tools/check-autonomy.js` with the same token and URL environment variables. See [equations and recorded GPU evidence](../../fly-host/docs/autonomous-dynamics.md). The validated Linux GPU used its existing PyTorch 2.5.1+cu124 environment; upgrading it was not required. Match CUDA wheels to the driver and Python version on a new Windows installation.

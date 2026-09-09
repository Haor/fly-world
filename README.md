Choose local lightweight WebGPU, local full CUDA, or remote full execution. Full modes run neural and MuJoCo physics on the compute machine. See the [setup and API guide](cloud/docs/physical-world.md) and [physical validation limits](fly-host/docs/physical-loop.zh_CN.md).

[简体中文](README.zh_CN.md)

# Fly World

A MaleCNS observation station with a pixel habitat, neural activity view, 3D body,
and an optional FoloToy AI Passport companion. Run the retained model in the browser,
or connect the same station to a full-annotation inference service on a local PC,
another PC, or a cloud server.

## Start on a PC

Install Node.js 24 LTS and Python 3.13, then run from the repository root:

```sh
npm ci --prefix fly-host
npm run build --prefix fly-host
python3 -m http.server 8768 --bind 127.0.0.1 --directory fly-host/dist
```

On Windows use `py -3.13` instead of `python3`. Open `http://127.0.0.1:8768` and
start the simulation. Browser model and display assets are included. WebGPU is
preferred; the JavaScript CPU reference is available. A static server supports
PC-only observation; USB requires the separate [companion bridge](ai-passport/docs/fly-world.md).

## Full-annotation inference on your PC or server

The service exposes one WebSocket API on all platforms. Choose retained or full
model inference with the CPU reference engine or optional PyTorch CUDA backend.

- [Windows PC, Linux/macOS, Docker, and remote connection guide](cloud/docs/deployment.md)
- [Windows CUDA installation and checks](cloud/docs/cuda-windows.md)
- [Neural flight and verification](fly-host/docs/flight.md)
- [Official anatomy and neural graph](fly-host/docs/anatomy.md)
- [API reference](cloud/docs/api.md)
- [Service implementation](cloud/README.md)

The builder downloads checksum-pinned official source tables and produces an
auditable model package. Raw sources, generated models, tokens, and device identity
backups are excluded from Git. No hosted endpoint is required to use the project.

| Model | Nodes | Directed edges | Scope |
| --- | ---: | ---: | --- |
| Retained | 166,700 | 25,582,938 | Annotation rows with a superclass |
| Full | 211,577 | 26,028,386 | Every annotation row; induced graph |

The raw segment graph also contains unannotated fragments. They are not included
in either model. More nodes do not establish biological accuracy: LIF parameters,
body decoding, hunger/energy, and the optional foraging aid include engineering
assumptions. See [model validation](fly-host/docs/neural-validation.md) and
[foraging behavior and controls](fly-host/docs/foraging.md).

The default experimental adaptive dynamics add conductance-based synapses,
spike adaptation, and optional background input to interneurons. The previous LIF profile is retained only for regression checks and older clients. See [equations and CUDA controls](fly-host/docs/autonomous-dynamics.md).

The default sensory mode derives inputs from light, occlusion, odor, and food
contact. It does not inject walk or turn commands. Early vision uses an L1/L2
proxy, not a complete retina. Assisted experiments remain available.

The full neural view has 211,573 spatially located nodes. Missing soma fields are
supplemented with positions derived from official skeletons. Select a node to
load its branches and inspect upstream connections.

## AI Passport companion

The ESP32-C3 displays the same pixel world over USB. Disconnecting the computer
returns it to local feed/play/rest rules. The neural model runs on the computer or
service, not on the device. Firmware targets ESP-IDF 5.5.3 and preserves the protected
identity and factory recovery partitions. See [firmware and bridge setup](ai-passport/docs/fly-world.md).
Do not erase the device or overwrite its identity partition to install the application.

## Development and checks

```sh
node --test fly-host/tests/*.test.js
npm ci --prefix cloud
npm test --prefix cloud
node fly-host/tests/data-integrity.mjs
```

The CI checks both packages and builds the service container. The model builder
also has Python mapping tests. A running full model can be checked with
`cloud/tools/smoke.js`; it reports a fixed-stimulus performance sample and verifies
reset. Windows and production TLS remain target-environment checks.

## Credits and license

Project code uses MIT, subject to the preserved third-party licenses. The neural
visualization, body view, assets, and WebGPU foundation derive from
[Xenova Neural Canvas](https://huggingface.co/spaces/Xenova/fruit-fly-simulation).
MaleCNS data is provided by FlyEM / HHMI Janelia and collaborators under CC BY 4.0.
The device firmware derives from [FoloToy AI Passport](https://github.com/FoloToy/ai-passport).
See [NOTICE](NOTICE.md), [LICENSE](LICENSE), and the component license files.

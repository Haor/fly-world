[简体中文](README.zh_CN.md)

# Fly World neural service

A shared inference API for a local PC, another PC, or a cloud server. Choose the CPU reference or optional PyTorch CUDA, and the retained or full-annotation model. Population definitions and pulse envelopes are shared with the station.

- [Windows / macOS / Linux and Docker setup](docs/deployment.md)
- [WebSocket API, commands, responses, and errors](docs/api.md)
- [Windows CUDA setup and acceptance](docs/cuda-windows.md)
- [Model builder](tools/build_model.py)
- [Real client and performance smoke test](tools/smoke.js)

The full-annotation package includes 211,577 nodes and 26,028,386 directed edges.
Unannotated raw segments are excluded. The model and raw source files are prepared
locally and are not committed. CPU execution and PyTorch CPU parity were tested. Both dynamics profiles and full-model CUDA controls passed on an RTX 4090 D. Native Windows GPU execution and public TLS still require target validation.

Run `npm ci --prefix cloud` and `npm test --prefix cloud` from the repository root.
See the deployment guide before starting the service: a model directory, token,
and exact Origin allowlist are required.

See [experimental autonomous dynamics](../fly-host/docs/autonomous-dynamics.md) for equations, background controls, related projects, and validation limits.

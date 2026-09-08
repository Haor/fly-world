[简体中文](README.zh_CN.md)

# Fly World neural service

A shared inference API for a local PC, another PC, or a cloud server. The current
reference backend runs the MaleCNS LIF model on CPU and reuses the station's core,
population definitions, and input envelopes.

- [Windows / macOS / Linux and Docker setup](docs/deployment.md)
- [WebSocket API, commands, responses, and errors](docs/api.md)
- [Model builder](tools/build_model.py)
- [Real client and performance smoke test](tools/smoke.js)

The full-annotation package includes 211,577 nodes and 26,028,386 directed edges.
Unannotated raw segments are excluded. The model and raw source files are prepared
locally and are not committed. The CPU backend is functional; GPU acceleration,
Windows execution, and public TLS deployment require separate target testing.

Run `npm ci --prefix cloud` and `npm test --prefix cloud` from the repository root.
See the deployment guide before starting the service: a model directory, token,
and exact Origin allowlist are required.

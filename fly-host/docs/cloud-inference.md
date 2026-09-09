[简体中文](cloud-inference.zh_CN.md)

# Local and remote inference interface

The station uses one interface for the local PC, a LAN PC, or a cloud server.
The current protocol is `fly-world-neural/2` with sensory encoding `population-hz/3`.
Update the frontend and service together.

- [API: handshake, model metadata, sensory inputs, results, and reset](../../cloud/docs/api.md)
- [Windows CUDA installation and checks](../../cloud/docs/cuda-windows.md)
- [CPU, Docker, and remote deployment](../../cloud/docs/deployment.md)
- [Neural positions and official skeletons](anatomy.md)

After model selection, the service sends all node metadata for the retained or
full model. Full-model activity is not restricted to the retained browser IDs.
Changing the model, backend, or input mode ends the old session. Tokens are used
for the current connection only and are not stored.

Sensory mode accepts taste, bilateral odor, and bilateral early-visual inputs.
Authored walk, turn, and looming-population rates must be zero. The service also
rejects direct pulses. Assisted mode retains these controls. The browser encodes
sensory adaptation; the service must not apply it again.

The frontend receives full-model spike statistics and seven mean motor-readout
rates. The station still updates the body and environment. The service does not
return food directions or movement commands. Node inspection returns upstream
connections without advancing neural time.

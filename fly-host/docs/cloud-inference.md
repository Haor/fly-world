[简体中文](cloud-inference.zh_CN.md)

# Cloud neural interface

Status: the browser adapter and a CPU inference service are implemented and tested over real WebSockets. The same service runs on a local PC or a remote server. No public endpoint is deployed.

See the [service API](../../cloud/docs/api.md) and [Windows / Linux / macOS deployment guide](../../cloud/docs/deployment.md).

`CloudBrain` implements the worker interface used by `Simulation`. The cloud owns
neural state. The browser owns the habitat, senses the last pose, submits one
100-step batch, and applies the returned motor rates. No second brain runs locally.
Round-trip latency limits speed; the interface does not promise real-time execution.

## Connection and identity

Select the cloud backend in the experiment controls, provide a WebSocket URL and
an optional access token, then connect. Remote hosts must use WSS; unencrypted WS
is allowed only for loopback tests. Credentials are not accepted in URLs or saved
in browser storage. The token is sent in the initial message and released by the
adapter. The service must validate tokens, Origin, request sizes, and quotas.

The initial client message is:

```json
{"type":"init","protocol":"fly-world-neural/1","model":"malecns-v1.0-full","seed":1,"dtMs":0.1,"steps":100,"channels":["walkLeft","walkRight","turnLeft","turnRight","reverse","escape","feed"],"spikeIds":"body-id","sensoryEncoding":"population-hz/2","token":"<optional token>"}
```

The service replies with `type: ready`, the same protocol and channel order, and:

```json
{"sensoryEncoding":"population-hz/2","model":{"id":"malecns-v1.0-full","scope":"full","neurons":211577,"dtMs":0.1,"connectomeSha256":"<64 lowercase hexadecimal characters>"}}
```

The count above illustrates the full annotation table; it does not by itself prove
full connectivity. The deployment must publish its graph-building selection,
actual counts, dataset version, and checksum artifact. `scope: full` is a service
claim, not independent verification. A different timestep or channel schema needs
a versioned adapter, not silent resampling. The current browser displays only its
166,700-neuron projection, even when the service calculates a larger graph.

## Requests and results

All post-init requests carry a monotonically increasing `requestId` and a
`generation`. The service must process commands in receive order.

- `step`: `steps: 100`, `sensory`, and `silenced`. The sensory keys are `walk`,
  `left`, `right`, `looming`, `sugar`, `odorLeft`, and `odorRight`, in Hz. Apply the population
  selection in `src/habitat.js` to the cloud graph. `silenced` suppresses all
  recurrent synaptic delivery; it does not suppress directly driven spikes.
- `pulse`: `bodyIds` (decimal strings), `strength` (Hz), `profile` (`paint` or
  `turn`), and `replace`. Use the neural-time envelopes in `src/stimulus.js`.
- `clear`: clear manual pulses while retaining continuous sensory input.
- `reset`: clear neural state, delayed spikes, and manual pulses; reset tick to
  zero. Reply with `type: reset` and the matching request ID and generation.

A step response contains `type: result`, the matching `requestId` and `generation`,
`tick` (cumulative 0.1 ms steps), `steps: 100`, `wallMs`, `total` (spikes across the
cloud graph), `rates` (seven population means, Hz), and `spikes`, an array of
`[bodyIdString, countInBatch]` pairs. Do not send JavaScript numeric body IDs.
Unknown IDs contribute to total activity but have no point in the local projection.
Pairs must be unique; each count is an integer from 1 to 100. Responses are limited
to 16 MiB and 500,000 spike pairs. A service can omit unprojected pairs while keeping
the full total. The browser rejects discontinuous clocks and malformed readouts.

Readouts use the population definitions in `src/stimulus.js`: walk, turn, reverse,
escape, and MN9 feeding. Cloud graph membership can differ; expose that difference
in the deployment manifest before comparing scientific results.

## Failure and verification

Old-generation and duplicate replies are ignored. Incompatible handshakes, invalid
results, or disconnects stop the simulation. There is no automatic reconnect or
silent fallback to a local subset. Existing browser watchdogs bound initialization
and each step. USB then follows its normal stale-state fallback.

Run `node --test tests/cloud-brain.test.js tests/neural-correctness.test.js`.
These adapter tests use an in-memory socket fixture. The service also includes real-socket tests and a full-annotation model smoke client. Windows, production TLS, GPU backends, and sustained multi-client load still require environment-specific validation.

The service must acknowledge `sensoryEncoding: population-hz/2` in `ready`. Map `odorLeft` and `odorRight` to ORN_DM1 rows with L and R side annotations. Do not collapse them into one rate or apply adaptation again: the browser already encodes adaptation and adds the optional navigation aid to walk/turn inputs. Version 1 is rejected.

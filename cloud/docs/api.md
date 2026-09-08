[简体中文](api.zh_CN.md)

# Neural service API

Transport is WebSocket over loopback WS or remote WSS. Endpoint: `/neural`.
Protocol: `fly-world-neural/1`. Sensory encoding: `population-hz/2`.
The contract is identical for a local Windows PC and a remote VM. The browser owns
the environment, body, sensory adaptation, and navigation aid; the service owns
neural state only. It does not return food coordinates or rendered images.

## HTTP and handshake

`GET /healthz` returns `{ "status": "ready", "sessions": 0, "maxSessions": 1 }`.
`GET /v1/model` returns `protocol`, `sensoryEncoding`, and `model`. These metadata
endpoints do not require a token. All other HTTP paths return 404. The WebSocket
upgrade requires an exact allowed `Origin`, including for non-browser clients.

Send this first text message within five seconds:

```json
{"type":"init","protocol":"fly-world-neural/1","model":"malecns-v1.0-full","seed":1,"dtMs":0.1,"steps":100,"channels":["walkLeft","walkRight","turnLeft","turnRight","reverse","escape","feed"],"spikeIds":"body-id","sensoryEncoding":"population-hz/2","token":"YOUR_LOCAL_TOKEN"}
```

`seed` is an unsigned 32-bit integer. Token checks precede allocation of neural
state. Wait for `ready` before sending commands:

```json
{"type":"ready","protocol":"fly-world-neural/1","sensoryEncoding":"population-hz/2","channels":["walkLeft","walkRight","turnLeft","turnRight","reverse","escape","feed"],"model":{"id":"malecns-v1.0-full","scope":"full","coverage":"all-annotated-bodies","neurons":211577,"edges":26028386,"synapses":125365933,"dtMs":0.1,"connectomeSha256":"<64 hex characters>"}}
```

The checksum binds the exact manifest, including all file checksums and provenance.
`scope: full` is qualified by `coverage`: unannotated segments are excluded. The
station projects returned body IDs onto its local 166,700-node visualization.

## Ordered commands

Every command after initialization has a strictly increasing positive `requestId`
and a `generation`, initially zero. IDs continue increasing across reset. JSON
numbers represent rates and clocks; body IDs are decimal **strings**. Send at most
one step at a time. `pulse`, `clear`, and `reset` can be queued behind that step.

| Command | Required fields | Response |
| --- | --- | --- |
| `step` | `steps:100`, `silenced:boolean`, seven sensory fields | `result` |
| `pulse` | `bodyIds`, `strength`, `profile`, `replace` | No success acknowledgement |
| `clear` | Common fields only | No success acknowledgement |
| `reset` | Common fields, generation incremented by exactly one | `reset` acknowledgement |

Example step, representing 10 ms of neural time:

```json
{"type":"step","requestId":1,"generation":0,"steps":100,"silenced":false,"sensory":{"walk":180,"left":0,"right":0,"looming":0,"sugar":0,"odorLeft":12,"odorRight":4}}
```

All seven sensory keys are required, in Hz, finite and within 0–300. The server
does not repeat the browser's sensory adaptation or navigation policy.

| Input | Population |
| --- | --- |
| `walk` | LC9 |
| `left` / `right` | L/R DNa02 |
| `looming` | LC4 and LPLC2 |
| `sugar` | LB3b and LB3c |
| `odorLeft` / `odorRight` | L/R annotated ORN_DM1 |

These definitions reuse `fly-host/src/habitat.js`. `silenced` suppresses recurrent
synaptic transmission; directly stimulated neurons can still fire.

```json
{"type":"pulse","requestId":2,"generation":0,"bodyIds":["10001"],"strength":180,"profile":"paint","replace":true}
{"type":"clear","requestId":3,"generation":0}
{"type":"reset","requestId":4,"generation":1}
```

Pulse lists contain 1–4096 distinct, known body IDs. Strength is 0–300 Hz. `paint`
uses 80 ms hold, 180 ms exponential decay, and 1000 ms total duration; `turn` uses
650/220/2500 ms. All durations use neural time. `replace` clears prior pulses;
`clear` also clears only manual pulses, retaining continuous sensory inputs.

## Results and reset

```json
{"type":"result","requestId":1,"generation":0,"tick":100,"steps":100,"wallMs":12.5,"total":2,"rates":[0,0,0,0,0,100,0],"spikes":[["10001",2]]}
```

This illustrates the shape, not measured neural values. `tick` counts 0.1 ms steps
since reset and increases by 100 per result. `wallMs` measures service computation.
`total` counts all spikes; each `[bodyId,count]` pair contains 1–100 spikes for that
batch. The reference service sends every firing ID. A compatible backend may omit
IDs outside the browser projection while preserving the full total. Responses must
fit within 16 MiB and 500,000 unique pairs. Seven mean population rates follow the
handshake order and definitions in `fly-host/src/stimulus.js`.

Reset replies `{"type":"reset","requestId":4,"generation":1}` and resets tick,
membrane state, delayed spikes, and manual pulses. The seed stays the same. An
already running step can finish with the old generation before this acknowledgement;
the client discards it. Do not send a new-generation step before reset completes.

## Failures and resource limits

An error frame contains `type:error`, `code`, `message`, and `generation`, followed
by connection closure. No command is retried automatically. Reconnect and send a
new init to create fresh neural state. Tokens never belong in the URL or logs.

| Code | Meaning |
| --- | --- |
| `INVALID_INIT`, `UNAUTHORIZED`, `INIT_TIMEOUT` | Bad handshake, token, or missing init |
| `BUSY` | Session quota reached |
| `INVALID_SEQUENCE`, `INVALID_GENERATION` | Replayed/out-of-order request or wrong reset generation |
| `INVALID_STEP`, `INVALID_PULSE`, `INVALID_OPERATION` | Bad input, pulse shape, or unknown body ID |
| `INVALID_JSON`, `INVALID_MESSAGE`, `UNKNOWN_MESSAGE`, `TEXT_REQUIRED` | Unsupported message |
| `RATE_LIMIT`, `BACKPRESSURE`, `SLOW_CLIENT` | Message, queue, pending-step, or outbound-buffer limit |
| `MODEL_TIMEOUT`, `STEP_TIMEOUT`, `WORKER_FAILURE`, `WORKER_EXIT` | Initialization or compute failure |
| `NOT_READY`, `RESULT_TOO_LARGE` | Wrong lifecycle stage or oversized response |

The library closes oversized frames with WebSocket code 1009; transport failures
may close without a JSON error. See [deployment limits](deployment.md). An Origin
allowlist is not authentication; both the Origin check and token are required.
Paused connections answer ping/pong automatically and retain state while connected.

Run `npm test --prefix cloud` for network/protocol tests, or
`NEURAL_TOKEN_FILE=cloud/secrets/neural-token node cloud/tools/smoke.js` against a
running service. [Windows syntax and PC benchmarking](deployment.md) are documented separately.

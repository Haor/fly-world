[简体中文](deployment.zh_CN.md)

# Run the neural service locally or remotely

The same Node.js service runs on Windows, macOS, Linux, or a cloud VM. The station
connects through the [WebSocket API](api.md). Docker and a public domain are optional.
The current backend is a single CPU simulation worker per session. It does not use
CUDA or the PC's GPU, and extra CPU cores do not accelerate one session. A future
GPU backend can keep the same API and numerical contract.

## Model scope and resources

The builder includes all 211,577 rows in the official annotation table and all
connections between those body IDs: 26,028,386 edges and 125,365,933 synapses.
The model package is about 202 MiB. Its manifest records source SHA-256 hashes,
selection rules, excluded edges, and model-file checksums. The runtime checks all
files before accepting connections. Do not rename a smaller package to claim full
coverage. `scope: full` means **all annotated bodies**, not every unannotated segment
in the 151,856,684-row raw connection table, or a validated biological whole fly.

Plan for 8 GB RAM and 10 GB free disk for preparation; 16 GB RAM gives more room
for other applications. Begin with one session and 2 GB runtime memory, then measure
your actual load. These are starting budgets, not measured minimum requirements.
There is no promise of real-time simulation. Sources use CC BY 4.0; preserve attribution.

## Windows PC, without Docker

Install Node.js 24 LTS and Python 3.13. Open PowerShell in the repository root:

```powershell
py -3.13 -m venv cloud/.venv
cloud/.venv/Scripts/python.exe -m pip install -r cloud/requirements-build.txt
cloud/.venv/Scripts/python.exe cloud/tools/build_model.py --cache cloud/.cache --output cloud/models/malecns-full
npm ci --prefix cloud
New-Item -ItemType Directory -Force cloud/secrets | Out-Null
cloud/.venv/Scripts/python.exe -c "import secrets,pathlib; p=pathlib.Path('cloud/secrets/neural-token'); p.open('x').write(secrets.token_hex(32)+'\n')"
& ./cloud/tools/start-service.ps1
```

The source download is about 1.1 GB. Existing valid source files are reused. The
builder refuses an existing output directory; choose a new directory for a rebuild.
Keep the repository and token in your user-owned directory. Do not commit the token.
If script execution is disabled by your Windows policy, set `MODEL_DIR`,
`NEURAL_TOKEN_FILE`, and `ALLOWED_ORIGINS` in the current PowerShell process, then
run `node cloud/src/server.js` directly; no policy change is required.

In another PowerShell terminal:

```powershell
Invoke-RestMethod http://127.0.0.1:9000/healthz
$env:NEURAL_TOKEN_FILE = (Resolve-Path cloud/secrets/neural-token).Path
$env:SMOKE_BATCHES = "100"
node cloud/tools/smoke.js > benchmark.json
```

The smoke client uses the same adapter as the station, checks 100-step ticks and
seven output channels, sends asymmetric odor, and verifies that reset returns to
zero-input rest. It reports neural time, server compute time, total round-trip time,
and the real-time factor. Increase `SMOKE_BATCHES` for a longer run. Compare identical
model hashes, inputs, batch counts, and hardware settings across PCs. This is a fixed
stimulus benchmark, not a test of biological accuracy or every possible workload.

Build and serve the station in a separate terminal:

```powershell
npm ci --prefix fly-host
npm run build --prefix fly-host
py -3.13 -m http.server 8768 --bind 127.0.0.1 --directory fly-host/dist
```

Open `http://127.0.0.1:8768`. In the experiment tools select the inference service,
enter `ws://127.0.0.1:9000/neural`, and paste the token from your local file. This
static server supports PC-only observation; it does not provide the USB bridge API.
With no USB bridge, the device panel reports unavailable while simulation still works.

## Linux or macOS, without Docker

```sh
python3.13 -m venv cloud/.venv
cloud/.venv/bin/python -m pip install -r cloud/requirements-build.txt
cloud/.venv/bin/python cloud/tools/build_model.py --cache cloud/.cache --output cloud/models/malecns-full
npm ci --prefix cloud
mkdir -p cloud/secrets
umask 077
openssl rand -hex 32 > cloud/secrets/neural-token
MODEL_DIR=cloud/models/malecns-full NEURAL_TOKEN_FILE=cloud/secrets/neural-token node cloud/src/server.js
```

Generate the token once. Regenerating it changes the credential and requires a
service restart. Use the same build/serve commands as above with your Python binary.

## Docker Compose

From the repository root, set the UID and GID to the user who owns the model and
secret files. This lets the non-root container read a mode-0600 token on bind mounts.

```sh
export RUN_UID=$(id -u) RUN_GID=$(id -g)
mkdir -p cloud/.cache cloud/models cloud/secrets
cp cloud/.env.example cloud/.env
umask 077
openssl rand -hex 32 > cloud/secrets/neural-token
docker compose --env-file cloud/.env -f cloud/compose.yaml --profile tools run --build --rm model-builder
docker compose --env-file cloud/.env -f cloud/compose.yaml up --build -d --wait neural
curl --fail http://127.0.0.1:9000/healthz
```

Skip the builder command if `cloud/models/malecns-full` already exists and is valid.
The neural service listens on the host's loopback interface. `docker compose ... logs
neural` shows model identity and startup errors without printing tokens. Use `docker
compose -f cloud/compose.yaml down` to stop containers; model and token files remain.

## Another PC or a public server

The station accepts plaintext WS only on loopback. Across machines, use WSS or an
authenticated SSH tunnel. If an SSH server is already configured on the inference PC:

```sh
ssh -N -L 9000:127.0.0.1:9000 user@inference-pc
```

The station then uses `ws://127.0.0.1:9000/neural`. Keep the origin allowlist equal
to the station's URL, for example `http://127.0.0.1:8768`, not the server address.
The inference service can remain bound to loopback. This also works for a Windows
PC with an existing OpenSSH server. No Windows firewall opening for port 9000 is needed.

For a public endpoint, point a domain at the VM, allow TCP 80/443, and edit
`cloud/.env`: set `NEURAL_DOMAIN` and the exact comma-separated `ALLOWED_ORIGINS`.
Start the TLS profile:

```sh
docker compose --env-file cloud/.env -f cloud/compose.yaml --profile tls up --build -d --wait neural caddy
```

Caddy obtains and renews certificates and proxies WebSocket upgrades. Use
`wss://your-domain/neural`. Keep port 9000 private. Configure host/service restarts
through Compose, retain Caddy's certificate volumes, and preserve the model manifest
with deployment records. Before upgrading, save the working model/configuration,
validate the new package, then recreate the service. Reconnect the station after
restart; live neural state is not persisted or migrated.

## Configuration and limits

| Variable | Default / meaning |
| --- | --- |
| `MODEL_DIR` | Required model directory |
| `NEURAL_TOKEN_FILE` | Required token file, 32–256 characters after trimming |
| `HOST`, `PORT` | `127.0.0.1`, `9000`; container binds internally to all interfaces |
| `ALLOWED_ORIGINS` | `http://127.0.0.1:8768`; exact origins separated by commas |
| `MAX_SESSIONS` | `1`; raise only after memory/load testing, maximum `8` |
| `NEURAL_URL`, `NEURAL_ORIGIN` | Smoke-client URL and Origin override |
| `SMOKE_BATCHES` | Smoke-client batch count, default `20` |

Each session has an independent seed, clock, pulses, and reset generation. Requests
are bounded to 256 KiB, 150 messages/second, 16 queued operations, and one pending
step. A step times out after 30 seconds. Ping/pong keeps a paused connection alive.
Disconnect discards its neural state; there is no automatic retry or migration.
This is a single-owner reference service, not a multi-tenant billing platform.

## Verification boundary

Local Node tests, a real socket test using the 211,577-node model, and a container
runtime check are part of the release checks. Windows commands are provided for
your PC test; they were not executed on Windows during preparation. No public VM,
DNS, or production TLS endpoint has been deployed as part of publishing this repo.

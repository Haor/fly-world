param([int]$Batches = 100, [string]$ServiceUrl = "ws://127.0.0.1:9000/neural")
$ErrorActionPreference = "Stop"
$serviceRoot = Split-Path $PSScriptRoot -Parent
$python = Join-Path $serviceRoot ".venv/Scripts/python.exe"
& $python -c "import torch; assert torch.cuda.is_available(), 'CUDA unavailable'; print(torch.__version__, torch.version.cuda, torch.cuda.get_device_name(0))"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $python (Join-Path $PSScriptRoot "check-torch.py") --device cuda
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$env:NEURAL_TOKEN_FILE = (Resolve-Path (Join-Path $serviceRoot "secrets/neural-token")).Path
$env:NEURAL_URL = $ServiceUrl
$env:NEURAL_MODEL = "malecns-v1.0-full"
$env:NEURAL_COMPUTE = "cuda"
$env:NEURAL_INPUT_MODE = "sensory"
$env:SMOKE_BATCHES = "$Batches"
& node (Join-Path $PSScriptRoot "smoke.js")
exit $LASTEXITCODE

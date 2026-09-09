param(
    [string]$CudaPython = "",
    [string]$ModelDirectory = "",
    [string]$TokenFile = "",
    [string]$BindAddress = "127.0.0.1",
    [int]$Port = 9000,
    [string]$AllowedOrigins = "http://127.0.0.1:8768"
)
$ErrorActionPreference = "Stop"
$serviceRoot = Split-Path $PSScriptRoot -Parent
if (-not $ModelDirectory) { $ModelDirectory = Join-Path $serviceRoot "models/malecns-full" }
if (-not $TokenFile) { $TokenFile = Join-Path $serviceRoot "secrets/neural-token" }
if ($CudaPython) { $env:CUDA_PYTHON = (Resolve-Path $CudaPython).Path }
$env:MODEL_DIR = (Resolve-Path $ModelDirectory).Path
$env:NEURAL_TOKEN_FILE = (Resolve-Path $TokenFile).Path
$env:HOST = $BindAddress
$env:PORT = "$Port"
$env:ALLOWED_ORIGINS = $AllowedOrigins
& node (Join-Path $serviceRoot "src/server.js")
exit $LASTEXITCODE

> 观测站的本机全量和远程全量现使用[物理闭环接口与配置](physical-world.zh_CN.md)。下文逐步神经 API 和旧界面操作保留用于兼容测试；完整物理闭环还需要 MuJoCo 与身体资产。

[English](cuda-windows.md)

# Windows：模型选择与 CUDA

已有 CPU 服务可继续使用原模型目录；无需重新下载模型。更新后前后端都需使用 `fly-world-neural/2` 协议，旧版客户端会被拒绝。

## 安装与启动

在仓库根目录执行。以下 CUDA 13.0 轮子适用于支持该运行时的 NVIDIA 驱动；若显卡或驱动不兼容，请按 [PyTorch 官方安装选择器](https://pytorch.org/get-started/locally/)选择适用的 CUDA 轮子。不要安装 CPU 轮子后期待它使用显卡。

```powershell
npm ci --prefix cloud
cloud/.venv/Scripts/python.exe -m pip install -r cloud/requirements-torch.txt --index-url https://download.pytorch.org/whl/cu130
cloud/.venv/Scripts/python.exe -m pip install -r cloud/requirements-physics.txt
cloud/.venv/Scripts/python.exe cloud/tools/prepare-body.py
cloud/.venv/Scripts/python.exe -c "import torch; print(torch.__version__, torch.version.cuda); assert torch.cuda.is_available(); print(torch.cuda.get_device_name(0))"
& ./cloud/tools/start-service.ps1 -CudaPython ./cloud/.venv/Scripts/python.exe
```

无需 PowerShell 脚本时，可设置环境变量直接启动：

```powershell
$env:CUDA_PYTHON = (Resolve-Path cloud/.venv/Scripts/python.exe).Path
$env:MODEL_DIR = (Resolve-Path cloud/models/malecns-full).Path
$env:NEURAL_TOKEN_FILE = (Resolve-Path cloud/secrets/neural-token).Path
node cloud/src/server.js
```

没有 `CUDA_PYTHON` 时，服务只接受 CPU 请求。设置了该变量但没有可用 GPU 时，CUDA 请求返回错误，绝不静默切到 CPU。

服务同时提供轻量与全量模型：

| 选项 | 节点 | 连接 | 运行位置 |
| --- | ---: | ---: | --- |
| 轻量 | 166,700 | 25,582,938 | 浏览器 WebGPU / CPU，或服务 CPU / CUDA |
| 全量 | 211,577 | 26,028,386 | 服务 CPU / CUDA |

“全量”范围仍为全部官方注释节点及其诱导子图，不含未注释片段。服务从 `fly-host/public/data` 加载轻量图，从 `MODEL_DIR` 加载全量图；`RETAINED_DIR` 可以覆盖轻量图路径。

## 页面操作

1. 重新构建观测站：`npm ci --prefix fly-host`，然后 `npm run build --prefix fly-host`。
2. 本机浏览器轻量计算选择「本机轻量」，不填服务地址。
3. 本机 NVIDIA PC 选择「本机全量」，填写 `ws://127.0.0.1:9000/neural` 和本机令牌。
4. 另一台服务器计算选择「远程全量」，填写 WSS 或 SSH 隧道地址和服务器令牌。

切换运行方式结束旧会话。两种服务模式都在计算机器上运行神经和物理闭环。页面显示实际节点数、后端及空间定位数量。令牌不存储在浏览器。完整闭环验收使用 `cloud/tools/check-world.js`；下述旧工具只验证神经计算接口。

## CUDA 验收

服务启动后，另开 PowerShell：

```powershell
& ./cloud/tools/check-cuda.ps1 -Batches 100
```

此脚本依次检查 GPU 可用性、800 步小图与 JavaScript 参考实现的数值对照、全量模型 WebSocket 联调。报告应包含 `compute: cuda`、211,577 个元数据节点、连续时钟和 `resetToRest: true`。`realTimeFactor` 为神经时间除以实际耗时，不包含最初加载模型与元数据的时间。

要测轻量 CUDA，可直接设置 `NEURAL_MODEL=malecns-v1.0-retained`、`NEURAL_COMPUTE=cuda` 后运行 `cloud/tools/smoke.js`。默认验证输入方式为 `sensory`；`NEURAL_INPUT_MODE=assisted` 才启用人工步行输入的旧对照。

## 数值与性能边界

基础 CUDA 实现使用 PyTorch CSR 稀疏乘法，复现本项目 LIF 更新顺序、18 步突触延迟、22 步不应期及固定种子 Poisson 输入；感觉群体和脉冲包络由 JavaScript 提供，不另写第二套映射。它不是直接运行 eon 的 FlyWire 权重。GPU 稀疏归约的浮点顺序与 CPU 不同，小图计数一致不保证完整图长时间逐脉冲相同。

本机 Mac 的 CPU 对照已通过；另在 RTX 4090 D 上使用 Python 3.12、PyTorch 2.5.1+cu124 验证了两套动力学的 CUDA 小图对照、全量推理和感觉闭环。原生 Windows 显卡环境仍需单独验收。现有 Docker Compose 是 CPU 部署模板；Windows CUDA 使用以上原生启动方式。自主动力学现在提供融合事件内核与 CUDA Graph；下述性能记录只适用于已验证的环境，不保证原生 Windows 具有相同速度。

## 自主动力学

页面统一使用自主动力学。CUDA 验收脚本现在对两套配置做数值对照，再运行全量自主动力学联调。感觉对照可使用同样的令牌与地址环境变量运行 `node cloud/tools/check-autonomy.js`。见[方程与 GPU 结果](../../fly-host/docs/autonomous-dynamics.zh_CN.md)。已验证的 Linux GPU 沿用现有 PyTorch 2.5.1+cu124，未要求升级；新装 Windows 时仍须匹配驱动、CUDA 轮子与 Python 版本。


## Linux / WSL2 的事件 CUDA 路径

当 CUDA Python 可以 `import triton` 时，自主动力学自动使用 `triton-events`。它只传播实际放电源的出边，以整数累计突触数，并融合神经状态更新；100 步批次使用 CUDA Graph。完整节点与连接数不变。原生 Windows 或其他未安装 Triton 的环境继续使用 `torch-csr`，模型方程不变；`ready.computeKernel` 明确标识所用实现。

已在 Linux、RTX 4090 D、Python 3.12.3、PyTorch 2.5.1+cu124、Triton 3.1.0 验证。复用已有兼容环境即可，不需为此更换驱动。新装环境应使用 PyTorch 对应的依赖版本，勿混装不同版本的 Triton。Windows 可使用 [WSL2 CUDA](https://learn.microsoft.com/en-us/windows/wsl/tutorials/gpu-compute) 运行 Linux 服务；本项目尚未在 WSL2 或原生 Windows 验证事件内核。

在仓库根目录、已有 Linux CUDA 环境中执行：

```sh
python cloud/tools/check-torch.py --device cuda --profile adaptive --engine events
python cloud/tools/check-event-cuda.py
export CUDA_PYTHON="$(command -v python)"
export MODEL_DIR="$PWD/cloud/models/malecns-full"
export NEURAL_TOKEN_FILE="$PWD/cloud/secrets/neural-token"
node cloud/src/server.js
```

另开终端，设置同样的 `NEURAL_TOKEN_FILE`，再执行 `node cloud/tools/benchmark.js`。默认地址是 `ws://127.0.0.1:9000/neural`，可用 `NEURAL_URL` 覆盖；`BENCH_BATCHES=1000` 测量 10 秒神经时间，另有 1 秒预热。报告分别给出服务计算与接口往返的实时倍率、中位数、95 分位和最长批次。初始化与元数据下载不计入稳定运行速度。

参见[实测性能记录](../../fly-host/docs/validation/realtime-cuda.json)。同机接口平均达到实时不代表每个批次都在 10 ms 内完成，也不代表通过公网远程连接能实时。浏览器按每次真实往返时间安排下一步，不再在网络等待后重复补足计算间隔。

Mac 经 SSH 隧道连接同一服务器的补充实测为 0.128×：3 秒神经时间约耗时 23.48 秒，接口中位数 85.92 ms，95 分位 120.58 ms。此结果包含网络传输与客户端解码，不包含浏览器渲染；不能把同机实时吞吐直接用于远程交互预期。

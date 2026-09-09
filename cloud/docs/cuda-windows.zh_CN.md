[English](cuda-windows.md)

# Windows：模型选择与 CUDA

已有 CPU 服务可继续使用原模型目录；无需重新下载模型。更新后前后端都需使用 `fly-world-neural/2` 协议，旧版客户端会被拒绝。

## 安装与启动

在仓库根目录执行。以下 CUDA 13.0 轮子适用于支持该运行时的 NVIDIA 驱动；若显卡或驱动不兼容，请按 [PyTorch 官方安装选择器](https://pytorch.org/get-started/locally/)选择适用的 CUDA 轮子。不要安装 CPU 轮子后期待它使用显卡。

```powershell
npm ci --prefix cloud
cloud/.venv/Scripts/python.exe -m pip install -r cloud/requirements-torch.txt --index-url https://download.pytorch.org/whl/cu130
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
2. 在“环境控制”的“神经模型”中选择轻量或全量。
3. 全量自动切到推理服务。在“实验工具”选择“CUDA · NVIDIA GPU”，填写 `ws://127.0.0.1:9000/neural` 和令牌，连接。
4. 页面显示实际节点数、CPU/CUDA 后端以及空间定位数量。神经图使用所选模型全部元数据，不再把全量活动裁到轻量 ID 集合。

切换模型或计算后端会结束旧会话。切换输入方式也需要重启神经状态；服务连接需重新填写令牌。令牌不存储在浏览器。

## CUDA 验收

服务启动后，另开 PowerShell：

```powershell
& ./cloud/tools/check-cuda.ps1 -Batches 100
```

此脚本依次检查 GPU 可用性、800 步小图与 JavaScript 参考实现的数值对照、全量模型 WebSocket 联调。报告应包含 `compute: cuda`、211,577 个元数据节点、连续时钟和 `resetToRest: true`。`realTimeFactor` 为神经时间除以实际耗时，不包含最初加载模型与元数据的时间。

要测轻量 CUDA，可直接设置 `NEURAL_MODEL=malecns-v1.0-retained`、`NEURAL_COMPUTE=cuda` 后运行 `cloud/tools/smoke.js`。默认验证输入方式为 `sensory`；`NEURAL_INPUT_MODE=assisted` 才启用人工步行输入的旧对照。

## 数值与性能边界

CUDA 引擎使用 PyTorch CSR 稀疏乘法，复现本项目 LIF 更新顺序、18 步突触延迟、22 步不应期及固定种子 Poisson 输入；感觉群体和脉冲包络由 JavaScript 提供，不另写第二套映射。它不是直接运行 eon 的 FlyWire 权重。GPU 稀疏归约的浮点顺序与 CPU 不同，小图计数一致不保证完整图长时间逐脉冲相同。

本机 Mac 的 CPU 对照已通过；另在 RTX 4090 D 上使用 Python 3.12、PyTorch 2.5.1+cu124 验证了两套动力学的 CUDA 小图对照、全量推理和感觉闭环。原生 Windows 显卡环境仍需单独验收。现有 Docker Compose 是 CPU 部署模板；Windows CUDA 使用以上原生启动方式。本实现尚未做 CUDA Graph、融合内核或实时速度保证。

## 自主动力学

页面选择“自主动力学 · 实验”即可使用新配置。CUDA 验收脚本现在对两套配置做数值对照，再运行全量自主动力学联调。感觉对照可使用同样的令牌与地址环境变量运行 `node cloud/tools/check-autonomy.js`。见[方程与 GPU 结果](../../fly-host/docs/autonomous-dynamics.zh_CN.md)。已验证的 Linux GPU 沿用现有 PyTorch 2.5.1+cu124，未要求升级；新装 Windows 时仍须匹配驱动、CUDA 轮子与 Python 版本。

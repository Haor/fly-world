# 物理闭环：运行方式与接口

观测站明确区分三种运行方式，切换方式会结束当前会话。

| 方式 | 神经模型 | 身体与感觉 | 地址 |
|---|---|---|---|
| 本机轻量 WebGPU | 166,700 节点 | 浏览器内的近似身体和感觉代理 | 不连接服务 |
| 本机全量 CUDA | 211,577 个注释节点 | 本机服务中的 MuJoCo 身体与感觉反馈 | 仅允许本机地址 |
| 远程全量 | 同一全量模型 | 服务器中的 MuJoCo 身体与感觉反馈 | WSS 或 SSH 隧道地址 |

本机全量和远程全量使用相同服务接口，但使用独立的连接表单。选择远程后，即使填写 SSH 隧道的 `127.0.0.1` 地址，计算仍在远程服务器执行。连接失败不会自动切换成浏览器计算。令牌不保存到浏览器存储。

## 服务准备

先按 [CUDA 安装指南](cuda-windows.zh_CN.md) 配置可用的 PyTorch CUDA 环境，并按 [部署指南](deployment.zh_CN.md) 准备全量数据、Node.js 服务和令牌。在**运行计算的机器**上，用同一个 Python 环境安装物理依赖和下载身体资产：

```sh
python -m pip install -r cloud/requirements-physics.txt
python cloud/tools/prepare-body.py
```

`python` 必须指向设置给 `CUDA_PYTHON` 的环境。身体资产默认写入 `cloud/assets/flybody`，约 154 MB，不随 Git 仓库分发。下载器固定 flybody 提交并记录文件校验和。自定义目录须设置 `BODY_ASSET_DIR`。

### 本机 NVIDIA PC

在本机启动服务，绑定 `127.0.0.1`。PowerShell 示例：

```powershell
& ./cloud/tools/start-service.ps1 -CudaPython ./cloud/.venv/Scripts/python.exe
```

观测站选择「本机全量」，地址填 `ws://127.0.0.1:9000/neural`，填入本机令牌。

原生 Windows 的 PyTorch CUDA 和 Linux 的 Triton 事件内核不是同一实现。当前事件内核的硬件测试在 Linux 上完成；Windows 可采用 WSL2 运行相同服务，也可使用已有 PyTorch CUDA 路径，性能须在目标 PC 上测量。不要为使用 Triton 而安装未经本项目验证的 Windows 移植包。

### 远程 NVIDIA 服务器

在服务器启动相同服务，`CUDA_PYTHON`、模型、物理资产和令牌路径全部属于服务器。在仓库根目录启动的 Linux / WSL2 示例：

```sh
CUDA_PYTHON="$PWD/cloud/.venv/bin/python" \
MODEL_DIR="$PWD/cloud/models/malecns-full" \
BODY_ASSET_DIR="$PWD/cloud/assets/flybody" \
NEURAL_TOKEN_FILE="$PWD/cloud/secrets/neural-token" \
HOST=127.0.0.1 PORT=9000 node cloud/src/server.js
```

推荐绑定回环地址，再用已有 WSS 反向代理或 SSH 隧道连接：

```sh
ssh -N -L 19001:127.0.0.1:9000 user@server
```

观测站选择「远程全量」，隧道地址填 `ws://127.0.0.1:19001/neural`。使用公网域名时填 `wss://your-host/neural`，并按部署指南设置允许的观测站 Origin。服务不会因为浏览器切到后台而暂停；断开会话会释放计算进程。

## 闭环如何推进

服务内部依次执行感觉采样、100 个神经步和对应的身体物理步，再读取关节、触角和接触状态。神经步长为 0.1 ms，每轮闭环为 10 ms；MuJoCo 使用原始身体资产的 Euler 积分器和 0.1 ms 步长。神经元放电汇总为肌肉驱动，肌肉映射和驱动增益尚未校准。

网页只发送环境操作和会话控制。服务器不等待网页逐步请求，观察帧按墙钟约 20 Hz 输出；计算较慢时输出频率也可能降低。显示倍率是神经时间除以墙钟时间，`1×` 才表示实时。短时 GPU 神经内核速度不等于完整闭环速度。

## WebSocket 扩展

使用既有 `/neural` 地址及 `fly-world-neural/2` 协议。初始化保留 [基础 API](api.zh_CN.md) 所要求的字段，并明确添加：

```json
{
  "execution": "world",
  "worldEncoding": "embodied-world/1",
  "model": "malecns-v1.0-full",
  "compute": "cuda",
  "inputMode": "sensory",
  "dynamics": "adaptive",
  "metadata": true,
  "spikeEncoding": "index-count/1",
  "worldOptions": {"light": 1, "odorStrength": 1}
}
```

这是初始化的扩展字段片段，不是完整握手。`ready` 返回 `execution: world`、`worldEncoding`、`bodyEncoding: flybody-mujoco/1` 和 `bodyDefinition`。后续完整神经元元数据决定放电索引含义。未完成握手与元数据接收前不得开始仿真。

所有控制都带递增 `requestId` 和当前 `generation`；重置使用下一代 generation。

| type | 参数 | 行为 |
|---|---|---|
| `run` | `running: boolean`；可选 `untilTick` | 开始或暂停；可按神经时钟精确自动停止 |
| `environment` | `options` | 更新环境参数 |
| `stimulus` | `stimulus: occlusion / looming` | 添加遮挡或逼近物体 |
| `ablation` | `controls` | 设置 `afferents`、`propagation`、`muscles`，true 表示启用 |
| `reset` | 下一代 generation；可选 `spawn: {x,z,yaw}` | 重置神经、身体及感觉适应，保留暂停与环境设置 |
| `inspect` | `bodyId` | 查询连接 |

`untilTick` 是大于当前 tick、且为 100 整数倍的绝对目标。到达目标后服务器发出 `running:false` 的最终观察帧。物理闭环会拒绝 `step`、`pulse` 及直接运动通道注入。

环境参数：`enabled/vision/taste/odor/proprioception` 为布尔值；`light` 为 0–2；`sensoryGain/odorStrength` 为 0–3；`odorX/odorZ` 为 −13–13 mm；`lightAngle/windAngle/patternSpeed` 为 −180–180，角度单位为度，条纹速度为度/秒；`windSpeed` 为 0–100 mm/s；`patternContrast` 为 0–1。感觉转导和单位换算是明确的模型假设，不代表已测得的完整感受器生理。

`world-frame` 包含 `generation/tick/fromTick/steps`、完整索引形式的窗口放电 `firing/counts/total`、`cumulativeSpikes`、七组 `rates`、`pose`、`world`、`running`、`speed`、`wallMs` 和阶段 `timings`。`pose.rigid` 是各刚体的全局位置与四元数，顺序由身体定义确定；单行 `[x,y,z,qw,qx,qy,qz]`，位置为 mm，采用 MuJoCo 坐标轴。界面平面坐标另用 `pose.x/pose.z`。

慢客户端会丢弃观察帧，服务器继续积分。`fromTick` 与上一帧 `tick` 的差表示观察缺口；`cumulativeSpikes` 保留总计，`droppedFrames` 报告服务器丢弃数。观察帧不是无损放电历史。CSV 导出标记累计缺口，路径长度只能从收到的位置估算。

## 验证

```sh
NEURAL_URL=ws://127.0.0.1:9000/neural NEURAL_TOKEN_FILE=cloud/secrets/neural-token node cloud/tools/check-world.js
PROXY_DELAY_MS=150 NEURAL_URL=ws://127.0.0.1:9000/neural NEURAL_TOKEN_FILE=cloud/secrets/neural-token node cloud/tools/check-world.js
NEURAL_URL=ws://127.0.0.1:9000/neural NEURAL_TOKEN_FILE=cloud/secrets/neural-token node cloud/tools/experiment-world.js > experiments.jsonl
```

PowerShell 中请用 `$env:变量名 = "值"` 设置同名变量后运行 Node 命令。实验默认为两个随机种子、每个条件 2 秒神经时间，含环境变化与感觉、传播、肌肉消融。运动不等于生物学验证；请同时阅读 [科学边界](../../fly-host/docs/physical-loop.zh_CN.md)。

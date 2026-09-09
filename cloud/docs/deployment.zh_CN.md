[English](deployment.md)

# 在本地 PC 或远程服务器运行推理服务

同一套 Node.js 服务可运行在 Windows、macOS、Linux 或云主机上，观测站通过统一的 [WebSocket API](api.zh_CN.md) 连接。Docker 和公网域名都是可选项。

服务支持 CPU 参考实现和可选 PyTorch CUDA 后端，轻量与全量模型共用 API。Windows NVIDIA 安装与验收见 [CUDA 指南](cuda-windows.zh_CN.md)。CPU 会话仍是单个仿真线程；CUDA 尚未在开发机上做硬件验收。

## 数据范围与资源

构建器纳入官方注释表全部 **211,577 个节点**，保留这些 ID 之间的全部连接：26,028,386 条边、125,365,933 个突触，模型文件约 202 MiB。清单记录原始文件 SHA-256、筛选规则、排除的边和产物校验和，服务启动前逐一校验。

`scope: full` 表示**完整注释节点集合**，不是原始 151,856,684 行连接表中的所有未注释片段，也不表示生物学上完整、准确的果蝇。未分类节点仍被纳入，因此节点数不能直接视为完整重建的活体神经元数。

准备数据建议预留 8 GB 内存、10 GB 磁盘，16 GB 内存更适合同时运行其他程序。服务先以单会话、2 GB 内存额度启动，再实测调整；这些是初始资源预算，不是实测最低要求。不能保证实时运行。原始数据使用 CC BY 4.0，需保留署名。

## Windows 高性能 PC：直接运行

安装 Node.js 24 LTS 和 Python 3.13，在仓库根目录打开 PowerShell：

```powershell
py -3.13 -m venv cloud/.venv
cloud/.venv/Scripts/python.exe -m pip install -r cloud/requirements-build.txt
cloud/.venv/Scripts/python.exe cloud/tools/build_model.py --cache cloud/.cache --output cloud/models/malecns-full
npm ci --prefix cloud
New-Item -ItemType Directory -Force cloud/secrets | Out-Null
cloud/.venv/Scripts/python.exe -c "import secrets,pathlib; p=pathlib.Path('cloud/secrets/neural-token'); p.open('x').write(secrets.token_hex(32)+'\n')"
& ./cloud/tools/start-service.ps1
```

原始文件下载约 1.1 GB，已有且校验正确的缓存会复用。构建器不会覆盖已有模型目录；重新构建时指定新输出目录。仓库与令牌放在自己的用户目录，令牌不要提交到 Git。

如果 Windows 策略禁止执行 `.ps1`，无需修改策略，直接在当前终端运行：

```powershell
$env:MODEL_DIR = (Resolve-Path cloud/models/malecns-full).Path
$env:NEURAL_TOKEN_FILE = (Resolve-Path cloud/secrets/neural-token).Path
$env:ALLOWED_ORIGINS = "http://127.0.0.1:8768"
node cloud/src/server.js
```

另开一个 PowerShell 终端验证和计时：

```powershell
Invoke-RestMethod http://127.0.0.1:9000/healthz
$env:NEURAL_TOKEN_FILE = (Resolve-Path cloud/secrets/neural-token).Path
$env:SMOKE_BATCHES = "100"
node cloud/tools/smoke.js > benchmark.json
```

验证工具使用观测站相同的客户端适配器，检查每批 100 步的连续时钟、七个输出通道和双侧不同强度的嗅觉输入，最后验证重置后无输入时回到静止。报告包含神经时间、服务计算耗时、含网络往返的总耗时和实时倍率。可增加 `SMOKE_BATCHES` 做长测；跨 PC 比较时保持模型哈希、输入、批次数与硬件设置一致。这是固定刺激性能测试，不代表生物正确性或所有输入下的性能。

再开终端启动观测站：

```powershell
npm ci --prefix fly-host
npm run build --prefix fly-host
py -3.13 -m http.server 8768 --bind 127.0.0.1 --directory fly-host/dist
```

打开 `http://127.0.0.1:8768`，在“实验工具”中选择“推理服务 · 本地 / 远程”，地址填 `ws://127.0.0.1:9000/neural`，令牌从本机文件复制。静态服务器用于纯电脑观察，不提供 USB 桥接 API；设备面板提示不可用时，神经仿真仍可运行。

## Linux / macOS：直接运行

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

令牌只需生成一次；重新生成后需要重启服务，并使用新令牌连接。观测站构建与静态服务步骤同上，替换为自己的 Python 命令。

## Docker Compose

从仓库根目录执行。UID/GID 使用模型和令牌文件所有者，让容器中的非 root 进程能读取权限为 0600 的令牌文件：

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

模型已存在且有效时跳过构建器命令。默认只向宿主机回环地址开放服务。通过 `docker compose --env-file cloud/.env -f cloud/compose.yaml logs neural` 查看启动状态与模型身份，日志不打印令牌；`docker compose --env-file cloud/.env -f cloud/compose.yaml down` 停止容器，保留模型和令牌文件。

## 跨 PC 或公网连接

观测站只允许回环地址使用明文 WS。跨机器使用 WSS，或通过已配置的 SSH 服务转发：

```sh
ssh -N -L 9000:127.0.0.1:9000 user@inference-pc
```

观测站仍连接 `ws://127.0.0.1:9000/neural`。Origin 白名单填写**观测站页面的来源**，例如 `http://127.0.0.1:8768`，而不是推理服务器地址。推理服务可继续只绑定回环地址。Windows 已配置 OpenSSH 服务时同样适用，不必为推理端口 9000 单独开放防火墙。

公网部署需要将域名指向主机、开放 TCP 80/443，并在 `cloud/.env` 设置 `NEURAL_DOMAIN` 和逗号分隔的精确 `ALLOWED_ORIGINS`：

```sh
docker compose --env-file cloud/.env -f cloud/compose.yaml --profile tls up --build -d --wait neural caddy
```

Caddy 自动申请和续期证书并代理 WebSocket，前端使用 `wss://你的域名/neural`。9000 端口保持私有。保留 Caddy 证书卷和模型清单；更新前保存可用模型及配置、验证新包后再重建服务。重启后重新连接，运行中的神经状态不会持久化或迁移。

## 配置与限制

| 变量 | 默认值或用途 |
| --- | --- |
| `MODEL_DIR` | 必填，模型目录 |
| `NEURAL_TOKEN_FILE` | 必填，去除首尾空白后为 32–256 字符的令牌文件 |
| `HOST` / `PORT` | `127.0.0.1` / `9000`；容器内部绑定所有接口 |
| `ALLOWED_ORIGINS` | 默认 `http://127.0.0.1:8768`，多个精确来源用逗号分隔 |
| `MAX_SESSIONS` | 默认 `1`、最多 `8`，实测资源后再提高 |
| `NEURAL_URL` / `NEURAL_ORIGIN` | 验证客户端地址与 Origin 覆盖 |
| `SMOKE_BATCHES` | 验证客户端批次数，默认 `20` |

每会话独立保存种子、时钟、刺激和重置代次。请求最多 256 KiB、每秒 150 条、队列最多 16 个操作、最多一个未完成推理批次；每批计算限时 30 秒。Ping/pong 使暂停连接保持存活。断开后神经状态销毁，不自动重试或迁移。此版本是面向单一所有者的参考服务，不是多租户计费平台。

## 验证边界

交付检查包括本地 Node 测试、211,577 节点模型的真实 socket 联调和容器运行。Windows 命令供后续 PC 实测，本次未在 Windows 上执行。发布代码仓库不等于已部署公网主机、DNS 或生产 TLS 端点。

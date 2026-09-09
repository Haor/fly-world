[English](api.md)

# 推理服务 API

本机回环使用 WS，远程使用 WSS，端点为 `/neural`。协议版本 `fly-world-neural/2`，感觉编码 `population-hz/3`。Windows 本地 PC 和云主机使用相同接口。浏览器维护环境、身体、感觉适应和寻食辅助；服务只维护神经状态，不返回食物坐标或渲染图像。

## HTTP 与握手

`GET /healthz` 返回 `{ "status": "ready", "sessions": 0, "maxSessions": 1 }`；`GET /v1/models` 列出可用模型与配置后端。`GET /v1/model` 返回 `protocol`、`sensoryEncoding` 和 `model`，这些元数据端点不要求令牌，其他 HTTP 路径返回 404。WebSocket 升级必须携带精确匹配白名单的 `Origin`，命令行客户端同样如此。

连接后五秒内发送第一条文本消息：

```json
{"type":"init","protocol":"fly-world-neural/2","model":"malecns-v1.0-full","compute":"cpu","inputMode":"sensory","metadata":true,"seed":1,"dtMs":0.1,"steps":100,"channels":["walkLeft","walkRight","turnLeft","turnRight","reverse","escape","feed"],"spikeIds":"body-id","sensoryEncoding":"population-hz/3","token":"YOUR_LOCAL_TOKEN"}
```

`seed` 为无符号 32 位整数。令牌校验通过后才分配神经状态。收到 `ready` 后再发命令：

```json
{"type":"ready","protocol":"fly-world-neural/2","sensoryEncoding":"population-hz/3","compute":"cpu","inputMode":"sensory","channels":["walkLeft","walkRight","turnLeft","turnRight","reverse","escape","feed"],"model":{"id":"malecns-v1.0-full","scope":"full","coverage":"all-annotated-bodies","neurons":211577,"edges":26028386,"synapses":125365933,"dtMs":0.1,"connectomeSha256":"<64 hex characters>"}}
```

校验和绑定精确的清单内容，其中包含每个模型文件的校验和与来源。`scope: full` 受 `coverage` 限定，不包括未注释片段。观测站接收所选模型全部节点元数据，按该模型映射所有返回的 body ID。

## 命令顺序

初始化之后，每条命令带严格递增的正整数 `requestId` 和初始为零的 `generation`；重置后请求 ID 继续递增。放电率和时钟用 JSON 数值，body ID 必须为十进制**字符串**。最多一个未完成的 step；`pulse`、`clear`、`reset` 可以排在其后。

| 命令 | 必填字段 | 响应 |
| --- | --- | --- |
| `step` | `steps:100`、布尔 `silenced`、九个感觉字段 | `result` |
| `pulse` | `bodyIds`、`strength`、`profile`、`replace` | 成功时无单独确认 |
| `clear` | 公共字段 | 成功时无单独确认 |
| `reset` | 公共字段，代次恰好加一 | `reset` 确认 |

每步请求代表 10 ms 神经时间：

```json
{"type":"step","requestId":1,"generation":0,"steps":100,"silenced":false,"sensory":{"walk":0,"left":0,"right":0,"looming":0,"sugar":0,"odorLeft":12,"odorRight":4,"visualLeft":30,"visualRight":10}}
```

九个感觉字段都必须提供，单位 Hz，范围为有限的 0–300。服务端不会再次应用浏览器中的感觉适应或寻食策略。

| 输入 | 神经群体 |
| --- | --- |
| `walk` | LC9 |
| `left` / `right` | L/R DNa02 |
| `looming` | LC4、LPLC2 |
| `sugar` | LB3b、LB3c |
| `odorLeft` / `odorRight` | L/R 标注的 ORN_DM1 |
| `visualLeft` / `visualRight` | L/R L1、L2，早期视觉代理 |

群体定义复用 `fly-host/src/habitat.js`。`silenced` 关闭突触传播，直接被刺激的神经元仍可能放电。

```json
{"type":"pulse","requestId":2,"generation":0,"bodyIds":["10001"],"strength":180,"profile":"paint","replace":true}
{"type":"clear","requestId":3,"generation":0}
{"type":"reset","requestId":4,"generation":1}
```

脉冲列表含 1–4096 个不同且存在的 body ID，强度为 0–300 Hz。`paint` 为保持 80 ms、指数衰减时间常数 180 ms、总长 1000 ms；`turn` 对应 650/220/2500 ms，全部按神经时间。`replace` 清除既有手动脉冲；`clear` 同样只清手动脉冲，保留连续感觉输入。

## 输出与重置

```json
{"type":"result","requestId":1,"generation":0,"tick":100,"steps":100,"wallMs":12.5,"total":2,"rates":[0,0,0,0,0,100,0],"spikes":[["10001",2]]}
```

示例仅展示结构，不是实测神经数值。`tick` 为重置后的累计 0.1 ms 步数，每次加 100；`wallMs` 是服务计算耗时；`total` 为全部放电数；每个 `[bodyId,count]` 表示本批该节点 1–100 次放电。参考服务发送所有放电 ID；兼容后端可省略浏览器投影以外的 ID，但必须保留全图总数。响应不得超过 16 MiB、500,000 对不同 ID。七个群体均值的顺序与握手一致，定义见 `fly-host/src/stimulus.js`。

重置确认是 `{"type":"reset","requestId":4,"generation":1}`，时钟、膜状态、延迟放电和手动脉冲全部归零，随机种子不变。已在计算的旧 step 可能先返回旧代次，客户端会丢弃；必须等待重置确认后再发新代次 step。

## 错误与限额

错误帧包含 `type:error`、`code`、`message`、`generation`，随后关闭连接；不会自动重试命令。重新连接并握手会创建全新的神经状态。令牌不得放在 URL 或日志里。

| 错误码 | 含义 |
| --- | --- |
| `INVALID_INIT`、`UNAUTHORIZED`、`INIT_TIMEOUT` | 握手不合法、令牌错误、未及时握手 |
| `BUSY` | 会话名额已满 |
| `INVALID_SEQUENCE`、`INVALID_GENERATION` | 请求重复、乱序或重置代次错误 |
| `INVALID_STEP`、`INVALID_PULSE`、`INVALID_OPERATION` | 输入、脉冲参数或 body ID 不合法 |
| `INVALID_JSON`、`INVALID_MESSAGE`、`UNKNOWN_MESSAGE`、`TEXT_REQUIRED` | 无效消息格式 |
| `RATE_LIMIT`、`BACKPRESSURE`、`SLOW_CLIENT` | 消息、队列、并发 step 或发送缓冲超限 |
| `MODEL_TIMEOUT`、`STEP_TIMEOUT`、`WORKER_FAILURE`、`WORKER_EXIT` | 初始化或计算失败 |
| `NOT_READY`、`RESULT_TOO_LARGE` | 生命周期阶段错误或响应过大 |

超大请求由 WebSocket 库以 1009 关闭；传输故障可能没有 JSON 错误帧。其他限额见[运行指南](deployment.zh_CN.md)。Origin 白名单不能替代鉴权，两者都要求。暂停连接通过自动 ping/pong 保持状态。

执行 `npm test --prefix cloud` 运行网络与协议测试，或对运行中的服务执行 `NEURAL_TOKEN_FILE=cloud/secrets/neural-token node cloud/tools/smoke.js`。[Windows 命令与 PC 基准测试](deployment.zh_CN.md)另有说明。

## 第二版的模型与输入方式

`init.model` 可为 `malecns-v1.0-retained` 或 `malecns-v1.0-full`；`compute` 为 `cpu` 或 `cuda`；`inputMode` 为 `sensory` 或 `assisted`。新客户端显式填写三者。`GET /v1/models` 列出配置的模型与后端，CUDA 是否真正可用会在启动进程时检查。`ready` 回传 compute 和 inputMode。

指定 `metadata:true` 后，`ready` 后依次发送 `metadata` 帧，包含 `offset`、最多 4096 行的 `neurons`、`complete`。每行为 `[bodyId, type, superclass, side, neurotransmitter, sign, position]`；`bodyId` 是十进制字符串，`position` 为 null 或以 8 nm 为单位的三坐标，其他注释字段为字符串，`sign` 为 -1、0 或 1。客户端收到声明的完整行数后才开始推理。消息中不填人工坐标；缺少胞体位置的节点通过另行打包的官方骨架定位补充数据恢复空间位置。

纯感觉模式要求 `walk`、`left`、`right`、`looming` 为零，并禁止 `pulse`。违规时以 `MOTOR_INPUT_FORBIDDEN` 或 `DIRECT_PULSE_FORBIDDEN` 关闭连接；上面的脉冲示例只适用于 assisted 会话。CUDA 失败返回 `CUDA_UNAVAILABLE`、`TORCH_NOT_INSTALLED` 或 `CUDA_OPERATION_FAILED`，不自动切换后端。

`inspect` 接受十进制字符串 `bodyId` 和公共请求字段，返回 `connections`：包括 `bodyId`、`direction:incoming`、上游边总数 `total` 和最多 32 条最强 `items`（每条为 `bodyId` 与突触数 `weight`）。检查不推进神经时钟，在纯感觉模式也可使用。

## 实验动力学

客户端在 `init` 中发送 `dynamics:"adaptive"` 与 `dynamicsEncoding:"adaptive-conductance/1"`，并检查 `ready` 同样确认二者。`dynamics:"reference"` 或省略时继续使用原电流型 LIF。`step.background` 为布尔值，省略时为 false，仅 adaptive 可设为 true。感觉模式仍拒绝人工运动输入和直接脉冲，重置会清空适应与电导状态。

见[方程与开关](../../fly-host/docs/autonomous-dynamics.zh_CN.md)。`smoke.js` 使用 `NEURAL_DYNAMICS=adaptive` 选择新配置，`check-autonomy.js` 固定使用纯感觉自主动力学。这是原版本 2 传输上的显式动力学协商，旧参考客户端行为不变。

## 完整放电的紧凑编码

`init` 可附加 `spikeEncoding:"index-count/1"`，且必须同时提供 `metadata:true`。仍保留 `spikeIds:"body-id"` 作为版本 2 的基础握手字段。新服务在 `ready.spikeEncoding` 确认 `index-count/1`；旧服务没有确认时，客户端继续读取原有 `spikes` 格式。

确认紧凑编码后，结果帧以 `firing:[索引,…]`、`counts:[次数,…]` 替代 `spikes`。索引是本会话完整元数据中的零起点行号，严格递增；两个数组等长，每个次数为 1–100，次数总和必须等于 `total`。不会丢弃、抽样或裁剪放电。模型切换后必须重新载入元数据，不可复用旧索引。

`ready.computeKernel` 报告实际实现：`javascript`、`torch-csr` 或 `triton-events`。CUDA 自主动力学在可导入 Triton 的环境使用融合事件内核和 CUDA Graph；未安装 Triton 时使用同一动力学的 PyTorch CUDA 实现。初始化包括图捕获；`ready` 表示已完成准备。`wallMs` 不含网络与客户端处理，端到端速度请使用 `node cloud/tools/benchmark.js` 测量。

飞行读出由客户端使用当前元数据和完整放电计算，不新增人工运动输入。见[飞行映射](../../fly-host/docs/flight.zh_CN.md)。

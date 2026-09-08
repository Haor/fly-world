[English](cloud-inference.md)

# 云端神经推理接口

状态：浏览器适配器与 CPU 推理服务已实现，并通过真实 WebSocket 联调。同一服务可运行于本地 PC 或远程服务器，尚未部署公网端点。

完整说明见[服务 API](../../cloud/docs/api.zh_CN.md)和[Windows / Linux / macOS 运行指南](../../cloud/docs/deployment.zh_CN.md)。

`CloudBrain` 实现 `Simulation` 使用的计算线程接口。云端维护神经状态，浏览器维护环境、按上一帧姿态计算感觉输入，每次提交 100 步并应用返回的运动通道。不会同时运行第二个本地大脑。每批计算需要网络往返，不能保证实时速度。

## 连接与模型身份

在实验工具选择云端后端，填写 WebSocket 地址和可选令牌，点击连接。远程地址必须用 WSS，仅本机回环测试可用 WS。不接受 URL 内凭证，也不在浏览器存储令牌。适配器在初始消息发送令牌后释放它。服务端必须校验令牌、Origin、请求大小和配额。

初始消息格式：

```json
{"type":"init","protocol":"fly-world-neural/1","model":"malecns-v1.0-full","seed":1,"dtMs":0.1,"steps":100,"channels":["walkLeft","walkRight","turnLeft","turnRight","reverse","escape","feed"],"spikeIds":"body-id","sensoryEncoding":"population-hz/2","token":"<optional token>"}
```

服务端返回 `type: ready`、相同协议与通道顺序，并携带：

```json
{"sensoryEncoding":"population-hz/2","model":{"id":"malecns-v1.0-full","scope":"full","neurons":211577,"dtMs":0.1,"connectomeSha256":"<64 lowercase hexadecimal characters>"}}
```

上述数量是完整注释表的示例，并不能单独证明连接覆盖完整。部署时需要提供建图筛选规则、实际数量、数据版本与校验和对应文件。`scope: full` 是服务端声明，不能替代独立验证。其他时间步长或通道定义需要版本化适配器，不能静默重采样。即使云端计算更大图，浏览器仍只展示当前 166,700 个神经元的投影。

## 请求与响应

初始化之后的请求均带递增 `requestId` 和 `generation`，服务端按接收顺序处理。

- `step`：`steps: 100`、`sensory` 和 `silenced`。感觉字段为 `walk`、`left`、`right`、`looming`、`sugar`、`odorLeft`、`odorRight`，单位 Hz。按 `src/habitat.js` 的群体定义映射云端图。`silenced` 关闭所有突触传播，但不禁止直接刺激的神经元放电。
- `pulse`：十进制字符串数组 `bodyIds`、`strength`（Hz）、`profile`（`paint` 或 `turn`）、`replace`。使用 `src/stimulus.js` 中以神经时间定义的包络。
- `clear`：只清除手动脉冲，保留连续感觉输入。
- `reset`：清空神经状态、延迟放电及手动脉冲，将 tick 归零；返回匹配请求 ID 和代次的 `type: reset`。

计算结果包括 `type: result`、匹配的 `requestId` / `generation`、累计的 0.1 ms 步数 `tick`、`steps: 100`、`wallMs`、全图总放电数 `total`、七个群体平均放电率 `rates`（Hz），以及 `[bodyIdString, countInBatch]` 数组 `spikes`。神经元 ID 必须是字符串。未知 ID 计入总活动，但不在本地投影绘制。ID 不能重复，每项计数须为 1..100 的整数。每帧最多 16 MiB、500,000 对；可省略不属于投影的 ID，但保留全图总数。浏览器拒绝不连续时钟和无效输出。

输出群体按 `src/stimulus.js` 定义：步行、转向、后退、逃逸和 MN9 进食。更大图的群体成员可能不同，做科学比较之前应在部署清单中注明差异。

## 失败处理与验证

丢弃旧代次及重复响应。握手不兼容、结果无效或连接断开时停止仿真，不自动重连或静默回退到本地子图。已有看门狗限制初始化和每批计算等待时间；USB 随后按正常超时规则回到本地模式。

执行 `node --test tests/cloud-brain.test.js tests/neural-correctness.test.js`。这些适配器单测使用内存 socket；服务另有真实 socket 测试和完整注释模型验证工具。Windows、生产 TLS、GPU 后端与持续多会话负载仍需在目标环境验证。

服务端必须在 `ready` 中确认 `sensoryEncoding: population-hz/2`。`odorLeft`、`odorRight` 分别映射 L、R 标注的 ORN_DM1；不得合并为单一强度，也不得再次应用感觉适应。浏览器已完成适应编码，并将可选寻食辅助合入步行、转向输入。旧版编码会被拒绝。

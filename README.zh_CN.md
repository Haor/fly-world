[English](README.md)

# Fly World

MaleCNS 果蝇观测站，包含像素栖息地、神经活动图、三维身体和可选的 FoloToy AI Passport 伴侣设备。可直接在浏览器运行保留模型，也可通过相同接口连接本机高性能 PC、另一台 PC 或云端的完整注释模型服务。

## 先在 PC 上运行

安装 Node.js 24 LTS 和 Python 3.13，在仓库根目录执行：

```sh
npm ci --prefix fly-host
npm run build --prefix fly-host
python3 -m http.server 8768 --bind 127.0.0.1 --directory fly-host/dist
```

Windows 将 `python3` 替换为 `py -3.13`。打开 `http://127.0.0.1:8768` 并启动模拟。浏览器模型和显示资源已包含在仓库中；优先使用 WebGPU，也可选择 JavaScript CPU 参考实现。静态服务器支持纯电脑观察，USB 连接需要独立的[伴侣桥接](ai-passport/docs/fly-world.zh_CN.md)。

## 在本机或服务器运行完整注释模型

所有平台使用同一套 WebSocket API。当前服务使用 CPU，每个会话一个仿真线程，不使用 CUDA 或 PC 显卡。

- [Windows PC、Linux/macOS、Docker 与跨机连接指南](cloud/docs/deployment.zh_CN.md)
- [API 文档](cloud/docs/api.zh_CN.md)
- [推理服务实现](cloud/README.zh_CN.md)

构建器从官方来源下载固定校验和的数据，产出带来源与筛选记录的模型包。原始数据、生成模型、令牌、设备身份备份不进入 Git；使用本项目不需要托管的公网端点。

| 模型 | 节点 | 有向连接 | 范围 |
| --- | ---: | ---: | --- |
| 浏览器 | 166,700 | 25,582,938 | 含 superclass 的注释节点 |
| 推理服务 | 211,577 | 26,028,386 | 全部注释节点及其诱导子图 |

原始片段连接图还包含未注释碎片，两种模型都不包含它们。节点更多不代表生物学更准确：LIF 参数、身体解码、饥饿/精力和可选寻食辅助都包含工程设定。详见[模型验证](fly-host/docs/neural-validation.zh_CN.md)与[寻食机制和开关](fly-host/docs/foraging.zh_CN.md)。

## AI Passport 伴侣设备

ESP32-C3 通过 USB 同步显示像素世界；离开电脑后回到本地喂食、玩耍和休息规则。神经模型运行在电脑或推理服务上。固件使用 ESP-IDF 5.5.3，保留设备身份和出厂恢复分区，详见[固件与桥接指南](ai-passport/docs/fly-world.zh_CN.md)。安装应用时不要整片擦除或覆盖设备身份分区。

## 开发与验证

```sh
node --test fly-host/tests/*.test.js
npm ci --prefix cloud
npm test --prefix cloud
node fly-host/tests/data-integrity.mjs
```

CI 检查前端与服务并构建服务容器，模型构建器另有 Python 映射测试。启动完整模型后可通过 `cloud/tools/smoke.js` 验证 API、重置与固定刺激下的性能。Windows 和生产 TLS 仍需在目标环境验证。

## 来源与许可

项目代码采用 MIT，并保留第三方许可。神经可视化、三维身体、相关资源与 WebGPU 基础实现来自 [Xenova Neural Canvas](https://huggingface.co/spaces/Xenova/fruit-fly-simulation)。MaleCNS 数据由 FlyEM / HHMI Janelia 及合作方提供，使用 CC BY 4.0；设备固件基于 [FoloToy AI Passport](https://github.com/FoloToy/ai-passport)。详见 [NOTICE](NOTICE.zh_CN.md)、[LICENSE](LICENSE)及各组件许可。

[English](README.md)

# Fly World 果蝇观测站

面向 MaleCNS 果蝇和 AI Passport 的本地观察界面。栖息地、神经活动和三维身体共用一个仿真时钟。

运行 `npm run build` 构建，通过相邻的 `../ai-passport/tools/start-fly-world.command` 启动伴侣服务。在本地 8768 端口打开观测站，点击“启动本地模拟”。模型和身体资源均由本地提供，无 USB 设备时也能独立运行。

## 观察工具

- “显示阴影”只控制渲染。实验工具里的“逼近刺激”独立持续 0.65 秒神经时间，不自动重复。

- 导航栏切换栖息地、神经活动和身体视图。
- 在栖息地显示运动轨迹与人为设定的气味场；显示气味场不会自动开启嗅觉输入。
- 暂停或重置整个神经世界；重置保留输入设置。
- 曲线和事件使用神经时间。CSV 导出最近 12 秒曲线及最多 80 条事件，不是完整会话存档。
- 感知开关控制各个感觉编码器。
- 实验工具提供直接神经刺激、零输入重置、突触传播开关和后端选择。
- 设备区展示 USB 连接和显示状态。其他页面占用设备时，“接管设备”明确切换控制权。

## 模型边界

静态气味场为 `25 * exp(-distance_mm / 7)`；左右触角分别采样，经简化适应后输入对应的 ORN_DM1。嗅觉和寻食辅助默认开启，可以分别关闭。辅助根据局部气味差异和近期变化调节 LC9、DNa02 输入，不读取食物坐标，也不直接移动身体。这是工程策略，不能视为神经网络自主涌现的寻食能力。尚未模拟风；气味场叠加显示适应前数值，只影响画面。参数与验证边界见[寻食说明](docs/foraging.zh_CN.md)。

LC9 探索驱动、DNa02 转向偏置、饥饿、精力、感觉编码和身体解码属于人工设定。连接组本身不等于完整行为模型。“模型与项目”说明区区分了这些层次。三维身体来自 NeuroMechFly 的雌性标本。

## 实现与验证

- `src/simulation.js` 管理计算线程、神经与环境时钟、暂停重置及 CPU 回退。
- `src/main.js` 管理观测站交互与数据显示。
- `src/habitat.js` 和 `src/habitat-view.js` 管理环境与像素栖息地。
- `src/olfaction.js` 管理双侧嗅觉适应和可选寻食辅助。
- `src/observations.js` 管理有上限的样本、事件和 CSV 导出。
- `src/passport.js` 管理伴侣连接、设备状态和主动接管。
- `src/brain-view.js`、`src/scene.js` 及神经计算模块复用、适配 [Xenova Neural Canvas](https://huggingface.co/spaces/Xenova/fruit-fly-simulation)，保留已有许可及模型、数据署名。

运行 `node --test tests/habitat.test.js tests/station.test.js` 验证环境规则、仿真生命周期、观察记录和气味场一致性。`node tests/closed-loop.mjs` 使用完整本地连接组验证闭环。浏览器与实体 USB 验证独立于这些测试。

默认全览模式同时显示栖息地、神经活动、三维身体和实时数据，也可切回单个视图。

实现正确性与限制见[神经验证记录](docs/neural-validation.zh_CN.md)，远程扩展见[云端推理接口](docs/cloud-inference.zh_CN.md)。

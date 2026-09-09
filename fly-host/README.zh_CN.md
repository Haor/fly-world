本机轻量、本机全量、远程全量的配置与区别见[物理闭环运行指南](../cloud/docs/physical-world.zh_CN.md)。

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
- 实验工具提供环境遮挡、零输入重置和突触传播开关；运行方式使用独立的三选项面板。
- 设备区展示 USB 连接和显示状态。其他页面占用设备时，“接管设备”明确切换控制权。

## 模型边界

全量模式的感觉、神经、MuJoCo 身体和物理反馈在同一台计算机器中推进。浏览器发送环境操作并显示结果，不生成全量模式的步态、起飞冲量或目标高度。视觉、气味与身体反馈仍使用近似感受器转导；肌肉映射不完整且尚未校准。连接组不等于完整的活体行为模型。详见[物理闭环科学边界](docs/physical-loop.zh_CN.md)。

本机轻量仍使用浏览器近似身体、嗅觉适应和可关闭的背景输入，适合轻量观察，不能替代物理模式的实验验证。旧版辅助寻食实现保留在代码中，当前纯感觉界面不启用它。

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

## 模型与感觉模式

默认使用纯感觉模式：没有人工步行、转向或寻食辅助。环境提供双侧气味、接触味觉、双侧早期视觉输入；光照强度、方向和短时遮挡改变感觉值。L1/L2 视觉仍是代理编码，不是完整视网膜。切换到“辅助实验”才启用旧的运动驱动。

可选择轻量或全量模型，神经图使用所选模型全部 ID。空间位置由官方胞体标注和 SWC 骨架代表位置组成；不再为缺失坐标构造方格。点击节点按需查看完整 SWC 分支和最强 32 条上游连接。网络边来自所选推理图，骨架直接来自官方公共数据。详见[空间数据说明](docs/anatomy.zh_CN.md)和[Windows CUDA 指南](../cloud/docs/cuda-windows.zh_CN.md)。

[自主动力学说明](docs/autonomous-dynamics.zh_CN.md)包含方程、背景开关、相关项目比较与验证边界。

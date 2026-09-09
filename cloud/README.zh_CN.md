[English](README.md)

# Fly World 推理服务

同一套 API 可用于本机 PC、另一台 PC 或云主机。可选择 CPU 参考实现或 PyTorch CUDA 后端，并在轻量和完整注释模型之间选择。群体定义和刺激包络由观测站代码共享。

- [Windows / macOS / Linux 与 Docker 运行指南](docs/deployment.zh_CN.md)
- [WebSocket API、命令、响应和错误码](docs/api.zh_CN.md)
- [Windows CUDA 安装与验证](docs/cuda-windows.zh_CN.md)
- [模型构建器](tools/build_model.py)
- [真实客户端与性能验证工具](tools/smoke.js)

完整注释模型包含 211,577 个节点、26,028,386 条有向边，不包含未注释的原始片段。模型和原始文件在本地准备，不提交到仓库。CPU 后端和 PyTorch CPU 对照已测试；两套动力学和全量 CUDA 感觉对照已在 RTX 4090 D 上通过。原生 Windows 显卡执行与公网 TLS 仍需目标环境验证。

在仓库根目录执行 `npm ci --prefix cloud` 和 `npm test --prefix cloud`。启动前按指南准备模型目录、访问令牌和精确 Origin 白名单。

[自主动力学说明](../fly-host/docs/autonomous-dynamics.zh_CN.md)包含方程、背景开关、相关项目比较与验证边界。

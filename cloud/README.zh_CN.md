[English](README.md)

# Fly World 推理服务

同一套 API 可用于本机 PC、另一台 PC 或云主机。当前参考后端使用 CPU 运行 MaleCNS LIF 模型，复用观测站的神经核心、群体定义和刺激包络。

- [Windows / macOS / Linux 与 Docker 运行指南](docs/deployment.zh_CN.md)
- [WebSocket API、命令、响应和错误码](docs/api.zh_CN.md)
- [模型构建器](tools/build_model.py)
- [真实客户端与性能验证工具](tools/smoke.js)

完整注释模型包含 211,577 个节点、26,028,386 条有向边，不包含未注释的原始片段。模型和原始文件在本地准备，不提交到仓库。CPU 后端已可运行；GPU 加速、Windows 执行和公网 TLS 部署需在目标环境另行验证。

在仓库根目录执行 `npm ci --prefix cloud` 和 `npm test --prefix cloud`。启动前按指南准备模型目录、访问令牌和精确 Origin 白名单。

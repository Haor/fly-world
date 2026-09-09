[English](anatomy.md)

# 神经空间数据与图的范围

官方 MaleCNS 提供连接、神经骨架及分割数据。注释表中的 `somaLocation` 只描述胞体，并不等于整个神经元的空间信息。原始全部 211,577 行中有 141,781 个胞体位置，69,796 行缺此字段；轻量集有 139,662 个胞体位置。缺字段不意味着没有官方骨架。

`cloud/tools/prepare_anatomy.py` 从官方 SWC 骨架中计算缺失节点的代表位置。SWC 与胞体表共用 8 nm 坐标单位。代表位置是骨架顶点的平均值，不会被标成胞体，也不影响推理连接、权重或神经活动。

浏览器加载 `public/data/anatomy.json.gz` 后，以胞体或骨架代表位置展示全部可定位节点。任何仍未获得空间数据的节点只报告数量，不放入人工方格。该文件包含明确来源、计算方法与未完成原因，下载脚本支持检查点重跑。

点击节点可从官方源按需获取该神经元完整 SWC 分支，并显示所选推理图中最强的 32 条上游连接及上游总数。这是可按节点展开的神经空间图，不会一次绘制全部约 2,600 万条连接或全部骨架顶点；全量推理仍使用所有保留边，绘制限制不改变计算。

```sh
python cloud/tools/prepare_anatomy.py --neurons cloud/models/malecns-full/neurons.json.gz
npm run build --prefix fly-host
```

定位补充文件随前端提供，可离线展示全节点位置；首次选中节点的详细骨架需要访问官方存储。上游连接检查不会刺激节点，也不会推进神经时钟。

来源：[MaleCNS 官方下载页](https://male-cns.janelia.org/download/)，[SWC 存储路径](https://storage.googleapis.com/flyem-male-cns/v1.0/segmentation/skeletons-malecns/skeletons-swc/12781.swc)。数据许可为 CC BY 4.0，来源署名延续项目 NOTICE。

随前端提供的补充文件含 69,792 个官方骨架代表位置，加上 141,781 个胞体位置，共可定位全量模型中的 211,573 / 211,577 个节点。剩余 `566129`、`904553`、`529529442`、`585510588` 在准备时访问官方 SWC 与 precomputed 路径均返回 HTTP 404。

`anatomy.json.gz` SHA-256: `f9e82fa1c2454b64360d7225fada314a21332e0eba83524a8bed83bf903e3d2b`.

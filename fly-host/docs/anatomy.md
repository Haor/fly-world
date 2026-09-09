[简体中文](anatomy.zh_CN.md)

# Neural spatial data and diagram scope

Official MaleCNS data includes connectivity, skeletons, and segmentation. The
annotation table's `somaLocation` records a cell body, not the whole neuron's spatial
extent. Among 211,577 annotation rows, 141,781 have soma positions and 69,796 lack
that field. The retained set contains 139,662 soma positions. Missing soma metadata
does not imply a missing official skeleton.

`cloud/tools/prepare_anatomy.py` derives representative positions from official SWC
skeletons for those gaps. Both sources use 8 nm coordinate units. The representative
position is the mean of skeleton vertices; it is identified as such, never as a soma.
This supplement does not alter neural connectivity, weights, or activity.

The browser reads `public/data/anatomy.json.gz` and places each resolved node at its
soma or skeleton representative position. Remaining gaps are reported, not arranged
in a fabricated grid. The supplement records source, method, and unresolved reasons;
the downloader supports resumable checkpoints.

Click a node to fetch its full SWC branches from the official source and inspect the
strongest 32 incoming edges plus total incoming edge count from the selected model.
This is a spatial diagram with per-node detail, not a simultaneous rendering of all
26 million edges or every skeleton vertex. Display limits do not reduce inference.

```sh
python cloud/tools/prepare_anatomy.py --neurons cloud/models/malecns-full/neurons.json.gz
npm run build --prefix fly-host
```

The bundled position supplement works offline. Detailed skeleton loading needs
network access on selection. Inspecting edges neither stimulates neurons nor advances
the neural clock.

Sources: [MaleCNS downloads](https://male-cns.janelia.org/download/) and the
[official SWC path](https://storage.googleapis.com/flyem-male-cns/v1.0/segmentation/skeletons-malecns/skeletons-swc/12781.swc).
Data uses CC BY 4.0, with attribution retained in the project NOTICE.

The bundled supplement contains 69,792 official-skeleton positions. Together with
141,781 soma positions, it locates 211,573 of the 211,577 full-model nodes. The four
remaining IDs (`566129`, `904553`, `529529442`, `585510588`) returned HTTP 404 at both
the official SWC and precomputed paths during preparation.

`anatomy.json.gz` SHA-256: `f9e82fa1c2454b64360d7225fada314a21332e0eba83524a8bed83bf903e3d2b`.

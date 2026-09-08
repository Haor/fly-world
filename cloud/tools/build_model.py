"""Build an auditable all-annotation induced graph from pinned MaleCNS tables."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import urllib.request

import numpy as np
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.feather as feather

BASE = 'https://storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/flat-connectome/'
SOURCES = {
    'body-annotations-male-cns-v1.0-minconf-0.5.feather': '2177e246113e4cfbf1e7772ec37c6da1955ff22e8063d0b1f833101f99a9a3b2',
    'body-neurotransmitters-male-cns-v1.0.feather': '95c9289220663abeb3409f3ad9e5a7f8a53f8093f5139d15502cd08da8879621',
    'connectome-weights-male-cns-v1.0-minconf-0.5.feather': 'e35da783d1c686b2b58b3b87cd6a403ae43bfcfba8bff28e08ef752c1a56afc1',
}


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def obtain(cache, name, expected):
    path = cache / name
    if not path.exists():
        temporary = path.with_suffix('.part')
        print('Downloading', name, flush=True)
        with urllib.request.urlopen(BASE + name, timeout=120) as response, temporary.open('wb') as stream:
            while chunk := response.read(4 * 1024 * 1024):
                stream.write(chunk)
        if digest(temporary) != expected:
            raise ValueError('Downloaded source checksum mismatch: ' + name)
        temporary.rename(path)
    if digest(path) != expected:
        raise ValueError('Cached source checksum mismatch: ' + name)
    return path


def map_edges(ids, batch):
    pre = batch.column('body_pre').to_numpy()
    post = batch.column('body_post').to_numpy()
    weights = batch.column('weight').to_numpy()
    if np.any(weights <= 0) or np.any(weights > np.iinfo(np.uint32).max):
        raise ValueError('Invalid synapse count')
    src, dst = np.searchsorted(ids, pre), np.searchsorted(ids, post)
    valid = (src < len(ids)) & (dst < len(ids))
    valid &= ids[np.minimum(src, len(ids) - 1)] == pre
    valid &= ids[np.minimum(dst, len(ids) - 1)] == post
    return np.column_stack((src[valid], dst[valid], weights[valid])).astype('<u4')


def build(cache, output):
    cache.mkdir(parents=True, exist_ok=True)
    if output.exists():
        raise ValueError('Output already exists; choose a new model directory')
    paths = [obtain(cache, name, sha) for name, sha in SOURCES.items()]
    annotations = feather.read_table(paths[0], columns=['bodyId', 'type', 'superclass', 'somaSide', 'rootSide', 'somaLocation'])
    rows = sorted(annotations.to_pylist(), key=lambda row: row['bodyId'])
    ids = np.array([row['bodyId'] for row in rows], dtype=np.int64)
    if len(np.unique(ids)) != len(ids) or np.any(ids < 0):
        raise ValueError('Body IDs must be unique and nonnegative')
    nt = feather.read_table(paths[1], columns=['body', 'consensus_nt'])
    positions = pc.index_in(pa.array(ids), value_set=nt['body'])
    transmitters = pc.take(nt['consensus_nt'], positions).to_pylist()
    fast_signs = {'acetylcholine': 1, 'gaba': -1, 'glutamate': -1}
    neurons = [[str(row['bodyId']), row['type'], row['superclass'], row['somaSide'] or row['rootSide'],
                transmitter, fast_signs.get(transmitter, 0), row['somaLocation']]
               for row, transmitter in zip(rows, transmitters)]
    temporary = output.with_name(output.name + '.building')
    temporary.mkdir(parents=True)
    filtered = temporary / 'filtered.tmp'
    edge_rows = 0
    source_synapses = 0
    reader = pa.ipc.open_file(pa.memory_map(str(paths[2])))
    with filtered.open('wb') as stream:
        for i in range(reader.num_record_batches):
            batch = reader.get_batch(i)
            edge_rows += batch.num_rows
            source_synapses += int(pc.sum(batch.column('weight')).as_py())
            map_edges(ids, batch).tofile(stream)
            if i % 250 == 0:
                print(f'Mapping edges: {i}/{reader.num_record_batches}', flush=True)
    triples = np.memmap(filtered, dtype='<u4', mode='r').reshape(-1, 3)
    retained_rows = len(triples)
    print('Sorting retained edges:', retained_rows, flush=True)
    order = np.lexsort((triples[:, 0], triples[:, 1]))
    src, dst, counts = (np.array(triples[order, column], dtype='<u4') for column in range(3))
    del order, triples
    filtered.unlink()
    # Merge repeated source/target pairs without changing their summed strength.
    starts = np.flatnonzero(np.r_[True, (src[1:] != src[:-1]) | (dst[1:] != dst[:-1])])
    sums = np.add.reduceat(counts.astype(np.uint64), starts)
    if np.any(sums > np.iinfo(np.uint32).max):
        raise ValueError('Merged weight exceeds uint32')
    src, dst, counts = src[starts], dst[starts], sums.astype('<u4')
    offsets64 = np.r_[0, np.cumsum(np.bincount(dst, minlength=len(ids)), dtype=np.uint64)]
    if offsets64[-1] > np.iinfo(np.uint32).max:
        raise ValueError('CSR exceeds uint32 index capacity')
    files = {}
    def record(key, name):
        path = temporary / name
        files[key] = {'file': name, 'bytes': path.stat().st_size, 'sha256': digest(path)}
    (temporary / 'neurons.json.gz').write_bytes(gzip.compress(json.dumps(neurons, separators=(',', ':')).encode(), mtime=0))
    record('neurons', 'neurons.json.gz')
    for key, values in [('offsets', offsets64.astype('<u4')), ('sources', src), ('counts', counts)]:
        values.tofile(temporary / (key + '.u32'))
        record(key, key + '.u32')
    manifest = {
        'schema': 'fly-world-graph/1',
        'model': {'id': 'malecns-v1.0-full', 'scope': 'full', 'coverage': 'all-annotated-bodies',
                  'neurons': len(ids), 'edges': len(src), 'synapses': int(sums.sum()), 'dtMs': .1},
        'files': files,
        'provenance': {
            'dataset': 'MaleCNS v1.0', 'license': 'CC BY 4.0',
            'selection': 'Every annotation row; induced graph on annotated body IDs; no extra edge threshold',
            'sourceAnnotationRows': len(rows), 'unclassifiedAnnotationRows': sum(row['superclass'] is None for row in rows),
            'sourceEdges': edge_rows, 'sourceSynapses': source_synapses,
            'excludedMissingEndpointEdges': edge_rows - retained_rows,
            'mergedDuplicatePairs': retained_rows - len(src),
            'sources': [{'url': BASE + name, 'sha256': sha} for name, sha in SOURCES.items()],
            'limitations': ['Unannotated segments are excluded, so this is not the complete raw segment graph.',
                           'Unclassified bodies are included; node count is not a count of fully reconstructed living neurons.',
                           'The runtime uses the local LIF and monoamine conventions without fitted biological parameters.'],
        },
    }
    (temporary / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    temporary.rename(output)
    print(json.dumps(manifest['model']), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, default=Path('.cache'))
    parser.add_argument('--output', type=Path, default=Path('models/malecns-full'))
    args = parser.parse_args()
    build(args.cache, args.output)

import importlib.util
from pathlib import Path
import unittest
import numpy as np
import pyarrow as pa

spec = importlib.util.spec_from_file_location('builder', Path(__file__).parents[1] / 'tools/build_model.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class MappingTests(unittest.TestCase):
    def test_induced_graph_preserves_direction_and_excludes_unknown_endpoints(self):
        batch = pa.record_batch({'body_pre': [10, 999, 30, 10], 'body_post': [30, 10, 10, 999], 'weight': [7, 8, 9, 10]})
        actual = builder.map_edges(np.array([10, 30]), batch)
        np.testing.assert_array_equal(actual, [[0, 1, 7], [1, 0, 9]])

    def test_invalid_weights_are_not_silently_truncated(self):
        batch = pa.record_batch({'body_pre': [10], 'body_post': [10], 'weight': [-1]})
        with self.assertRaises(ValueError):
            builder.map_edges(np.array([10]), batch)


if __name__ == '__main__':
    unittest.main()

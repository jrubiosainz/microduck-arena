import io

import numpy as np

from arena import trace as codec
from arena.constants import TRACE_WIDTH


def test_round_trip_preserves_shape_and_dtype():
    original = np.random.default_rng(0).standard_normal((100, TRACE_WIDTH)).astype(np.float32)
    restored = codec.decode(codec.encode(original))
    assert restored.shape == original.shape
    assert restored.dtype == np.float32


def test_round_trip_is_accurate_to_float16():
    original = np.random.default_rng(0).uniform(-3, 3, (50, TRACE_WIDTH)).astype(np.float32)
    restored = codec.decode(codec.encode(original))
    # float16 has ~3 decimal digits; millimetre accuracy is plenty for a replay.
    np.testing.assert_allclose(restored, original, atol=3e-3)


def test_the_wire_format_is_float16():
    """Pin the dtype directly.

    The size assertion below cannot do this job: an all-zero or otherwise
    compressible array is crushed by zip regardless of dtype, so a regression
    that dropped the float16 downcast would sail past a size bound.
    """
    original = np.random.default_rng(0).standard_normal((10, TRACE_WIDTH)).astype(np.float32)
    with np.load(io.BytesIO(codec.encode(original))) as loaded:
        assert loaded["trace"].dtype == np.float16


def test_a_20_second_sprint_trace_stays_small():
    # Random data, not zeros: incompressible content is what makes the bound
    # mean something. A real 911-frame trace measures about 35 KB.
    frames = int(20.0 / 0.02)  # 1000 frames at 50 Hz
    noisy = np.random.default_rng(1).standard_normal((frames, TRACE_WIDTH)).astype(np.float32)
    blob = codec.encode(noisy)
    assert len(blob) < 100_000, f"{len(blob)} bytes is larger than expected"


def test_empty_trace_round_trips():
    empty = np.zeros((0, TRACE_WIDTH), dtype=np.float32)
    assert codec.decode(codec.encode(empty)).shape == (0, TRACE_WIDTH)


def test_the_settle_round_trips_beside_the_trace():
    rng = np.random.default_rng(2)
    trace = rng.uniform(-3, 3, (40, TRACE_WIDTH)).astype(np.float32)
    settle = rng.uniform(-3, 3, (26, TRACE_WIDTH)).astype(np.float32)
    blob = codec.encode(trace, settle)
    np.testing.assert_allclose(codec.decode(blob), trace, atol=3e-3)
    restored = codec.decode_settle(blob)
    assert restored.dtype == np.float32
    np.testing.assert_allclose(restored, settle, atol=3e-3)


def test_a_trace_stored_before_settles_were_recorded_has_none():
    blob = codec.encode(np.zeros((5, TRACE_WIDTH), dtype=np.float32))
    assert codec.decode_settle(blob).shape == (0, TRACE_WIDTH)

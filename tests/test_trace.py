import io

import numpy as np
import pytest

from arena import trace as codec
from arena.constants import TRACE_WIDTH


def test_round_trip_preserves_shape_and_dtype():
    original = np.random.default_rng(0).standard_normal((100, TRACE_WIDTH)).astype(np.float32)
    restored = codec.decode(codec.encode(original))
    # A race's trace, or a performance stored before troupes, reads back as one duck.
    assert restored.shape == (1, *original.shape)
    assert restored.dtype == np.float32


def test_round_trip_is_accurate_to_float16():
    original = np.random.default_rng(0).uniform(-3, 3, (50, TRACE_WIDTH)).astype(np.float32)
    restored = codec.decode(codec.encode(original))
    # float16 has ~3 decimal digits; millimetre accuracy is plenty for a replay.
    np.testing.assert_allclose(restored[0], original, atol=3e-3)


def test_a_troupes_trace_and_settle_round_trip_duck_by_duck():
    rng = np.random.default_rng(3)
    trace = rng.uniform(-3, 3, (4, 40, TRACE_WIDTH)).astype(np.float32)
    settle = rng.uniform(-3, 3, (4, 26, TRACE_WIDTH)).astype(np.float32)
    blob = codec.encode(trace, settle)
    np.testing.assert_allclose(codec.decode(blob), trace, atol=3e-3)
    np.testing.assert_allclose(codec.decode_settle(blob), settle, atol=3e-3)


def test_a_trace_stored_before_troupes_reads_as_one_duck():
    """What the store holds today: a plain 2-D float16 trace and settle, written before this codec knew ducks."""
    trace = np.random.default_rng(4).uniform(-3, 3, (30, TRACE_WIDTH)).astype(np.float16)
    buffer = io.BytesIO()
    np.savez_compressed(buffer, trace=trace, settle=trace[:5])
    assert codec.decode(buffer.getvalue()).shape == (1, 30, TRACE_WIDTH)
    assert codec.decode_settle(buffer.getvalue()).shape == (1, 5, TRACE_WIDTH)


@pytest.mark.parametrize("shape", [(TRACE_WIDTH,), (2, 3, 4, TRACE_WIDTH), (5, TRACE_WIDTH + 1), (2, 5, 7)])
def test_a_trace_that_is_neither_one_duck_nor_a_troupe_is_refused(shape):
    with pytest.raises(ValueError, match="must be"):
        codec.encode(np.zeros(shape, dtype=np.float32))


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
    assert codec.decode(codec.encode(empty)).shape == (1, 0, TRACE_WIDTH)


def test_the_settle_round_trips_beside_the_trace():
    rng = np.random.default_rng(2)
    trace = rng.uniform(-3, 3, (40, TRACE_WIDTH)).astype(np.float32)
    settle = rng.uniform(-3, 3, (26, TRACE_WIDTH)).astype(np.float32)
    blob = codec.encode(trace, settle)
    np.testing.assert_allclose(codec.decode(blob)[0], trace, atol=3e-3)
    restored = codec.decode_settle(blob)
    assert restored.dtype == np.float32
    np.testing.assert_allclose(restored[0], settle, atol=3e-3)


def test_a_trace_stored_before_settles_were_recorded_has_none():
    blob = codec.encode(np.zeros((5, TRACE_WIDTH), dtype=np.float32))
    assert codec.decode_settle(blob).shape == (1, 0, TRACE_WIDTH)

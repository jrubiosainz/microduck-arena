"""Replay traces on the wire.

float16 at 50 Hz: a 20 s sprint is ~42 KB, and half a millimetre of precision is
invisible in a replay. The frontend renders these directly through the rig, so
physics never runs client-side.
"""

import io

import numpy as np

from .constants import TRACE_WIDTH


def encode(trace: np.ndarray) -> bytes:
    if trace.ndim != 2 or trace.shape[1] != TRACE_WIDTH:
        raise ValueError(f"trace must be (frames, {TRACE_WIDTH}), got {trace.shape}")
    buffer = io.BytesIO()
    np.savez_compressed(buffer, trace=trace.astype(np.float16))
    return buffer.getvalue()


def decode(blob: bytes) -> np.ndarray:
    with np.load(io.BytesIO(blob)) as loaded:
        return loaded["trace"].astype(np.float32)

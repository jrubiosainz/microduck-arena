"""Replay traces on the wire.

float16 at 50 Hz: a 20 s sprint is ~42 KB, and half a millimetre of precision is
invisible in a replay. The frontend renders these directly through the rig, so
physics never runs client-side.

Beside the timed trace, the untimed settle that led into it (see RunOutcome).
Traces stored before settles were recorded have none.
"""

import io

import numpy as np

from .constants import TRACE_WIDTH


def encode(trace: np.ndarray, settle: np.ndarray | None = None) -> bytes:
    frames = {"trace": trace} if settle is None else {"trace": trace, "settle": settle}
    for name, array in frames.items():
        if array.ndim != 2 or array.shape[1] != TRACE_WIDTH:
            raise ValueError(f"{name} must be (frames, {TRACE_WIDTH}), got {array.shape}")
    buffer = io.BytesIO()
    np.savez_compressed(buffer, **{name: array.astype(np.float16) for name, array in frames.items()})
    return buffer.getvalue()


def decode(blob: bytes) -> np.ndarray:
    with np.load(io.BytesIO(blob)) as loaded:
        return loaded["trace"].astype(np.float32)


def decode_settle(blob: bytes) -> np.ndarray:
    with np.load(io.BytesIO(blob)) as loaded:
        if "settle" not in loaded:
            return np.zeros((0, TRACE_WIDTH), dtype=np.float32)
        return loaded["settle"].astype(np.float32)

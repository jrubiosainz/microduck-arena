"""Replay traces on the wire.

float16 at 50 Hz: a 20 s sprint is ~42 KB, and half a millimetre of precision is
invisible in a replay. The frontend renders these directly through the rig, so
physics never runs client-side.

Beside the timed trace, the untimed settle that led into it (see RunOutcome).
Traces stored before settles were recorded have none.

A race keeps one duck's (frames, TRACE_WIDTH); a stage keeps every duck of its
troupe, (ducks, frames, TRACE_WIDTH). Read back, both are (ducks, frames,
TRACE_WIDTH): a race, and a performance stored before troupes, are one duck.
"""

import io

import numpy as np

from .constants import TRACE_WIDTH


def encode(trace: np.ndarray, settle: np.ndarray | None = None) -> bytes:
    frames = {"trace": trace} if settle is None else {"trace": trace, "settle": settle}
    for name, array in frames.items():
        if array.ndim not in (2, 3) or array.shape[-1] != TRACE_WIDTH:
            raise ValueError(
                f"{name} must be (frames, {TRACE_WIDTH}) or (ducks, frames, {TRACE_WIDTH}), got {array.shape}"
            )
    buffer = io.BytesIO()
    np.savez_compressed(buffer, **{name: array.astype(np.float16) for name, array in frames.items()})
    return buffer.getvalue()


def as_ducks(frames: np.ndarray) -> np.ndarray:
    """A trace or a settle as (ducks, frames, TRACE_WIDTH) float32: one duck's is the first of one."""
    return (frames[np.newaxis] if frames.ndim == 2 else frames).astype(np.float32)


def decode(blob: bytes) -> np.ndarray:
    with np.load(io.BytesIO(blob)) as loaded:
        return as_ducks(loaded["trace"])


def decode_settle(blob: bytes) -> np.ndarray:
    with np.load(io.BytesIO(blob)) as loaded:
        if "settle" not in loaded:
            return np.zeros((1, 0, TRACE_WIDTH), dtype=np.float32)
        return as_ducks(loaded["settle"])

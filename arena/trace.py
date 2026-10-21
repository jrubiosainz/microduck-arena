"""Replay traces on the wire.

float16 at 50 Hz: a 20 s sprint is ~42 KB, and half a millimetre of precision is
invisible in a replay. The frontend renders these directly through the rig, so
physics never runs client-side.

Beside the timed trace, the untimed settle that led into it (see RunOutcome).
Traces stored before settles were recorded have none.

A race keeps one duck's (frames, TRACE_WIDTH); a stage keeps every duck of its
troupe, (ducks, frames, TRACE_WIDTH). Read back, both are (ducks, frames,
TRACE_WIDTH): a race, and a performance stored before troupes, are one duck.

A tug's file carries its string beside its two ducks: the string's points, west
to east, (frames, STRING_POINTS, 3), and its settle's, (settle + 1,
STRING_POINTS, 3), float16 like the ducks (0.24 mm off). The key's presence is
the version: every race and performance stored is as it was, and a tug's file
always carries its string.
"""

import io

import numpy as np

from .constants import TRACE_WIDTH
from .tug import STRING_POINTS


def encode(
    trace: np.ndarray,
    settle: np.ndarray | None = None,
    string: np.ndarray | None = None,
    string_settle: np.ndarray | None = None,
) -> bytes:
    ducks = {"trace": trace} if settle is None else {"trace": trace, "settle": settle}
    for name, array in ducks.items():
        if array.ndim not in (2, 3) or array.shape[-1] != TRACE_WIDTH:
            raise ValueError(
                f"{name} must be (frames, {TRACE_WIDTH}) or (ducks, frames, {TRACE_WIDTH}), got {array.shape}"
            )
    points = {name: array for name, array in (("string", string), ("string_settle", string_settle))
              if array is not None}
    for name, array in points.items():
        if array.shape[1:] != (STRING_POINTS, 3):
            raise ValueError(f"{name} must be (frames, {STRING_POINTS}, 3), got {array.shape}")
    arrays, buffer = {**ducks, **points}, io.BytesIO()
    np.savez_compressed(buffer, **{name: array.astype(np.float16) for name, array in arrays.items()})
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


def decode_string(blob: bytes) -> tuple[np.ndarray, np.ndarray]:
    """A tug's string, float32: its settle's points, then the timed ones."""
    with np.load(io.BytesIO(blob)) as loaded:
        if "string" not in loaded:
            raise ValueError("this trace holds no string")
        return loaded["string_settle"].astype(np.float32), loaded["string"].astype(np.float32)

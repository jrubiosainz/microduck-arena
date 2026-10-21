"""The moments of a bout, found in its 50 Hz trace: what a commentator calls play by play."""

from dataclasses import dataclass

import numpy as np

from .constants import CTRL_DT
from .manifest import Tug
from .tug import SIDES, in_pit, marker_x

LEAD_M = 0.02  # the marker past this on one side of the centre line leads that way
GROUND_M = 0.10  # the marker pulled this far one way
EDGE_M = 0.08  # a trunk this close to the pit's lip is at its edge
SLIP_DEG = 35.0  # a trunk tilted past this slips

KINDS = ("start", "lead", "ground", "edge", "slip", "pit", "time")


@dataclass(frozen=True)
class Moment:
    """`side` is, per kind: start, None; lead, the new leader; ground, the side the marker was
    pulled to; edge, slip and pit, the duck at its edge, slipping, dropping in; time, the side the
    marker favours at the limit (None when it is on the centre line)."""

    at_s: float
    kind: str
    side: str | None


def _first(flags: np.ndarray) -> int | None:
    return int(np.argmax(flags)) if flags.any() else None


def moments(trace: np.ndarray, course: Tug, offset) -> list[Moment]:
    """A bout's moments, (2, frames, 21) -> in order of time, then of kind, west before east.
    Frame j is recorded after step j + 1, so it is at (j + 1) control steps."""
    frames = trace.shape[1]
    x = marker_x(trace, offset)
    found = [(0.0, "start", None)]

    def add(j: int, kind: str, side: str | None) -> None:
        found.append((round((j + 1) * CTRL_DT, 2), kind, side))

    leader = None
    for j in np.flatnonzero(np.abs(x) > LEAD_M):
        side = SIDES[0] if x[j] < 0 else SIDES[1]
        if side != leader:
            leader = side
            add(j, "lead", side)
    for side, flags in zip(SIDES, (x <= -GROUND_M, x >= GROUND_M)):
        if (j := _first(flags)) is not None:
            add(j, "ground", side)

    lip = course.pit_m / 2 + EDGE_M
    for duck, side in enumerate(SIDES):
        trunk = trace[duck, :, 0]
        if (j := _first(trunk > -lip if duck == 0 else trunk < lip)) is not None:
            add(j, "edge", side)
        qx, qy = trace[duck, :, 4].astype(np.float64), trace[duck, :, 5].astype(np.float64)
        tilt = np.arccos(np.clip(1 - 2 * (qx**2 + qy**2), -1, 1))
        if (j := _first(tilt > np.radians(SLIP_DEG))) is not None:
            add(j, "slip", side)
        if (j := _first(np.array([in_pit(f) for f in trace[duck]]))) is not None:
            add(j, "pit", side)

    if not any(kind == "pit" for _, kind, _ in found):
        side = SIDES[0] if x[-1] < 0 else SIDES[1] if x[-1] > 0 else None
        add(frames - 1, "time", side)

    found.sort(key=lambda m: (m[0], KINDS.index(m[1]), SIDES.index(m[2]) if m[2] else 0))
    return [Moment(*m) for m in found]

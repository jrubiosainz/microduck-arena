"""Events are data. The runner never knows which one it is running.

Adding the roller race or the hill climb is a file in arena/events/, not a code
change. Validation is strict and loud: a broken manifest must fail at load, not
halfway through someone's timed run.
"""

import tomllib
from dataclasses import dataclass
from pathlib import Path

from .constants import CMD_SIZE

EVENTS_DIR = Path(__file__).parent / "events"

RIGS = ("legs", "rollers")
METRICS = ("mean_finish_time",)
COURSE_KINDS = ("lane",)


class ManifestError(Exception):
    """A manifest is malformed, or names something that does not exist."""


@dataclass(frozen=True)
class Course:
    kind: str
    length_m: float
    width_m: float
    wall_height_m: float
    slope_deg: float


@dataclass(frozen=True)
class Start:
    keyframe: str
    settle_s: float
    joint_rad: float
    yaw_deg: float


@dataclass(frozen=True)
class Sweep:
    """The commanded speeds an event tries.

    A pinned command measures how well a policy tracks THAT speed, not how fast
    it can go: the reference walker scores 18.46 s at 0.25 m/s and 11.70 s at
    0.40, with a cliff just past its own optimum. Every policy has a different
    one, so the event sweeps and keeps the best.
    """

    lo: float
    hi: float
    step: float
    # How many of the scanned speeds get the full seed treatment. One seed can
    # flatter a speed that is actually flaky, so the best few are re-run over
    # every seed and the best MEAN wins.
    finalists: int

    def speeds(self) -> tuple[float, ...]:
        out, v = [], self.lo
        while v <= self.hi + 1e-9:
            out.append(round(v, 4))
            v += self.step
        return tuple(out)


@dataclass(frozen=True)
class Termination:
    fall_gravity_z: float
    fall_hold_s: float


@dataclass(frozen=True)
class Manifest:
    id: str
    title: str
    rig: str
    time_limit_s: float
    metric: str
    seeds: tuple[int, ...]
    course: Course
    start: Start
    termination: Termination
    sweep: Sweep
    # 13 values, held constant for the whole run. A tuple rather than an ndarray:
    # an ndarray would be mutable in place despite frozen=True, letting one bad
    # write corrupt the event for every later run in the same process — and
    # evaluate() runs five seeds in one process.
    command: tuple[float, ...]

    def command_at(self, vx: float) -> tuple[float, ...]:
        """This event's command, with the forward speed replaced.

        Only index 0 moves: lateral, yaw, head and body stay exactly as the
        event declared them, so a sweep changes how fast the robot is ASKED to
        go and nothing else about the task.
        """
        return (float(vx),) + tuple(self.command[1:])


def _require(raw: dict, key: str, where: str):
    if key not in raw:
        raise ManifestError(f"{where}: missing {key!r}")
    return raw[key]


def _command(raw: dict) -> tuple[float, ...]:
    vel = _require(raw, "vel", "[command]")
    head = _require(raw, "head", "[command]")
    body = _require(raw, "body", "[command]")
    for name, values, width in (("vel", vel, 3), ("head", head, 4), ("body", body, 6)):
        if len(values) != width:
            raise ManifestError(f"[command]: {name} must have {width} values, got {len(values)}")
    cmd = tuple(float(v) for v in (*vel, *head, *body))
    if len(cmd) != CMD_SIZE:
        raise ManifestError(f"[command]: assembles to {len(cmd)} values, expected {CMD_SIZE}")
    return cmd


def load_manifest(path: Path) -> Manifest:
    with open(path, "rb") as fh:
        raw = tomllib.load(fh)

    rig = _require(raw, "rig", str(path))
    if rig not in RIGS:
        raise ManifestError(f"{path}: unknown rig {rig!r}, expected one of {RIGS}")

    metric = _require(raw, "metric", str(path))
    if metric not in METRICS:
        raise ManifestError(f"{path}: unknown metric {metric!r}, expected one of {METRICS}")

    course_raw = _require(raw, "course", str(path))
    kind = _require(course_raw, "kind", "[course]")
    if kind not in COURSE_KINDS:
        raise ManifestError(f"{path}: unknown course kind {kind!r}, expected one of {COURSE_KINDS}")

    seeds = tuple(int(s) for s in _require(raw, "seeds", str(path)))
    if not seeds:
        raise ManifestError(f"{path}: seeds must not be empty")
    if len(set(seeds)) != len(seeds):
        raise ManifestError(f"{path}: duplicate seeds")

    start_raw = _require(raw, "start", str(path))
    perturb = _require(start_raw, "perturbation", "[start]")
    term_raw = _require(raw, "termination", str(path))
    sweep_raw = _require(raw, "sweep", str(path))
    sweep = Sweep(
        lo=float(_require(sweep_raw, "lo", "[sweep]")),
        hi=float(_require(sweep_raw, "hi", "[sweep]")),
        step=float(_require(sweep_raw, "step", "[sweep]")),
        finalists=int(_require(sweep_raw, "finalists", "[sweep]")),
    )
    if sweep.step <= 0:
        raise ManifestError(f"{path}: [sweep] step must be positive")
    if sweep.hi < sweep.lo:
        raise ManifestError(f"{path}: [sweep] hi must not be below lo")
    if sweep.finalists < 1:
        raise ManifestError(f"{path}: [sweep] finalists must be at least 1")

    return Manifest(
        id=_require(raw, "id", str(path)),
        title=_require(raw, "title", str(path)),
        rig=rig,
        time_limit_s=float(_require(raw, "time_limit_s", str(path))),
        metric=metric,
        seeds=seeds,
        course=Course(
            kind=kind,
            length_m=float(_require(course_raw, "length_m", "[course]")),
            width_m=float(_require(course_raw, "width_m", "[course]")),
            wall_height_m=float(_require(course_raw, "wall_height_m", "[course]")),
            slope_deg=float(_require(course_raw, "slope_deg", "[course]")),
        ),
        start=Start(
            keyframe=_require(start_raw, "keyframe", "[start]"),
            settle_s=float(_require(start_raw, "settle_s", "[start]")),
            joint_rad=float(_require(perturb, "joint_rad", "[start.perturbation]")),
            yaw_deg=float(_require(perturb, "yaw_deg", "[start.perturbation]")),
        ),
        termination=Termination(
            fall_gravity_z=float(_require(term_raw, "fall_gravity_z", "[termination]")),
            fall_hold_s=float(_require(term_raw, "fall_hold_s", "[termination]")),
        ),
        sweep=sweep,
        command=_command(_require(raw, "command", str(path))),
    )


def load_event(event_id: str) -> Manifest:
    path = EVENTS_DIR / f"{event_id}.toml"
    if not path.is_file():
        raise ManifestError(f"no such event: {event_id!r}")
    return load_manifest(path)


def all_events() -> list[Manifest]:
    return sorted(
        (load_manifest(p) for p in EVENTS_DIR.glob("*.toml")),
        key=lambda m: m.id,
    )

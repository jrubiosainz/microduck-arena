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
STATUSES = {"open", "planned"}
METRICS = ("mean_finish_time", "votes")
COURSE_KINDS = ("lane",)

# The voting page has exactly this many colours to hand a lane: LANE_CSS (and
# its 3D twin LANE_COLORS) in app/src/course.js. This is a second source of
# truth on purpose — the frontend has no manifest to read at build time — so a
# `ballot_max` above it is caught here, loudly, instead of shipping a ballot
# where two lanes wear the same colour and nobody can vote for either.
BALLOT_PALETTE_SIZE = 5


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
class Vote:
    """How an event collects ballots.

    Presence and `metric = "votes"` imply each other — `load_manifest` refuses
    either alone. An earlier draft kept them as separate axes, so a future
    challenge could be timed and voted at once; review found the cost instead:
    `routes_read._voted()` keyed on this section while `event_leaderboard`
    keyed on `metric`, so adding `[vote]` to a timed event's manifest alone
    would leave its board ranking on time while its podium silently re-ranked
    on votes. `ballot_max` is a target, not a promise — a ballot shrinks to
    `ballot_min` while the field is small, so a contest works from its second
    entry rather than its fourth.
    """

    ballot_min: int
    ballot_max: int
    window_days: int
    per_day: int


@dataclass(frozen=True)
class Manifest:
    id: str
    title: str
    rig: str
    # "open" or "planned". A planned event is real data — it appears on the
    # programme and has a course — but it cannot be raced yet, because its
    # physics is the sprint's and a time recorded under its name would be a
    # false result on a board other people read. Flipping it to "open" is what
    # makes it real, and is meant to happen alongside a real course.
    status: str
    # Where this sits on the programme. Declared rather than derived, because
    # neither alphabetical nor filesystem order is the order a person wants to
    # read a race card in. Lower is earlier; ties fall back to the title.
    order: int
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
    # None unless the event takes votes. The frontend reads this to decide
    # whether the VOTE badge and the vote button exist at all.
    vote: Vote | None = None

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

    order = int(raw.get("order", 100))
    status = raw.get("status", "open")
    if status not in STATUSES:
        raise ManifestError(f"{path}: unknown status {status!r}, expected one of {STATUSES}")
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

    vote_raw = raw.get("vote")
    vote = None
    if vote_raw is not None:
        vote = Vote(
            ballot_min=int(_require(vote_raw, "ballot_min", "[vote]")),
            ballot_max=int(_require(vote_raw, "ballot_max", "[vote]")),
            window_days=int(_require(vote_raw, "window_days", "[vote]")),
            per_day=int(_require(vote_raw, "per_day", "[vote]")),
        )
        if vote.ballot_min < 2:
            raise ManifestError(f"{path}: [vote] ballot_min must be at least 2")
        if vote.ballot_max < vote.ballot_min:
            raise ManifestError(f"{path}: [vote] ballot_max must not be below ballot_min")
        if vote.ballot_max > BALLOT_PALETTE_SIZE:
            raise ManifestError(
                f"{path}: [vote] ballot_max must not exceed {BALLOT_PALETTE_SIZE} "
                "(the voting page has only that many lane colours — see LANE_CSS "
                "in app/src/course.js)"
            )
        if vote.window_days < 1:
            raise ManifestError(f"{path}: [vote] window_days must be at least 1")
        if vote.per_day < 1:
            raise ManifestError(f"{path}: [vote] per_day must be at least 1")
    if metric == "votes" and vote is None:
        raise ManifestError(f"{path}: metric 'votes' needs a [vote] section to rank by")
    if vote is not None and metric != "votes":
        raise ManifestError(f"{path}: [vote] section needs metric = 'votes' to rank by")

    return Manifest(
        id=_require(raw, "id", str(path)),
        title=_require(raw, "title", str(path)),
        rig=rig,
        status=status,
        order=order,
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
        vote=vote,
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

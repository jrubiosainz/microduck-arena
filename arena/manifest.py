"""Events are data. The runner never knows which one it is running.

Adding the roller race or the hill climb is a file in arena/events/, not a code
change. Validation is strict and loud: a broken manifest must fail at load, not
halfway through someone's timed run.
"""

import tomllib
from dataclasses import dataclass
from pathlib import Path

from .constants import CMD_SIZE, CTRL_DT

EVENTS_DIR = Path(__file__).parent / "events"

RIGS = ("legs", "rollers")

# What KIND of event this is, for the front page's label. A race is timed over
# a course, a showcase is judged by vote rather than measured at all.
CATEGORIES = {"race", "showcase"}
METRICS = ("mean_finish_time", "votes")

# What an entry must be, in the policy manifest's own words
# (mjlab_microduck.publish.manifest.KINDS): `perpetual` runs until told
# otherwise, `episodic` ends itself. The Space refuses a policy whose
# manifest.json names another kind than its event's (arena/hub_fetch.py).
KINDS = ("episodic", "perpetual")

COURSE_KINDS = ("lane", "stage")

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
class Stage:
    """An open floor: no walls, no slope, no line to cross. A stage event plays
    each entry's own command timeline (arena/timeline.py) instead of racing it,
    with a troupe of up to `max_ducks` ducks placed on its floor."""

    # Depth along x (towards the audience), then width along y, in metres: the
    # floor the pages draw, and the one the placement rules keep every duck on.
    size_m: tuple[float, float]
    max_ducks: int
    kind: str = "stage"


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
    it can go: the reference walker is far slower at the sprint's declared
    0.25 m/s than at its own optimum, with a cliff just past that optimum. Every
    policy has a different one, so the event sweeps and keeps the best.
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
class Lights:
    """Red light, green light: the caller past the finish line counts with its
    back to the lanes, then turns round and watches them.

    The schedule is declared, not drawn: phase k is green for `green_s[k]`, then
    red for `red_s[k]`, and the cycle repeats until the time limit. It is the
    same on every seed, so one caller times every lane of a replay and a page
    can draw it from the event alone. Every duration is a whole number of control
    steps, so the light changes on a step and nowhere in between.

    While the light is red the duck is asked to stand still: the command's
    twist (forward, lateral and yaw) drops to zero, head and body stay as
    declared. The caller takes `turn_s` to turn round, and nothing a duck does
    then counts. From the moment it faces the lanes to the end of the red, a
    duck whose trunk strays more than `tolerance_m` across the floor from where
    it stood when the caller finished turning is caught: its run ends there,
    unfinished.
    """

    green_s: tuple[float, ...]
    red_s: tuple[float, ...]
    turn_s: float
    tolerance_m: float

    def to_dict(self) -> dict:
        return {"green_s": list(self.green_s), "red_s": list(self.red_s),
                "turn_s": self.turn_s, "tolerance_m": self.tolerance_m}


@dataclass(frozen=True)
class Steering:
    """A long lane's heading hold: the course keeps the duck pointed down it.

    No policy walks fifteen metres straight unaided. Asked for a yaw rate of
    zero, the reference walker's heading wanders tens of degrees within a few
    metres, and on a long lane that wander, not the task, decides who reaches
    the line. On a lane that declares this, every step the duck is asked to
    walk, the command's yaw rate (vel's third value) turns it toward the
    lane's centre line `lookahead_m` ahead:

        yaw rate = clip(gain * wrap(atan2(-y, lookahead_m) - yaw), ±max_yaw_rate)

    It is mjlab's heading command (`heading_control_stiffness`) with its target
    aimed down the lane rather than held fixed. The forward speed is still the
    sweep's, and a duck asked to stand (a red light) is asked to stand: no yaw
    rate either.
    """

    lookahead_m: float
    gain: float
    max_yaw_rate: float

    def to_dict(self) -> dict:
        return {"lookahead_m": self.lookahead_m, "gain": self.gain, "max_yaw_rate": self.max_yaw_rate}


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


CAMERA_KINDS = ("chase", "fixed")
# The sound sources a clip can draw on (app/src/clip/score.js). A name here is
# a function there; an event lists the ones it wants.
SOUND_SOURCES = ("crowd", "horn", "verdict")


@dataclass(frozen=True)
class ClipCamera:
    """Where the clip's camera stands.

    `chase` is the viewer's own camera — behind the leader, trackside, the
    side offset widening with the lanes — with its constants exposed. `fixed`
    is an absolute position and target, for events whose picture is a jump or
    a stand rather than a run down a lane.

    A chase that `track`s keeps its leader in the middle of the picture as it
    wanders across its lane, which a camera standing behind it needs: one off
    to the side sees the same wander as a step nearer or farther. One that
    `hold`s stops that many metres short of the finish line and watches its
    leader walk on to it, so that what stands past the line stays in frame.
    """

    kind: str = "chase"
    back: float = 0.35
    height: float = 0.34
    side: float | None = None  # None: the viewer's cameraSideOffset
    target_height: float = 0.12
    fov: float = 42.0
    track: bool = False
    hold: float | None = None  # None: the chase follows its leader to the line
    position: tuple[float, float, float] | None = None
    target: tuple[float, float, float] | None = None

    def to_dict(self) -> dict:
        if self.kind == "fixed":
            return {"kind": "fixed", "position": list(self.position),
                    "target": list(self.target), "fov": self.fov}
        return {"kind": "chase", "back": self.back, "height": self.height, "side": self.side,
                "target_height": self.target_height, "fov": self.fov,
                "track": self.track, "hold": self.hold}


@dataclass(frozen=True)
class ClipConfig:
    """How this event's clip is framed and scored. Every field has a default,
    so an event with no [clip] section renders as the sprint does.

    `speed` plays the tape that many times faster than life, a whole number so
    that every clip frame lands on a trace step: a race that runs for minutes
    is filmed whole, as a time-lapse. `tape_max_s` is still seconds of the race.
    """

    tape_max_s: float = 12.0
    sounds: tuple[str, ...] = SOUND_SOURCES
    camera: ClipCamera = ClipCamera()
    speed: int = 1

    def to_dict(self) -> dict:
        return {"tape_max_s": self.tape_max_s, "sounds": list(self.sounds),
                "camera": self.camera.to_dict(), "speed": self.speed}


@dataclass(frozen=True)
class Manifest:
    id: str
    title: str
    rig: str
    # "race" or "showcase". Presentation only: the front page
    # labels and colours a flyer by it. Nothing that scores a run may read it.
    category: str
    # "perpetual" or "episodic": the kind of policy this event races. Checked
    # against an entry's manifest.json; a policy's own contract, not a score input.
    kind: str
    # Where this sits on the programme. Declared rather than derived, because
    # neither alphabetical nor filesystem order is the order a person wants to
    # read a race card in. Lower is earlier; ties fall back to the title.
    order: int
    time_limit_s: float
    metric: str
    seeds: tuple[int, ...]
    course: Course | Stage
    start: Start
    termination: Termination
    # None on a stage, which plays the entry's timeline rather than a speed.
    sweep: Sweep | None
    # 13 values, held constant for the whole run. A tuple rather than an ndarray:
    # an ndarray would be mutable in place despite frozen=True, letting one bad
    # write corrupt the event for every later run in the same process — and
    # evaluate() runs five seeds in one process.
    command: tuple[float, ...]
    # None unless the event takes votes. The frontend reads this to decide
    # whether the VOTE badge and the vote button exist at all.
    vote: Vote | None = None
    clip: ClipConfig = ClipConfig()
    # None unless the event is played to a caller's red and green lights. A lane only.
    lights: Lights | None = None
    # None unless the lane holds the duck's heading for it. A lane only.
    steering: Steering | None = None

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


def _refuse_unknown(raw: dict, allowed: set[str], where: str) -> None:
    unknown = sorted(set(raw) - allowed)
    if unknown:
        raise ManifestError(f"{where}: unknown keys {unknown}")


def _triple(raw: dict, key: str, where: str) -> tuple[float, float, float]:
    values = _require(raw, key, where)
    if len(values) != 3:
        raise ManifestError(f"{where}: {key} must have 3 values, got {len(values)}")
    return tuple(float(v) for v in values)


def _camera(raw: dict | None, where: str) -> ClipCamera:
    if raw is None:
        return ClipCamera()
    kind = raw.get("kind", "chase")
    if kind not in CAMERA_KINDS:
        raise ManifestError(f"{where}: unknown camera kind {kind!r}, expected one of {CAMERA_KINDS}")
    if kind == "fixed":
        _refuse_unknown(raw, {"kind", "position", "target", "fov"}, where)
        if "position" not in raw or "target" not in raw:
            raise ManifestError(f"{where}: a fixed camera needs position and target")
        return ClipCamera(kind="fixed", position=_triple(raw, "position", where),
                          target=_triple(raw, "target", where), fov=float(raw.get("fov", 42.0)))
    _refuse_unknown(raw, {"kind", "back", "height", "side", "target_height", "fov", "track", "hold"},
                    where)
    default = ClipCamera()
    track = raw.get("track", default.track)
    if not isinstance(track, bool):
        raise ManifestError(f"{where}: track must be true or false, got {track!r}")
    hold = raw.get("hold")
    if hold is not None and (isinstance(hold, bool) or not isinstance(hold, (int, float)) or hold < 0):
        raise ManifestError(f"{where}: hold must be a distance of at least 0 m, got {hold!r}")
    return ClipCamera(
        back=float(raw.get("back", default.back)),
        height=float(raw.get("height", default.height)),
        side=None if raw.get("side", "auto") == "auto" else float(raw["side"]),
        target_height=float(raw.get("target_height", default.target_height)),
        fov=float(raw.get("fov", default.fov)),
        track=track,
        hold=None if hold is None else float(hold),
    )


def _clip(raw: dict | None, where: str, stage: bool = False) -> ClipConfig:
    if raw is None:
        return ClipConfig()
    _refuse_unknown(raw, {"tape_max_s", "sounds", "camera", "speed"}, where)
    tape = float(raw.get("tape_max_s", 12.0))
    if tape <= 0:
        raise ManifestError(f"{where}: tape_max_s must be positive")
    sounds = tuple(raw.get("sounds", SOUND_SOURCES))
    for name in sounds:
        if name not in SOUND_SOURCES:
            raise ManifestError(f"{where}: unknown sound source {name!r}, expected among {SOUND_SOURCES}")
    speed = raw.get("speed", 1)
    # bool first: TOML's true is a Python int, and would otherwise read as 1.
    if isinstance(speed, bool) or not isinstance(speed, int) or speed < 1:
        raise ManifestError(f"{where}: speed must be a whole number of at least 1, got {speed!r}")
    if stage and speed != 1:
        raise ManifestError(f"{where}: a performance is filmed in time with its voices, so its speed is 1")
    return ClipConfig(tape_max_s=tape, sounds=sounds, camera=_camera(raw.get("camera"), f"{where}.camera"),
                      speed=speed)


def _stage(raw: dict) -> Stage:
    size = _require(raw, "size_m", "[course]")
    # bool first: TOML's true is a Python int, and would otherwise read as 1.
    if not isinstance(size, list) or len(size) != 2 or not all(
        not isinstance(v, bool) and isinstance(v, (int, float)) and v > 0 for v in size
    ):
        raise ManifestError(
            f"[course]: size_m must be two positive numbers, depth along x then width along y, got {size!r}"
        )
    most = _require(raw, "max_ducks", "[course]")
    if isinstance(most, bool) or not isinstance(most, int) or most < 1:
        raise ManifestError(f"[course]: max_ducks must be a whole number of at least 1, got {most!r}")
    return Stage(size_m=(float(size[0]), float(size[1])), max_ducks=most)


def _number(value) -> bool:
    # bool first: TOML's true is a Python int, and would otherwise read as 1.
    return not isinstance(value, bool) and isinstance(value, (int, float))


def _whole_steps(seconds: float) -> bool:
    steps = seconds / CTRL_DT
    return abs(steps - round(steps)) < 1e-6


def _lights(raw: dict, path: Path) -> Lights:
    where = f"{path}: [lights]"
    if not isinstance(raw, dict):
        raise ManifestError(f"{where} must be a table")
    _refuse_unknown(raw, {"green_s", "red_s", "turn_s", "tolerance_m"}, "[lights]")
    phases = {}
    for key in ("green_s", "red_s"):
        values = _require(raw, key, "[lights]")
        if not isinstance(values, list) or not values or not all(_number(v) and v > 0 for v in values):
            raise ManifestError(f"{where} {key} must be a non-empty list of positive seconds, got {values!r}")
        if not all(_whole_steps(v) for v in values):
            raise ManifestError(f"{where} every {key} must be a whole number of {CTRL_DT:g} s control steps")
        phases[key] = tuple(float(v) for v in values)
    if len(phases["green_s"]) != len(phases["red_s"]):
        raise ManifestError(f"{where} green_s and red_s must have as many phases as each other")
    turn = _require(raw, "turn_s", "[lights]")
    if not _number(turn) or turn < 0 or not _whole_steps(turn):
        raise ManifestError(
            f"{where} turn_s must be zero or more, a whole number of {CTRL_DT:g} s control steps, got {turn!r}"
        )
    if turn >= min(phases["red_s"]):
        raise ManifestError(f"{where} turn_s must be shorter than every red_s, or the caller never looks")
    tolerance = _require(raw, "tolerance_m", "[lights]")
    if not _number(tolerance) or tolerance <= 0:
        raise ManifestError(f"{where} tolerance_m must be a positive distance, got {tolerance!r}")
    return Lights(green_s=phases["green_s"], red_s=phases["red_s"], turn_s=float(turn),
                  tolerance_m=float(tolerance))


def _steering(raw: dict, path: Path, command: tuple[float, ...]) -> Steering:
    where = f"{path}: [steering]"
    if not isinstance(raw, dict):
        raise ManifestError(f"{where} must be a table")
    _refuse_unknown(raw, {"lookahead_m", "gain", "max_yaw_rate"}, "[steering]")
    values = {}
    for key in ("lookahead_m", "gain", "max_yaw_rate"):
        value = _require(raw, key, "[steering]")
        if not _number(value) or value <= 0:
            raise ManifestError(f"{where} {key} must be a positive number, got {value!r}")
        values[key] = float(value)
    # The hold owns the yaw rate: a declared one would be overwritten on every step it walks.
    if command[2] != 0.0:
        raise ManifestError(f"{where} sets the yaw rate, so [command] vel's third value must be 0")
    return Steering(**values)


def _sweep(raw: dict, path: Path) -> Sweep:
    sweep = Sweep(
        lo=float(_require(raw, "lo", "[sweep]")),
        hi=float(_require(raw, "hi", "[sweep]")),
        step=float(_require(raw, "step", "[sweep]")),
        finalists=int(_require(raw, "finalists", "[sweep]")),
    )
    if sweep.step <= 0:
        raise ManifestError(f"{path}: [sweep] step must be positive")
    if sweep.hi < sweep.lo:
        raise ManifestError(f"{path}: [sweep] hi must not be below lo")
    if sweep.finalists < 1:
        raise ManifestError(f"{path}: [sweep] finalists must be at least 1")
    return sweep


def load_manifest(path: Path) -> Manifest:
    with open(path, "rb") as fh:
        raw = tomllib.load(fh)

    order = int(raw.get("order", 100))
    category = _require(raw, "category", str(path))
    if category not in CATEGORIES:
        raise ManifestError(
            f"{path}: unknown category {category!r}, expected one of {CATEGORIES}"
        )
    policy_kind = _require(raw, "kind", str(path))
    if policy_kind not in KINDS:
        raise ManifestError(f"{path}: unknown kind {policy_kind!r}, expected one of {KINDS}")
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

    if kind == "stage":
        _refuse_unknown(course_raw, {"kind", "size_m", "max_ducks"}, "[course]")
        if len(seeds) != 1:
            raise ManifestError(f"{path}: a stage plays one performance, so it declares exactly one seed")
        if "sweep" in raw:
            raise ManifestError(f"{path}: a stage plays each entry's timeline, so it takes no [sweep]")
        if "lights" in raw:
            raise ManifestError(f"{path}: a stage has no line to walk to, so it takes no [lights]")
        if "steering" in raw:
            raise ManifestError(f"{path}: a stage has no lane to hold a heading down, so it takes no [steering]")
        course, sweep = _stage(course_raw), None
    else:
        course = Course(
            kind=kind,
            length_m=float(_require(course_raw, "length_m", "[course]")),
            width_m=float(_require(course_raw, "width_m", "[course]")),
            wall_height_m=float(_require(course_raw, "wall_height_m", "[course]")),
            slope_deg=float(_require(course_raw, "slope_deg", "[course]")),
        )
        sweep = _sweep(_require(raw, "sweep", str(path)), path)

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

    command = _command(_require(raw, "command", str(path)))
    return Manifest(
        id=_require(raw, "id", str(path)),
        title=_require(raw, "title", str(path)),
        rig=rig,
        category=category,
        kind=policy_kind,
        order=order,
        time_limit_s=float(_require(raw, "time_limit_s", str(path))),
        metric=metric,
        seeds=seeds,
        course=course,
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
        command=command,
        vote=vote,
        clip=_clip(raw.get("clip"), "[clip]", stage=kind == "stage"),
        lights=_lights(raw["lights"], path) if "lights" in raw else None,
        steering=_steering(raw["steering"], path, command) if "steering" in raw else None,
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

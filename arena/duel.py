"""A tug of war: two policies on one model, a rope between their trunks, a pit between them.

A proposal, not an event. An event puts one policy on a course and ranks it by a
number it earns alone; a duel puts two on the same physics and asks which one is
still on its deck. So nothing here is on the programme, the boards or the store:
arena/duels/ is not arena/events/, and `arena duel` plays one from the shell.
docs/superpowers/specs/2026-10-21-tug-of-war-duel-design.md is the proposal: what
was measured, and the decisions it leaves open.

It is built from the engine's own parts and changes none of them. The model is
built the way a stage's is (arena.course.compile_stage): a rig's MJCF with its
servos as BAM motors, the second duck grafted on under its prefix. A bout opens
as every run does (arena.runner._start: training's reset, the perturbation, the
untimed settle) and steps the shared physics as a stage does. Only the decks, the
rope and the referee are new.

A duel is data, as an event is: arena/duels/<id>.toml, validated as strictly as a
manifest and refused with the same ManifestError.
"""

import math
import tomllib
import xml.etree.ElementTree as ET
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from itertools import combinations
from pathlib import Path

import mujoco
import numpy as np

from .constants import CTRL_DT, DEFAULT_POSE, JOINT_NAMES, TIMESTEP, TRACE_WIDTH
from .course import (
    SPAWN_HEIGHT_M,
    WALL_THICKNESS_M,
    _compiled,
    _motorized,
    _robot,
    _sub,
    _yaw_quat,
    duck_prefix,
)
from .manifest import KINDS, RIGS, ManifestError, Start, _command, _refuse_unknown, _require
from .runner import _reset_by_mujoco, _start

DUELS_DIR = Path(__file__).parent / "duels"

DECK_THICKNESS_M = 0.10

# Duck k stands on deck k: deck 0 at -x, deck 1 at +x. Each starts with its back to
# the pit, so walking straight on is pulling.
DECK_YAWS_DEG = (180.0, 0.0)

# MuJoCo's default limit impedance with its transition widened from 1 mm to 3 mm:
# the rope takes up its last few millimetres of slack rather than snapping taut.
ROPE_SOLIMP = (0.9, 0.95, 0.003, 0.5, 2.0)
ROPE_WIDTH_M = 0.004  # drawn only: a tendon collides with nothing

# How long a recorded bout runs on once a duck has dropped off its deck: about a
# third of a second takes a trunk from drop_m to the pit's floor, and the rest
# shows who is left standing. Watching only; the referee has already decided.
TAIL_S = 1.5


@dataclass(frozen=True)
class Decks:
    gap_m: float  # the pit, between the decks' inner edges
    length_m: float
    width_m: float
    wall_height_m: float  # 0 for no walls
    pit_depth_m: float


@dataclass(frozen=True)
class Rope:
    slack_m: float
    timeconst_s: float
    harness_height_m: float  # above each trunk's origin


@dataclass(frozen=True)
class Referee:
    drop_m: float
    margin_m: float


@dataclass(frozen=True)
class Duel:
    id: str
    title: str
    rig: str
    kind: str
    time_limit_s: float
    seeds: tuple[int, ...]
    # Read by arena.runner._start exactly as an event's is: the keyframe, the
    # settle and the perturbation. Of a manifest, _start reads nothing else but
    # its id, which names the random streams; a Duel has both, under those names.
    start: Start
    setback_m: float
    command: tuple[float, ...]
    decks: Decks
    rope: Rope
    referee: Referee

    @property
    def start_x_m(self) -> float:
        """How far from the middle of the pit each trunk starts."""
        return self.decks.gap_m / 2 + self.setback_m


def _number(raw: dict, key: str, where: str, *, zero: bool = False) -> float:
    """A finite number above zero, or at least zero where `zero` allows it."""
    value = _require(raw, key, where)
    # bool first: TOML's true is a Python int, and would otherwise read as 1.
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or value < 0
        or (value == 0 and not zero)
    ):
        need = "a number of at least 0" if zero else "a positive number"
        raise ManifestError(f"{where}: {key} must be {need}, got {value!r}")
    return float(value)


def _table(raw: dict, key: str, allowed: set[str], where: str, name: str) -> dict:
    table = _require(raw, key, where)
    if not isinstance(table, dict):
        raise ManifestError(f"{where}: {key} must be a table")
    _refuse_unknown(table, allowed, name)
    return table


def load_duel(path: Path) -> Duel:
    with open(path, "rb") as fh:
        raw = tomllib.load(fh)
    where = str(path)
    _refuse_unknown(
        raw,
        {"id", "title", "rig", "kind", "time_limit_s", "seeds",
         "command", "start", "decks", "rope", "referee"},
        where,
    )

    duel_id = _require(raw, "id", where)
    if not isinstance(duel_id, str) or not duel_id:
        raise ManifestError(f"{where}: id must be a name, got {duel_id!r}")
    rig = _require(raw, "rig", where)
    if rig not in RIGS:
        raise ManifestError(f"{where}: unknown rig {rig!r}, expected one of {RIGS}")
    kind = _require(raw, "kind", where)
    if kind not in KINDS:
        raise ManifestError(f"{where}: unknown kind {kind!r}, expected one of {KINDS}")
    seeds = _require(raw, "seeds", where)
    if not isinstance(seeds, list) or not seeds or not all(
        not isinstance(s, bool) and isinstance(s, int) for s in seeds
    ):
        raise ManifestError(f"{where}: seeds must be a list of whole numbers, got {seeds!r}")
    if len(set(seeds)) != len(seeds):
        raise ManifestError(f"{where}: duplicate seeds")

    start_raw = _table(raw, "start", {"keyframe", "settle_s", "setback_m", "perturbation"},
                       where, "[start]")
    perturb = _table(start_raw, "perturbation", {"joint_rad", "yaw_deg"},
                     "[start]", "[start.perturbation]")
    command_raw = _table(raw, "command", {"vel", "head", "body"}, where, "[command]")
    decks_raw = _table(raw, "decks", {"gap_m", "length_m", "width_m", "wall_height_m",
                                      "pit_depth_m"}, where, "[decks]")
    rope_raw = _table(raw, "rope", {"slack_m", "timeconst_s", "harness_height_m"}, where, "[rope]")
    referee_raw = _table(raw, "referee", {"drop_m", "margin_m"}, where, "[referee]")

    decks = Decks(
        gap_m=_number(decks_raw, "gap_m", "[decks]"),
        length_m=_number(decks_raw, "length_m", "[decks]"),
        width_m=_number(decks_raw, "width_m", "[decks]"),
        wall_height_m=_number(decks_raw, "wall_height_m", "[decks]", zero=True),
        pit_depth_m=_number(decks_raw, "pit_depth_m", "[decks]"),
    )
    rope = Rope(
        slack_m=_number(rope_raw, "slack_m", "[rope]", zero=True),
        timeconst_s=_number(rope_raw, "timeconst_s", "[rope]"),
        harness_height_m=_number(rope_raw, "harness_height_m", "[rope]", zero=True),
    )
    referee = Referee(
        drop_m=_number(referee_raw, "drop_m", "[referee]"),
        margin_m=_number(referee_raw, "margin_m", "[referee]", zero=True),
    )
    setback = _number(start_raw, "setback_m", "[start]")
    if setback >= decks.length_m:
        raise ManifestError(f"{where}: [start] setback_m must be shorter than the decks, "
                            "or a duck starts off its own")
    if rope.timeconst_s < 2 * TIMESTEP:
        raise ManifestError(f"{where}: [rope] timeconst_s must be at least two physics steps "
                            f"({2 * TIMESTEP} s): MuJoCo quietly raises a shorter one to that")
    if decks.pit_depth_m <= referee.drop_m + SPAWN_HEIGHT_M:
        raise ManifestError(f"{where}: [decks] pit_depth_m must be deeper than [referee] drop_m "
                            f"plus a standing duck ({SPAWN_HEIGHT_M} m), or a duck could stand "
                            "in the pit unseen")

    keyframe = _require(start_raw, "keyframe", "[start]")
    if not isinstance(keyframe, str) or not keyframe:
        raise ManifestError(f"{where}: [start] keyframe must be a name, got {keyframe!r}")
    return Duel(
        id=duel_id,
        title=_require(raw, "title", where),
        rig=rig,
        kind=kind,
        time_limit_s=_number(raw, "time_limit_s", where),
        seeds=tuple(seeds),
        start=Start(
            keyframe=keyframe,
            settle_s=_number(start_raw, "settle_s", "[start]", zero=True),
            joint_rad=_number(perturb, "joint_rad", "[start.perturbation]", zero=True),
            yaw_deg=_number(perturb, "yaw_deg", "[start.perturbation]", zero=True),
        ),
        setback_m=setback,
        command=_command(command_raw),
        decks=decks,
        rope=rope,
        referee=referee,
    )


def load_duel_by_id(duel_id: str) -> Duel:
    path = DUELS_DIR / f"{duel_id}.toml"
    if not path.is_file():
        raise ManifestError(f"no such duel: {duel_id!r}")
    return load_duel(path)


Vec3 = tuple[float, float, float]


def deck_boxes(decks: Decks) -> list[tuple[str, Vec3, Vec3]]:
    """The decks, then their walls, as `(name, pos, half_extents)`, the deck tops at z = 0.

    Deck k is duck k's: deck 0 at -x, deck 1 at +x, the pit between their inner
    edges. As arena.course.wall_boxes is, one function for the physics and for
    whatever draws it.
    """
    half_len = decks.length_m / 2
    x = decks.gap_m / 2 + half_len
    half_t = DECK_THICKNESS_M / 2
    boxes = [
        (f"deck{k}", (side * x, 0.0, -half_t), (half_len, decks.width_m / 2, half_t))
        for k, side in enumerate((-1, 1))
    ]
    if decks.wall_height_m > 0:
        y = decks.width_m / 2 + WALL_THICKNESS_M / 2
        half_wall = (half_len, WALL_THICKNESS_M / 2, decks.wall_height_m / 2)
        boxes += [
            (f"deck{k}_wall{j}", (side * x, wall_y, half_wall[2]), half_wall)
            for k, side in enumerate((-1, 1))
            for j, wall_y in enumerate((y, -y))
        ]
    return boxes


def _duel_xml(duel: Duel) -> tuple[str, dict[str, bytes]]:
    """Duck 0's MJCF, with the physics step, the pit's floor, the decks and a keyframe."""
    root, assets = _robot(duel.rig)
    _sub(root, "option", timestep=TIMESTEP)
    worldbody = root.find("worldbody")
    course = _sub(worldbody, "body", name="course")
    _sub(course, "geom", name="floor", type="plane", size="0 0 0.05",
         pos=f"0 0 {-duel.decks.pit_depth_m}")
    for name, pos, size in deck_boxes(duel.decks):
        _sub(course, "geom", name=name, type="box",
             pos=" ".join(str(v) for v in pos), size=" ".join(str(v) for v in size))

    # Every joint in document order, as arena.course._inject_keyframe writes it; where
    # each duck stands is set once both are in the model (compile_duel).
    pose_by_name = dict(zip(JOINT_NAMES, DEFAULT_POSE))
    joints = [pose_by_name.get(j.get("name"), 0.0) for j in worldbody.iter("joint")]
    _sub(
        _sub(root, "keyframe"),
        "key",
        name=duel.start.keyframe,
        qpos=" ".join(str(v) for v in (0.0, 0.0, SPAWN_HEIGHT_M, 1.0, 0.0, 0.0, 0.0, *joints)),
        ctrl=" ".join("0.0" for _ in JOINT_NAMES),
    )
    return ET.tostring(root, encoding="unicode"), assets


def _free(model, k: int) -> int:
    """The qpos address of duck k's trunk: its position, then its quaternion."""
    trunk = model.body(f"{duck_prefix(k)}trunk_base").id
    return int(model.jnt_qposadr[model.body_jntadr[trunk]])


def compile_duel(duel: Duel) -> mujoco.MjModel:
    """Two ducks back to back across the pit, a rope between their harnesses.

    Duck 0 is its rig's MJCF with the servos as motors, as a troupe's first duck
    is (arena.course.compile_stage); duck 1 is the same rig grafted on under its
    prefix. The rope is a tendon from one harness site to the other, limited to
    their distance at the start plus the slack: slack while the ducks close in, a
    cap as soon as either walks away. The keyframe holds each duck on its deck,
    standing in the default pose.
    """
    spec = _motorized(*_duel_xml(duel))
    root, assets = _robot(duel.rig)
    robot = _motorized(ET.tostring(root, encoding="unicode"), assets)
    x = duel.start_x_m
    frame = spec.worldbody.add_frame(pos=[x, 0.0, 0.0], quat=_yaw_quat(DECK_YAWS_DEG[1]))
    spec.attach(robot, prefix=duck_prefix(1), frame=frame)

    for k in range(2):
        spec.body(f"{duck_prefix(k)}trunk_base").add_site(
            name=f"{duck_prefix(k)}harness", pos=[0.0, 0.0, duel.rope.harness_height_m]
        )
    rope = spec.add_tendon(
        name="rope",
        limited=True,
        range=[0.0, 2 * x + duel.rope.slack_m],
        solref_limit=[duel.rope.timeconst_s, 1.0],
        solimp_limit=list(ROPE_SOLIMP),
        width=ROPE_WIDTH_M,
    )
    for k in range(2):
        rope.wrap_site(f"{duck_prefix(k)}harness")

    model = _compiled(spec)
    pose = model.key_qpos[model.key(duel.start.keyframe).id]
    for k, (start_x, yaw_deg) in enumerate(zip((-x, x), DECK_YAWS_DEG)):
        free = _free(model, k)
        pose[free : free + 7] = [start_x, 0.0, SPAWN_HEIGHT_M, *_yaw_quat(yaw_deg)]
        for name, angle in zip(JOINT_NAMES, DEFAULT_POSE):
            pose[model.joint(duck_prefix(k) + name).qposadr[0]] = angle
    return model


@dataclass(frozen=True)
class Bout:
    """How one bout ended, by deck: duck k stood on deck k."""

    seed: int
    winner: int | None  # the deck whose duck won, or None for a draw
    end: str  # "pit" | "bell" | "void"
    time_s: float
    # The rope's middle along x when it ended, below 0 on deck 0's side. None when
    # the simulation diverged, which leaves nothing to measure.
    rope_mid_m: float | None


def _rope_mid(data, sites: Sequence[int]) -> float:
    return float(sum(data.site_xpos[site][0] for site in sites) / 2)


def _ahead(rope_mid_m: float, margin_m: float) -> int | None:
    """The deck the rope's middle has been pulled towards by more than the margin."""
    if rope_mid_m < -margin_m:
        return 0
    if rope_mid_m > margin_m:
        return 1
    return None


def _diverged(data) -> bool:
    return _reset_by_mujoco(data) or not np.all(np.isfinite(data.qpos))


def _frame(sim) -> np.ndarray:
    """This control step of both ducks, (2, TRACE_WIDTH), as a run's trace keeps it."""
    frame = np.empty((len(sim.ducks), TRACE_WIDTH), dtype=np.float32)
    sim.record(frame)
    return frame


def _opening(duel: Duel, model, policies: Sequence, seed: int):
    """Every run's opening (arena.runner._start), both ducks asked to stand still
    through the settle: the simulation where the clock starts, and the settle's
    frames, (2, settle steps + 1, TRACE_WIDTH)."""
    if len(policies) != 2:
        raise ValueError(f"a bout takes two policies, got {len(policies)}")
    still = np.asarray((0.0, 0.0, 0.0) + duel.command[3:], dtype=np.float64)
    return _start(duel, model, policies, DECK_YAWS_DEG, seed, [still, still])


def _referee(duel: Duel, sim, seed: int, frames: list | None = None) -> Bout:
    """The timed bout, from where _opening left `sim`. With `frames`, every step the
    referee judges is appended to it (_frame's): reading the physics writes none of
    it, so the bout is the same recorded or not. A void bout's last step is not
    among them — it is MuJoCo's reset pose, not the bout."""
    pull = np.asarray(duel.command, dtype=np.float64)
    model, data = sim.model, sim.data
    sites = [model.site(f"{duck_prefix(k)}harness").id for k in range(2)]
    heights = [duck.adr.free + 2 for duck in sim.ducks]
    steps = round(duel.time_limit_s / CTRL_DT)
    for step in range(steps):
        sim.step([pull, pull])
        time_s = (step + 1) * CTRL_DT
        if _diverged(data):
            return Bout(seed, None, "void", time_s, None)
        if frames is not None:
            frames.append(_frame(sim))
        fell = [data.qpos[z] < -duel.referee.drop_m for z in heights]
        if all(fell):
            return Bout(seed, None, "pit", time_s, _rope_mid(data, sites))
        if any(fell):
            still_on_deck = 1 if fell[0] else 0
            return Bout(seed, still_on_deck, "pit", time_s, _rope_mid(data, sites))
    rope_mid = _rope_mid(data, sites)
    return Bout(seed, _ahead(rope_mid, duel.referee.margin_m), "bell", steps * CTRL_DT, rope_mid)


def play_bout(duel: Duel, model, policies: Sequence, seed: int) -> Bout:
    """One bout on `model` (compile_duel's): policies[k] on deck k, from `seed`'s start.

    The opening is every run's (arena.runner._start), both ducks asked to stand
    still through the settle; from the first timed step both are asked the duel's
    command. The referee looks after every control step: a simulation MuJoCo had
    to reset ends the bout void, a trunk drop_m below the decks loses it (two at
    once is a draw), and the bell gives it to whoever has pulled the rope's middle
    their way by more than the margin.
    """
    sim, _ = _opening(duel, model, policies, seed)
    return _referee(duel, sim, seed)


@dataclass(frozen=True, eq=False)
class Recorded:
    """A bout as a replay plays it: how it ended, and both ducks' frames, by deck."""

    bout: Bout
    settle: np.ndarray  # (2, settle steps + 1, TRACE_WIDTH): the untimed settle, as a run's
    # (2, frames, TRACE_WIDTH): every step the referee judged, a frame each, so the
    # bout was decided on frame round(bout.time_s / CTRL_DT) - 1; then the tail.
    trace: np.ndarray


def record_bout(duel: Duel, model, policies: Sequence, seed: int, tail_s: float = TAIL_S) -> Recorded:
    """play_bout's bout, recorded, and run on for tail_s once a duck has dropped off
    its deck: both still asked to pull, so a replay shows the loser land in the pit
    and what becomes of the winner on the other end of the rope. The tail stops
    early if the simulation diverges, and a bout the bell or a divergence ended has
    none."""
    sim, settle = _opening(duel, model, policies, seed)
    frames: list[np.ndarray] = []
    bout = _referee(duel, sim, seed, frames)
    if bout.end == "pit":
        pull = np.asarray(duel.command, dtype=np.float64)
        for _ in range(round(tail_s / CTRL_DT)):
            sim.step([pull, pull])
            if _diverged(sim.data):
                break
            frames.append(_frame(sim))
    if not frames:
        return Recorded(bout, settle, np.empty((2, 0, TRACE_WIDTH), dtype=np.float32))
    return Recorded(bout, settle, np.stack(frames, axis=1))


@dataclass(frozen=True)
class Played:
    """One bout of a match, and which of the match's two policies stood on deck 0."""

    bout: Bout
    deck0: int  # 0: A on deck 0 and B on deck 1; 1: the other way round

    @property
    def winner(self) -> int | None:
        """The policy that won, as the match numbers them (0 is A), or None for a draw."""
        if self.bout.winner is None:
            return None
        return self.bout.winner if self.deck0 == 0 else 1 - self.bout.winner


@dataclass(frozen=True)
class Match:
    bouts: tuple[Played, ...]

    @property
    def points(self) -> tuple[float, float]:
        """A's and B's: a won bout is a point, a drawn one half a point each. A void
        bout is a draw: nobody can say whose it was."""
        a = sum(1.0 if p.winner == 0 else 0.5 if p.winner is None else 0.0 for p in self.bouts)
        return a, len(self.bouts) - a


def play_match(duel: Duel, a, b, model=None) -> Match:
    """A against B: every seed twice, the policies swapping decks between the two, so
    neither keeps one deck's start perturbation or servo delays."""
    model = compile_duel(duel) if model is None else model
    return Match(tuple(
        Played(play_bout(duel, model, (a, b) if deck0 == 0 else (b, a), seed), deck0)
        for seed in duel.seeds
        for deck0 in (0, 1)
    ))


def record_match(duel: Duel, a, b, model=None) -> tuple[Match, tuple[Recorded, ...]]:
    """play_match's match, and every bout of it recorded (record_bout's), in its order."""
    model = compile_duel(duel) if model is None else model
    bouts = [
        (record_bout(duel, model, (a, b) if deck0 == 0 else (b, a), seed), deck0)
        for seed in duel.seeds
        for deck0 in (0, 1)
    ]
    return Match(tuple(Played(r.bout, deck0) for r, deck0 in bouts)), tuple(r for r, _ in bouts)


def round_robin(duel: Duel, policies: Sequence) -> dict[tuple[int, int], Match]:
    """Every pair once: (i, j) is policies[i] as A against policies[j] as B, i < j."""
    model = compile_duel(duel)
    return {
        (i, j): play_match(duel, policies[i], policies[j], model)
        for i, j in combinations(range(len(policies)), 2)
    }


@dataclass(frozen=True)
class Standing:
    name: str
    won: int
    drawn: int
    lost: int

    @property
    def points(self) -> float:
        return self.won + self.drawn / 2


def standings(names: Sequence[str], matches: Mapping[tuple[int, int], Match]) -> list[Standing]:
    """The table, counted bout by bout: most points first, then most wins, then by name."""
    tally = [[0, 0, 0] for _ in names]
    for (i, j), match in matches.items():
        for played in match.bouts:
            if played.winner is None:
                tally[i][1] += 1
                tally[j][1] += 1
            else:
                won, lost = (i, j) if played.winner == 0 else (j, i)
                tally[won][0] += 1
                tally[lost][2] += 1
    table = [Standing(name, *counts) for name, counts in zip(names, tally)]
    return sorted(table, key=lambda s: (-s.points, -s.won, s.name))

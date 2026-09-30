"""The challenges a microduck-challenges checkout holds, read from each folder's challenge.toml.

The workshop edits two things in that file — `[recipe]` and each
`[params.<name>].value` — and edits them in place, line by line: the comments
and the layout are the author's explanation of the knobs, and a user reads the
same file in an editor. The Arena never imports the challenge's Python.
"""

import re
import tomllib
from dataclasses import dataclass
from pathlib import Path

from ..manifest import ManifestError, load_event

PACKAGE = Path("src") / "microduck_challenges"
RECIPE = ("num_envs", "max_iterations", "seed")

_SECTION = re.compile(r"^\s*\[([^\]]+)\]")
_ASSIGN = re.compile(r"^(\s*(\w+)\s*=\s*)([^#\n]*?)(\s*(?:#.*)?)$")


class ChallengeError(ValueError):
    """A challenge.toml the workshop cannot use, or a value it will not write."""


@dataclass(frozen=True)
class Knob:
    name: str
    label: str
    value: float
    min: float
    max: float


@dataclass(frozen=True)
class Challenge:
    folder: str  # e.g. "sprint_2m"; also the experiment folder under logs/rsl_rl/
    toml: Path
    event: str
    task: str
    kind: str
    recipe: dict[str, int]
    knobs: tuple[Knob, ...]


def read_challenge(toml: Path) -> Challenge:
    try:
        table = tomllib.loads(toml.read_text())  # a syntax error is a ValueError too
        return Challenge(
            folder=toml.parent.name,
            toml=toml,
            event=str(table["event"]),
            task=str(table["task"]),
            kind=str(table["kind"]),
            recipe={key: int(table["recipe"][key]) for key in RECIPE},
            knobs=tuple(
                Knob(name, str(k["label"]), float(k["value"]), float(k["min"]), float(k["max"]))
                for name, k in table.get("params", {}).items()
            ),
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise ChallengeError(
            f"{toml}: missing or unreadable {exc} — the workshop needs event, task, kind, "
            f"[recipe] {', '.join(RECIPE)}, and a label, value, min and max for each knob"
        ) from exc


def open_challenges(root: Path) -> list[Challenge]:
    """The checkout's challenges whose event is open on this Arena, in folder order."""
    found = []
    for toml in sorted((root / PACKAGE).glob("*/challenge.toml")):
        challenge = read_challenge(toml)
        try:
            is_open = load_event(challenge.event).status == "open"
        except ManifestError:
            is_open = False  # an event this Arena version does not have
        if is_open:
            found.append(challenge)
    return found


def write_values(challenge: Challenge, recipe: dict[str, int], params: dict[str, float]) -> bool:
    """Write recipe entries and knob values into challenge.toml. True when the file changed.

    Every value is checked before anything is written: recipe numbers at least 1
    (a seed may be 0), a knob within its own min and max.
    """
    wanted: dict[tuple[str, str], str] = {}
    for key, value in recipe.items():
        if key not in RECIPE:
            raise ChallengeError(f"{key!r} is not a recipe entry; the recipe is {', '.join(RECIPE)}")
        floor = 0 if key == "seed" else 1
        if int(value) < floor:
            raise ChallengeError(f"{key} must be at least {floor}, not {value}")
        wanted[("recipe", key)] = str(int(value))
    knobs = {knob.name: knob for knob in challenge.knobs}
    for name, value in params.items():
        knob = knobs.get(name)
        if knob is None:
            raise ChallengeError(f"{name!r} is not a knob of {challenge.event}")
        if not knob.min <= float(value) <= knob.max:
            raise ChallengeError(f"{knob.label} must be between {knob.min:g} and {knob.max:g}, not {value:g}")
        wanted[(f"params.{name}", "value")] = repr(float(value))
    text = challenge.toml.read_text()
    edited = _set(text, wanted)
    if edited == text:
        return False
    challenge.toml.write_text(edited)
    return True


def _set(text: str, wanted: dict[tuple[str, str], str]) -> str:
    section, lines, todo = None, [], dict(wanted)
    for line in text.splitlines(keepends=True):
        body = line.rstrip("\n")
        if header := _SECTION.match(body):
            section = header.group(1).strip()
        elif (assign := _ASSIGN.match(body)) and (section, assign.group(2)) in todo:
            line = assign.group(1) + todo.pop((section, assign.group(2))) + assign.group(4) + line[len(body):]
        lines.append(line)
    if todo:
        raise ChallengeError(f"challenge.toml has no line for {sorted(todo)}")
    return "".join(lines)

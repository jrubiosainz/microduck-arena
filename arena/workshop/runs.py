"""Training runs on disk: every logs/rsl_rl/<experiment>/<stamp>_<name>/ holding a provenance.json.

Discovered, never kept in a ledger of the workshop's own: a run trained from a
shell, or pulled back from an HF job, is found exactly like one the workshop
launched, and restarting the workshop loses nothing.
"""

import json
import re
from dataclasses import dataclass
from pathlib import Path

from . import eventfile

LOGS = Path("logs") / "rsl_rl"
REWARD = "Train/mean_reward"
_STAMPED = re.compile(r"^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_(.+)$")
_CHECKPOINT = re.compile(r"^model_(\d+)\.pt$")


@dataclass(frozen=True)
class Run:
    id: str  # the directory's name, <YYYY-MM-DD_HH-MM-SS>_<name>
    path: Path
    name: str  # what --agent.run-name said
    provenance: dict
    checkpoints: tuple[int, ...]  # iterations that have a model_<N>.pt, in order


def _read(path: Path) -> Run | None:
    try:
        provenance = json.loads((path / "provenance.json").read_text())
    except ValueError:
        return None  # still being written by a pull: it will be whole next time
    stamped = _STAMPED.match(path.name)
    checkpoints = sorted(int(m.group(1)) for f in path.iterdir() if (m := _CHECKPOINT.match(f.name)))
    return Run(path.name, path, stamped.group(1) if stamped else path.name, provenance, tuple(checkpoints))


def find_runs(root: Path, task: str) -> list[Run]:
    """This task's runs, newest first (the directory names start with their start time)."""
    runs = (_read(found.parent) for found in (root / LOGS).glob("*/*/provenance.json"))
    return sorted((r for r in runs if r and r.provenance.get("task") == task), key=lambda r: r.id, reverse=True)


def find_run(root: Path, task: str, run_id: str) -> Run | None:
    return next((r for r in find_runs(root, task) if r.id == run_id), None)


def curve(run: Run, tag: str = REWARD) -> list[tuple[int, float]]:
    """The run's `tag` over its steps, from every TensorBoard file in it."""
    points = []
    for events in sorted(run.path.glob("events.out.tfevents.*")):
        points += eventfile.scalars(events, tag)
    return sorted(points)

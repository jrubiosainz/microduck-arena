"""Every checkpoint, evaluated: exported as `publish` would, then raced with the Arena's own evaluator.

`publish --run … --dry-run` is the exporter: it bakes the observation normaliser in and checks the
61 → 14 shape exactly as the real publish will. `--allow-dirty` because an evaluation publishes
nothing. `arena.evaluate` is the code the Space runs, on this machine's MuJoCo: the score is
indicative — only the Space times an entry, and replays drift apart between machines after a few
seconds.

A worker evaluates every checkpoint of the open challenges' runs, one at a time (the export always
stages in the same ./publish-workshop-evaluation/): the newest run first, its checkpoints in order,
so a training's tickets fill in as it goes. A result is stored next to its checkpoint, per Arena
runner version, trace included, so a page replays it at once. A checkpoint that cannot be measured
— a failed export, a policy that does not load, a race that breaks — is stored as a failure, with the
checkpoint file's modification time, and tried again only once that file changes. A checkpoint file
younger than FRESH_S waits: a local training may still be writing it.
"""

import base64
import json
import os
import shutil
import time

from ..constants import RUNNER_VERSION
from ..evaluate import evaluate
from ..manifest import load_event
from ..policy import load_policy
from .runs import find_runs
from .shell import uv_run

NAME = "workshop-evaluation"
FRESH_S = 30.0
IDLE_S = 5.0


class EvaluationError(RuntimeError):
    """The export or the race failed; the message is the whole output."""


def _path(run, n: int):
    return run.path / "workshop" / f"model_{n}.json"


def _mtime(run, n: int) -> float:
    return (run.path / f"model_{n}.pt").stat().st_mtime


def stored(run, n: int) -> dict | None:
    """The stored evaluation of checkpoint n on this runner version — a result, or a failure still
    true of the checkpoint file as it is — or None: never evaluated, stale, or unreadable."""
    try:
        body = json.loads(_path(run, n).read_text())
    except (OSError, ValueError):
        return None  # missing, or corrupt (a crash mid-write): as good as never evaluated
    if not isinstance(body, dict) or body.get("runner_version") != RUNNER_VERSION:
        return None
    if "error" in body:
        try:
            return body if body.get("mtime") == _mtime(run, n) else None
        except OSError:
            return None
    return body


def summary(run) -> dict[int, dict]:
    """What each evaluated checkpoint of `run` shows on its ticket, without its trace."""
    keep = ("score", "seeds_finished", "seeds_total", "command_vx")
    found = {}
    for n in run.checkpoints:
        body = stored(run, n)
        if body is not None:
            found[n] = {"status": "failed"} if "error" in body else {"status": "evaluated", **{k: body[k] for k in keep}}
    return found


def _write(run, n: int, body: dict) -> None:
    """Atomically: a reader (a ticket, a replay) must never see a half-written file."""
    path = _path(run, n)
    path.parent.mkdir(exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(body))
    os.replace(tmp, path)


def _measure(root, run, n: int, event_id: str) -> dict:
    onnx = _path(run, n).with_suffix(".onnx")
    out = root / f"publish-{NAME}"
    # A previous, failed export may have left this: never move whatever happens to be sitting in it
    # into a checkpoint's slot as if this run had just produced it.
    shutil.rmtree(out, ignore_errors=True)
    done = uv_run(
        root, "publish", "--run", str(run.path), "--checkpoint", str(n),
        "--repo", f"local/microduck-{NAME}", "--name", NAME, "--dry-run", "--allow-dirty",
    )
    if done.returncode != 0:
        shutil.rmtree(out, ignore_errors=True)
        raise EvaluationError(done.stdout + done.stderr)
    onnx.parent.mkdir(exist_ok=True)
    shutil.move(out / "policy.onnx", onnx)
    shutil.rmtree(out, ignore_errors=True)
    result = evaluate(load_event(event_id), load_policy(onnx))
    return {
        "checkpoint": n,
        "score": result.score,
        "command_vx": result.command_vx,
        "seeds_finished": result.seeds_finished,
        "seeds_total": len(result.per_seed),
        "per_seed": [{"seed": s.seed, "status": s.status, "time_s": s.time_s} for s in result.per_seed],
        "trace_seed": result.trace_seed,
        "trace_b64": base64.b64encode(result.trace.astype("<f4").tobytes()).decode("ascii"),
        "runner_version": result.runner_version,
    }


def _evaluate(root, run, n: int, event_id: str) -> None:
    """Measure checkpoint n and store what came of it: its result, or why there is none."""
    mtime = _mtime(run, n)
    try:
        body = _measure(root, run, n, event_id)
    except Exception as exc:  # noqa: BLE001 — stored, so the worker moves on to the next checkpoint
        error = str(exc) if isinstance(exc, EvaluationError) else f"{type(exc).__name__}: {exc}"
        body = {"checkpoint": n, "error": error, "mtime": mtime, "runner_version": RUNNER_VERSION}
    _write(run, n, body)


def next_checkpoint(root, challenges, now: float | None = None):
    """(challenge, run, n) to evaluate next, or None: the newest run first, its checkpoints in order."""
    now = time.time() if now is None else now
    runs = sorted(((c, r) for c in challenges for r in find_runs(root, c.task)), key=lambda cr: cr[1].id, reverse=True)
    for challenge, run in runs:
        for n in run.checkpoints:
            if stored(run, n) is not None:
                continue
            try:
                if now - _mtime(run, n) < FRESH_S:
                    continue
            except OSError:
                continue  # gone while we looked
            return challenge, run, n
    return None


def evaluate_next(ws) -> bool:
    """Evaluate one checkpoint; False when none is waiting."""
    found = next_checkpoint(ws.root, list(ws.challenges.values()))
    if found is None:
        return False
    challenge, run, n = found
    _evaluate(ws.root, run, n, challenge.event)
    return True


def evaluate_forever(ws) -> None:
    while not ws.stopping.is_set():
        try:
            if not evaluate_next(ws):
                ws.stopping.wait(IDLE_S)
        except Exception as exc:  # noqa: BLE001 — one bad run must not stop the worker for the others
            print(f"[workshop] evaluation: {type(exc).__name__}: {exc}", flush=True)
            ws.stopping.wait(IDLE_S)

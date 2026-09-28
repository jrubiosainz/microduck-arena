"""Test a checkpoint: export it as `publish` would, then race it with the Arena's own evaluator.

`publish --run … --dry-run` is the exporter: it bakes the observation normaliser
in and checks the 61 → 14 shape exactly as the real publish will. `--allow-dirty`
because a trial publishes nothing. `arena.evaluate` is the code the Space runs,
on this machine's MuJoCo: the score is indicative — only the Space times an
entry, and replays drift apart between machines after a few seconds.

Results are cached next to the checkpoint, per Arena runner version.
"""

import base64
import json
import os
import shutil
import threading

from ..constants import RUNNER_VERSION
from ..evaluate import evaluate
from ..manifest import load_event
from ..policy import load_policy
from .shell import uv_run

NAME = "workshop-trial"
# One trial at a time, start to finish: the dry run always writes the same
# ./publish-workshop-trial/, and holding this around the evaluation too (not just the
# export) means a second request for the checkpoint a trial is already measuring waits
# for it and returns its cached result, instead of exporting and evaluating it again.
_ONE_TRIAL = threading.Lock()


class TrialError(RuntimeError):
    """The export failed; the message is its whole output."""


def _cache(run, checkpoint: int):
    return run.path / "workshop" / f"model_{checkpoint}.json"


def _cached(run, checkpoint: int) -> dict | None:
    path = _cache(run, checkpoint)
    try:
        body = json.loads(path.read_text())
    except (OSError, ValueError):
        # Missing, or corrupt (a crash mid-write, say): as good as never tested. `tested()`
        # runs for every run on every GET /runs, so one bad file must not break the listing.
        return None
    return body if body.get("runner_version") == RUNNER_VERSION else None


def _write_cache(run, checkpoint: int, body: dict) -> None:
    """Atomically: a reader (`tested()`, another trial) must never see a half-written file."""
    path = _cache(run, checkpoint)
    path.parent.mkdir(exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(body))
    os.replace(tmp, path)


def tested(run) -> dict[int, dict]:
    """The checkpoints of `run` already tested on this runner version, without their traces."""
    keep = ("score", "seeds_finished", "seeds_total", "command_vx")
    return {n: {k: body[k] for k in keep} for n in run.checkpoints if (body := _cached(run, n))}


def trial(root, run, checkpoint: int, event_id: str) -> dict:
    if checkpoint not in run.checkpoints:
        raise TrialError(f"{run.id} has no model_{checkpoint}.pt")
    with _ONE_TRIAL:
        # Re-checked under the lock: a request that waited behind another trial of the SAME
        # checkpoint returns what that one just measured, rather than exporting again.
        if (found := _cached(run, checkpoint)) is not None:
            return found
        onnx = _cache(run, checkpoint).with_suffix(".onnx")
        out = root / f"publish-{NAME}"
        # A previous, failed export may have left this: never move whatever happens to be
        # sitting in it into a checkpoint's slot as if this run had just produced it.
        shutil.rmtree(out, ignore_errors=True)
        done = uv_run(
            root, "publish", "--run", str(run.path), "--checkpoint", str(checkpoint),
            "--repo", f"local/microduck-{NAME}", "--name", NAME, "--dry-run", "--allow-dirty",
        )
        if done.returncode != 0:
            raise TrialError(done.stdout + done.stderr)
        onnx.parent.mkdir(exist_ok=True)
        shutil.move(out / "policy.onnx", onnx)
        shutil.rmtree(out, ignore_errors=True)
        result = evaluate(load_event(event_id), load_policy(onnx))
        body = {
            "checkpoint": checkpoint,
            "score": result.score,
            "command_vx": result.command_vx,
            "seeds_finished": result.seeds_finished,
            "seeds_total": len(result.per_seed),
            "per_seed": [{"seed": s.seed, "status": s.status, "time_s": s.time_s} for s in result.per_seed],
            "trace_seed": result.trace_seed,
            "trace_b64": base64.b64encode(result.trace.astype("<f4").tobytes()).decode("ascii"),
            "runner_version": result.runner_version,
        }
        _write_cache(run, checkpoint, body)
        return body

"""Every training launched from this checkout, written down in logs/workshop-jobs.json.

A training outlives the workshop's memory of it: closed, or crashed, the workshop leaves a Hugging
Face job running and billed, and forgets what it launched. So each launch writes down what its
ticket needs later: the challenge's task, where it runs, its recipe and settings, when it started;
for a Hugging Face job the checkpoint repo, the account and the last job id. A local training
adds how it ended; the watcher (watch.py) adds what the Hub last said of a job. logs/ is ignored
by git, so no commit ever carries this file.
"""

import json
import os
import threading
from pathlib import Path

JOBS = Path("logs") / "workshop-jobs.json"
# The Hub's stages after which a job does nothing more.
TERMINAL = frozenset({"COMPLETED", "CANCELED", "ERROR", "DELETED"})
_WRITING = threading.Lock()  # a launch, the log it follows and the watcher all write


def _raw(root: Path) -> list:
    """The file's list as it is, whatever entries it holds; never raises, never anything but a list."""
    try:
        jobs = json.loads((root / JOBS).read_text())
    except (OSError, ValueError):
        return []
    return jobs if isinstance(jobs, list) else []


def _is_job(entry) -> bool:
    """Enough shape to build a ticket from without raising — a hand-edited file, or a record from
    before trainings were written down by task, is not."""
    if not isinstance(entry, dict) or not isinstance(entry.get("name"), str) or not isinstance(entry.get("task"), str):
        return False
    if entry.get("where") not in ("local", "hf-jobs"):
        return False
    recipe = entry.get("recipe")
    if recipe is not None and not (isinstance(recipe, dict) and isinstance(recipe.get("max_iterations"), int)):
        return False
    if entry.get("where") == "hf-jobs":
        if not (isinstance(entry.get("namespace"), str) and isinstance(entry.get("ckpt_repo"), str)):
            return False
        if entry.get("job_id") is not None and not isinstance(entry.get("job_id"), str):
            return False
    return entry.get("ended") in (None, "finished", "failed", "stopped")


def recorded_jobs(root: Path, task: str | None = None) -> list[dict]:
    """Newest first; only `task`'s when given. What does not read as a job is left out."""
    return [job for job in _raw(root) if _is_job(job) and task in (None, job["task"])]


def remember_job(root: Path, task: str, name: str, **fields) -> None:
    """Write down `task`'s training called `name` — `fields` carries `where`: this is a launch — or
    update the fields of the one already there. Nothing else (a job id, an ended state, a stage) is
    a launch, so with no record yet to update, there is nothing to write. Every other raw entry —
    one `recorded_jobs` would leave out, an older record, a hand-edited one — is kept as it is: it
    may still hold the id of a Hugging Face job that is billed regardless of what reads here.
    """
    with _WRITING:
        jobs = _raw(root)
        job = next((j for j in jobs if isinstance(j, dict) and j.get("task") == task and j.get("name") == name), None)
        if job is None:
            if "where" not in fields:
                return
            jobs.insert(0, {"task": task, "name": name, **fields})
        else:
            job.update(fields)
        path = root / JOBS
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(path.name + ".tmp")
        tmp.write_text(json.dumps(jobs, indent=1))
        os.replace(tmp, path)  # a reader sees the old list or the new one, never half of one

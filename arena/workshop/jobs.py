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


def recorded_jobs(root: Path, task: str | None = None) -> list[dict]:
    """Newest first; only `task`'s when given. What does not read as a job — a hand-edited file, a
    record from before trainings were written down by task — is left out."""
    try:
        jobs = json.loads((root / JOBS).read_text())
    except (OSError, ValueError):
        return []
    if not isinstance(jobs, list):
        return []
    return [job for job in jobs
            if isinstance(job, dict) and "name" in job and "task" in job and task in (None, job["task"])]


def remember_job(root: Path, task: str, name: str, **fields) -> None:
    """Write down `task`'s training called `name`, or update the fields of the one written down."""
    with _WRITING:
        jobs = recorded_jobs(root)
        job = next((j for j in jobs if (j["task"], j["name"]) == (task, name)), None)
        if job is None:
            jobs.insert(0, {"task": task, "name": name, **fields})
        else:
            job.update(fields)
        path = root / JOBS
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(path.name + ".tmp")
        tmp.write_text(json.dumps(jobs, indent=1))
        os.replace(tmp, path)  # a reader sees the old list or the new one, never half of one

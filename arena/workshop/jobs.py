"""The Hugging Face jobs launched from this checkout, written down in logs/workshop-jobs.json.

A job outlives the workshop: closed, or crashed, the workshop leaves the job
running and billed on Hugging Face, and its handle on it (a `Training`, in
memory) is gone. So each launch writes down what reaching the job again takes:
the checkpoint repo to fetch, the account and the last job id to cancel.
Nothing asks the Hub how a job is doing; the page offers Fetch and Stop for
each. logs/ is ignored by git, so no commit ever carries this file.
"""

import json
import os
import threading
from pathlib import Path

JOBS = Path("logs") / "workshop-jobs.json"
_WRITING = threading.Lock()  # a launch and the log it follows both write


def recorded_jobs(root: Path) -> list[dict]:
    """Newest first."""
    try:
        return json.loads((root / JOBS).read_text())
    except (OSError, ValueError):
        return []


def find_job(root: Path, name: str) -> dict | None:
    return next((job for job in recorded_jobs(root) if job["name"] == name), None)


def remember_job(root: Path, name: str, **fields) -> None:
    """Write down the job called `name`, or update the fields of the one already written down."""
    with _WRITING:
        jobs = recorded_jobs(root)
        job = next((j for j in jobs if j["name"] == name), None)
        if job is None:
            jobs.insert(0, {"name": name, **fields})
        else:
            job.update(fields)
        path = root / JOBS
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(path.name + ".tmp")
        tmp.write_text(json.dumps(jobs, indent=1))
        os.replace(tmp, path)  # a reader sees the old list or the new one, never half of one

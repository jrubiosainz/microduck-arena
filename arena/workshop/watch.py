"""The Hugging Face jobs this workshop does not follow, kept up to date.

After a restart, the training that launched a job is gone from memory, but the job still runs and
bills on Hugging Face. So every recorded job the Hub may still be running is asked of it at most
once a minute; its checkpoint repo is pulled every two minutes while it runs, and once more when it
ends. What the Hub says goes into the job's record, where the tickets read it: they never ask the
network themselves, and a Hub that does not answer changes nothing but when it is asked next.
"""

import time

from .jobs import TERMINAL, recorded_jobs, remember_job
from .training import PULL_EVERY_S, fetch

ASK_EVERY_S = 60.0
LOOK_EVERY_S = 15.0


def watch_once(ws, now: float | None = None) -> None:
    now = time.time() if now is None else now
    for job in recorded_jobs(ws.root):
        if (job.get("where") != "hf-jobs" or not job.get("job_id") or job.get("stage") in TERMINAL
                or (job["task"], job["name"]) in ws.trainings or now - job.get("asked", 0) < ASK_EVERY_S):
            continue
        try:
            stage = ws.hub.job_stage(job["job_id"], job["namespace"])
        except Exception:  # noqa: BLE001 — unreachable, or a job the Hub no longer knows: ask later
            remember_job(ws.root, job["task"], job["name"], asked=now)
            continue
        pulled = job.get("pulled", 0)
        if stage in TERMINAL or now - pulled >= PULL_EVERY_S:
            fetch(ws.root, job["ckpt_repo"])
            pulled = now
        remember_job(ws.root, job["task"], job["name"], stage=stage, asked=now, pulled=pulled)


def watch_forever(ws) -> None:
    while not ws.stopping.is_set():
        try:
            watch_once(ws)
        except Exception as exc:  # noqa: BLE001 — a bad record must not stop the watch of the others
            print(f"[workshop] jobs: {type(exc).__name__}: {exc}", flush=True)
        ws.stopping.wait(LOOK_EVERY_S)

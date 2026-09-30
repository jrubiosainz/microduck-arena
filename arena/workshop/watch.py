"""The Hugging Face jobs this workshop does not follow, kept up to date.

After a restart, the training that launched a job is gone from memory, but the job still runs and
bills on Hugging Face; `train --hf-jobs` may also end (a network blip) while its job runs on. So
every recorded job the Hub may still be running, and no process of this workshop follows, is asked
of it at most once a minute; its checkpoint repo is pulled every two minutes while it runs, and once
more when it ends. What the Hub says goes into the job's record, where the tickets read it: they
never ask the network themselves, and a Hub that does not answer changes nothing but when it is
asked next.
"""

import time

from .jobs import TERMINAL, recorded_jobs, remember_job
from .tickets import left_to_the_hub
from .training import PULL_EVERY_S, fetch

ASK_EVERY_S = 60.0
LOOK_EVERY_S = 15.0


def _watch(ws, job, now: float) -> None:
    live = ws.trainings.get((job["task"], job["name"]))
    if (not left_to_the_hub(live, job) or job.get("stage") in TERMINAL
            or now - job.get("asked", 0) < ASK_EVERY_S):
        return
    try:
        stage = ws.hub.job_stage(job["job_id"], job["namespace"])
    except Exception:  # noqa: BLE001 — unreachable, or a job the Hub no longer knows: ask later
        remember_job(ws.root, job["task"], job["name"], asked=now)
        return
    fields = {"asked": now}
    if stage in TERMINAL or now - job.get("pulled", 0) >= PULL_EVERY_S:
        if fetch(ws.root, job["ckpt_repo"]).returncode == 0:
            fields["pulled"] = now
        else:
            print(f"[workshop] could not fetch {job['ckpt_repo']}: trying again in a minute", flush=True)
    # A job that reads ended is never asked again: its last checkpoints must be in first.
    if stage not in TERMINAL or "pulled" in fields:
        fields["stage"] = stage
    remember_job(ws.root, job["task"], job["name"], **fields)


def watch_once(ws, now: float | None = None) -> None:
    now = time.time() if now is None else now
    for job in recorded_jobs(ws.root):
        try:
            _watch(ws, job, now)
        except Exception as exc:  # noqa: BLE001 — one bad record must not stop the watch of the others
            print(f"[workshop] jobs: {job['name']}: {type(exc).__name__}: {exc}", flush=True)


def watch_forever(ws) -> None:
    while not ws.stopping.is_set():
        watch_once(ws)
        ws.stopping.wait(LOOK_EVERY_S)

"""A clip per publish, rendered on an HF Job of its own, on a GPU.

The publish response never waits for a video. The route marks the run `pending`
and the Space launches a job on its own image — the same code, the same browser
— that runs `arena clip <run>`: it renders on the job's GPU and writes
`clip.json` and the media, or `failed.json` and a reason, into the store.
Measured on 2026-10-05, a 386-frame sprint clip: 75 s on a T4, against 588 s in
SwiftShader on the Space's eight cores and 553 s on a job's sixteen.

Nothing is rendered on the Space itself. The pending markers are the list of
what is owed: a launch the Jobs API refuses leaves the run on it and is tried
again later, and every boot drains it. With ARENA_CLIP_BACKFILL the drain also
owes a clip to every run that predates clips.
"""

import itertools
import json
import queue
import re
import threading
import time
import traceback
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

from .manifest import all_events
from .recorder import RenderedRun, ffmpeg_available, find_chrome, frame_size, record_run

# Written into every clip.json. Bumping it does not re-render older clips.
CLIP_VERSION = 1

# The spec's fifteen minutes for a race's clip, more for a longer one
# (recorder.budget_for); a render past it fails the clip.
RENDER_BUDGET_S = 900.0

# The machine a clip job runs on: a T4 renders a clip in a minute or two.
JOB_FLAVOR = "t4-small"
# Past this a job is stuck rather than slow, and HF ends it: what one may cost.
JOB_TIMEOUT = "30m"
# How often the Space looks at its jobs and at the list.
POLL_S = 10.0
# A launch the Jobs API refused is tried again this long after, the run still owed.
RETRY_S = 300.0
# A job that ended without writing either file — the machine, not the render —
# is launched again, this many times in a boot, then its clip is marked failed.
JOB_TRIES = 3
# Every clip job carries this label, and the run it renders under "run".
JOB_LABEL = {"arena": "clip"}
# What a clip job's log says for the page waiting on it: `clip: frames 120/772`.
PROGRESS = re.compile(r"^clip: (\w+) (\d+)/(\d+)$")
# A job's log is read this many lines from the end for the latest of those.
LOG_TAIL = 40
ENDED = {"COMPLETED", "CANCELED", "ERROR", "DELETED"}


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def clip_manifest(run_id: str, rendered: RenderedRun, rendered_at: str) -> dict:
    """What a ready clip says about itself: the live programme's contract per
    layout — size, rate, `crowdMixed`, `crowdDirection` — and the timing that
    prices a render on the machine that made it."""
    layouts = {}
    for name, layout in rendered.layouts.items():
        width, height = frame_size(name)
        layouts[name] = {
            "file": f"{name}.mp4",
            "width": width,
            "height": height,
            "fps": layout.plan["fps"],
            "frames": layout.plan["frames"],
            "seconds": layout.plan["seconds"],
            "crowdMixed": True,
            "crowdDirection": (
                {k: layout.crowd[k] for k in ("start", "end", "verdict")} if layout.crowd else None
            ),
            "timing": layout.timing,
        }
    return {"run_id": run_id, "version": CLIP_VERSION, "rendered_at": rendered_at,
            "poster": "poster.png", "layouts": layouts}


class ClipRenderer:
    """One run's clip, rendered in this process and written to the store: what a
    clip job runs (`arena clip`). No Chrome, no ffmpeg or no built clip page is
    a supported setup — a developer machine — and then nothing renders."""

    def __init__(self, store, origin: str, frontend_dir: Path | None, parallel: int = 1,
                 gpu: bool = False, render=record_run, log=print):
        self.store = store
        self.origin = origin
        self.parallel = parallel
        self.gpu = gpu
        self.render = render
        self.log = log
        self.available = bool(
            frontend_dir and (frontend_dir / "clip.html").is_file()
            and find_chrome() and ffmpeg_available()
        )

    def render_one(self, run_id: str) -> bool:
        """Renders, writes the clip or the reason there is none, and says which."""
        self.log(f"clip: rendering {run_id}")
        said = {"stage": None, "done": 0}

        def progress(stage: str, done: int, total: int) -> None:
            # Each stage once, then every twentieth frame: the lines the Space
            # reads back off the job's log for the page waiting on it.
            if stage != said["stage"] or done - said["done"] >= 20 or done == total:
                said.update(stage=stage, done=done)
                self.log(f"clip: {stage} {done}/{total}")

        try:
            rendered = self.render(self.origin, run_id, parallel=self.parallel,
                                   budget_s=RENDER_BUDGET_S, gpu=self.gpu, on_progress=progress)
            files = {
                "clip.json": json.dumps(clip_manifest(run_id, rendered, _now()), indent=2).encode(),
                "poster.png": rendered.poster,
                **{f"{name}.mp4": layout.mp4 for name, layout in rendered.layouts.items()},
            }
            self.store.put_clip(run_id, files)
            wall = max(layout.timing.get("total_wall_ms", 0) for layout in rendered.layouts.values())
            self.log(f"clip: {run_id} ready ({wall / 1000:.0f} s)")
            return True
        except Exception as exc:  # noqa: BLE001 — a failed clip is recorded, never raised
            try:
                self.store.fail_clip(run_id, _now(), f"{type(exc).__name__}: {exc}")
            except Exception as store_exc:  # noqa: BLE001 — same reason: the store must not either
                self.log(f"clip: {run_id} could not be marked failed "
                         f"({type(store_exc).__name__}: {store_exc})")
            self.log(f"clip: {run_id} failed ({type(exc).__name__}: {exc})")
            self.log(traceback.format_exc())
            return False


class ClipJobs:
    """The Space's side: every clip owed is launched as a job and followed to
    its end, at most `running` at a time, fresh publishes before retries and
    the backfill, each in arrival order. `api` is an HfApi (or a stand-in)."""

    def __init__(self, store, *, space_id: str | None, dataset: str | None, token: str | None,
                 namespace: str | None = None, flavor: str = JOB_FLAVOR, running: int = 4,
                 api=None, log=print, enabled: bool = True, backfill: bool = False,
                 landed=lambda run_id: None, now=time.monotonic):
        self.store = store
        self.space_id = space_id
        self.dataset = dataset
        self.token = token
        self.namespace = namespace or (space_id.split("/")[0] if space_id else None)
        self.flavor = flavor
        self.running = max(1, running)
        self.log = log
        self.backfill = backfill
        # Told every time a job ends, so the programme can rebuild its future.
        self.landed = landed
        self.now = now
        # Jobs run this Space's image and write to its dataset: off a Space,
        # or with ARENA_CLIPS=0, a publish owes no clip.
        self.available = enabled and bool(space_id and dataset and token)
        if api is None and self.available:
            from huggingface_hub import HfApi

            api = HfApi(token=token)
        self.api = api
        self.queue: queue.PriorityQueue[tuple[int, int, str]] = queue.PriorityQueue()
        self._arrivals = itertools.count()
        # run_id -> {"job", "priority", "progress"}: the jobs in flight.
        self._flights: dict[str, dict] = {}
        self._lock = threading.Lock()
        self._tries: Counter[str] = Counter()
        self._paused_until = 0.0
        self._rescanned = now()

    def enqueue(self, run_id: str, priority: int = 0) -> None:
        with self._lock:
            with self.queue.mutex:
                waiting = any(item[2] == run_id for item in self.queue.queue)
            if run_id in self._flights or waiting:
                return
            self.queue.put((priority, next(self._arrivals), run_id))

    def progress(self, run_id: str) -> dict | None:
        """Where this run stands — a job's stage and frames, or how many are
        ahead of it on the list — or None when nothing here holds it."""
        with self._lock:
            flight = self._flights.get(run_id)
            if flight is not None:
                return dict(flight["progress"])
        # Sorted, not as stored: the heap's order is not the pop order.
        with self.queue.mutex:
            waiting = sorted(self.queue.queue)
        for ahead, (_, _, waiting_id) in enumerate(waiting):
            if waiting_id == run_id:
                return {"ahead": ahead}
        return None

    def drain(self) -> None:
        """At boot: the jobs a previous process left running, everything owed,
        every clip that failed once more, and with the backfill every run that
        never owed one, newest first."""
        for job in self.api.list_jobs(status=["SCHEDULING", "RUNNING"], labels=JOB_LABEL,
                                      namespace=self.namespace):
            run_id = (job.labels or {}).get("run")
            if run_id:
                with self._lock:
                    self._flights[run_id] = {"job": job.id, "priority": 0,
                                             "progress": {"stage": "opening", "done": 0, "total": 0}}
        for run_id in self.store.pending_clips():
            self.enqueue(run_id)
        # A failed render is a stuck browser far more often than a broken run,
        # and a boot is a new job: one more go, behind what is owed.
        for run_id in self.store.failed_clips():
            self.enqueue(run_id, priority=1)
        if not self.backfill:
            return
        withdrawn = {w.run_id for w in self.store.withdrawals()}
        records = [record for manifest in all_events() for record in self.store.runs(manifest.id)
                   if record.run_id not in withdrawn]
        for record in sorted(records, key=lambda r: r.submitted_at, reverse=True):
            if self.store.clip_state(record.run_id)[0] == "none":
                self.enqueue(record.run_id, priority=1)

    def tick(self) -> None:
        """One look at every job in flight, then launches for what is owed."""
        for run_id, flight in list(self._flights.items()):
            try:
                job = self.api.inspect_job(job_id=flight["job"], namespace=self.namespace)
            except Exception as exc:  # noqa: BLE001 — looked at again next tick
                self.log(f"clip: job {flight['job']} unreadable ({type(exc).__name__}: {exc})")
                continue
            stage = job.status.stage
            if stage in ENDED:
                self._ended(run_id, flight, stage, job.status.message)
            elif stage == "RUNNING":
                flight["progress"] = self._read_progress(flight["job"]) or flight["progress"]
        # Owed by another process, or by this one before a refused launch: the
        # markers are the list, read again now and then.
        if self.now() - self._rescanned >= RETRY_S:
            self._rescanned = self.now()
            for run_id in self.store.pending_clips():
                self.enqueue(run_id)
        self._launch_owed()

    def start(self) -> None:
        threading.Thread(target=self._work, name="arena-clips", daemon=True).start()

    def _work(self) -> None:
        # drain() is Hub calls. Run from this thread, not from start(): a
        # transient Hub error must never raise inside Starlette's startup.
        try:
            self.drain()
        except Exception as exc:  # noqa: BLE001 — see above
            self.log(f"clip: nothing drained ({type(exc).__name__}: {exc})")
        # Nothing raised by one tick may end the loop, or every publish after
        # it owes a clip nobody launches.
        while True:
            try:
                self.tick()
            except Exception as exc:  # noqa: BLE001 — see above
                self.log(f"clip: a tick lost ({type(exc).__name__}: {exc})")
            time.sleep(POLL_S)

    def _launch_owed(self) -> None:
        while len(self._flights) < self.running and self.now() >= self._paused_until:
            try:
                priority, arrival, run_id = self.queue.get_nowait()
            except queue.Empty:
                return
            if self.store.clip_state(run_id)[0] == "ready":
                continue
            try:
                job = self.api.run_job(
                    image=f"hf.co/spaces/{self.space_id}",
                    command=["arena", "clip", run_id, "--store", "/tmp/arena-board"],
                    env={"ARENA_DATASET": self.dataset, "ARENA_COMMENTARY": "0",
                         "ARENA_CLIP_GPU": "0" if self.flavor.startswith("cpu") else "1"},
                    secrets={"HF_TOKEN": self.token},
                    flavor=self.flavor, timeout=JOB_TIMEOUT, labels={**JOB_LABEL, "run": run_id},
                    namespace=self.namespace,
                )
            except Exception as exc:  # noqa: BLE001 — the run stays on the list
                self.queue.put((priority, arrival, run_id))
                self._paused_until = self.now() + RETRY_S
                self.log(f"clip: no job for {run_id} ({type(exc).__name__}: {exc}); "
                         f"the list waits {RETRY_S:.0f} s")
                return
            with self._lock:
                self._flights[run_id] = {"job": job.id, "priority": priority,
                                         "progress": {"stage": "opening", "done": 0, "total": 0}}
            self.log(f"clip: {run_id} on job {job.id}")

    def _read_progress(self, job_id: str) -> dict | None:
        try:
            lines = list(self.api.fetch_job_logs(job_id=job_id, namespace=self.namespace,
                                                 tail=LOG_TAIL))
        except Exception:  # noqa: BLE001 — a bar that does not move this tick
            return None
        for line in reversed(lines):
            if found := PROGRESS.match(line.strip()):
                return {"stage": found[1], "done": int(found[2]), "total": int(found[3])}
        return None

    def _ended(self, run_id: str, flight: dict, stage: str, message: str | None) -> None:
        with self._lock:
            del self._flights[run_id]
        # The job wrote to the store from elsewhere: read it again, not the cache.
        self.store.refresh()
        state, written = self.store.clip_state(run_id)
        if state == "ready":
            self.log(f"clip: {run_id} ready (job {flight['job']})")
        elif state == "failed":
            self.log(f"clip: {run_id} failed ({written.get('reason')}, job {flight['job']})")
        else:
            # Neither file: the machine ended the job, not the render.
            why = f"job {flight['job']} ended {stage}" + (f": {message}" if message else "")
            self._tries[run_id] += 1
            if self._tries[run_id] < JOB_TRIES:
                self.log(f"clip: {run_id} owed again ({why})")
                self.enqueue(run_id, flight["priority"])
            else:
                self.store.fail_clip(run_id, _now(), why)
                self.log(f"clip: {run_id} failed ({why}, {JOB_TRIES} jobs)")
        self.landed(run_id)

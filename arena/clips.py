"""A clip per publish, rendered in the background by one worker.

The publish response never waits for a video. The route marks the run
`pending`, the worker takes runs one at a time, and the store ends up with
`clip.json` and the media or `failed.json` and a reason. A redeploy that kills
a render leaves the marker, and `drain` at the next boot picks it up. With
ARENA_CLIP_BACKFILL the same drain also owes a clip to every run that predates
clips — the log a launch already has — behind whatever a player just published.
"""

import itertools
import json
import queue
import threading
import traceback
from datetime import UTC, datetime
from pathlib import Path

from .manifest import all_events
from .recorder import SIZES, RenderedRun, ffmpeg_available, find_chrome, record_run

# Written into every clip.json. Bumping it does not re-render older clips.
CLIP_VERSION = 1

# The spec's fifteen minutes; a render past it fails the clip and frees the queue.
RENDER_BUDGET_S = 900.0


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def clip_manifest(run_id: str, rendered: RenderedRun, rendered_at: str) -> dict:
    """What a ready clip says about itself: the live programme's contract per
    layout — size, rate, `crowdMixed`, `crowdDirection` — and the timing that
    prices a render on the machine that made it."""
    layouts = {}
    for name, layout in rendered.layouts.items():
        width, height = SIZES[name]
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
    def __init__(self, store, origin: str, frontend_dir: Path | None, parallel: int = 1,
                 render=record_run, log=print, enabled: bool = True, backfill: bool = False):
        self.store = store
        self.origin = origin
        self.parallel = parallel
        self.render = render
        self.log = log
        self.backfill = backfill
        # No Chrome, no ffmpeg or no built clip page is a supported setup — a
        # developer machine — not an error: publishes then owe no clip. Nor is
        # ARENA_CLIPS=0, the documented off switch for a running Space.
        self.available = enabled and bool(
            frontend_dir and (frontend_dir / "clip.html").is_file()
            and find_chrome() and ffmpeg_available()
        )
        # Fresh publishes first, then the backfill, each in arrival order: a
        # player watching the page for their clip must never wait behind the
        # whole log being caught up.
        self.queue: queue.PriorityQueue[tuple[int, int, str]] = queue.PriorityQueue()
        self._arrivals = itertools.count()
        # Where the render in flight has got to, for the page waiting on it.
        # Memory, not the store: it changes hundreds of times per clip and is
        # worth nothing once the process that was rendering is gone.
        self._flight: dict | None = None
        self._flight_lock = threading.Lock()

    def enqueue(self, run_id: str, priority: int = 0) -> None:
        self.queue.put((priority, next(self._arrivals), run_id))

    def step(self, run_id: str | None, stage: str, done: int = 0, total: int = 0) -> None:
        """What the render in flight is doing; `None` for nothing in flight."""
        with self._flight_lock:
            self._flight = (
                None if run_id is None
                else {"run_id": run_id, "stage": stage, "done": done, "total": total}
            )

    def progress(self, run_id: str) -> dict | None:
        """Where this run stands with the worker — rendering now, or how many
        are ahead of it — or None when the worker is not holding it. The store
        knows a clip is owed; only this knows how far off it is."""
        with self._flight_lock:
            flight = self._flight
        if flight and flight["run_id"] == run_id:
            return {key: flight[key] for key in ("stage", "done", "total")}
        # Sorted, not as stored: the heap's order is not the pop order, and a
        # backfill put in first still comes out behind a fresh publish.
        with self.queue.mutex:
            waiting = sorted(self.queue.queue)
        # The run_id is the last of the tuple, whatever else the queue carries.
        for ahead, item in enumerate(waiting):
            if item[-1] == run_id:
                return {"ahead": ahead}
        return None

    def drain(self) -> None:
        """Everything owed and not yet rendered or failed — after a restart —
        and, when backfilling, every run that never owed one, newest first."""
        for run_id in self.store.pending_clips():
            self.enqueue(run_id)
        if not self.backfill:
            return
        # Withdrawn runs keep their page but nobody shares them; a failed one
        # stays failed until `arena clip` is run by hand.
        withdrawn = {w.run_id for w in self.store.withdrawals()}
        records = [
            record
            for manifest in all_events()
            for record in self.store.runs(manifest.id)
            if record.run_id not in withdrawn
        ]
        for record in sorted(records, key=lambda r: r.submitted_at, reverse=True):
            if self.store.clip_state(record.run_id)[0] == "none":
                self.enqueue(record.run_id, priority=1)

    def start(self) -> None:
        threading.Thread(target=self._work, name="arena-clips", daemon=True).start()

    def _work(self) -> None:
        # drain() is a Hub call. Run from the worker thread, not from start():
        # a transient Hub error here must never raise inside Starlette's
        # startup, which would take the whole process down with it.
        try:
            self.drain()
        except Exception as exc:  # noqa: BLE001 — see above
            self.log(f"clip: nothing drained ({type(exc).__name__}: {exc})")
        # The worker outlives every failure, or the next publish owes a clip
        # nobody renders: nothing raised by one run may end the loop.
        while True:
            _, _, run_id = self.queue.get()
            try:
                self.render_one(run_id)
            except Exception as exc:  # noqa: BLE001 — see above
                self.log(f"clip: {run_id} lost the worker a turn ({type(exc).__name__}: {exc})")

    def render_one(self, run_id: str) -> None:
        self.log(f"clip: rendering {run_id}")
        try:
            rendered = self.render(
                self.origin, run_id, parallel=self.parallel, budget_s=RENDER_BUDGET_S,
                on_progress=lambda stage, done, total: self.step(run_id, stage, done, total),
            )
            files = {"clip.json": json.dumps(clip_manifest(run_id, rendered, _now()), indent=2).encode(),
                     "poster.png": rendered.poster,
                     **{f"{name}.mp4": layout.mp4 for name, layout in rendered.layouts.items()}}
            self.store.put_clip(run_id, files)
            wall = max(layout.timing.get("total_wall_ms", 0) for layout in rendered.layouts.values())
            self.log(f"clip: {run_id} ready ({wall / 1000:.0f} s)")
        except Exception as exc:  # noqa: BLE001 — a failed clip must never take the worker down
            try:
                self.store.fail_clip(run_id, _now(), f"{type(exc).__name__}: {exc}")
            except Exception as store_exc:  # noqa: BLE001 — same reason: the store must not either
                self.log(f"clip: {run_id} could not be marked failed "
                         f"({type(store_exc).__name__}: {store_exc})")
            self.log(f"clip: {run_id} failed ({type(exc).__name__}: {exc})")
            self.log(traceback.format_exc())
        finally:
            # Ready or failed, the store answers for it now: a stale fraction
            # would keep a finished page showing a bar that never moves again.
            self.step(None, "")

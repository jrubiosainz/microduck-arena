"""A clip per publish, rendered in the background by one worker.

The publish response never waits for a video. The route marks the run
`pending`, the worker takes runs one at a time, and the store ends up with
`clip.json` and the media or `failed.json` and a reason. A redeploy that kills
a render leaves the marker, and `drain` at the next boot picks it up.
"""

import json
import queue
import threading
import traceback
from datetime import UTC, datetime
from pathlib import Path

from .recorder import SIZES, RenderedRun, ffmpeg_available, find_chrome, record_run

# Written into every clip.json. Bumping it does not re-render older clips.
CLIP_VERSION = 1


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
                 render=record_run, log=print):
        self.store = store
        self.origin = origin
        self.parallel = parallel
        self.render = render
        self.log = log
        # No Chrome, no ffmpeg or no built clip page is a supported setup — a
        # developer machine — not an error: publishes then owe no clip.
        self.available = bool(
            frontend_dir and (frontend_dir / "clip.html").is_file()
            and find_chrome() and ffmpeg_available()
        )
        self.queue: queue.Queue[str] = queue.Queue()

    def enqueue(self, run_id: str) -> None:
        self.queue.put(run_id)

    def drain(self) -> None:
        """Everything owed and not yet rendered or failed — after a restart."""
        for run_id in self.store.pending_clips():
            self.enqueue(run_id)

    def start(self) -> None:
        self.drain()
        threading.Thread(target=self._work, name="arena-clips", daemon=True).start()

    def _work(self) -> None:
        # The worker outlives every failure, or the next publish owes a clip
        # nobody renders: nothing raised by one run may end the loop.
        while True:
            run_id = self.queue.get()
            try:
                self.render_one(run_id)
            except Exception as exc:  # noqa: BLE001 — see above
                self.log(f"clip: {run_id} lost the worker a turn ({type(exc).__name__}: {exc})")

    def render_one(self, run_id: str) -> None:
        self.log(f"clip: rendering {run_id}")
        try:
            rendered = self.render(self.origin, run_id, parallel=self.parallel)
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

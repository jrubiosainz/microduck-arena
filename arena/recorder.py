"""Headless Chromium over the DevTools protocol, and one run's clips out of it.

The page does the drawing (app/clip.html); this module opens it at exactly the
layout's size, asks it for one frame at a time, and hands the frames to ffmpeg.
The client is the protocol's JSON over a websocket and nothing more: a call is
a message with an id and the reply that carries the same id.
"""

import base64
import contextlib
import json
import os
import platform
import shutil
import subprocess
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

CHROMES = (
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
)


def find_chrome() -> str | None:
    """$CHROME, else the first browser at its usual place. None means no clips."""
    named = os.environ.get("CHROME")
    if named:
        return named if Path(named).exists() else None
    return next((path for path in CHROMES if Path(path).exists()), None)


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def niced(args: list[str], nice: int) -> list[str]:
    """Under `nice` where there is one: a render never starves an evaluation."""
    return ["nice", "-n", str(nice), *args] if shutil.which("nice") else args


class Tab:
    """One page in the browser, on a websocket of its own so tabs can be driven
    from separate threads without sharing a reader."""

    def __init__(self, endpoint: str, width: int, height: int, scale: float = 1.0):
        from websockets.sync.client import connect

        self.socket = connect(endpoint, max_size=None)
        self._id = 0
        target = self._call("Target.createTarget", {"url": "about:blank"})["targetId"]
        self.session = self._call("Target.attachToTarget", {"targetId": target, "flatten": True})[
            "sessionId"
        ]
        self.send("Emulation.setDeviceMetricsOverride",
                  {"width": width, "height": height, "deviceScaleFactor": scale, "mobile": False})
        self.send("Page.enable")

    def _call(
        self,
        method: str,
        params: dict | None = None,
        session: str | None = None,
        timeout: float = 60.0,
    ) -> dict:
        self._id += 1
        message = {"id": self._id, "method": method, "params": params or {}}
        if session:
            message["sessionId"] = session
        self.socket.send(json.dumps(message))
        while True:
            # Without a timeout a stuck reply hangs forever, and no caller's
            # own deadline (wait_ready's, say) is ever actually enforced.
            reply = json.loads(self.socket.recv(timeout=timeout))
            # Events carry no id and are not waited on: readiness is polled.
            if reply.get("id") != self._id:
                continue
            if "error" in reply:
                raise RuntimeError(f"{method}: {reply['error'].get('message')}")
            return reply["result"]

    def send(self, method: str, params: dict | None = None, timeout: float = 60.0) -> dict:
        return self._call(method, params, self.session, timeout)

    def evaluate(self, expression: str, await_promise: bool = False, timeout: float = 60.0):
        # A parameter, not a constant: the soundtrack render can take minutes,
        # and a caller doing that must be able to ask for longer than the
        # default without it looking like a hang.
        result = self.send("Runtime.evaluate", {
            "expression": expression, "awaitPromise": await_promise, "returnByValue": True,
        }, timeout=timeout)
        if "exceptionDetails" in result:
            details = result["exceptionDetails"]
            raise RuntimeError(details.get("exception", {}).get("description") or details.get("text"))
        return result["result"].get("value")

    def navigate(self, url: str) -> None:
        self.send("Page.navigate", {"url": url})

    def wait_ready(self, timeout_s: float = 60.0) -> None:
        """Until the page has drawn its first frame, or said why it cannot."""
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            if self.evaluate("Boolean(window.clip && window.clip.ready)"):
                self.evaluate("document.fonts.ready.then(() => true)", await_promise=True)
                error = self.evaluate("window.clip.error")
                if error:
                    raise RuntimeError(f"the tape jammed: {error}")
                return
            time.sleep(0.1)
        raise TimeoutError("the clip never drew a frame")

    def close(self) -> None:
        self.socket.close()


class Chrome:
    """One headless browser with a profile of its own, killed rather than asked
    to leave: Chrome outlives a SIGTERM."""

    # A layout is recorded in a tab of its own and only one of them can be the
    # foreground one; a backgrounded renderer stops committing frames, and a
    # screenshot then waits on a frame that never comes. The three
    # backgrounding switches are off for that reason, not for speed.
    FLAGS = ("--headless=new", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
             "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox",
             "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
             "--disable-background-timer-throttling", "--remote-debugging-port=0")
    # On a clip job's GPU: ANGLE on the NVIDIA driver through EGL. Measured on a T4
    # on 2026-10-05: 84 ms a frame against SwiftShader's 3 153 ms on the same
    # machine, the same picture. Not Vulkan, as fast: there the compositor drops
    # the canvas's top strip, as tall as the opaque results band laid over its
    # bottom at the outro — a black band on a landscape clip's last 2.5 s. It
    # needs the glvnd dispatchers (libegl1, libgles2: the Dockerfile) beside the
    # driver the job's runtime mounts, or no WebGL at all.
    GPU_FLAGS = (*(flag for flag in FLAGS if "swiftshader" not in flag),
                 "--use-gl=angle", "--use-angle=gl-egl", "--ignore-gpu-blocklist", "--enable-gpu")

    def __init__(self, binary: str, nice: int = 10, gpu: bool = False):
        self.profile = tempfile.mkdtemp(prefix="arena-chrome-")
        self.process = None
        flags = self.GPU_FLAGS if gpu else self.FLAGS
        try:
            self.process = subprocess.Popen(
                niced([binary, *flags, f"--user-data-dir={self.profile}", "about:blank"], nice),
                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True,
            )
            self.endpoint = self._endpoint()
        except BaseException:
            # A half-launched Chrome (or its profile) must not outlive the
            # exception that reports it.
            self.close()
            raise

    def _endpoint(self, timeout_s: float = 20.0) -> str:
        deadline = time.monotonic() + timeout_s
        said = ""
        while time.monotonic() < deadline:
            line = self.process.stderr.readline()
            if not line:
                if self.process.poll() is not None:
                    break
                continue
            said += line
            if "ws://" in line:
                endpoint = line[line.index("ws://"):].split()[0]
                # SwiftShader/ANGLE keep talking after this line. Left unread,
                # the pipe fills and blocks Chrome, wedging every render behind it.
                threading.Thread(target=self._drain_stderr, daemon=True).start()
                return endpoint
        raise RuntimeError(f"Chrome opened no DevTools endpoint: {said.strip()}")

    def _drain_stderr(self) -> None:
        for _ in self.process.stderr:
            pass

    def tab(self, width: int, height: int, scale: float = 1.0) -> Tab:
        return Tab(self.endpoint, width, height, scale)

    def close(self) -> None:
        try:
            if self.process is not None:
                self.process.kill()
                self.process.wait(timeout=5)
        finally:
            shutil.rmtree(self.profile, ignore_errors=True)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


# Each layout's page, in CSS pixels: what clip.html is laid out at.
SIZES = {"landscape": (1920, 1080), "vertical": (1080, 1920)}
# A frame is that page drawn at two thirds, 1280×720. Measured on 2026-10-02
# under SwiftShader, the Space's renderer: the 1080p frame cost 27–30 % more
# CPU, on a sprint as on a performance, for a picture the stage draws the same.
SCALE = 2 / 3
# The soundtrack comes out of the page in pieces this big, base64 over the protocol.
CHUNK = 4 << 20
JPEG_QUALITY = 92
# A capture that has not come back in this long is not slow, it is stuck — and
# a stuck compositor comes back when asked again, so the frame is re-asked
# rather than waited on. Thirty seconds against a capture that takes 0.3 s on a
# quiet Space and 1.1 s on a loaded one: thirty times the worst reading anyone
# has measured, and half the waiting the first sixty-second bound cost.
CAPTURE_ATTEMPT_S = 30.0
CAPTURE_TRIES = 3
# The frames of a race's longest clip, a 12 s tape with its titles and outro: what
# the render budget was sized on.
BUDGETED_FRAMES = 451


def frame_size(layout: str) -> tuple[int, int]:
    """A layout's frame in pixels: its page at SCALE."""
    width, height = SIZES[layout]
    return round(width * SCALE), round(height * SCALE)


def budget_for(budget_s: float, frames: int) -> float:
    """How long a clip of `frames` frames may take to render: `budget_s` for a
    race's, and as much time per frame for a longer one — a 20 s performance on
    the stage has 651, and the first one on the Space was cut at frame 649."""
    return budget_s * max(1.0, frames / BUDGETED_FRAMES)


def ffmpeg_args(fps: int, pcm: Path, out: Path) -> list[str]:
    """H.264 at CRF 23 with the page's PCM muxed as AAC, faststart, and the
    `crowdMixed` tag the live programme reads before it decides whether to add
    a crowd of its own."""
    return [
        "ffmpeg", "-y", "-loglevel", "error",
        "-f", "image2pipe", "-framerate", str(fps), "-c:v", "mjpeg", "-i", "-",
        "-f", "f32le", "-ar", "48000", "-ac", "2", "-i", str(pcm),
        "-map", "0:v", "-map", "1:a",
        "-c:v", "libx264", "-preset", "medium", "-crf", "23", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k",
        # AAC pads to its own frame size, which can outlast the video by a
        # fraction of a frame; -shortest keeps the container the video's length.
        "-shortest",
        "-metadata", "crowdMixed=true", "-movflags", "+faststart+use_metadata_tags",
        str(out),
    ]


@dataclass(frozen=True)
class RenderedLayout:
    mp4: bytes
    plan: dict
    crowd: dict | None
    timing: dict


@dataclass(frozen=True)
class RenderedRun:
    layouts: dict[str, RenderedLayout]
    poster: bytes


def _open(chrome: Chrome, origin: str, run_id: str, layout: str) -> Tab:
    width, height = SIZES[layout]
    tab = chrome.tab(width, height, SCALE)
    tab.navigate(f"{origin}/clip.html?run={run_id}&layout={layout}&frame=0")
    tab.wait_ready()
    return tab


def _soundtrack(tab: Tab) -> bytes:
    """The whole soundtrack, rendered in the page and carried over in pieces."""
    length = tab.evaluate("window.clip.soundtrack()", await_promise=True, timeout=600.0)
    pcm = bytearray()
    for offset in range(0, length, CHUNK):
        chunk = tab.evaluate(f"window.clip.chunk({offset}, {CHUNK})", await_promise=True, timeout=120.0)
        pcm += base64.b64decode(chunk)
    return bytes(pcm)


def _record_layout(
    tab: Tab, pcm_path: Path, out: Path, nice: int, deadline: float,
    on_frame=lambda _i: None,
) -> tuple[RenderedLayout, bytes]:
    plan = tab.evaluate("window.clip.plan")
    crowd = tab.evaluate("window.clip.score.crowd")
    opened = time.monotonic()
    ffmpeg = subprocess.Popen(niced(ffmpeg_args(plan["fps"], pcm_path, out), nice), stdin=subprocess.PIPE)
    poster = b""
    draw_s = shot_s = 0.0
    completed = False

    # Every call waits on what is left of the budget, never on a constant under
    # it. A software-GL screenshot of the stage on a loaded machine can
    # take minutes, and a fixed minute here killed renders that were slow but
    # advancing — the budget is the one deadline, and the per-frame check below
    # is what enforces it.
    def left() -> float:
        return max(1.0, deadline - time.monotonic())

    stuck = 0

    def shoot(params: dict) -> dict:
        """One screenshot, asked again while it does not come back. The budget
        still bounds the whole thing: a capture never waits past the deadline,
        and a browser stuck for good fails the clip as it always did."""
        nonlocal stuck
        for attempt in range(CAPTURE_TRIES):
            try:
                return tab.send("Page.captureScreenshot", params,
                                timeout=min(CAPTURE_ATTEMPT_S, left()))
            except TimeoutError:
                stuck += 1
                if attempt == CAPTURE_TRIES - 1 or left() <= 1.0:
                    raise
        raise AssertionError("unreachable: the last attempt either returns or raises")

    try:
        for i in range(plan["frames"]):
            # Checked once per frame, not once per run: a stuck tab or a slow
            # machine is caught close to where it went over, not minutes later.
            if time.monotonic() > deadline:
                raise TimeoutError(f"render past its budget at frame {i} of {plan['frames']}")
            asked = time.monotonic()
            tab.evaluate(f"window.clip.draw({i})", timeout=left())
            drawn = time.monotonic()
            shot = shoot({"format": "jpeg", "quality": JPEG_QUALITY})
            if i == plan["poster"]:
                poster = base64.b64decode(shoot({"format": "png"})["data"])
            draw_s += drawn - asked
            shot_s += time.monotonic() - drawn
            ffmpeg.stdin.write(base64.b64decode(shot["data"]))
            on_frame(i)
        completed = True
    finally:
        # Closing stdin can itself raise once ffmpeg has already died; that
        # must never mask whatever the loop above was already failing with.
        with contextlib.suppress(OSError):
            ffmpeg.stdin.close()
        if not completed:
            # A frame raised mid-loop: ffmpeg must not be left blocked on stdin.
            ffmpeg.kill()
            ffmpeg.wait()
    if ffmpeg.wait() != 0:
        raise RuntimeError(f"ffmpeg exited {ffmpeg.returncode}")
    frames = plan["frames"]
    timing = {
        "draw_ms_per_frame": round(1000 * draw_s / frames, 1),
        "capture_ms_per_frame": round(1000 * shot_s / frames, 1),
        # How often the browser had to be asked twice. Zero is the normal
        # reading; a clip that needed several says where to look next.
        "stuck_captures": stuck,
        "total_wall_ms": round(1000 * (time.monotonic() - opened)),
        "cores": os.cpu_count(),
        "load": [round(x, 1) for x in os.getloadavg()],
        "machine": f"{platform.system()} {platform.machine()}",
    }
    return RenderedLayout(mp4=out.read_bytes(), plan=plan, crowd=crowd, timing=timing), poster


def record_run(origin: str, run_id: str, parallel: int = 1, binary: str | None = None,
               nice: int = 10, budget_s: float = 900.0, gpu: bool = False,
               on_progress=lambda stage, done, total: None) -> RenderedRun:
    """Every layout of one run, each in a browser of its own; the first one
    renders the soundtrack they all share, and they are recorded `parallel` at
    a time. The poster is the landscape clip's.

    `budget_s` bounds the whole render of a race's clip, from here, and a
    longer clip gets as much time per frame (`budget_for`) — a stuck tab or an
    overloaded machine fails the clip rather than occupying the job forever.
    `gpu` draws on the machine's GPU (Chrome.GPU_FLAGS), not in SwiftShader.

    `on_progress(stage, done, total)` is called as the render moves, for the
    page waiting on it: the two stages before the frames take minutes of their
    own and a bar that sat at nothing through them would look stuck."""
    binary = binary or find_chrome()
    if binary is None:
        raise RuntimeError("no Chrome found: set $CHROME")
    if not ffmpeg_available():
        raise RuntimeError("no ffmpeg on the PATH")
    started = time.monotonic()
    on_progress("opening", 0, 0)
    with contextlib.ExitStack() as stack:
        work = Path(stack.enter_context(tempfile.TemporaryDirectory(prefix="arena-clip-")))
        # A browser per layout, not a tab per layout in one browser. Two tabs
        # means one of them is always the background tab, and a backgrounded
        # renderer stops committing frames — so its screenshot waits on a frame
        # that never comes. Measured on the Space over seven clips: every
        # landscape layout, the one opened first, stalled once or twice, and no
        # vertical one ever did. The anti-backgrounding flags above did not
        # change that; being the only tab in a browser takes the question away.
        tabs = {
            layout: _open(stack.enter_context(Chrome(binary, nice, gpu)), origin, run_id, layout)
            for layout in SIZES
        }
        on_progress("soundtrack", 0, 0)
        pcm_path = work / "soundtrack.f32"
        pcm_path.write_bytes(_soundtrack(tabs["landscape"]))

        # Every layout plays the same plan, so the whole render's frame count is
        # known before its first frame: the bar only ever goes forward, whether
        # the layouts are recorded one at a time or together.
        frames = tabs["landscape"].evaluate("window.clip.plan")["frames"]
        total = frames * len(SIZES)
        deadline = started + budget_for(budget_s, frames)
        done = dict.fromkeys(SIZES, 0)
        counted = threading.Lock()

        def drew(layout: str, i: int) -> None:
            with counted:
                done[layout] = i + 1
                on_progress("frames", sum(done.values()), total)

        def one(layout: str) -> tuple[str, RenderedLayout, bytes]:
            # Nothing to close here any more: the browser this tab belongs to is
            # killed with the stack, and it takes the socket with it.
            rendered, poster = _record_layout(
                tabs[layout], pcm_path, work / f"{layout}.mp4", nice, deadline,
                on_frame=lambda i: drew(layout, i),
            )
            return layout, rendered, poster

        with ThreadPoolExecutor(max_workers=max(1, parallel)) as pool:
            results = list(pool.map(one, SIZES))
    layouts = {layout: rendered for layout, rendered, _ in results}
    poster = next(poster for layout, _, poster in results if layout == "landscape")
    return RenderedRun(layouts=layouts, poster=poster)

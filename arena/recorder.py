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

    def __init__(self, endpoint: str, width: int, height: int):
        from websockets.sync.client import connect

        self.socket = connect(endpoint, max_size=None)
        self._id = 0
        target = self._call("Target.createTarget", {"url": "about:blank"})["targetId"]
        self.session = self._call("Target.attachToTarget", {"targetId": target, "flatten": True})[
            "sessionId"
        ]
        self.send("Emulation.setDeviceMetricsOverride",
                  {"width": width, "height": height, "deviceScaleFactor": 1, "mobile": False})
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

    FLAGS = ("--headless=new", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
             "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox",
             "--remote-debugging-port=0")

    def __init__(self, binary: str, nice: int = 10):
        self.profile = tempfile.mkdtemp(prefix="arena-chrome-")
        self.process = None
        try:
            self.process = subprocess.Popen(
                niced([binary, *self.FLAGS, f"--user-data-dir={self.profile}", "about:blank"], nice),
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

    def tab(self, width: int, height: int) -> Tab:
        return Tab(self.endpoint, width, height)

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


SIZES = {"landscape": (1920, 1080), "vertical": (1080, 1920)}
# The soundtrack comes out of the page in pieces this big, base64 over the protocol.
CHUNK = 4 << 20
JPEG_QUALITY = 92


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
    tab = chrome.tab(width, height)
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
    tab: Tab, pcm_path: Path, out: Path, nice: int, deadline: float
) -> tuple[RenderedLayout, bytes]:
    plan = tab.evaluate("window.clip.plan")
    crowd = tab.evaluate("window.clip.score.crowd")
    opened = time.monotonic()
    ffmpeg = subprocess.Popen(niced(ffmpeg_args(plan["fps"], pcm_path, out), nice), stdin=subprocess.PIPE)
    poster = b""
    draw_s = shot_s = 0.0
    completed = False
    try:
        for i in range(plan["frames"]):
            # Checked once per frame, not once per run: a stuck tab or a slow
            # machine is caught close to where it went over, not minutes later.
            if time.monotonic() > deadline:
                raise TimeoutError(f"render past its budget at frame {i} of {plan['frames']}")
            asked = time.monotonic()
            tab.evaluate(f"window.clip.draw({i})")
            drawn = time.monotonic()
            shot = tab.send("Page.captureScreenshot", {"format": "jpeg", "quality": JPEG_QUALITY})
            if i == plan["poster"]:
                poster = base64.b64decode(tab.send("Page.captureScreenshot", {"format": "png"})["data"])
            draw_s += drawn - asked
            shot_s += time.monotonic() - drawn
            ffmpeg.stdin.write(base64.b64decode(shot["data"]))
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
        "total_wall_ms": round(1000 * (time.monotonic() - opened)),
        "cores": os.cpu_count(),
        "load": [round(x, 1) for x in os.getloadavg()],
        "machine": f"{platform.system()} {platform.machine()}",
    }
    return RenderedLayout(mp4=out.read_bytes(), plan=plan, crowd=crowd, timing=timing), poster


def record_run(origin: str, run_id: str, parallel: int = 1, binary: str | None = None,
               nice: int = 10, budget_s: float = 900.0) -> RenderedRun:
    """Every layout of one run. One browser; the first tab renders the
    soundtrack every layout shares; tabs are recorded `parallel` at a time.
    The poster is the landscape clip's.

    `budget_s` bounds the whole render, from here — a stuck tab or an
    overloaded machine fails the clip rather than occupying the worker
    forever and leaving every publish behind it stuck `pending`."""
    binary = binary or find_chrome()
    if binary is None:
        raise RuntimeError("no Chrome found: set $CHROME")
    if not ffmpeg_available():
        raise RuntimeError("no ffmpeg on the PATH")
    deadline = time.monotonic() + budget_s
    with Chrome(binary, nice) as chrome, tempfile.TemporaryDirectory(prefix="arena-clip-") as work:
        work = Path(work)
        tabs = {"landscape": _open(chrome, origin, run_id, "landscape")}
        pcm_path = work / "soundtrack.f32"
        pcm_path.write_bytes(_soundtrack(tabs["landscape"]))
        for layout in SIZES:
            if layout not in tabs:
                tabs[layout] = _open(chrome, origin, run_id, layout)

        def one(layout: str) -> tuple[str, RenderedLayout, bytes]:
            try:
                rendered, poster = _record_layout(
                    tabs[layout], pcm_path, work / f"{layout}.mp4", nice, deadline
                )
            finally:
                tabs[layout].close()
            return layout, rendered, poster

        with ThreadPoolExecutor(max_workers=max(1, parallel)) as pool:
            results = list(pool.map(one, SIZES))
    layouts = {layout: rendered for layout, rendered, _ in results}
    poster = next(poster for layout, _, poster in results if layout == "landscape")
    return RenderedRun(layouts=layouts, poster=poster)

"""Headless Chromium over the DevTools protocol, and one run's clips out of it.

The page does the drawing (app/clip.html); this module opens it at exactly the
layout's size, asks it for one frame at a time, and hands the frames to ffmpeg.
The client is the protocol's JSON over a websocket and nothing more: a call is
a message with an id and the reply that carries the same id.
"""

import json
import os
import shutil
import subprocess
import tempfile
import time
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

    def _call(self, method: str, params: dict | None = None, session: str | None = None) -> dict:
        self._id += 1
        message = {"id": self._id, "method": method, "params": params or {}}
        if session:
            message["sessionId"] = session
        self.socket.send(json.dumps(message))
        while True:
            reply = json.loads(self.socket.recv())
            # Events carry no id and are not waited on: readiness is polled.
            if reply.get("id") != self._id:
                continue
            if "error" in reply:
                raise RuntimeError(f"{method}: {reply['error'].get('message')}")
            return reply["result"]

    def send(self, method: str, params: dict | None = None) -> dict:
        return self._call(method, params, self.session)

    def evaluate(self, expression: str, await_promise: bool = False):
        result = self.send("Runtime.evaluate", {
            "expression": expression, "awaitPromise": await_promise, "returnByValue": True,
        })
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
        self.process = subprocess.Popen(
            niced([binary, *self.FLAGS, f"--user-data-dir={self.profile}", "about:blank"], nice),
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True,
        )
        self.endpoint = self._endpoint()

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
                return line[line.index("ws://"):].split()[0]
        raise RuntimeError(f"Chrome opened no DevTools endpoint: {said.strip()}")

    def tab(self, width: int, height: int) -> Tab:
        return Tab(self.endpoint, width, height)

    def close(self) -> None:
        try:
            self.process.kill()
            self.process.wait(timeout=5)
        finally:
            shutil.rmtree(self.profile, ignore_errors=True)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

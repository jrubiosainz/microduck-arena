"""One browser, one tab, kept for the life of the process.

The plan a booth plays is computed by the page, not by Python, so that the file
the reserve keeps is exactly what the live page will play. That needs a browser,
and launching one per dialogue would cost seconds of CPU every forty seconds, so
the browser stays open.

It is a browser of its own holding a single tab, never a second tab in the clip
renderer's. A backgrounded renderer stops committing frames and its screenshot
waits on a frame that never comes; the clip renderer measured this over seven
clips on the Space, and found the anti-backgrounding flags did not prevent it.
Being the only tab is what does.
"""

import json
import time

from ..recorder import Chrome, find_chrome

# The plan page draws nothing; the size only has to be a size.
SIZE = (640, 360)


class PlanTab:
    def __init__(self, origin: str, binary: str | None = None, nice: int = 10):
        self.origin = origin
        self.binary = binary
        self.nice = nice
        self._chrome = None
        self._tab = None

    def _open(self) -> None:
        binary = self.binary or find_chrome()
        if binary is None:
            raise RuntimeError("no Chrome found: set $CHROME")
        self._chrome = Chrome(binary, self.nice)
        self._tab = self._chrome.tab(*SIZE)
        self._tab.navigate(f"{self.origin}/plan.html")
        self._wait_ready()

    def _wait_ready(self, timeout_s: float = 60.0) -> None:
        """Until the page has installed its `window.plan`."""
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            if self._tab.evaluate("Boolean(window.plan)"):
                return
            time.sleep(0.1)
        raise TimeoutError("the plan page never became ready")

    def prepare(self, dialogue: dict) -> dict:
        """The dialogue's timed plan, computed by the page."""
        if self._tab is None:
            self._open()
        asking = f"window.plan({json.dumps(dialogue)})"
        try:
            return self._tab.evaluate(asking)
        except (ConnectionError, OSError, RuntimeError):
            # A browser that died under us — killed by the host, out of memory —
            # is replaced once. A second failure is the machine talking, and the
            # reserve's caller logs it and tries the next run.
            self.close()
            self._open()
            return self._tab.evaluate(asking)

    def close(self) -> None:
        if self._chrome is not None:
            self._chrome.close()
        self._chrome = None
        self._tab = None

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

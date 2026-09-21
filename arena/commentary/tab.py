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

from websockets.exceptions import ConnectionClosed

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
        chrome = Chrome(binary, self.nice)
        try:
            tab = chrome.tab(*SIZE)
            tab.navigate(f"{self.origin}/plan.html")
            self._wait_ready(tab)
        except BaseException:
            # A browser that never reached a working page must not outlive the
            # exception that reports it: nothing else would ever close it or its
            # profile directory, and the reserve tries again in five seconds —
            # one Chrome per turn, for ever. Kept only once it works, so a page
            # that never became ready is opened again rather than asked for a
            # plan for the rest of the process's life.
            chrome.close()
            raise
        self._chrome, self._tab = chrome, tab

    def _wait_ready(self, tab, timeout_s: float = 60.0) -> None:
        """Until the page has installed its `window.plan`."""
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            if tab.evaluate("Boolean(window.plan)"):
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
        except (ConnectionClosed, OSError):
            # A closed socket and a socket error are the two shapes a dead
            # browser actually takes — killed by the host, out of memory — and
            # nothing else: a `RuntimeError` here is the page's own JS
            # throwing over a dialogue it cannot time, and relaunching a live
            # browser over that would just hand the same error back. A dead
            # browser is replaced once; a second failure is the machine
            # talking, and the reserve's caller logs it and tries the next run.
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

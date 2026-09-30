"""Logging in to Hugging Face from the page, as `hf auth login` does it from a shell.

Without a terminal, huggingface_hub (2.0) always takes its browser flow, an OAuth device code: it
prints a URL, the code already in it, and the code, waits while the user approves on
huggingface.co, then saves the login itself. So the workshop runs that command, reads the URL
from its output and opens it: no token is copied, and none passes through here.

The login's process is the workshop's child in the same process group: Ctrl-C ends both. Left
behind by a workshop that was killed, it fails on its next line of output, the pipe being gone.
"""

import os
import re
import signal
import subprocess
import threading

from .shell import child_env, uv

_URL = re.compile(r"^\s*(https://\S+)\s*$")
_CODE = re.compile(r"enter the code:\s*(\S+)")
# huggingface_hub prints the URL at once; past this, something else answered.
READ_WITHIN_S = 20.0


class LoginError(RuntimeError):
    """`hf auth login` gave no URL to open; the message is its whole output."""


class BrowserLogin:
    def __init__(self, root, open_browser):
        self.root, self.open_browser = root, open_browser
        self.proc: subprocess.Popen | None = None
        self._lines: list[str] = []
        self._found = threading.Event()  # the URL and the code are out
        self._read = threading.Event()  # the process has ended and its output is all read

    def start(self) -> dict:
        self.end()
        self._lines, self._found, self._read = [], threading.Event(), threading.Event()
        self.proc = subprocess.Popen(
            uv("hf", "auth", "login", "--force"), cwd=self.root, stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace", bufsize=1,
            env=child_env(),
        )
        threading.Thread(target=self._follow, args=(self.proc, self._lines, self._found, self._read), daemon=True).start()
        self._found.wait(READ_WITHIN_S)
        url, code = _url_and_code(self._lines)
        if url is None or code is None:
            self.end()
            raise LoginError("\n".join(self._lines) or "hf auth login printed nothing")
        self.open_browser(url)
        return {"url": url, "code": code}

    @staticmethod
    def _follow(proc, lines, found, read) -> None:
        for line in proc.stdout:
            lines.append(line.rstrip("\n"))
            if _url_and_code(lines)[1] is not None:
                found.set()
        if proc.wait() == 0:
            # The new login is saved; an HF_TOKEN still set would outrank it (and never refresh).
            os.environ.pop("HF_TOKEN", None)
        found.set()
        read.set()

    def state(self) -> dict:
        if self.proc is None:
            return {"state": None, "output": ""}
        # "done" only once the output is all read and HF_TOKEN dropped, not as soon as the process exits.
        if not self._read.is_set():
            state = "waiting"
        else:
            state = "done" if self.proc.returncode == 0 else "failed"
        return {"state": state, "output": "\n".join(self._lines)}

    def end(self) -> None:
        """Give up a login still waiting for approval (a second click starts afresh)."""
        if self.proc is not None and self.proc.poll() is None:
            try:
                self.proc.send_signal(signal.SIGTERM)
            except OSError:
                pass
            self.proc.wait()


def _url_and_code(lines: list[str]) -> tuple[str | None, str | None]:
    url = next((m.group(1) for line in lines if (m := _URL.match(line))), None)
    code = next((m.group(1) for line in lines if (m := _CODE.search(line))), None)
    return url, code

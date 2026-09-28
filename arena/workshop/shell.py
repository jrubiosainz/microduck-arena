"""The workshop's subprocesses: git and gh as they are, uv as `uv run --no-sync <command>`.

`--no-sync`: the workshop already runs in the checkout's environment — the
launcher synced it once — so every command runs in that environment as it is.
A sync per call costs seconds and, during development, would put the locked
Arena wheel back over an editable install. Output is never interpreted beyond
what a step needs; on failure it is handed back whole. Every git runs with
`GIT_TERMINAL_PROMPT=0`: without it, a push with no credentials or an
unreachable URL blocks on a terminal prompt that never comes, instead of
failing with output the page can show.
"""

import os
import shutil
import subprocess
from pathlib import Path


class ShellError(RuntimeError):
    """A command failed. The message is the command and its whole output."""


def child_env() -> dict:
    # Python children buffer a pipe in blocks; a log that arrives a page at a time is no log.
    return {**os.environ, "PYTHONUNBUFFERED": "1"}


def git(root: Path, *args: str, check: bool = True) -> str:
    done = subprocess.run(["git", *args], cwd=root, capture_output=True, text=True,
                           env={**os.environ, "GIT_TERMINAL_PROMPT": "0"})
    if check and done.returncode != 0:
        raise ShellError(f"$ git {' '.join(args)}\n{done.stdout}{done.stderr}")
    return done.stdout.strip()


def commit_all(root: Path, message: str) -> bool:
    """Commit everything git does not ignore. False when there was nothing to commit."""
    if not git(root, "status", "--porcelain"):
        return False
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", message)
    return True


def gh_ready(root: Path) -> bool:
    """The GitHub CLI is installed and logged in, so the workshop can fork for the user."""
    if shutil.which("gh") is None:
        return False
    return subprocess.run(["gh", "auth", "status"], cwd=root, capture_output=True).returncode == 0


def uv(*args: str) -> list[str]:
    return ["uv", "run", "--no-sync", *args]


def uv_run(root: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(uv(*args), cwd=root, capture_output=True, text=True, env=child_env())

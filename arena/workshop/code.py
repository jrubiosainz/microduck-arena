"""Where the user's code stands, and the steps that share it.

The recipe a policy is published with names a commit; it is worth something only if that commit
is somewhere people can open it. So the workshop says what is not committed yet (a training starts
from a commit), whether this checkout works in the user's own fork, and how many commits are only
on this machine. A nudge, never a gate: a policy can be published without a code link.
"""

import re
from pathlib import Path

from .shell import ShellError, commit_all, git

UPSTREAM_OWNER = "pollen-robotics"
_GITHUB = re.compile(r"^(?:https://github\.com/|git@github\.com:)([\w.-]+)/([\w.-]+?)(?:\.git)?/?$")
# One `git status --porcelain` line; the first may have lost its leading space to git()'s strip.
_STATUS = re.compile(r"^\s*(\S{1,2})\s+(.+)$")


def github_repo(url: str | None) -> tuple[str, str] | None:
    found = _GITHUB.match(url or "")
    return (found.group(1), found.group(2)) if found else None


def _remote(root: Path, name: str) -> str | None:
    # config, not `git remote get-url`: the address as the user set it, before any url.insteadOf.
    return git(root, "config", "--get", f"remote.{name}.url", check=False) or None


def _pollens(repo: tuple[str, str] | None) -> bool:
    return repo is not None and repo[0].lower() == UPSTREAM_OWNER  # GitHub owners ignore case


def _fork(root: Path) -> tuple[str, str] | None:
    repo = github_repo(_remote(root, "origin"))
    return repo if repo and not _pollens(repo) else None


def code_state(root: Path) -> dict:
    fork = _fork(root)
    changes = [{"status": m.group(1), "path": m.group(2)}
               for line in git(root, "status", "--porcelain").splitlines() if (m := _STATUS.match(line))]
    return {
        "fork": "/".join(fork) if fork else None,
        "changes": changes,
        # A commit needs a name: the workshop commits before every training.
        "identity": bool(git(root, "config", "user.email", check=False)),
        "commit": git(root, "rev-parse", "--short=9", "HEAD"),
        # Commits no remote holds: on this machine only.
        "unpushed": int(git(root, "rev-list", "--count", "HEAD", "--not", "--remotes", check=False) or 0),
    }


def commit(root: Path, message: str) -> None:
    if not message.strip():
        raise ShellError("A commit needs a message.")
    if not commit_all(root, message.strip()):
        raise ShellError("Nothing to commit: everything is already committed.")


def use_fork(root: Path, url: str) -> None:
    """Make the user's fork `origin`, Pollen's repository `upstream`. Nothing is pushed.

    Once `upstream` exists the fork already happened: a second address (a typo fixed) only
    replaces origin.
    """
    repo = github_repo(url.strip())
    if repo is None:
        raise ShellError(f"{url} is not a GitHub repository address (https://github.com/<you>/<name>).")
    if _pollens(repo):
        raise ShellError(f"{url} is Pollen's repository: paste the address of your fork (https://github.com/<you>/<name>).")
    if _remote(root, "upstream") is not None:
        git(root, "remote", "set-url", "origin", url.strip())
    else:
        git(root, "remote", "rename", "origin", "upstream")
        git(root, "remote", "add", "origin", url.strip())


def push(root: Path) -> None:
    if _fork(root) is None:
        raise ShellError("Fork first: your code goes to your fork, not Pollen's repo.")
    git(root, "push", "-u", "origin", "HEAD")


def code_url(root: Path, commit: str | None) -> str | None:
    """https://github.com/<fork>/tree/<commit>, once that commit is on the user's fork."""
    fork = _fork(root)
    if not commit or fork is None:
        return None
    holders = git(root, "branch", "-r", "--contains", commit, check=False).splitlines()
    if not any(line.strip().startswith("origin/") for line in holders):
        return None
    return f"https://github.com/{fork[0]}/{fork[1]}/tree/{commit}"

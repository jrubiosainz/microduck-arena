"""Where the user's code stands, and the one button that shares it.

The recipe a policy is published with names a commit; it is worth something
only if that commit is somewhere people can open it. So the Publish zone says
whether the code is not shared yet (origin is still Pollen's repo), has changes
not online yet, or is shared — and offers the step that fixes it. A nudge,
never a gate: a policy can be published without a code link.
"""

import re
import subprocess
from pathlib import Path

from .shell import ShellError, commit_all, gh_ready, git

UPSTREAM_OWNER = "pollen-robotics"
FORK_PAGE = "https://github.com/pollen-robotics/microduck-challenges/fork"
_GITHUB = re.compile(r"^(?:https://github\.com/|git@github\.com:)([\w.-]+)/([\w.-]+?)(?:\.git)?/?$")


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
    changes = len(git(root, "status", "--porcelain").splitlines())
    # A remote named origin can exist (a rename, or a `set-url` left by a push that then failed)
    # without a single push having landed: `--not --remotes=origin` would then exclude nothing
    # and count the whole history as "unpushed", and the page would offer Commit-and-push for a
    # fork it cannot yet push to. refs/remotes/origin/* appears only once a push has landed.
    ever_pushed = fork is not None and bool(git(root, "for-each-ref", "refs/remotes/origin", check=False))
    unpushed = int(git(root, "rev-list", "--count", "HEAD", "--not", "--remotes=origin", check=False) or 0) if ever_pushed else 0
    state = "not-shared" if not ever_pushed else ("changes" if changes or unpushed else "shared")
    return {
        "state": state,
        "origin": _remote(root, "origin"),
        "fork": "/".join(fork) if fork else None,
        "changes": changes,
        "unpushed": unpushed,
        "commit": git(root, "rev-parse", "--short=9", "HEAD"),
        "gh": gh_ready(root),
        "fork_page": FORK_PAGE,
    }


def push(root: Path, message: str) -> str:
    if _pollens(github_repo(_remote(root, "origin"))):
        raise ShellError("Fork first: your code goes to your fork, not Pollen's repo.")
    commit_all(root, message)
    return git(root, "push", "-u", "origin", "HEAD")


def fork(root: Path, url: str | None, message: str) -> str:
    """Make origin the user's fork, then push. With gh logged in, gh makes the fork; otherwise
    `url` is the fork the user made on GitHub's page.

    A retry after a failed push (a typo'd URL, a fork not ready yet, no credentials) must not
    redo what a first attempt already did: once `upstream` exists, the fork already happened —
    gh's or the rename's — so a retry only replaces origin (`set-url`, not rename-and-add) or,
    with no url, just pushes again.
    """
    already_forked = _remote(root, "upstream") is not None
    if url is None:
        if not already_forked:
            if not gh_ready(root):
                raise ShellError("The GitHub CLI is not logged in: make your fork on GitHub's page, then paste its address.")
            done = subprocess.run(["gh", "repo", "fork", "--remote"], cwd=root, capture_output=True, text=True, check=False)
            if done.returncode != 0:
                raise ShellError(f"$ gh repo fork --remote\n{done.stdout}{done.stderr}")
    else:
        repo = github_repo(url.strip())
        if repo is None:
            raise ShellError(f"{url} is not a GitHub repository address (https://github.com/<you>/<name>).")
        if _pollens(repo):
            raise ShellError(f"{url} is Pollen's repository: paste the address of your fork (https://github.com/<you>/<name>).")
        if already_forked:
            git(root, "remote", "set-url", "origin", url.strip())
        else:
            git(root, "remote", "rename", "origin", "upstream")
            git(root, "remote", "add", "origin", url.strip())
    return push(root, message)


def code_url(root: Path, commit: str | None) -> str | None:
    """https://github.com/<fork>/tree/<commit>, once that commit is on the user's fork."""
    fork = _fork(root)
    if not commit or fork is None:
        return None
    holders = git(root, "branch", "-r", "--contains", commit, check=False).splitlines()
    if not any(line.strip().startswith("origin/") for line in holders):
        return None
    return f"https://github.com/{fork[0]}/{fork[1]}/tree/{commit}"

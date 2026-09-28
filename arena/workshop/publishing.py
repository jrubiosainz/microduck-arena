"""Publish a run's checkpoint with `uv run publish`, then send the user to the Arena to enter it.

The workshop writes no manifest and uploads nothing itself: `publish --run`
does, exactly as from a shell. It runs twice — `--dry-run` for the preview of
the Hub card, then for real — and the real one prints the commit it made,
which is the revision the Arena pins.
"""

import json
import re
import shutil
from urllib.parse import urlencode

from ..manifest import load_event
from .shell import uv_run

# The Arena drives the policy's twist with a forward speed it sweeps across a
# range: for such an event the manifest says what the three numbers are.
SPEED_TWIST = "[vx, vy, wz]: forward and sideways speed in m/s, turn rate in rad/s"
_UNSAFE = re.compile(r"[^a-z0-9]+")
_COMMIT = re.compile(r"/commit/([0-9a-f]{7,40})")


class PublishError(RuntimeError):
    """`publish` failed; the message is its whole output."""


def slug(text: str) -> str:
    return _UNSAFE.sub("-", text.lower()).strip("-")[:60].strip("-") or "policy"


def repo_for(user: str, name: str) -> str:
    return f"{user}/microduck-{slug(name)}"


def publish_args(run, checkpoint: int, repo: str, name: str, description: str, event, allow_dirty: bool) -> list[str]:
    args = ["publish", "--run", str(run.path), "--checkpoint", str(checkpoint), "--repo", repo,
            "--name", slug(name), "--description", description]
    if event.sweep.lo < event.sweep.hi:
        args += ["--twist-help", SPEED_TWIST]
    if allow_dirty:
        args.append("--allow-dirty")
    return args


def _run(root, args: list[str]) -> str:
    done = uv_run(root, *args)
    output = done.stdout + done.stderr
    if done.returncode != 0:
        raise PublishError(output)
    return output


def preview(root, run, checkpoint, repo, name, description, event_id, allow_dirty) -> dict:
    args = publish_args(run, checkpoint, repo, name, description, load_event(event_id), allow_dirty)
    output = _run(root, [*args, "--dry-run"])
    out = root / f"publish-{slug(name)}"
    try:
        return {"readme": (out / "README.md").read_text(),
                "manifest": json.loads((out / "manifest.json").read_text()), "output": output}
    finally:
        shutil.rmtree(out, ignore_errors=True)


def publish(root, run, checkpoint, repo, name, description, event_id, allow_dirty) -> dict:
    args = publish_args(run, checkpoint, repo, name, description, load_event(event_id), allow_dirty)
    # Public, or the Arena cannot read it; --force because publishing a name again is a new
    # commit on the same repo, and the Arena pins the commit it raced.
    output = _run(root, [*args, "--no-private", "--force"])
    found = _COMMIT.search(output)
    if not found:
        raise PublishError(output + "\n[workshop] publish printed no commit for the Arena to pin")
    return {"repo": repo, "revision": found.group(1), "output": output}


def arena_link(arena: str, event_id: str, repo: str, revision: str, env: str | None) -> str:
    query = {"repo": repo, "revision": revision} | ({"env": env} if env else {})
    # The site routes on the hash, so the query goes before it.
    return f"{arena}/?{urlencode(query)}#/e/{event_id}"

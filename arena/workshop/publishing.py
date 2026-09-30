"""Publish a run's checkpoint with `uv run publish`, which also enters it on the Arena.

The workshop writes no manifest, uploads nothing and calls no Arena itself: `publish --run
--enter` does all three, exactly as from a shell. It runs twice — `--dry-run` for the preview
of the Hub card, then for real — and the real one prints the commit it made and the entry's
time and page, which the workshop opens and remembers next to the run.
"""

import json
import os
import re
import shutil
from datetime import UTC, datetime

from ..manifest import load_event
from .shell import uv_run

# The Arena drives the policy's twist with a forward speed it sweeps across a
# range: for such an event the manifest says what the three numbers are.
SPEED_TWIST = "[vx, vy, wz]: forward and sideways speed in m/s, turn rate in rad/s"
_UNSAFE = re.compile(r"[^a-z0-9]+")
_COMMIT = re.compile(r"/commit/([0-9a-f]{7,40})")
_ENTERED = re.compile(r"^\[publish\] ((?:already )?entered on .+) → (\S+)$", re.MULTILINE)


class PublishError(RuntimeError):
    """`publish` failed; the message is its whole output."""


def slug(text: str) -> str:
    return _UNSAFE.sub("-", text.lower()).strip("-")[:60].strip("-") or "policy"


def repo_for(user: str, name: str) -> str:
    return f"{user}/microduck-{slug(name)}"


def publish_args(run, checkpoint: int, repo: str, name: str, description: str, event, allow_dirty: bool) -> list[str]:
    # `--description=<text>`: as two words, a description starting with "-" reads as an option.
    args = ["publish", "--run", str(run.path), "--checkpoint", str(checkpoint), "--repo", repo,
            f"--name={slug(name)}", f"--description={description}"]
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


PUBLISHED = "published.json"


def published(run) -> list[dict]:
    """Every entry published from this run, oldest first."""
    try:
        entries = json.loads((run.path / "workshop" / PUBLISHED).read_text())
    except (OSError, ValueError):
        return []
    return [e for e in entries if isinstance(e, dict)] if isinstance(entries, list) else []


def _remember(run, entry: dict) -> None:
    path = run.path / "workshop" / PUBLISHED
    path.parent.mkdir(exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps([*published(run), entry], indent=1))
    os.replace(tmp, path)


def publish(root, run, checkpoint, repo, name, description, event_id, allow_dirty, *,
            arena: str, code_url: str | None) -> dict:
    args = publish_args(run, checkpoint, repo, name, description, load_event(event_id), allow_dirty)
    # Public, or the Arena cannot read it; --force because publishing a name again is a new commit on
    # the same repo, and the Arena pins the commit it raced. No --livery (every workshop entry wears
    # the default) and no --speed (a race is always swept).
    args += ["--no-private", "--force", "--enter", "--arena", arena]
    if code_url:
        args += ["--code-url", code_url]
    output = _run(root, args)
    commit, entered = _COMMIT.search(output), _ENTERED.search(output)
    if not commit or not entered:
        raise PublishError(output + "\n[workshop] publish printed no entry for the workshop to open")
    entry = {"checkpoint": checkpoint, "repo": repo, "revision": commit.group(1), "entered": entered.group(1),
             "page_url": entered.group(2), "at": datetime.now(UTC).isoformat(timespec="seconds")}
    _remember(run, entry)
    return {**{k: entry[k] for k in ("repo", "revision", "entered", "page_url")}, "output": output}

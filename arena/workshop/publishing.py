"""Publish a run's checkpoint with `uv run publish`, which also enters it on the Arena.

The workshop writes no manifest, uploads nothing and calls no Arena itself: `publish --run
--enter` does all three, exactly as from a shell. The preview of the Hub card is the same command
with `--dry-run`. The real one prints the commit it made and the entry's time and page, which the
workshop opens and remembers next to the run. A troupe's ducks that are checkpoints of this machine
are published first, without `--enter` (`publish_policy`), and remembered next to their own run with
no entry line.

The workshop's evaluations export a checkpoint with the same command and `--dry-run` (`export`): it
bakes the observation normaliser in and checks the 61 → 14 shape exactly as the real publish will.
The ONNX it writes is kept beside its checkpoint, and played again.
"""

import json
import os
import re
import shutil
import threading
from datetime import UTC, datetime
from pathlib import Path

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


# How much of a name a repo's keeps.
_SLUG_CHARS = 60


def slug(text: str) -> str:
    return _UNSAFE.sub("-", text.lower()).strip("-")[:_SLUG_CHARS].strip("-") or "policy"


def repo_for(user: str, name: str) -> str:
    return f"{user}/microduck-{slug(name)}"


def duck_name(name: str, k: int) -> str:
    """What duck k of a troupe entered as `name` is published as: the entry's slug, cut before the
    duck's own end rather than after it, so that each duck gets a repo of its own however long the
    name."""
    end = f"-duck-{k}"
    return slug(name)[: _SLUG_CHARS - len(end)].strip("-") + end


def publish_args(run, checkpoint: int, repo: str, name: str, description: str, event, allow_dirty: bool,
                  timeline=None) -> list[str]:
    # `--description=<text>`: as two words, a description starting with "-" reads as an option.
    args = ["publish", "--run", str(run.path), "--checkpoint", str(checkpoint), "--repo", repo,
            f"--name={slug(name)}", f"--description={description}"]
    if event.sweep and event.sweep.lo < event.sweep.hi:
        args += ["--twist-help", SPEED_TWIST]
    if timeline is not None:
        args += ["--timeline", str(timeline)]  # A stage's performance, uploaded beside the weights
    if allow_dirty:
        args.append("--allow-dirty")
    return args


def _run(root, args: list[str]) -> str:
    done = uv_run(root, *args)
    output = done.stdout + done.stderr
    if done.returncode != 0:
        raise PublishError(output)
    return output


# Public, or the Arena cannot read it; --force because publishing a name again is a new commit on the
# same repo, and the Arena pins the commit it raced.
_PUBLIC = ["--no-private", "--force"]


def preview(root, run, checkpoint, repo, name, description, event_id, allow_dirty, timeline=None) -> dict:
    args = publish_args(run, checkpoint, repo, name, description, load_event(event_id), allow_dirty, timeline)
    _run(root, [*args, "--dry-run"])
    out = root / f"publish-{slug(name)}"
    try:
        return {"readme": (out / "README.md").read_text()}
    finally:
        shutil.rmtree(out, ignore_errors=True)


# The evaluations' export stages under ./publish-workshop-evaluation/.
EXPORT = "workshop-evaluation"
# One export at a time: they all stage in that one folder, and the evaluator and a page's Save and
# play (a troupe's local ducks included) may export at the same time.
_exporting = threading.Lock()


def onnx_of(run, n: int) -> Path:
    """Where checkpoint n's ONNX is kept once exported: beside its stored evaluation."""
    return run.path / "workshop" / f"model_{n}.onnx"


def exported(run, n: int) -> bool:
    """Whether checkpoint n's ONNX is already exported from the checkpoint file as it is."""
    try:
        return onnx_of(run, n).stat().st_mtime >= (run.path / f"model_{n}.pt").stat().st_mtime
    except OSError:
        return False


def export(root, run, n: int) -> Path:
    """Checkpoint n's ONNX, exported once by `publish --dry-run`. `--allow-dirty`: an export publishes
    nothing. A failure raises PublishError with the command's whole output."""
    onnx = onnx_of(run, n)
    with _exporting:
        if exported(run, n):
            return onnx
        out = root / f"publish-{EXPORT}"
        # A previous, failed export may have left this: never move whatever happens to be sitting in
        # it into a checkpoint's slot as if this run had just produced it.
        shutil.rmtree(out, ignore_errors=True)
        try:
            _run(root, ["publish", "--run", str(run.path), "--checkpoint", str(n), "--repo",
                        f"local/microduck-{EXPORT}", "--name", EXPORT, "--dry-run", "--allow-dirty"])
            onnx.parent.mkdir(exist_ok=True)
            shutil.move(out / "policy.onnx", onnx)
        finally:
            shutil.rmtree(out, ignore_errors=True)
    return onnx


PUBLISHED = "published.json"


def published(run) -> list[dict]:
    """Every policy published from this run, oldest first: its entries, and the ducks a troupe
    published from it (no `entered`, no `page_url`)."""
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


def published_at(run, checkpoint: int) -> str | None:
    """The newest policy published from checkpoint n of this run, entered or not, as a timeline names
    it ("owner/repo@revision"); None when it never was."""
    for entry in reversed(published(run)):
        if entry.get("checkpoint") == checkpoint:
            return f"{entry['repo']}@{entry['revision']}"
    return None


def publish(root, run, checkpoint, repo, name, description, event_id, allow_dirty, *,
            arena: str, code_url: str | None, timeline=None) -> dict:
    args = publish_args(run, checkpoint, repo, name, description, load_event(event_id), allow_dirty, timeline)
    # No --livery (every workshop entry wears the default) and no --speed (a race is always swept).
    args += [*_PUBLIC, "--enter", "--arena", arena]
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


def publish_policy(root, run, checkpoint, repo, name, description, event_id, allow_dirty) -> dict:
    """Publish checkpoint n to `repo` without entering it: a duck that a troupe's entry names by this
    commit. Remembered in the run's published.json like an entry, with no `entered` nor `page_url`:
    a published policy, not an entry."""
    args = publish_args(run, checkpoint, repo, name, description, load_event(event_id), allow_dirty)
    output = _run(root, [*args, *_PUBLIC])
    commit = _COMMIT.search(output)
    if not commit:
        raise PublishError(output + "\n[workshop] publish printed no commit for the troupe to name")
    _remember(run, {"checkpoint": checkpoint, "repo": repo, "revision": commit.group(1),
                    "at": datetime.now(UTC).isoformat(timespec="seconds")})
    return {"repo": repo, "revision": commit.group(1)}

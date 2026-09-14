#!/usr/bin/env python
"""Publish this working tree to the Hugging Face Space.

Not `git push`. The Hub rejects binary files pushed through plain git — "Please
use Xet to store binary files" — and this repo vendors a 1.3 MB GLB, forty-odd
STLs and an ONNX policy. `upload_folder` speaks Xet natively, so the same call
that uploads the code uploads the meshes.

Only the tip of the tree is published, not the history. A Space is a deployment
target; the history lives in this repo.

    uv run python scripts/deploy_space.py
    uv run python scripts/deploy_space.py --dry-run
"""

import argparse
import subprocess
import sys
from pathlib import Path

from huggingface_hub import HfApi

SPACE = "pollen-robotics/microduck-arena"
ROOT = Path(__file__).resolve().parent.parent

# What never belongs in the image or the repo. app/dist especially: the
# Dockerfile builds the bundle itself from app/ sources, and shipping a stale
# host build would be served in preference to nothing.
IGNORE = [
    ".git/**",
    ".venv/**",
    "**/node_modules/**",
    "app/dist/**",
    "**/__pycache__/**",
    "*.pyc",
    ".pytest_cache/**",
    ".ruff_cache/**",
    "arena-board/**",
]
# .dockerignore is NOT here on purpose: the Space builds the image, so it needs
# the file that tells the build what to leave out.


def git_revision() -> str:
    try:
        rev = subprocess.run(
            ["git", "-C", str(ROOT), "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        dirty = subprocess.run(
            ["git", "-C", str(ROOT), "status", "--porcelain"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        return f"{rev}{'-dirty' if dirty else ''}"
    except (subprocess.CalledProcessError, FileNotFoundError):
        return "unknown"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--space", default=SPACE)
    parser.add_argument("--dry-run", action="store_true", help="list what would go, upload nothing")
    args = parser.parse_args()

    revision = git_revision()
    if revision.endswith("-dirty"):
        # A warning, not a refusal: deploying a work in progress to a private
        # Space is a normal thing to want. But the commit message should say so,
        # or nobody can tell later what is actually running.
        print("warning: working tree has uncommitted changes; they WILL be deployed")

    api = HfApi()
    if args.dry_run:
        print(f"would upload {ROOT} to {args.space}")
        print("ignoring:")
        for pattern in IGNORE:
            print(f"  {pattern}")
        return 0

    print(f"uploading {ROOT} -> {args.space} ({revision})")
    api.upload_folder(
        folder_path=str(ROOT),
        repo_id=args.space,
        repo_type="space",
        ignore_patterns=IGNORE,
        # Without this, upload_folder only ADDS and UPDATES: a file deleted or
        # renamed here lingers on the Space forever. Two renamed event manifests
        # is how this was found — the Space served nine events while the repo
        # held seven, and the two ghosts were raceable pages for events that no
        # longer existed.
        delete_patterns=["*"],
        commit_message=f"Deploy {revision}",
    )
    print(f"\n  https://huggingface.co/spaces/{args.space}")
    print("  the Space rebuilds itself now; watch its Logs tab")
    return 0


if __name__ == "__main__":
    sys.exit(main())

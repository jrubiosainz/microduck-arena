# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Open the Microduck challenge workshop. The one line on a challenge's page:

    uv run https://pollen-robotics-microduck-arena.hf.space/workshop.py sprint-2m

Works in the microduck-challenges clone you are standing in, or in
./microduck-challenges — cloned first if it is not there — then hands over to
`uv run workshop <challenge>` inside it, which installs everything once and
opens the workshop in your browser. Run the same line tomorrow: it reopens the
same work, fork included.

No dependencies, so uv runs it without installing anything. The Arena serves
this file with its own address in ARENA, so the workshop sends you back to the
Arena you came from.
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

ARENA = "https://pollen-robotics-microduck-arena.hf.space"
REPO = "https://github.com/pollen-robotics/microduck-challenges"
FOLDER = "microduck-challenges"


def checkout(here: Path) -> Path:
    if (here / "src" / "microduck_challenges").is_dir():
        return here
    clone = here / FOLDER
    if not clone.is_dir():
        if shutil.which("git") is None:
            sys.exit("git is needed first: https://git-scm.com/downloads")
        if subprocess.run(["git", "clone", REPO, str(clone)], check=False).returncode != 0:
            sys.exit(f"could not clone {REPO}")
    return clone


def hf_token() -> str | None:
    """The token `hf auth login` saved. uv needs it to install the Arena wheel while that
    sits on a private Hugging Face repo (uv sends HF_TOKEN to huggingface.co only)."""
    if os.environ.get("HF_TOKEN"):
        return os.environ["HF_TOKEN"]
    saved = Path(os.environ.get("HF_HOME") or Path.home() / ".cache" / "huggingface") / "token"
    return saved.read_text().strip() if saved.is_file() else None


def main() -> None:
    root = checkout(Path.cwd())
    env = dict(os.environ)
    if token := hf_token():
        env["HF_TOKEN"] = token
    os.chdir(root)
    command = ["uv", "run", "--frozen", "--group", "workshop", "workshop", *sys.argv[1:], "--arena", ARENA]
    os.execvpe("uv", command, env)


if __name__ == "__main__":
    main()

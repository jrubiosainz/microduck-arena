#!/usr/bin/env python
"""Put the built site inside the package, so the wheel serves it.

`npm run build` writes `app/dist` — the pages, the hashed bundle and everything
in `app/public` (the meshes, the sounds, the stylesheets). Copied to
`arena/frontend/`, hatchling ships it as a build artefact and `arena serve` or
`workshop` finds it next to the code, wherever the package is installed. Both
the Dockerfile and the release workflow run this; nothing else writes that
directory, and it is never committed.

    uv run python scripts/bundle_frontend.py
"""

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "app" / "dist"
TARGET = ROOT / "arena" / "frontend"


def bundle(dist: Path = DIST, target: Path = TARGET) -> Path:
    if not (dist / "index.html").is_file():
        print(f"{dist}: no index.html — run `npm run build` in app/ first", file=sys.stderr)
        sys.exit(2)
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(dist, target)
    return target


if __name__ == "__main__":
    print(f"bundled {bundle()}")

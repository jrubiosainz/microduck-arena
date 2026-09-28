"""`workshop` — train, test and publish a policy for one challenge, from a microduck-challenges checkout.

    uv run --group workshop workshop              # the challenges open here
    uv run --group workshop workshop sprint-2m    # the workshop for that one, in the browser

The one line on a challenge's page runs the second form for you.
"""

import argparse
import shutil
import subprocess
import sys
import threading
import webbrowser
from pathlib import Path

from .challenges import open_challenges

SPACE = "https://pollen-robotics-microduck-arena.hf.space"
CHALLENGES = "https://github.com/pollen-robotics/microduck-challenges"


def _checkout() -> Path | None:
    if shutil.which("git") is None:
        return None
    found = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=False)
    return Path(found.stdout.strip()) if found.returncode == 0 else None


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="workshop", description=__doc__.splitlines()[0])
    parser.add_argument("challenge", nargs="?", help="the Arena event, e.g. sprint-2m")
    parser.add_argument("--arena", default=SPACE, help="the Arena to enter the published policy on")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true", help="print the address instead of opening it")
    args = parser.parse_args(argv)

    root = _checkout()
    challenges = open_challenges(root) if root else []
    if not challenges:
        print(f"No open challenge here. Run this inside a clone of {CHALLENGES}.", file=sys.stderr)
        return 2
    chosen = next((c for c in challenges if args.challenge in (c.event, c.folder)), None)
    if chosen is None:
        if args.challenge:
            print(f"{args.challenge!r} is not a challenge open here.", file=sys.stderr)
        print("Open challenges:")
        for c in challenges:
            print(f"  uv run --group workshop workshop {c.event}")
        return 2 if args.challenge else 0

    import uvicorn

    from ..web.config import default_frontend
    from .app import create_workshop_app
    from .hub import Hub

    site = default_frontend(Path(__file__).resolve().parents[1])
    app = create_workshop_app(
        root, chosen, args.arena.rstrip("/"), Hub(), args.port, site if (site / "workshop.html").is_file() else None
    )
    url = f"http://127.0.0.1:{args.port}/"
    print(f"{chosen.event} workshop: {url}  (Ctrl-C to close it)")
    if not args.no_browser:
        threading.Timer(1.0, webbrowser.open, [url]).start()
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
    return 0

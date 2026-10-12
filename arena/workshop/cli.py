"""`workshop` — train, test and publish policies for the challenges of a microduck-challenges checkout.

    uv run --group workshop workshop              # the workshop's home, every open challenge
    uv run --group workshop workshop sprint-2m    # straight to that challenge's page

The one line on a challenge's page runs the second form for you.
"""

import argparse
import os
import shutil
import socket
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


def _port_free(port: int) -> bool:
    """Bound as uvicorn binds (SO_REUSEADDR): refused exactly when uvicorn would be."""
    with socket.socket() as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


CLOSE_WITHIN_S = 1.0


def serve(app, port: int) -> None:
    import uvicorn

    class Server(uvicorn.Server):
        def handle_exit(self, sig, frame):
            super().handle_exit(sig, frame)
            # uvicorn then waits, without limit, for the requests still running — one stuck on an
            # unreachable Hub or GitHub — and Python then for their threads: past a second, leave them.
            # Not at once: uv, which runs the workshop, fails to find a child already gone on Ctrl-C.
            leave = threading.Timer(CLOSE_WITHIN_S, os._exit, [128 + sig])
            leave.daemon = True
            leave.start()

    try:
        Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")).run()
    except KeyboardInterrupt:  # raised again once uvicorn has stopped; uvicorn.run swallows it too
        pass


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="workshop", description=__doc__.splitlines()[0])
    parser.add_argument("challenge", nargs="?",
                        help="an open challenge's event, e.g. sprint-2m, to open straight on its page")
    parser.add_argument("--arena", default=SPACE, help="the Arena to enter the published policy on")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true", help="print the address instead of opening it")
    args = parser.parse_args(argv)

    root = _checkout()
    challenges = open_challenges(root) if root else []
    if not challenges:
        print(f"No open challenge here. Run this inside a clone of {CHALLENGES}.", file=sys.stderr)
        return 2
    chosen = None
    if args.challenge:
        chosen = next((c for c in challenges if args.challenge in (c.event, c.folder)), None)
        if chosen is None:
            names = ", ".join(c.event for c in challenges)
            print(f"{args.challenge!r} is not a challenge open here. Open here: {names}.", file=sys.stderr)
            return 2

    # Before the browser opens: a second workshop on a busy port would open the first one's page.
    if not _port_free(args.port):
        print(f"Port {args.port} is busy — is a workshop already open? Try --port", file=sys.stderr)
        return 2

    from ..web.config import default_frontend
    from .app import create_workshop_app
    from .hub import Hub

    site = default_frontend(Path(__file__).resolve().parents[1])
    app = create_workshop_app(
        root, challenges, args.arena.rstrip("/"), Hub(), args.port, site if (site / "workshop.html").is_file() else None
    )
    url = f"http://127.0.0.1:{args.port}/" + (f"#/c/{chosen.event}" if chosen else "")
    print(f"Microduck workshop: {url}  (Ctrl-C to close it)", flush=True)  # piped, it would wait for exit
    if not args.no_browser:
        threading.Timer(1.0, webbrowser.open, [url]).start()
    serve(app, args.port)
    return 0

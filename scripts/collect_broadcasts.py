"""Keep what a running arena broadcasts: one file per booth that has started.

The channel's book forgets a dialogue twenty airings after it went out, about
seventeen minutes, so measuring what the real channel says means standing next
to it while it says it. This polls the grid and saves each booth once it has
started — a future slot may still be laid again, a started one never is. Leave
it running for a session; scripts/commentary_bench.py reads the directory.

    uv run --frozen python scripts/collect_broadcasts.py \
        https://pollen-robotics-microduck-arena.hf.space ~/arena-sessions/2026-09-21-baseline

A private Space wants the developer's Hub token as a bearer, and that token is
sent to a *.hf.space host only. A local `arena serve` is read the same way.
"""

import argparse
import json
import time
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from huggingface_hub import get_token

POLL_S = 20  # a started slot stays in the grid for two minutes


def on_disk(out: Path) -> set[str]:
    return {path.stem.partition("-")[2] for path in out.glob("*.json")}


def collect(site: str, out: Path, seen: set[str], get) -> int:
    """One poll: every booth that has started and is not on disk yet. How many were new."""
    live = get(f"{site}/api/live")
    fresh = [slot for slot in live["slots"]
             if slot["kind"] == "booth" and slot["at_ms"] <= live["now_ms"]
             and slot["broadcast"] not in seen]
    for slot in fresh:
        body = get(f"{site}/api/live/broadcast/{slot['broadcast']}")
        one = {"at_ms": slot["at_ms"], "build": live["build"], "run_id": slot["run_id"], **body}
        (out / f"{slot['at_ms']}-{slot['broadcast']}.json").write_text(
            json.dumps(one, indent=2, ensure_ascii=False))
        seen.add(slot["broadcast"])
    return len(fresh)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("site", help="the arena's origin, e.g. http://127.0.0.1:8234")
    parser.add_argument("out", type=Path, help="the session's directory")
    args = parser.parse_args()
    site = args.site.rstrip("/")
    args.out.mkdir(parents=True, exist_ok=True)
    on_the_hub = urlsplit(site).hostname.endswith(".hf.space")
    headers = {"Authorization": f"Bearer {get_token()}"} if on_the_hub else {}

    def get(url: str) -> dict:
        response = httpx.get(url, headers=headers, timeout=30)
        response.raise_for_status()
        return response.json()

    seen = on_disk(args.out)
    try:
        while True:
            try:
                if collect(site, args.out, seen, get):
                    print(f"{len(seen)} dialogues in {args.out}")
            except httpx.HTTPError as exc:
                # A rebuild or a blip: the next poll asks again.
                print(f"{type(exc).__name__}: {exc}")
            time.sleep(POLL_S)
    except KeyboardInterrupt:
        print(f"\n{len(seen)} dialogues in {args.out}")


if __name__ == "__main__":
    main()

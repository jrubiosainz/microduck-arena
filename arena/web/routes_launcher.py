"""The one line's launcher, served with this Arena's own address written in.

`uv run <arena>/workshop.py <challenge>` fetches it; the address is how the
workshop sends a published policy back to the Arena it came from — the Space,
or a local `arena serve` standing in for it.
"""

from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import Response

LAUNCHER = Path(__file__).resolve().parents[1] / "workshop" / "launcher.py"
DEFAULT = 'ARENA = "https://pollen-robotics-microduck-arena.hf.space"'

router = APIRouter()


@router.get("/workshop.py")
def launcher(request: Request) -> Response:
    origin = request.app.state.config.public_origin or str(request.base_url).rstrip("/")
    # repr(): whatever the Host header said, it lands in the script as a string literal.
    script = LAUNCHER.read_text().replace(DEFAULT, f"ARENA = {origin!r}", 1)
    return Response(script, media_type="text/x-python", headers={"Cache-Control": "no-cache"})

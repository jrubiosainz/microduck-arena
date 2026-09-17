"""The channel's grid and clock: what every screen reads to find its place."""

import time

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api")


def now_ms() -> int:
    return int(time.time() * 1000)


@router.get("/live")
def live(request: Request) -> JSONResponse:
    programme = request.app.state.programme
    return JSONResponse(
        {"version": 1, "now_ms": now_ms(), "build": request.app.state.build,
         "origin_ms": programme.origin_ms, "slots": programme.slots()},
        headers={"Cache-Control": "no-store"},
    )

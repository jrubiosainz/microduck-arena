"""The channel's grid and clock: what every screen reads to find its place."""

import time

from fastapi import APIRouter, HTTPException, Request
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


@router.get("/live/broadcast/{broadcast_id}")
def broadcast(broadcast_id: str, request: Request) -> dict:
    """The dialogue a booth slot names, and the plan that plays it."""
    one = request.app.state.broadcasts.get(broadcast_id)
    if one is None:
        raise HTTPException(status_code=404, detail="no such broadcast")
    return {"dialogue": one.dialogue, "plan": one.plan}

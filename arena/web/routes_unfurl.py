"""`/r/<run_id>`: the address a shared run travels under.

A hash route cannot carry Open Graph tags, so this page exists for the
crawler: the title, a sentence, the poster and the landscape clip once they
are rendered, then a redirect to the app's own `#/r/<id>`. Everything a
submitter typed is escaped on the way in.
"""

from html import escape

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

from ..index import standing
from ..manifest import load_event
from .routes_read import _find_run, _withdrawn

router = APIRouter()


def describe(record, place, title: str) -> str:
    """One sentence for the card."""
    seeds = len(record.per_seed)
    if record.seeds_finished == 0:
        return f"@{record.user}'s duck went down on {title}: 0/{seeds} seeds finished."
    said = (f"@{record.user}'s duck finished {record.seeds_finished}/{seeds} seeds "
            f"in {record.score:.3f} s on {title}")
    return f"{said}, #{place.rank} on the board." if place.on_board else f"{said}."


def _meta(property_: str, content: str, name: bool = False) -> str:
    key = "name" if name else "property"
    return f'<meta {key}="{property_}" content="{escape(content, quote=True)}">'


@router.get("/r/{run_id}", response_class=HTMLResponse)
def unfurl(run_id: str, request: Request) -> HTMLResponse:
    store = request.app.state.store
    record = _find_run(store, run_id)
    title = load_event(record.event_id).title
    place = standing(store.runs(record.event_id), run_id, withdrawn=_withdrawn(store))
    origin = request.app.state.config.public_origin or str(request.base_url).rstrip("/")
    state, manifest = store.clip_state(run_id)
    app_url = f"/#/r/{run_id}"
    tags = [
        _meta("og:type", "video.other"),
        _meta("og:title", f"@{record.user} · {record.policy_name} · {title}"),
        _meta("og:description", describe(record, place, title)),
        _meta("og:url", f"{origin}/r/{run_id}"),
        _meta("twitter:card", "summary_large_image", name=True),
    ]
    if state == "ready":
        land = manifest["layouts"]["landscape"]
        base = f"{origin}/api/runs/{run_id}/clip"
        tags += [
            _meta("og:image", f"{base}/{manifest['poster']}"),
            _meta("og:image:width", str(land["width"])),
            _meta("og:image:height", str(land["height"])),
            _meta("og:video", f"{base}/{land['file']}"),
            _meta("og:video:type", "video/mp4"),
            _meta("og:video:width", str(land["width"])),
            _meta("og:video:height", str(land["height"])),
        ]
    head = "\n".join(tags)
    page = (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">\n'
        f"<title>{escape(f'@{record.user} · {record.policy_name} · {title} · Microduck Arena')}</title>\n"
        f"{head}\n"
        f'<meta http-equiv="refresh" content="0; url={app_url}">\n'
        f"</head><body><script>location.replace({app_url!r})</script>\n"
        f'<a href="{app_url}">Open this run</a></body></html>\n'
    )
    # A crawler's re-fetch after the clip lands should be soon.
    return HTMLResponse(page, headers={"Cache-Control": "public, max-age=60"})

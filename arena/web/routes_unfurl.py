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
from .routes_read import _find_run, _withdrawn, clip_url

router = APIRouter()


def describe(record, place, event) -> str:
    """One sentence for the card."""
    if event.course.kind == "stage":
        # A performance is never timed or ranked by its length; the public's votes rank it.
        if record.seeds_finished == 0:
            return f"@{record.user}'s duck performed on {event.title}; the performance was cut short."
        return f"@{record.user}'s duck gave a {record.score:.2f} s performance on {event.title}."
    seeds = len(record.per_seed)
    if record.seeds_finished == 0:
        return f"@{record.user}'s duck went down on {event.title}: 0/{seeds} seeds finished."
    said = (f"@{record.user}'s duck finished {record.seeds_finished}/{seeds} seeds "
            f"in {record.score:.3f} s on {event.title}")
    return f"{said}, #{place.rank} on the board." if place.on_board else f"{said}."


def _meta(property_: str, content: str, name: bool = False) -> str:
    key = "name" if name else "property"
    return f'<meta {key}="{property_}" content="{escape(content, quote=True)}">'


@router.get("/r/{run_id}", response_class=HTMLResponse)
def unfurl(run_id: str, request: Request) -> HTMLResponse:
    store = request.app.state.store
    record = _find_run(store, run_id)
    event = load_event(record.event_id)
    title = event.title
    place = standing(store.runs(record.event_id), run_id, withdrawn=_withdrawn(store))
    origin = request.app.state.config.public_origin or str(request.base_url).rstrip("/")
    state, manifest = store.clip_state(run_id)
    app_url = f"/#/r/{run_id}"
    tags = [
        _meta("og:type", "video.other"),
        _meta("og:title", f"@{record.user} · {record.policy_name} · {title}"),
        _meta("og:description", describe(record, place, event)),
        _meta("og:url", f"{origin}/r/{run_id}"),
        _meta("twitter:card", "summary_large_image", name=True),
    ]
    if state == "ready":
        land = manifest["layouts"]["landscape"]
        tags += [
            _meta("og:image", clip_url(run_id, manifest["poster"], manifest, origin)),
            _meta("og:image:width", str(land["width"])),
            _meta("og:image:height", str(land["height"])),
            _meta("og:video", clip_url(run_id, land["file"], manifest, origin)),
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

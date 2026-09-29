# The Workshop Publishes and Enters — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** *Publish and enter* in the workshop, and `uv run publish … --enter` in a shell, publish a policy to the Hub and enter it on the Arena with the user's Hugging Face token. The challenge page stops entering anything.

**Architecture:**
- **microduck_rl.** `publish` gains an `--enter` step. After the upload it POSTs the new revision to the Space's `submit` route, with `Authorization: Bearer <token>`.
- **The Space.**
  - It resolves the token with the Hub's `whoami-v2` and forgets it.
  - It refuses a repo outside the user's namespace and orgs, and races one entry per user at a time.
  - An entry of the same policy (same ONNX sha256) answers the existing entry.
  - It answers with `page_url`.
- **The Arena site** loses its entry panel, the `try` route, the `.onnx` drop zone and the trial lane.
- **The workshop's Publish zone** gains a colour and a speed, and runs `publish --enter`.

**Tech Stack:** Python 3.12, FastAPI, httpx, pytest (Arena); tyro and stdlib `urllib` (microduck_rl's `publish`); Vite 5 + vitest/jsdom (pages).

**Spec:** `docs/superpowers/specs/2026-09-29-workshop-publishes-and-enters-design.md`. It amends `docs/superpowers/specs/2026-09-24-challenge-workshop-design.md`, decision 8.

## Where things are

- **Arena worktree:** `~/Projects/HuggingFace/microduck-arena/.claude/worktrees/plan4-workshop`, branch `plan4-workshop`. All paths below are relative to it unless another repo is named.
- **microduck_rl worktree:** `~/Projects/HuggingFace/microduck_rl/.claude/worktrees/plan4-hf-jobs`, branch `plan4-hf-jobs` (887351f, on draft PR #57's head). It has no venv of its own. Its tests run with the challenges worktree's interpreter:
  `PYTHONPATH=src ~/Projects/HuggingFace/microduck-challenges/.claude/worktrees/plan4-workshop/.venv/bin/python -m pytest …`
- **microduck-challenges worktree:** `~/Projects/HuggingFace/microduck-challenges/.claude/worktrees/plan4-workshop`, branch `plan4-workshop`. Its `.venv` holds the Arena worktree as an editable install.
  - Never `uv run` there without `UV_NO_CONFIG=1 UV_NO_SYNC=1`. A sync puts the locked 0.2.0 Arena wheel back over the editable install. The fix, if it happens: `uv pip install --no-config --python .venv/bin/python --no-deps -e <arena worktree>`.
  - Set `HF_TOKEN=$(cat ~/.cache/huggingface/token)`.
  - It holds a 3-iteration CPU run, `logs/rsl_rl/sprint_2m/2026-09-28_11-04-09_plan4probe/` (checkpoints 0–2).

## Global Constraints

- **Files that belong to the other session.** Never edit:
  - `arena/runner.py`, `arena/golden.py`, `arena/constants.py` (importing `RUNNER_VERSION` is fine);
  - `pyproject.toml`'s version or dependencies;
  - any `uv.lock`;
  - `microduck-challenges/src/microduck_challenges/swag_contest/`.
- **git.** Use `/usr/bin/git`: a hook rewrites `git`. Commit messages are in English and never signed: no `Co-Authored-By`, no "Generated with".
- **Arena commands:**
  - `uv run --no-config --frozen --extra dev pytest -q` (4–5 min);
  - `cd app && npm test` (the 4 failures in `src/brightness.test.js` are the known baseline);
  - `cd app && npm run build`.
- **Run every test and build in the FOREGROUND** with a timeout ≥ 600000 ms. Never start one in the background and wait for a notification.
- **Nothing leaves the machine without the owner's yes.** Nothing is pushed. Nothing is created, changed or deleted on the Hub or GitHub, and no HF job is started, without the owner's yes; Tasks 2 and 10 say where.
- **No file name contains `tfevents`.** The Space's `.gitattributes` sends such a file to LFS.
- **The token never appears** in a log line, an exception message, a response body or a printed line, on either side.
- **No dead code.** Whatever a task makes unused is deleted in that task, with its tests.
- **User-facing copy** is written exactly as given in this plan.

## Review Focus

1. **A non-JSON error page from the Arena's side** (the HF gateway's HTML 404 or 502, for a Space that is private to that person or is rebuilding). `publish --enter` says `502: Bad Gateway` and exits 3, and never crashes on the body. Pinned in Task 3 by `test_a_gateway_error_page_is_said_not_crashed_on`.
2. **A repo namespace that differs from the user's name only by case** ("Nico-robot" vs "nico-robot") is accepted. Pinned in Task 4 by `test_the_namespace_ignores_case`.
3. **A retry after the client gave up while the Space still raced.** The same policy answers the existing entry and races nothing. Pinned in Task 5 by `test_the_same_policy_entered_again_answers_the_entry_already_there`.
4. **An organisation's token** (whoami `type` "org") is refused with 403. A user's token entering a repo of one of their orgs is accepted. Pinned in Task 4 by `test_an_organisations_token_is_refused` and `test_a_repo_of_one_of_your_orgs_is_yours`.
5. **The workshop's Arena is a local `arena serve`** on `http://127.0.0.1:8000`. `publish --enter` accepts loopback http and refuses any other http. Pinned in Task 3: every test enters a loopback server, and `test_the_token_travels_only_over_https_or_to_this_machine` covers the refusal.

---

### Task 1: Bring `main` into `plan4-workshop` (controller)

`main` moved on with runner v4, version 0.3.1 and re-baselined test numbers. Tasks 4 and 5 rewrite `tests/test_routes_submit.py`, which main also touched, so the merge comes first.

**Files:** the merge only. Conflicts are expected in `tests/test_hub_fetch.py` and `tests/test_routes_submit.py`.

- [ ] **Step 1: Merge**

```bash
cd ~/Projects/HuggingFace/microduck-arena/.claude/worktrees/plan4-workshop
/usr/bin/git merge main -m "Merge main (runner v4, version 0.3.1) into plan4-workshop"
```

- [ ] **Step 2: Resolve the conflicts.** Keep the branch's structure: the autouse fake-Hub `hub` fixture, the `submit()` helper routing through `_HUB`, and the manifest tests. Keep main's numbers: golden scores, speeds and per-platform values. Then `/usr/bin/git diff --name-only --diff-filter=U` must print nothing, and you commit with `/usr/bin/git commit --no-edit`.

- [ ] **Step 3: Refresh the challenges venv's editable Arena** (its version metadata is now 0.3.1).

```bash
cd ~/Projects/HuggingFace/microduck-challenges/.claude/worktrees/plan4-workshop
uv pip install --no-config --python .venv/bin/python --no-deps -e ~/Projects/HuggingFace/microduck-arena/.claude/worktrees/plan4-workshop
.venv/bin/python -c "import arena; print(arena.__file__)"   # the worktree's arena/__init__.py
```

- [ ] **Step 4: Run both suites.** Expected: pytest all green, and npm test green except the 4 known brightness failures.

---

### Task 2: Does hf.space pass `Authorization` to the container? (controller, owner's yes first)

The design sends the token as `Authorization: Bearer`. The Space's gateway checks that header for a private Space. Whether it then hands the header to the app has not been observed. The probe also covers a public Space.

**Needs the owner's yes.** It creates `Nico-robot/arena-header-probe` (a private Docker Space), makes it public, then deletes it.

**Files** (scratchpad only, never committed): `probe/README.md`, `probe/Dockerfile`, `probe/app.py`.

- [ ] **Step 1: Write the probe.** It reports whether an `Authorization` header arrived and with which scheme, never its value.

`probe/README.md`:

```markdown
---
title: header probe
sdk: docker
app_port: 7860
---
```

`probe/Dockerfile`:

```dockerfile
FROM python:3.12-slim
COPY app.py /app.py
CMD ["python", "/app.py"]
```

`probe/app.py`:

```python
import json
from http.server import BaseHTTPRequestHandler, HTTPServer


class Probe(BaseHTTPRequestHandler):
    def do_GET(self):
        auth = self.headers.get("Authorization")
        body = {"authorization": auth.split(" ", 1)[0] if auth else None, "length": len(auth or "")}
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(body).encode())


HTTPServer(("0.0.0.0", 7860), Probe).serve_forever()
```

- [ ] **Step 2: Create it, private, and wait until it runs**

```bash
cd <scratchpad>/probe
HF_TOKEN=$(cat ~/.cache/huggingface/token) ~/Projects/HuggingFace/microduck-arena/.claude/worktrees/plan4-workshop/.venv/bin/python - <<'EOF'
import time
from huggingface_hub import HfApi
api = HfApi()
api.create_repo("Nico-robot/arena-header-probe", repo_type="space", space_sdk="docker", private=True)
api.upload_folder(repo_id="Nico-robot/arena-header-probe", repo_type="space", folder_path=".")
while (stage := api.get_space_runtime("Nico-robot/arena-header-probe").stage) != "RUNNING":
    print(stage); time.sleep(10)
print("RUNNING")
EOF
```

- [ ] **Step 3: Probe it, private**

```bash
T=$(cat ~/.cache/huggingface/token); U=https://nico-robot-arena-header-probe.hf.space/
curl -s -o /dev/null -w "without: %{http_code}\n" $U                  # expected 404: private
curl -s -H "Authorization: Bearer $T" $U; echo                        # {"authorization": "Bearer", ...} if passed through
```

- [ ] **Step 4: Make it public, and probe again**, with the real token and with a made-up one.

```bash
HF_TOKEN=$(cat ~/.cache/huggingface/token) ~/Projects/HuggingFace/microduck-arena/.claude/worktrees/plan4-workshop/.venv/bin/python -c "
from huggingface_hub import HfApi; HfApi().update_repo_settings('Nico-robot/arena-header-probe', private=False, repo_type='space')"
curl -s -H "Authorization: Bearer $T" $U; echo
curl -s -w " %{http_code}\n" -H "Authorization: Bearer hf_madeup" $U
```

- [ ] **Step 5: Delete it**

```bash
HF_TOKEN=$(cat ~/.cache/huggingface/token) ~/Projects/HuggingFace/microduck-arena/.claude/worktrees/plan4-workshop/.venv/bin/python -c "
from huggingface_hub import HfApi; HfApi().delete_repo('Nico-robot/arena-header-probe', repo_type='space')"
```

- [ ] **Step 6: Record the decision** in the ledger (`.superpowers/sdd/…/progress.md`) and tell the implementers of Tasks 3 and 4.
  - **Passed through, private and public:** the header. Tasks 3 and 4 as written.
  - **Stripped in either case:** a form field.
    - Task 3's `enter()` drops the `Authorization` header and adds `fields["hf_token"] = token`.
    - Task 4's `_entrant()` reads `hf_token: str | None = Form(default=None)` (passed in from `submit`) instead of the header.
    - The tests assert the field instead of the header, and are otherwise identical.
  - **The made-up token on the public Space.** If the gateway answers it with its own 401 page, note it: that page is the non-JSON error of Review Focus 1.

---

### Task 3: `uv run publish --enter` (microduck_rl)

**Repo:** the microduck_rl worktree.

**Files:**
- Create: `src/mjlab_microduck/publish/arena.py`
- Modify: `src/mjlab_microduck/publish/cli.py` (the docstring's examples; the `PublishConfig` fields; `run()`)
- Test: `tests/test_publish_enter.py`
- Modify: `README.md`, where `uv run publish` is shown (add the `--enter` example of Step 5)

**Interfaces:**
- Produces:
  - the options `--enter`, `--arena URL` (default `https://pollen-robotics-microduck-arena.hf.space`), `--event ID`, `--livery NAME` (default `classic`), `--speed M_S` and `--code-url URL`;
  - on success, a stdout line
    `[publish] entered on <event>: <score:.3f> s (<finished>/<total> seeds) at <vx:.2f> m/s → <page_url>`,
    or `[publish] already entered on …` with the same shape;
  - on a refusal, exit code 3 and the stderr line
    `[publish] uploaded <commit url>, but the Arena did not enter it: <status>: <detail>`.
  - Task 7 parses these lines.
- Consumes: the Space's `submit` answer, a JSON object with `run_id`, `score`, `seeds_finished`, `seeds_total`, `command_vx`, `page_url` and `already_entered` (Task 5).

- [ ] **Step 1: See the suite's baseline**

```bash
cd ~/Projects/HuggingFace/microduck_rl/.claude/worktrees/plan4-hf-jobs
PY=~/Projects/HuggingFace/microduck-challenges/.claude/worktrees/plan4-workshop/.venv/bin/python
PYTHONPATH=src $PY -m pytest tests/ -q 2>&1 | tail -5
```

Write down the failures. `test_hf_jobs_flag.py::test_train_on_path_is_a_mjlab_trainer` fails in this interpreter (it needs microduck_rl's own `train` shim on PATH). Whatever fails here must fail identically at the end, and nothing else.

- [ ] **Step 2: Write the failing tests** in `tests/test_publish_enter.py`:

```python
"""`uv run publish --enter`: after the upload, the Arena races the new revision and says where to see it.

The Hub is a fake HfApi; the Arena is a local HTTP server that records what it was sent and
answers what the Space answers.
"""

from __future__ import annotations

import json
import socket
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from types import SimpleNamespace
from urllib.parse import parse_qs

import pytest

from tests.test_publish_manifest import _run_dir, fake_mjlab, sprint_challenge  # noqa: F401  (fixtures)

REV = "c0ffee" + "0" * 34
PAGE = "https://huggingface.co/spaces/pollen-robotics/microduck-arena#/r/run42"
ENTERED = {"run_id": "run42", "score": 4.892, "seeds_finished": 5, "seeds_total": 5, "command_vx": 0.55,
           "page_url": PAGE}


class FakeHub:
    """huggingface_hub.HfApi, as publish uses it."""

    private = False
    calls: list = []

    def __init__(self, *args, **kwargs):
        pass

    def create_repo(self, repo, **kwargs):
        FakeHub.calls.append(("create_repo", repo))

    def repo_info(self, repo):
        return SimpleNamespace(private=FakeHub.private)

    def list_repo_files(self, repo):
        return []

    def upload_folder(self, repo_id, **kwargs):
        FakeHub.calls.append(("upload_folder", repo_id))
        return SimpleNamespace(oid=REV, commit_url=f"https://huggingface.co/{repo_id}/commit/{REV}")

    def create_tag(self, *args, **kwargs):
        pass


@pytest.fixture
def hub(monkeypatch):
    import huggingface_hub

    FakeHub.private, FakeHub.calls = False, []
    monkeypatch.setattr(huggingface_hub, "HfApi", FakeHub)
    monkeypatch.setenv("HF_TOKEN", "hf_test")
    return FakeHub


@pytest.fixture
def arena():
    """The Arena's submit route: records each request, answers `reply`."""
    seen = []
    reply = {"status": 200, "type": "application/json", "body": json.dumps(ENTERED)}

    class Submit(BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers["Content-Length"])
            fields = {k: v[0] for k, v in parse_qs(self.rfile.read(length).decode()).items()}
            seen.append({"path": self.path, "authorization": self.headers.get("Authorization"), "fields": fields})
            self.send_response(reply["status"])
            self.send_header("Content-Type", reply["type"])
            self.end_headers()
            self.wfile.write(reply["body"].encode())

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Submit)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield SimpleNamespace(url=f"http://127.0.0.1:{server.server_port}", seen=seen, reply=reply)
    server.shutdown()


def _publish(tmp_path, monkeypatch, **fields):
    from mjlab_microduck.publish.cli import PublishConfig, run

    monkeypatch.chdir(tmp_path)
    return run(PublishConfig(repo="alice/microduck-sprint", run=str(_run_dir(tmp_path)), private=False,
                             enter=True, **fields))


def test_enter_races_the_revision_just_uploaded_with_the_token(tmp_path, monkeypatch, fake_mjlab,
                                                               sprint_challenge, hub, arena, capsys):
    code_url = "https://github.com/alice/microduck-challenges/tree/3f9c2d1ab"
    assert _publish(tmp_path, monkeypatch, arena=arena.url, livery="yellow", speed=0.55, code_url=code_url) == 0
    (sent,) = arena.seen
    assert sent["path"] == "/api/events/sprint-2m/submit"
    assert sent["authorization"] == "Bearer hf_test"
    assert sent["fields"] == {"repo_id": "alice/microduck-sprint", "revision": REV, "name": "sprint",
                              "livery": "yellow", "command_vx": "0.55", "env_url": code_url}
    out = capsys.readouterr().out
    assert f"[publish] entered on sprint-2m: 4.892 s (5/5 seeds) at 0.55 m/s → {PAGE}" in out
    assert "hf_test" not in out


def test_a_sweep_sends_no_speed_and_no_code_link(tmp_path, monkeypatch, fake_mjlab, sprint_challenge, hub, arena):
    assert _publish(tmp_path, monkeypatch, arena=arena.url) == 0
    fields = arena.seen[0]["fields"]
    assert "command_vx" not in fields and "env_url" not in fields
    assert fields["livery"] == "classic"


def test_an_entry_already_on_the_board_is_said(tmp_path, monkeypatch, fake_mjlab, sprint_challenge, hub, arena,
                                               capsys):
    arena.reply["body"] = json.dumps(ENTERED | {"already_entered": True})
    assert _publish(tmp_path, monkeypatch, arena=arena.url) == 0
    assert "[publish] already entered on sprint-2m: 4.892 s" in capsys.readouterr().out


def test_a_refusal_is_said_after_the_upload_and_exits_3(tmp_path, monkeypatch, fake_mjlab, sprint_challenge, hub,
                                                         arena, capsys):
    arena.reply.update(status=403, body=json.dumps({"detail": "bob/x is not yours to enter"}))
    assert _publish(tmp_path, monkeypatch, arena=arena.url) == 3
    err = capsys.readouterr().err
    assert (f"[publish] uploaded https://huggingface.co/alice/microduck-sprint/commit/{REV}, "
            "but the Arena did not enter it: 403: bob/x is not yours to enter") in err
    assert ("upload_folder", "alice/microduck-sprint") in hub.calls
    assert "hf_test" not in err


def test_a_gateway_error_page_is_said_not_crashed_on(tmp_path, monkeypatch, fake_mjlab, sprint_challenge, hub,
                                                     arena, capsys):
    arena.reply.update(status=502, type="text/html", body="<html><h1>Bad Gateway</h1></html>")
    assert _publish(tmp_path, monkeypatch, arena=arena.url) == 3
    assert "did not enter it: 502: Bad Gateway" in capsys.readouterr().err


def test_an_arena_that_does_not_answer_is_said(tmp_path, monkeypatch, fake_mjlab, sprint_challenge, hub, capsys):
    with socket.socket() as nobody:  # bound, then closed: nothing listens there
        nobody.bind(("127.0.0.1", 0))
        port = nobody.getsockname()[1]
    assert _publish(tmp_path, monkeypatch, arena=f"http://127.0.0.1:{port}") == 3
    assert "did not answer" in capsys.readouterr().err


@pytest.mark.parametrize("url", ["http://arena.example", "ftp://127.0.0.1"])
def test_the_token_travels_only_over_https_or_to_this_machine(url, tmp_path, monkeypatch, fake_mjlab,
                                                             sprint_challenge, hub, capsys):
    with pytest.raises(SystemExit):
        _publish(tmp_path, monkeypatch, arena=url)
    assert "--arena" in capsys.readouterr().err
    assert fake_mjlab == [] and hub.calls == [], "refused before the export and the upload"


def test_a_private_repo_is_refused_before_the_upload(tmp_path, monkeypatch, fake_mjlab, sprint_challenge, hub,
                                                     arena, capsys):
    hub.private = True
    with pytest.raises(SystemExit):
        _publish(tmp_path, monkeypatch, arena=arena.url)
    assert "public" in capsys.readouterr().err
    assert ("upload_folder", "alice/microduck-sprint") not in hub.calls and arena.seen == []


def test_enter_needs_a_token(tmp_path, monkeypatch, fake_mjlab, sprint_challenge, hub, arena, capsys):
    import huggingface_hub

    monkeypatch.setattr(huggingface_hub, "get_token", lambda: None)
    with pytest.raises(SystemExit):
        _publish(tmp_path, monkeypatch, arena=arena.url)
    assert "token" in capsys.readouterr().err
    assert hub.calls == [] and arena.seen == []


def test_a_policy_not_a_challenges_needs_its_event_and_records_it(tmp_path, monkeypatch, fake_mjlab, hub, arena,
                                                                  capsys):
    from mjlab_microduck.publish.cli import PublishConfig, run

    monkeypatch.chdir(tmp_path)
    run_dir = _run_dir(tmp_path, task="Mjlab-Velocity-Flat-MicroDuck")
    common = dict(repo="alice/microduck-glide", run=str(run_dir), kind="perpetual", slot="walk", private=False,
                  enter=True, arena=arena.url)
    with pytest.raises(SystemExit):
        run(PublishConfig(**common))
    assert "--event" in capsys.readouterr().err
    assert run(PublishConfig(**common, event="sprint-2m")) == 0
    assert arena.seen[0]["path"] == "/api/events/sprint-2m/submit"
    assert run(PublishConfig(**common, event="sprint-2m", dry_run=True)) == 0
    manifest = json.loads((tmp_path / "publish-glide" / "manifest.json").read_text())
    assert manifest["arena"] == {"event": "sprint-2m"}


def test_event_is_for_a_policy_that_is_not_a_challenges(tmp_path, monkeypatch, fake_mjlab, sprint_challenge, hub,
                                                        arena, capsys):
    with pytest.raises(SystemExit):
        _publish(tmp_path, monkeypatch, arena=arena.url, event="hill-climb-1m5")
    assert "--event" in capsys.readouterr().err
    assert hub.calls == []


def test_without_enter_nothing_goes_to_the_arena(tmp_path, monkeypatch, fake_mjlab, sprint_challenge, hub, arena):
    from mjlab_microduck.publish.cli import PublishConfig, run

    monkeypatch.chdir(tmp_path)
    assert run(PublishConfig(repo="alice/microduck-sprint", run=str(_run_dir(tmp_path)), private=False,
                             arena=arena.url)) == 0
    assert arena.seen == []
```

- [ ] **Step 3: Run them to see them fail**

```bash
PYTHONPATH=src $PY -m pytest tests/test_publish_enter.py -q 2>&1 | tail -15
```

Expected: every test fails with `TypeError: … unexpected keyword argument 'enter'`, or `'arena'` / `'event'` for the last ones.

- [ ] **Step 4: Write `src/mjlab_microduck/publish/arena.py`**

```python
"""Entering a published policy on the Microduck Arena: one POST to its event's submit route.

The Arena races the repo at the revision just uploaded, on its own machine, and answers
with the time and the entry's page. It knows who is entering from the Hugging Face token
sent with the request, which it checks with the Hub and does not keep; so the token only
ever travels over https, or to this machine for a local `arena serve`.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

ARENA = "https://pollen-robotics-microduck-arena.hf.space"
# The Arena answers once it has raced a whole sweep: half a minute, more when it is busy.
ENTER_TIMEOUT_S = 600.0
_THIS_MACHINE = {"127.0.0.1", "localhost"}


class EnterError(RuntimeError):
    """The Arena did not enter the policy. The message is its answer."""


@dataclass(frozen=True)
class Entry:
    run_id: str
    score: float
    seeds_finished: int
    seeds_total: int
    command_vx: float
    page_url: str
    already: bool


def check_arena(url: str) -> str:
    """The Arena's address without a trailing slash, or ValueError where a token must not go."""
    parts = urllib.parse.urlsplit(url)
    if parts.scheme == "https" or (parts.scheme == "http" and parts.hostname in _THIS_MACHINE):
        return url.rstrip("/")
    raise ValueError(f"--arena {url}: your token travels with the entry, so the Arena must be https, "
                     "or http on 127.0.0.1 for a local one")


def enter(arena: str, event: str, token: str, *, repo: str, revision: str, name: str, livery: str,
          speed: float | None, code_url: str | None) -> Entry:
    fields = {"repo_id": repo, "revision": revision, "name": name, "livery": livery}
    if speed is not None:
        fields["command_vx"] = f"{speed:g}"
    if code_url:
        fields["env_url"] = code_url
    request = urllib.request.Request(
        f"{arena}/api/events/{urllib.parse.quote(event)}/submit",
        data=urllib.parse.urlencode(fields).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=ENTER_TIMEOUT_S) as answer:
            body = json.load(answer)
    except urllib.error.HTTPError as e:
        raise EnterError(f"{e.code}: {_detail(e)}") from None
    except (urllib.error.URLError, TimeoutError) as e:
        raise EnterError(f"{arena} did not answer: {getattr(e, 'reason', e)}") from None
    return Entry(run_id=body["run_id"], score=body["score"], seeds_finished=body["seeds_finished"],
                 seeds_total=body["seeds_total"], command_vx=body["command_vx"], page_url=body["page_url"],
                 already=bool(body.get("already_entered")))


def _detail(e: urllib.error.HTTPError) -> str:
    """The Arena's own sentence; a gateway's HTML error page has none, only its status."""
    try:
        detail = json.loads(e.read()).get("detail")
    except (ValueError, AttributeError):
        detail = None
    return str(detail) if detail else e.reason


def entered_line(event: str, entry: Entry) -> str:
    said = "already entered" if entry.already else "entered"
    return (f"[publish] {said} on {event}: {entry.score:.3f} s ({entry.seeds_finished}/{entry.seeds_total} "
            f"seeds) at {entry.command_vx:.2f} m/s → {entry.page_url}")
```

- [ ] **Step 5: Wire it into `cli.py`**
  - **Import:** add `from mjlab_microduck.publish.arena import ARENA, EnterError, check_arena, enter, entered_line`.
  - **Module docstring:** after the `--run` example, add
    ```
        # Published and entered on the Arena in one go (a challenge's run knows its event)
        uv run publish --run logs/rsl_rl/sprint/2026-09-25_10-00-00_first --repo <user>/microduck-sprint --no-private --enter
    ```
  - **`PublishConfig`:** add this section right before `# -- how`:

```python
    # -- entering it on the Arena
    enter: bool = False
    """After the upload, enter the policy on the Arena, at the revision just made."""
    arena: str = ARENA
    """--enter: the Arena. https, or http on 127.0.0.1 for a local `arena serve`."""
    event: str | None = None
    """The Arena event, for a policy that is not a challenge's (--onnx, a library task). Also
    written as the manifest's `arena.event`."""
    livery: str = "classic"
    """--enter: its colour on the Arena's board."""
    speed: float | None = None
    """--enter: a forward speed to be timed at, in m/s. Left out, the Arena sweeps the event's range."""
    code_url: str | None = None
    """--enter: a link to the code that trained it, shown on its row."""
```

In `run()`, five changes, in order:

```python
def run(cfg: PublishConfig) -> int:
    if "/" not in cfg.repo:
        _fail("--repo must be `<user-or-org>/<name>`")
    name = cfg.name or _default_name(cfg.repo)
    arena = None
    if cfg.enter:  # before anything is exported: a token must not go where this points
        try:
            arena = check_arena(cfg.arena)
        except ValueError as e:
            _fail(str(e))
```

Replace the two lines that read `found` and build `arena=`:

```python
        task_id = training.get("task_id")
        found = ch.for_task(task_id) if task_id else None
        if found and cfg.event:
            _fail(f"{task_id} is the {found.event} challenge's task: --event is for a policy that is not a challenge's")
        event = found.event if found else cfg.event
        if cfg.enter and not event:
            _fail("--enter needs the event to enter: this policy is not a challenge's, so pass --event <id>")
```

In the `m.build_manifest(...)` call, replace `arena={"event": found.event} if found else None,` with:

```python
            arena={"event": event} if event else None,
```

After the dry-run `return 0`, in place of `from huggingface_hub import HfApi` down to the `create_repo` line:

```python
        from huggingface_hub import HfApi, get_token

        token = get_token() if cfg.enter else None
        if cfg.enter and not token:
            _fail("--enter needs your Hugging Face token: `hf auth login`, or HF_TOKEN")
        api = HfApi()
        api.create_repo(cfg.repo, repo_type="model", private=cfg.private, exist_ok=True)
        if cfg.enter and api.repo_info(cfg.repo).private:
            _fail(f"{cfg.repo} is private and the Arena reads public repos only: pass --no-private for a new "
                  "repo, or make it public on the Hub")
```

After the `print(f"[publish] on a robot: {first}")` line, before `return 0`:

```python
        if cfg.enter:
            try:
                entry = enter(arena, event, token, repo=cfg.repo, revision=commit.oid, name=name,
                              livery=cfg.livery, speed=cfg.speed, code_url=cfg.code_url)
            except EnterError as e:
                print(f"[publish] uploaded {url}, but the Arena did not enter it: {e}", file=sys.stderr)
                return 3
            print(entered_line(event, entry))
```

- **README.** Add, next to the `uv run publish` example:
  `uv run publish --run logs/rsl_rl/<experiment>/<run> --repo <you>/microduck-<name> --no-private --enter`, with one sentence: "`--enter` also enters it on the Microduck Arena and prints its time and page."

- [ ] **Step 6: Run the new tests, then the whole suite**

```bash
PYTHONPATH=src $PY -m pytest tests/test_publish_enter.py -q 2>&1 | tail -3     # 14 passed
PYTHONPATH=src $PY -m pytest tests/ -q 2>&1 | tail -5                           # Step 1's failures, and no other
```

- [ ] **Step 7: Commit** (in the microduck_rl worktree)

```bash
/usr/bin/git add src/mjlab_microduck/publish/arena.py src/mjlab_microduck/publish/cli.py tests/test_publish_enter.py README.md
/usr/bin/git commit -m "publish --enter: enter the new revision on the Microduck Arena with the user's token

The Arena races it and answers the time and the entry's page, which publish prints. The
token goes only over https or to this machine; a private repo, a policy with no event and
a missing token are refused before the upload; a refusal after it exits 3 with the
Arena's words. --event names the event of a policy that is not a challenge's."
```

---

### Task 4: The Space credits an entry to the token's owner

**Files:**
- Create: `arena/web/hub_identity.py`, `tests/test_hub_identity.py`
- Modify: `arena/web/routes_submit.py` (the gate of `submit`), `arena/web/app.py` (`app.state.racing`)
- Test: `tests/test_routes_submit.py`

**Interfaces:**
- Produces:
  - `hub_identity.whoami(token: str) -> HubUser`, with `HubUser(name: str, kind: str, orgs: frozenset[str])`;
  - the exceptions `TokenRefused` and `HubUnreachable`;
  - in `routes_submit`, `async _entrant(request) -> tuple[str, frozenset[str] | None]` and `_require_own_repo(repo_id, user, orgs)`;
  - `app.state.racing: set[str]`.
  - Task 5 builds on all of these.
- Consumes: the Task 2 decision (header, or `hf_token` form field).

- [ ] **Step 1: Write the failing tests for `whoami`** in `tests/test_hub_identity.py`:

```python
"""Who a token belongs to, asked of the Hub: a local server stands in for whoami-v2."""

import json
import socket
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from arena.web import hub_identity
from arena.web.hub_identity import HubUnreachable, HubUser, TokenRefused, whoami


@pytest.fixture
def hub(monkeypatch):
    answer = {"status": 200, "body": {"type": "user", "name": "alice", "orgs": [{"name": "duck-lab"}]}}
    seen = []

    class WhoAmI(BaseHTTPRequestHandler):
        def do_GET(self):
            seen.append(self.headers.get("Authorization"))
            self.send_response(answer["status"])
            self.end_headers()
            self.wfile.write(json.dumps(answer["body"]).encode())

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), WhoAmI)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    monkeypatch.setattr(hub_identity, "WHOAMI_URL", f"http://127.0.0.1:{server.server_port}/api/whoami-v2")
    yield answer, seen
    server.shutdown()


def test_a_users_token_names_them_and_their_orgs(hub):
    assert whoami("hf_alice") == HubUser("alice", "user", frozenset({"duck-lab"}))
    assert hub[1] == ["Bearer hf_alice"]


def test_an_organisations_token_says_so(hub):
    hub[0]["body"] = {"type": "org", "name": "duck-lab"}
    assert whoami("hf_org").kind == "org"


def test_a_refused_token(hub):
    hub[0].update(status=401, body={"error": "Invalid credentials in Authorization header"})
    with pytest.raises(TokenRefused):
        whoami("hf_bad")


def test_a_hub_in_trouble_is_unreachable(hub):
    hub[0].update(status=503, body={})
    with pytest.raises(HubUnreachable, match="503"):
        whoami("hf_alice")


def test_no_hub_at_all_is_unreachable_and_the_token_is_not_repeated(monkeypatch):
    with socket.socket() as nobody:
        nobody.bind(("127.0.0.1", 0))
        port = nobody.getsockname()[1]
    monkeypatch.setattr(hub_identity, "WHOAMI_URL", f"http://127.0.0.1:{port}/api/whoami-v2")
    with pytest.raises(HubUnreachable) as caught:
        whoami("hf_secret")
    assert "hf_secret" not in str(caught.value)
```

- [ ] **Step 2: Run to see them fail.** Run `uv run --no-config --frozen --extra dev pytest -q tests/test_hub_identity.py`. Expected: `ModuleNotFoundError: No module named 'arena.web.hub_identity'`.

- [ ] **Step 3: Write `arena/web/hub_identity.py`**

```python
"""Who a Hugging Face token belongs to, asked of the Hub itself. The token is never kept.

An entry is credited to whoever's token `publish --enter` sends. The Space reads the name
and the organisations from the Hub's whoami-v2, then drops the token: nothing here stores,
logs or repeats it, and every error below is worded without it.
"""

from dataclasses import dataclass

import httpx

WHOAMI_URL = "https://huggingface.co/api/whoami-v2"
WHOAMI_TIMEOUT_S = 10.0


@dataclass(frozen=True)
class HubUser:
    name: str
    kind: str  # "user"; "org" for an organisation's token
    orgs: frozenset[str]


class TokenRefused(Exception):
    """The Hub does not know this token."""


class HubUnreachable(Exception):
    """The Hub did not say who this is."""


def whoami(token: str) -> HubUser:
    try:
        answer = httpx.get(WHOAMI_URL, headers={"Authorization": f"Bearer {token}"}, timeout=WHOAMI_TIMEOUT_S)
    except httpx.TransportError:
        raise HubUnreachable("huggingface.co did not answer") from None
    if answer.status_code == 401:
        raise TokenRefused
    if answer.status_code != 200:
        raise HubUnreachable(f"huggingface.co answered {answer.status_code}")
    body = answer.json()
    return HubUser(name=body["name"], kind=body.get("type", ""),
                   orgs=frozenset(org["name"] for org in body.get("orgs", [])))
```

- [ ] **Step 4: Run `tests/test_hub_identity.py`.** Expected: 5 passed.

- [ ] **Step 5: Write the failing route tests.** In `tests/test_routes_submit.py`, add the imports, fixture and helper under the existing `submit()` helper:

```python
import logging

from arena.web.hub_identity import HubUnreachable, HubUser, TokenRefused

TOKENS = {
    "hf_alice": HubUser("alice", "user", frozenset({"duck-lab"})),
    "hf_org": HubUser("duck-lab", "org", frozenset()),
}


@pytest.fixture
def hub_users(monkeypatch):
    """Stands in for the Hub's whoami-v2. Records the tokens it was asked about."""
    asked = []

    def whoami(token):
        asked.append(token)
        if token == "hf_down":
            raise HubUnreachable("huggingface.co did not answer")
        if token not in TOKENS:
            raise TokenRefused
        return TOKENS[token]

    monkeypatch.setattr("arena.web.routes_submit._whoami", whoami)
    return asked


def enter(api, token="hf_alice", repo_id="alice/walker", path=REFERENCE, event="sprint-2m", **fields):
    """What `publish --enter` sends: a repo, and the token in Authorization."""
    _HUB[repo_id] = Path(path)
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return api.post(f"/api/events/{event}/submit", data={"repo_id": repo_id, **fields}, headers=headers)
```

The tests:

```python
def test_an_entry_is_credited_to_the_tokens_owner(spaced_api, hub_users):
    response = enter(spaced_api)
    assert response.status_code == 200, response.text
    assert response.json()["user"] == "alice"
    assert hub_users == ["hf_alice"]


def test_without_a_token_it_says_how_to_enter(spaced_api, hub, hub_users):
    response = enter(spaced_api, token=None)
    assert response.status_code == 401
    assert "uv run publish" in response.json()["detail"] and "--enter" in response.json()["detail"]
    assert hub == [], "nothing fetched for an entry nobody can be credited with"


def test_a_session_cookie_does_not_enter(spaced_api, hub_users):
    sign_in(spaced_api, username="alice")
    assert enter(spaced_api, token=None).status_code == 401


def test_a_refused_token_is_401(spaced_api, hub_users):
    response = enter(spaced_api, token="hf_nobody")
    assert response.status_code == 401 and response.json()["detail"] == "Hugging Face refused this token."


def test_an_unreachable_hub_is_503(spaced_api, hub_users):
    assert enter(spaced_api, token="hf_down").status_code == 503


def test_an_organisations_token_is_refused(spaced_api, hub_users):
    response = enter(spaced_api, token="hf_org", repo_id="duck-lab/walker")
    assert response.status_code == 403 and "person" in response.json()["detail"]


def test_a_repo_outside_your_namespace_is_refused(spaced_api, hub, hub_users):
    response = enter(spaced_api, repo_id="bob/walker")
    assert response.status_code == 403 and "bob/walker" in response.json()["detail"]
    assert hub == []


def test_a_repo_of_one_of_your_orgs_is_yours(spaced_api, hub_users):
    assert enter(spaced_api, repo_id="duck-lab/walker").status_code == 200


def test_the_namespace_ignores_case(spaced_api, hub_users):
    assert enter(spaced_api, repo_id="Alice/walker").status_code == 200


def test_one_entry_races_at_a_time(spaced_api, hub, hub_users):
    spaced_api.app.state.racing.add("alice")  # as while an earlier entry of hers is being raced
    response = enter(spaced_api)
    assert response.status_code == 409 and "still racing" in response.json()["detail"]
    assert hub == []


def test_the_racing_mark_goes_whatever_the_outcome(spaced_api, hub_users, tmp_path):
    junk = tmp_path / "junk.onnx"
    junk.write_bytes(b"not a model")
    assert enter(spaced_api, path=junk).status_code == 400
    assert spaced_api.app.state.racing == set()


def test_the_token_is_never_logged_nor_repeated(spaced_api, hub_users, caplog):
    caplog.set_level(logging.DEBUG)
    answers = [enter(spaced_api, token=t, repo_id=r)
               for t, r in [("hf_alice", "alice/walker"), ("hf_nobody", "alice/walker"),
                            ("hf_alice", "bob/walker"), ("hf_org", "duck-lab/walker"), ("hf_down", "alice/walker")]]
    for token in ("hf_alice", "hf_nobody", "hf_org", "hf_down"):
        assert token not in caplog.text
        assert all(token not in a.text for a in answers)


def test_a_local_arena_needs_no_token_and_checks_no_namespace(api, hub_users):
    response = enter(api, token=None, repo_id="bob/walker")
    assert response.status_code == 200 and response.json()["user"] == "coralie"
    assert hub_users == []
```

**Convert the tests that entered with a session cookie** on `spaced_api`:
- `test_a_signed_in_run_is_recorded_under_the_hub_username` becomes `enter(spaced_api, name="walker")` with the `hub_users` fixture.
- `test_publishing_signed_out_is_refused` and `test_a_signed_out_publish_is_refused_and_records_nothing` become `enter(spaced_api, token=None)`. They still expect 401 and nothing recorded.
- Leave every `/try` test alone: Task 5 deletes them.
- Leave the withdraw and seen tests on the cookie: those routes keep it.

- [ ] **Step 6: Run to see them fail.** Run `uv run --no-config --frozen --extra dev pytest -q tests/test_routes_submit.py`. Expected failures: `AttributeError … _whoami` for every test using `hub_users`; `app.state` has no `racing`.

- [ ] **Step 7: Implement.** In `arena/web/app.py`, next to `app.state.sessions = Sessions()`:

```python
    app.state.racing = set()  # users whose entry is being raced: one at a time each
```

In `arena/web/routes_submit.py`, add the imports:

```python
from ..hub_fetch import FetchedPolicy, FetchError, fetch_policy, parse_repo_ref
from .hub_identity import HubUnreachable, TokenRefused, whoami
```

Add, after `_require_session`:

```python
ENTER_WITH_PUBLISH = (
    "Enter from the workshop, or with `uv run publish … --enter`: it sends your Hugging Face "
    "token, which says who you are."
)


def _whoami(token: str):
    """Wrapped so tests replace one function rather than the Hub."""
    return whoami(token)


async def _entrant(request: Request) -> tuple[str, frozenset[str] | None]:
    """Who is entering, and the organisations whose repos they may enter too.

    On the Space: the Hugging Face token `publish --enter` sends, checked with the Hub and then
    dropped. The session cookie does not enter: the site has no entry form. A local Arena has no
    identity to check: its dev user enters, from any namespace (None).
    """
    config = request.app.state.config
    if not config.oauth_enabled:
        return config.dev_user, None
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=401, detail=ENTER_WITH_PUBLISH)
    try:
        user = await run_in_threadpool(_whoami, token.strip())
    except TokenRefused:
        raise HTTPException(status_code=401, detail="Hugging Face refused this token.") from None
    except HubUnreachable as exc:
        raise HTTPException(
            status_code=503, detail=f"The Arena could not ask Hugging Face who you are ({exc}). Try again."
        ) from None
    if user.kind != "user":
        raise HTTPException(
            status_code=403,
            detail="An entry is credited to a person: enter with your own token, not an organisation's.",
        )
    return user.name, user.orgs


def _require_own_repo(repo_id: str, user: str, orgs: frozenset[str] | None) -> None:
    """Credit goes to whoever enters: a repo in someone else's namespace is theirs to enter."""
    if orgs is None:
        return
    try:
        owner = parse_repo_ref(repo_id)[0].split("/")[0].casefold()
    except FetchError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if owner != user.casefold() and owner not in {org.casefold() for org in orgs}:
        raise HTTPException(
            status_code=403,
            detail=f"{repo_id} is not yours to enter: its namespace is neither {user} nor one of your organisations.",
        )
```

In `submit`, replace `session = _require_session(request)` and everything after it with the version below. The body between `try:` and `finally:` is the current body, unchanged except that `user=session.username` becomes `user=user`.

```python
    # Who, before any of the expensive work: an entry nobody can be credited with is not worth
    # thirty seconds of a shared CPU.
    user, orgs = await _entrant(request)
    if file is not None or not repo_id:
        raise HTTPException(status_code=400, detail=PUBLISH_A_REPO)
    _require_own_repo(repo_id, user, orgs)
    link = _env_url(env_url)
    racing = request.app.state.racing
    if user in racing:
        raise HTTPException(status_code=409, detail="Your previous entry is still racing: wait for its result.")
    racing.add(user)
    try:
        ...  # the current body, from `manifest, policy, result, _payload, fetched = await _race(` to its `return {...}`
    finally:
        racing.discard(user)
```

- [ ] **Step 8: Run `tests/test_hub_identity.py` and `tests/test_routes_submit.py`, then the whole suite.** Expected: all green.

- [ ] **Step 9: Commit**

```bash
/usr/bin/git add arena/web/hub_identity.py arena/web/routes_submit.py arena/web/app.py tests/test_hub_identity.py tests/test_routes_submit.py
/usr/bin/git commit -m "Submit: credit an entry to the owner of the Hugging Face token it carries

The Space asks the Hub's whoami-v2 who the token is, then drops it; the session cookie no
longer enters. A repo outside the user's namespace and orgs is refused, an organisation's
token too, and each user has one entry racing at a time. A local Arena keeps its dev user."
```

---

### Task 5: `submit` takes only a repo, answers an entry already there, and says where to see it; `try` goes

**Files:**
- Modify: `arena/web/routes_submit.py` (the module docstring, `submit`, the helpers), `arena/web/config.py` (`space_id`)
- Test: `tests/test_routes_submit.py`, and any other test that posts to `/try`: `grep -rln "/try" tests/`

**Interfaces:**
- Produces: `submit`'s answer, a JSON object with
  - `run_id`, `user`, `policy_name`, `livery`, `score`, `command_vx`;
  - `model_stored`, `offers_download`, `policy_url`;
  - `seeds_finished`, `seeds_total`, `per_seed`, `trace_seed`;
  - `page_url: str` and `already_entered: bool`.
  - `ArenaConfig.space_id: str | None`.
- Consumes: Task 4's `_entrant` and `_require_own_repo`.

- [ ] **Step 1: Write the failing tests** in `tests/test_routes_submit.py`:

```python
def test_the_same_policy_entered_again_answers_the_entry_already_there(api, monkeypatch):
    first = enter(api, token=None).json()
    raced = []
    monkeypatch.setattr("arena.web.routes_submit.evaluate", lambda *a: raced.append(a))
    again = enter(api, token=None, name="another name")
    assert again.status_code == 200
    body = again.json()
    assert body["already_entered"] is True and body["run_id"] == first["run_id"]
    assert body["score"] == first["score"] and body["page_url"] == first["page_url"]
    assert raced == [], "not raced again"
    assert [r["run_id"] for r in api.get("/api/events/sprint-2m/leaderboard").json()["rows"]] == [first["run_id"]]


def test_a_withdrawn_entry_can_be_entered_again(api):
    first = enter(api, token=None).json()
    assert api.post(f"/api/runs/{first['run_id']}/withdraw").status_code == 200
    again = enter(api, token=None).json()
    assert again["already_entered"] is False and again["run_id"] != first["run_id"]


def test_an_entry_from_an_older_runner_is_not_the_same_entry(api, monkeypatch):
    from arena.constants import RUNNER_VERSION

    first = enter(api, token=None).json()
    monkeypatch.setattr("arena.web.routes_submit.RUNNER_VERSION", RUNNER_VERSION + 1)
    again = enter(api, token=None).json()
    assert again["already_entered"] is False and again["run_id"] != first["run_id"]


def test_the_answer_says_where_to_see_the_entry(api):
    body = enter(api, token=None).json()
    assert body["page_url"] == f"https://testserver/#/r/{body['run_id']}"
    assert body["already_entered"] is False


def test_on_hugging_face_the_page_is_the_spaces_own(store_dir, monkeypatch, hub_users):
    monkeypatch.setenv("OAUTH_CLIENT_ID", "cid")
    monkeypatch.setenv("OAUTH_CLIENT_SECRET", "csecret")
    monkeypatch.setenv("SPACE_HOST", "pollen-robotics-microduck-arena.hf.space")
    monkeypatch.setenv("SPACE_ID", "pollen-robotics/microduck-arena")
    space = TestClient(create_app(ArenaConfig.from_env(store_dir=store_dir, dev_user="coralie")),
                       base_url="https://testserver")
    body = enter(space).json()
    assert body["page_url"] == f"https://huggingface.co/spaces/pollen-robotics/microduck-arena#/r/{body['run_id']}"


def test_a_file_is_not_an_entry(api):
    response = api.post("/api/events/sprint-2m/submit",
                        files={"file": ("p.onnx", REFERENCE.read_bytes(), "application/octet-stream")})
    assert response.status_code == 400
    assert "--enter" in response.json()["detail"]


def test_there_is_no_trial_route_any_more(api):
    assert api.post("/api/events/sprint-2m/try", data={"repo_id": "alice/walker"}).status_code in (404, 405)
```

Then delete every test that posts to `/try`, including those built on a `try_it` helper, and the helper itself: `grep -n "/try\|try_it" tests/*.py`. The `/try` assertion in `test_nothing_is_recorded_when_a_submission_is_rejected` goes; its submit half stays.

- [ ] **Step 2: Run to see them fail.** Expected: `KeyError: 'already_entered'` / `'page_url'`, 200 from `/try`, and the file-refusal detail without `--enter`.

- [ ] **Step 3: Implement.** In `arena/web/config.py`, add a field after `public_origin`:

```python
    # The Space's own id, e.g. pollen-robotics/microduck-arena; its huggingface.co page opens an
    # entry's result for anyone logged in there, private Space or not.
    space_id: str | None = None
```

and in `from_env(...)`'s `cls(...)`, after `public_origin=`:

```python
            space_id=(os.environ.get("SPACE_ID") or "").strip() or None,
```

In `arena/web/routes_submit.py`:
- **Docstring.** Replace the module docstring:

```python
"""Entering a policy: a Hub repo, raced here, recorded on the board.

The server does the timing: it downloads the repo at the revision given, validates the ONNX
with the same `load_policy` the CLI uses (so a refusal carries the engine's own wording),
races it and appends the run to the log. Nothing is recorded unless the evaluation completes.

An entry is made by `uv run publish … --enter`, from a shell or from the workshop, with the
user's Hugging Face token; the site has no entry form, and nothing here races a policy
without entering it. The Space writes into no one's namespace and keeps no weights.
"""
```

- **Imports:** remove `base64`, `tempfile`, `File`, `UploadFile` and `MAX_MODEL_BYTES`. Add these; `routes_read` imports nothing from here, so the cycle-free top-level import is fine:

```python
from ..constants import RUNNER_VERSION
from .routes_read import _withdrawn
```

- **Delete:**
  - `PUBLISH_A_REPO`, `_load_and_evaluate`, `_race`, `_require_exactly_one` and `try_policy`;
  - `_seed_rows` in its current form.
  - Keep `_fetch_from_hub`, `_require_session`, `_event_or_404`, `_speed`, `_env_url`, `_livery`, `_hub_name` and `_label` as they are.
- **Add** these helpers:

```python
ENTER_A_REPO = "The Arena enters a Hugging Face repo: enter from the workshop, or with `uv run publish … --enter`."


def _seed_rows(per_seed) -> list[dict]:
    return [{"seed": s.seed, "status": s.status, "time_s": s.time_s} for s in per_seed]


def _evaluate(manifest, policy, command_vx: float | None):
    return evaluate(manifest, policy) if command_vx is None else evaluate_at(manifest, policy, command_vx)


def _page_url(request: Request, run_id: str) -> str:
    """Where a browser sees the entry: on Hugging Face, the Space's own page (which hands the
    hash to the Space and opens it for anyone logged in there, private or not); else here."""
    space = request.app.state.config.space_id
    if space:
        return f"https://huggingface.co/spaces/{space}#/r/{run_id}"
    return f"{str(request.base_url).rstrip('/')}/#/r/{run_id}"


def _already_entered(store, event_id: str, user: str, sha256: str) -> RunRecord | None:
    """This user's entry of this very policy, if one is on the board.

    Keyed on the ONNX's sha256, not the revision or the speed: a retry after a lost answer is
    the same file, and a pinned speed can only match or lose to the sweep, which already keeps
    the best. An entry withdrawn, or raced by an older runner, is no longer on the board.
    """
    withdrawn = _withdrawn(store)
    return next(
        (r for r in store.runs(event_id)
         if r.user == user and r.model_sha256 == sha256
         and r.runner_version == RUNNER_VERSION and r.run_id not in withdrawn),
        None,
    )


def _answer(record: RunRecord, page_url: str, already: bool) -> dict:
    return {
        "run_id": record.run_id,
        "user": record.user,
        "policy_name": record.policy_name,
        "livery": record.livery,
        "score": record.score,
        "command_vx": record.command_vx,
        "model_stored": record.model_stored,
        "offers_download": record.offers_download,
        "policy_url": (record.source or {}).get("url"),
        "seeds_finished": record.seeds_finished,
        "seeds_total": len(record.per_seed),
        "per_seed": _seed_rows(record.per_seed),
        "trace_seed": record.trace_seed,
        "page_url": page_url,
        "already_entered": already,
    }
```

- **Replace `submit`** with the two functions below:
  - Keep, word for word, the existing long comment on `command_vx` (the sweep versus pinning) above `result = …`.
  - Keep the clip block and its comment.

```python
@router.post("/events/{event_id}/submit")
async def submit(
    event_id: str,
    request: Request,
    repo_id: str | None = Form(default=None),
    name: str | None = Form(default=None),
    livery: str | None = Form(default=None),
    command_vx: str | None = Form(default=None),
    env_url: str | None = Form(default=None),
    revision: str | None = Form(default=None),
) -> dict:
    # Who, before any of the expensive work: an entry nobody can be credited with is not worth
    # thirty seconds of a shared CPU.
    user, orgs = await _entrant(request)
    if not repo_id:
        raise HTTPException(status_code=400, detail=ENTER_A_REPO)
    manifest = _event_or_404(event_id, must_be_open=True)
    _require_own_repo(repo_id, user, orgs)
    # Checked before racing: a link this server will refuse should cost nobody thirty seconds
    # of simulation first.
    link = _env_url(env_url)
    racing = request.app.state.racing
    if user in racing:
        raise HTTPException(status_code=409, detail="Your previous entry is still racing: wait for its result.")
    racing.add(user)
    try:
        return await _enter(request, manifest, user, repo_id, revision, name, livery, command_vx, link)
    finally:
        racing.discard(user)


async def _enter(request, manifest, user, repo_id, revision, name, livery, command_vx, link) -> dict:
    try:
        # Offloaded to a worker thread: this is a network call.
        fetched = await run_in_threadpool(_fetch_from_hub, repo_id, revision, manifest)
    except FetchError as exc:
        # 400, not 500: the reference is the problem, and the message is written to be read
        # by the person who sent it.
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    try:
        # An ONNX session load, off the event loop. The 64 MiB cap is checked here too.
        policy = await run_in_threadpool(load_policy, fetched.path)
    except PolicyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    store = request.app.state.store
    kept = _already_entered(store, manifest.id, user, policy.sha256)
    if kept is not None:
        return _answer(kept, _page_url(request, kept.run_id), already=True)

    # (the existing comment on command_vx, the sweep and pinning, word for word)
    try:
        # Five simulated runs per speed, CPU-bound: off the event loop.
        result = await run_in_threadpool(_evaluate, manifest, policy, _speed(manifest, command_vx))
    except PolicyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    record = RunRecord(
        ...  # exactly the current RunRecord(...) call, with user=user
    )
    store.append(record, trace_codec.encode(result.trace, result.settle))
    ...  # the current clip block, unchanged
    return _answer(record, _page_url(request, record.run_id), already=False)
```

`withdraw` and `mark_seen` stay as they are.

- [ ] **Step 4: Run `tests/test_routes_submit.py`, then the whole suite**, then `uv run --no-config --frozen --extra dev ruff check arena tests`. Expected: all green, and no unused import.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add arena/web/routes_submit.py arena/web/config.py tests/
/usr/bin/git commit -m "Submit: a repo only, the same policy answers its entry already there, and the answer says where to see it

An entry of a policy (its ONNX sha256) already on the user's board comes back as is,
unraced: a retry after a lost answer records nothing twice. page_url is the Space's own
huggingface.co page when SPACE_ID is set, which opens a private Space too. The try route
goes: nothing here races a policy without entering it."
```

---

### Task 6: The challenge page enters nothing

**Files:**
- Modify: `app/src/race.js`, `app/src/trainpanel.js`, `app/src/api.js`, `app/src/session.js`, `app/src/board.js`, `app/src/lanes.js`, `app/public/race.css`
- Delete: `app/src/entry.js`, `app/src/entry.test.js`, `app/src/dropzone.js`, `app/src/standings.js`, `app/src/standings.test.js`
- Test: `app/src/race.test.js`, `app/src/trainpanel.test.js`, `app/src/api.test.js`, `app/src/session.test.js`, `app/src/board.test.js`, `app/src/guides.test.js`

**Interfaces:**
- Produces:
  - `raceHall(event)`: its `.entry-col` holds only `<a class="help-link">`;
  - `renderVoteButton(root, event)` prepends to `.entry-col`;
  - `renderTrainPanel(root, event, origin)` inserts before `.entry-col .help-link`;
  - `trainPanel(event, origin)` is an open `<details>` whose summary reads "Train my own robot".
- Consumes: nothing new.

- [ ] **Step 1: Write the failing tests.** Replace `app/src/trainpanel.test.js`:

```js
import { afterEach, describe, expect, it, vi } from "vitest";
import { oneLine, renderTrainPanel, trainPanel } from "./trainpanel.js";

const sprint = { id: "sprint-2m", status: "open" };

afterEach(() => vi.restoreAllMocks());

describe("Train my own robot", () => {
  it("gives the one line for this challenge, on this Arena, and uv's install as the answer to its absence", () => {
    expect(oneLine(sprint, "http://127.0.0.1:8000")).toBe("uv run http://127.0.0.1:8000/workshop.py sprint-2m");
    const panel = trainPanel(sprint, "https://arena.example");
    expect(panel.querySelector(".train__open").textContent).toBe("Train my own robot");
    const [line, install] = [...panel.querySelectorAll(".train__line code")].map((node) => node.textContent);
    expect(line).toBe("uv run https://arena.example/workshop.py sprint-2m");
    expect(install).toBe("curl -LsSf https://astral.sh/uv/install.sh | sh");
    expect(panel.querySelector(".train__uv").textContent).toBe(
      "uv: command not found? Install uv, open a new terminal, and paste the line again:");
  });

  it("leaves what else it takes to the launcher and the workshop, when each is needed", () => {
    const text = trainPanel(sprint, "https://arena.example").textContent;
    expect(text).not.toMatch(/You need/);
    expect(text).not.toMatch(/NVIDIA GPU/);
  });

  it("is open: it is the page's call to action", () => {
    expect(trainPanel(sprint, "https://arena.example").open).toBe(true);
  });

  it("copies the line", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const panel = trainPanel(sprint, "https://arena.example");
    panel.querySelector(".train__copy").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writeText).toHaveBeenCalledWith("uv run https://arena.example/workshop.py sprint-2m");
  });

  it("sits in the entry column above the guide link, and not for a planned event", () => {
    const root = document.createElement("div");
    root.innerHTML = '<div class="entry-col"><a class="help-link"></a></div>';
    renderTrainPanel(root, { id: "highest-jump", status: "planned" }, "https://a");
    expect(root.querySelector(".train")).toBeNull();
    renderTrainPanel(root, sprint, "https://a");
    expect(root.querySelector(".help-link").previousElementSibling.classList.contains("train")).toBe(true);
  });
});
```

In `app/src/guides.test.js`:
- Replace the import `import { renderEntryPanel } from "./race.js";` with `import { raceHall } from "./race.js";`.
- Replace the test "lets signed-out entrants learn before signing in" with:

```js
  it("lets anyone learn the rules from the race page, signed in or not", () => {
    const hall = raceHall({ id: "sprint-2m", title: "2 m Sprint" });
    expect(hall.querySelector('.entry-col a.help-link[href="#/e/sprint-2m/guide"]')).not.toBeNull();
    expect(hall.querySelector("#publish, #try, #dropzone")).toBeNull();
  });
```

In `app/src/race.test.js`:
- **Delete** the describe blocks "renderEntryPanel: signed-out", "renderEntryPanel: ready (signed in, can publish)", "the speed picker applies to publishing too" and "the training-environment field", and the `arrangeLanes` test "matches an unpublished trial to its row even when it ranks between published runs".
- **Rewrite** the `renderVoteButton` tests to build `root.innerHTML = '<div class="entry-col"><a class="help-link"></a></div>'`. Assert that the vote button is the column's first child when the event takes votes, and that nothing is added on a timed event. Rename "sits directly above the entry form…" to "tops the entry column when the event takes votes".
- **In the `raceHall` block,** the test named "…so the entry panel starts level with it" becomes "…so the entry column starts level with it", and any `#entry` it queries becomes `.entry-col`. Add:

```js
  it("says a failed withdrawal under the board", () => {
    const hall = raceHall({ id: "sprint-2m", title: "2 m Sprint" });
    const note = hall.querySelector(".boardsheet + #board-note");
    expect(note).not.toBeNull();
    expect(note.getAttribute("role")).toBe("status");
  });
```

Elsewhere:
- In `app/src/api.test.js`, delete the tests of `tryPolicy` and `submitPolicy`.
- In `app/src/session.test.js`, delete the `panelState` describe.
- In `app/src/board.test.js`, delete every test that builds a row with `provisional: true`: lines ~115, 201, 216, 260, 317, 384 and 418 at the time of writing (`grep -n provisional app/src/board.test.js`).

- [ ] **Step 2: Run to see them fail.** Run `cd app && npx vitest run src/trainpanel.test.js src/race.test.js src/guides.test.js`. Expected failures: the summary text, no `.train__uv`, `open` false, no `.entry-col .help-link`, no `#board-note`.

- [ ] **Step 3: Implement.** Replace `app/src/trainpanel.js`:

```js
// The way from a challenge to training for it: one line to copy. The line runs the launcher
// this Arena serves (arena/web/routes_launcher.py), which clones microduck-challenges and opens
// the workshop on this challenge. What else it takes — git, a Hugging Face account, a GPU or
// Hugging Face Jobs — the launcher and the workshop ask for when it is needed. uv is needed to
// run the line at all, so the answer to its absence sits right under it.

const UV_INSTALL = "curl -LsSf https://astral.sh/uv/install.sh | sh";

export const oneLine = (event, origin = location.origin) => `uv run ${origin}/workshop.py ${event.id}`;

export function trainPanel(event, origin = location.origin) {
  const panel = document.createElement("details");
  panel.className = "train";
  // Open: with no entry form on this page, it is the page's one call to action.
  panel.open = true;
  panel.innerHTML = `
    <summary class="train__open">Train my own robot</summary>
    <p class="train__step">In a terminal:</p>
    <pre class="train__line"><code></code></pre>
    <button type="button" class="train__copy">Copy</button>
    <p class="train__note">It clones <code>microduck-challenges</code> into the folder you run it in
      (or reuses it) and opens the workshop in your browser.</p>
    <p class="train__uv"><code>uv: command not found</code>? Install uv, open a new terminal, and paste the line again:</p>
    <pre class="train__line"><code></code></pre>`;
  const [line, install] = panel.querySelectorAll(".train__line code");
  line.textContent = oneLine(event, origin);
  install.textContent = UV_INSTALL;
  const copy = panel.querySelector(".train__copy");
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(line.textContent);
      copy.textContent = "Copied";
    } catch {
      copy.textContent = "Select the line and copy it";
    }
  });
  return panel;
}

/** In the entry column, above the guide link, for an event that can be trained for today. */
export function renderTrainPanel(root, event, origin = location.origin) {
  if (event.status !== "open") return;
  root.querySelector(".entry-col .help-link").before(trainPanel(event, origin));
}
```

In `app/src/race.js`:
- **Imports:** remove `submitPolicy`, `tryPolicy`, `createDropzone`, `entryFromLocation`, `forgetEntry`, `VARIANT_SWATCH_HEX`, `speedChoices`, `panelState`, `signInHref`, `insertProvisional`, and `runHref` if nothing else uses it. Keep `eventGuideHref`.
- **Delete** `renderEntryPanel` and its doc comment.
- **`raceHall`:** its entry column becomes

```js
      <div class="entry-col">
        <a class="help-link" href="${eventGuideHref(event.id)}">Training & rules ?</a>
      </div>
```

and right after `${boardsheetMarkup}` add `<p class="board-note" id="board-note" role="status"></p>`. Update its doc comment: the entry column starts level with the title.

- **`renderVoteButton`:** the body becomes `root.querySelector(".entry-col").prepend(voteButton(event, { variant: "panel" }));`. Its comment says "at the top of the entry column", and the test anchor is `.entry-col`.
- **`renderRace`:**
  - delete `entryColumn`, `trial`, `currentLivery` and the `renderEntryPanel(...)` call;
  - in `race()`, drop the `if (trial) lanes.unshift(...)` block;
  - the hint text becomes `"Tick a lane below to watch a replay."`;
  - `rows` returns `rows` as the server gave them (`insertProvisional` is gone);
  - `onWithdraw`'s `catch` becomes

```js
      } catch (error) {
        hall.querySelector("#board-note").textContent = error.message;
      }
```

and the `try` block clears it first: `hall.querySelector("#board-note").textContent = "";`.

- **`app/src/api.js`:** delete `policyForm`, `submitPolicy` and `tryPolicy`, with their comments.
- **`app/src/session.js`:** delete `panelState`. The header comment becomes "Where the sign-in link points, carrying the route to come back to."
- **Delete** `app/src/entry.js`, `app/src/entry.test.js`, `app/src/dropzone.js`, `app/src/standings.js` and `app/src/standings.test.js`.
- **`app/src/board.js` and `app/src/lanes.js`:** a row is never provisional any more.
  - Simplify every expression that reads `row.provisional` or the `provisional` class as if it were false: board.js ~53, 59–60, 77, 83, 93–94, 142, 152, 211; lanes.js ~28.
  - Drop the `provisional` field that `buildRows` sets.
  - Delete `TIERS.TRIAL` from board.js only if `grep -rn "TIERS.TRIAL\|\"trial\"" app/src` shows no other reader. The viewer's `"trial"` tier stays: the workshop's replay uses it.
  - Every other assertion in board.test.js and lanes.test.js must pass unchanged.
- **`app/public/race.css`:**
  - Delete every rule whose selectors are all `.entry`, `.entry__…`, the drop zone's (`grep -rn "dropzone" app/public app/src`) or `.provisional`.
  - From a mixed selector list, drop only those selectors. `.entry__name, .livery legend, .entry__speed` keeps `.livery legend`. `.livery`, `.livery__swatches` and `.swatch` stay: the workshop uses them.
  - In the `.train` rules, `.train__need` becomes `.train__uv` (same size as `.train__note`, same `color: var(--ink-70)`).
  - Add:

```css
/* A failed withdrawal, said under the board it was asked from. */
.board-note { margin: 8px 0 0; color: var(--orange-inked); font-weight: 600; }
.board-note:empty { display: none; }
```

- [ ] **Step 4: Run `cd app && npm test` and `npm run build`.** Expected: only the 4 known brightness failures, and a clean build. Also run `grep -rn "renderEntryPanel\|tryPolicy\|submitPolicy\|insertProvisional\|createDropzone\|entryFromLocation\|panelState" app/src`: it must print nothing.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add -A app/src app/public/race.css
/usr/bin/git commit -m "The challenge page enters nothing: Train my own robot is its call to action

The entry panel, the .onnx drop zone, the trial lane and the ?repo pre-fill go: entering
is publish --enter's, from the workshop or a shell. The panel opens by default, with uv's
install under the line as the answer to 'command not found', and no list of needs: the
launcher and the workshop ask for each when it is needed. The guide link moves to the
entry column; a failed withdrawal is said under the board."
```

---

### Task 7: The workshop publishes with `--enter` and opens the entry's page

**Files:**
- Modify: `arena/workshop/publishing.py`, `arena/workshop/app.py` (`PublishRequest`, `publish_route`)
- Modify: `tests/workshop/fake_uv.py` (`publish`)
- Test: `tests/workshop/test_publishing.py`

**Interfaces:**
- Produces: `POST /api/workshop/publish`
  - takes `livery: str = "classic"` and `speed: float | None = None`;
  - answers a real publish with `{repo, revision, entered, page_url, output, env}`, where `entered` is e.g. `"entered on sprint-2m: 4.892 s (5/5 seeds) at 0.55 m/s"`;
  - opens `page_url` in the browser;
  - a refusal (publish's exit 3) is a 400 whose detail is the whole output.
- Consumes: Task 3's printed lines.

- [ ] **Step 1: Write the failing tests** in `tests/workshop/test_publishing.py`:
  - Replace `test_publishing_is_public_pins_the_commit_and_opens_the_arena` and `test_the_arena_link_carries_the_code_once_it_is_shared` with the tests below.
  - Remove the `urllib.parse` import if nothing else uses it.
  - In `test_the_preview_is_a_dry_run_showing_the_hub_card`, add `assert "--enter" not in call`.

```python
def test_publishing_enters_it_and_opens_its_page(workshop, fakes, checkout):
    run = make_run(checkout, "first")
    body = _publish(workshop, run).json()
    (call,) = fakes.calls("publish")
    assert call[3:7] == ["--run", str(run), "--checkpoint", "1"]
    assert {"--no-private", "--force", "--enter"} <= set(call)
    assert call[call.index("--arena") + 1] == "http://arena.test"
    assert call[call.index("--livery") + 1] == "classic"
    assert "--speed" not in call and "--code-url" not in call
    assert call[call.index("--repo") + 1] == "alice/microduck-my-walker"
    assert "--description=2 m Sprint" in call and "--name=my-walker" in call
    assert call[call.index("--twist-help") + 1] == SPEED_TWIST
    assert body["revision"] == AAA and body["env"] is None
    assert body["entered"] == "entered on sprint-2m: 4.892 s (5/5 seeds) at 0.55 m/s"
    assert body["page_url"] == "http://arena.test/#/r/fakerun1"
    assert workshop.opened == [body["page_url"]]


def test_a_colour_and_a_speed_go_with_the_entry(workshop, fakes, checkout):
    _publish(workshop, make_run(checkout, "first"), livery="yellow", speed=0.55)
    (call,) = fakes.calls("publish")
    assert call[call.index("--livery") + 1] == "yellow"
    assert call[call.index("--speed") + 1] == "0.55"


def test_the_entry_carries_the_code_once_it_is_shared(workshop, fakes, checkout):
    workshop.post("/api/workshop/code/fork", json={})
    run = make_run(checkout, "first")
    commit = git(checkout, "rev-parse", "--short=9", "HEAD")
    body = _publish(workshop, run).json()
    assert body["env"] == f"https://github.com/alice/microduck-challenges/tree/{commit}"
    (call,) = fakes.calls("publish")
    assert call[call.index("--code-url") + 1] == body["env"]


def test_an_entry_the_arena_refuses_shows_the_whole_output_and_opens_nothing(workshop, fakes, checkout, monkeypatch):
    monkeypatch.setenv("FAKE_UV_ENTER_REFUSED", "1")
    response = _publish(workshop, make_run(checkout, "first"))
    assert response.status_code == 400
    assert "but the Arena did not enter it: 403: not yours" in response.json()["detail"]
    assert workshop.opened == []
```

- [ ] **Step 2: Run to see them fail.** Run `uv run --no-config --frozen --extra dev pytest -q tests/workshop/test_publishing.py`. Expected: no `--enter` in the call, `KeyError: 'entered'`, and a 422 for `livery`.

- [ ] **Step 3: Implement.** In `tests/workshop/fake_uv.py`:
  - Its docstring's sentence on publish becomes: "a real `publish` prints the commit URL the real one prints and, with `--enter`, the line an entry prints (FAKE_UV_ENTER_REFUSED=1: the refusal, exit 3)".
  - Its `publish()` after the dry-run branch becomes:

```python
    repo = flag(argv, "--repo")
    print(f"[publish] uploaded: https://huggingface.co/{repo}/commit/{'a' * 40}")
    if "--enter" in argv:
        if os.environ.get("FAKE_UV_ENTER_REFUSED"):
            print(f"[publish] uploaded https://huggingface.co/{repo}/commit/{'a' * 40}, "
                  "but the Arena did not enter it: 403: not yours", file=sys.stderr)
            return 3
        print(f"[publish] entered on sprint-2m: 4.892 s (5/5 seeds) at 0.55 m/s → {flag(argv, '--arena')}/#/r/fakerun1")
    return 0
```

In `arena/workshop/publishing.py`:
- the module docstring becomes

```python
"""Publish a run's checkpoint with `uv run publish`, which also enters it on the Arena.

The workshop writes no manifest, uploads nothing and calls no Arena itself: `publish --run
--enter` does all three, exactly as from a shell. It runs twice — `--dry-run` for the preview
of the Hub card, then for real — and the real one prints the commit it made and the entry's
time and page, which the workshop opens.
"""
```

- delete `arena_link` and the `urlencode` import;
- add `_ENTERED = re.compile(r"^\[publish\] ((?:already )?entered on .+) → (\S+)$", re.M)`;
- `publish()` becomes

```python
def publish(root, run, checkpoint, repo, name, description, event_id, allow_dirty, *,
            arena: str, livery: str, speed: float | None, code_url: str | None) -> dict:
    args = publish_args(run, checkpoint, repo, name, description, load_event(event_id), allow_dirty)
    # Public, or the Arena cannot read it; --force because publishing a name again is a new
    # commit on the same repo, and the Arena pins the commit it raced.
    args += ["--no-private", "--force", "--enter", "--arena", arena, "--livery", livery]
    if speed is not None:
        args += ["--speed", f"{speed:g}"]
    if code_url:
        args += ["--code-url", code_url]
    output = _run(root, args)
    commit, entered = _COMMIT.search(output), _ENTERED.search(output)
    if not commit or not entered:
        raise PublishError(output + "\n[workshop] publish printed no entry for the workshop to open")
    return {"repo": repo, "revision": commit.group(1), "entered": entered.group(1),
            "page_url": entered.group(2), "output": output}
```

In `arena/workshop/app.py`:
- **Imports:** remove `arena_link` from the `publishing` import.
- **`PublishRequest`:** gains `livery: str = "classic"` and `speed: float | None = None`.
- **`publish_route`:** after the `args = (...)` line, compute the code link before publishing:

```python
    env = code_url(ws.root, run.provenance.get("commit"))
```

and replace from `published = await run_in_threadpool(publish, *args)` to the end with:

```python
        published = await run_in_threadpool(publish, *args, arena=ws.arena, livery=body.livery,
                                            speed=body.speed, code_url=env)
    except PublishError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        ws.publishing.release()
    ws.open_browser(published["page_url"])  # the entry's page on the Arena, where its reveal plays
    return {**published, "env": env}
```

- [ ] **Step 4: Run `tests/workshop/`, then the whole suite.** Expected: all green.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add arena/workshop/publishing.py arena/workshop/app.py tests/workshop/fake_uv.py tests/workshop/test_publishing.py
/usr/bin/git commit -m "Workshop: publish with --enter, carrying the colour, the speed and the code link, and open the entry's page

The Arena's page pre-filled with ?repo=&revision=&env= is gone: publish enters the policy
itself and prints its time and page, which the workshop opens. A refusal after the upload
comes back whole, and Publish tries again."
```

---

### Task 8: The Publish zone asks for a colour and a speed; the workshop guides each need where it arises

**Files:**
- Modify: `app/src/workshop/publish.js` (`publishValues`, `renderPublish`), `app/src/workshop/main.js` (`captureDraft`), `app/src/workshop/preflight.js` (the Hugging Face help), `app/src/workshop/train.js` (`showTrainAccess`), `app/public/workshop.css`
- Test: `app/src/workshop/publish.test.js`, `app/src/workshop/preflight.test.js`, `app/src/workshop/train.test.js`

**Interfaces:**
- Produces: `publishValues(form, selection)` → `{run, checkpoint, name, description, livery, speed, allow_dirty}`, where `speed` is a number, or `null` for the sweep. The draft carries `livery` and `speed` (the select's string).
- Consumes: `POST /api/workshop/publish`'s answer from Task 7 (`entered`, `page_url`); `speedChoices(event)` from `app/src/format.js`; `VARIANT_SWATCH_HEX` from `app/src/liveries.js`.

- [ ] **Step 1: Write the failing tests.** In `app/src/workshop/publish.test.js`, give the tests' `status.event` a sweep: `sweep_lo: 0.2, sweep_hi: 0.3, sweep_step: 0.05, sweep_count: 3`, next to `title`. Then:

```js
  it("offers the Arena's four colours, classic first, and sends the one picked", () => {
    const zone = document.createElement("div");
    renderPublish(zone, selection, status, handlers());
    const swatches = [...zone.querySelectorAll(".swatch")];
    expect(swatches.map((s) => s.dataset.livery)).toEqual(Object.keys(VARIANT_SWATCH_HEX));
    expect(publishValues(zone.querySelector("form"), selection).livery).toBe("classic");
    swatches[1].click();
    expect(swatches[1].getAttribute("aria-pressed")).toBe("true");
    expect(publishValues(zone.querySelector("form"), selection).livery).toBe(swatches[1].dataset.livery);
  });

  it("sweeps unless a speed is chosen, and sends a chosen one as a number", () => {
    const zone = document.createElement("div");
    renderPublish(zone, selection, status, handlers());
    const speed = zone.querySelector("select[name=speed]");
    expect([...speed.options].map((o) => o.value)).toEqual(["", "0.20", "0.25", "0.30"]);
    expect(publishValues(zone.querySelector("form"), selection).speed).toBeNull();
    speed.value = "0.25";
    expect(publishValues(zone.querySelector("form"), selection).speed).toBe(0.25);
  });

  it("asks no speed of an event timed at one speed", () => {
    const zone = document.createElement("div");
    const single = { ...status, event: { ...status.event, sweep_lo: 0.25, sweep_hi: 0.25, sweep_count: 1 } };
    renderPublish(zone, selection, single, handlers());
    expect(zone.querySelector(".publish__speed").hidden).toBe(true);
  });

  it("publishes and enters in one button, then says the time and links the entry's page", async () => {
    const zone = document.createElement("div");
    const onPublish = vi.fn(async () => ({
      repo: "alice/microduck-x", revision: "a".repeat(40),
      entered: "entered on sprint-2m: 4.892 s (5/5 seeds) at 0.55 m/s",
      page_url: "https://huggingface.co/spaces/pollen-robotics/microduck-arena#/r/run42",
    }));
    renderPublish(zone, selection, status, handlers({ onPublish }));
    const go = zone.querySelector(".publish__go");
    expect(go.textContent).toBe("Publish and enter");
    go.click();
    expect(zone.querySelector(".publish__status").textContent)
      .toBe("Exporting, uploading and racing on the Arena (a minute or two)…");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const status_ = zone.querySelector(".publish__status");
    expect(status_.textContent).toContain("Published alice/microduck-x @ aaaaaaa and entered on sprint-2m: 4.892 s");
    expect(status_.querySelector("a").href).toBe("https://huggingface.co/spaces/pollen-robotics/microduck-arena#/r/run42");
  });
```

These tests assume the file's existing fixtures. The file must define (or already define) `selection` (a run and checkpoint), `status` (with `challenge.folder`, `event` and `preflight.user`) and a `handlers(overrides)` helper returning `{ onPreview, onPublish, draft: null, ...overrides }`. Where the file names these differently, adapt the names, not the assertions. Also import `VARIANT_SWATCH_HEX` from `../liveries.js`.

Update the existing tests:
- "names the policy after the challenge and the run, and sends what was chosen" also expects `livery: "classic"` and `speed: null`.
- "keeps what was typed across a re-render for the same run" also picks a swatch and a speed before the re-render and expects both back.
- The finish object with `arena_url` (line ~128) becomes `{ repo, revision, entered: "entered on sprint-2m: 4.892 s (5/5 seeds) at 0.55 m/s", page_url: "http://arena.test/#/r/x" }`.

In `app/src/workshop/preflight.test.js`, the test "shows each missing item with the command that fixes it" no longer expects `hf auth login`. Instead:

```js
    const help = zone.querySelector(".preflight__missing .preflight__help");
    expect(help.textContent).toBe("No account yet? Create one, then create a token with write access and paste it below.");
    expect([...help.querySelectorAll("a")].map((a) => a.href)).toEqual([
      "https://huggingface.co/join", "https://huggingface.co/settings/tokens/new?tokenType=write"]);
```

In `app/src/workshop/train.test.js`, add:

```js
  it("says that Hugging Face Jobs need a payment method on the account", () => {
    const zone = document.createElement("div");
    renderTrainForm(zone, { challenge, preflight: { git: true, identity: true, uv: true, gpu: false, gh: true, user: "alice" } }, { onLaunch: vi.fn() });
    expect(zone.querySelector(".train-form__where").textContent)
      .toContain("billed to alice, which needs a payment method (huggingface.co/settings/billing)");
  });
```

Use the file's own `challenge` fixture.

- [ ] **Step 2: Run to see them fail.** Run `cd app && npx vitest run src/workshop`.

- [ ] **Step 3: Implement.** In `app/src/workshop/publish.js`:
- import `speedChoices` from `../format.js` and `VARIANT_SWATCH_HEX` from `../liveries.js`;
- change the header comment's last clause to "and `uv run publish --enter` enters it on the Arena";
- `publishValues` becomes

```js
export function publishValues(form, selection) {
  const speed = form.elements.namedItem("speed").value;
  return {
    run: selection.run.id,
    checkpoint: selection.checkpoint,
    name: form.elements.namedItem("policy").value.trim(),
    description: form.elements.namedItem("description").value.trim(),
    livery: form.elements.namedItem("livery").value,
    // Empty is the sweep, the Arena's default: every speed of the event tried, the best kept.
    speed: speed === "" ? null : Number(speed),
    allow_dirty: Boolean(form.elements.namedItem("anyway")?.checked),
  };
}
```

In `renderPublish`:
- **Markup:** the form gains, after the Description label:

```html
      <fieldset class="livery">
        <legend class="mono-label">Colour on the Arena</legend>
        <div class="livery__swatches"></div>
        <input type="hidden" name="livery" />
      </fieldset>
      <label class="field publish__speed">Speed <select name="speed"></select></label>
```

- **Wiring:** after the description is set, add

```js
  const livery = form.elements.namedItem("livery");
  livery.value = applied?.livery ?? "classic";
  const swatches = zone.querySelector(".livery__swatches");
  for (const [name, hex] of Object.entries(VARIANT_SWATCH_HEX)) {
    const swatch = Object.assign(document.createElement("button"), { type: "button", className: "swatch", title: name });
    swatch.dataset.livery = name;
    swatch.style.setProperty("--swatch", hex);
    swatch.setAttribute("aria-label", name);
    swatch.setAttribute("aria-pressed", String(name === livery.value));
    swatch.addEventListener("click", () => {
      livery.value = name;
      for (const other of swatches.children) other.setAttribute("aria-pressed", String(other.dataset.livery === name));
    });
    swatches.append(swatch);
  }
  const speed = form.elements.namedItem("speed");
  for (const choice of speedChoices(status.event)) speed.append(new Option(choice.label, choice.value));
  speed.value = applied?.speed ?? "";
  // An event timed at one speed has nothing to choose.
  zone.querySelector(".publish__speed").hidden = !(status.event.sweep_lo < status.event.sweep_hi);
```

- **The `go` button:** its label becomes `"Publish and enter"`, and its handler's body becomes

```js
    const note = zone.querySelector(".publish__status");
    say(note, "Exporting, uploading and racing on the Arena (a minute or two)…");
    try {
      const done = await onPublish(publishValues(form, selection));
      say(note, `Published ${done.repo} @ ${done.revision.slice(0, 7)} and ${done.entered}. `);
      note.append(Object.assign(document.createElement("a"), {
        href: done.page_url, target: "_blank", rel: "noopener", textContent: "See it on the Arena",
      }), " (opened in your browser).");
    } catch (error) {
      say(note, error.message, true);
    }
```

In `app/src/workshop/main.js`, `captureDraft` also keeps `livery: form.elements.namedItem("livery").value` and `speed: form.elements.namedItem("speed").value`.

In `app/src/workshop/preflight.js`:
- the `user` item loses its `fix`, and becomes `{ key: "user", label: "Logged in to Hugging Face" }`;
- add

```js
const link = (href, text) => Object.assign(document.createElement("a"), { href, target: "_blank", rel: "noopener", textContent: text });

/** No login yet: where to get an account and the token the field below takes. */
function hubHelp() {
  const help = document.createElement("p");
  help.className = "preflight__help";
  help.append("No account yet? ", link("https://huggingface.co/join", "Create one"), ", then ",
    link("https://huggingface.co/settings/tokens/new?tokenType=write", "create a token with write access"),
    " and paste it below.");
  return help;
}
```

and in the loop, where a missing item appends its `<code>` fix:

```js
    if (!ok) {
      if (item.fix) {
        const fix = document.createElement("code");
        fix.textContent = item.fix;
        row.append(fix);
      } else {
        row.append(hubHelp());
      }
    }
```

In `app/src/workshop/train.js`, `showTrainAccess`'s HF Jobs sentence becomes

```js
    : `Trains on Hugging Face Jobs (one L4 GPU), billed to ${preflight.user ?? "your account"}, ` +
      "which needs a payment method (huggingface.co/settings/billing); " +
      "the checkpoints come back here as they are saved. " +
      "Closing the workshop does not stop a Hugging Face job: reopen it to fetch or stop it.";
```

In `app/public/workshop.css`:

```css
.preflight__help { flex-basis: 100%; margin: 0; color: var(--ink); }
.publish .livery { margin: 0 0 var(--space-2, 8px); }
.publish__speed select { font: inherit; }
```

- [ ] **Step 4: Run `cd app && npm test` and `npm run build`.** Expected: only the 4 known brightness failures.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add app/src/workshop app/public/workshop.css
/usr/bin/git commit -m "Workshop page: Publish and enter, with a colour and a speed, and help where each need arises

The Publish zone takes the Arena's four colours and the event's speeds (the sweep first),
and says the entry's time with a link to its page. Logged out, the Preflight says where to
make an account and a write token; without a GPU, Train says Hugging Face Jobs need a
payment method."
```

---

### Task 9: The guides and READMEs say how to enter now

**Files:**
- Modify: `docs/guides/train-a-policy.md`; `docs/guides/challenges/{sprint-2m,hill-climb-1m5,roller-sprint-2m,swag-contest}.md`, line 7
- Test: `app/src/guides.test.js`
- Modify: the microduck-challenges worktree's `README.md` (line 15), committed there

- [ ] **Step 1: Write the failing test.** In `app/src/guides.test.js`, replace "tells someone who already has an .onnx how to enter it" with:

```js
  it("tells someone who already has an .onnx how to race it here and how to enter it", () => {
    const root = show("train-a-policy");
    const commands = [...root.querySelectorAll("pre code")].map(node => node.textContent).join("\n");
    expect(commands).toContain("uv run --group workshop arena score policy.onnx --event sprint-2m");
    expect(commands).toContain(
      "uv run publish --onnx policy.onnx --repo <you>/microduck-<name> --kind perpetual --no-private --enter --event sprint-2m");
    expect(root.textContent).not.toMatch(/on a challenge's page/);
  });

  it("enters from the shell with publish --enter", () => {
    const commands = [...show("train-a-policy").querySelectorAll("pre code")].map(node => node.textContent).join("\n");
    expect(commands).toContain("uv run publish --run logs/rsl_rl/sprint_2m/<the run> --repo <you>/microduck-first --no-private --enter");
  });
```

- [ ] **Step 2: Run to see it fail.** Run `cd app && npx vitest run src/guides.test.js`.

- [ ] **Step 3: Rewrite `docs/guides/train-a-policy.md`**

````markdown
# Train your first policy

A policy is the model that controls the robot. You train it in simulation, publish it to
your Hugging Face account and enter it here, all from a workshop on your machine. You do not
need a physical robot.

## The workshop

Open a challenge and copy the line under **Train my own robot** into a terminal. It clones
[microduck-challenges](https://github.com/pollen-robotics/microduck-challenges) and opens the
workshop in your browser, which asks for what it needs as it goes:

1. **Preflight** checks your tools and your Hugging Face login.
2. **Train** starts from the challenge's own recipe. Change a knob if you like, then launch.
   With an NVIDIA GPU it trains on your machine; without one it runs on Hugging Face Jobs,
   billed to your account, and brings the checkpoints back as they are saved.
3. **Test** exports a checkpoint and races it with this Arena's own rules, on your machine.
   The time is indicative: only the Arena times an entry.
4. **Publish and enter** puts the policy, its manifest and its recipe in your Hugging Face
   account, enters it here in the colour and at the speed you chose, and opens its result.

## From a shell

Everything the workshop does is a command you can run yourself in a clone of
microduck-challenges (the challenge's `task` is in its `challenge.toml`):

```bash
uv run train Mjlab-Sprint2m-MicroDuck --env.scene.num-envs 4096 --agent.max-iterations 3000 \
    --agent.seed 1 --agent.logger tensorboard --agent.run-name first
# no NVIDIA GPU: add --hf-jobs --no-wandb, then bring the run back with
# uv run hf download <the checkpoint repo it printed> --local-dir logs/rsl_rl
uv run publish --run logs/rsl_rl/sprint_2m/<the run> --repo <you>/microduck-first --no-private --enter
```

`--enter` races it here and prints its time and its page. Add `--livery yellow` for a
colour, and `--speed 0.6` to be timed at one speed instead of the sweep. The Arena expects 61
observations, 14 actions and a file no larger than 64 MiB; `publish` checks all three.

## Already have an `.onnx`

Race it on your machine with this Arena's rules, in the same clone:

```bash
uv run --group workshop arena score policy.onnx --event sprint-2m
```

To enter it, publish it to your Hugging Face account with the event it is for:

```bash
uv run publish --onnx policy.onnx --repo <you>/microduck-<name> --kind perpetual --no-private --enter --event sprint-2m
```

For a roller challenge, add `--accessories rollers`.
````

In each `docs/guides/challenges/*.md`, line 7 becomes: `Open **Train my own robot** on the challenge page, or run this in a terminal:`.

- [ ] **Step 4: Search for what is left.** Run

```bash
grep -rn "Train my robot\|enter it here\|on the challenge's page\|Test it\|Publish here\|/try" README.md docs/guides arena app/src app/public --include="*.md" --include="*.py" --include="*.js" --include="*.html"
```

Every hit must now be true. Rewrite any remaining one in the spirit of the guide above. Leave `docs/superpowers/` alone: those are dated records.

- [ ] **Step 5: Run `cd app && npm test`.** Expected: only the 4 known brightness failures.

- [ ] **Step 6: Commit (Arena)**

```bash
/usr/bin/git add docs/guides app/src/guides.test.js
/usr/bin/git commit -m "Guides: enter from the workshop or with publish --enter, and race an .onnx locally with arena score"
```

- [ ] **Step 7: The challenges README.** In the challenges worktree's `README.md`, line 15, `**Train my robot**` becomes `**Train my own robot**`. Then:

```bash
cd ~/Projects/HuggingFace/microduck-challenges/.claude/worktrees/plan4-workshop
/usr/bin/git add README.md
/usr/bin/git commit -m "README: the Arena's button is Train my own robot"
```

---

### Task 10: Rehearse the whole journey on this Mac (controller)

Nothing leaves the machine before Step 5, and Step 5 needs the owner's yes.

- [ ] **Step 1: Give the challenges venv the `publish --enter` of Task 3**

```bash
cd ~/Projects/HuggingFace/microduck-challenges/.claude/worktrees/plan4-workshop
uv pip install --no-config --python .venv/bin/python --no-deps -e ~/Projects/HuggingFace/microduck_rl/.claude/worktrees/plan4-hf-jobs
UV_NO_CONFIG=1 UV_NO_SYNC=1 uv run publish --help | grep -- "--enter"
```

- [ ] **Step 2: Start the Arena and the workshop.**
  - Arena worktree: `(cd app && npm run build) && uv run --no-config --frozen arena serve --store <scratchpad>/rehearsal-store --port 8000`.
  - Challenges worktree: `HF_TOKEN=$(cat ~/.cache/huggingface/token) UV_NO_CONFIG=1 UV_NO_SYNC=1 uv run http://127.0.0.1:8000/workshop.py sprint-2m --no-browser`.
  - Both run as background processes. Poll the ports; never wait on a notification.

- [ ] **Step 3: Drive both pages in headless Chrome** (puppeteer, as in the memory `headless-chrome-available-locally`), aborting every POST to `/api/workshop/publish` that lacks `"dry_run":true`. Check and screenshot, at 1280 and 420 wide:
  - **`http://127.0.0.1:8000/#/e/sprint-2m`:**
    - no entry form;
    - **Train my own robot** open, with the line, Copy and the uv answer;
    - "Training & rules ?" in the column;
    - no horizontal overflow.
  - **`http://127.0.0.1:8765/`:**
    - the Publish zone after choosing `plan4probe` checkpoint 2: Name, Description, four swatches, Speed with the sweep first, **Publish and enter**;
    - "Preview the Hub card" works.
  - **Logged out:** with `HF_TOKEN` unset and no saved token (point `HF_HOME` at an empty dir for this run only), the Preflight shows the two links.

- [ ] **Step 4: From a shell, the refusals that need no network**, in the challenges worktree:

```bash
UV_NO_CONFIG=1 UV_NO_SYNC=1 uv run publish --run logs/rsl_rl/sprint_2m/2026-09-28_11-04-09_plan4probe --checkpoint 2 \
    --repo Nico-robot/microduck-plan4probe --enter --arena http://example.com --dry-run      # refused: --arena
UV_NO_CONFIG=1 UV_NO_SYNC=1 uv run publish --run logs/rsl_rl/sprint_2m/2026-09-28_11-04-09_plan4probe --checkpoint 2 \
    --repo Nico-robot/microduck-plan4probe --enter --arena http://127.0.0.1:8000 --dry-run   # writes publish-plan4probe/, sends nothing
rm -rf publish-plan4probe
```

- [ ] **Step 5: With the owner's yes only.** Run a real **Publish and enter** from the workshop against the local Arena.
  - It uploads `plan4probe` checkpoint 2 to a new public repo, `Nico-robot/microduck-sprint-2m-plan4probe` (a policy that does not walk).
  - The local Arena enters it: dev mode, so the dev user.
  - The browser would open `http://127.0.0.1:8000/#/r/<id>`. Check that page in headless Chrome.
  - Press **Publish and enter** again: the zone says "already entered".
  - Then, again with the owner's yes, delete the Hub repo.

- [ ] **Step 6: Clean up and report.**
  - Stop both servers: `lsof -iTCP:8000 -iTCP:8765 -sTCP:LISTEN` must be empty.
  - Remove any trial cache Test wrote into `plan4probe`.
  - The challenges worktree must be clean apart from Task 9's commit.
  - Write the report: what was seen, the screenshots, what the owner still has to decide or do.
  - What the owner still has to do: the release order in the spec (microduck_rl's PR #57 branch, then the Space, then a wheel and the challenges relock), and the one line's 404 while the Space is private.
````

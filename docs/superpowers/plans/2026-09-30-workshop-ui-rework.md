# The workshop redrawn as the Arena — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the workshop's one page of four stacked zones into three pages built from the Arena's own components (a home, a page per challenge, a page per training job), serving every open challenge, with trainings in parallel, every checkpoint evaluated automatically, and the description passed to the Arena's commentators.

**Architecture:** The FastAPI server in `arena/workshop/` keeps its subprocess mechanics and gains: several challenges per workshop, a browser login (`hf auth login` without a terminal), a commit gate, tickets (one per training, merged from the live trainings, `logs/workshop-jobs.json` and the run directories), a background evaluator and a background Hugging Face job watcher started by the app's lifespan. The page `app/workshop.html` becomes a small hash-routed app (`#/`, `#/c/<event>`, `#/c/<event>/j/<job>`) wearing `club.css` or `race.css` like the Arena's pages. The Arena's `submit` keeps the manifest's description and the commentary quotes it.

**Tech Stack:** Python 3.12, FastAPI, pytest (fake `uv` on PATH), vanilla ES modules built by Vite, vitest + jsdom, headless Chrome (puppeteer) for visual checks.

**Spec:** `docs/superpowers/specs/2026-09-30-workshop-ui-rework-design.md` (read it first; it amends `2026-09-24-challenge-workshop-design.md` and `2026-09-29-workshop-publishes-and-enters-design.md`).

## Global Constraints

- Work in the worktree `~/Projects/HuggingFace/microduck-arena/.claude/worktrees/plan4-workshop`, branch `plan4-workshop`. The challenges README task (Task 13) works in `~/Projects/HuggingFace/microduck-challenges/.claude/worktrees/plan4-workshop`, branch `plan4-workshop`.
- git is `/usr/bin/git` (a hook rewrites plain `git`). Commit messages in English, **unsigned**: no `Co-Authored-By`, no "Generated with". Never push.
- uv is always `--no-config --frozen`. Server tests: `uv run --no-config --frozen --extra dev pytest -q tests/workshop` (and the file under test). Front: `cd app && npm test` (4 failures in `src/brightness.test.js` are the known baseline, nothing else may fail) and `cd app && npm run build`.
- **Run every test and build in the FOREGROUND**, one Bash call with `timeout: 600000`. NEVER use `run_in_background` and never end a turn waiting for a notification.
- Never touch `arena/runner.py`, `arena/golden.py`, `arena/constants.py`, the version or dependencies in `pyproject.toml`, any `uv.lock`, nor `microduck-challenges/src/microduck_challenges/swag_contest/`.
- Never launch a real Hugging Face job, never fork, push or publish for real, never create anything on the Hub or GitHub. Visual checks use the driver `/private/tmp/claude-501/-Users-nicolasrabault-Projects-HuggingFace-microduck-arena/9f88e57b-22a5-4a4b-b645-cad3b1cd5023/scratchpad/ws-shot.js`, which aborts every write.
- In the challenges worktree, never run `uv run`/`uv sync` without `UV_NO_CONFIG=1 UV_NO_SYNC=1` (a sync would replace the editable Arena).
- No dead code: what a task makes useless goes in that task, with its tests. No file whose name contains `tfevents` is created.
- Type faces: only the charter's (`--display` Anton, `--body` DM Sans, `--mono`). Colours only from `app/public/design/tokens.css`; the checklist's ticks are `--lime-inked`.
- Exact texts and values from the spec:
  - lede: `Pick a challenge, then train, submit, compete, repeat.`; hero `Train your own duck.`; eyebrow `Microduck workshop`; post-it title `Ready to train?`
  - commit message default: `<event> training revision <YYYY-MM-DD HH:MM>`; settings commit at Train: `<event>: run <name>`; run name default `run-MMDD-HHMM`
  - description placeholder: `What makes it behave like that? What did you change? Describe what it is doing.`; its label `For the commentators`, note `Peter & Ray read it on air when your duck races.`
  - the Hub is asked at most once a minute per job, checkpoints pulled every 2 minutes; an evaluation waits for a checkpoint file older than 30 s; `whoami` limited to 5 s in all
  - Arena description: kept when a string of 1 to 500 characters after trimming, not the manifest's `training.task_id` nor its `name`; the commentary fact at most 280 characters and passing `label`.

## Review Focus

1. **The Hub unreachable while the page polls its tickets:** the tickets and the status never ask the network; a watcher that cannot reach the Hub leaves the tickets as they were. Test in Task 6.
2. **A `logs/workshop-jobs.json` written before this change** (records without `task`) or hand-edited: left out, never a 500, and a launch still works. Test in Task 4.
3. **The same run name in two challenges:** the tickets of one challenge never show the other's training. Test in Task 4.
4. **The job page redrawn every 3 s while the user types** a name and a description: what is typed stays. Test in Task 12.
5. **`hf auth login` that prints no URL** (an older huggingface_hub, a crash): the page gets an error with the command's output within 20 s, nothing hangs. Test in Task 2.

## File structure

Server (`arena/workshop/`):

| File | Responsibility |
|---|---|
| `hub.py` | `Account(name, can_pay)`, `Hub.whoami`, `Hub.job_stage`, `Hub.cancel_job`, `drop_exported_token()` |
| `login.py` (new) | `BrowserLogin`: runs `hf auth login --force`, reads the URL and the code, opens the URL |
| `code.py` | `code_state`, `commit`, `use_fork`, `push`, `code_url` |
| `jobs.py` | `logs/workshop-jobs.json`: `recorded_jobs`, `find_job`, `remember_job`, `TERMINAL` |
| `training.py` | `Training` (one launch, local or HF, recorded), `train_command`, `ckpt_repo`, `fetch` |
| `tickets.py` (new) | `tickets`, `ticket`, `ticket_detail`, `source` |
| `evaluations.py` (renamed from `trials.py`) | stored evaluations, `evaluate_checkpoint`, `next_checkpoint`, `evaluate_next`, `evaluate_forever` |
| `watch.py` (new) | `watch_once`, `watch_forever` for recorded HF jobs |
| `publishing.py` | `preview`, `publish` (no livery, no speed), `published` record |
| `app.py` | routes, the `Workshop` state, the lifespan that starts the evaluator and the watcher |
| `cli.py` | `workshop [id]` opens the home or `#/c/<id>` |

Arena: `arena/store.py` (`RunRecord.description`), `arena/web/routes_submit.py` (`_description`), `arena/commentary/context.py` (the note fact).

Front (`app/`): `workshop.html`; `src/wordmark.js` (`word`), `src/flyer.js` (options); `src/workshop/`: `main.js` (router), `routes.js`, `api.js`, `account.js`, `header.js`, `checks.js`, `home.js`, `challenge.js`, `trainform.js`, `tickets.js`, `job.js`, `publish.js`, `curve.js` (kept); `public/workshop.css` (rewritten). Deleted: `src/workshop/{preflight,train,trial,ui}.js` and their tests, the old `publish.js`/`main.js` and their tests, `race.css`'s `.livery legend` rule, `tests/workshop/fake_gh.py`.

Mockups (local, git-excluded, agreed with the owner): `.superpowers/brainstorm/7640-1790750198/content/{home-v7,challenge,job-v3}.html` with `ws-mock.css` and `ws-page.css`; screenshots in `/private/tmp/claude-501/-Users-nicolasrabault-Projects-HuggingFace-microduck-arena/9f88e57b-22a5-4a4b-b645-cad3b1cd5023/scratchpad/shots/` (`home-v7.png`, `mock-ch-1280.png`, `mock-ch-420.png`, `job-v3.png`, `job-v2-420.png`). The pages must look like these.

---

### Task 1: The Hugging Face account says whether it can pay, and a job's stage can be asked

**Files:**
- Modify: `arena/workshop/hub.py`
- Modify: `arena/workshop/app.py` (`_hub_user`, `GET /hub`)
- Modify: `tests/workshop/conftest.py` (`FakeHub`)
- Test: `tests/workshop/test_hub.py`, `tests/workshop/test_app.py`

**Interfaces:**
- Produces: `hub.Account(name: str, can_pay: bool)` (frozen dataclass); `Hub.whoami() -> Account | None`; `Hub.job_stage(job_id: str, namespace: str) -> str` (one of `SCHEDULING RUNNING COMPLETED CANCELED ERROR DELETED`); `GET /api/workshop/hub -> {"user": str|None, "reachable": bool, "can_pay": bool}`. `FakeHub` gains `can_pay = True`, `stages: dict[str, str]` and `job_stage()`.

- [ ] **Step 1: Write the failing tests**

In `tests/workshop/test_hub.py`, replace `test_the_logged_in_account_is_named` with:

```python
from arena.workshop.hub import Account


def test_the_logged_in_account_is_named_with_whether_it_can_pay(endpoint):
    assert Hub().whoami() == Account("alice", False)
    endpoint["body"] = {"name": "alice", "canPay": True}
    assert Hub().whoami() == Account("alice", True)


def test_a_jobs_stage_is_the_hubs_word_for_it(monkeypatch):
    from types import SimpleNamespace

    from huggingface_hub import HfApi

    asked = []

    def inspect_job(self, *, job_id, namespace=None, token=None):
        asked.append((job_id, namespace))
        return SimpleNamespace(status=SimpleNamespace(stage="RUNNING"))

    monkeypatch.setattr(HfApi, "inspect_job", inspect_job)
    assert Hub().job_stage("j1", "alice") == "RUNNING"
    assert asked == [("j1", "alice")]
```

(Put the `Account` import with the other imports at the top of the file.)

In `tests/workshop/test_app.py`, replace the three `/hub` tests with:

```python
def test_the_hugging_face_account_is_asked_apart(workshop):
    assert workshop.get("/api/workshop/hub").json() == {"user": "alice", "reachable": True, "can_pay": True}


def test_an_account_without_a_payment_method_is_said_so(workshop, hub):
    hub.can_pay = False
    assert workshop.get("/api/workshop/hub").json()["can_pay"] is False


def test_a_logged_out_user_is_told_so(workshop, hub):
    hub.user = None
    assert workshop.get("/api/workshop/hub").json() == {"user": None, "reachable": True, "can_pay": False}


def test_an_unreachable_hub_is_said_not_waited_for(workshop, hub):
    hub.reachable = False
    assert workshop.get("/api/workshop/hub").json() == {"user": None, "reachable": False, "can_pay": False}
```

- [ ] **Step 2: Run them to see them fail**

Run: `uv run --no-config --frozen --extra dev pytest -q tests/workshop/test_hub.py tests/workshop/test_app.py`
Expected: FAIL (`ImportError: cannot import name 'Account'`, `KeyError: 'can_pay'`).

- [ ] **Step 3: Implement**

In `arena/workshop/hub.py`: add `from dataclasses import dataclass`, then above `class Hub`:

```python
@dataclass(frozen=True)
class Account:
    name: str
    # whoami-v2's canPay: a payment method is on the account, so Hugging Face Jobs can bill it.
    can_pay: bool
```

Change `whoami`'s docstring and return type to `-> Account | None` ("The account logged in on this machine, and whether it can pay; None with no token, or one the Hub refuses.") and its last line to:

```python
        body = answer.json()
        return Account(body["name"], bool(body.get("canPay")))
```

Add to `Hub`:

```python
    def job_stage(self, job_id: str, namespace: str) -> str:
        """SCHEDULING, RUNNING, COMPLETED, CANCELED, ERROR or DELETED: the Hub's word for the job."""
        from huggingface_hub import HfApi

        stage = HfApi().inspect_job(job_id=job_id, namespace=namespace).status.stage
        return getattr(stage, "value", str(stage))
```

Update the module docstring's first line to "The Hugging Face calls the workshop makes itself; everything else is a `uv run` subprocess." (unchanged wording is fine if it already says so).

In `arena/workshop/app.py`:

```python
def _hub_user(ws: Workshop) -> str | None:
    try:
        account = ws.hub.whoami()
    except HubUnreachable as exc:
        raise HTTPException(status_code=503, detail=f"Hugging Face is unreachable: {exc}. "
                                                    "Check your connection, then try again.") from exc
    return account.name if account else None


@router.get("/hub")
def hub_account(request: Request) -> dict:
    try:
        account = _workshop(request).hub.whoami()
    except HubUnreachable:
        return {"user": None, "reachable": False, "can_pay": False}
    return {"user": account.name if account else None, "reachable": True, "can_pay": bool(account and account.can_pay)}
```

In `tests/workshop/conftest.py`, `FakeHub`:

```python
from arena.workshop.hub import Account, HubUnreachable


class FakeHub:
    def __init__(self, user="alice"):
        self.user = user
        self.can_pay = True
        self.reachable = True
        self.tokens = []
        self.cancelled = []
        self.stages = {}  # job id -> what inspect_job says; RUNNING when not set

    def whoami(self):
        if not self.reachable:
            raise HubUnreachable("https://huggingface.co did not answer within 5 s")
        return Account(self.user, self.can_pay) if self.user else None

    def job_stage(self, job_id, namespace):
        if not self.reachable:
            raise HubUnreachable("https://huggingface.co did not answer within 5 s")
        return self.stages.get(job_id, "RUNNING")
```

(keep `login` and `cancel_job` as they are; Task 2 removes `login` and `tokens`).

- [ ] **Step 4: Run the workshop tests**

Run: `uv run --no-config --frozen --extra dev pytest -q tests/workshop`
Expected: PASS (everything; `test_logging_in_with_a_token` still passes, its route is unchanged until Task 2).

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add arena/workshop/hub.py arena/workshop/app.py tests/workshop/conftest.py tests/workshop/test_hub.py tests/workshop/test_app.py
/usr/bin/git commit -m "Workshop: the Hugging Face account says whether it can pay, and a job's stage can be asked"
```

---

### Task 2: Logging in from the page with the browser, and a saved login that stays fresh

**Files:**
- Create: `arena/workshop/login.py`
- Modify: `arena/workshop/hub.py` (remove `login`, add `drop_exported_token`)
- Modify: `arena/workshop/app.py` (replace `POST /login`, add `GET /login`, `Workshop.login`)
- Modify: `arena/workshop/cli.py` (call `drop_exported_token()`)
- Modify: `tests/workshop/fake_uv.py` (`hf auth login`), `tests/workshop/conftest.py` (`FakeHub.login`/`tokens` go)
- Test: `tests/workshop/test_login.py` (new), `tests/workshop/test_hub.py`, `tests/workshop/test_app.py`

**Interfaces:**
- Consumes: `shell.uv`, `shell.child_env`.
- Produces: `login.BrowserLogin(root, open_browser)` with `start() -> {"url": str, "code": str}` (raises `login.LoginError(output)`), `state() -> {"state": None|"waiting"|"done"|"failed", "output": str}`, `end()`; `hub.drop_exported_token() -> None`; routes `POST /api/workshop/login -> {url, code}` (502 on `LoginError`), `GET /api/workshop/login -> state()`. `Workshop` gains `login: BrowserLogin`.

- [ ] **Step 1: Teach the fake `uv` to log in**

In `tests/workshop/fake_uv.py`, extend the docstring with: "`hf auth login` prints what huggingface_hub's browser flow prints without a terminal, waits FAKE_HF_LOGIN_S, then succeeds (FAKE_HF_LOGIN_DENIED=1: fails; FAKE_HF_LOGIN_SILENT=1: prints no URL)." and change `hf`:

```python
def hf(argv):
    if argv[:2] == ["auth", "login"]:
        return login(argv)
    repo, dest = argv[1], Path(flag(argv, "--local-dir"))
    source = Path(os.environ["FAKE_HUB"]) / repo
    if source.is_dir():
        shutil.copytree(source, dest, dirs_exist_ok=True)
    print(dest)
    return 0


def login(argv):
    assert "--force" in argv, argv
    if os.environ.get("FAKE_HF_LOGIN_SILENT"):
        print("hf: unknown command 'auth'", file=sys.stderr)
        return 2
    print("\n    Open this URL in your browser:\n        https://huggingface.co/oauth/device?user_code=WDJB-MJHT\n", flush=True)
    print("    And enter the code: WDJB-MJHT\n", flush=True)
    print("    Waiting for authorization", end="", flush=True)
    time.sleep(float(os.environ.get("FAKE_HF_LOGIN_S", "0")))
    print()
    if os.environ.get("FAKE_HF_LOGIN_DENIED"):
        print("Authorization denied.", file=sys.stderr)
        return 1
    print("Login successful.")
    return 0
```

- [ ] **Step 2: Write the failing tests**

Create `tests/workshop/test_login.py`:

```python
"""Logging in from the page: the workshop runs `hf auth login`, which without a terminal takes
huggingface_hub's browser flow, and opens the URL it prints. No token is pasted anywhere."""

import os

from tests.workshop.conftest import wait_for

URL = "https://huggingface.co/oauth/device?user_code=WDJB-MJHT"


def _ended(workshop):
    state = workshop.get("/api/workshop/login").json()
    return state if state["state"] in ("done", "failed") else None


def test_logging_in_opens_huggingface_with_the_code_in_it(workshop, fakes):
    response = workshop.post("/api/workshop/login")
    assert response.status_code == 200, response.text
    assert response.json() == {"url": URL, "code": "WDJB-MJHT"}
    assert workshop.opened == [URL]
    assert ["run", "--no-sync", "hf", "auth", "login", "--force"] in fakes.calls("hf")
    assert wait_for(lambda: _ended(workshop))["state"] == "done"


def test_until_it_is_approved_the_login_waits(workshop, fakes, monkeypatch):
    monkeypatch.setenv("FAKE_HF_LOGIN_S", "30")
    workshop.post("/api/workshop/login")
    assert workshop.get("/api/workshop/login").json()["state"] == "waiting"
    workshop.app.state.workshop.login.end()
    assert wait_for(lambda: _ended(workshop))["state"] == "failed"


def test_a_denied_login_says_so_with_its_output(workshop, fakes, monkeypatch):
    monkeypatch.setenv("FAKE_HF_LOGIN_DENIED", "1")
    workshop.post("/api/workshop/login")
    state = wait_for(lambda: _ended(workshop))
    assert state["state"] == "failed" and "Authorization denied." in state["output"]


def test_a_login_that_prints_no_url_is_an_error_with_its_output_not_a_hang(workshop, fakes, monkeypatch):
    monkeypatch.setenv("FAKE_HF_LOGIN_SILENT", "1")
    response = workshop.post("/api/workshop/login")
    assert response.status_code == 502 and "unknown command 'auth'" in response.json()["detail"]
    assert workshop.opened == []


def test_a_login_drops_the_token_the_launcher_exported(workshop, fakes):
    """huggingface_hub reads HF_TOKEN before the saved login, and refreshes only a saved one."""
    assert os.environ["HF_TOKEN"] == "hf_from_the_launcher"
    workshop.post("/api/workshop/login")
    wait_for(lambda: _ended(workshop))
    assert "HF_TOKEN" not in os.environ


def test_nothing_started_yet(workshop):
    assert workshop.get("/api/workshop/login").json() == {"state": None, "output": ""}
```

In `tests/workshop/test_hub.py`, add:

```python
def test_the_token_the_launcher_exported_goes_when_it_is_the_saved_login(monkeypatch, tmp_path):
    from arena.workshop.hub import drop_exported_token

    saved = tmp_path / "token"
    saved.write_text("hf_saved\n")
    monkeypatch.setattr(constants, "HF_TOKEN_PATH", str(saved))
    monkeypatch.setenv("HF_TOKEN", "hf_saved")
    drop_exported_token()
    assert "HF_TOKEN" not in __import__("os").environ


def test_a_token_that_is_not_the_saved_login_stays(monkeypatch, tmp_path):
    import os

    from arena.workshop.hub import drop_exported_token

    saved = tmp_path / "token"
    saved.write_text("hf_saved\n")
    monkeypatch.setattr(constants, "HF_TOKEN_PATH", str(saved))
    monkeypatch.setenv("HF_TOKEN", "hf_other")
    drop_exported_token()
    assert os.environ["HF_TOKEN"] == "hf_other"
```

In `tests/workshop/test_app.py`, delete `test_logging_in_with_a_token`, `test_a_page_login_outranks_a_stale_token_the_launcher_exported` and `test_a_refused_token_says_why` (the token field is gone).

- [ ] **Step 3: Run them to see them fail**

Run: `uv run --no-config --frozen --extra dev pytest -q tests/workshop/test_login.py tests/workshop/test_hub.py`
Expected: FAIL (`POST /login` answers 422 for a missing body; `drop_exported_token` does not exist).

- [ ] **Step 4: Implement**

Create `arena/workshop/login.py`:

```python
"""Logging in to Hugging Face from the page, as `hf auth login` does it from a shell.

Without a terminal, huggingface_hub (2.0) always takes its browser flow, an OAuth device code: it
prints a URL, the code already in it, and the code, waits while the user approves on
huggingface.co, then saves the login itself. So the workshop runs that command, reads the URL
from its output and opens it: no token is copied, and none passes through here.

The login's process is the workshop's child in the same process group: Ctrl-C ends both. Left
behind by a workshop that was killed, it fails on its next line of output, the pipe being gone.
"""

import os
import re
import signal
import subprocess
import threading

from .shell import child_env, uv

_URL = re.compile(r"^\s*(https://\S+)\s*$")
_CODE = re.compile(r"enter the code:\s*(\S+)")
# huggingface_hub prints the URL at once; past this, something else answered.
READ_WITHIN_S = 20.0


class LoginError(RuntimeError):
    """`hf auth login` gave no URL to open; the message is its whole output."""


class BrowserLogin:
    def __init__(self, root, open_browser):
        self.root, self.open_browser = root, open_browser
        self.proc: subprocess.Popen | None = None
        self._lines: list[str] = []
        self._found = threading.Event()  # the URL and the code are out
        self._read = threading.Event()  # the process has ended and its output is all read

    def start(self) -> dict:
        self.end()
        self._lines, self._found, self._read = [], threading.Event(), threading.Event()
        self.proc = subprocess.Popen(
            uv("hf", "auth", "login", "--force"), cwd=self.root, stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace", bufsize=1,
            env=child_env(),
        )
        threading.Thread(target=self._follow, args=(self.proc, self._lines, self._found, self._read), daemon=True).start()
        self._found.wait(READ_WITHIN_S)
        url, code = _url_and_code(self._lines)
        if url is None or code is None:
            self.end()
            raise LoginError("\n".join(self._lines) or "hf auth login printed nothing")
        self.open_browser(url)
        return {"url": url, "code": code}

    @staticmethod
    def _follow(proc, lines, found, read) -> None:
        for line in proc.stdout:
            lines.append(line.rstrip("\n"))
            if _url_and_code(lines)[1] is not None:
                found.set()
        if proc.wait() == 0:
            # The new login is saved; an HF_TOKEN still set would outrank it (and never refresh).
            os.environ.pop("HF_TOKEN", None)
        found.set()
        read.set()

    def state(self) -> dict:
        if self.proc is None:
            return {"state": None, "output": ""}
        # "done" only once the output is all read and HF_TOKEN dropped, not as soon as the process exits.
        if not self._read.is_set():
            state = "waiting"
        else:
            state = "done" if self.proc.returncode == 0 else "failed"
        return {"state": state, "output": "\n".join(self._lines)}

    def end(self) -> None:
        """Give up a login still waiting for approval (a second click starts afresh)."""
        if self.proc is not None and self.proc.poll() is None:
            try:
                self.proc.send_signal(signal.SIGTERM)
            except OSError:
                pass
            self.proc.wait()


def _url_and_code(lines: list[str]) -> tuple[str | None, str | None]:
    url = next((m.group(1) for line in lines if (m := _URL.match(line))), None)
    code = next((m.group(1) for line in lines if (m := _CODE.search(line))), None)
    return url, code
```

In `arena/workshop/hub.py`: delete `Hub.login`; add `import os` and `from pathlib import Path`, and:

```python
def drop_exported_token() -> None:
    """The launcher exports HF_TOKEN so uv can install the Arena wheel from its private repo.
    huggingface_hub reads HF_TOKEN before the saved login and refreshes only the saved one: kept,
    the exported copy of a browser login would expire under the workshop. Dropped when it is
    that saved login; a token set on purpose, different from it, stays."""
    from huggingface_hub import constants

    exported = os.environ.get("HF_TOKEN")
    saved = Path(constants.HF_TOKEN_PATH)
    if exported and saved.is_file() and saved.read_text().strip() == exported.strip():
        del os.environ["HF_TOKEN"]
```

In `arena/workshop/app.py`: delete `class Token`, the old `login` route and the `import os`; add `from .login import BrowserLogin, LoginError`; add the field `login: BrowserLogin = field(default=None)` to `Workshop` and set it in `create_workshop_app`: `app.state.workshop = Workshop(root, challenge, arena, hub, open_browser)` followed by `app.state.workshop.login = BrowserLogin(root, open_browser)`; add the routes:

```python
@router.post("/login")
def login(request: Request) -> dict:
    """Start the browser login; the page then asks /hub until the account appears."""
    try:
        return _workshop(request).login.start()
    except LoginError as exc:
        raise HTTPException(status_code=502, detail=f"Could not start the Hugging Face login:\n{exc}") from exc


@router.get("/login")
def login_state(request: Request) -> dict:
    return _workshop(request).login.state()
```

In `arena/workshop/cli.py`, in `main`, right after the busy-port check and before the imports of `create_workshop_app`: `from .hub import Hub, drop_exported_token` (replace the existing `from .hub import Hub`) and call `drop_exported_token()` before `create_workshop_app(...)`.

In `tests/workshop/conftest.py`, delete `FakeHub.login` and `self.tokens`.

- [ ] **Step 5: Run the workshop tests**

Run: `uv run --no-config --frozen --extra dev pytest -q tests/workshop`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add arena/workshop/login.py arena/workshop/hub.py arena/workshop/app.py arena/workshop/cli.py tests/workshop/fake_uv.py tests/workshop/conftest.py tests/workshop/test_login.py tests/workshop/test_hub.py tests/workshop/test_app.py
/usr/bin/git commit -m "Workshop: log in from the page with Hugging Face's browser flow, and keep the saved login fresh"
```

---

### Task 3: Your code — what is not committed, a commit, your fork, a push

**Files:**
- Modify: `arena/workshop/code.py`, `arena/workshop/shell.py` (remove `gh_ready`), `arena/workshop/app.py` (routes, `preflight`)
- Delete: `tests/workshop/fake_gh.py`
- Modify: `tests/workshop/conftest.py` (no fake `gh`)
- Test: `tests/workshop/test_code.py` (rewritten), `tests/workshop/test_app.py`, `tests/workshop/test_publishing.py`

**Interfaces:**
- Produces: `code.code_state(root) -> {"fork": "owner/name"|None, "changes": [{"status": str, "path": str}], "identity": bool, "commit": str, "unpushed": int}`; `code.commit(root, message) -> None`; `code.use_fork(root, url) -> None`; `code.push(root) -> None`; `code.code_url(root, commit)` unchanged. Routes: `GET /api/workshop/code`, `POST /api/workshop/code/commit {message}`, `POST /api/workshop/code/fork {url}`, `POST /api/workshop/code/push`, each answering `code_state` (400 with git's words on failure).

- [ ] **Step 1: Write the failing tests**

Replace `tests/workshop/test_code.py` with:

```python
"""Your code: what is not committed yet, the commit that saves it, your fork, and the push."""

import pytest

from tests.workshop.conftest import UPSTREAM, git

FORK = "https://github.com/alice/microduck-challenges"


def _state(workshop):
    return workshop.get("/api/workshop/code").json()


def _make_fork(remotes):
    fork = remotes / "alice" / "microduck-challenges"
    fork.mkdir(parents=True)
    git(fork.parent, "init", "-q", "--bare", str(fork))
    return fork


def test_a_fresh_clone_is_committed_and_not_in_a_fork(workshop, checkout):
    body = _state(workshop)
    assert body["fork"] is None and body["changes"] == [] and body["identity"] is True
    assert body["commit"] == git(checkout, "rev-parse", "--short=9", "HEAD")


def test_what_is_not_committed_is_listed_by_file(workshop, checkout):
    folder = checkout / "src" / "microduck_challenges" / "sprint_2m"
    (folder / "challenge.toml").write_text((folder / "challenge.toml").read_text() + "# mine\n")
    (folder / "rewards.py").write_text("# mine\n")
    assert _state(workshop)["changes"] == [
        {"status": "M", "path": "src/microduck_challenges/sprint_2m/challenge.toml"},
        {"status": "??", "path": "src/microduck_challenges/sprint_2m/rewards.py"},
    ]


def test_a_commit_takes_everything_with_the_users_message(workshop, checkout):
    (checkout / "src" / "microduck_challenges" / "sprint_2m" / "rewards.py").write_text("# mine\n")
    body = workshop.post("/api/workshop/code/commit", json={"message": "sprint-2m training revision 2026-09-30 09:40"}).json()
    assert body["changes"] == []
    assert git(checkout, "log", "-1", "--format=%s") == "sprint-2m training revision 2026-09-30 09:40"


@pytest.mark.parametrize("message", ["", "   "])
def test_a_commit_needs_a_message(workshop, checkout, message):
    (checkout / "mine.py").write_text("# mine\n")
    response = workshop.post("/api/workshop/code/commit", json={"message": message})
    assert response.status_code == 400 and "message" in response.json()["detail"]
    assert git(checkout, "log", "-1", "--format=%s") == "the challenges"


def test_nothing_to_commit_is_said(workshop):
    response = workshop.post("/api/workshop/code/commit", json={"message": "again"})
    assert response.status_code == 400 and "Nothing to commit" in response.json()["detail"]


def test_without_a_name_on_commits_the_state_says_so(workshop, checkout, monkeypatch, tmp_path):
    git(checkout, "config", "--unset", "user.email")
    monkeypatch.setenv("HOME", str(tmp_path))  # no global identity either
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    assert _state(workshop)["identity"] is False


def test_a_fork_becomes_origin_and_pollens_repo_upstream_without_a_push(workshop, checkout, remotes):
    fork = _make_fork(remotes)
    body = workshop.post("/api/workshop/code/fork", json={"url": FORK}).json()
    assert body["fork"] == "alice/microduck-challenges"
    assert git(checkout, "config", "--get", "remote.origin.url") == FORK
    assert git(checkout, "config", "--get", "remote.upstream.url") == UPSTREAM
    assert git(fork, "branch") == ""  # nothing pushed


def test_a_second_fork_address_replaces_origin(workshop, checkout, remotes):
    workshop.post("/api/workshop/code/fork", json={"url": "https://github.com/alice/typo"})
    body = workshop.post("/api/workshop/code/fork", json={"url": FORK}).json()
    assert git(checkout, "config", "--get", "remote.origin.url") == FORK
    assert git(checkout, "config", "--get", "remote.upstream.url") == UPSTREAM
    assert body["fork"] == "alice/microduck-challenges"


def test_an_address_that_is_not_github_is_refused(workshop):
    response = workshop.post("/api/workshop/code/fork", json={"url": "https://evil.example/alice/x"})
    assert response.status_code == 400


@pytest.mark.parametrize("url", [UPSTREAM, "https://github.com/Pollen-Robotics/microduck-challenges.git"])
def test_pollens_own_address_is_not_taken_for_a_fork(workshop, checkout, url):
    response = workshop.post("/api/workshop/code/fork", json={"url": url})
    assert response.status_code == 400 and "your fork" in response.json()["detail"]
    assert git(checkout, "config", "--get", "remote.origin.url") == UPSTREAM
    assert git(checkout, "remote") == "origin"  # no upstream: nothing renamed


def test_the_push_sends_the_commits_to_the_fork_and_nothing_else(workshop, checkout, remotes):
    fork = _make_fork(remotes)
    workshop.post("/api/workshop/code/fork", json={"url": FORK})
    (checkout / "mine.py").write_text("# mine\n")
    workshop.post("/api/workshop/code/commit", json={"message": "mine"})
    assert _state(workshop)["unpushed"] == 1
    body = workshop.post("/api/workshop/code/push").json()
    assert body["unpushed"] == 0
    assert git(fork, "rev-parse", "main") == git(checkout, "rev-parse", "HEAD")


def test_the_push_commits_nothing(workshop, checkout, remotes):
    _make_fork(remotes)
    workshop.post("/api/workshop/code/fork", json={"url": FORK})
    (checkout / "mine.py").write_text("# mine\n")
    workshop.post("/api/workshop/code/push")
    assert git(checkout, "status", "--porcelain") == "?? mine.py"


def test_nothing_is_pushed_to_pollens_repo(workshop, checkout, remotes):
    upstream = remotes / "pollen-robotics" / "microduck-challenges"
    before = git(upstream, "rev-parse", "main")
    response = workshop.post("/api/workshop/code/push")
    assert response.status_code == 400
    assert response.json()["detail"] == "Fork first: your code goes to your fork, not Pollen's repo."
    assert git(upstream, "rev-parse", "main") == before


def test_a_push_to_a_fork_that_is_not_there_says_gits_words(workshop, checkout):
    workshop.post("/api/workshop/code/fork", json={"url": FORK})  # no bare repo at this address
    response = workshop.post("/api/workshop/code/push")
    assert response.status_code == 400 and "git push" in response.json()["detail"]


def test_the_code_link_names_the_commit_once_it_is_on_the_fork(workshop, checkout, remotes):
    from arena.workshop.code import code_url

    _make_fork(remotes)
    commit = git(checkout, "rev-parse", "--short=9", "HEAD")
    assert code_url(checkout, commit) is None
    workshop.post("/api/workshop/code/fork", json={"url": FORK})
    workshop.post("/api/workshop/code/push")
    assert code_url(checkout, commit) == f"https://github.com/alice/microduck-challenges/tree/{commit}"


@pytest.mark.parametrize(
    "url,repo",
    [
        ("https://github.com/alice/microduck-challenges", ("alice", "microduck-challenges")),
        ("https://github.com/alice/microduck-challenges.git", ("alice", "microduck-challenges")),
        ("git@github.com:alice/microduck-challenges.git", ("alice", "microduck-challenges")),
        ("https://gitlab.com/alice/x", None),
        (None, None),
    ],
)
def test_github_addresses_are_read_in_both_forms(url, repo):
    from arena.workshop.code import github_repo

    assert github_repo(url) == repo
```

In `tests/workshop/test_app.py`: change `test_without_an_nvidia_gpu_training_goes_to_hf_jobs` to expect `body["preflight"] == {"git": True, "uv": True, "gpu": False}`, and delete `test_git_without_a_name_on_commits_is_flagged` (moved to `test_code.py`).

In `tests/workshop/test_publishing.py`, replace the body of `test_the_entry_carries_the_code_once_it_is_shared` with:

```python
def test_the_entry_carries_the_code_once_it_is_shared(workshop, fakes, checkout, remotes):
    fork = remotes / "alice" / "microduck-challenges"
    fork.mkdir(parents=True)
    git(fork.parent, "init", "-q", "--bare", str(fork))
    workshop.post("/api/workshop/code/fork", json={"url": "https://github.com/alice/microduck-challenges"})
    workshop.post("/api/workshop/code/push")
    run = make_run(checkout, "first")
    commit = git(checkout, "rev-parse", "--short=9", "HEAD")
    body = _publish(workshop, run).json()
    assert body["env"] == f"https://github.com/alice/microduck-challenges/tree/{commit}"
    (call,) = fakes.calls("publish")
    assert call[call.index("--code-url") + 1] == body["env"]
```

- [ ] **Step 2: Run them to see them fail**

Run: `uv run --no-config --frozen --extra dev pytest -q tests/workshop/test_code.py`
Expected: FAIL (`changes` is a count today; `/code/commit` does not exist).

- [ ] **Step 3: Implement**

Replace `arena/workshop/code.py` with:

```python
"""Where the user's code stands, and the steps that share it.

The recipe a policy is published with names a commit; it is worth something only if that commit
is somewhere people can open it. So the workshop says what is not committed yet (a training starts
from a commit), whether this checkout works in the user's own fork, and how many commits are only
on this machine. A nudge, never a gate: a policy can be published without a code link.
"""

import re
from pathlib import Path

from .shell import ShellError, commit_all, git

UPSTREAM_OWNER = "pollen-robotics"
_GITHUB = re.compile(r"^(?:https://github\.com/|git@github\.com:)([\w.-]+)/([\w.-]+?)(?:\.git)?/?$")
# One `git status --porcelain` line; the first may have lost its leading space to git()'s strip.
_STATUS = re.compile(r"^\s*(\S{1,2})\s+(.+)$")


def github_repo(url: str | None) -> tuple[str, str] | None:
    found = _GITHUB.match(url or "")
    return (found.group(1), found.group(2)) if found else None


def _remote(root: Path, name: str) -> str | None:
    # config, not `git remote get-url`: the address as the user set it, before any url.insteadOf.
    return git(root, "config", "--get", f"remote.{name}.url", check=False) or None


def _pollens(repo: tuple[str, str] | None) -> bool:
    return repo is not None and repo[0].lower() == UPSTREAM_OWNER  # GitHub owners ignore case


def _fork(root: Path) -> tuple[str, str] | None:
    repo = github_repo(_remote(root, "origin"))
    return repo if repo and not _pollens(repo) else None


def code_state(root: Path) -> dict:
    fork = _fork(root)
    changes = [{"status": m.group(1), "path": m.group(2)}
               for line in git(root, "status", "--porcelain").splitlines() if (m := _STATUS.match(line))]
    return {
        "fork": "/".join(fork) if fork else None,
        "changes": changes,
        # A commit needs a name: the workshop commits before every training.
        "identity": bool(git(root, "config", "user.email", check=False)),
        "commit": git(root, "rev-parse", "--short=9", "HEAD"),
        # Commits no remote holds: on this machine only.
        "unpushed": int(git(root, "rev-list", "--count", "HEAD", "--not", "--remotes", check=False) or 0),
    }


def commit(root: Path, message: str) -> None:
    if not message.strip():
        raise ShellError("A commit needs a message.")
    if not commit_all(root, message.strip()):
        raise ShellError("Nothing to commit: everything is already committed.")


def use_fork(root: Path, url: str) -> None:
    """Make the user's fork `origin`, Pollen's repository `upstream`. Nothing is pushed.

    Once `upstream` exists the fork already happened: a second address (a typo fixed) only
    replaces origin.
    """
    repo = github_repo(url.strip())
    if repo is None:
        raise ShellError(f"{url} is not a GitHub repository address (https://github.com/<you>/<name>).")
    if _pollens(repo):
        raise ShellError(f"{url} is Pollen's repository: paste the address of your fork (https://github.com/<you>/<name>).")
    if _remote(root, "upstream") is not None:
        git(root, "remote", "set-url", "origin", url.strip())
    else:
        git(root, "remote", "rename", "origin", "upstream")
        git(root, "remote", "add", "origin", url.strip())


def push(root: Path) -> None:
    if _fork(root) is None:
        raise ShellError("Fork first: your code goes to your fork, not Pollen's repo.")
    git(root, "push", "-u", "origin", "HEAD")


def code_url(root: Path, commit: str | None) -> str | None:
    """https://github.com/<fork>/tree/<commit>, once that commit is on the user's fork."""
    fork = _fork(root)
    if not commit or fork is None:
        return None
    holders = git(root, "branch", "-r", "--contains", commit, check=False).splitlines()
    if not any(line.strip().startswith("origin/") for line in holders):
        return None
    return f"https://github.com/{fork[0]}/{fork[1]}/tree/{commit}"
```

In `arena/workshop/shell.py`: delete `gh_ready` and the `shutil` import if nothing else uses it; drop "and gh" from the module docstring's first line.

In `arena/workshop/app.py`:
- imports: `from .code import code_state, code_url, commit, push, use_fork` and `from .shell import ShellError, commit_all` (drop `gh_ready`, `git` if unused);
- `preflight(root)` returns `{"git": ..., "uv": ..., "gpu": ...}` only (identity and gh go; update its docstring);
- replace the code routes with:

```python
class CommitRequest(BaseModel):
    message: str


class ForkRequest(BaseModel):
    url: str


def _code_step(ws: Workshop, step) -> dict:
    try:
        step()
    except ShellError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return code_state(ws.root)


@router.get("/code")
def code(request: Request) -> dict:
    return code_state(_workshop(request).root)


@router.post("/code/commit")
def code_commit(body: CommitRequest, request: Request) -> dict:
    ws = _workshop(request)
    return _code_step(ws, lambda: commit(ws.root, body.message))


@router.post("/code/fork")
def code_fork(body: ForkRequest, request: Request) -> dict:
    ws = _workshop(request)
    return _code_step(ws, lambda: use_fork(ws.root, body.url))


@router.post("/code/push")
def code_push(request: Request) -> dict:
    ws = _workshop(request)
    return _code_step(ws, lambda: push(ws.root))
```

Delete `tests/workshop/fake_gh.py`; in `tests/workshop/conftest.py` the `fakes` fixture installs `uv` only (`for tool, source in (("uv", "fake_uv.py"),):` becomes a single write of `bin_dir / "uv"`), and the module docstring says "fake `uv`" (no `gh`).

- [ ] **Step 4: Run the workshop tests**

Run: `uv run --no-config --frozen --extra dev pytest -q tests/workshop`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add -A arena/workshop tests/workshop
/usr/bin/git commit -m "Workshop: say what is not committed, commit it with the user's message, use a fork without gh, push alone"
```

---

### Task 4: Every open challenge in one workshop, trainings in parallel, one ticket per training

The core of the server change. Routes that only the old page used go; `trial` and `publish` move under the challenge's prefix unchanged (Tasks 5 and 7 replace them).

**Files:**
- Create: `arena/workshop/tickets.py`
- Modify: `arena/workshop/jobs.py`, `arena/workshop/training.py`, `arena/workshop/app.py`, `arena/workshop/cli.py`
- Modify: `tests/workshop/conftest.py` (`make_run`, `reopen`, `store_evaluation`, fixture teardown), `tests/workshop/fake_uv.py` (run folder per task)
- Test: `tests/workshop/test_training.py` (rewritten), `tests/workshop/test_tickets.py` (new), `tests/workshop/test_app.py`, `tests/workshop/test_cli.py`, `tests/workshop/test_trials.py`, `tests/workshop/test_publishing.py`
- Delete: `tests/workshop/test_jobs.py` (its cases move to `test_tickets.py`)

**Interfaces:**
- Consumes: `Hub.whoami() -> Account|None` (Task 1), `BrowserLogin` (Task 2), `code_state`, `commit_all` (Task 3).
- Produces:
  - `jobs.recorded_jobs(root, task=None) -> list[dict]` (records need `name` and `task`), `jobs.remember_job(root, task, name, **fields)`, `jobs.TERMINAL = frozenset({"COMPLETED","CANCELED","ERROR","DELETED"})`. `find_job` goes.
  - A record: `{"task", "name", "where": "local"|"hf-jobs", "recipe", "params", "started"}` plus, for HF, `"ckpt_repo", "namespace", "job_id"`; a local training that ended adds `"ended": "finished"|"failed"|"stopped"`; the watcher (Task 6) adds `"stage", "asked", "pulled"`.
  - `training.Training(root, challenge, name, where, recipe, params, hf_user=None)` with `.task .name .where .namespace .ckpt_repo .state .returncode .job_id .progress -> (done, total)|None`, `.log(since) -> (lines, next)`, `.stop(hub)`, `.pull()`.
  - `tickets.source(ws, challenge, ticket_id) -> (id, live, record, run) | None`, `tickets.tickets(ws, challenge) -> list[dict]`, `tickets.ticket(ws, challenge, ticket_id) -> dict|None`, `tickets.ticket_detail(ws, challenge, ticket_id, since=0) -> dict|None`.
  - A ticket: `{"id", "name", "where": "local"|"hf-jobs"|None, "state": "starting"|"running"|"done"|"stopped"|"failed", "progress": {"done","total"}|None, "started", "run_id", "dirty", "checkpoints": [{"n","status": "evaluated"|"queued", "score","seeds_finished","seeds_total","command_vx"}], "best": int|None}`; the detail adds `"log", "next", "following", "curve", "commit", "recipe", "params"`.
  - `Workshop(root, challenges: dict[event, Challenge], arena, hub, open_browser, login, trainings: dict[(task, name), Training], lock, publishing)`; `create_workshop_app(root, challenges: list[Challenge], arena, hub, port, frontend_dir=None, open_browser=webbrowser.open)`.
  - Routes (prefix `/api/workshop`): `GET /status -> {"challenges": [{"event": summary, "folder", "task", "recipe", "knobs": [{name,label,value,min,max,group: "reward"|"recipe"}], "running": int}], "arena", "gpu"}`; `POST /challenges/{event}/train {name, where, recipe, params}` → the ticket; `GET /challenges/{event}/jobs -> {"jobs": [...]}`; `GET /challenges/{event}/jobs/{id}?since=N`; `POST /challenges/{event}/jobs/{id}/stop` → the ticket; `POST /challenges/{event}/runs/{run_id}/trial`; `POST /challenges/{event}/publish`. Gone: `GET/POST /train`, `/train/stop`, `/train/pull`, `/jobs`, `/jobs/{name}/pull`, `/jobs/{name}/stop`, `/runs`, `/runs/{id}/curve`, `/runs/{id}/trial`, `/publish`.
  - `workshop` opens `http://127.0.0.1:<port>/`, `workshop <id>` opens `http://127.0.0.1:<port>/#/c/<event>`.

- [ ] **Step 1: Update the test harness**

In `tests/workshop/fake_uv.py`, `train()`: the run goes under the task's own folder, as mjlab's experiment folders do (two challenges' runs of one name must never share a directory):

```python
    run = base / argv[0].lower() / f"{datetime.now().astimezone():%Y-%m-%d_%H-%M-%S}_{name}"
```

In `tests/workshop/conftest.py`:

```python
import base64
import os

from arena.constants import RUNNER_VERSION, TRACE_WIDTH


def make_run(root, name="first", checkpoints=(0, 1), dirty=False, stamp="2026-09-28_10-00-00",
             task="Mjlab-Sprint2m-MicroDuck", iterations=None, age_s=60):
    """A run as mjlab writes it. `iterations`: the --agent.max-iterations its provenance records.
    Its checkpoint files are `age_s` old: an evaluation waits for a file younger than 30 s."""
    run = root / "logs" / "rsl_rl" / "sprint_2m" / f"{stamp}_{name}"
    run.mkdir(parents=True)
    day, time_of_day = stamp.split("_")
    provenance = {
        "task": task, "commit": git(root, "rev-parse", "--short=9", "HEAD"), "branch": "main",
        "dirty": dirty, "seed": 1, "started": f"{day}T{time_of_day.replace('-', ':')}Z",
    }
    if iterations is not None:
        provenance["command"] = ["train", task, "--agent.max-iterations", str(iterations)]
    (run / "provenance.json").write_text(json.dumps(provenance))
    old = time.time() - age_s
    for n in checkpoints:
        (run / f"model_{n}.pt").write_bytes(b"pt")
        os.utime(run / f"model_{n}.pt", (old, old))
    shutil.copy(PROBE, run / "events.out.tfevents.1.probe")
    return run


def store_evaluation(run, n, score=5.0, finished=5, total=5):
    """What an evaluation of checkpoint n stores, written by hand."""
    trace = base64.b64encode(bytes(4 * TRACE_WIDTH * 2)).decode("ascii")
    folder = run / "workshop"
    folder.mkdir(exist_ok=True)
    (folder / f"model_{n}.json").write_text(json.dumps({
        "checkpoint": n, "score": score, "command_vx": 0.55, "seeds_finished": finished, "seeds_total": total,
        "per_seed": [], "trace_seed": 1, "trace_b64": trace, "runner_version": RUNNER_VERSION,
    }))


def reopen(checkout, hub, opened=None):
    """The workshop closed and opened again on the same checkout: nothing left in memory."""
    app = create_workshop_app(checkout, open_challenges(checkout), "http://arena.test", hub, PORT,
                              open_browser=(opened.append if opened is not None else lambda url: None))
    return TestClient(app, base_url=ADDRESS)
```

and the `workshop` fixture becomes:

```python
@pytest.fixture
def workshop(checkout, fakes, hub, monkeypatch):
    # As the launcher exports it. monkeypatch puts the developer's own back after the test.
    monkeypatch.setenv("HF_TOKEN", "hf_from_the_launcher")
    opened = []
    client = reopen(checkout, hub, opened)
    client.opened = opened
    yield client
    # A training still followed pulls one last time as it ends: after this test, PATH is the
    # developer's again, and that pull would be the real uv's `hf download`, on the real Hub.
    for training in client.app.state.workshop.trainings.values():
        training.stop(hub)
        wait_for(lambda: training.returncode is not None)
```

(`reopen` is defined above the fixture; `create_workshop_app` and `open_challenges` are already imported at the top of conftest.)

- [ ] **Step 2: Write the failing tests**

Replace `tests/workshop/test_training.py` with:

```python
"""Launching: every training starts from a commit, on this machine's NVIDIA GPU or on Hugging Face
Jobs; any number of HF jobs run at once, one training at most on this machine."""

import threading

import pytest

from tests.workshop.conftest import SPRINT, git, make_run, reopen, wait_for

SPRINT_URL = "/api/workshop/challenges/sprint-2m"
TASK = "Mjlab-Sprint2m-MicroDuck"
LOCAL = {"name": "first", "where": "local", "recipe": {"num_envs": 512, "max_iterations": 50, "seed": 3},
         "params": {"forward_reward": 3.5}}
HF = LOCAL | {"where": "hf-jobs"}
TOML = ("src", "microduck_challenges", "sprint_2m", "challenge.toml")


def launch(client, body, url=SPRINT_URL):
    return client.post(f"{url}/train", json=body)


def ended(client, ticket_id="first", url=SPRINT_URL):
    body = client.get(f"{url}/jobs/{ticket_id}").json()
    return body if body["state"] in ("done", "failed", "stopped") else None


def live(client, name="first", task=TASK):
    return client.app.state.workshop.trainings[(task, name)]


def test_a_launch_commits_the_settings_then_trains_here(workshop, fakes, checkout):
    fakes.gpu()
    response = launch(workshop, LOCAL)
    assert response.status_code == 200, response.text
    assert (response.json()["id"], response.json()["where"]) == ("first", "local")
    body = wait_for(lambda: ended(workshop))
    assert body["state"] == "done"
    toml = checkout.joinpath(*TOML).read_text()
    assert "num_envs       = 512" in toml and "value = 3.5" in toml and "# the first training, as is" in toml
    assert git(checkout, "log", "-1", "--format=%s") == "sprint-2m: run first"
    assert git(checkout, "status", "--porcelain") == ""
    (train,) = fakes.calls("train")
    assert train == ["run", "--no-sync", "train", TASK, "--env.scene.num-envs", "512",
                     "--agent.max-iterations", "50", "--agent.seed", "3", "--agent.logger", "tensorboard",
                     "--agent.run-name", "first"]
    assert [c["n"] for c in body["checkpoints"]] == [0, 1]
    assert [step for step, _ in body["curve"]] == [1, 2]


def test_on_hf_jobs_it_submits_the_job_and_brings_the_run_back(workshop, fakes):
    launch(workshop, HF)
    body = wait_for(lambda: ended(workshop))
    assert body["where"] == "hf-jobs" and body["state"] == "done" and body["run_id"]
    (train,) = fakes.calls("train")
    assert train[-6:] == ["--hf-jobs", "--no-wandb", "--namespace", "alice", "--ckpt-repo",
                          "alice/mjlab-sprint2m-microduck-first"]
    assert ["run", "--no-sync", "hf", "download", "alice/mjlab-sprint2m-microduck-first",
            "--local-dir", "logs/rsl_rl", "--quiet"] in fakes.calls("hf")
    assert any("fetched the checkpoints" in line for line in body["log"])


def test_a_training_waits_for_a_commit(workshop, fakes, checkout):
    fakes.gpu()
    (checkout / "src" / "microduck_challenges" / "sprint_2m" / "rewards.py").write_text("# mine\n")
    response = launch(workshop, LOCAL)
    assert response.status_code == 409 and "Commit" in response.json()["detail"]
    assert checkout.joinpath(*TOML).read_text() == SPRINT and fakes.calls("train") == []


def test_this_machine_trains_only_with_an_nvidia_gpu(workshop, fakes, checkout):
    response = launch(workshop, LOCAL)
    assert response.status_code == 400 and "NVIDIA" in response.json()["detail"]
    assert checkout.joinpath(*TOML).read_text() == SPRINT and fakes.calls("train") == []


def test_hf_jobs_need_a_login_and_nothing_is_touched_without_one(workshop, hub, checkout, fakes):
    hub.user = None
    response = launch(workshop, HF)
    assert response.status_code == 400 and "log in" in response.json()["detail"].lower()
    assert checkout.joinpath(*TOML).read_text() == SPRINT and fakes.calls("train") == []


def test_hf_jobs_say_when_the_hub_is_unreachable_and_touch_nothing(workshop, hub, checkout, fakes):
    hub.reachable = False
    response = launch(workshop, HF)
    assert response.status_code == 503 and "unreachable" in response.json()["detail"]
    assert checkout.joinpath(*TOML).read_text() == SPRINT and fakes.calls("train") == []


def test_several_hf_jobs_run_at_once(workshop, fakes, monkeypatch):
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    assert launch(workshop, HF).status_code == 200
    assert launch(workshop, HF | {"name": "second"}).status_code == 200
    states = {t["id"]: t["state"] for t in workshop.get(f"{SPRINT_URL}/jobs").json()["jobs"]}
    assert states == {"first": "running", "second": "running"}


def test_one_training_at_a_time_on_this_machine(workshop, fakes, monkeypatch):
    fakes.gpu()
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    launch(workshop, LOCAL)
    again = launch(workshop, LOCAL | {"name": "second"})
    assert again.status_code == 409 and "this machine" in again.json()["detail"]
    assert launch(workshop, HF | {"name": "third"}).status_code == 200


def test_a_run_name_already_used_is_refused(workshop, fakes, checkout):
    fakes.gpu()
    make_run(checkout, "first")
    assert launch(workshop, LOCAL).status_code == 409


@pytest.mark.parametrize("name", ["", "First", "a b", "x" * 41, "-lead", "first-", "a--b"])
def test_a_run_name_must_be_a_plain_slug(workshop, fakes, name):
    fakes.gpu()
    assert launch(workshop, LOCAL | {"name": name}).status_code == 400


def test_a_training_runs_somewhere_the_workshop_knows(workshop, fakes):
    assert launch(workshop, LOCAL | {"where": "moon"}).status_code == 400


def test_a_knob_out_of_range_is_refused_and_nothing_is_written(workshop, fakes, checkout):
    fakes.gpu()
    response = launch(workshop, LOCAL | {"params": {"forward_reward": 50.0}})
    assert response.status_code == 400 and "between" in response.json()["detail"]
    assert checkout.joinpath(*TOML).read_text() == SPRINT


def test_an_unknown_challenge_is_404(workshop):
    assert launch(workshop, LOCAL, url="/api/workshop/challenges/moon-landing").status_code == 404


def test_the_same_run_name_in_two_challenges_does_not_mix(workshop, fakes, checkout, hub):
    """Review focus: the tickets of one challenge never show another's training."""
    hill = checkout / "src" / "microduck_challenges" / "hill_climb_1m5"
    hill.mkdir()
    (hill / "challenge.toml").write_text(SPRINT.replace('"sprint-2m"', '"hill-climb-1m5"')
                                         .replace(TASK, "Mjlab-HillClimb1m5-MicroDuck"))
    git(checkout, "add", "-A")
    git(checkout, "commit", "-q", "-m", "the hill")
    fakes.gpu()
    both = reopen(checkout, hub)
    hill_url = "/api/workshop/challenges/hill-climb-1m5"
    assert launch(both, LOCAL).status_code == 200
    wait_for(lambda: ended(both))
    assert launch(both, HF, url=hill_url).status_code == 200
    wait_for(lambda: ended(both, url=hill_url))
    sprint_jobs = both.get(f"{SPRINT_URL}/jobs").json()["jobs"]
    hill_jobs = both.get(f"{hill_url}/jobs").json()["jobs"]
    assert [(t["id"], t["where"]) for t in sprint_jobs] == [("first", "local")]
    assert [(t["id"], t["where"]) for t in hill_jobs] == [("first", "hf-jobs")]


def test_stop_ends_a_local_training(workshop, fakes, monkeypatch):
    fakes.gpu()
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    launch(workshop, LOCAL)
    assert workshop.post(f"{SPRINT_URL}/jobs/first/stop").status_code == 200
    assert wait_for(lambda: ended(workshop))["state"] == "stopped"


def test_stop_cancels_the_hf_job_it_follows(workshop, fakes, hub, monkeypatch):
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    launch(workshop, HF)
    wait_for(lambda: live(workshop).job_id)
    workshop.post(f"{SPRINT_URL}/jobs/first/stop")
    assert hub.cancelled == [("fakejob42", "alice")]
    assert wait_for(lambda: ended(workshop))["state"] == "stopped"


def test_stop_cancels_the_resubmitted_job_not_the_dead_first_one(workshop, fakes, hub, monkeypatch):
    """train --hf-jobs resubmits after a volume-mount failure, printing a fresh [job] id: each time;
    only the last one is still alive to cancel."""
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    monkeypatch.setenv("FAKE_UV_RESUBMIT", "1")
    launch(workshop, HF)
    wait_for(lambda: live(workshop).job_id == "fakejob43")
    workshop.post(f"{SPRINT_URL}/jobs/first/stop")
    assert hub.cancelled == [("fakejob43", "alice")]


def test_a_cancel_that_fails_502s_and_keeps_following(workshop, fakes, hub, monkeypatch):
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    real_cancel_job = hub.cancel_job
    attempts = []

    def flaky_cancel(job_id, namespace):
        attempts.append(job_id)
        if len(attempts) == 1:
            raise RuntimeError("Hub is down")
        return real_cancel_job(job_id, namespace)

    hub.cancel_job = flaky_cancel
    launch(workshop, HF)
    wait_for(lambda: live(workshop).job_id)
    response = workshop.post(f"{SPRINT_URL}/jobs/first/stop")
    assert response.status_code == 502 and "cancel" in response.json()["detail"].lower()
    assert workshop.get(f"{SPRINT_URL}/jobs/first").json()["state"] == "running"
    assert workshop.post(f"{SPRINT_URL}/jobs/first/stop").status_code == 200
    assert hub.cancelled == [("fakejob42", "alice")]


def test_a_failed_training_says_so(workshop, fakes, monkeypatch):
    fakes.gpu()
    monkeypatch.setenv("FAKE_UV_TRAIN_RC", "3")
    launch(workshop, LOCAL)
    assert wait_for(lambda: ended(workshop))["state"] == "failed"


def test_a_training_that_ended_cannot_be_stopped(workshop, fakes):
    fakes.gpu()
    launch(workshop, LOCAL)
    wait_for(lambda: ended(workshop))
    assert workshop.post(f"{SPRINT_URL}/jobs/first/stop").status_code == 409


def test_two_launches_close_together_only_one_wins(workshop, fakes, monkeypatch):
    """Without the lock both could pass the one-local-training rule before either is recorded."""
    fakes.gpu()
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "5")
    results, lock = [], threading.Lock()

    def go(name):
        result = launch(workshop, LOCAL | {"name": name})
        with lock:
            results.append(result)

    threads = [threading.Thread(target=go, args=(name,)) for name in ("first", "second")]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(r.status_code for r in results) == [200, 409]
    wait_for(lambda: fakes.calls("train"))
    assert len(fakes.calls("train")) == 1
```

Create `tests/workshop/test_tickets.py`:

```python
"""The tickets: one per training of a challenge, gathered from the training followed now, the record
each launch writes, and the run directory — after a restart as before it."""

import json

import pytest

from tests.workshop.conftest import SPRINT, git, make_run, reopen, store_evaluation, wait_for

SPRINT_URL = "/api/workshop/challenges/sprint-2m"
TASK = "Mjlab-Sprint2m-MicroDuck"
LOCAL = {"name": "first", "where": "local", "recipe": {"num_envs": 512, "max_iterations": 50, "seed": 3},
         "params": {"forward_reward": 3.5}}
HF = LOCAL | {"where": "hf-jobs"}


def jobs(client):
    return client.get(f"{SPRINT_URL}/jobs").json()["jobs"]


def detail(client, ticket_id="first", since=0):
    return client.get(f"{SPRINT_URL}/jobs/{ticket_id}?since={since}").json()


def live(client, name="first"):
    return client.app.state.workshop.trainings[(TASK, name)]


def test_nothing_trained_yet(workshop):
    assert jobs(workshop) == []


def test_a_run_trained_from_a_shell_is_a_ticket_under_its_directory(workshop, checkout):
    run = make_run(checkout, "first", checkpoints=(0, 1), iterations=2)
    (ticket,) = jobs(workshop)
    assert (ticket["id"], ticket["name"], ticket["where"], ticket["run_id"]) == (run.name, "first", None, run.name)
    assert ticket["state"] == "done" and ticket["progress"] == {"done": 2, "total": 2}
    assert ticket["dirty"] is False and ticket["started"] == "2026-09-28T10:00:00Z"


def test_a_shell_run_short_of_its_iterations_reads_as_stopped(workshop, checkout):
    make_run(checkout, "first", checkpoints=(0,), iterations=50)
    (ticket,) = jobs(workshop)
    assert ticket["state"] == "stopped" and ticket["progress"] == {"done": 0, "total": 50}


def test_tickets_are_newest_first(workshop, checkout):
    make_run(checkout, "old", stamp="2026-09-20_10-00-00")
    make_run(checkout, "new", stamp="2026-09-28_10-00-00")
    assert [t["name"] for t in jobs(workshop)] == ["new", "old"]


def test_a_followed_training_shows_its_progress_from_its_log(workshop, fakes, monkeypatch):
    fakes.gpu()
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    workshop.post(f"{SPRINT_URL}/train", json=LOCAL)
    wait_for(lambda: live(workshop).progress)
    (ticket,) = jobs(workshop)
    assert ticket["state"] == "running" and ticket["progress"] == {"done": 1, "total": 2}


def test_the_log_is_read_from_an_offset(workshop, fakes):
    fakes.gpu()
    workshop.post(f"{SPRINT_URL}/train", json=LOCAL)
    whole = wait_for(lambda: (body := detail(workshop))["state"] == "done" and body)
    assert whole["log"][0].startswith("$ uv run --no-sync train") and whole["following"] is True
    assert detail(workshop, since=whole["next"] - 1)["log"] == whole["log"][-1:]


def test_after_a_restart_a_recorded_hf_job_keeps_its_ticket(workshop, fakes, checkout, hub, monkeypatch):
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    workshop.post(f"{SPRINT_URL}/train", json=HF)
    wait_for(lambda: live(workshop).job_id)
    reopened = reopen(checkout, hub)
    (ticket,) = jobs(reopened)
    assert (ticket["id"], ticket["where"], ticket["state"], ticket["run_id"]) == ("first", "hf-jobs", "running", None)
    body = detail(reopened)
    assert body["log"] == [] and body["following"] is False
    assert body["recipe"] == HF["recipe"] and body["params"] == HF["params"]


def test_after_a_restart_a_running_hf_job_can_still_be_stopped(workshop, fakes, checkout, hub, monkeypatch):
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    workshop.post(f"{SPRINT_URL}/train", json=HF)
    wait_for(lambda: live(workshop).job_id)
    reopened = reopen(checkout, hub)
    assert reopened.post(f"{SPRINT_URL}/jobs/first/stop").status_code == 200
    assert hub.cancelled == [("fakejob42", "alice")]
    assert jobs(reopened)[0]["state"] == "stopped"


def test_a_cancel_the_hub_refuses_says_so_in_its_words(workshop, fakes, checkout, hub, monkeypatch):
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    workshop.post(f"{SPRINT_URL}/train", json=HF)
    wait_for(lambda: live(workshop).job_id)
    cancel = hub.cancel_job

    def down(job_id, namespace):
        raise RuntimeError("Hub is down")

    hub.cancel_job = down
    reopened = reopen(checkout, hub)
    response = reopened.post(f"{SPRINT_URL}/jobs/first/stop")
    assert response.status_code == 502 and "Hub is down" in response.json()["detail"]
    assert jobs(reopened)[0]["state"] == "running"
    hub.cancel_job = cancel


def test_a_local_training_whose_workshop_closed_reads_as_stopped(workshop, fakes, checkout, hub, monkeypatch):
    fakes.gpu()
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    workshop.post(f"{SPRINT_URL}/train", json=LOCAL)
    wait_for(lambda: live(workshop).progress)
    (ticket,) = jobs(reopen(checkout, hub))
    assert ticket["state"] == "stopped" and ticket["progress"] == {"done": 1, "total": 50}


def test_a_local_training_that_ended_says_how_after_a_restart(workshop, fakes, checkout, hub, monkeypatch):
    fakes.gpu()
    monkeypatch.setenv("FAKE_UV_TRAIN_RC", "3")
    workshop.post(f"{SPRINT_URL}/train", json=LOCAL)
    record = checkout / "logs" / "workshop-jobs.json"
    wait_for(lambda: json.loads(record.read_text())[0].get("ended"))
    assert jobs(reopen(checkout, hub))[0]["state"] == "failed"


def test_a_recorded_name_is_not_reused_before_its_run_is_fetched(workshop, fakes, checkout, hub, monkeypatch):
    """The name is also the checkpoint repo's: a second job under it would upload into the first's."""
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    workshop.post(f"{SPRINT_URL}/train", json=HF)
    wait_for(lambda: live(workshop).job_id)
    assert reopen(checkout, hub).post(f"{SPRINT_URL}/train", json=HF).status_code == 409


@pytest.mark.parametrize("junk", [
    '{"first": "not a list"}',
    '[1, "two", {"no": "name"}]',
    '[{"name": "legacy", "ckpt_repo": "alice/x", "namespace": "alice", "job_id": "j0"}]',  # before tasks
])
def test_an_older_or_hand_edited_jobs_file_keeps_only_what_reads_as_a_job(workshop, fakes, checkout, junk, monkeypatch):
    """Review focus: never a 500, and a launch still works."""
    (checkout / "logs").mkdir()
    (checkout / "logs" / "workshop-jobs.json").write_text(junk)
    assert jobs(workshop) == []
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    assert workshop.post(f"{SPRINT_URL}/train", json=HF).status_code == 200
    assert [t["name"] for t in jobs(workshop)] == ["first"]


def test_an_unknown_ticket_is_404(workshop):
    assert workshop.get(f"{SPRINT_URL}/jobs/nope").status_code == 404
    assert workshop.post(f"{SPRINT_URL}/jobs/nope/stop").status_code == 404


def test_the_best_checkpoint_is_the_fastest_that_finishes(workshop, checkout):
    run = make_run(checkout, "first", checkpoints=(0, 1, 2, 3), iterations=4)
    store_evaluation(run, 0, score=50.0, finished=0)
    store_evaluation(run, 1, score=6.1)
    store_evaluation(run, 2, score=5.4)
    (ticket,) = jobs(workshop)
    assert ticket["best"] == 2
    assert [(c["n"], c["status"]) for c in ticket["checkpoints"]] == [
        (0, "evaluated"), (1, "evaluated"), (2, "evaluated"), (3, "queued")]
    assert ticket["checkpoints"][2]["score"] == 5.4 and "trace_b64" not in ticket["checkpoints"][2]


def test_a_voted_event_has_no_best(checkout, fakes, hub):
    swag = checkout / "src" / "microduck_challenges" / "swag_contest"
    swag.mkdir()
    (swag / "challenge.toml").write_text(SPRINT.replace('"sprint-2m"', '"swag-contest"')
                                         .replace(TASK, "Mjlab-SwagContest-MicroDuck"))
    git(checkout, "add", "-A")
    git(checkout, "commit", "-q", "-m", "the swag")
    run = make_run(checkout, "first", checkpoints=(0,), task="Mjlab-SwagContest-MicroDuck")
    store_evaluation(run, 0, score=12.0)
    (ticket,) = reopen(checkout, hub).get("/api/workshop/challenges/swag-contest/jobs").json()["jobs"]
    assert ticket["best"] is None and ticket["checkpoints"][0]["status"] == "evaluated"
```

In `tests/workshop/test_app.py`, replace `test_status_names_the_challenge_its_recipe_knobs_and_event`, `test_without_an_nvidia_gpu_training_goes_to_hf_jobs` and `test_with_an_nvidia_gpu_it_trains_here` with:

```python
def test_status_lists_the_open_challenges_with_their_settings(workshop):
    body = workshop.get("/api/workshop/status").json()
    (sprint,) = body["challenges"]
    assert sprint["event"]["id"] == "sprint-2m" and sprint["event"]["rig"] == "legs"
    assert (sprint["folder"], sprint["task"]) == ("sprint_2m", "Mjlab-Sprint2m-MicroDuck")
    assert sprint["recipe"] == {"num_envs": 4096, "max_iterations": 3000, "seed": 1}
    assert sprint["knobs"] == [{"name": "forward_reward", "label": "Follow the speed order", "value": 2.0,
                                "min": 0.5, "max": 5.0, "group": "reward"}]
    assert sprint["running"] == 0
    assert body["arena"] == "http://arena.test" and body["gpu"] is False


def test_a_knob_that_is_not_a_reward_goes_with_the_recipe(checkout, fakes, hub):
    toml = checkout / "src" / "microduck_challenges" / "sprint_2m" / "challenge.toml"
    toml.write_text(toml.read_text() + '\n[params.max_slope_deg]\nlabel = "Steepest training slope"\n'
                    "value = 10.0\nmin   = 0.0\nmax   = 15.0\n")
    (sprint,) = reopen(checkout, hub).get("/api/workshop/status").json()["challenges"]
    assert [(k["name"], k["group"]) for k in sprint["knobs"]] == [("forward_reward", "reward"), ("max_slope_deg", "recipe")]


def test_with_an_nvidia_gpu_the_status_says_so(workshop, fakes):
    fakes.gpu()
    assert workshop.get("/api/workshop/status").json()["gpu"] is True
```

(import `reopen` from conftest), and in `test_a_post_from_the_page_itself_or_from_no_page_goes_through` post to `/api/workshop/challenges/sprint-2m/jobs/nope/stop` and expect 404 ("the guard let it reach the route"). In the two `create_workshop_app(...)` calls of the static-site tests pass `open_challenges(checkout)` (the list) instead of `open_challenges(checkout)[0]`.

In `tests/workshop/test_cli.py`, replace `test_with_no_challenge_it_lists_the_open_ones` and `test_an_unknown_challenge_is_refused_with_the_list` with:

```python
def test_with_no_challenge_it_opens_the_home(checkout, monkeypatch, capsys):
    served = {}
    port = _free_port()
    monkeypatch.chdir(checkout)
    monkeypatch.setattr("uvicorn.Server.run", lambda server: served.update(app=server.config.app))
    assert cli.main(["--no-browser", "--port", str(port)]) == 0
    assert f"http://127.0.0.1:{port}/  (" in capsys.readouterr().out
    assert list(served["app"].state.workshop.challenges) == ["sprint-2m"]


def test_an_unknown_challenge_is_refused_naming_the_open_ones(checkout, monkeypatch, capsys):
    monkeypatch.chdir(checkout)
    assert cli.main(["moon-landing"]) == 2
    err = capsys.readouterr().err
    assert "moon-landing" in err and "sprint-2m" in err
```

and in `test_a_challenge_opens_the_workshop_on_it` add `capsys` to its arguments, replace `assert workshop.challenge.event == "sprint-2m"` with `assert list(workshop.challenges) == ["sprint-2m"]`, and add `assert f"http://127.0.0.1:{port}/#/c/sprint-2m" in capsys.readouterr().out`; in `test_the_folder_name_works_too` add `capsys` and replace its last assert with `assert "/#/c/sprint-2m" in capsys.readouterr().out`.

In `tests/workshop/test_trials.py`: `_trial` posts to `f"/api/workshop/challenges/sprint-2m/runs/{run.name}/trial"`; the unknown-run request in `test_an_unknown_checkpoint_or_run_is_refused` too; replace `test_the_runs_listing_shows_what_was_tested` with

```python
def test_the_tickets_show_what_was_tested(workshop, fakes, checkout):
    run = make_run(checkout, "first")
    score = _trial(workshop, run).json()["score"]
    (ticket,) = workshop.get("/api/workshop/challenges/sprint-2m/jobs").json()["jobs"]
    assert [(c["n"], c["status"]) for c in ticket["checkpoints"]] == [(0, "queued"), (1, "evaluated")]
    assert ticket["checkpoints"][1]["score"] == score and ticket["checkpoints"][1]["seeds_finished"] == 5
```

and in `test_a_corrupt_cache_does_not_break_the_listing_and_is_measured_again` read `workshop.get("/api/workshop/challenges/sprint-2m/jobs")` (status 200, both checkpoints `queued`).

In `tests/workshop/test_publishing.py`: `_publish` posts to `/api/workshop/challenges/sprint-2m/publish`.

Delete `tests/workshop/test_jobs.py`.

- [ ] **Step 3: Run them to see them fail**

Run: `uv run --no-config --frozen --extra dev pytest -q tests/workshop`
Expected: FAIL (routes 404, `create_workshop_app` takes one challenge, no `tickets` module).

- [ ] **Step 4: Implement `jobs.py`**

Replace `arena/workshop/jobs.py` with:

```python
"""Every training launched from this checkout, written down in logs/workshop-jobs.json.

A training outlives the workshop's memory of it: closed, or crashed, the workshop leaves a Hugging
Face job running and billed, and forgets what it launched. So each launch writes down what its
ticket needs later: the challenge's task, where it runs, its recipe and settings, when it started;
for a Hugging Face job the checkpoint repo, the account and the last job id. A local training
adds how it ended; the watcher (watch.py) adds what the Hub last said of a job. logs/ is ignored
by git, so no commit ever carries this file.
"""

import json
import os
import threading
from pathlib import Path

JOBS = Path("logs") / "workshop-jobs.json"
# The Hub's stages after which a job does nothing more.
TERMINAL = frozenset({"COMPLETED", "CANCELED", "ERROR", "DELETED"})
_WRITING = threading.Lock()  # a launch, the log it follows and the watcher all write


def recorded_jobs(root: Path, task: str | None = None) -> list[dict]:
    """Newest first; only `task`'s when given. What does not read as a job — a hand-edited file, a
    record from before trainings were written down by task — is left out."""
    try:
        jobs = json.loads((root / JOBS).read_text())
    except (OSError, ValueError):
        return []
    if not isinstance(jobs, list):
        return []
    return [job for job in jobs
            if isinstance(job, dict) and "name" in job and "task" in job and task in (None, job["task"])]


def remember_job(root: Path, task: str, name: str, **fields) -> None:
    """Write down `task`'s training called `name`, or update the fields of the one written down."""
    with _WRITING:
        jobs = recorded_jobs(root)
        job = next((j for j in jobs if (j["task"], j["name"]) == (task, name)), None)
        if job is None:
            jobs.insert(0, {"task": task, "name": name, **fields})
        else:
            job.update(fields)
        path = root / JOBS
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(path.name + ".tmp")
        tmp.write_text(json.dumps(jobs, indent=1))
        os.replace(tmp, path)  # a reader sees the old list or the new one, never half of one
```

- [ ] **Step 5: Implement `training.py`**

In `arena/workshop/training.py`: update the module docstring's last sentence to "Every launch is written down (jobs.py): it outlives this process."; add `_ITERATION = re.compile(r"Learning iteration (\d+)/(\d+)")` under `_JOB_ID`; keep `ckpt_repo`, `fetch`, `train_command` as they are; replace `class Training` with:

```python
class Training:
    def __init__(self, root, challenge, name: str, where: str, recipe: dict[str, int],
                 params: dict[str, float], hf_user: str | None = None):
        """`where` is "local" or "hf-jobs"; `hf_user` the account an HF job runs (and is billed) under."""
        self.root, self.task, self.name, self.where = root, challenge.task, name, where
        self.namespace = hf_user if where == "hf-jobs" else None
        self.ckpt_repo = ckpt_repo(hf_user, challenge, name) if self.namespace else None
        command = train_command(challenge, name, recipe, self.namespace)
        self.returncode: int | None = None
        self._lines = [f"$ {shlex.join(command)}"]
        self._job_id: str | None = None
        self._progress: tuple[int, int] | None = None
        # Reentrant: `state` reads under it while `log` already holds it.
        self._lock = threading.RLock()
        self._ended = threading.Event()
        self._stopped = False
        self.proc = subprocess.Popen(
            command, cwd=root, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, errors="replace", bufsize=1, env=child_env(), start_new_session=True,
        )
        # Before the log is read: its job ids update this record.
        hf = {"ckpt_repo": self.ckpt_repo, "namespace": self.namespace, "job_id": None} if self.ckpt_repo else {}
        remember_job(root, self.task, name, where=where, recipe=recipe, params=params,
                     started=datetime.now(UTC).isoformat(timespec="seconds"), **hf)
        threading.Thread(target=self._follow, daemon=True).start()
        if self.ckpt_repo:
            threading.Thread(target=self._pull_while_running, daemon=True).start()

    def _say(self, line: str) -> None:
        # A resubmitted job (mjlab retries on a volume-mount failure) prints a fresh id; the last one
        # seen is the one actually running and billed.
        job = _JOB_ID.match(line) if self.ckpt_repo else None
        iteration = _ITERATION.search(line)
        with self._lock:
            self._lines.append(line)
            if job:
                self._job_id = job.group(1)
            if iteration:
                self._progress = (int(iteration.group(1)), int(iteration.group(2)))
        if job:
            remember_job(self.root, self.task, self.name, job_id=job.group(1))

    def _follow(self) -> None:
        for line in self.proc.stdout:
            self._say(line.rstrip("\n"))
        code = self.proc.wait()
        self._ended.set()
        if self.ckpt_repo:
            self.pull()  # whatever the job saved last
        with self._lock:
            self.returncode = code  # read by `state`; set with the log so a snapshot is never torn
        if not self.ckpt_repo:
            # How a local training ended, for its ticket after a restart; an HF job's end is the Hub's word.
            remember_job(self.root, self.task, self.name, ended=self.state)

    def _pull_while_running(self) -> None:
        while not self._ended.wait(PULL_EVERY_S):
            self.pull()

    def pull(self) -> None:
        done = fetch(self.root, self.ckpt_repo)
        if done.returncode == 0:
            self._say(f"[workshop] fetched the checkpoints from {self.ckpt_repo}")
        else:
            self._say(f"[workshop] could not fetch {self.ckpt_repo}:")
            for line in (done.stdout + done.stderr).splitlines():
                self._say(line)

    @property
    def job_id(self) -> str | None:
        with self._lock:
            return self._job_id

    @property
    def progress(self) -> tuple[int, int] | None:
        """(iteration, iterations) as the log last said it."""
        with self._lock:
            return self._progress

    @property
    def state(self) -> str:
        if self.returncode is None:
            return "running"
        if self._stopped:
            return "stopped"
        return "finished" if self.returncode == 0 else "failed"

    def stop(self, hub) -> None:
        """Cancel the HF job first — killing `train --hf-jobs` would only detach from it — then end
        the local process. A no-op once the process has already ended: the state can still read
        "running" while the final pull is in flight, and by then there is no job left to cancel and
        the pid may already have been recycled (`_follow` reaps it right away).
        """
        if self._ended.is_set():
            return
        if self.ckpt_repo and (job := self.job_id):
            hub.cancel_job(job, self.namespace)  # the only call in this method the caller need worry about
            self._say(f"[workshop] cancelled job {job}")
        self._stopped = True
        try:
            os.killpg(self.proc.pid, signal.SIGTERM)
        except OSError:
            pass

    def log(self, since: int = 0) -> tuple[list[str], int]:
        """The lines from `since`, and where the next read starts."""
        with self._lock:
            return self._lines[max(since, 0):], len(self._lines)
```

- [ ] **Step 6: Implement `tickets.py`**

Create `arena/workshop/tickets.py`:

```python
"""A challenge's trainings as the page shows them: one ticket each.

A ticket gathers what is known of one training from three places: the training this workshop
follows now (its log, its exact state), the record each launch writes (jobs.py, which outlives the
workshop), and the run directory mjlab writes (checkpoints, provenance, curve). A run trained from a
shell has no record: its ticket is its directory alone, under the directory's name. Nothing here
asks the network — what the Hub says of a job is in its record, written by the watcher.
"""

from ..manifest import load_event
from .jobs import recorded_jobs
from .runs import curve, find_runs
from .trials import tested

# What the Hub says of a job, as a ticket says it.
HF_STAGES = {"SCHEDULING": "starting", "RUNNING": "running", "COMPLETED": "done",
             "CANCELED": "stopped", "ERROR": "failed", "DELETED": "failed"}
# What a followed training's process says, as a ticket says it.
LIVE_STATES = {"running": "running", "finished": "done", "failed": "failed", "stopped": "stopped"}


def _iterations(record, run) -> int | None:
    """How many iterations the training was launched for: its record's recipe, else its provenance."""
    if record and record.get("recipe"):
        return int(record["recipe"]["max_iterations"])
    command = list(run.provenance.get("command") or []) if run else []
    for i, arg in enumerate(command):
        if arg == "--agent.max-iterations" and i + 1 < len(command):
            return int(command[i + 1])
        if arg.startswith("--agent.max-iterations="):
            return int(arg.split("=", 1)[1])
    return None


def _state(live, record, run, total) -> str:
    if live is not None:
        return LIVE_STATES[live.state]
    if record and record.get("where") == "hf-jobs":
        return HF_STAGES.get(record.get("stage"), "running")
    if record and record.get("ended"):
        return LIVE_STATES[record["ended"]]
    # A local training whose workshop was closed, or a run from a shell: its checkpoints say.
    last = run.checkpoints[-1] if run and run.checkpoints else None
    return "done" if total and last is not None and last + 1 >= total else "stopped"


def _progress(live, run, total, state) -> dict | None:
    if live is not None and live.progress:
        done, total = live.progress
        return {"done": done, "total": total}
    if not total:
        return None
    if state == "done":
        return {"done": total, "total": total}
    return {"done": run.checkpoints[-1] if run and run.checkpoints else 0, "total": total}


def _checkpoints(run, voted: bool) -> tuple[list[dict], int | None]:
    tried = tested(run) if run else {}
    rows = [{"n": n, "status": "evaluated" if n in tried else "queued", **tried.get(n, {})}
            for n in (run.checkpoints if run else ())]
    finishers = [r for r in rows if r["status"] == "evaluated" and r["seeds_finished"] > 0]
    # A voted event is not a clock: its best is the public's to say.
    best = None if voted or not finishers else min(finishers, key=lambda r: (r["score"], r["n"]))["n"]
    return rows, best


def _started(record, run) -> str:
    return (record or {}).get("started") or (run.provenance.get("started") if run else None) or ""


def _sources(ws, challenge) -> list[tuple]:
    """(id, live, record, run) for each training of `challenge`, newest first."""
    runs = find_runs(ws.root, challenge.task)  # newest first: the first of a name is its newest
    newest = {}
    for run in runs:
        newest.setdefault(run.name, run)
    found, claimed = [], set()
    for record in recorded_jobs(ws.root, challenge.task):
        run = newest.get(record["name"])
        if run is not None:
            claimed.add(run.id)
        found.append((record["name"], ws.trainings.get((challenge.task, record["name"])), record, run))
    found += [(run.id, None, None, run) for run in runs if run.id not in claimed]
    return sorted(found, key=lambda s: _started(s[2], s[3]), reverse=True)


def _ticket(source_, voted: bool) -> dict:
    ticket_id, live, record, run = source_
    total = _iterations(record, run)
    state = _state(live, record, run, total)
    rows, best = _checkpoints(run, voted)
    return {
        "id": ticket_id,
        "name": record["name"] if record else run.name,
        "where": record["where"] if record else None,
        "state": state,
        "progress": _progress(live, run, total, state),
        "started": _started(record, run),
        "run_id": run.id if run else None,
        "dirty": bool(run and run.provenance.get("dirty")),
        "checkpoints": rows,
        "best": best,
    }


def _voted(challenge) -> bool:
    return load_event(challenge.event).metric == "votes"


def source(ws, challenge, ticket_id: str) -> tuple | None:
    """(id, live, record, run) of one ticket, or None."""
    return next((s for s in _sources(ws, challenge) if s[0] == ticket_id), None)


def tickets(ws, challenge) -> list[dict]:
    voted = _voted(challenge)
    return [_ticket(s, voted) for s in _sources(ws, challenge)]


def ticket(ws, challenge, ticket_id: str) -> dict | None:
    found = source(ws, challenge, ticket_id)
    return _ticket(found, _voted(challenge)) if found else None


def ticket_detail(ws, challenge, ticket_id: str, since: int = 0) -> dict | None:
    """The ticket with what its page adds: the log from `since`, the curve, what it was launched with."""
    found = source(ws, challenge, ticket_id)
    if found is None:
        return None
    _, live, record, run = found
    lines, following = live.log(since) if live is not None else ([], since)
    return {
        **_ticket(found, _voted(challenge)),
        "log": lines, "next": following, "following": live is not None,
        "curve": curve(run) if run else [],
        "commit": run.provenance.get("commit") if run else None,
        "recipe": (record or {}).get("recipe"),
        "params": (record or {}).get("params"),
    }
```

- [ ] **Step 7: Implement `app.py` and `cli.py`**

In `arena/workshop/app.py`:

- Module docstring's first line: "The workshop's server: the open challenges of one checkout, on 127.0.0.1, never deployed."
- Imports: drop `curve`, `find_run`, `find_job`, `recorded_jobs` from the old lines as needed; add `from .jobs import TERMINAL, recorded_jobs, remember_job`, `from .runs import find_runs`, `from .shell import ShellError, commit_all, git`, `from .tickets import source, ticket, ticket_detail, tickets`, `from .training import Training`.
- Replace `Workshop` and `preflight` with:

```python
@dataclass
class Workshop:
    root: Path
    challenges: dict[str, Challenge]  # by event id, in folder order
    arena: str
    hub: Hub
    open_browser: object
    login: BrowserLogin
    # The trainings this workshop launched and follows, by (task, run name): two challenges may each
    # have a run called "first".
    trainings: dict[tuple[str, str], Training] = field(default_factory=dict)
    # Serializes launch and stop: without it two launches ~250 ms apart could both pass the
    # one-local-training rule, and race `write_values`/`commit_all` over the same checkout.
    lock: threading.Lock = field(default_factory=threading.Lock)
    # One publish or preview at a time: two of one name race over ./publish-<name>/ and the Hub repo.
    publishing: threading.Lock = field(default_factory=threading.Lock)


def has_gpu() -> bool:
    return shutil.which("nvidia-smi") is not None


def _challenge_or_404(ws: Workshop, event: str) -> Challenge:
    challenge = ws.challenges.get(event)
    if challenge is None:
        raise HTTPException(status_code=404, detail=f"{event} is not a challenge open here.")
    return challenge


def _knob(knob) -> dict:
    # A knob named *_reward weighs a reward; any other (the hill's steepest slope) shapes the recipe.
    return {**asdict(knob), "group": "reward" if knob.name.endswith("_reward") else "recipe"}
```

- Replace the `/status` route with:

```python
@router.get("/status")
def status(request: Request) -> dict:
    """What the pages draw from, known without the network: the open challenges, the Arena, the GPU.
    Who is logged in to Hugging Face is asked apart (/hub)."""
    ws = _workshop(request)
    return {
        "challenges": [
            {
                "event": event_summary(load_event(c.event)), "folder": c.folder, "task": c.task,
                "recipe": c.recipe, "knobs": [_knob(k) for k in c.knobs],
                "running": sum(t["state"] in ("starting", "running") for t in tickets(ws, c)),
            }
            for c in ws.challenges.values()
        ],
        "arena": ws.arena,
        "gpu": has_gpu(),
    }
```

- Replace everything from `IN_PROGRESS` down to (and including) the old `/runs/{run_id}/curve` route with:

```python
IN_PROGRESS = "A launch or a stop is already in progress."
WHERE = ("local", "hf-jobs")
# Also a Hub repo name: no leading, trailing or doubled dash.
RUN_NAME = re.compile(r"^(?=.{1,40}$)[a-z0-9]+(-[a-z0-9]+)*$")


class Launch(BaseModel):
    name: str
    where: str
    recipe: dict[str, int]
    params: dict[str, float] = {}


@router.post("/challenges/{event}/train")
def launch(event: str, body: Launch, request: Request) -> dict:
    ws = _workshop(request)
    challenge = _challenge_or_404(ws, event)
    if not ws.lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail=IN_PROGRESS)
    try:
        if body.where not in WHERE:
            raise HTTPException(status_code=400, detail="A training runs on this machine or on Hugging Face Jobs.")
        if not RUN_NAME.match(body.name):
            raise HTTPException(
                status_code=400,
                detail="A run name is lowercase letters and digits, joined by single dashes, up to 40 characters.",
            )
        # A recorded job's run may not be fetched yet, and its name is also its checkpoint repo's.
        taken = ({r.name for r in find_runs(ws.root, challenge.task)}
                 | {j["name"] for j in recorded_jobs(ws.root, challenge.task)}
                 | {name for task, name in ws.trainings if task == challenge.task})
        if body.name in taken:
            raise HTTPException(status_code=409, detail=f"There is already a run called {body.name}.")
        if set(body.recipe) != set(RECIPE):
            raise HTTPException(status_code=400, detail=f"The recipe is {', '.join(RECIPE)}, all three.")
        if git(ws.root, "status", "--porcelain"):
            raise HTTPException(status_code=409, detail="Commit your changes first: every training starts from a commit.")
        hf_user = None
        if body.where == "local":
            if not has_gpu():
                raise HTTPException(status_code=400, detail="There is no NVIDIA GPU on this machine: train on Hugging Face Jobs.")
            if any(t.where == "local" and t.state == "running" for t in ws.trainings.values()):
                raise HTTPException(status_code=409, detail="A training already runs on this machine: stop it first.")
        else:
            hf_user = _hub_user(ws)
            if not hf_user:
                raise HTTPException(status_code=400, detail="Hugging Face Jobs need a Hugging Face login: log in first.")
        try:
            write_values(challenge, body.recipe, body.params)
            # Every run starts from a commit, so the recipe a policy is published with is what trained it.
            commit_all(ws.root, f"{challenge.event}: run {body.name}")
        except (ChallengeError, ShellError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        challenge = ws.challenges[event] = read_challenge(challenge.toml)
        ws.trainings[(challenge.task, body.name)] = Training(
            ws.root, challenge, body.name, body.where, body.recipe, body.params, hf_user)
        return ticket(ws, challenge, body.name)
    finally:
        ws.lock.release()


@router.get("/challenges/{event}/jobs")
def jobs(event: str, request: Request) -> dict:
    ws = _workshop(request)
    return {"jobs": tickets(ws, _challenge_or_404(ws, event))}


@router.get("/challenges/{event}/jobs/{ticket_id}")
def job(event: str, ticket_id: str, request: Request, since: int = 0) -> dict:
    ws = _workshop(request)
    body = ticket_detail(ws, _challenge_or_404(ws, event), ticket_id, since)
    if body is None:
        raise HTTPException(status_code=404, detail=f"No training {ticket_id} for {event}.")
    return body


@router.post("/challenges/{event}/jobs/{ticket_id}/stop")
def stop(event: str, ticket_id: str, request: Request) -> dict:
    ws = _workshop(request)
    challenge = _challenge_or_404(ws, event)
    if not ws.lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail=IN_PROGRESS)
    try:
        found = source(ws, challenge, ticket_id)
        if found is None:
            raise HTTPException(status_code=404, detail=f"No training {ticket_id} for {event}.")
        _, live, record, _ = found
        recorded_hf = (live is None and record is not None and record.get("where") == "hf-jobs"
                       and record.get("job_id") and record.get("stage") not in TERMINAL)
        if not (live is not None and live.state == "running") and not recorded_hf:
            raise HTTPException(status_code=409, detail=f"{ticket_id} is not running.")
        try:
            if live is not None:
                live.stop(ws.hub)  # an HF job is cancelled on the Hub first; only that can raise
            else:
                ws.hub.cancel_job(record["job_id"], record["namespace"])
                remember_job(ws.root, challenge.task, record["name"], stage="CANCELED")
        except Exception as exc:
            # The job was NOT cancelled and is still billed: say so; the ticket still says running.
            raise HTTPException(status_code=502, detail=f"Could not cancel the Hugging Face job: {exc}") from exc
        return ticket(ws, challenge, ticket_id)
    finally:
        ws.lock.release()


def _run_or_404(ws: Workshop, challenge: Challenge, run_id: str):
    run = next((r for r in find_runs(ws.root, challenge.task) if r.id == run_id), None)
    if run is None:
        raise HTTPException(status_code=404, detail=f"No run {run_id} in logs/rsl_rl/.")
    return run
```

- Delete the old `/train` (GET, POST), `/train/stop`, `/train/pull`, `/jobs`, `/jobs/{name}/pull`, `/jobs/{name}/stop`, `/runs`, `/runs/{run_id}/curve` routes, `_running`, `_job_or_404`, `_run_summary` and the old `_run_or_404`.
- The trial route becomes `@router.post("/challenges/{event}/runs/{run_id}/trial")` with `event: str` first; it reads `challenge = _challenge_or_404(ws, event)`, `run = _run_or_404(ws, challenge, run_id)` and passes `challenge.event`.
- The publish route becomes `@router.post("/challenges/{event}/publish")` with `event: str` first, `challenge = _challenge_or_404(ws, event)`, `run = _run_or_404(ws, challenge, body.run)`, and `challenge.event` wherever it used `ws.challenge.event`.
- `create_workshop_app(root, challenges: list[Challenge], arena, hub, port, frontend_dir=None, open_browser=webbrowser.open)`: its docstring adds "`challenges`: the checkout's open ones."; build `Workshop(root, {c.event: c for c in challenges}, arena, hub, open_browser, BrowserLogin(root, open_browser))`.

`find_run` in `runs.py` is now unused: delete it and its test `test_find_run_by_id` in `tests/workshop/test_runs.py`.

In `arena/workshop/cli.py`:
- Module docstring:

```python
"""`workshop` — train, test and publish policies for the challenges of a microduck-challenges checkout.

    uv run --group workshop workshop              # the workshop's home, every open challenge
    uv run --group workshop workshop sprint-2m    # straight to that challenge's page

The one line on a challenge's page runs the second form for you.
"""
```

- In `main`, replace the block from `chosen = next(...)` to the `print("Open challenges:")` loop's `return` with:

```python
    chosen = None
    if args.challenge:
        chosen = next((c for c in challenges if args.challenge in (c.event, c.folder)), None)
        if chosen is None:
            names = ", ".join(c.event for c in challenges)
            print(f"{args.challenge!r} is not a challenge open here. Open here: {names}.", file=sys.stderr)
            return 2
```

- Build the app with `create_workshop_app(root, challenges, args.arena.rstrip("/"), Hub(), args.port, ...)`, then:

```python
    url = f"http://127.0.0.1:{args.port}/" + (f"#/c/{chosen.event}" if chosen else "")
    print(f"Microduck workshop: {url}  (Ctrl-C to close it)", flush=True)  # piped, it would wait for exit
```

- The `challenge` argument's help: "an open challenge's event, e.g. sprint-2m, to open straight on its page".

- [ ] **Step 8: Run the workshop tests**

Run: `uv run --no-config --frozen --extra dev pytest -q tests/workshop`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
/usr/bin/git add -A arena/workshop tests/workshop
/usr/bin/git commit -m "Workshop: every open challenge in one workshop, trainings in parallel, one ticket per training"
```

---

### Task 5: Every checkpoint evaluated in the background, and replayed at once

**Files:**
- Rename: `arena/workshop/trials.py` → `arena/workshop/evaluations.py`; `tests/workshop/test_trials.py` → `tests/workshop/test_evaluations.py` (rewritten)
- Modify: `arena/workshop/tickets.py`, `arena/workshop/app.py` (route, lifespan)

**Interfaces:**
- Consumes: `tickets.source`, `find_runs`, `Workshop.challenges`.
- Produces: `evaluations.stored(run, n) -> dict|None`, `evaluations.summary(run) -> {n: {"status": "evaluated", score, seeds_finished, seeds_total, command_vx} | {"status": "failed"}}`, `evaluations.evaluate_checkpoint(root, run, n, event_id) -> dict` (raises `EvaluationError`), `evaluations.next_checkpoint(root, challenges, now=None) -> (challenge, run, n)|None`, `evaluations.evaluate_next(ws) -> bool`, `evaluations.evaluate_forever(ws)`, `FRESH_S = 30.0`. `Workshop.stopping: threading.Event`. Route `GET /api/workshop/challenges/{event}/jobs/{id}/checkpoints/{n}` → the stored evaluation with `trace_b64` (404 "Checkpoint N is not evaluated yet.") or `{"checkpoint": n, "error": str}` for a failure. A ticket row's `status` is now `evaluated`, `failed` or `queued`. The trial route goes.

- [ ] **Step 1: Rename, then write the failing tests**

```bash
/usr/bin/git mv arena/workshop/trials.py arena/workshop/evaluations.py
/usr/bin/git mv tests/workshop/test_trials.py tests/workshop/test_evaluations.py
```

Replace `tests/workshop/test_evaluations.py` with:

```python
"""Every checkpoint is evaluated: exported exactly as `publish` would, then raced by the Arena's own
evaluator, one at a time, newest run first; the result is stored and replayed at once."""

import base64
import json
import os
import threading
import time

from arena.constants import TRACE_WIDTH
from arena.workshop.evaluations import evaluate_checkpoint, evaluate_next, next_checkpoint
from tests.workshop.conftest import make_run, store_evaluation

SPRINT_URL = "/api/workshop/challenges/sprint-2m"


def state(client):
    return client.app.state.workshop


def picked(client):
    found = next_checkpoint(state(client).root, list(state(client).challenges.values()))
    return (found[1].name, found[2]) if found else None


def rows(client):
    (ticket,) = client.get(f"{SPRINT_URL}/jobs").json()["jobs"]
    return [(c["n"], c["status"]) for c in ticket["checkpoints"]]


def test_a_checkpoint_is_exported_by_a_dry_run_publish_and_raced(workshop, fakes, checkout):
    run = make_run(checkout, "first", checkpoints=(1,))
    assert evaluate_next(state(workshop)) is True
    body = workshop.get(f"{SPRINT_URL}/jobs/{run.name}/checkpoints/1").json()
    # The fake export hands over the Arena's reference walker, which finishes the sprint.
    assert (body["seeds_total"], body["seeds_finished"]) == (5, 5)
    assert body["checkpoint"] == 1 and body["score"] < 50
    assert len(base64.b64decode(body["trace_b64"])) % (4 * TRACE_WIDTH) == 0
    (publish,) = fakes.calls("publish")
    assert publish[3:7] == ["--run", str(run), "--checkpoint", "1"]
    assert "--dry-run" in publish and "--allow-dirty" in publish
    assert not (checkout / "publish-workshop-evaluation").exists()
    assert (run / "workshop" / "model_1.onnx").is_file()
    assert rows(workshop) == [(1, "evaluated")]
    assert evaluate_next(state(workshop)) is False  # nothing left


def test_the_newest_run_goes_first_its_checkpoints_in_order(workshop, checkout):
    old = make_run(checkout, "old", stamp="2026-09-20_10-00-00")
    new = make_run(checkout, "new", stamp="2026-09-28_10-00-00")
    order = []
    while (found := picked(workshop)) is not None:
        order.append(found)
        store_evaluation(new if found[0] == new.name else old, found[1])
    assert order == [(new.name, 0), (new.name, 1), (old.name, 0), (old.name, 1)]


def test_a_checkpoint_still_being_written_waits(workshop, checkout):
    run = make_run(checkout, "first", checkpoints=(0,), age_s=0)
    assert picked(workshop) is None
    old = time.time() - 60
    os.utime(run / "model_0.pt", (old, old))
    assert picked(workshop) == (run.name, 0)


def test_a_failed_export_is_stored_and_tried_again_only_once_the_file_changes(workshop, fakes, checkout, monkeypatch):
    run = make_run(checkout, "first", checkpoints=(0,))
    monkeypatch.setenv("FAKE_UV_FAIL_PUBLISH", "1")
    assert evaluate_next(state(workshop)) is True
    body = workshop.get(f"{SPRINT_URL}/jobs/{run.name}/checkpoints/0").json()
    assert body["checkpoint"] == 0 and "publish: boom" in body["error"]
    assert rows(workshop) == [(0, "failed")]
    assert picked(workshop) is None
    older = time.time() - 120
    os.utime(run / "model_0.pt", (older, older))
    assert picked(workshop) == (run.name, 0)


def test_a_result_from_another_runner_version_is_measured_again(workshop, checkout):
    run = make_run(checkout, "first", checkpoints=(0,))
    store_evaluation(run, 0)
    assert picked(workshop) is None
    cache = run / "workshop" / "model_0.json"
    cache.write_text(json.dumps(json.loads(cache.read_text()) | {"runner_version": -1}))
    assert picked(workshop) == (run.name, 0)


def test_a_corrupt_store_is_measured_again_and_breaks_nothing(workshop, checkout):
    run = make_run(checkout, "first", checkpoints=(0,))
    (run / "workshop").mkdir()
    (run / "workshop" / "model_0.json").write_text("{not json")
    assert rows(workshop) == [(0, "queued")]
    assert picked(workshop) == (run.name, 0)


def test_a_checkpoint_not_evaluated_yet_is_404(workshop, checkout):
    run = make_run(checkout, "first", checkpoints=(0,))
    response = workshop.get(f"{SPRINT_URL}/jobs/{run.name}/checkpoints/0")
    assert response.status_code == 404 and "not evaluated yet" in response.json()["detail"]
    assert workshop.get(f"{SPRINT_URL}/jobs/{run.name}/checkpoints/7").status_code == 404


def test_two_evaluations_of_one_checkpoint_export_it_once(workshop, fakes, checkout):
    run = make_run(checkout, "first", checkpoints=(1,))
    results = []

    def go():
        results.append(evaluate_checkpoint(checkout, run_of(workshop, run), 1, "sprint-2m"))

    threads = [threading.Thread(target=go) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(results) == 2 and results[0]["score"] == results[1]["score"]
    assert len(fakes.calls("publish")) == 1


def run_of(client, path):
    from arena.workshop.runs import find_runs

    return next(r for r in find_runs(state(client).root, "Mjlab-Sprint2m-MicroDuck") if r.path == path)


def test_a_stale_staging_dir_is_not_reused(workshop, fakes, checkout, monkeypatch):
    run = make_run(checkout, "first", checkpoints=(1,))
    stale = checkout / "publish-workshop-evaluation"
    stale.mkdir()
    (stale / "policy.onnx").write_bytes(b"not a real model")
    monkeypatch.setenv("FAKE_UV_FAIL_PUBLISH", "1")
    evaluate_next(state(workshop))
    assert not stale.exists()
    monkeypatch.delenv("FAKE_UV_FAIL_PUBLISH")
    older = time.time() - 120
    os.utime(run / "model_1.pt", (older, older))
    evaluate_next(state(workshop))
    body = workshop.get(f"{SPRINT_URL}/jobs/{run.name}/checkpoints/1").json()
    assert (body["seeds_total"], body["seeds_finished"]) == (5, 5)


def test_a_dirty_run_is_evaluated_too(workshop, fakes, checkout):
    make_run(checkout, "first", checkpoints=(1,), dirty=True)
    evaluate_next(state(workshop))
    assert rows(workshop) == [(1, "evaluated")]


def test_the_evaluator_and_its_threads_stop_with_the_app(checkout, fakes, hub):
    from fastapi.testclient import TestClient

    from arena.workshop.app import create_workshop_app
    from arena.workshop.challenges import open_challenges
    from tests.workshop.conftest import ADDRESS, PORT

    app = create_workshop_app(checkout, open_challenges(checkout), "http://arena.test", hub, PORT)
    with TestClient(app, base_url=ADDRESS):
        assert "workshop-evaluator" in {t.name for t in threading.enumerate()}
    assert app.state.workshop.stopping.is_set()
```

- [ ] **Step 2: Run them to see them fail**

Run: `uv run --no-config --frozen --extra dev pytest -q tests/workshop/test_evaluations.py`
Expected: FAIL (`cannot import name 'evaluate_next'`).

- [ ] **Step 3: Implement `evaluations.py`**

Replace `arena/workshop/evaluations.py` with:

```python
"""Every checkpoint, evaluated: exported as `publish` would, then raced with the Arena's own evaluator.

`publish --run … --dry-run` is the exporter: it bakes the observation normaliser in and checks the
61 → 14 shape exactly as the real publish will. `--allow-dirty` because an evaluation publishes
nothing. `arena.evaluate` is the code the Space runs, on this machine's MuJoCo: the score is
indicative — only the Space times an entry, and replays drift apart between machines after a few
seconds.

A worker evaluates every checkpoint of the open challenges' runs, one at a time: the newest run
first, its checkpoints in order, so a training's tickets fill in as it goes. A result is stored next
to its checkpoint, per Arena runner version, trace included, so a page replays it at once. A failed
export is stored too, with the checkpoint file's modification time, and tried again only once that
file changes. A checkpoint file younger than FRESH_S waits: a local training may still be writing it.
"""

import base64
import json
import os
import shutil
import threading
import time

from ..constants import RUNNER_VERSION
from ..evaluate import evaluate
from ..manifest import load_event
from ..policy import PolicyError, load_policy
from .runs import find_runs
from .shell import uv_run

NAME = "workshop-evaluation"
FRESH_S = 30.0
IDLE_S = 5.0
# One evaluation at a time, start to finish: the dry run always writes the same
# ./publish-workshop-evaluation/, and holding this around the race too means a second request for
# a checkpoint being measured waits for it and returns what it stored.
_ONE = threading.Lock()


class EvaluationError(RuntimeError):
    """The export or the race failed; the message is the whole output."""


def _path(run, n: int):
    return run.path / "workshop" / f"model_{n}.json"


def _mtime(run, n: int) -> float:
    return (run.path / f"model_{n}.pt").stat().st_mtime


def stored(run, n: int) -> dict | None:
    """The stored evaluation of checkpoint n on this runner version — a result, or a failure still
    true of the checkpoint file as it is — or None: never evaluated, stale, or unreadable."""
    try:
        body = json.loads(_path(run, n).read_text())
    except (OSError, ValueError):
        return None  # missing, or corrupt (a crash mid-write): as good as never evaluated
    if not isinstance(body, dict) or body.get("runner_version") != RUNNER_VERSION:
        return None
    if "error" in body:
        try:
            return body if body.get("mtime") == _mtime(run, n) else None
        except OSError:
            return None
    return body


def summary(run) -> dict[int, dict]:
    """What each evaluated checkpoint of `run` shows on its ticket, without its trace."""
    keep = ("score", "seeds_finished", "seeds_total", "command_vx")
    found = {}
    for n in run.checkpoints:
        body = stored(run, n)
        if body is not None:
            found[n] = {"status": "failed"} if "error" in body else {"status": "evaluated", **{k: body[k] for k in keep}}
    return found


def _write(run, n: int, body: dict) -> None:
    """Atomically: a reader (a ticket, another evaluation) must never see a half-written file."""
    path = _path(run, n)
    path.parent.mkdir(exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(body))
    os.replace(tmp, path)


def _measure(root, run, n: int, event_id: str) -> dict:
    onnx = _path(run, n).with_suffix(".onnx")
    out = root / f"publish-{NAME}"
    # A previous, failed export may have left this: never move whatever happens to be sitting in it
    # into a checkpoint's slot as if this run had just produced it.
    shutil.rmtree(out, ignore_errors=True)
    done = uv_run(
        root, "publish", "--run", str(run.path), "--checkpoint", str(n),
        "--repo", f"local/microduck-{NAME}", "--name", NAME, "--dry-run", "--allow-dirty",
    )
    if done.returncode != 0:
        shutil.rmtree(out, ignore_errors=True)
        raise EvaluationError(done.stdout + done.stderr)
    onnx.parent.mkdir(exist_ok=True)
    shutil.move(out / "policy.onnx", onnx)
    shutil.rmtree(out, ignore_errors=True)
    result = evaluate(load_event(event_id), load_policy(onnx))
    return {
        "checkpoint": n,
        "score": result.score,
        "command_vx": result.command_vx,
        "seeds_finished": result.seeds_finished,
        "seeds_total": len(result.per_seed),
        "per_seed": [{"seed": s.seed, "status": s.status, "time_s": s.time_s} for s in result.per_seed],
        "trace_seed": result.trace_seed,
        "trace_b64": base64.b64encode(result.trace.astype("<f4").tobytes()).decode("ascii"),
        "runner_version": result.runner_version,
    }


def evaluate_checkpoint(root, run, n: int, event_id: str) -> dict:
    if n not in run.checkpoints:
        raise EvaluationError(f"{run.id} has no model_{n}.pt")
    with _ONE:
        # Re-checked under the lock: a request that waited behind another evaluation of the SAME
        # checkpoint returns what that one just stored, rather than exporting again.
        if (found := stored(run, n)) is not None:
            if "error" in found:
                raise EvaluationError(found["error"])
            return found
        mtime = _mtime(run, n)
        try:
            body = _measure(root, run, n, event_id)
        except (EvaluationError, PolicyError) as exc:
            _write(run, n, {"checkpoint": n, "error": str(exc), "mtime": mtime, "runner_version": RUNNER_VERSION})
            raise EvaluationError(str(exc)) from exc
        _write(run, n, body)
        return body


def next_checkpoint(root, challenges, now: float | None = None):
    """(challenge, run, n) to evaluate next, or None: the newest run first, its checkpoints in order."""
    now = time.time() if now is None else now
    runs = sorted(((c, r) for c in challenges for r in find_runs(root, c.task)), key=lambda cr: cr[1].id, reverse=True)
    for challenge, run in runs:
        for n in run.checkpoints:
            if stored(run, n) is not None:
                continue
            try:
                if now - _mtime(run, n) < FRESH_S:
                    continue
            except OSError:
                continue  # gone while we looked
            return challenge, run, n
    return None


def evaluate_next(ws) -> bool:
    """Evaluate one checkpoint; False when none is waiting."""
    found = next_checkpoint(ws.root, list(ws.challenges.values()))
    if found is None:
        return False
    challenge, run, n = found
    try:
        evaluate_checkpoint(ws.root, run, n, challenge.event)
    except EvaluationError:
        pass  # stored as a failure: its ticket says so
    return True


def evaluate_forever(ws) -> None:
    while not ws.stopping.is_set():
        try:
            if not evaluate_next(ws):
                ws.stopping.wait(IDLE_S)
        except Exception as exc:  # noqa: BLE001 — one bad run must not stop the worker for the others
            print(f"[workshop] evaluation: {type(exc).__name__}: {exc}", flush=True)
            ws.stopping.wait(IDLE_S)
```

- [ ] **Step 4: Use it in the tickets and the app**

In `arena/workshop/tickets.py`: `from .evaluations import summary` replaces `from .trials import tested`, and `_checkpoints` becomes:

```python
def _checkpoints(run, voted: bool) -> tuple[list[dict], int | None]:
    done = summary(run) if run else {}
    rows = [{"n": n, **done.get(n, {"status": "queued"})} for n in (run.checkpoints if run else ())]
    finishers = [r for r in rows if r["status"] == "evaluated" and r["seeds_finished"] > 0]
    # A voted event is not a clock: its best is the public's to say.
    best = None if voted or not finishers else min(finishers, key=lambda r: (r["score"], r["n"]))["n"]
    return rows, best
```

In `arena/workshop/app.py`:
- `from contextlib import asynccontextmanager`; `from .evaluations import EvaluationError, evaluate_forever, stored` replaces the `trials` import; drop the now unused `PolicyError`, `run_in_threadpool` only if nothing else uses them (publish still does).
- `Workshop` gains `stopping: threading.Event = field(default_factory=threading.Event)` ("set when the app stops: the background workers end").
- Delete the `TrialRequest` model and the `/challenges/{event}/runs/{run_id}/trial` route; add:

```python
@router.get("/challenges/{event}/jobs/{ticket_id}/checkpoints/{n}")
def checkpoint(event: str, ticket_id: str, n: int, request: Request) -> dict:
    """A checkpoint's stored evaluation, its trace inline: the page replays it at once."""
    ws = _workshop(request)
    found = source(ws, _challenge_or_404(ws, event), ticket_id)
    run = found[3] if found else None
    body = stored(run, n) if run is not None and n in run.checkpoints else None
    if body is None:
        raise HTTPException(status_code=404, detail=f"Checkpoint {n} is not evaluated yet.")
    return {"checkpoint": n, "error": body["error"]} if "error" in body else body
```

- the lifespan, above `create_workshop_app`:

```python
@asynccontextmanager
async def _background(app: FastAPI):
    """The workers that keep the tickets up to date, for as long as the app serves."""
    ws = app.state.workshop
    threading.Thread(target=evaluate_forever, args=(ws,), name="workshop-evaluator", daemon=True).start()
    yield
    ws.stopping.set()
```

and `FastAPI(title="Microduck workshop", docs_url=None, redoc_url=None, lifespan=_background)`. (A plain `TestClient(app)` does not run the lifespan: the tests call `evaluate_next` themselves.)

`EvaluationError` is only needed in `app.py` if a route catches it; if not, do not import it.

- [ ] **Step 5: Run the workshop tests**

Run: `uv run --no-config --frozen --extra dev pytest -q tests/workshop`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add -A arena/workshop tests/workshop
/usr/bin/git commit -m "Workshop: evaluate every checkpoint in the background, store it with its trace, replay it at once"
```

---

### Task 6: Hugging Face jobs kept up to date after a restart

**Files:**
- Create: `arena/workshop/watch.py`
- Modify: `arena/workshop/tickets.py` (`job_url`), `arena/workshop/app.py` (lifespan), `tests/workshop/conftest.py` (`FakeHub.asked`)
- Test: `tests/workshop/test_watch.py` (new)

**Interfaces:**
- Consumes: `jobs.recorded_jobs/remember_job/TERMINAL`, `training.fetch`, `training.PULL_EVERY_S`, `Hub.job_stage`.
- Produces: `watch.watch_once(ws, now=None)`, `watch.watch_forever(ws)`, `ASK_EVERY_S = 60.0`; records gain `stage`, `asked`, `pulled`; a ticket gains `"job_url": "https://huggingface.co/jobs/<namespace>/<job id>" | None`.

- [ ] **Step 1: Write the failing tests**

In `tests/workshop/conftest.py`, `FakeHub.__init__` gains `self.asked = []` and `job_stage` appends `job_id` to it before answering.

Create `tests/workshop/test_watch.py`:

```python
"""A Hugging Face job still runs and bills after the workshop that launched it is gone: its record is
kept up to date from the Hub, and its checkpoints still come back."""

import json

from arena.workshop.watch import watch_once
from tests.workshop.conftest import reopen, wait_for

SPRINT_URL = "/api/workshop/challenges/sprint-2m"
TASK = "Mjlab-Sprint2m-MicroDuck"
HF = {"name": "first", "where": "hf-jobs", "recipe": {"num_envs": 512, "max_iterations": 50, "seed": 3}, "params": {}}
DOWNLOAD = ["run", "--no-sync", "hf", "download", "alice/mjlab-sprint2m-microduck-first", "--local-dir", "logs/rsl_rl", "--quiet"]


def launched(workshop, monkeypatch):
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    workshop.post(f"{SPRINT_URL}/train", json=HF)
    wait_for(lambda: workshop.app.state.workshop.trainings[(TASK, "first")].job_id)


def ticket(client):
    (found,) = client.get(f"{SPRINT_URL}/jobs").json()["jobs"]
    return found


def test_after_a_restart_a_running_job_is_asked_and_pulled(workshop, fakes, checkout, hub, monkeypatch):
    launched(workshop, monkeypatch)
    reopened = reopen(checkout, hub)
    ws = reopened.app.state.workshop
    pulls = len(fakes.calls("hf"))
    watch_once(ws, now=1000.0)
    assert hub.asked == ["fakejob42"] and fakes.calls("hf")[pulls:] == [DOWNLOAD]
    assert ticket(reopened)["state"] == "running" and ticket(reopened)["run_id"]

    watch_once(ws, now=1030.0)  # under a minute: not asked again
    assert hub.asked == ["fakejob42"]

    hub.stages["fakejob42"] = "COMPLETED"
    watch_once(ws, now=1100.0)  # ended: asked, and pulled once more
    assert hub.asked == ["fakejob42", "fakejob42"] and fakes.calls("hf")[pulls:] == [DOWNLOAD, DOWNLOAD]
    assert ticket(reopened)["state"] == "done"

    watch_once(ws, now=5000.0)  # nothing more to ask of an ended job
    assert hub.asked == ["fakejob42", "fakejob42"]


def test_a_job_this_workshop_follows_is_left_to_its_training(workshop, fakes, hub, monkeypatch):
    launched(workshop, monkeypatch)
    watch_once(workshop.app.state.workshop, now=1000.0)
    assert hub.asked == []


def test_the_record_keeps_what_the_hub_said(workshop, fakes, checkout, hub, monkeypatch):
    launched(workshop, monkeypatch)
    hub.stages["fakejob42"] = "ERROR"
    watch_once(reopen(checkout, hub).app.state.workshop, now=1000.0)
    (record,) = json.loads((checkout / "logs" / "workshop-jobs.json").read_text())
    assert (record["stage"], record["asked"], record["pulled"]) == ("ERROR", 1000.0, 1000.0)
    assert ticket(reopen(checkout, hub))["state"] == "failed"


def test_an_unreachable_hub_leaves_the_tickets_as_they_were(workshop, fakes, checkout, hub, monkeypatch):
    """Review focus: the tickets never ask the network, and a watcher that cannot reach the Hub
    changes nothing but when it asks next."""
    launched(workshop, monkeypatch)
    reopened = reopen(checkout, hub)
    hub.reachable = False
    watch_once(reopened.app.state.workshop, now=1000.0)
    assert ticket(reopened)["state"] == "running"
    hub.job_stage = lambda job_id, namespace: (_ for _ in ()).throw(AssertionError("a ticket asked the Hub"))
    assert reopened.get(f"{SPRINT_URL}/jobs").status_code == 200


def test_the_ticket_links_the_jobs_page(workshop, fakes, monkeypatch):
    launched(workshop, monkeypatch)
    assert ticket(workshop)["job_url"] == "https://huggingface.co/jobs/alice/fakejob42"


def test_a_local_training_has_no_job_page_and_is_not_watched(workshop, fakes, hub):
    fakes.gpu()
    workshop.post(f"{SPRINT_URL}/train", json=HF | {"where": "local"})
    wait_for(lambda: ticket(workshop)["state"] == "done")
    watch_once(workshop.app.state.workshop, now=1000.0)
    assert hub.asked == [] and ticket(workshop)["job_url"] is None
```

- [ ] **Step 2: Run them to see them fail**

Run: `uv run --no-config --frozen --extra dev pytest -q tests/workshop/test_watch.py`
Expected: FAIL (`No module named 'arena.workshop.watch'`).

- [ ] **Step 3: Implement**

Create `arena/workshop/watch.py`:

```python
"""The Hugging Face jobs this workshop does not follow, kept up to date.

After a restart, the training that launched a job is gone from memory, but the job still runs and
bills on Hugging Face. So every recorded job the Hub may still be running is asked of it at most
once a minute; its checkpoint repo is pulled every two minutes while it runs, and once more when it
ends. What the Hub says goes into the job's record, where the tickets read it: they never ask the
network themselves, and a Hub that does not answer changes nothing but when it is asked next.
"""

import time

from .jobs import TERMINAL, recorded_jobs, remember_job
from .training import PULL_EVERY_S, fetch

ASK_EVERY_S = 60.0
LOOK_EVERY_S = 15.0


def watch_once(ws, now: float | None = None) -> None:
    now = time.time() if now is None else now
    for job in recorded_jobs(ws.root):
        if (job.get("where") != "hf-jobs" or not job.get("job_id") or job.get("stage") in TERMINAL
                or (job["task"], job["name"]) in ws.trainings or now - job.get("asked", 0) < ASK_EVERY_S):
            continue
        try:
            stage = ws.hub.job_stage(job["job_id"], job["namespace"])
        except Exception:  # noqa: BLE001 — unreachable, or a job the Hub no longer knows: ask later
            remember_job(ws.root, job["task"], job["name"], asked=now)
            continue
        pulled = job.get("pulled", 0)
        if stage in TERMINAL or now - pulled >= PULL_EVERY_S:
            fetch(ws.root, job["ckpt_repo"])
            pulled = now
        remember_job(ws.root, job["task"], job["name"], stage=stage, asked=now, pulled=pulled)


def watch_forever(ws) -> None:
    while not ws.stopping.is_set():
        try:
            watch_once(ws)
        except Exception as exc:  # noqa: BLE001 — a bad record must not stop the watch of the others
            print(f"[workshop] jobs: {type(exc).__name__}: {exc}", flush=True)
        ws.stopping.wait(LOOK_EVERY_S)
```

In `arena/workshop/tickets.py`, `_ticket` adds to its dict:

```python
        "job_url": _job_url(live, record),
```

with

```python
def _job_url(live, record) -> str | None:
    """An HF job's page on the Hub, where its whole log is, once its id is known."""
    job_id = (live.job_id if live is not None else None) or (record or {}).get("job_id")
    if not record or record.get("where") != "hf-jobs" or not job_id:
        return None
    return f"https://huggingface.co/jobs/{record['namespace']}/{job_id}"
```

In `arena/workshop/app.py`, `from .watch import watch_forever` and the lifespan starts it too:

```python
    for work, name in ((evaluate_forever, "workshop-evaluator"), (watch_forever, "workshop-watcher")):
        threading.Thread(target=work, args=(ws,), name=name, daemon=True).start()
```

- [ ] **Step 4: Run the workshop tests**

Run: `uv run --no-config --frozen --extra dev pytest -q tests/workshop`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add -A arena/workshop tests/workshop
/usr/bin/git commit -m "Workshop: keep recorded Hugging Face jobs up to date from the Hub and bring their checkpoints back after a restart"
```

---

### Task 7: Publish and compete from the job, and remember it

**Files:**
- Modify: `arena/workshop/publishing.py`, `arena/workshop/tickets.py`, `arena/workshop/app.py`
- Test: `tests/workshop/test_publishing.py` (rewritten)

**Interfaces:**
- Consumes: `tickets.source`, `code.code_url`.
- Produces: `publishing.publish(root, run, checkpoint, repo, name, description, event_id, allow_dirty, *, arena, code_url) -> {"repo","revision","entered","page_url","output"}` (no `livery`, no `speed`) which also appends to `publishing.published(run) -> list[dict]` (`<run>/workshop/published.json`, entries `{"checkpoint","repo","revision","entered","page_url","at"}`); route `POST /api/workshop/challenges/{event}/jobs/{id}/publish {checkpoint, name, description, allow_dirty=false, dry_run=false}`; a ticket gains `"published": <latest entry>|None`; the detail gains `"code_url": str|None`. The route `POST /challenges/{event}/publish` goes.

- [ ] **Step 1: Write the failing tests**

Replace `tests/workshop/test_publishing.py` with:

```python
"""Publish and compete: `uv run publish --enter` does the work; the workshop previews it, runs it from
a job's checkpoint, remembers the entry, and opens its page on the Arena."""

import json

from arena.manifest import load_event
from arena.workshop.publishing import SPEED_TWIST, publish_args, slug
from tests.workshop.conftest import git, make_run

AAA = "a" * 40
SPRINT_URL = "/api/workshop/challenges/sprint-2m"


def _publish(workshop, run, ticket_id=None, **fields):
    body = {"checkpoint": 1, "name": "My Walker!", "description": "It leans into every step.", **fields}
    return workshop.post(f"{SPRINT_URL}/jobs/{ticket_id or run.name}/publish", json=body)


def _ticket(workshop):
    (found,) = workshop.get(f"{SPRINT_URL}/jobs").json()["jobs"]
    return found


def test_the_preview_is_a_dry_run_showing_the_hub_card(workshop, fakes, checkout):
    run = make_run(checkout, "first")
    body = _publish(workshop, run, dry_run=True).json()
    assert body["repo"] == "alice/microduck-my-walker"
    assert body["readme"] == "# my-walker\n" and body["manifest"]["kind"] == "perpetual"
    (call,) = fakes.calls("publish")
    assert "--dry-run" in call and "--no-private" not in call and "--enter" not in call
    assert not (checkout / "publish-my-walker").exists()
    assert _ticket(workshop)["published"] is None


def test_publishing_enters_it_opens_its_page_and_remembers_it(workshop, fakes, checkout):
    run = make_run(checkout, "first")
    body = _publish(workshop, run).json()
    (call,) = fakes.calls("publish")
    assert call[3:7] == ["--run", str(run), "--checkpoint", "1"]
    assert {"--no-private", "--force", "--enter"} <= set(call)
    assert call[call.index("--arena") + 1] == "http://arena.test"
    # Every workshop entry races in the default colour, and a race is always swept.
    assert "--livery" not in call and "--speed" not in call and "--code-url" not in call
    assert call[call.index("--repo") + 1] == "alice/microduck-my-walker"
    assert "--description=It leans into every step." in call and "--name=my-walker" in call
    assert call[call.index("--twist-help") + 1] == SPEED_TWIST
    assert body["revision"] == AAA and body["env"] is None
    assert body["entered"] == "entered on sprint-2m: 4.892 s (5/5 seeds) at 0.55 m/s"
    assert body["page_url"] == "http://arena.test/#/r/fakerun1"
    assert workshop.opened == [body["page_url"]]
    published = _ticket(workshop)["published"]
    assert {k: published[k] for k in ("checkpoint", "repo", "revision", "entered", "page_url")} == {
        "checkpoint": 1, "repo": "alice/microduck-my-walker", "revision": AAA,
        "entered": body["entered"], "page_url": body["page_url"]}
    assert json.loads((run / "workshop" / "published.json").read_text())[-1]["at"].startswith("20")


def test_a_name_and_a_word_for_the_commentators_are_both_needed(workshop, fakes, checkout):
    run = make_run(checkout, "first")
    for fields in ({"name": "  "}, {"description": ""}, {"description": "   "}):
        response = _publish(workshop, run, **fields)
        assert response.status_code == 400 and "commentators" in response.json()["detail"]
    assert fakes.calls("publish") == []


def test_the_entry_carries_the_code_once_it_is_on_the_fork(workshop, fakes, checkout, remotes):
    fork = remotes / "alice" / "microduck-challenges"
    fork.mkdir(parents=True)
    git(fork.parent, "init", "-q", "--bare", str(fork))
    workshop.post("/api/workshop/code/fork", json={"url": "https://github.com/alice/microduck-challenges"})
    run = make_run(checkout, "first")
    assert workshop.get(f"{SPRINT_URL}/jobs/{run.name}").json()["code_url"] is None
    workshop.post("/api/workshop/code/push")
    commit = git(checkout, "rev-parse", "--short=9", "HEAD")
    code = f"https://github.com/alice/microduck-challenges/tree/{commit}"
    assert workshop.get(f"{SPRINT_URL}/jobs/{run.name}").json()["code_url"] == code
    body = _publish(workshop, run).json()
    assert body["env"] == code
    (call,) = fakes.calls("publish")
    assert call[call.index("--code-url") + 1] == code


def test_an_entry_the_arena_refuses_shows_the_whole_output_and_is_not_remembered(workshop, fakes, checkout, monkeypatch):
    monkeypatch.setenv("FAKE_UV_ENTER_REFUSED", "1")
    response = _publish(workshop, make_run(checkout, "first"))
    assert response.status_code == 400
    assert "but the Arena did not enter it: 403: not yours" in response.json()["detail"]
    assert workshop.opened == [] and _ticket(workshop)["published"] is None


def test_a_dirty_run_is_refused_unless_published_anyway(workshop, fakes, checkout):
    run = make_run(checkout, "first", dirty=True)
    refused = _publish(workshop, run)
    assert refused.status_code == 400 and "uncommitted" in refused.json()["detail"]
    assert fakes.calls("publish") == []
    assert _publish(workshop, run, allow_dirty=True).status_code == 200
    assert "--allow-dirty" in fakes.calls("publish")[0]


def test_a_job_without_a_run_yet_has_nothing_to_publish(workshop, fakes, monkeypatch):
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    workshop.post(f"{SPRINT_URL}/train", json={"name": "first", "where": "hf-jobs",
                                              "recipe": {"num_envs": 1, "max_iterations": 2, "seed": 1}})
    response = workshop.post(f"{SPRINT_URL}/jobs/first/publish", json={"checkpoint": 1, "name": "x", "description": "y"})
    assert response.status_code == 409 and "no checkpoint" in response.json()["detail"]


def test_an_unknown_checkpoint_or_job_is_refused(workshop, fakes, checkout):
    run = make_run(checkout, "first")
    assert _publish(workshop, run, checkpoint=7).status_code == 400
    assert _publish(workshop, run, ticket_id="nope").status_code == 404


def test_publishing_needs_a_hugging_face_login(workshop, fakes, checkout, hub):
    hub.user = None
    assert _publish(workshop, make_run(checkout, "first")).status_code == 400


def test_publishing_says_when_the_hub_is_unreachable(workshop, fakes, checkout, hub):
    hub.reachable = False
    response = _publish(workshop, make_run(checkout, "first"))
    assert response.status_code == 503 and "unreachable" in response.json()["detail"]
    assert fakes.calls("publish") == []


def test_a_failed_publish_shows_its_whole_output(workshop, fakes, checkout, monkeypatch):
    monkeypatch.setenv("FAKE_UV_FAIL_PUBLISH", "1")
    response = _publish(workshop, make_run(checkout, "first"))
    assert response.status_code == 400 and "publish: boom" in response.json()["detail"]
    assert workshop.opened == []


def test_a_publish_while_another_runs_is_refused(workshop, fakes, checkout):
    """Two uploads of one name would race over ./publish-<name>/ and over the Hub repo."""
    run = make_run(checkout, "first")
    publishing = workshop.app.state.workshop.publishing
    publishing.acquire()
    try:
        for fields in ({}, {"dry_run": True}):
            response = _publish(workshop, run, **fields)
            assert response.status_code == 409 and response.json()["detail"] == "A publish is already running."
    finally:
        publishing.release()
    assert fakes.calls("publish") == []
    assert _publish(workshop, run).status_code == 200


def test_no_speed_order_for_an_event_that_does_not_sweep(checkout):
    from arena.workshop.runs import find_runs

    make_run(checkout, "first")
    (run,) = find_runs(checkout, "Mjlab-Sprint2m-MicroDuck")
    swag = publish_args(run, 1, "alice/microduck-x", "x", "d", load_event("swag-contest"), False)
    assert "--twist-help" not in swag
    sprint = publish_args(run, 1, "alice/microduck-x", "x", "d", load_event("sprint-2m"), False)
    assert "--twist-help" in sprint


def test_a_description_that_starts_with_a_dash_is_not_taken_for_an_option(workshop, fakes, checkout):
    """`--description -fast` reads as a flag of its own to publish's parser; `--description=-fast` cannot."""
    run = make_run(checkout, "first")
    assert _publish(workshop, run, description="- fast and low").status_code == 200
    (call,) = fakes.calls("publish")
    assert "--description=- fast and low" in call


def test_slugs_are_what_a_hub_repo_name_accepts():
    assert slug("My Walker!") == "my-walker"
    assert slug("  ") == "policy"
```

- [ ] **Step 2: Run them to see them fail**

Run: `uv run --no-config --frozen --extra dev pytest -q tests/workshop/test_publishing.py`
Expected: FAIL (404 on the new route).

- [ ] **Step 3: Implement**

In `arena/workshop/publishing.py`: update the docstring ("… and the real one prints the commit it made and the entry's time and page, which the workshop opens and remembers next to the run."); add `from datetime import UTC, datetime` and `import os`; replace `publish` with:

```python
PUBLISHED = "published.json"


def published(run) -> list[dict]:
    """Every entry published from this run, oldest first."""
    try:
        entries = json.loads((run.path / "workshop" / PUBLISHED).read_text())
    except (OSError, ValueError):
        return []
    return [e for e in entries if isinstance(e, dict)] if isinstance(entries, list) else []


def _remember(run, entry: dict) -> None:
    path = run.path / "workshop" / PUBLISHED
    path.parent.mkdir(exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps([*published(run), entry], indent=1))
    os.replace(tmp, path)


def publish(root, run, checkpoint, repo, name, description, event_id, allow_dirty, *,
            arena: str, code_url: str | None) -> dict:
    args = publish_args(run, checkpoint, repo, name, description, load_event(event_id), allow_dirty)
    # Public, or the Arena cannot read it; --force because publishing a name again is a new commit on
    # the same repo, and the Arena pins the commit it raced. No --livery (every workshop entry wears
    # the default) and no --speed (a race is always swept).
    args += ["--no-private", "--force", "--enter", "--arena", arena]
    if code_url:
        args += ["--code-url", code_url]
    output = _run(root, args)
    commit, entered = _COMMIT.search(output), _ENTERED.search(output)
    if not commit or not entered:
        raise PublishError(output + "\n[workshop] publish printed no entry for the workshop to open")
    entry = {"checkpoint": checkpoint, "repo": repo, "revision": commit.group(1), "entered": entered.group(1),
             "page_url": entered.group(2), "at": datetime.now(UTC).isoformat(timespec="seconds")}
    _remember(run, entry)
    return {**{k: entry[k] for k in ("repo", "revision", "entered", "page_url")}, "output": output}
```

In `arena/workshop/tickets.py`: `from .code import code_url` and `from .publishing import published`; `_ticket` adds `"published": (published(run) or [None])[-1] if run else None`; `ticket_detail` adds `"code_url": code_url(ws.root, run.provenance.get("commit")) if run else None`.

In `arena/workshop/app.py`: replace `PublishRequest` and the `/challenges/{event}/publish` route with:

```python
class PublishRequest(BaseModel):
    checkpoint: int
    name: str
    description: str
    allow_dirty: bool = False
    dry_run: bool = False


@router.post("/challenges/{event}/jobs/{ticket_id}/publish")
async def publish_route(event: str, ticket_id: str, body: PublishRequest, request: Request) -> dict:
    ws = _workshop(request)
    challenge = _challenge_or_404(ws, event)
    found = source(ws, challenge, ticket_id)
    if found is None:
        raise HTTPException(status_code=404, detail=f"No training {ticket_id} for {event}.")
    run = found[3]
    if run is None:
        raise HTTPException(status_code=409, detail=f"{ticket_id} has no checkpoint yet.")
    if body.checkpoint not in run.checkpoints:
        raise HTTPException(status_code=400, detail=f"{run.id} has no model_{body.checkpoint}.pt")
    if not body.name.strip() or not body.description.strip():
        raise HTTPException(status_code=400, detail="A name and a word for the commentators are both needed.")
    if run.provenance.get("dirty") and not body.allow_dirty:
        raise HTTPException(
            status_code=400,
            detail="This run started from uncommitted changes, so the code it records is not what "
                   "trained it. Train again from the workshop (it commits first), or publish anyway.",
        )
    user = await run_in_threadpool(_hub_user, ws)
    if not user:
        raise HTTPException(status_code=400, detail="Log in to Hugging Face first.")
    repo = repo_for(user, body.name)
    args = (ws.root, run, body.checkpoint, repo, body.name, body.description.strip(), challenge.event, body.allow_dirty)
    env = code_url(ws.root, run.provenance.get("commit"))
    if not ws.publishing.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="A publish is already running.")
    try:
        if body.dry_run:
            return {"repo": repo, **await run_in_threadpool(preview, *args)}
        entered = await run_in_threadpool(publish, *args, arena=ws.arena, code_url=env)
    except PublishError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        ws.publishing.release()
    ws.open_browser(entered["page_url"])  # the entry's page on the Arena, where its reveal plays
    return {**entered, "env": env}
```

`_run_or_404` is now unused: delete it.

- [ ] **Step 4: Run the workshop tests**

Run: `uv run --no-config --frozen --extra dev pytest -q tests/workshop`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add -A arena/workshop tests/workshop
/usr/bin/git commit -m "Workshop: publish and compete from a job's checkpoint, with a word for the commentators, and remember the entry"
```

---

### Task 8: Peter & Ray read what the author wrote

**Files:**
- Modify: `arena/store.py` (`RunRecord.description`), `arena/web/routes_submit.py` (`_description`), `arena/commentary/context.py` (the note fact)
- Test: `tests/test_store.py`, `tests/test_routes_submit.py`, `tests/test_commentary_context.py`

**Interfaces:**
- Produces: `RunRecord.description: str | None = None` (in `to_dict`/`from_dict`, absent key reads None); `routes_submit._description(fetched) -> str | None`; a fact `Fact("run#/note", '@<user> says about the policy: "<text>"', "notable")` in `result_facts` when the run's description passes `label(text, limit=280)`.

- [ ] **Step 1: Write the failing tests**

In `tests/test_store.py` add (next to the other round-trip tests; `make_record` accepts any field as a keyword):

```python
def test_a_description_survives_the_round_trip_and_an_older_record_has_none():
    record = make_record(description="It leans into every step.")
    assert RunRecord.from_dict(record.to_dict()).description == "It leans into every step."
    older = record.to_dict()
    del older["description"]
    assert RunRecord.from_dict(older).description is None
```

(import `RunRecord` from `arena.store` if the file does not already.)

In `tests/test_routes_submit.py` add:

```python
def _entered_with(api, monkeypatch, manifest):
    monkeypatch.setattr("arena.web.routes_submit._fetch_from_hub",
                        lambda repo_id, revision, event: _fetched(repo_id="alice/walker", manifest=manifest))
    run_id = api.post("/api/events/sprint-2m/submit", data={"repo_id": "alice/walker"}).json()["run_id"]
    return next(r for r in api.app.state.store.runs("sprint-2m") if r.run_id == run_id)


def test_the_manifests_description_is_kept_for_the_commentators(api, monkeypatch):
    record = _entered_with(api, monkeypatch, {"name": "strider", "description": "  It leans into every step. ",
                                              "training": {"task_id": "Mjlab-Sprint2m-MicroDuck"}})
    assert record.description == "It leans into every step."


@pytest.mark.parametrize("description", [None, 42, "", "   ", "strider", "Mjlab-Sprint2m-MicroDuck", "x" * 501])
def test_a_description_that_is_missing_a_default_or_too_long_is_not_kept(api, monkeypatch, description):
    manifest = {"name": "strider", "training": {"task_id": "Mjlab-Sprint2m-MicroDuck"}}
    if description is not None:
        manifest["description"] = description
    assert _entered_with(api, monkeypatch, manifest).description is None
```

(If `api.app.state.store.runs(...)` is not how the store lists an event's records, use the accessor the other tests in this file use to read back a record, e.g. `store.runs(event_id)` as `arena/commentary/__init__.py` does.)

In `tests/test_commentary_context.py` add:

```python
import pytest


def test_the_authors_words_are_a_fact_when_they_read_as_prose():
    manifest = load_event("sprint-2m")
    mine = run("alice", 12.40, "2026-09-11T10:00:00Z", run_id="R1", description="It leans into every step.")
    (note,) = [f for f in result_facts(mine, manifest, [mine], []) if f.ref == "run#/note"]
    assert note.text == '@alice says about the policy: "It leans into every step."'
    assert note.kind == "notable"


@pytest.mark.parametrize("description", [None, "see https://example.com", "tuned track_linear_velocity", "x" * 281, "<b>fast</b>"])
def test_no_note_when_the_words_are_missing_or_machine_shaped(description):
    manifest = load_event("sprint-2m")
    mine = run("alice", 12.40, "2026-09-11T10:00:00Z", run_id="R1", description=description)
    assert not [f for f in result_facts(mine, manifest, [mine], []) if f.ref == "run#/note"]
```

- [ ] **Step 2: Run them to see them fail**

Run: `uv run --no-config --frozen --extra dev pytest -q tests/test_store.py tests/test_routes_submit.py tests/test_commentary_context.py`
Expected: FAIL (`unexpected keyword argument 'description'`).

- [ ] **Step 3: Implement**

`arena/store.py`, in `RunRecord` after `livery`:

```python
    # What the author wrote about the policy for the commentators, from the manifest at the pinned
    # revision; None when it wrote nothing of its own. Submitter text: only the commentary quotes it,
    # as the author's words, after its own checks.
    description: str | None = None
```

`to_dict` adds `"description": self.description`; `from_dict` adds `description=raw.get("description")` (with the same "runs recorded before … have no such key" comment as livery's).

`arena/web/routes_submit.py`, next to `_hub_name`:

```python
DESCRIPTION_MAX = 500


def _description(fetched: FetchedPolicy) -> str | None:
    """What the author wrote for the commentators, from the manifest: None when it is missing, too
    long, or only one of the defaults `publish` falls back to (the training task's id, the name)."""
    manifest = fetched.manifest or {}
    text = manifest.get("description")
    if not isinstance(text, str):
        return None
    text = text.strip()
    defaults = {str(manifest.get("name") or ""), str((manifest.get("training") or {}).get("task_id") or "")}
    return text if 1 <= len(text) <= DESCRIPTION_MAX and text not in defaults else None
```

and in `_enter`'s `RunRecord(...)`: `description=_description(fetched),`.

`arena/commentary/context.py`, above `result_facts`:

```python
NOTE_MAX = 280


def _note(record: RunRecord) -> Fact | None:
    """The author's own words about the policy, quoted as theirs: never a result, and only when they
    read as prose (the same checks as any submitter text), so no turn that cites it is refused."""
    text = record.description
    if not text or not label(text, limit=NOTE_MAX):
        return None
    return Fact("run#/note", f'@{record.user} says about the policy: "{text}"', "notable",
                identities=(record.user,))
```

and in `result_facts`, after the participant fact is appended (before `_result`), `note = _note(record)` then `if note: facts.append(note)` after the list is built (keep the three first facts in their order).

- [ ] **Step 4: Run the Arena's affected tests, then the full suite**

Run: `uv run --no-config --frozen --extra dev pytest -q tests/test_store.py tests/test_routes_submit.py tests/test_commentary_context.py tests/test_commentary.py tests/test_commentary_generator.py`
Expected: PASS.

Run (foreground, `timeout: 600000`): `uv run --no-config --frozen --extra dev pytest -q -m "not network"`
Expected: PASS (the whole Arena suite, 7–14 min).

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add arena/store.py arena/web/routes_submit.py arena/commentary/context.py tests/test_store.py tests/test_routes_submit.py tests/test_commentary_context.py
/usr/bin/git commit -m "Arena: keep the manifest's description at entry and let the commentators quote the author's words"
```

---

### Task 9: The Arena's wordmark and flyer, open to the workshop

**Files:**
- Modify: `app/src/wordmark.js`, `app/src/flyer.js`
- Test: `app/src/wordmark.test.js`, `app/src/flyer.test.js` (new)

**Interfaces:**
- Produces: `wordmark({ variant = "strip", word = "Arena" })`; `flyer(event, rows, { href = raceHref(event.id), corner } = {})` — `rows === null` draws no leader line; `corner` (a node, or `null` for none) replaces the default VOTE HERE sticker when given. The Arena's calls are unchanged.

- [ ] **Step 1: Write the failing tests**

Add to `app/src/wordmark.test.js` (inside its `describe`, or at top level):

```js
it("can read Microduck Workshop", () => {
  const mark = wordmark({ word: "Workshop" });
  expect(mark.querySelector(".wordmark__arena").textContent).toBe("Workshop");
  expect(mark.querySelector(".wordmark__solid").textContent).toBe("Microduck");
});
```

Create `app/src/flyer.test.js`:

```js
import { describe, expect, it } from "vitest";
import { flyer } from "./flyer.js";

const SPRINT = {
  id: "sprint-2m", title: "2 m Sprint", status: "open", category: "race", vote: null,
  length_m: 2, slope_deg: 0, rig: "legs", sweep_lo: 0.2, sweep_hi: 1.2, sweep_count: 21,
};
const SWAG = { ...SPRINT, id: "swag-contest", title: "Swag Contest", category: "showcase", vote: { ballot_min: 2 } };

describe("flyer", () => {
  it("leads to the race page and says who holds it, by default", () => {
    const note = flyer(SPRINT, []);
    expect(note.querySelector(".challenge-link").getAttribute("href")).toBe("#/e/sprint-2m");
    expect(note.querySelector(".flyer-leader").textContent).toContain("be the first");
  });

  it("pins VOTE HERE on a voted event, by default", () => {
    expect(flyer(SWAG, []).querySelector(".vote-button")).not.toBeNull();
  });

  it("can lead elsewhere, with no leader line and its own corner", () => {
    const corner = document.createElement("span");
    corner.className = "mine";
    const note = flyer(SWAG, null, { href: "#/c/swag-contest", corner });
    expect(note.querySelector(".challenge-link").getAttribute("href")).toBe("#/c/swag-contest");
    expect(note.querySelector(".flyer-leader")).toBeNull();
    expect(note.querySelector(".vote-button")).toBeNull();
    expect(note.querySelector(".mine")).not.toBeNull();
  });

  it("can have no corner at all", () => {
    expect(flyer(SWAG, null, { corner: null }).querySelector(".vote-button")).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd app && npx vitest run src/wordmark.test.js src/flyer.test.js`
Expected: FAIL (the word stays "Arena"; the leader line and VOTE HERE are always drawn).

- [ ] **Step 3: Implement**

`app/src/wordmark.js`: the signature becomes `wordmark({ variant = "strip", word = "Arena" } = {})`, `arena.textContent = word;`, and the doc comment gains "`word` is the second line: Arena on the site, Workshop on the workshop's pages."

`app/src/flyer.js`: replace `flyer` with:

```js
/**
 * One event on the wall: its still, who holds it, and what it is.
 *
 * The workshop pins the same sheet on its own wall: there `rows` is null (the sheet is about
 * training, not results: no leader line), `href` leads to the challenge's workshop page, and
 * `corner` is what sits in the top corner instead of VOTE HERE (null: nothing).
 */
export function flyer(event, rows, { href = raceHref(event.id), corner } = {}) {
  const planned = event.status === "planned";
  const known = CATEGORIES.has(event.category);
  const classes = ["challenge-note", "fx-shadow-card"];
  // An unrecognised category keeps the neutral ink shadow the base rule sets,
  // rather than borrowing another category's colour.
  if (known) classes.push(`challenge-note--${event.category}`);
  if (planned) classes.push("challenge-note--planned");
  const note = el("article", classes.join(" "));
  note.append(el("span", "flyer-tape"));
  const sticker = corner !== undefined ? corner : event.vote && !planned ? voteButton(event, { variant: "sticker" }) : null;
  if (sticker) note.append(sticker);
  const link = el(planned ? "div" : "a", "challenge-link");
  if (!planned) link.href = href;
  const facts = formatEventFacts(event)
    .filter((fact) => fact.label !== "speed sweep")
    .map((fact) => fact.value)
    .join(" · ");
  link.append(el("div", "challenge-art"));
  if (known) link.append(el("span", "eyebrow", event.category.toUpperCase()));
  link.append(el("h4", "flyer-title", event.title));
  if (rows !== null) link.append(leaderLine(event, planned, rows));
  link.append(el("p", "challenge-facts", facts));
  note.append(link);
  if (planned) {
    const preview = el("a", "help-link", "Preview the challenge ?");
    preview.href = eventGuideHref(event.id);
    note.append(preview);
  }
  return note;
}
```

- [ ] **Step 4: Run the front-end tests**

Run: `cd app && npm test`
Expected: only the 4 known failures of `src/brightness.test.js`.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add app/src/wordmark.js app/src/wordmark.test.js app/src/flyer.js app/src/flyer.test.js
/usr/bin/git commit -m "Wordmark and flyer: a second word and a flyer without results, for the workshop's pages"
```

---

### Task 10: The workshop's page shell, its header and its home

**Files:**
- Rewrite: `app/workshop.html`, `app/src/workshop/main.js`, `app/src/workshop/api.js`, `app/public/workshop.css`
- Create: `app/src/workshop/{dom,routes,account,header,checks,home}.js` and `{routes,account,header,checks,home,main}.test.js`
- Delete: `app/src/workshop/{preflight,train,trial,publish,ui}.js`, `app/src/workshop/{preflight,train,trial,publish}.test.js` (the old `main.test.js` is replaced); in `app/public/race.css` the `.livery legend` rule and its comment
- Keep: `app/src/workshop/curve.js` and its test (Task 12 uses it)

**Interfaces:**
- Consumes: `GET /status`, `GET /hub`, `POST/GET /login`, `GET /code`, `POST /code/fork` (Tasks 1–4); `wordmark({word})`, `flyer(event, null, {href, corner})` (Task 9); the Arena's `signage.js` (`avatar`, `pendingIdentity`, `chequer`, `footer`), `router.js` (`dress`), `thumbnail.js` (`renderThumbnails`), `links.js`.
- Produces:
  - `dom.el(tag, className?, text?)`.
  - `routes.parseRoute(hash) -> {view: "home"} | {view: "challenge", event} | {view: "job", event, job}`, `homeHref`, `challengeHref(event)`, `jobHref(event, id)`.
  - `account.createAccount(onChange) -> {get(), check(), logIn()}`; states `{phase: "checking"} | {phase: "unreachable"} | {phase: "out", error?} | {phase: "waiting", url?} | {phase: "in", user, canPay}`; `account.fromHub(hub)`; `POLL_MS = 2000`.
  - `header.accountCard(state, {onLogIn, onRetry})`, `header.accountChip(state, {onLogIn, onRetry})`, `header.masthead(slot)`, `header.band(arena)`, `header.strip(slot)`.
  - `checks.box(ticked, variant)`, `checks.checkLine({ticked, label, note, guide, group, action, variant})`, `checks.forkGuide({onUseFork})`, `checks.billingGuide({onCheck})`.
  - `home.readyList({account, code, gpu}, {onCheck, onUseFork})`, `home.runningSticker(count)`, `home.mountHome(root, {status, account, route}) -> {leave(), accountChanged()}` — every page's `mount*` has this shape.
  - `main.js` maps views to mounts: `{ home: mountHome }` here; Tasks 11 and 12 add `challenge` and `job`.

- [ ] **Step 1: Write the failing tests**

Create `app/src/workshop/routes.test.js`:

```js
import { describe, expect, it } from "vitest";
import { challengeHref, jobHref, parseRoute } from "./routes.js";

describe("the workshop's routes", () => {
  it("reads the home, a challenge and a job", () => {
    expect(parseRoute("")).toEqual({ view: "home" });
    expect(parseRoute("#/")).toEqual({ view: "home" });
    expect(parseRoute("#/c/sprint-2m")).toEqual({ view: "challenge", event: "sprint-2m" });
    expect(parseRoute("#/c/sprint-2m/j/2026-09-28_10-00-00_first")).toEqual(
      { view: "job", event: "sprint-2m", job: "2026-09-28_10-00-00_first" });
  });

  it("writes what it reads", () => {
    expect(parseRoute(challengeHref("hill-climb-1m5"))).toEqual({ view: "challenge", event: "hill-climb-1m5" });
    expect(parseRoute(jobHref("sprint-2m", "first"))).toEqual({ view: "job", event: "sprint-2m", job: "first" });
  });
});
```

Create `app/src/workshop/account.test.js`:

```js
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getHub: vi.fn(),
  startLogin: vi.fn(),
  getLogin: vi.fn(),
}));
vi.mock("./api.js", () => api);

import { POLL_MS, createAccount, fromHub } from "./account.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("the account", () => {
  it("reads /hub", () => {
    expect(fromHub({ user: null, reachable: false, can_pay: false })).toEqual({ phase: "unreachable" });
    expect(fromHub({ user: null, reachable: true, can_pay: false })).toEqual({ phase: "out" });
    expect(fromHub({ user: "alice", reachable: true, can_pay: true })).toEqual({ phase: "in", user: "alice", canPay: true });
  });

  it("says checking, then what the Hub answered", async () => {
    api.getHub.mockResolvedValue({ user: "alice", reachable: true, can_pay: false });
    const seen = [];
    const account = createAccount((state) => seen.push(state.phase));
    await account.check();
    expect(seen).toEqual(["checking", "in"]);
    expect(account.get()).toEqual({ phase: "in", user: "alice", canPay: false });
  });

  it("logs in with the browser: waits, then asks the Hub again", async () => {
    api.startLogin.mockResolvedValue({ url: "https://huggingface.co/oauth/device?user_code=X", code: "X" });
    api.getLogin.mockResolvedValueOnce({ state: "waiting", output: "" }).mockResolvedValueOnce({ state: "done", output: "" });
    api.getHub.mockResolvedValue({ user: "alice", reachable: true, can_pay: true });
    const account = createAccount(() => {});
    await account.logIn();
    expect(account.get()).toEqual({ phase: "waiting", url: "https://huggingface.co/oauth/device?user_code=X" });
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(account.get().phase).toBe("waiting");
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(account.get()).toEqual({ phase: "in", user: "alice", canPay: true });
  });

  it("says why a login failed", async () => {
    api.startLogin.mockResolvedValue({ url: "u", code: "X" });
    api.getLogin.mockResolvedValue({ state: "failed", output: "Authorization denied." });
    const account = createAccount(() => {});
    await account.logIn();
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(account.get()).toEqual({ phase: "out", error: "Authorization denied." });
  });

  it("says why a login could not start", async () => {
    api.startLogin.mockRejectedValue(new Error("Could not start the Hugging Face login"));
    const account = createAccount(() => {});
    await account.logIn();
    expect(account.get()).toEqual({ phase: "out", error: "Could not start the Hugging Face login" });
  });
});
```

Create `app/src/workshop/checks.test.js`:

```js
import { describe, expect, it, vi } from "vitest";
import { billingGuide, box, checkLine, forkGuide } from "./checks.js";

describe("the checks", () => {
  it("draws a box, ticked or not", () => {
    expect(box(true).querySelector(".tick")).not.toBeNull();
    expect(box(false).querySelector(".tick")).toBeNull();
  });

  it("a ticked line only says, with its note", () => {
    const line = checkLine({ ticked: true, label: "Working in your fork", note: "alice/microduck-challenges", guide: document.createElement("p") });
    expect(line.querySelector("details")).toBeNull();
    expect(line.textContent).toContain("alice/microduck-challenges");
    expect(line.classList.contains("check--ticked")).toBe(true);
  });

  it("a line not ticked opens its guide with How?, one per list", () => {
    const guide = document.createElement("p");
    guide.textContent = "Fork it";
    const line = checkLine({ ticked: false, label: "Working in your fork", guide, group: "ready" });
    const details = line.querySelector("details");
    expect(details.getAttribute("name")).toBe("ready");
    expect(details.querySelector("summary .how").textContent).toBe("How?");
    expect(details.querySelector(".guide").textContent).toBe("Fork it");
  });

  it("a line can end with its own button", () => {
    const push = document.createElement("button");
    const line = checkLine({ ticked: false, label: "Pushed to your fork", action: push });
    expect(line.lastElementChild).toBe(push);
  });

  it("the fork's guide hands the address over and says what went wrong", async () => {
    const onUseFork = vi.fn().mockRejectedValue(new Error("https://gitlab.com/x is not a GitHub repository address"));
    const guide = forkGuide({ onUseFork });
    expect(guide.querySelector("a").href).toBe("https://github.com/pollen-robotics/microduck-challenges/fork");
    guide.querySelector("input").value = " https://gitlab.com/x ";
    guide.querySelector("button").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onUseFork).toHaveBeenCalledWith("https://gitlab.com/x");
    expect(guide.querySelector(".guide__error").hidden).toBe(false);
    expect(guide.querySelector(".guide__error").textContent).toContain("not a GitHub repository");
  });

  it("billing's guide links the billing page and checks again", () => {
    const onCheck = vi.fn();
    const guide = billingGuide({ onCheck });
    expect(guide.querySelector("a").href).toBe("https://huggingface.co/settings/billing");
    guide.querySelector("button").click();
    expect(onCheck).toHaveBeenCalled();
  });
});
```

Create `app/src/workshop/header.test.js`:

```js
import { describe, expect, it, vi } from "vitest";
import { accountCard, accountChip, band, masthead, strip } from "./header.js";

const handlers = () => ({ onLogIn: vi.fn(), onRetry: vi.fn() });

describe("the header", () => {
  it("reads Microduck Workshop, on the cover and on the strip", () => {
    const slot = document.createElement("span");
    expect(masthead(slot).querySelector(".wordmark").textContent).toBe("MicroduckWorkshop");
    expect(strip(slot).querySelector(".wordmark").textContent).toBe("MicroduckWorkshop");
    expect(strip(slot).querySelector(".wordmark a").getAttribute("href")).toBe("#/");
  });

  it("the band leads back to the Arena", () => {
    const links = [...band("https://arena.test").querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links[0]).toEqual(["Back to the Arena", "https://arena.test/"]);
  });

  it("the card holds a duck while the Hub is asked", () => {
    expect(accountCard({ phase: "checking" }, handlers()).className).toContain("player-card--waiting");
  });

  it("the card is the way in, logged out", () => {
    const on = handlers();
    const card = accountCard({ phase: "out" }, on);
    const button = card.querySelector("button.player-card-in");
    expect(button.textContent).toContain("Log in");
    button.click();
    expect(on.onLogIn).toHaveBeenCalled();
  });

  it("the card waits for huggingface.co, with the page's address in case no tab opened", () => {
    const card = accountCard({ phase: "waiting", url: "https://huggingface.co/oauth/device?user_code=X" }, handlers());
    expect(card.querySelector("button").disabled).toBe(true);
    expect(card.querySelector("a.account-note").href).toBe("https://huggingface.co/oauth/device?user_code=X");
  });

  it("the card asks again when the Hub was unreachable", () => {
    const on = handlers();
    accountCard({ phase: "unreachable" }, on).querySelector("button").click();
    expect(on.onRetry).toHaveBeenCalled();
  });

  it("the card names the account once logged in", () => {
    const card = accountCard({ phase: "in", user: "alice", canPay: true }, handlers());
    expect(card.textContent).toContain("alice");
    expect(card.querySelector("a").href).toBe("https://huggingface.co/alice");
  });

  it("the chip is the strip's plate, in the same phases", () => {
    const on = handlers();
    const out = accountChip({ phase: "out" }, on);
    expect(out.className).toContain("sticker-orange");
    out.click();
    expect(on.onLogIn).toHaveBeenCalled();
    expect(accountChip({ phase: "in", user: "alice" }, on).textContent).toContain("alice");
    expect(accountChip({ phase: "waiting" }, on).disabled).toBe(true);
  });
});
```

Create `app/src/workshop/home.test.js`:

```js
import { describe, expect, it, vi } from "vitest";
import { readyList, runningSticker } from "./home.js";

const on = { onCheck: vi.fn(), onUseFork: vi.fn() };
const lines = (list) => [...list.children].map((li) => [li.querySelector(".check__label").textContent, li.classList.contains("check--ticked")]);

describe("Ready to train?", () => {
  it("ticks billing only for an account that can pay", () => {
    const code = { fork: null };
    expect(lines(readyList({ account: { phase: "in", user: "a", canPay: true }, code, gpu: false }, on))[0]).toEqual(["Hugging Face Jobs, billing set up", true]);
    expect(lines(readyList({ account: { phase: "in", user: "a", canPay: false }, code, gpu: false }, on))[0][1]).toBe(false);
    expect(lines(readyList({ account: { phase: "out" }, code, gpu: false }, on))[0][1]).toBe(false);
  });

  it("ticks the fork and names it", () => {
    const list = readyList({ account: { phase: "out" }, code: { fork: "alice/microduck-challenges" }, gpu: false }, on);
    expect(lines(list)[1]).toEqual(["Working in your fork", true]);
    expect(list.children[1].textContent).toContain("alice/microduck-challenges");
  });

  it("shows the GPU only where there is one, ticked", () => {
    expect(lines(readyList({ account: { phase: "out" }, code: null, gpu: false }, on))).toHaveLength(2);
    expect(lines(readyList({ account: { phase: "out" }, code: null, gpu: true }, on))[2]).toEqual(["NVIDIA GPU on this machine", true]);
  });
});

describe("the running sticker", () => {
  it("counts the trainings running", () => {
    expect(runningSticker(0)).toBeNull();
    expect(runningSticker(1).textContent).toBe("1 training now");
    expect(runningSticker(2).textContent).toBe("2 trainings now");
  });
});
```

Replace `app/src/workshop/main.test.js` with:

```js
// main.js mounts itself on import, as the page does: this drives the whole home against a mocked API.

import { describe, expect, it, vi } from "vitest";

const { api, SPRINT, SWAG } = vi.hoisted(() => {
  const SPRINT = { id: "sprint-2m", title: "2 m Sprint", status: "open", category: "race", vote: null, metric: "time",
    length_m: 2, slope_deg: 0, rig: "legs", sweep_lo: 0.2, sweep_hi: 1.2, sweep_count: 21 };
  const SWAG = { ...SPRINT, id: "swag-contest", title: "Swag Contest", category: "showcase", vote: { ballot_min: 2 }, metric: "votes" };
  const api = {
    getStatus: async () => ({ arena: "https://arena.test", gpu: false, challenges: [
      { event: SPRINT, folder: "sprint_2m", task: "S", recipe: {}, knobs: [], running: 1 },
      { event: SWAG, folder: "swag_contest", task: "W", recipe: {}, knobs: [], running: 0 },
    ] }),
    getHub: async () => ({ user: null, reachable: true, can_pay: false }),
    startLogin: vi.fn(async () => ({ url: "https://huggingface.co/oauth/device?user_code=X", code: "X" })),
    getLogin: async () => ({ state: "waiting", output: "" }),
    getCode: async () => ({ fork: null, changes: [], identity: true, commit: "abc1234", unpushed: 0 }),
    useFork: async () => ({ fork: "alice/microduck-challenges", changes: [], identity: true, commit: "abc1234", unpushed: 0 }),
  };
  return { api, SPRINT, SWAG };
});
vi.mock("./api.js", () => api);
vi.mock("../thumbnail.js", () => ({ renderThumbnails: async () => new Map() }));

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the workshop's home", () => {
  it("draws the cover, Ready to train? and the challenges, then logs in with the browser", async () => {
    document.body.innerHTML = '<div id="app"></div>';
    await import("./main.js");
    for (let i = 0; i < 5; i += 1) await settle();
    const app = document.querySelector("#app");
    expect(app.querySelector(".masthead .wordmark").textContent).toBe("MicroduckWorkshop");
    expect(app.querySelector(".todo__title").textContent).toBe("Ready to train?");
    expect(app.querySelector(".lede").textContent).toBe("Pick a challenge, then train, submit, compete, repeat.");
    const links = [...app.querySelectorAll(".challenge-link")].map((a) => a.getAttribute("href"));
    expect(links).toEqual(["#/c/sprint-2m", "#/c/swag-contest"]);
    expect(app.querySelector(".flyer-leader")).toBeNull();
    expect(app.querySelector(".vote-button")).toBeNull();
    expect(app.querySelector(".ws-running").textContent).toBe("1 training now");
    const plate = app.querySelector(".masthead button.player-card-in");
    expect(plate.textContent).toContain("Log in");
    plate.click();
    await settle();
    expect(api.startLogin).toHaveBeenCalled();
    expect(app.querySelector(".masthead button.player-card-in").textContent).toContain("Waiting");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd app && npx vitest run src/workshop`
Expected: FAIL (modules missing).

- [ ] **Step 3: Delete the old page's modules**

```bash
/usr/bin/git rm -q app/src/workshop/preflight.js app/src/workshop/preflight.test.js app/src/workshop/train.js app/src/workshop/train.test.js app/src/workshop/trial.js app/src/workshop/trial.test.js app/src/workshop/publish.js app/src/workshop/publish.test.js app/src/workshop/ui.js
```

In `app/public/race.css`, delete the `.livery legend { … }` rule and the comment above it ("Every label styled here is an eyebrow … livery picker shares this column's type.").

- [ ] **Step 4: Write the page**

`app/workshop.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Microduck workshop</title>
    <link rel="icon" href="/duck-head-mark.webp" />
    <!-- Duck Jam's design system, as on every page of the Arena. -->
    <link rel="stylesheet" href="/design/tokens.css" />
    <link rel="stylesheet" href="/design/effects.css" />
    <link rel="stylesheet" href="/design/components.css" />
    <link rel="stylesheet" href="/design/motion.css" />
    <link rel="stylesheet" href="/shell.css" />
    <!-- The Arena's two placement sheets, worn one at a time (router.js's dress): the club on the
         home, trackside on a challenge's page and a training's. -->
    <link rel="stylesheet" href="/club.css" data-theme="club" />
    <link rel="stylesheet" href="/race.css" data-theme="race" disabled />
    <link rel="stylesheet" href="/workshop.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/workshop/main.js"></script>
  </body>
</html>
```

`app/src/workshop/dom.js`:

```js
// The one DOM helper every workshop page uses.

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
```

`app/src/workshop/routes.js`:

```js
// The workshop's pages, addressed by hash so the browser's back button works: the home, a challenge,
// and one training of that challenge.

const SEGMENT = "([A-Za-z0-9._-]+)";
const CHALLENGE = new RegExp(`^/c/${SEGMENT}/?$`);
const JOB = new RegExp(`^/c/${SEGMENT}/j/${SEGMENT}/?$`);

export function parseRoute(hash) {
  const path = String(hash || "").replace(/^#/, "");
  const job = path.match(JOB);
  if (job) return { view: "job", event: job[1], job: job[2] };
  const challenge = path.match(CHALLENGE);
  if (challenge) return { view: "challenge", event: challenge[1] };
  return { view: "home" };
}

export const homeHref = "#/";
export const challengeHref = (event) => `#/c/${event}`;
export const jobHref = (event, id) => `#/c/${event}/j/${id}`;
```

`app/src/workshop/api.js` (the calls the home makes; Tasks 11 and 12 add theirs):

```js
// Every call the workshop's pages make. Errors carry the server's own sentence — for a failed
// command, its whole output.

import { detailFrom } from "../api.js";

async function json(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(await detailFrom(response));
  return response.json();
}

const post = (url, body = {}) =>
  json(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const getStatus = () => json("/api/workshop/status");
export const getHub = () => json("/api/workshop/hub");
export const startLogin = () => post("/api/workshop/login");
export const getLogin = () => json("/api/workshop/login");
export const getCode = () => json("/api/workshop/code");
export const useFork = (url) => post("/api/workshop/code/fork", { url });
```

`app/src/workshop/account.js`:

```js
// Who is logged in to Hugging Face, asked apart from everything else: the Hub may take seconds to
// answer, or never answer, and no page waits for it. Logging in is Hugging Face's own browser flow,
// started by the server (which opens the page); once it has ended the Hub is asked again.

import * as api from "./api.js";

export const POLL_MS = 2000;

export function fromHub(hub) {
  if (!hub.reachable) return { phase: "unreachable" };
  return hub.user ? { phase: "in", user: hub.user, canPay: Boolean(hub.can_pay) } : { phase: "out" };
}

export function createAccount(onChange) {
  let state = { phase: "checking" };
  const set = (next) => {
    state = next;
    onChange(state);
  };

  async function check() {
    set({ phase: "checking" });
    try {
      set(fromHub(await api.getHub()));
    } catch {
      set({ phase: "unreachable" });
    }
  }

  async function wait() {
    let login;
    try {
      login = await api.getLogin();
    } catch (error) {
      set({ phase: "out", error: error.message });
      return;
    }
    if (login.state === "waiting") setTimeout(wait, POLL_MS);
    else if (login.state === "failed") set({ phase: "out", error: login.output || "The login did not finish." });
    else await check();
  }

  async function logIn() {
    set({ phase: "waiting" });
    try {
      const { url } = await api.startLogin();
      set({ phase: "waiting", url });
    } catch (error) {
      set({ phase: "out", error: error.message });
      return;
    }
    setTimeout(wait, POLL_MS);
  }

  return { get: () => state, check, logIn };
}
```

`app/src/workshop/checks.js`:

```js
// A to-do list's hand-drawn boxes, and the lines they tick: the home's "Ready to train?" and the two
// checks over Publish. A line not ticked can open its own guide, one open at a time in its list.

import { el } from "./dom.js";

const SVG = "http://www.w3.org/2000/svg";
// Three hand-drawn squares, so a column of boxes does not read as one stamp repeated.
const FRAMES = [
  "M4.5 5.2C9 4.2 17 4.6 23.4 4.1 23.9 10 23.6 17 24 23.6 17 24.2 10 23.8 4.2 24.1 4.6 17 4.1 10 4.5 5.2Z",
  "M4.2 4.6C10 4.9 16.5 4.1 23.8 4.8 23.5 11 24.2 17.5 23.5 23.9 16.8 23.4 10.4 24.3 4.5 23.7 4.1 17 4.8 11.3 4.2 4.6Z",
  "M4.8 4.3C11 4.8 17 4.2 23.6 4.6 24.1 10.5 23.4 17.2 23.9 23.8 17.5 23.5 10.8 24.1 4.3 23.8 4.7 17.6 4.2 10.9 4.8 4.3Z",
];
// The tick overshoots the box, as a pen does.
const TICK = "M7 14.5 12 20 25.5 3.5";
export const FORK_PAGE = "https://github.com/pollen-robotics/microduck-challenges/fork";
export const BILLING = "https://huggingface.co/settings/billing";

function path(className, d) {
  const line = document.createElementNS(SVG, "path");
  line.setAttribute("class", className);
  line.setAttribute("d", d);
  return line;
}

export function box(ticked, variant = 0) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "box");
  svg.setAttribute("viewBox", "0 0 28 28");
  svg.setAttribute("aria-hidden", "true");
  svg.append(path("frame", FRAMES[variant % FRAMES.length]));
  if (ticked) svg.append(path("tick", TICK));
  return svg;
}

/**
 * One line of a list. Ticked, or with no `guide`, it only says, with an optional `action` (a button)
 * at its end. Not ticked, with a `guide` (a node), a "How?" opens it; `group` names the list, so
 * opening one guide closes the others.
 */
export function checkLine({ ticked, label, note, guide, group, action, variant = 0 }) {
  const li = el("li", ticked ? "check check--ticked" : "check");
  const words = el("span", "check__words");
  words.append(el("span", "check__label", label));
  if (note) words.append(el("small", "check__note", note));
  if (ticked || !guide) {
    li.classList.add("check--plain");
    li.append(box(ticked, variant), words);
    if (action) li.append(action);
    return li;
  }
  const details = el("details");
  if (group) details.setAttribute("name", group);
  const summary = el("summary", "check__row");
  summary.append(box(false, variant), words, el("span", "how", "How?"));
  const inside = el("div", "guide");
  inside.append(guide);
  details.append(summary, inside);
  li.append(details);
  return li;
}

/** The fork's guide: GitHub's fork page, then the fork's address, which the workshop makes `origin`. */
export function forkGuide({ onUseFork }) {
  const guide = el("div");
  guide.innerHTML = `
    <ol>
      <li><a target="_blank" rel="noopener">Fork microduck-challenges</a> on GitHub (free account).</li>
      <li>Paste your fork's address:
        <span class="guide__field"><input type="url" name="fork" placeholder="https://github.com/you/microduck-challenges" spellcheck="false" /><button class="quiet" type="button">Use it</button></span></li>
    </ol>
    <p>This folder then sends your commits to your fork; Pollen's repository stays as <code>upstream</code>.</p>
    <p class="guide__error" hidden></p>`;
  guide.querySelector("a").href = FORK_PAGE;
  const error = guide.querySelector(".guide__error");
  const button = guide.querySelector("button");
  button.addEventListener("click", async () => {
    error.hidden = true;
    button.disabled = true;
    try {
      await onUseFork(guide.querySelector("input").value.trim());
    } catch (failure) {
      error.textContent = failure.message;
      error.hidden = false;
    } finally {
      button.disabled = false;
    }
  });
  return guide;
}

/** Billing's guide: Hugging Face's billing page (it asks to log in first when needed), then a new look. */
export function billingGuide({ onCheck }) {
  const guide = el("div");
  guide.innerHTML = `
    <p>Hugging Face Jobs rent you a GPU by the minute: your account needs a payment method.</p>
    <p><a target="_blank" rel="noopener">Add a payment method</a>, then <button class="quiet" type="button">Check again</button></p>`;
  guide.querySelector("a").href = BILLING;
  guide.querySelector("button").addEventListener("click", onCheck);
  return guide;
}
```

`app/src/workshop/header.js`:

```js
// The Arena's own header, worn by the workshop: the cover and its yellow band on the home, the strip
// on every other page. The account sits where the Arena puts the player, and it is the way in: "Log
// in" starts Hugging Face's browser login, whose page the server opens.

import { FLOCK, MICRODUCK_RL } from "../links.js";
import { avatar, pendingIdentity } from "../signage.js";
import { duckHead, wordmark } from "../wordmark.js";
import { el } from "./dom.js";
import { homeHref } from "./routes.js";

const profile = (user) => `https://huggingface.co/${encodeURIComponent(user)}`;
const CARD = { waiting: ["Waiting…", "for huggingface.co"], unreachable: ["Check again", "Hugging Face unreachable"], out: ["Log in", "to Hugging Face"] };
const CHIP = { waiting: "Waiting for huggingface.co…", unreachable: "Hugging Face unreachable · Check again", out: "Log in to Hugging Face" };

function outLink(className, text, href) {
  const link = el("a", className, text);
  Object.assign(link, { href, target: "_blank", rel: "noopener" });
  return link;
}

/** Under the card: the login page while it waits (in case no tab opened), or why a login failed. */
function aside(state) {
  if (state.phase === "waiting" && state.url) return [outLink("account-note", "Open huggingface.co", state.url)];
  return state.error ? [el("p", "account-note account-note--bad", state.error)] : [];
}

/** The account on the home's cover, as the Arena's player card, in each of its phases. */
export function accountCard(state, { onLogIn, onRetry }) {
  if (state.phase === "checking") return pendingIdentity("player-card");
  const box = el("div", "player-card");
  if (state.phase === "in") {
    const link = outLink("player-card-you fx-shadow-card", undefined, profile(state.user));
    link.append(avatar(state.user), el("span", "player-card-name", state.user));
    box.append(link);
    return box;
  }
  const [name, under] = CARD[state.phase];
  const button = el("button", "player-card-in fx-shadow-card");
  button.type = "button";
  const head = duckHead();
  head.classList.add("player-card-duck");
  button.append(head, el("span", "player-card-name", name), el("span", "player-card-score", under));
  button.disabled = state.phase === "waiting";
  button.addEventListener("click", state.phase === "unreachable" ? onRetry : onLogIn);
  box.append(button, ...aside(state));
  return box;
}

/** The account on the strip: the Arena's profile chip, or its orange sign-in sticker. */
export function accountChip(state, { onLogIn, onRetry }) {
  if (state.phase === "checking") return pendingIdentity("profile-chip");
  if (state.phase === "in") {
    const link = outLink("profile-chip", undefined, profile(state.user));
    link.append(avatar(state.user), el("span", "", state.user));
    return link;
  }
  const button = el("button", state.phase === "out" ? "sticker sticker-orange" : "sticker", CHIP[state.phase]);
  button.type = "button";
  button.disabled = state.phase === "waiting";
  if (state.error) button.title = state.error;
  button.addEventListener("click", state.phase === "unreachable" ? onRetry : onLogIn);
  return button;
}

/** The home's cover: the duck, MICRODUCK / WORKSHOP, and the account in `slot`. */
export function masthead(slot) {
  const head = el("header", "masthead fx-ray-fan");
  const row = el("div", "masthead-row");
  const lockup = el("div", "masthead-lockup");
  lockup.append(duckHead({ quacks: true }), wordmark({ variant: "cover", word: "Workshop" }));
  const nav = el("nav", "masthead-player");
  nav.setAttribute("aria-label", "Account");
  nav.append(slot);
  row.append(lockup, nav);
  head.append(row);
  return head;
}

/** The yellow band under the cover: back to the Arena, the community, the training code. */
export function band(arena) {
  const strip_ = el("div", "flock-band");
  const row = el("div", "flock-band-row");
  [["Back to the Arena", `${arena}/`], ["Join the flock", FLOCK], ["Create policies", MICRODUCK_RL]].forEach(([text, href], i) => {
    if (i) row.append(el("span", "flock-star", "★"));
    row.append(outLink("", text, href));
  });
  strip_.append(row);
  return strip_;
}

/** Every other page's strip: the mark, which is the way home, and the account in `slot`. */
export function strip(slot) {
  const header = el("header", "signage");
  const brand = el("div", "club-brand");
  const title = wordmark({ word: "Workshop" });
  const home = el("a");
  home.href = homeHref;
  home.append(...title.childNodes);
  title.append(home);
  brand.append(duckHead(), title);
  const nav = el("nav", "site-nav");
  nav.setAttribute("aria-label", "Account");
  nav.append(slot);
  header.append(brand, nav);
  return header;
}
```

(`outLink` with `text` undefined leaves the link empty for its children.)

`app/src/workshop/home.js`:

```js
// The workshop's front: what this machine is connected to, and the challenges to train for.

import { flyer } from "../flyer.js";
import { dress } from "../router.js";
import { chequer, footer } from "../signage.js";
import { renderThumbnails } from "../thumbnail.js";
import * as api from "./api.js";
import { billingGuide, checkLine, forkGuide } from "./checks.js";
import { el } from "./dom.js";
import { accountCard, band, masthead } from "./header.js";
import { challengeHref } from "./routes.js";

/** "Ready to train?": what this machine is connected to, each line ticked or with its guide. */
export function readyList({ account, code, gpu }, { onCheck, onUseFork }) {
  const list = el("ul");
  list.append(
    checkLine({
      ticked: account.phase === "in" && account.canPay, label: "Hugging Face Jobs, billing set up",
      note: "Trains on an L4 GPU, billed to your account.", guide: billingGuide({ onCheck }), group: "ready",
    }),
    checkLine({
      ticked: Boolean(code?.fork), label: "Working in your fork",
      note: code?.fork ?? "Your code on GitHub: people who open your entry see what trained it.",
      guide: forkGuide({ onUseFork }), group: "ready", variant: 1,
    }),
  );
  // Nothing to set up from here: shown only where there is one.
  if (gpu) list.append(checkLine({ ticked: true, label: "NVIDIA GPU on this machine", variant: 2 }));
  return list;
}

/** Where the Arena pins VOTE HERE, the workshop says a challenge has trainings running. */
export function runningSticker(count) {
  return count ? el("span", "sticker sticker-lime ws-running", `${count} training${count === 1 ? "" : "s"} now`) : null;
}

export async function mountHome(root, { status, account }) {
  let code = await api.getCode().catch(() => null);
  dress("menu"); // the club's sheet, which the Arena's front wears
  const slot = el("span");
  const post = el("div", "todo");
  post.append(el("span", "flyer-tape"), el("h3", "todo__title", "Ready to train?"));
  const pitch = el("div", "door-pitch");
  pitch.append(el("p", "eyebrow", "Microduck workshop"), el("h2", "hero", "Train your own duck."),
    el("p", "lede", "Pick a challenge, then train, submit, compete, repeat."));
  const door = el("section", "door door--ws fx-grain");
  door.append(pitch, post);
  const flyers = status.challenges.map((c) =>
    flyer(c.event, null, { href: challengeHref(c.event.id), corner: runningSticker(c.running) }));
  const wall = el("div", "cabinets");
  wall.append(...flyers);
  const rounds = el("section", "chapter chapter--wall fx-scanlines");
  rounds.append(el("h3", "eyebrow", "Pick your challenge"), wall);
  const hall = el("main", "hall");
  hall.append(door, chequer("chapter-checker"), rounds);
  const texture = el("div", "page-fx fx-grain");
  texture.setAttribute("aria-hidden", "true");
  root.replaceChildren(texture, masthead(slot), band(status.arena), hall, footer());

  function draw() {
    const state = account.get();
    slot.replaceChildren(accountCard(state, { onLogIn: account.logIn, onRetry: account.check }));
    post.querySelector("ul")?.remove();
    post.append(readyList({ account: state, code, gpu: status.gpu }, {
      onCheck: account.check,
      onUseFork: async (url) => {
        code = await api.useFork(url);
        draw();
      },
    }));
  }
  draw();

  // The stills after the page is up: WebGL and a GLB must not hold it; without them the frames stay dark.
  renderThumbnails(status.challenges.map((c) => c.event)).then((stills) => {
    status.challenges.forEach((c, i) => {
      const url = stills.get(c.event.id);
      if (!url) return;
      const img = el("img");
      Object.assign(img, { src: url, alt: "" });
      flyers[i].querySelector(".challenge-art").replaceChildren(img);
    });
  }).catch(() => {});

  return { leave() {}, accountChanged: draw };
}
```

`app/src/workshop/main.js`:

```js
// The workshop's page: a home, a page per challenge, a page per training, addressed by hash so the
// browser's back button works. Each page mounts itself and says how to leave it (its polls, its
// viewer) and how to redraw the account when that changes.

import { createAccount } from "./account.js";
import * as api from "./api.js";
import { el } from "./dom.js";
import { mountHome } from "./home.js";
import { parseRoute } from "./routes.js";

const MOUNTS = { home: mountHome };

const root = document.querySelector("#app");
let page = null;
let shown = 0; // the latest show(): an older one that finishes late does not mount over it

const account = createAccount(() => page?.accountChanged());

async function show() {
  const mine = ++shown;
  page?.leave();
  page = null;
  try {
    const status = await api.getStatus();
    const route = parseRoute(location.hash);
    if (mine !== shown) return;
    const next = await (MOUNTS[route.view] ?? mountHome)(root, { status, account, route });
    if (mine !== shown) {
      next.leave();
      return;
    }
    page = next;
    window.scrollTo?.(0, 0);
  } catch (error) {
    root.replaceChildren(el("p", "failed", `The workshop's server did not answer: ${error.message}`));
  }
}

window.addEventListener("hashchange", show);
account.check(); // not awaited: the Hub may be slow, and no page waits for it
show();
```

Replace `app/public/workshop.css` with:

```css
/* The workshop's own pieces, over the Arena's sheets (club.css on the home, race.css on the other
   pages): only what the Arena has no component for. Colours from design/tokens.css, the charter's
   faces only. */

/* The Arena's full-bleed bands reach past the window on its front; the workshop's pages do not scroll sideways. */
html, body { overflow-x: clip; }

/* ── a quiet button: the charter's small sticker, never a second orange block ─ */
.quiet {
  display: inline-block; padding: 4px 10px; border: 2px solid var(--ink); background: var(--paper); color: var(--ink);
  font-family: var(--type-sticker-family); font-size: var(--type-sticker-size); letter-spacing: var(--type-sticker-tracking);
  text-transform: uppercase; text-decoration: none; cursor: pointer;
  box-shadow: var(--shadow-sticker-min) var(--shadow-sticker-min) 0 var(--ink);
}
.quiet:disabled { opacity: 0.45; cursor: not-allowed; box-shadow: none; }
.quiet:focus-visible { outline: 3px solid var(--cyan); outline-offset: 3px; }
.sticker-paper { background: var(--paper); }
.note, .hint { margin: 0; font-size: 0.8rem; color: var(--ink-70); white-space: pre-wrap; }
.note.bad, .hint.bad { color: var(--orange-inked); }

/* ── the account: the Arena's player card, a button while logged out ─ */
button.player-card-in { font: inherit; cursor: pointer; }
button.player-card-in:disabled { cursor: progress; }
.account-note { display: block; max-width: 10.5rem; margin: 8px 0 0; font-size: 0.75rem; color: var(--paper); }
.account-note--bad { color: var(--yellow); white-space: pre-wrap; }

/* ── the home: the pitch on the left, the post-it on the right ─ */
.door--ws { align-items: center; }
.door--ws .door-pitch { max-width: 34rem; }
.ws-running { position: absolute; top: 18px; right: -10px; rotate: 6deg; z-index: 1; cursor: default; }

/* ── "Ready to train?": a yellow post-it, taped and tilted ─ */
.todo {
  position: relative; width: min(26rem, 100%); padding: 34px 28px 26px; background: var(--yellow); color: var(--ink);
  border: 2px solid var(--ink); box-shadow: var(--shadow-card-max) var(--shadow-card-max) var(--shadow-blur) var(--ink);
  rotate: -2.2deg; font-family: var(--body);
}
.todo .flyer-tape { top: -13px; rotate: 3deg; }
.todo__title { margin: 0 0 14px; font-family: var(--display); font-weight: 400; font-size: 2.1rem; line-height: 1; text-transform: uppercase; }
.todo ul, .checks { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }

/* ── a line of a list and its hand-drawn box ─ */
.check { font-size: 1.08rem; line-height: 1.35; }
.check--plain, .check__row { display: grid; grid-template-columns: 30px 1fr auto; gap: 10px; align-items: start; }
.check__row { list-style: none; cursor: pointer; }
.check__row::-webkit-details-marker { display: none; }
.check__row:hover .check__label { text-decoration: underline; text-decoration-thickness: 2px; }
.check__note { display: block; margin-top: 2px; font-size: 0.8rem; color: var(--ink-70); overflow-wrap: anywhere; }
.how {
  align-self: center; padding: 1px 8px; border: 2px solid var(--ink); background: var(--paper);
  font-family: var(--type-sticker-family); font-size: 0.66rem; letter-spacing: var(--type-sticker-tracking);
  text-transform: uppercase; box-shadow: 2px 2px 0 var(--ink);
}
details[open] > .check__row .how { background: var(--ink); color: var(--yellow); box-shadow: none; }
.box { width: 28px; height: 28px; margin-top: -2px; }
.box .frame { fill: none; stroke: var(--ink); stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
.box .tick { fill: none; stroke: var(--lime-inked); stroke-width: 3.6; stroke-linecap: round; stroke-linejoin: round; }
.guide {
  display: grid; gap: 8px; margin: 10px 0 4px 40px; padding: 12px 14px; background: var(--paper);
  border: 2px solid var(--ink); font-size: 0.85rem; line-height: 1.45;
}
.guide ol { display: grid; gap: 6px; margin: 0; padding-left: 1.3em; }
.guide p { margin: 0; }
.guide code { padding: 1px 4px; background: var(--warm-paper); font-family: var(--mono); font-size: 0.78rem; }
.guide a { color: var(--ink); font-weight: 600; }
.guide__field { display: flex; gap: 8px; margin-top: 4px; }
.guide__field input { flex: 1; min-width: 0; padding: 6px 8px; border: 2px solid var(--ink); background: var(--paper); font: inherit; font-size: 0.85rem; }
.guide__error { color: var(--orange-inked); white-space: pre-wrap; }
```

- [ ] **Step 5: Run the front-end tests and build**

Run: `cd app && npm test`
Expected: only the 4 known failures of `src/brightness.test.js`.

Run: `cd app && npm run build`
Expected: success.

- [ ] **Step 6: See it**

Start the workshop on the real challenges checkout (a server: backgrounding it is fine, the checks below run in the foreground), then capture the home:

```bash
cd ~/Projects/HuggingFace/microduck-challenges/.claude/worktrees/plan4-workshop && UV_NO_CONFIG=1 UV_NO_SYNC=1 uv run workshop --no-browser --port 8766 --arena http://127.0.0.1:8000
```

```bash
cd /private/tmp/claude-501/-Users-nicolasrabault-Projects-HuggingFace-microduck-arena/9f88e57b-22a5-4a4b-b645-cad3b1cd5023/scratchpad && node ws-shot.js "http://127.0.0.1:8766/" shots/t10-home-1280.png 1280 5000 && node ws-shot.js "http://127.0.0.1:8766/" shots/t10-home-420.png 420 5000
```

Read both PNGs and compare with `shots/home-v7.png`: the cover reads MICRODUCK / WORKSHOP with the account card at the right, the yellow band, the pitch with the slogan, the tilted yellow post-it with green ticks (or boxes and **How?**), the chequer, "Pick your challenge" with the open challenges' flyers, no leader line, the footer. The driver must not print `SCROLLS SIDEWAYS`, `pageerror` or `BLOCKED`. Fix and capture again until it matches. Stop the server afterwards (`pkill -f "workshop --no-browser --port 8766"`).

- [ ] **Step 7: Commit**

```bash
/usr/bin/git add -A app/workshop.html app/src/workshop app/public/workshop.css app/public/race.css
/usr/bin/git commit -m "Workshop page: the Arena's header and a home with Ready to train? and the challenges' flyers"
```

---

### Task 11: A challenge's page: make it yours, the training form, the tickets

**Files:**
- Create: `app/src/workshop/challenge.js`, `app/src/workshop/trainform.js`, `app/src/workshop/tickets.js` and `{challenge,trainform,tickets}.test.js`
- Modify: `app/src/workshop/api.js`, `app/src/workshop/main.js` (`challenge: mountChallenge`), `app/public/workshop.css`

**Interfaces:**
- Consumes: `GET /code`, `POST /code/commit`, `POST /challenges/{event}/train`, `GET /challenges/{event}/jobs`, `POST …/jobs/{id}/stop` (Tasks 3–4); `header.accountChip`, `header.strip`, `dom.el`, `routes.jobHref`.
- Produces:
  - `api.commitCode(message)`, `api.train(event, body)`, `api.getJobs(event) -> tickets`, `api.stopJob(event, id)`.
  - `trainform.runName(now)`, `trainform.revisionMessage(event, now)`, `trainform.unavailable(where, {account, gpu}) -> string|null`, `trainform.trainForm({challenge, gpu}, {onCommit, onTrain}) -> {el, update({code, account})}`.
  - `tickets.WHERE`, `tickets.seconds(s)`, `tickets.bars(checkpoints, best, {future, selected, onPick})`, `tickets.describe(checkpoint)`, `tickets.summary(ticket, voted)`, `tickets.officialTime(entered)`, `tickets.progress({done,total})`, `tickets.ticketCard(ticket, {event, voted, onStop})`.
  - `challenge.mountChallenge(root, {status, account, route})`, `challenge.POLL_MS = 3000`.

- [ ] **Step 1: Write the failing tests**

Create `app/src/workshop/trainform.test.js`:

```js
import { describe, expect, it, vi } from "vitest";
import { revisionMessage, runName, trainForm, unavailable } from "./trainform.js";

const CHALLENGE = {
  event: { id: "sprint-2m" }, folder: "sprint_2m",
  recipe: { num_envs: 4096, max_iterations: 3000, seed: 1 },
  knobs: [
    { name: "forward_reward", label: "Follow the speed order", value: 2, min: 0.5, max: 5, group: "reward" },
    { name: "max_slope_deg", label: "Steepest training slope (°)", value: 10, min: 0, max: 15, group: "recipe" },
  ],
};
const CLEAN = { fork: null, changes: [], identity: true, commit: "abc1234", unpushed: 0 };
const DIRTY = { ...CLEAN, changes: [{ status: "M", path: "src/microduck_challenges/sprint_2m/env.py" }, { status: "??", path: "src/microduck_challenges/sprint_2m/rewards.py" }] };
const IN = { phase: "in", user: "alice", canPay: true };
const at = new Date(2026, 8, 30, 9, 40);

describe("the training form", () => {
  it("names a run and a commit by the date", () => {
    expect(runName(at)).toBe("run-0930-0940");
    expect(revisionMessage("sprint-2m", at)).toBe("sprint-2m training revision 2026-09-30 09:40");
  });

  it("says why a place to train is not available", () => {
    expect(unavailable("local", { account: IN, gpu: false })).toContain("No NVIDIA GPU");
    expect(unavailable("local", { account: IN, gpu: true })).toBeNull();
    expect(unavailable("hf-jobs", { account: { phase: "out" }, gpu: false })).toContain("Log in");
    expect(unavailable("hf-jobs", { account: { ...IN, canPay: false }, gpu: false })).toContain("payment method");
    expect(unavailable("hf-jobs", { account: IN, gpu: false })).toBeNull();
  });

  it("is locked behind a commit while files changed, and the commit unlocks it", async () => {
    const onCommit = vi.fn(async () => {});
    const form = trainForm({ challenge: CHALLENGE, gpu: false }, { onCommit, onTrain: vi.fn() });
    form.update({ code: DIRTY, account: IN });
    expect(form.el.querySelector(".gate").hidden).toBe(false);
    expect([...form.el.querySelectorAll(".gate__files li")].map((li) => li.textContent)).toEqual([
      "Msrc/microduck_challenges/sprint_2m/env.py", "??src/microduck_challenges/sprint_2m/rewards.py"]);
    expect(form.el.querySelector("input[name=message]").value).toMatch(/^sprint-2m training revision \d{4}-\d\d-\d\d \d\d:\d\d$/);
    expect(form.el.querySelector("fieldset").disabled).toBe(true);
    form.el.querySelector(".gate__go").click();
    await Promise.resolve();
    expect(onCommit).toHaveBeenCalledWith(expect.stringMatching(/^sprint-2m training revision/));
    form.update({ code: CLEAN, account: IN });
    expect(form.el.querySelector(".gate").hidden).toBe(true);
    expect(form.el.querySelector(".committed").textContent).toBe("✓ All committed · abc1234");
    expect(form.el.querySelector("fieldset").disabled).toBe(false);
  });

  it("asks for a name on commits instead of a Commit button when git has none", () => {
    const form = trainForm({ challenge: CHALLENGE, gpu: false }, { onCommit: vi.fn(), onTrain: vi.fn() });
    form.update({ code: { ...DIRTY, identity: false }, account: IN });
    expect(form.el.querySelector(".gate__go").hidden).toBe(true);
    expect(form.el.querySelector(".gate__identity pre").textContent).toContain("git config --global user.email");
  });

  it("trains on Hugging Face Jobs by default without a GPU, here with one", () => {
    const pressed = (form) => form.el.querySelector(".seg button[aria-pressed=true]").dataset.where;
    const without = trainForm({ challenge: CHALLENGE, gpu: false }, { onCommit: vi.fn(), onTrain: vi.fn() });
    without.update({ code: CLEAN, account: IN });
    expect(pressed(without)).toBe("hf-jobs");
    expect(without.el.querySelector(".seg button[data-where=local]").disabled).toBe(true);
    expect(without.el.querySelector(".where-hint").textContent).toBe("One L4 GPU, billed to alice.");
    const withGpu = trainForm({ challenge: CHALLENGE, gpu: true }, { onCommit: vi.fn(), onTrain: vi.fn() });
    withGpu.update({ code: CLEAN, account: IN });
    expect(pressed(withGpu)).toBe("local");
  });

  it("keeps Train shut while the chosen place is not available", () => {
    const form = trainForm({ challenge: CHALLENGE, gpu: false }, { onCommit: vi.fn(), onTrain: vi.fn() });
    form.update({ code: CLEAN, account: { phase: "out" } });
    expect(form.el.querySelector(".train-go").disabled).toBe(true);
    expect(form.el.querySelector(".where-hint").textContent).toContain("Log in");
  });

  it("folds the rewards and the recipe away, each in its own section", () => {
    const form = trainForm({ challenge: CHALLENGE, gpu: false }, { onCommit: vi.fn(), onTrain: vi.fn() });
    const settings = form.el.querySelector("details.settings");
    expect(settings.open).toBe(false);
    expect([...settings.querySelectorAll("h4")].map((h) => h.firstChild.textContent.trim())).toEqual(["Rewards", "Recipe"]);
    expect(settings.querySelector(".rewards [name=forward_reward]")).not.toBeNull();
    expect(settings.querySelector(".recipe [name=max_slope_deg]")).not.toBeNull();
    expect(settings.querySelector(".recipe [name=num_envs]").value).toBe("4096");
  });

  it("trains with what the form holds", async () => {
    const onTrain = vi.fn(async () => {});
    const form = trainForm({ challenge: CHALLENGE, gpu: false }, { onCommit: vi.fn(), onTrain });
    form.update({ code: CLEAN, account: IN });
    form.el.querySelector("input[name=run]").value = "first";
    form.el.querySelector(".train-go").click();
    await Promise.resolve();
    expect(onTrain).toHaveBeenCalledWith({
      name: "first", where: "hf-jobs",
      recipe: { num_envs: 4096, max_iterations: 3000, seed: 1 },
      params: { forward_reward: 2, max_slope_deg: 10 },
    });
  });
});
```

Create `app/src/workshop/tickets.test.js`:

```js
import { describe, expect, it, vi } from "vitest";
import { bars, officialTime, summary, ticketCard } from "./tickets.js";

const row = (n, score, finished = 5, status = "evaluated") => ({ n, status, score, seeds_finished: finished, seeds_total: 5, command_vx: 0.55 });
const TICKET = {
  id: "first", name: "first", where: "hf-jobs", state: "running", progress: { done: 1250, total: 3000 },
  started: "2026-09-30T09:15:00+00:00", run_id: "2026-09-30_09-15-00_first", dirty: false,
  checkpoints: [row(0, 50, 0), row(250, 8.1), row(500, 5.62), { n: 750, status: "queued" }], best: 500, published: null,
};

describe("a ticket", () => {
  it("draws a bar per checkpoint: the higher, the faster; the best starred", () => {
    const drawn = [...bars(TICKET.checkpoints, 500).children];
    expect(drawn.map((b) => b.className)).toEqual(["dnf", "", "best", "queued"]);
    expect(drawn[2].style.height).toBe("100%");
    expect(drawn[1].style.height).toBe("69%");
  });

  it("says its best, or what it is waiting for", () => {
    expect(summary(TICKET, false).textContent).toBe("Best: checkpoint 500 · 5.62 s · 5/5");
    expect(summary({ ...TICKET, best: null }, true).textContent).toBe("Evaluating checkpoints: 3 of 4 done.");
    expect(summary({ ...TICKET, checkpoints: [], state: "failed" }, false).textContent).toContain("Stopped with an error");
    expect(summary({ ...TICKET, checkpoints: [row(0, 50, 0)], best: null }, false).textContent).toBe("No checkpoint finishes yet.");
  });

  it("reads the official time from the entry's line", () => {
    expect(officialTime("entered on sprint-2m: 4.892 s (5/5 seeds) at 0.55 m/s")).toBe("4.89 s");
  });

  it("leads to its job page, says where it runs and how far it is, and stops after a confirm", () => {
    const onStop = vi.fn();
    const card = ticketCard(TICKET, { event: "sprint-2m", voted: false, onStop });
    expect(card.getAttribute("href")).toBe("#/c/sprint-2m/j/first");
    expect(card.querySelector(".sticker").textContent).toBe("Training");
    expect(card.querySelector(".ticket__top .mono-label").textContent).toBe("HF Jobs · L4");
    expect(card.querySelector(".progress span").textContent).toBe("1250 / 3000");
    expect(card.querySelector(".ticket__pub").textContent).toBe("Not published");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    card.querySelector(".ticket__stop").click();
    expect(onStop).toHaveBeenCalledWith("first");
  });

  it("a finished ticket has no Stop and says it is published", () => {
    const card = ticketCard({ ...TICKET, state: "done", progress: null, published: { entered: "entered on sprint-2m: 4.892 s (5/5 seeds) at 0.55 m/s" } },
      { event: "sprint-2m", voted: false, onStop: vi.fn() });
    expect(card.querySelector(".ticket__stop")).toBeNull();
    expect(card.querySelector(".progress")).toBeNull();
    expect(card.querySelector(".ticket__pub").textContent).toBe("★ Published · 4.89 s on the Arena");
  });

  it("a run from a shell says so", () => {
    const card = ticketCard({ ...TICKET, where: null, state: "done" }, { event: "sprint-2m", voted: false, onStop: vi.fn() });
    expect(card.querySelector(".ticket__top .mono-label").textContent).toBe("From a shell");
  });
});
```

Create `app/src/workshop/challenge.test.js`:

```js
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getCode: vi.fn(async () => ({ fork: null, changes: [], identity: true, commit: "abc1234", unpushed: 0 })),
  commitCode: vi.fn(),
  train: vi.fn(async () => ({})),
  getJobs: vi.fn(async () => []),
  stopJob: vi.fn(),
}));
vi.mock("./api.js", () => api);

import { POLL_MS, mountChallenge } from "./challenge.js";

const SPRINT = { id: "sprint-2m", title: "2 m Sprint", status: "open", category: "race", vote: null, metric: "time",
  length_m: 2, slope_deg: 0, rig: "legs", sweep_lo: 0.2, sweep_hi: 1.2, sweep_count: 21 };
const STATUS = { arena: "https://arena.test", gpu: false, challenges: [
  { event: SPRINT, folder: "sprint_2m", task: "S", recipe: { num_envs: 4096, max_iterations: 3000, seed: 1 }, knobs: [], running: 0 }] };
const account = { get: () => ({ phase: "in", user: "alice", canPay: true }), logIn: vi.fn(), check: vi.fn() };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("a challenge's page", () => {
  it("heads with the challenge, says which files make it yours, and lists its trainings", async () => {
    api.getJobs.mockResolvedValue([{ id: "first", name: "first", where: "hf-jobs", state: "running", progress: null,
      started: "", run_id: null, dirty: false, checkpoints: [], best: null, published: null }]);
    const root = document.createElement("div");
    const page = await mountChallenge(root, { status: STATUS, account, route: { view: "challenge", event: "sprint-2m" } });
    expect(root.querySelector(".racetitle").textContent).toBe("2 m Sprint");
    expect(root.querySelector(".raceback").getAttribute("href")).toBe("#/");
    expect(root.querySelector(".yours .terminal-bar").textContent).toContain("sprint_2m");
    expect(root.querySelector(".yours").textContent).toContain("rewards.py");
    expect(root.querySelector(".racecaveat a").href).toBe("https://arena.test/#/e/sprint-2m");
    expect(root.querySelectorAll(".ticket")).toHaveLength(1);
    expect(root.querySelector(".trainings-head .mono-label").textContent).toBe("1 run · 1 training now");
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(api.getJobs).toHaveBeenCalledTimes(2);
    page.leave();
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(api.getJobs).toHaveBeenCalledTimes(2);
  });

  it("says so for a challenge that is not open here", async () => {
    const root = document.createElement("div");
    await mountChallenge(root, { status: STATUS, account, route: { view: "challenge", event: "moon-landing" } });
    expect(root.querySelector(".failed").textContent).toContain("moon-landing");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd app && npx vitest run src/workshop`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement**

Append to `app/src/workshop/api.js`:

```js
const challengeUrl = (event) => `/api/workshop/challenges/${encodeURIComponent(event)}`;
const jobUrl = (event, id) => `${challengeUrl(event)}/jobs/${encodeURIComponent(id)}`;

export const commitCode = (message) => post("/api/workshop/code/commit", { message });
export const train = (event, body) => post(`${challengeUrl(event)}/train`, body);
export const getJobs = (event) => json(`${challengeUrl(event)}/jobs`).then((body) => body.jobs);
export const stopJob = (event, id) => post(`${jobUrl(event, id)}/stop`);
```

Create `app/src/workshop/trainform.js`:

```js
// The form that launches a training. It stays locked until the checkout is committed — a training
// starts from a commit, so its job records exactly the code that trained it — then asks where to
// train and under which name; the rewards and the recipe are folded away.

import { el } from "./dom.js";

const two = (n) => String(n).padStart(2, "0");
const RECIPE = [["num_envs", "Robots in parallel", 1], ["max_iterations", "Iterations", 1], ["seed", "Seed", 0]];
const IDENTITY = 'git config --global user.name "Your Name"\ngit config --global user.email you@example.com';

export function runName(now = new Date()) {
  return `run-${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}`;
}

export function revisionMessage(event, now = new Date()) {
  const day = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
  return `${event} training revision ${day} ${two(now.getHours())}:${two(now.getMinutes())}`;
}

/** Why a place to train is not available, or null when it is. */
export function unavailable(where, { account, gpu }) {
  if (where === "local") return gpu ? null : "No NVIDIA GPU on this machine: train on Hugging Face Jobs.";
  if (account.phase === "checking") return "Checking your Hugging Face account…";
  if (account.phase === "unreachable") return "Hugging Face is unreachable: check your connection.";
  if (account.phase !== "in") return "Log in to Hugging Face first (top right).";
  if (!account.canPay) return "Hugging Face Jobs need a payment method: see Ready to train on the home page.";
  return null;
}

function knobField(knob) {
  const label = el("label", "knob", knob.label);
  const shown = el("output", "", Number(knob.value).toFixed(1));
  // step "any": a stepped range would snap an exact value written in challenge.toml.
  const input = Object.assign(el("input"), { type: "range", name: knob.name, min: knob.min, max: knob.max, step: "any", value: knob.value });
  input.addEventListener("input", () => { shown.textContent = Number(input.value).toFixed(1); });
  label.append(shown, input);
  return label;
}

function recipeField([key, text, min], value) {
  const label = el("label", "recipe-row", text);
  label.append(Object.assign(el("input"), { type: "number", name: key, min, step: 1, value }));
  return label;
}

export function trainForm({ challenge, gpu }, { onCommit, onTrain }) {
  const event = challenge.event.id;
  const card = el("div", "panel train-panel");
  card.innerHTML = `
    <h3 class="panel__title">New training</h3>
    <div class="gate" hidden>
      <p class="gate__say"></p>
      <ul class="gate__files"></ul>
      <label class="field">Message <input name="message" spellcheck="false" /></label>
      <div class="gate__identity" hidden><p class="hint">Git needs your name on commits first. In a terminal:</p><pre></pre></div>
      <button class="button gate__go" type="button">Commit</button>
      <p class="note gate__note"></p>
    </div>
    <p class="committed" hidden></p>
    <fieldset class="form">
      <div class="field"><span class="field__name">Train on</span>
        <div class="seg"><button type="button" data-where="hf-jobs">Hugging Face Jobs</button><button type="button" data-where="local">This machine</button></div>
        <p class="hint where-hint"></p></div>
      <label class="field">Run name <input name="run" spellcheck="false" maxlength="40" /></label>
      <details class="settings"><summary>Settings</summary>
        <h4>Rewards <small>how much each behaviour pays</small></h4><div class="rewards"></div>
        <h4>Recipe <small>how long and how wide</small></h4><div class="recipe"></div></details>
      <button class="button train-go" type="button">Train</button>
      <p class="note train-note"></p>
    </fieldset>`;
  const $ = (selector) => card.querySelector(selector);
  $(".gate__identity pre").textContent = IDENTITY;
  $("input[name=run]").value = runName();
  for (const knob of challenge.knobs.filter((k) => k.group === "reward")) $(".rewards").append(knobField(knob));
  for (const row of RECIPE) $(".recipe").append(recipeField(row, challenge.recipe[row[0]]));
  for (const knob of challenge.knobs.filter((k) => k.group !== "reward")) $(".recipe").append(knobField(knob));

  let where = gpu ? "local" : "hf-jobs";
  let latest = null; // { code, account }
  let pending = false;

  const values = () => {
    const field = (name) => $(`fieldset [name="${name}"]`).value;
    return {
      name: field("run").trim(), where,
      recipe: Object.fromEntries(RECIPE.map(([key]) => [key, Number.parseInt(field(key), 10)])),
      params: Object.fromEntries(challenge.knobs.map((k) => [k.name, Number.parseFloat(field(k.name))])),
    };
  };
  const say = (selector, text, bad = false) => {
    $(selector).textContent = text;
    $(selector).classList.toggle("bad", bad);
  };

  function draw() {
    const { code, account } = latest;
    const dirty = code.changes.length > 0;
    $(".gate").hidden = !dirty;
    $(".committed").hidden = dirty;
    $(".committed").textContent = `✓ All committed · ${code.commit}`;
    $("fieldset").disabled = dirty;
    if (dirty) {
      const n = code.changes.length;
      $(".gate__say").textContent = `${n} file${n === 1 ? "" : "s"} changed since your last commit. Commit them first: the job will record exactly this code.`;
      $(".gate__files").replaceChildren(...code.changes.map((c) => {
        const li = el("li");
        li.append(el("span", "", c.status), c.path);
        return li;
      }));
      if (!$("input[name=message]").value) $("input[name=message]").value = revisionMessage(event);
      $(".gate__identity").hidden = code.identity;
      $(".gate__go").hidden = !code.identity;
      $(".gate__go").disabled = pending;
    }
    for (const button of card.querySelectorAll(".seg button")) {
      const reason = unavailable(button.dataset.where, { account, gpu });
      button.setAttribute("aria-pressed", String(button.dataset.where === where));
      button.disabled = Boolean(reason);
      button.title = reason ?? "";
    }
    const blocked = unavailable(where, { account, gpu });
    say(".where-hint", blocked ?? (where === "local" ? "Trains on this machine's NVIDIA GPU." : `One L4 GPU, billed to ${account.user}.`), Boolean(blocked));
    $(".train-go").disabled = dirty || pending || Boolean(blocked);
  }

  for (const button of card.querySelectorAll(".seg button")) {
    button.addEventListener("click", () => {
      where = button.dataset.where;
      draw();
    });
  }
  $(".gate__go").addEventListener("click", async () => {
    pending = true;
    draw();
    say(".gate__note", "");
    try {
      await onCommit($("input[name=message]").value.trim());
      $("input[name=message]").value = "";
    } catch (error) {
      say(".gate__note", error.message, true);
    } finally {
      pending = false;
      draw();
    }
  });
  $(".train-go").addEventListener("click", async () => {
    pending = true;
    draw();
    say(".train-note", "Committing the settings and starting…");
    try {
      await onTrain(values());
      say(".train-note", "");
      $("input[name=run]").value = runName();
    } catch (error) {
      say(".train-note", error.message, true);
    } finally {
      pending = false;
      draw();
    }
  });

  return {
    el: card,
    update(next) {
      latest = next;
      draw();
    },
  };
}
```

Create `app/src/workshop/tickets.js`:

```js
// One training as a ticket on its challenge's wall: its state, where it runs, how far it is, a bar per
// checkpoint (the higher, the faster), its best, whether it is published — and Stop while it runs.
// The job page draws its checkpoints with the same bars.

import { el } from "./dom.js";
import { jobHref } from "./routes.js";

const STICKERS = {
  starting: ["Starting", "sticker-lime"], running: ["Training", "sticker-lime"],
  done: ["Done", "sticker-paper"], stopped: ["Stopped", "sticker-paper"], failed: ["Failed", "sticker-magenta"],
};
export const WHERE = { "hf-jobs": "HF Jobs · L4", local: "This machine" };

export const seconds = (s) => `${s.toFixed(2)} s`;

export function describe(c) {
  if (c.status === "queued") return `Checkpoint ${c.n}: not evaluated yet`;
  if (c.status === "failed") return `Checkpoint ${c.n}: could not be evaluated`;
  if (!c.seeds_finished) return `Checkpoint ${c.n}: no seed finishes`;
  return `Checkpoint ${c.n}: ${seconds(c.score)}, ${c.seeds_finished}/${c.seeds_total} seeds`;
}

/** A bar per checkpoint, as tall as its speed against the fastest; `future` adds the empty slots still to come. */
export function bars(checkpoints, best, { future = [], selected = null, onPick = null } = {}) {
  let fastest = Infinity;
  for (const c of checkpoints) if (c.status === "evaluated" && c.seeds_finished > 0 && c.score < fastest) fastest = c.score;
  const row = el("div", "bars");
  for (const c of checkpoints) {
    const bar = el("i");
    if (c.status === "queued") bar.className = "queued";
    else if (c.status === "failed") bar.className = "failed";
    else if (!c.seeds_finished) bar.className = "dnf";
    else {
      bar.style.height = `${Math.max(6, Math.round((fastest / c.score) * 100))}%`;
      if (c.n === best) bar.className = "best";
    }
    if (c.n === selected) bar.classList.add("sel");
    bar.title = describe(c);
    if (onPick && c.status !== "queued") {
      bar.tabIndex = 0;
      bar.setAttribute("role", "button");
      bar.addEventListener("click", () => onPick(c.n));
      bar.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick(c.n);
        }
      });
    }
    row.append(bar);
  }
  for (const n of future) {
    const slot = el("span", "slot");
    slot.title = `Checkpoint ${n}: not saved yet`;
    row.append(slot);
  }
  return row;
}

/** The ticket's line about its checkpoints: its best, or what it is waiting for. */
export function summary(ticket, voted) {
  const line = el("p", "ticket__line");
  const rows = ticket.checkpoints;
  const best = rows.find((c) => c.n === ticket.best);
  if (!voted && best) {
    line.append(`Best: checkpoint ${best.n} · `, el("b", "", seconds(best.score)), ` · ${best.seeds_finished}/${best.seeds_total}`);
    return line;
  }
  line.classList.add("ticket__muted");
  const queued = rows.filter((c) => c.status === "queued").length;
  if (!rows.length) line.textContent = ticket.state === "failed" ? "Stopped with an error. Open it for the whole output." : "No checkpoint yet.";
  else if (queued) line.textContent = `Evaluating checkpoints: ${rows.length - queued} of ${rows.length} done.`;
  else line.textContent = voted ? `${rows.length} checkpoints evaluated: pick one to publish.` : "No checkpoint finishes yet.";
  return line;
}

/** "entered on sprint-2m: 4.892 s (5/5 seeds) at 0.55 m/s" → "4.89 s". */
export function officialTime(entered) {
  const found = /: ([\d.]+) s/.exec(entered ?? "");
  return found ? seconds(Number(found[1])) : entered;
}

export function progress({ done, total }) {
  const bar = el("div", "progress");
  const fill = el("i");
  fill.style.width = `${Math.min(100, Math.round((done / total) * 100))}%`;
  bar.append(fill, el("span", "", `${done} / ${total}`));
  return bar;
}

export function ticketCard(ticket, { event, voted, onStop }) {
  const running = ticket.state === "starting" || ticket.state === "running";
  const card = el("a", `ticket${running ? " ticket--running" : ""}${ticket.state === "failed" ? " ticket--failed" : ""}`);
  card.href = jobHref(event, ticket.id);
  const [word, colour] = STICKERS[ticket.state];
  const top = el("div", "ticket__top");
  top.append(el("span", `sticker ${colour}`, word), el("span", "mono-label", WHERE[ticket.where] ?? "From a shell"));
  card.append(el("span", "flyer-tape"), top, el("h4", "ticket__name", ticket.name));
  if (running && ticket.progress) card.append(progress(ticket.progress));
  if (ticket.checkpoints.length) card.append(bars(ticket.checkpoints, voted ? null : ticket.best));
  card.append(summary(ticket, voted));
  card.append(ticket.published
    ? el("p", "ticket__pub ticket__pub--yes", `★ Published · ${officialTime(ticket.published.entered)} on the Arena`)
    : el("p", "ticket__pub", "Not published"));
  if (running) {
    // A span, not a button: the whole card is a link, and a button may not sit inside one.
    const stop = el("span", "quiet ticket__stop", "Stop");
    stop.setAttribute("role", "button");
    stop.tabIndex = 0;
    stop.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (window.confirm(`Stop ${ticket.name}? A stopped Hugging Face job cannot be resumed.`)) onStop(ticket.id);
    });
    card.append(stop);
  }
  return card;
}
```

Create `app/src/workshop/challenge.js`:

```js
// One challenge: how to make its training yours, the form that launches one, and one ticket per
// training, redrawn every few seconds (the tickets fill in as checkpoints are saved and evaluated).

import { formatEventFacts } from "../format.js";
import { dress } from "../router.js";
import { footer } from "../signage.js";
import * as api from "./api.js";
import { el } from "./dom.js";
import { accountChip, strip } from "./header.js";
import { homeHref } from "./routes.js";
import { ticketCard } from "./tickets.js";
import { trainForm } from "./trainform.js";

export const POLL_MS = 3000;

const FILES = [
  ["challenge.toml", "the reward weights and the recipe (the form's Settings edit them)"],
  ["env.py", "the whole training: rewards, commands, randomisation, terrain"],
  ["rewards.py", "your own reward terms: create it, then add them to cfg.rewards in env.py"],
];

function yours(folder) {
  const box = el("div", "yours");
  const say = el("p");
  say.append(el("b", "", "Make it yours."), " Change a reward or write your own in these files, with your editor. "
    + "Each training starts from a commit, so every job remembers exactly what trained it.");
  const terminal = el("div", "terminal");
  terminal.append(el("div", "terminal-bar mono-label", `microduck-challenges / src / microduck_challenges / ${folder}`));
  const body = el("div", "terminal-body");
  for (const [file, what] of FILES) {
    const line = el("div", "yours__line");
    line.append(el("b", "", file), el("span", "", what));
    body.append(line);
  }
  terminal.append(body);
  box.append(say, terminal);
  return box;
}

function head(challenge, arena) {
  const { event } = challenge;
  const box = el("div", "head");
  if (event.category) box.append(el("p", "raceeyebrow", event.category.toUpperCase()));
  box.append(el("h2", "racetitle", event.title));
  const facts = el("dl", "facts");
  for (const fact of formatEventFacts(event)) {
    const pair = el("div");
    pair.append(el("dt", "", fact.label), el("dd", "", fact.value));
    facts.append(pair);
  }
  const caveat = el("p", "racecaveat", event.metric === "votes" ? "" : "The Arena races your duck at every speed of the sweep and keeps its best. ");
  const board = el("a", "help-link", "See the board on the Arena ↗");
  Object.assign(board, { href: `${arena}/#/e/${event.id}`, target: "_blank", rel: "noopener" });
  caveat.append(board);
  box.append(facts, caveat, yours(challenge.folder));
  return box;
}

export async function mountChallenge(root, { status, account, route }) {
  dress("race"); // trackside, as the Arena's challenge page
  const slot = el("span");
  const drawAccount = () => slot.replaceChildren(accountChip(account.get(), { onLogIn: account.logIn, onRetry: account.check }));
  const hall = el("main", "hall");
  const back = el("a", "raceback", "Back to the challenges");
  back.href = homeHref;
  hall.append(back);
  root.replaceChildren(strip(slot), hall, footer());
  drawAccount();
  const challenge = status.challenges.find((c) => c.event.id === route.event);
  if (!challenge) {
    hall.append(el("p", "failed", `${route.event} is not a challenge open here.`));
    return { leave() {}, accountChanged: drawAccount };
  }
  const event = challenge.event.id;
  const voted = challenge.event.metric === "votes";
  let code = await api.getCode();

  const side = el("aside", "side");
  const count = el("span", "mono-label");
  const heading = el("div", "trainings-head");
  heading.append(el("h3", "", "Your trainings"), count);
  const wall = el("div", "tickets");
  const body = el("section", "body");
  body.append(heading, wall);
  const grid = el("div", "wsgrid");
  grid.append(head(challenge, status.arena), side, body);
  hall.append(grid);

  const form = trainForm({ challenge, gpu: status.gpu }, {
    onCommit: async (message) => {
      code = await api.commitCode(message);
      redrawForm();
    },
    onTrain: async (values) => {
      await api.train(event, values);
      code = await api.getCode();
      redrawForm();
      await refresh();
    },
  });
  side.append(form.el);
  function redrawForm() {
    form.update({ code, account: account.get() });
  }
  redrawForm();

  async function onStop(id) {
    try {
      await api.stopJob(event, id);
    } catch (error) {
      window.alert(error.message);
    }
    await refresh();
  }

  async function refresh() {
    try {
      const [jobs, latest] = await Promise.all([api.getJobs(event), api.getCode()]);
      code = latest; // files edited meanwhile lock the form again
      redrawForm();
      const running = jobs.filter((t) => t.state === "starting" || t.state === "running").length;
      count.textContent = `${jobs.length} run${jobs.length === 1 ? "" : "s"}${running ? ` · ${running} training now` : ""}`;
      wall.replaceChildren(...(jobs.length
        ? jobs.map((ticket) => ticketCard(ticket, { event, voted, onStop }))
        : [el("p", "tickets__empty", "No training yet: the first one starts from the form.")]));
    } catch (error) {
      count.textContent = `Lost touch with the workshop: ${error.message}`;
    }
  }
  await refresh();
  const timer = setInterval(refresh, POLL_MS);

  return {
    leave() {
      clearInterval(timer);
    },
    accountChanged() {
      drawAccount();
      redrawForm();
    },
  };
}
```

In `app/src/workshop/main.js`: `import { mountChallenge } from "./challenge.js";` and `const MOUNTS = { home: mountHome, challenge: mountChallenge };`.

Append to `app/public/workshop.css`:

```css
/* ── a challenge's page: the head and the tickets on the left, the form in the entry column ─ */
.wsgrid {
  display: grid; grid-template-columns: minmax(0, 1fr) 19rem; grid-template-areas: "head side" "body side";
  gap: 0 var(--space-title-to-grid-max); align-items: start;
}
.wsgrid > .head { grid-area: head; }
.wsgrid > .side { grid-area: side; }
.wsgrid > .body { grid-area: body; }
.racecaveat .help-link { color: var(--ink); }

/* Make it yours: the challenge's files, in the charter's terminal. */
.yours { max-width: 46rem; margin: 6px 0 28px; }
.yours p { margin: 0 0 10px; font-size: 0.95rem; }
.yours .terminal-body { white-space: normal; font-size: 0.8rem; line-height: 1.75; }
.yours__line { display: grid; grid-template-columns: 9rem 1fr; gap: 0 12px; }
.yours__line b { color: var(--yellow); font-weight: 600; }

/* The form: the entry column's cream card. */
.panel {
  display: flex; flex-direction: column; gap: 12px; padding: 16px; background: var(--cream);
  border: 2px solid var(--ink); box-shadow: var(--shadow-sticker-max) var(--shadow-sticker-max) var(--shadow-blur) var(--ink);
}
.panel__title { margin: 0; font-family: var(--display); font-weight: 400; font-size: 1.6rem; line-height: 1; text-transform: uppercase; }
.panel .field { display: flex; flex-direction: column; gap: 4px; font-size: 0.85rem; font-weight: 600; }
.panel input:not([type]), .panel input[type=url], .panel textarea {
  padding: 7px 9px; border: 2px solid var(--ink); background: var(--paper); font: inherit; font-weight: 400; font-size: 0.9rem;
}
.panel textarea { min-height: 6.5rem; resize: vertical; }
.panel .button { align-self: stretch; padding: 10px 14px; font-size: 1.35rem; text-align: center; }
.panel .button:disabled { background: var(--warm-paper); color: var(--ink-70); box-shadow: none; cursor: not-allowed; }
.gate { display: flex; flex-direction: column; gap: 8px; padding: 12px; background: var(--paper); border: 2px dashed var(--ink); }
.gate__say { margin: 0; font-size: 0.85rem; }
.gate__files { margin: 0; padding: 0; list-style: none; font-family: var(--mono); font-size: 0.75rem; line-height: 1.6; color: var(--sky-inked); overflow-wrap: anywhere; }
.gate__files span { display: inline-block; width: 1.8em; color: var(--orange-inked); font-weight: 700; }
.gate__identity pre { margin: 4px 0 0; padding: 8px; background: var(--deep-ink); color: var(--sky); font-family: var(--mono); font-size: 0.72rem; white-space: pre-wrap; }
.committed { margin: 0; font-size: 0.8rem; font-weight: 600; color: var(--lime-inked); }
fieldset.form { display: flex; flex-direction: column; gap: 12px; margin: 0; padding: 0; border: 0; }
fieldset.form:disabled { opacity: 0.4; }
.seg { display: flex; flex-wrap: wrap; gap: 8px; }
.seg button {
  flex: 1; padding: 6px 8px; border: 2px solid var(--ink); background: var(--paper); cursor: pointer;
  font-family: var(--type-sticker-family); font-size: 0.8rem; letter-spacing: var(--type-sticker-tracking); text-transform: uppercase;
  box-shadow: var(--shadow-sticker-min) var(--shadow-sticker-min) 0 var(--ink);
}
.seg button[aria-pressed=true] { background: var(--yellow); }
.seg button:disabled { opacity: 0.45; cursor: not-allowed; box-shadow: none; }
details.settings summary, details.output summary {
  cursor: pointer; color: var(--orange-inked); font-family: var(--type-eyebrow-family); font-weight: var(--type-eyebrow-weight);
  font-size: var(--type-eyebrow-size); letter-spacing: var(--type-eyebrow-tracking); text-transform: uppercase;
}
details.settings[open] summary { margin-bottom: 10px; }
.settings h4 { margin: 12px 0 6px; font-family: var(--display); font-weight: 400; font-size: 1.05rem; letter-spacing: 0.02em; text-transform: uppercase; }
.settings h4 small { margin-left: 6px; font-family: var(--body); font-size: 0.72rem; letter-spacing: 0; text-transform: none; color: var(--ink-70); }
.knob { display: grid; grid-template-columns: 1fr 2.4rem; gap: 2px 8px; align-items: center; margin-bottom: 6px; font-size: 0.82rem; font-weight: 400; }
.knob input { grid-column: 1 / -1; width: 100%; accent-color: var(--orange); }
.knob output { grid-row: 1; grid-column: 2; justify-self: end; font-family: var(--mono); font-size: 0.78rem; }
.recipe-row { display: grid; grid-template-columns: 1fr 5.5rem; gap: 8px; align-items: center; margin-bottom: 6px; font-size: 0.82rem; font-weight: 400; }
.recipe-row input { width: 100%; padding: 4px 6px; border: 2px solid var(--ink); background: var(--paper); font-family: var(--mono); font-size: 0.8rem; }

/* The tickets: one taped paper card per training. */
.trainings-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 6px 16px; margin: 8px 0 22px; }
.trainings-head h3 { margin: 0; font-family: var(--display); font-weight: 400; font-size: 1.9rem; text-transform: uppercase; }
.tickets { display: grid; grid-template-columns: repeat(auto-fill, minmax(15.5rem, 1fr)); gap: 34px 26px; }
.tickets__empty { margin: 0; color: var(--ink-70); }
.ticket {
  position: relative; display: flex; flex-direction: column; gap: 9px; padding: 22px 16px 14px; background: var(--paper);
  border: 2px solid var(--ink); color: var(--ink); text-decoration: none;
  box-shadow: var(--shadow-card-min) var(--shadow-card-min) 0 var(--orange);
}
.ticket:nth-child(odd) { rotate: -0.9deg; }
.ticket:nth-child(even) { rotate: 0.7deg; }
.ticket:hover { translate: 0 -4px; }
.ticket:focus-visible { outline: 3px solid var(--cyan); outline-offset: 3px; }
.ticket .flyer-tape { left: calc(50% - 26px); top: -10px; width: 52px; height: 16px; }
.ticket--running { background: color-mix(in srgb, var(--yellow) 22%, var(--paper)); box-shadow: var(--shadow-card-min) var(--shadow-card-min) 0 var(--lime-inked); }
.ticket--failed { box-shadow: var(--shadow-card-min) var(--shadow-card-min) 0 var(--magenta); }
.ticket__top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ticket__top .sticker { padding: 2px 8px; font-size: 0.66rem; box-shadow: none; cursor: default; }
.ticket__name { margin: 0; font-family: var(--display); font-weight: 400; font-size: 1.45rem; line-height: 1; text-transform: uppercase; overflow-wrap: anywhere; }
.ticket__line { margin: 0; font-size: 0.8rem; }
.ticket__line b { font-family: var(--display); font-weight: 400; font-size: 1.1rem; letter-spacing: 0.02em; }
.ticket__muted { color: var(--ink-70); }
.ticket__pub { margin: 0; font-size: 0.78rem; color: var(--ink-70); }
.ticket__pub--yes { font-weight: 600; color: var(--lime-inked); }
.ticket__stop { position: absolute; right: 12px; bottom: 12px; }
.progress { position: relative; height: 18px; border: 2px solid var(--ink); background: var(--paper); }
.progress i { position: absolute; inset: 0 auto 0 0; background: var(--orange); }
.progress span { position: absolute; inset: 0; display: grid; place-items: center; font-family: var(--mono); font-size: 0.66rem; font-weight: 700; }

/* A bar per checkpoint: the higher, the faster. Magenta stub: no finisher. Hatched: not evaluated yet. */
.bars { display: flex; align-items: flex-end; gap: 3px; height: 34px; padding-bottom: 2px; border-bottom: 2px solid var(--ink); }
.bars i { position: relative; flex: 1; min-height: 3px; background: var(--ink); }
.bars i.dnf, .bars i.failed { height: 3px; background: var(--magenta); }
.bars i.queued { height: 30%; background: repeating-linear-gradient(45deg, var(--ink-70) 0 2px, transparent 2px 5px); }
.bars i.best { background: var(--orange); }
.bars i.best::after { content: "★"; position: absolute; top: -15px; left: 50%; translate: -50% 0; font-size: 0.72rem; color: var(--orange-inked); }
.bars .slot { flex: 1; height: 100%; border: 2px dotted var(--ink-70); border-bottom: 0; opacity: 0.5; }

@media (max-width: 760px) {
  .wsgrid { grid-template-columns: minmax(0, 1fr); grid-template-areas: "head" "side" "body"; gap: 28px; }
  .tickets { grid-template-columns: 1fr; }
  .yours__line { grid-template-columns: 1fr; }
}
```

- [ ] **Step 4: Run the front-end tests and build**

Run: `cd app && npm test` — only the 4 known failures. Run: `cd app && npm run build` — success.

- [ ] **Step 5: See it**

Start the workshop on the real checkout as in Task 10 (port 8766), then:

```bash
cd /private/tmp/claude-501/-Users-nicolasrabault-Projects-HuggingFace-microduck-arena/9f88e57b-22a5-4a4b-b645-cad3b1cd5023/scratchpad && node ws-shot.js "http://127.0.0.1:8766/#/c/sprint-2m" shots/t11-challenge-1280.png 1280 5000 && node ws-shot.js "http://127.0.0.1:8766/#/c/sprint-2m" shots/t11-challenge-420.png 420 5000 && node ws-shot.js "http://127.0.0.1:8766/#/c/sprint-2m" shots/t11-settings-1280.png 1280 5000 --click "details.settings summary"
```

Compare with `shots/mock-ch-1280.png` and `shots/mock-ch-420.png`: the strip, *Back to the challenges*, RACE / 2 M SPRINT and its facts, the *See the board* link, *Make it yours* in the terminal, the cream *New training* card on the right (the gate when the checkout has changes, otherwise *✓ All committed*, *Train on*, *Run name*, *Settings* closed, **Train**), and *Your trainings* with the `reference` and `plan4probe` tickets. At 420 the form comes between the head and the tickets. No `SCROLLS SIDEWAYS`, `pageerror`, `BLOCKED` (nothing is clicked that writes). Stop the server afterwards.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add -A app/src/workshop app/public/workshop.css
/usr/bin/git commit -m "Workshop: a challenge's page with the files to edit, the commit-gated training form and one ticket per training"
```

---

### Task 12: A training's page: the replay, the checkpoints, Publish & compete

**Files:**
- Create: `app/src/workshop/job.js`, `app/src/workshop/publish.js`, `app/src/workshop/job.test.js`, `app/src/workshop/publish.test.js`
- Modify: `app/src/workshop/api.js`, `app/src/workshop/main.js` (`job: mountJob`), `app/public/workshop.css`

**Interfaces:**
- Consumes: `GET …/jobs/{id}?since=N`, `GET …/jobs/{id}/checkpoints/{n}`, `POST …/jobs/{id}/publish`, `POST …/jobs/{id}/stop`, `POST /code/push`, `POST /code/fork` (Tasks 3–7); `tickets.{WHERE, bars, progress, seconds, officialTime}`, `checks.{checkLine, forkGuide}`, `curve.renderCurve`, the Arena's `deck.js`, `viewer.js`, `brightness.js`.
- Produces: `api.getJob(event, id, since)`, `api.getCheckpoint(event, id, n)` (trace decoded, or `{checkpoint, error}`), `api.publishJob(event, id, body)`, `api.pushCode()`; `job.futureSlots(job)`, `job.mountJob(root, {status, account, route})`, `job.POLL_MS = 3000`; `publish.PLACEHOLDER`, `publish.defaultName(folder, run)`, `publish.publishPanel({event, folder}, {onPublish, onPreview, onPush, onUseFork}) -> {el, update({job, code, account, selected})}`.

- [ ] **Step 1: Write the failing tests**

Create `app/src/workshop/publish.test.js`:

```js
import { describe, expect, it, vi } from "vitest";
import { PLACEHOLDER, defaultName, publishPanel } from "./publish.js";

const JOB = { id: "first", name: "first", dirty: false, code_url: null, checkpoints: [] };
const CODE = { fork: "alice/microduck-challenges", changes: [], identity: true, commit: "abc1234", unpushed: 2 };
const IN = { phase: "in", user: "alice", canPay: true };
const handlers = () => ({ onPublish: vi.fn(async () => ({ entered: "entered on sprint-2m: 4.892 s (5/5 seeds) at 0.55 m/s", page_url: "http://arena.test/#/r/x" })),
  onPreview: vi.fn(async () => ({ repo: "alice/microduck-sprint-2m-first", readme: "# card" })), onPush: vi.fn(async () => {}), onUseFork: vi.fn() });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const panel = (on = handlers()) => publishPanel({ event: { id: "sprint-2m", title: "2 m Sprint" }, folder: "sprint_2m" }, on);
const type = (input, value) => {
  input.value = value;
  input.dispatchEvent(new Event("input"));
};

describe("Publish & compete", () => {
  it("names the entry after the challenge and the run, and asks the commentators' question", () => {
    const p = panel();
    p.update({ job: JOB, code: CODE, account: IN, selected: 1000 });
    expect(p.el.querySelector("input[name=policy]").value).toBe("sprint-2m-first");
    expect(defaultName("hill_climb_1m5", "run-0930-0940")).toBe("hill-climb-1m5-run-0930-0940");
    expect(p.el.querySelector("textarea").placeholder).toBe(PLACEHOLDER);
    expect(p.el.querySelector(".booth").textContent).toContain("Peter & Ray read it on air when your duck races.");
  });

  it("waits for a checkpoint, a name and a word for the commentators", () => {
    const p = panel();
    p.update({ job: JOB, code: CODE, account: IN, selected: null });
    const go = p.el.querySelector(".publish__go");
    expect(go.textContent).toBe("Pick a checkpoint");
    expect(go.disabled).toBe(true);
    p.update({ job: JOB, code: CODE, account: IN, selected: 1000 });
    expect(go.textContent).toBe("Publish and compete");
    expect(go.disabled).toBe(true);
    type(p.el.querySelector("textarea"), "It leans into every step.");
    expect(go.disabled).toBe(false);
  });

  it("is shut while logged out", () => {
    const p = panel();
    p.update({ job: JOB, code: CODE, account: { phase: "out" }, selected: 1000 });
    type(p.el.querySelector("textarea"), "x");
    expect(p.el.querySelector(".publish__go").disabled).toBe(true);
  });

  it("holds a dirty run until publish anyway is ticked", () => {
    const p = panel();
    p.update({ job: { ...JOB, dirty: true }, code: CODE, account: IN, selected: 1000 });
    type(p.el.querySelector("textarea"), "x");
    expect(p.el.querySelector(".publish__dirty").hidden).toBe(false);
    expect(p.el.querySelector(".publish__go").disabled).toBe(true);
    p.el.querySelector("input[name=anyway]").checked = true;
    p.el.querySelector("input[name=anyway]").dispatchEvent(new Event("change"));
    expect(p.el.querySelector(".publish__go").disabled).toBe(false);
  });

  it("ticks the fork and offers Push until the run's commit is on it", async () => {
    const on = handlers();
    const p = panel(on);
    p.update({ job: JOB, code: CODE, account: IN, selected: 1000 });
    const [fork, pushed] = p.el.querySelectorAll(".checks > li");
    expect(fork.classList.contains("check--ticked")).toBe(true);
    expect(pushed.classList.contains("check--ticked")).toBe(false);
    expect(pushed.textContent).toContain("2 commits are only on this machine.");
    pushed.querySelector("button").click();
    await Promise.resolve();
    expect(on.onPush).toHaveBeenCalled();
    p.update({ job: { ...JOB, code_url: "https://github.com/alice/microduck-challenges/tree/abc1234" }, code: { ...CODE, unpushed: 0 }, account: IN, selected: 1000 });
    expect(p.el.querySelectorAll(".checks > li")[1].classList.contains("check--ticked")).toBe(true);
    expect(p.el.querySelector(".checks button")).toBeNull();
  });

  it("publishes what is typed, then shows the official time and the entry's page", async () => {
    const on = handlers();
    const p = panel(on);
    p.update({ job: JOB, code: CODE, account: IN, selected: 1000 });
    type(p.el.querySelector("textarea"), "It leans into every step.");
    p.el.querySelector(".publish__go").click();
    await flush();
    expect(on.onPublish).toHaveBeenCalledWith({ checkpoint: 1000, name: "sprint-2m-first", description: "It leans into every step.", allow_dirty: false });
    const result = p.el.querySelector(".result");
    expect(result.hidden).toBe(false);
    expect(result.querySelector("b").textContent).toBe("4.89 s");
    expect(result.querySelector("a").href).toBe("http://arena.test/#/r/x");
  });

  it("shows the whole output of a failure, and the same button tries again", async () => {
    const on = handlers();
    on.onPublish.mockRejectedValueOnce(new Error("[publish] uploaded …, but the Arena did not enter it: 403"));
    const p = panel(on);
    p.update({ job: JOB, code: CODE, account: IN, selected: 1000 });
    type(p.el.querySelector("textarea"), "x");
    p.el.querySelector(".publish__go").click();
    await flush();
    expect(p.el.querySelector(".publish__status").textContent).toContain("did not enter it: 403");
    expect(p.el.querySelector(".publish__go").disabled).toBe(false);
  });

  it("keeps what is typed, and a fork address being typed, across redraws", () => {
    const p = panel();
    p.update({ job: JOB, code: { ...CODE, fork: null }, account: IN, selected: 1000 });
    type(p.el.querySelector("input[name=policy]"), "my-walker");
    type(p.el.querySelector("textarea"), "It leans.");
    p.el.querySelector(".checks input[name=fork]").value = "https://github.com/alice/mi";
    p.update({ job: JOB, code: { ...CODE, fork: null }, account: IN, selected: 1000 });
    expect(p.el.querySelector("input[name=policy]").value).toBe("my-walker");
    expect(p.el.querySelector("textarea").value).toBe("It leans.");
    expect(p.el.querySelector(".checks input[name=fork]").value).toBe("https://github.com/alice/mi");
  });
});
```

Create `app/src/workshop/job.test.js`:

```js
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getJob: vi.fn(),
  getCheckpoint: vi.fn(async (event, id, n) => ({ checkpoint: n, score: 5.62, trace: new Float32Array(8) })),
  getCode: vi.fn(async () => ({ fork: null, changes: [], identity: true, commit: "abc1234", unpushed: 0 })),
  publishJob: vi.fn(),
  pushCode: vi.fn(),
  useFork: vi.fn(),
  stopJob: vi.fn(),
}));
vi.mock("./api.js", () => api);
const viewer = vi.hoisted(() => ({ setLanes: vi.fn(), setBrightness: vi.fn(), dispose: vi.fn(), player: { toggle() {}, playing: true },
  follow() {}, setWallsVisible: () => false, setNamesVisible: () => false }));
vi.mock("../viewer.js", () => ({ createViewer: vi.fn(async () => viewer) }));

import { POLL_MS, futureSlots, mountJob } from "./job.js";

const row = (n, score, finished = 5) => ({ n, status: "evaluated", score, seeds_finished: finished, seeds_total: 5, command_vx: 0.55 });
const JOB = {
  id: "first", name: "first", where: "hf-jobs", state: "running", progress: { done: 1250, total: 3000 },
  started: "2026-09-30T09:15:00+00:00", run_id: "r", dirty: false, job_url: "https://huggingface.co/jobs/alice/j1",
  checkpoints: [row(0, 50, 0), row(250, 8.1), row(500, 5.62), { n: 750, status: "queued" }], best: 500, published: null,
  log: ["$ uv run --no-sync train …"], next: 1, following: true, curve: [[1, 0.1], [2, 0.3]], commit: "abc1234",
  recipe: { num_envs: 4096, max_iterations: 3000, seed: 1 }, params: { forward_reward: 2 }, code_url: null,
};
const SPRINT = { id: "sprint-2m", title: "2 m Sprint", status: "open", category: "race", vote: null, metric: "time", rig: "legs",
  length_m: 2, slope_deg: 0, sweep_lo: 0.2, sweep_hi: 1.2, sweep_count: 21 };
const SWAG = { ...SPRINT, id: "swag-contest", title: "Swag Contest", metric: "votes", vote: { ballot_min: 2 } };
const status = (event) => ({ arena: "https://arena.test", gpu: false, challenges: [{ event, folder: "sprint_2m", task: "S", recipe: {}, knobs: [], running: 1 }] });
const account = { get: () => ({ phase: "in", user: "alice", canPay: true }), logIn: vi.fn(), check: vi.fn() };
const settle = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); };

beforeEach(() => {
  vi.useFakeTimers();
  api.getJob.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("a training's page", () => {
  it("counts the checkpoints still to come from the spacing of those saved", () => {
    expect(futureSlots(JOB)).toEqual([1000, 1250, 1500, 1750, 2000, 2250, 2500, 2750, 2999]);
    expect(futureSlots({ ...JOB, state: "done" })).toEqual([]);
  });

  it("opens a race on its best checkpoint and replays it", async () => {
    api.getJob.mockResolvedValue(JOB);
    const root = document.createElement("div");
    await mountJob(root, { status: status(SPRINT), account, route: { view: "job", event: "sprint-2m", job: "first" } });
    await settle();
    expect(root.querySelector(".racetitle").textContent).toBe("first");
    expect(root.querySelector(".raceeyebrow").textContent).toBe("Training · Hugging Face Jobs · L4");
    expect(root.querySelector(".score__label").textContent).toBe("Checkpoint 500 · ★ best");
    expect(root.querySelector(".score__value").textContent).toBe("5.62 s");
    expect(api.getCheckpoint).toHaveBeenCalledWith("sprint-2m", "first", 500);
    expect(viewer.setLanes).toHaveBeenCalled();
    expect(root.querySelector(".output pre").textContent).toContain("uv run --no-sync train");
  });

  it("a click on a bar replays that checkpoint", async () => {
    api.getJob.mockResolvedValue(JOB);
    const root = document.createElement("div");
    await mountJob(root, { status: status(SPRINT), account, route: { view: "job", event: "sprint-2m", job: "first" } });
    await settle();
    root.querySelectorAll(".ckpts .bars i")[1].click();
    await settle();
    expect(root.querySelector(".score__value").textContent).toBe("8.10 s");
    expect(api.getCheckpoint).toHaveBeenLastCalledWith("sprint-2m", "first", 250);
  });

  it("a voted event opens on no checkpoint", async () => {
    api.getJob.mockResolvedValue({ ...JOB, best: null });
    const root = document.createElement("div");
    await mountJob(root, { status: status(SWAG), account, route: { view: "job", event: "swag-contest", job: "first" } });
    await settle();
    expect(root.querySelector(".score__label").textContent).toBe("No checkpoint chosen");
    expect(root.querySelector(".publish__go").textContent).toBe("Pick a checkpoint");
  });

  it("keeps what is typed while the page redraws every few seconds", async () => {
    // Review focus: the job page polls; the name and the words for the commentators must stay.
    api.getJob.mockResolvedValue(JOB);
    const root = document.createElement("div");
    const page = await mountJob(root, { status: status(SPRINT), account, route: { view: "job", event: "sprint-2m", job: "first" } });
    await settle();
    root.querySelector("input[name=policy]").value = "my-walker";
    root.querySelector("textarea").value = "It leans into every step.";
    api.getJob.mockResolvedValue({ ...JOB, log: ["Learning iteration 1300/3000"], next: 2 });
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(root.querySelector("input[name=policy]").value).toBe("my-walker");
    expect(root.querySelector("textarea").value).toBe("It leans into every step.");
    expect(root.querySelector(".output pre").textContent).toContain("Learning iteration 1300/3000");
    page.leave();
    expect(viewer.dispose).toHaveBeenCalled();
  });

  it("after a restart it links the job's whole log on Hugging Face", async () => {
    api.getJob.mockResolvedValue({ ...JOB, following: false, log: [] });
    const root = document.createElement("div");
    await mountJob(root, { status: status(SPRINT), account, route: { view: "job", event: "sprint-2m", job: "first" } });
    await settle();
    expect(root.querySelector(".output a").href).toBe("https://huggingface.co/jobs/alice/j1");
  });

  it("says so for a training that is not there", async () => {
    api.getJob.mockRejectedValue(new Error("No training nope for sprint-2m."));
    const root = document.createElement("div");
    await mountJob(root, { status: status(SPRINT), account, route: { view: "job", event: "sprint-2m", job: "nope" } });
    expect(root.querySelector(".failed").textContent).toContain("nope");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd app && npx vitest run src/workshop`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement**

Append to `app/src/workshop/api.js`:

```js
export const getJob = (event, id, since = 0) => json(`${jobUrl(event, id)}?since=${since}`);
export const publishJob = (event, id, body) => post(`${jobUrl(event, id)}/publish`, body);
export const pushCode = () => post("/api/workshop/code/push");

/** A checkpoint's stored evaluation, its trace decoded as the viewer takes it; `{checkpoint, error}` when it failed. */
export async function getCheckpoint(event, id, n) {
  const body = await json(`${jobUrl(event, id)}/checkpoints/${n}`);
  if (body.error) return body;
  const bytes = Uint8Array.from(atob(body.trace_b64), (c) => c.charCodeAt(0));
  return { ...body, trace: new Float32Array(bytes.buffer) };
}
```

Create `app/src/workshop/publish.js`:

```js
// Publish & compete: the checkpoint the page has chosen goes to the user's Hugging Face account and is
// entered on the Arena by `uv run publish --enter`. A name, and a word for the commentators, are both
// needed. The fork and the push are ticked above the button: a nudge, not a gate. What is typed stays
// through every redraw of the page.

import { checkLine, forkGuide } from "./checks.js";
import { el } from "./dom.js";
import { officialTime } from "./tickets.js";

export const PLACEHOLDER = "What makes it behave like that? What did you change? Describe what it is doing.";

export function defaultName(folder, run) {
  return `${folder.replaceAll("_", "-")}-${run}`;
}

export function publishPanel({ event, folder }, { onPublish, onPreview, onPush, onUseFork }) {
  const card = el("div", "panel publish");
  card.innerHTML = `
    <h3 class="panel__title">Publish &amp; compete</h3>
    <label class="field">Name <input name="policy" spellcheck="false" /></label>
    <label class="field"><span class="booth"><span class="booth__heads"><img src="/duck-head-mark.webp" alt="" /><img src="/duck-head-mark.webp" alt="" /></span>
      <span class="booth__who"><b>For the commentators</b><span>Peter &amp; Ray read it on air when your duck races.</span></span></span>
      <textarea name="description"></textarea></label>
    <ul class="checks"></ul>
    <p class="publish__dirty" hidden>This run started from uncommitted changes: the code it records is not what trained it.
      <label><input type="checkbox" name="anyway" /> Publish anyway</label></p>
    <div class="actions"><button class="button publish__go" type="button"></button><button class="quiet publish__preview" type="button">Preview the Hub card</button></div>
    <p class="note publish__status"></p>
    <div class="result" hidden></div>
    <pre class="publish__card" hidden></pre>`;
  const $ = (selector) => card.querySelector(selector);
  $("textarea").placeholder = PLACEHOLDER;
  let latest = null; // { job, code, account, selected }
  let pending = false;
  let named = false;
  let checksDrawn = "";

  const values = () => ({
    checkpoint: latest.selected,
    name: $("input[name=policy]").value.trim(),
    description: $("textarea").value.trim(),
    allow_dirty: $("input[name=anyway]").checked,
  });
  const say = (text, bad = false) => {
    $(".publish__status").textContent = text;
    $(".publish__status").classList.toggle("bad", bad);
  };

  function gate() {
    const { job, account, selected } = latest;
    const v = values();
    const go = $(".publish__go");
    go.textContent = selected === null ? "Pick a checkpoint" : "Publish and compete";
    const ready = selected !== null && v.name && v.description;
    go.disabled = pending || !ready || (job.dirty && !v.allow_dirty) || account.phase !== "in";
    $(".publish__preview").disabled = pending || !ready;
  }

  function drawChecks() {
    const { job, code } = latest;
    // Redrawn only when what they say changes: a fork address being typed in the guide stays.
    const key = JSON.stringify([code.fork, code.unpushed, job.code_url]);
    if (key === checksDrawn) return;
    checksDrawn = key;
    let push;
    if (code.fork && !job.code_url) {
      push = el("button", "quiet", "Push");
      push.type = "button";
      push.addEventListener("click", async () => {
        push.disabled = true;
        try {
          await onPush();
        } catch (error) {
          say(error.message, true);
        } finally {
          push.disabled = false;
        }
      });
    }
    const unpushed = code.unpushed === 1 ? "1 commit is only on this machine." : `${code.unpushed} commits are only on this machine.`;
    $(".checks").replaceChildren(
      checkLine({ ticked: Boolean(code.fork), label: "Working in your fork", note: code.fork ?? undefined,
        guide: forkGuide({ onUseFork }), group: "publish" }),
      checkLine({ ticked: Boolean(job.code_url), label: "Pushed to your fork", variant: 1, action: push,
        note: job.code_url ? "Your entry links the code that trained it." : code.unpushed ? unpushed : "Your fork does not hold this run's commit yet." }),
    );
  }

  const held = (call) => async () => {
    pending = true;
    gate();
    try {
      await call();
    } finally {
      pending = false;
      gate();
    }
  };

  $(".publish__go").addEventListener("click", held(async () => {
    say("Exporting, uploading and racing on the Arena (a minute or two)…");
    $(".result").hidden = true;
    try {
      const done = await onPublish(values());
      say("");
      const link = el("a", "", "See it on the Arena ↗");
      Object.assign(link, { href: done.page_url, target: "_blank", rel: "noopener" });
      $(".result").replaceChildren(el("span", "mono-label", `Entered on ${event.title}`), el("b", "", officialTime(done.entered)),
        el("span", "", done.entered), link);
      $(".result").hidden = false;
    } catch (error) {
      say(error.message, true);
    }
  }));
  $(".publish__preview").addEventListener("click", held(async () => {
    try {
      const done = await onPreview(values());
      $(".publish__card").textContent = `${done.repo}\n\n${done.readme}`;
      $(".publish__card").hidden = false;
    } catch (error) {
      say(error.message, true);
    }
  }));
  for (const field of card.querySelectorAll("input[name=policy], textarea")) field.addEventListener("input", gate);
  $("input[name=anyway]").addEventListener("change", gate);

  return {
    el: card,
    update(next) {
      latest = next;
      if (!named) {
        $("input[name=policy]").value = defaultName(folder, next.job.name);
        named = true;
      }
      $(".publish__dirty").hidden = !next.job.dirty;
      drawChecks();
      gate();
    },
  };
}
```

Create `app/src/workshop/job.js`:

```js
// One training: its replay, a bar per checkpoint to choose the one replayed, its curve and its output,
// the chosen checkpoint's score and Publish & compete. Redrawn every few seconds — the tickets fill in
// as checkpoints are saved and evaluated — and what the user typed and chose stays.

import { MIN } from "../brightness.js";
import { deckMarkup, wireDeck } from "../deck.js";
import { dress } from "../router.js";
import { footer } from "../signage.js";
import { createViewer } from "../viewer.js";
import * as api from "./api.js";
import { renderCurve } from "./curve.js";
import { el } from "./dom.js";
import { accountChip, strip } from "./header.js";
import { publishPanel } from "./publish.js";
import { challengeHref, homeHref } from "./routes.js";
import { bars, progress, seconds } from "./tickets.js";

export const POLL_MS = 3000;
const PLACE = { "hf-jobs": "Hugging Face Jobs · L4", local: "This machine" };
const STATE = { starting: "Training", running: "Training", done: "Done", stopped: "Stopped", failed: "Failed" };

/** The checkpoints a running training will still save, from the spacing of those it saved. */
export function futureSlots(job) {
  const ns = job.checkpoints.map((c) => c.n);
  const total = job.progress?.total;
  if (!["starting", "running"].includes(job.state) || !total || ns.length < 2) return [];
  const step = ns[1] - ns[0];
  const slots = [];
  for (let n = ns.at(-1) + step; n < total - 1; n += step) slots.push(n);
  if (ns.at(-1) < total - 1) slots.push(total - 1);
  return slots;
}

function facts(job) {
  const pairs = [["started", job.started ? new Date(job.started).toLocaleString() : "—"], ["code", job.commit ?? "—"]];
  if (job.recipe) pairs.push(["robots", String(job.recipe.num_envs)]);
  const rewards = Object.entries(job.params ?? {}).filter(([name]) => name.endsWith("_reward"));
  if (rewards.length) pairs.push(["rewards", rewards.map(([name, value]) => `${name.replace(/_reward$/, "")} ${value}`).join(" · ")]);
  const list = el("dl", "facts");
  for (const [label, value] of pairs) {
    const pair = el("div");
    pair.append(el("dt", "", label), el("dd", "", value));
    list.append(pair);
  }
  return list;
}

function notFound(hall, route, challenge) {
  const back = el("a", "raceback", challenge ? `Back to ${challenge.event.title}` : "Back to the challenges");
  back.href = challenge ? challengeHref(route.event) : homeHref;
  hall.append(back, el("p", "failed", `There is no training ${route.job} here.`));
}

export async function mountJob(root, { status, account, route }) {
  dress("race"); // trackside, as the Arena's pages with a stage
  const slot = el("span");
  const drawAccount = () => slot.replaceChildren(accountChip(account.get(), { onLogIn: account.logIn, onRetry: account.check }));
  const hall = el("main", "hall");
  root.replaceChildren(strip(slot), hall, footer());
  drawAccount();
  const challenge = status.challenges.find((c) => c.event.id === route.event);
  let job = challenge ? await api.getJob(route.event, route.job).catch(() => null) : null;
  if (!job) {
    notFound(hall, route, challenge);
    return { leave() {}, accountChanged: drawAccount };
  }
  const event = challenge.event;
  const voted = event.metric === "votes";
  let code = await api.getCode();
  let since = job.next;
  let selected = voted ? null : job.best;
  const evaluations = new Map(); // checkpoint -> stored evaluation; only successes: a missing one may come
  let viewer = null;
  let deck = null;
  let left = false;

  hall.innerHTML = `
    <a class="raceback"></a>
    <div class="racegrid">
      <div class="job-main">
        <p class="raceeyebrow"></p>
        <h2 class="racetitle"></h2>
        <div class="job-facts"></div>
        <div class="job-progress"></div>
        ${deckMarkup}
        <div class="ckpts">
          <div class="section-label"><p class="eyebrow">Checkpoints</p><span class="hint">The higher, the faster. Click one to watch it.</span></div>
          <div class="ckpts__bars"></div>
          <div class="ticks"></div>
        </div>
        <div class="section-label"><p class="eyebrow">Training</p><span class="hint">Mean reward per iteration</span></div>
        <figure class="curve"></figure>
        <details class="output"><summary>Output</summary><div class="output__body"></div></details>
        <p class="note job-note"></p>
      </div>
      <div class="entry-col">
        <div class="figure score"><span class="mono-label score__label"></span><span class="figure-value score__value"></span>
          <span class="mono-label score__seeds"></span><p class="score__caveat">Indicative: only the Arena times an entry.</p></div>
        <div class="publish-slot"></div>
        <button class="quiet job-stop" type="button" hidden>Stop this training</button>
      </div>
    </div>`;
  const $ = (selector) => hall.querySelector(selector);
  $(".raceback").href = challengeHref(event.id);
  $(".raceback").textContent = `Back to ${event.title}`;
  $(".racetitle").textContent = job.name;
  $("#stage-hint").textContent = voted ? "Pick a checkpoint below to watch it." : "";
  const log = el("pre", "terminal-body");

  const panel = publishPanel({ event, folder: challenge.folder }, {
    onPublish: (values) => api.publishJob(event.id, job.id, values),
    onPreview: (values) => api.publishJob(event.id, job.id, { ...values, dry_run: true }),
    onPush: async () => {
      code = await api.pushCode();
      await refresh();
    },
    onUseFork: async (url) => {
      code = await api.useFork(url);
      draw();
    },
  });
  $(".publish-slot").append(panel.el);

  function appendLog(lines) {
    if (!lines.length) return;
    const atEnd = log.scrollTop + log.clientHeight >= log.scrollHeight - 4;
    log.textContent += `${lines.join("\n")}\n`;
    if (atEnd) log.scrollTop = log.scrollHeight;
  }

  function drawOutput() {
    const body = $(".output__body");
    if (job.following) {
      if (!body.contains(log)) {
        const terminal = el("div", "terminal");
        terminal.append(log);
        body.replaceChildren(terminal);
      }
      return;
    }
    const note = el("p", "hint");
    if (job.job_url) {
      const link = el("a", "", "See its whole log on Hugging Face ↗");
      Object.assign(link, { href: job.job_url, target: "_blank", rel: "noopener" });
      note.append("This workshop does not follow this job now. ", link);
    } else {
      note.textContent = "No output here: this workshop did not start this training, or was closed since.";
    }
    body.replaceChildren(note);
  }

  function drawScore() {
    const [label, value, seeds] = [$(".score__label"), $(".score__value"), $(".score__seeds")];
    if (selected === null) {
      label.textContent = "No checkpoint chosen";
      value.textContent = "—";
      seeds.textContent = "Pick one in the checkpoints.";
      return;
    }
    const row = job.checkpoints.find((c) => c.n === selected);
    label.textContent = `Checkpoint ${selected}${!voted && selected === job.best ? " · ★ best" : ""}`;
    if (!row || row.status === "queued") {
      value.textContent = "…";
      seeds.textContent = "Not evaluated yet.";
    } else if (row.status === "failed") {
      value.textContent = "Failed";
      seeds.textContent = "It could not be evaluated.";
    } else {
      value.textContent = row.seeds_finished ? seconds(row.score) : "No finish";
      seeds.textContent = `${row.seeds_finished}/${row.seeds_total} seeds${row.seeds_finished ? ` · at ${row.command_vx.toFixed(2)} m/s` : ""}`;
    }
  }

  function draw() {
    const running = job.state === "starting" || job.state === "running";
    $(".raceeyebrow").textContent = `${STATE[job.state]} · ${PLACE[job.where] ?? "From a shell"}`;
    $(".job-facts").replaceChildren(facts(job));
    $(".job-progress").replaceChildren(...(running && job.progress ? [progress(job.progress)] : []));
    const future = futureSlots(job);
    $(".ckpts__bars").replaceChildren(bars(job.checkpoints, voted ? null : job.best, { future, selected, onPick: pick }));
    $(".ticks").replaceChildren(...[...job.checkpoints.map((c) => c.n), ...future].map((n) => el("span", n === selected ? "sel" : "", String(n))));
    $(".ckpts").hidden = !job.checkpoints.length;
    renderCurve($(".curve"), job.curve);
    drawOutput();
    drawScore();
    $(".job-stop").hidden = !running;
    panel.update({ job, code, account: account.get(), selected });
  }

  async function play(body) {
    if (!viewer) {
      const made = await createViewer(hall.querySelector("#stage"), { rig: event.rig });
      if (left) {
        made.dispose();
        return;
      }
      viewer = made;
      viewer.setBrightness(MIN);
      deck = wireDeck(hall, viewer);
    }
    viewer.setLanes([{ runId: null, trace: body.trace, tier: "trial", livery: "classic", name: `checkpoint ${body.checkpoint}` }], event);
    deck.reset();
    $("#stage-hint").textContent = `Checkpoint ${body.checkpoint} · its best seed`;
  }

  async function pick(n) {
    selected = n;
    draw();
    const row = job.checkpoints.find((c) => c.n === n);
    if (!row || row.status !== "evaluated") return;
    let body = evaluations.get(n);
    if (!body) {
      try {
        body = await api.getCheckpoint(event.id, job.id, n);
      } catch {
        return;
      }
      if (body.error) return;
      evaluations.set(n, body);
    }
    if (!left && selected === n) await play(body);
  }

  async function refresh() {
    try {
      const [next, latest] = await Promise.all([api.getJob(event.id, job.id, since), api.getCode()]);
      appendLog(next.log);
      since = next.next;
      const bestAppeared = !voted && selected === null && next.best !== null;
      job = next;
      code = latest;
      $(".job-note").textContent = "";
      draw();
      if (bestAppeared) await pick(job.best);
    } catch (error) {
      $(".job-note").textContent = `Lost touch with the workshop: ${error.message}`;
    }
  }

  $(".job-stop").addEventListener("click", async () => {
    if (!window.confirm(`Stop ${job.name}? A stopped Hugging Face job cannot be resumed.`)) return;
    try {
      await api.stopJob(event.id, job.id);
    } catch (error) {
      window.alert(error.message);
    }
    await refresh();
  });

  appendLog(job.log);
  draw();
  if (selected !== null) await pick(selected);
  const timer = setInterval(refresh, POLL_MS);

  return {
    leave() {
      left = true;
      clearInterval(timer);
      viewer?.dispose();
    },
    accountChanged() {
      drawAccount();
      draw();
    },
  };
}
```

In `app/src/workshop/api.js`, `stopJob` and `useFork` already exist (Tasks 10 and 11). In `app/src/workshop/main.js`: `import { mountJob } from "./job.js";` and `const MOUNTS = { home: mountHome, challenge: mountChallenge, job: mountJob };`.

Append to `app/public/workshop.css`:

```css
/* ── a training's page ─ */
.job-progress .progress { max-width: 26rem; margin: 0 0 18px; }
.ckpts { margin: 22px 0 0; }
.ckpts .bars { height: 110px; gap: 6px; }
.ckpts .bars i[role=button] { cursor: pointer; }
.ckpts .bars i.sel { outline: 3px solid var(--cyan); outline-offset: 2px; }
.ticks { display: flex; gap: 6px; margin-top: 4px; }
.ticks span { flex: 1; text-align: center; font-family: var(--mono); font-size: 0.6rem; color: var(--ink-70); }
.ticks span.sel { font-weight: 700; color: var(--ink); }
.section-label { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 12px; margin: 26px 0 8px; }
.section-label .eyebrow { margin: 0; }
.curve { margin: 0; border: 2px solid var(--ink); background: var(--paper); color: var(--orange); }
.curve svg { display: block; width: 100%; height: 90px; }
.curve figcaption { padding: 4px 8px; font-size: 0.7rem; color: var(--ink-70); }
details.output summary { margin: 26px 0 8px; }
.output .terminal-body { max-height: 22rem; overflow: auto; white-space: pre-wrap; }
.score { display: flex; flex-direction: column; gap: 6px; }
.score .figure-value { font-size: 2.6rem; }
.score__caveat { margin: 0; font-size: 0.75rem; color: var(--paper-60); }
.job-stop { align-self: flex-start; }

/* Publish & compete: the commentators' badge, the two checks, the result. */
.booth { display: flex; align-items: center; gap: 10px; margin-bottom: 2px; }
.booth__heads { display: flex; }
.booth__heads img { width: 36px; }
/* Ray, facing Peter, in his blue, as they sit in the booth. */
.booth__heads img + img { margin-left: -8px; transform: scaleX(-1); filter: hue-rotate(185deg) saturate(1.3); }
.booth__who { display: flex; flex-direction: column; line-height: 1.15; }
.booth__who b { font-family: var(--display); font-weight: 400; font-size: 1rem; letter-spacing: 0.02em; text-transform: uppercase; }
.booth__who span { font-size: 0.74rem; font-weight: 400; color: var(--ink-70); }
.checks { gap: 8px; margin-top: 2px; }
.checks .check { font-size: 0.88rem; line-height: 1.3; }
.checks .check--plain, .checks .check__row { grid-template-columns: 24px 1fr auto; gap: 8px; align-items: center; }
.checks .box { width: 22px; height: 22px; margin: 0; }
.checks .check__note { font-size: 0.74rem; }
.checks .guide { margin-left: 32px; font-size: 0.8rem; }
.publish__dirty { margin: 0; font-size: 0.8rem; color: var(--orange-inked); }
.actions { display: flex; flex-direction: column; gap: 10px; }
.actions .quiet { align-self: center; }
.result { display: flex; flex-direction: column; gap: 4px; padding: 12px; background: var(--lime); border: 2px solid var(--ink); }
.result b { font-family: var(--display); font-weight: 400; font-size: 1.8rem; line-height: 1; }
.result a { font-size: 0.85rem; font-weight: 600; color: var(--ink); }
.publish__card { margin: 0; max-height: 16rem; overflow: auto; padding: 10px; background: var(--paper); border: 2px solid var(--ink); font-family: var(--mono); font-size: 0.7rem; white-space: pre-wrap; }
```

- [ ] **Step 4: Run the front-end tests and build**

Run: `cd app && npm test` — only the 4 known failures. Run: `cd app && npm run build` — success.

- [ ] **Step 5: See it**

Start the workshop on the real checkout as in Task 10 (port 8766); let its evaluator run a few minutes so `reference` has evaluated checkpoints. Then:

```bash
cd /private/tmp/claude-501/-Users-nicolasrabault-Projects-HuggingFace-microduck-arena/9f88e57b-22a5-4a4b-b645-cad3b1cd5023/scratchpad && node ws-shot.js "http://127.0.0.1:8766/#/c/sprint-2m/j/2026-09-25_22-06-24_reference" shots/t12-job-1280.png 1280 12000 && node ws-shot.js "http://127.0.0.1:8766/#/c/sprint-2m/j/2026-09-25_22-06-24_reference" shots/t12-job-420.png 420 12000 && node ws-shot.js "http://127.0.0.1:8766/#/c/sprint-2m/j/2026-09-25_22-06-24_reference" shots/t12-preview-1280.png 1280 12000 --click "textarea" --click ".publish__preview"
```

(The preview click is a dry run; the driver lets it through and blocks anything else.) Compare with `shots/job-v3.png` and `shots/job-v2-420.png`: the strip, *Back to 2 m Sprint*, the eyebrow and the run's name, the facts, the stage replaying the best checkpoint, the bars with their iterations, the curve, *Output* folded, the score figure, the cream *Publish & compete* card with the commentators' badge, the two checks and the orange **Publish and compete**. No `SCROLLS SIDEWAYS`, `pageerror`; `BLOCKED` must not appear (the preview is a dry run). Stop the server afterwards.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add -A app/src/workshop app/public/workshop.css
/usr/bin/git commit -m "Workshop: a training's page with its replay, a bar per checkpoint, its curve and output, and Publish & compete"
```

---

### Task 13: The guides say what the workshop is now, and the whole journey is rehearsed

**Files:**
- Modify: `docs/guides/train-a-policy.md` (Arena)
- Modify: `README.md` of microduck-challenges (worktree `~/Projects/HuggingFace/microduck-challenges/.claude/worktrees/plan4-workshop`, branch `plan4-workshop`)

- [ ] **Step 1: The Arena's guide**

In `docs/guides/train-a-policy.md`, replace the numbered list under "## The workshop" (and the sentence that introduces it) with:

```markdown
Open a challenge and copy the line under **Train my own robot** into a terminal. It clones
[microduck-challenges](https://github.com/pollen-robotics/microduck-challenges) and opens the
workshop in your browser, on that challenge:

1. **Ready to train?**, on the workshop's home, says what is set up: Hugging Face Jobs billing,
   your fork of the challenges, an NVIDIA GPU. Log in to Hugging Face with the button at the top
   right: it opens huggingface.co, where you approve.
2. **New training**, on the challenge's page: change the challenge's files if you like, commit them
   (the workshop asks), choose Hugging Face Jobs or this machine, and train. Each training gets a
   ticket; several can run at once.
3. **Every checkpoint is evaluated** with this Arena's rules, on your machine, as it arrives. The
   time is indicative: only the Arena times an entry.
4. Open a ticket, pick a checkpoint, and **Publish and compete**: the policy goes to your Hugging
   Face account and is entered here, with a word for the commentators, and its result opens.
```

Keep the "## From a shell" section as it is. Run `cd app && npx vitest run src/guides.test.js` — PASS.

- [ ] **Step 2: The challenges' README**

In the challenges worktree's `README.md`, replace the paragraph starting "It works in the clone you run it in" with:

```markdown
It works in the clone you run it in (or clones this repo next to you) and opens the workshop in your
browser, on that challenge. Its home says what is set up (Hugging Face Jobs billing, your fork, an
NVIDIA GPU) and lists the challenges. A challenge's page says which files to change, commits them
before each training, trains on your NVIDIA GPU or on Hugging Face Jobs, and keeps one ticket per
training: every checkpoint is evaluated with the Arena's own rules as it arrives. A training's page
replays any checkpoint, and **Publish and compete** publishes the policy to your Hugging Face account
**and enters** it on the Arena, then opens its result. From a clone, `uv run --group workshop workshop`
opens the home and `uv run --group workshop workshop sprint-2m` opens one challenge.
```

Commit it there:

```bash
cd ~/Projects/HuggingFace/microduck-challenges/.claude/worktrees/plan4-workshop && /usr/bin/git add README.md && /usr/bin/git commit -m "README: the workshop's home, a page per challenge with tickets, and Publish and compete"
```

- [ ] **Step 3: The whole suites, in the foreground**

Run: `uv run --no-config --frozen --extra dev pytest -q -m "not network"` (one foreground call, `timeout: 600000`; if it does not finish in time, run `tests/workshop` and the rest as two calls).
Expected: PASS.

Run: `cd app && npm test` — only the 4 known failures. Run: `cd app && npm run build` — success.

- [ ] **Step 4: Rehearse the journey on the real checkout, nothing written outside this machine**

Start the workshop as in Task 10 (port 8766) and capture, at 1280 and 420: the home (`/`), the home with the fork guide open (`--click "details[name=ready]:nth-of-type(1) summary"` or the second line's summary), `#/c/sprint-2m`, `#/c/sprint-2m` with Settings open, `#/c/hill-climb-1m5`, `#/c/swag-contest` (a voted event: its tickets show no best), and the `reference` and `plan4probe` job pages. Read every capture; each page must match its mockup and the Arena's look, with no `SCROLLS SIDEWAYS`, no `pageerror`, no `BLOCKED` unless a click was meant to be blocked. Note in the report what, if anything, still differs from the mockups. Stop the server afterwards.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add docs/guides/train-a-policy.md
/usr/bin/git commit -m "Guide: the workshop's home, a page per challenge with tickets, and Publish and compete"
```

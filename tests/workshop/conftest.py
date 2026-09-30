"""The workshop's world, played locally: a microduck-challenges checkout in a temp dir, GitHub as
bare repos (https://github.com/<owner>/<name> is rewritten to them with url.insteadOf), and fake
`uv` on a PATH that holds nothing else — a symlink stands in for the real git, so a machine's
other neighbours of git (an nvidia-smi on a training box, say) are never picked up."""

import base64
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from arena.assets import ASSET_ROOT
from arena.constants import RUNNER_VERSION, TRACE_WIDTH

# Imported here, at collection time, while PATH is still whatever the developer's shell gives it:
# arena.workshop.app pulls in mujoco, which probes `sysctl` on macOS at import time. The `fakes`
# fixture later narrows PATH to only the fake-tool bin dir; importing this module for the first time
# under that PATH (e.g. running tests/workshop/test_training.py alone) would make that probe fail.
from arena.workshop.app import create_workshop_app
from arena.workshop.challenges import open_challenges
from arena.workshop.hub import Account, HubUnreachable

HERE = Path(__file__).resolve().parent
PROBE = HERE.parent / "fixtures" / "workshop" / "events.out.tfevents.probe"
REFERENCE = ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx"
UPSTREAM = "https://github.com/pollen-robotics/microduck-challenges"
PORT = 8765
ADDRESS = f"http://127.0.0.1:{PORT}"  # where the workshop serves, as its page's requests name it

SPRINT = """\
# The 2 m Sprint.
event = "sprint-2m"
task  = "Mjlab-Sprint2m-MicroDuck"
kind  = "perpetual"

[recipe]                  # the first training, as is
num_envs       = 4096
max_iterations = 3000
seed           = 1

[params.forward_reward]
label = "Follow the speed order"
value = 2.0
min   = 0.5
max   = 5.0
"""


def git(root, *args) -> str:
    return subprocess.run(["git", *args], cwd=root, check=True, capture_output=True, text=True).stdout.strip()


def wait_for(predicate, timeout=10.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if found := predicate():
            return found
        time.sleep(0.05)
    raise AssertionError("timed out waiting")


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


@pytest.fixture
def remotes(tmp_path):
    base = tmp_path / "github"
    upstream = base / "pollen-robotics" / "microduck-challenges"
    upstream.mkdir(parents=True)
    subprocess.run(["git", "init", "-q", "--bare", str(upstream)], check=True)
    return base


@pytest.fixture
def checkout(tmp_path, remotes):
    root = tmp_path / "microduck-challenges"
    folder = root / "src" / "microduck_challenges" / "sprint_2m"
    folder.mkdir(parents=True)
    (folder / "challenge.toml").write_text(SPRINT)
    (root / ".gitignore").write_text("logs/\npublish-*/\n")
    git(root, "init", "-q", "-b", "main")
    git(root, "config", "user.email", "novice@example.com")
    git(root, "config", "user.name", "Novice")
    git(root, "config", f"url.file://{remotes}/.insteadOf", "https://github.com/")
    git(root, "remote", "add", "origin", UPSTREAM)
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "the challenges")
    git(root, "push", "-q", "-u", "origin", "main")
    return root


@pytest.fixture
def fakes(tmp_path, monkeypatch):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    target = bin_dir / "uv"
    target.write_text(f"#!{sys.executable}\n" + (HERE / "fake_uv.py").read_text())
    target.chmod(0o755)
    (bin_dir / "git").symlink_to(shutil.which("git"))
    monkeypatch.setenv("PATH", str(bin_dir))
    log = tmp_path / "uv-calls.jsonl"
    monkeypatch.setenv("FAKE_UV_LOG", str(log))
    monkeypatch.setenv("FAKE_HUB", str(tmp_path / "hub"))
    monkeypatch.setenv("FAKE_UV_TFEVENTS", str(PROBE))
    monkeypatch.setenv("FAKE_UV_ONNX", str(REFERENCE))

    def gpu():
        smi = bin_dir / "nvidia-smi"
        smi.write_text("#!/bin/sh\nexit 0\n")
        smi.chmod(0o755)

    def calls(command=None):
        rows = [json.loads(line)["argv"] for line in log.read_text().splitlines()] if log.exists() else []
        return [argv for argv in rows if command is None or argv[2] == command]

    return SimpleNamespace(bin=bin_dir, gpu=gpu, calls=calls)


class FakeHub:
    def __init__(self, user="alice"):
        self.user = user
        self.can_pay = True
        self.reachable = True
        self.cancelled = []
        self.stages = {}  # job id -> what inspect_job says; RUNNING when not set
        self.asked = []  # every job id job_stage was asked of, in order

    def whoami(self):
        if not self.reachable:
            raise HubUnreachable("https://huggingface.co did not answer within 5 s")
        return Account(self.user, self.can_pay) if self.user else None

    def job_stage(self, job_id, namespace):
        self.asked.append(job_id)
        if not self.reachable:
            raise HubUnreachable("https://huggingface.co did not answer within 5 s")
        return self.stages.get(job_id, "RUNNING")

    def cancel_job(self, job_id, namespace):
        self.cancelled.append((job_id, namespace))


@pytest.fixture
def hub():
    return FakeHub()


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

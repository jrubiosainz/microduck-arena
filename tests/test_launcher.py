"""The one line: `uv run <arena>/workshop.py <challenge>`. The Arena serves the launcher with its
own address written in, and the launcher clones (or reuses) the challenges repo and hands over
to `uv run workshop` there. git and uv are played by fakes that record what they were asked."""

import json
import os
import subprocess
import sys

import pytest
from fastapi.testclient import TestClient

from arena.web.app import create_app
from arena.web.config import ArenaConfig
from arena.web.routes_launcher import DEFAULT, LAUNCHER

REPO = "https://github.com/pollen-robotics/microduck-challenges"


@pytest.fixture
def api(tmp_path):
    return TestClient(create_app(ArenaConfig.from_env(store_dir=tmp_path / "board", dev_user="coralie")),
                      base_url="https://testserver")


def test_it_is_served_as_python_with_this_arenas_address(api):
    response = api.get("/workshop.py")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/x-python")
    assert "ARENA = 'https://testserver'" in response.text
    compile(response.text, "workshop.py", "exec")


def test_on_a_space_the_public_address_is_written_in(tmp_path, monkeypatch):
    monkeypatch.setenv("SPACE_HOST", "example.hf.space")
    api = TestClient(create_app(ArenaConfig.from_env(store_dir=tmp_path / "board", dev_user="coralie")))
    assert "ARENA = 'https://example.hf.space'" in api.get("/workshop.py").text


def test_the_template_carries_the_line_the_server_replaces():
    assert DEFAULT in LAUNCHER.read_text()


FAKE = r'''#!{python}
import json, os, sys
from pathlib import Path
with open(os.environ["FAKE_LOG"], "a") as log:
    log.write(json.dumps({{"tool": "{tool}", "argv": sys.argv[1:], "cwd": os.getcwd(),
                          "hf_token": os.environ.get("HF_TOKEN"),
                          "virtual_env": os.environ.get("VIRTUAL_ENV")}}) + "\n")
if "{tool}" == "git" and sys.argv[1] == "clone":
    (Path(sys.argv[3]) / "src" / "microduck_challenges").mkdir(parents=True)
'''


def _launch(tmp_path, cwd, *args, env=None):
    """Run the launcher as served by an Arena at http://arena.test, with fake git and uv."""
    fakes = tmp_path / "bin"
    fakes.mkdir(exist_ok=True)
    for tool in ("git", "uv"):
        (fakes / tool).write_text(FAKE.format(python=sys.executable, tool=tool))
        (fakes / tool).chmod(0o755)
    script = tmp_path / "workshop.py"
    script.write_text(LAUNCHER.read_text().replace(DEFAULT, "ARENA = 'http://arena.test'"))
    log = tmp_path / "calls.jsonl"
    base = {k: v for k, v in os.environ.items() if k not in ("HF_TOKEN", "HF_HOME")}
    full_env = {**base, "PATH": f"{fakes}{os.pathsep}/usr/bin:/bin", "FAKE_LOG": str(log),
                "HF_HOME": str(tmp_path / "no-hf"), **(env or {})}
    subprocess.run([sys.executable, str(script), *args], cwd=cwd, env=full_env, check=True)
    return [json.loads(line) for line in log.read_text().splitlines()]


def test_from_an_empty_folder_it_clones_then_opens_the_workshop_in_the_clone(tmp_path):
    here = tmp_path / "here"
    here.mkdir()
    git, uv = _launch(tmp_path, here, "sprint-2m")
    assert git["argv"] == ["clone", REPO, str(here / "microduck-challenges")]
    assert uv["argv"] == ["run", "--frozen", "--group", "workshop", "workshop", "sprint-2m", "--arena", "http://arena.test"]
    assert os.path.realpath(uv["cwd"]) == os.path.realpath(here / "microduck-challenges")


def test_a_clone_already_there_is_reused_as_is(tmp_path):
    here = tmp_path / "here"
    (here / "microduck-challenges" / "src" / "microduck_challenges").mkdir(parents=True)
    calls = _launch(tmp_path, here, "sprint-2m")
    assert [c["tool"] for c in calls] == ["uv"]


def test_inside_a_clone_it_works_in_place(tmp_path):
    clone = tmp_path / "my-fork"
    (clone / "src" / "microduck_challenges").mkdir(parents=True)
    (uv,) = _launch(tmp_path, clone, "hill-climb-1m5", "--no-browser")
    assert os.path.realpath(uv["cwd"]) == os.path.realpath(clone)
    assert uv["argv"][5:] == ["hill-climb-1m5", "--no-browser", "--arena", "http://arena.test"]


def test_the_saved_hub_token_reaches_uv(tmp_path):
    """While the Arena wheel is on a private Hub repo, uv needs HF_TOKEN to install it."""
    hf_home = tmp_path / "hf"
    hf_home.mkdir()
    (hf_home / "token").write_text("hf_saved\n")
    clone = tmp_path / "clone"
    (clone / "src" / "microduck_challenges").mkdir(parents=True)
    (uv,) = _launch(tmp_path, clone, "sprint-2m", env={"HF_HOME": str(hf_home)})
    assert uv["hf_token"] == "hf_saved"


def test_uv_does_not_inherit_the_scripts_throwaway_environment(tmp_path):
    """`uv run <url>` sets VIRTUAL_ENV to the script's own environment; passed on, the `uv run`
    in the checkout warns that it does not match .venv — the first thing a novice would read."""
    clone = tmp_path / "clone"
    (clone / "src" / "microduck_challenges").mkdir(parents=True)
    (uv,) = _launch(tmp_path, clone, "sprint-2m", env={"VIRTUAL_ENV": str(tmp_path / "throwaway")})
    assert uv["virtual_env"] is None

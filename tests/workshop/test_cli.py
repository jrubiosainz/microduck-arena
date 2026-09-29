"""`uv run workshop` lists the challenges open in this checkout; `uv run workshop <id>` opens one."""

import os
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from arena.workshop import cli
from tests.workshop.conftest import wait_for


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def test_with_no_challenge_it_lists_the_open_ones(checkout, monkeypatch, capsys):
    monkeypatch.chdir(checkout)
    assert cli.main([]) == 0
    assert "uv run --group workshop workshop sprint-2m" in capsys.readouterr().out


def test_an_unknown_challenge_is_refused_with_the_list(checkout, monkeypatch, capsys):
    monkeypatch.chdir(checkout)
    assert cli.main(["moon-landing"]) == 2
    out = capsys.readouterr()
    assert "moon-landing" in out.err and "workshop sprint-2m" in out.out


def test_outside_a_checkout_it_says_where_to_run_it(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    assert cli.main(["sprint-2m"]) == 2
    assert "microduck-challenges" in capsys.readouterr().err


def test_a_challenge_opens_the_workshop_on_it(checkout, monkeypatch):
    served = {}
    port = _free_port()
    monkeypatch.chdir(checkout)
    monkeypatch.setattr("uvicorn.Server.run", lambda server: served.update(
        app=server.config.app, host=server.config.host, port=server.config.port))
    assert cli.main(["sprint-2m", "--arena", "http://127.0.0.1:8000/", "--no-browser", "--port", str(port)]) == 0
    workshop = served["app"].state.workshop
    assert workshop.challenge.event == "sprint-2m"
    assert workshop.arena == "http://127.0.0.1:8000"
    assert served["port"] == port and served["host"] == "127.0.0.1"
    # It answers at the address it serves on, and only there.
    assert TestClient(served["app"], base_url=f"http://127.0.0.1:{port}").get("/api/workshop/nothing").status_code == 404
    assert TestClient(served["app"], base_url="http://127.0.0.1:1").get("/api/workshop/nothing").status_code == 403


def test_the_folder_name_works_too(checkout, monkeypatch):
    served = {}
    monkeypatch.chdir(checkout)
    monkeypatch.setattr("uvicorn.Server.run", lambda server: served.update(app=server.config.app))
    assert cli.main(["sprint_2m", "--no-browser", "--port", str(_free_port())]) == 0
    assert served["app"].state.workshop.challenge.event == "sprint-2m"


def test_the_address_is_printed_at_once_even_into_a_pipe(checkout, monkeypatch):
    """Piped (| tee, a log file), stdout is block-buffered: unflushed, the address would show at exit."""
    printed = []
    monkeypatch.chdir(checkout)
    monkeypatch.setattr("builtins.print", lambda *args, **kw: printed.append((args, kw)))
    monkeypatch.setattr("uvicorn.Server.run", lambda server: None)
    assert cli.main(["sprint-2m", "--no-browser", "--port", str(_free_port())]) == 0
    (flush,) = [kw.get("flush") for args, kw in printed if "http://127.0.0.1:" in str(args[0])]
    assert flush is True


def test_a_busy_port_is_said_and_no_browser_is_opened(checkout, monkeypatch, capsys):
    timers = []
    monkeypatch.chdir(checkout)
    monkeypatch.setattr(cli.threading, "Timer", lambda *args: timers.append(args) or SimpleNamespace(start=lambda: None))
    monkeypatch.setattr("uvicorn.Server.run", lambda server: pytest.fail("served on a busy port"))
    with socket.socket() as open_already:
        open_already.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)  # as uvicorn's own socket
        open_already.bind(("127.0.0.1", 0))
        open_already.listen()
        port = open_already.getsockname()[1]
        assert cli.main(["sprint-2m", "--port", str(port)]) == 2
    assert capsys.readouterr().err.strip() == f"Port {port} is busy — is a workshop already open? Try --port"
    assert timers == []


@pytest.mark.parametrize("sig", [signal.SIGINT, signal.SIGTERM], ids=["ctrl-c", "sigterm"])
def test_a_signal_closes_the_workshop_at_once_while_a_request_waits_on_the_network(checkout, fakes, sig):
    """uvicorn waits, without limit, for the requests still running before it stops, and Python then
    for their threads: one stuck on an unreachable Hub kept the workshop open until kill -9."""
    port = _free_port()
    with socket.socket() as silent:  # a Hub that accepts the connection and never answers
        silent.bind(("127.0.0.1", 0))
        silent.listen()
        env = {**os.environ, "PATH": f"{fakes.bin}{os.pathsep}/usr/sbin{os.pathsep}/usr/bin{os.pathsep}/bin",
               "HF_ENDPOINT": f"http://127.0.0.1:{silent.getsockname()[1]}", "HF_TOKEN": "hf_x"}
        workshop = subprocess.Popen(
            [sys.executable, "-c", "import sys; from arena.workshop.cli import main; sys.exit(main(sys.argv[1:]))",
             "sprint-2m", "--no-browser", "--port", str(port)], cwd=checkout, env=env)
        try:
            address = f"http://127.0.0.1:{port}"
            wait_for(lambda: _answers(f"{address}/api/workshop/status"), timeout=60)
            waiting = threading.Thread(target=_answers, args=(f"{address}/api/workshop/hub",), daemon=True)
            waiting.start()
            time.sleep(0.5)
            assert waiting.is_alive()  # the request is held by the silent Hub
            workshop.send_signal(sig)
            assert workshop.wait(timeout=2) == 128 + sig
        finally:
            workshop.kill()


def _answers(url: str) -> bool:
    try:
        urllib.request.urlopen(url, timeout=30).read()
        return True
    except OSError:
        return False

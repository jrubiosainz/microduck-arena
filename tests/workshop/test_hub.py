"""Who is logged in to Hugging Face, asked with a time limit: a Hub that never answers is said to be
unreachable within seconds, not after the system's own connect timeout."""

import json
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest
from huggingface_hub import constants

from arena.workshop import hub as hub_module
from arena.workshop.hub import Hub, HubUnreachable


@pytest.fixture
def endpoint(monkeypatch):
    """The Hub at a local address; `answer` is what its /api/whoami-v2 replies."""
    answer = {"status": 200, "body": {"name": "alice"}}

    class WhoAmI(BaseHTTPRequestHandler):
        def do_GET(self):
            assert self.path == "/api/whoami-v2" and self.headers["Authorization"] == "Bearer hf_x"
            self.send_response(answer["status"])
            self.end_headers()
            self.wfile.write(json.dumps(answer["body"]).encode())

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), WhoAmI)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    monkeypatch.setattr(constants, "ENDPOINT", f"http://127.0.0.1:{server.server_port}")
    monkeypatch.setenv("HF_TOKEN", "hf_x")
    yield answer
    server.shutdown()


def test_the_logged_in_account_is_named(endpoint):
    assert Hub().whoami() == "alice"


def test_a_refused_token_is_logged_out(endpoint):
    endpoint.update(status=401, body={"error": "Invalid credentials"})
    assert Hub().whoami() is None


def test_without_a_token_it_is_logged_out(monkeypatch, tmp_path):
    monkeypatch.delenv("HF_TOKEN", raising=False)
    monkeypatch.setattr(constants, "HF_TOKEN_PATH", str(tmp_path / "no-token"))
    assert Hub().whoami() is None


def test_a_hub_that_errs_is_unreachable(endpoint):
    endpoint.update(status=503, body={"error": "down"})
    with pytest.raises(HubUnreachable, match="503"):
        Hub().whoami()


def test_a_hub_that_never_answers_is_unreachable_within_the_limit(monkeypatch):
    monkeypatch.setattr(hub_module, "WHOAMI_TIMEOUT_S", 0.3)
    monkeypatch.setenv("HF_TOKEN", "hf_x")
    with socket.socket() as silent:  # the kernel accepts the connection; nothing ever answers
        silent.bind(("127.0.0.1", 0))
        silent.listen()
        monkeypatch.setattr(constants, "ENDPOINT", f"http://127.0.0.1:{silent.getsockname()[1]}")
        started = time.monotonic()
        with pytest.raises(HubUnreachable):
            Hub().whoami()
    assert time.monotonic() - started < 2


def test_the_limit_covers_the_whole_call_not_each_step(monkeypatch):
    """httpx's timeout applies to each address in turn, and huggingface.co has several: on a network
    that drops them all, one whoami took half a minute."""
    import httpx

    monkeypatch.setattr(hub_module, "WHOAMI_TIMEOUT_S", 0.3)
    monkeypatch.setenv("HF_TOKEN", "hf_x")
    monkeypatch.setattr(httpx, "get", lambda *args, **kwargs: time.sleep(5))
    started = time.monotonic()
    with pytest.raises(HubUnreachable):
        Hub().whoami()
    assert time.monotonic() - started < 2

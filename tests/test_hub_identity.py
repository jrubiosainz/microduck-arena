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

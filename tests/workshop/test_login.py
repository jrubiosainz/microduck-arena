"""Logging in from the page: the workshop runs `hf auth login`, which without a terminal takes
huggingface_hub's browser flow, and opens the URL it prints. No token is pasted anywhere."""

import os
import threading

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


def test_two_logins_at_once_do_not_end_each_other(workshop, fakes, monkeypatch):
    """A double click or two tabs: both requests answer, neither killed by the other."""
    monkeypatch.setenv("FAKE_HF_LOGIN_S", "30")
    responses = [None, None]

    def start(i):
        responses[i] = workshop.post("/api/workshop/login")

    threads = [threading.Thread(target=start, args=(i,)) for i in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    for response in responses:
        assert response.status_code == 200, response.text
        assert response.json() == {"url": URL, "code": "WDJB-MJHT"}
    assert workshop.get("/api/workshop/login").json()["state"] == "waiting"
    workshop.app.state.workshop.login.end()


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

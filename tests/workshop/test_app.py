"""The page's server: what it says about the checkout and the machine, before anything runs."""

import pytest

from arena.workshop.app import create_workshop_app
from tests.workshop.conftest import ADDRESS, PORT, git


def test_status_names_the_challenge_its_recipe_knobs_and_event(workshop):
    body = workshop.get("/api/workshop/status").json()
    assert body["challenge"]["event"] == "sprint-2m"
    assert body["challenge"]["task"] == "Mjlab-Sprint2m-MicroDuck"
    assert body["challenge"]["recipe"] == {"num_envs": 4096, "max_iterations": 3000, "seed": 1}
    assert body["challenge"]["knobs"] == [
        {"name": "forward_reward", "label": "Follow the speed order", "value": 2.0, "min": 0.5, "max": 5.0}]
    assert body["event"]["id"] == "sprint-2m" and body["event"]["rig"] == "legs"
    assert body["arena"] == "http://arena.test"


def test_without_an_nvidia_gpu_training_goes_to_hf_jobs(workshop):
    body = workshop.get("/api/workshop/status").json()
    assert body["preflight"] == {"git": True, "uv": True, "gpu": False}
    assert body["mode"] == "hf-jobs"


def test_the_status_answers_without_asking_the_hub(workshop, hub):
    """The page draws every zone from the status: one call that waits on the network leaves it blank."""
    hub.whoami = lambda: pytest.fail("the status asked the Hub")
    assert workshop.get("/api/workshop/status").status_code == 200


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


def test_with_an_nvidia_gpu_it_trains_here(workshop, fakes):
    fakes.gpu()
    assert workshop.get("/api/workshop/status").json()["mode"] == "local"


def test_the_page_is_served_from_the_built_site(checkout, fakes, hub, tmp_path):
    from fastapi.testclient import TestClient

    from arena.workshop.challenges import open_challenges

    site = tmp_path / "site"
    site.mkdir()
    (site / "workshop.html").write_text("<html>workshop</html>")
    app = create_workshop_app(checkout, open_challenges(checkout)[0], "http://arena.test", hub, PORT, frontend_dir=site)
    assert TestClient(app, base_url=ADDRESS).get("/").text == "<html>workshop</html>"


def test_the_api_wins_over_the_static_mount(checkout, fakes, hub, tmp_path):
    from fastapi.testclient import TestClient

    from arena.workshop.challenges import open_challenges

    site = tmp_path / "site"
    site.mkdir()
    (site / "workshop.html").write_text("<html>workshop</html>")
    app = create_workshop_app(checkout, open_challenges(checkout)[0], "http://arena.test", hub, PORT, frontend_dir=site)
    assert TestClient(app, base_url=ADDRESS).get("/api/workshop/status").status_code == 200


def test_without_a_built_site_the_page_says_how_to_build_it(workshop):
    response = workshop.get("/")
    assert response.status_code == 503
    assert "npm run build" in response.text


def test_a_request_under_another_hosts_name_is_refused(workshop):
    """A DNS-rebinding page re-points its own name at 127.0.0.1: the Host header still says its name."""
    for host in ("attacker.example", "attacker.example:8765", "127.0.0.1:9999"):
        assert workshop.get("/api/workshop/status", headers={"Host": host}).status_code == 403


def test_the_workshop_answers_to_both_names_of_its_own_address(workshop):
    for host in ("127.0.0.1:8765", "localhost:8765"):
        assert workshop.get("/api/workshop/status", headers={"Host": host}).status_code == 200


def test_a_post_from_another_site_is_refused(workshop, checkout):
    """Any page the user visits can POST here without a CORS preflight (no body, or a text/plain
    one); the browser names the page it came from in Origin."""
    (checkout / "mine.py").write_text("# mine\n")
    for origin in ("https://evil.example", "null", "http://127.0.0.1:9999"):
        assert workshop.post("/api/workshop/code/push", headers={"Origin": origin}).status_code == 403
    assert git(checkout, "log", "-1", "--format=%s") == "the challenges"  # nothing committed, nothing pushed


def test_a_post_from_the_page_itself_or_from_no_page_goes_through(workshop):
    # 409: nothing is running — the guard let it reach the route.
    for headers in ({"Origin": "http://127.0.0.1:8765"}, {"Origin": "http://localhost:8765"}, {}):
        assert workshop.post("/api/workshop/train/stop", headers=headers).status_code == 409

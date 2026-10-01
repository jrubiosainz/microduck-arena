"""The page's server: what it says about the checkout and the machine, before anything runs."""

import pytest

from arena.workshop.app import create_workshop_app
from tests.workshop.conftest import ADDRESS, PORT, edit_by_hand, git, reopen


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


def test_the_status_reads_challenge_toml_as_it_is_now(workshop, checkout):
    """Edited by hand and committed while the workshop runs: Settings show it, and Train does not
    write the old values back."""
    edit_by_hand(checkout)
    (sprint,) = workshop.get("/api/workshop/status").json()["challenges"]
    assert sprint["recipe"]["max_iterations"] == 10
    assert (sprint["knobs"][0]["value"], sprint["knobs"][0]["max"]) == (7.5, 8.0)


@pytest.mark.parametrize("edit, complaint", [
    (lambda toml: toml.write_text(toml.read_text().replace("max_iterations = 3000", "max_iterations =")), "Invalid value"),
    (lambda toml: toml.unlink(), "No such file"),
    (lambda toml: toml.write_text(toml.read_text().replace('"sprint-2m"', '"sprint-3m"')), "sprint-3m"),
], ids=["half an edit", "deleted", "an event this arena does not race"])
def test_a_challenge_toml_that_does_not_read_keeps_the_page_drawing(workshop, checkout, edit, complaint):
    edit(checkout / "src" / "microduck_challenges" / "sprint_2m" / "challenge.toml")
    git(checkout, "commit", "-qam", "an edit")
    status = workshop.get("/api/workshop/status")
    assert status.status_code == 200
    (sprint,) = status.json()["challenges"]
    assert sprint["event"]["id"] == "sprint-2m" and sprint["recipe"]["max_iterations"] == 3000  # as it last read
    response = workshop.post("/api/workshop/challenges/sprint-2m/train", json={
        "name": "first", "where": "hf-jobs", "recipe": sprint["recipe"], "params": {}})
    assert response.status_code == 400
    assert "challenge.toml" in response.json()["detail"] and complaint in response.json()["detail"]


def test_a_knob_that_is_not_a_reward_goes_with_the_recipe(checkout, fakes, hub):
    toml = checkout / "src" / "microduck_challenges" / "sprint_2m" / "challenge.toml"
    toml.write_text(toml.read_text() + '\n[params.max_slope_deg]\nlabel = "Steepest training slope"\n'
                    "value = 10.0\nmin   = 0.0\nmax   = 15.0\n")
    (sprint,) = reopen(checkout, hub).get("/api/workshop/status").json()["challenges"]
    assert [(k["name"], k["group"]) for k in sprint["knobs"]] == [("forward_reward", "reward"), ("max_slope_deg", "recipe")]


def test_with_an_nvidia_gpu_the_status_says_so(workshop, fakes):
    fakes.gpu()
    assert workshop.get("/api/workshop/status").json()["gpu"] is True


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


def test_the_page_is_served_from_the_built_site(checkout, fakes, hub, tmp_path):
    from fastapi.testclient import TestClient

    from arena.workshop.challenges import open_challenges

    site = tmp_path / "site"
    site.mkdir()
    (site / "workshop.html").write_text("<html>workshop</html>")
    app = create_workshop_app(checkout, open_challenges(checkout), "http://arena.test", hub, PORT, frontend_dir=site)
    assert TestClient(app, base_url=ADDRESS).get("/").text == "<html>workshop</html>"


def test_the_api_wins_over_the_static_mount(checkout, fakes, hub, tmp_path):
    from fastapi.testclient import TestClient

    from arena.workshop.challenges import open_challenges

    site = tmp_path / "site"
    site.mkdir()
    (site / "workshop.html").write_text("<html>workshop</html>")
    app = create_workshop_app(checkout, open_challenges(checkout), "http://arena.test", hub, PORT, frontend_dir=site)
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
    # 404: no such training — the guard let it reach the route.
    for headers in ({"Origin": "http://127.0.0.1:8765"}, {"Origin": "http://localhost:8765"}, {}):
        assert workshop.post("/api/workshop/challenges/sprint-2m/jobs/nope/stop", headers=headers).status_code == 404

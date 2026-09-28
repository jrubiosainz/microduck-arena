"""The page's server: what it says about the checkout and the machine, before anything runs."""

from arena.workshop.app import create_workshop_app


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
    assert body["preflight"] == {"git": True, "identity": True, "uv": True, "gpu": False, "gh": True, "user": "alice"}
    assert body["mode"] == "hf-jobs"


def test_with_an_nvidia_gpu_it_trains_here(workshop, fakes):
    fakes.gpu()
    assert workshop.get("/api/workshop/status").json()["mode"] == "local"


def test_a_logged_out_user_is_told_so(workshop, hub):
    hub.user = None
    assert workshop.get("/api/workshop/status").json()["preflight"]["user"] is None


def test_logging_in_with_a_token(workshop, hub):
    hub.user = None
    assert workshop.post("/api/workshop/login", json={"token": " hf_good "}).json() == {"user": "alice"}
    assert hub.tokens == ["hf_good"]


def test_a_refused_token_says_why(workshop, hub):
    hub.user = None
    response = workshop.post("/api/workshop/login", json={"token": "nope"})
    assert response.status_code == 400
    assert "Invalid user token" in response.json()["detail"]


def test_git_without_a_name_on_commits_is_flagged(workshop, checkout, monkeypatch, tmp_path):
    from tests.workshop.conftest import git

    git(checkout, "config", "--unset", "user.email")
    monkeypatch.setenv("HOME", str(tmp_path))  # no global identity either
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    assert workshop.get("/api/workshop/status").json()["preflight"]["identity"] is False


def test_the_page_is_served_from_the_built_site(checkout, fakes, hub, tmp_path):
    from fastapi.testclient import TestClient

    from arena.workshop.challenges import open_challenges

    site = tmp_path / "site"
    site.mkdir()
    (site / "workshop.html").write_text("<html>workshop</html>")
    app = create_workshop_app(checkout, open_challenges(checkout)[0], "http://arena.test", hub, frontend_dir=site)
    assert TestClient(app).get("/").text == "<html>workshop</html>"


def test_the_api_wins_over_the_static_mount(checkout, fakes, hub, tmp_path):
    from fastapi.testclient import TestClient

    from arena.workshop.challenges import open_challenges

    site = tmp_path / "site"
    site.mkdir()
    (site / "workshop.html").write_text("<html>workshop</html>")
    app = create_workshop_app(checkout, open_challenges(checkout)[0], "http://arena.test", hub, frontend_dir=site)
    assert TestClient(app).get("/api/workshop/status").status_code == 200


def test_without_a_built_site_the_page_says_how_to_build_it(workshop):
    response = workshop.get("/")
    assert response.status_code == 503
    assert "npm run build" in response.text

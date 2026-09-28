"""`uv run workshop` lists the challenges open in this checkout; `uv run workshop <id>` opens one."""

from arena.workshop import cli


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
    monkeypatch.chdir(checkout)
    monkeypatch.setattr("uvicorn.run", lambda app, **kw: served.update(app=app, **kw))
    assert cli.main(["sprint-2m", "--arena", "http://127.0.0.1:8000/", "--no-browser", "--port", "9999"]) == 0
    workshop = served["app"].state.workshop
    assert workshop.challenge.event == "sprint-2m"
    assert workshop.arena == "http://127.0.0.1:8000"
    assert served["port"] == 9999 and served["host"] == "127.0.0.1"


def test_the_folder_name_works_too(checkout, monkeypatch):
    served = {}
    monkeypatch.chdir(checkout)
    monkeypatch.setattr("uvicorn.run", lambda app, **kw: served.update(app=app))
    assert cli.main(["sprint_2m", "--no-browser"]) == 0
    assert served["app"].state.workshop.challenge.event == "sprint-2m"

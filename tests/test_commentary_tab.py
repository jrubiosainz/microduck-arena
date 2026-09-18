import pytest

from arena.commentary.tab import PlanTab

PLAN = {"duration_ms": 4000, "captions": [], "notes": [], "gestures": []}
READY = "Boolean(window.plan)"


class FakeTab:
    def __init__(self):
        self.asked = []
        self.closed = False
        self.alive = True

    def navigate(self, url):
        self.url = url

    def evaluate(self, expression, await_promise=False, timeout=60.0):
        if expression == READY:
            return True
        if not self.alive:
            raise ConnectionError("socket is closed")
        self.asked.append(expression)
        return PLAN

    def close(self):
        self.closed = True


class FakeChrome:
    made = 0

    def __init__(self, binary, nice=10):
        FakeChrome.made += 1
        self.tabs = []
        self.closed = False

    def tab(self, width, height):
        made = FakeTab()
        self.tabs.append(made)
        return made

    def close(self):
        self.closed = True


@pytest.fixture(autouse=True)
def _fresh():
    FakeChrome.made = 0


def test_it_opens_the_plan_page_once_and_reuses_the_tab(monkeypatch):
    monkeypatch.setattr("arena.commentary.tab.Chrome", FakeChrome)
    with PlanTab("http://127.0.0.1:8000", binary="/chrome") as tab:
        assert tab.prepare({"run_id": "a", "turns": []}) == PLAN
        assert tab.prepare({"run_id": "b", "turns": []}) == PLAN
    assert FakeChrome.made == 1


def test_it_navigates_to_the_plan_page_and_nothing_else(monkeypatch):
    monkeypatch.setattr("arena.commentary.tab.Chrome", FakeChrome)
    with PlanTab("http://127.0.0.1:8000", binary="/chrome") as tab:
        tab.prepare({"run_id": "a", "turns": []})
        assert tab._tab.url == "http://127.0.0.1:8000/plan.html"


def test_it_asks_the_page_for_the_plan_with_the_dialogue(monkeypatch):
    monkeypatch.setattr("arena.commentary.tab.Chrome", FakeChrome)
    with PlanTab("http://127.0.0.1:8000", binary="/chrome") as tab:
        tab.prepare({"run_id": "01M2", "turns": [{"speaker": "peter"}]})
        asked = tab._tab.asked[0]
        assert asked.startswith("window.plan(")
        assert '"run_id": "01M2"' in asked or '"run_id":"01M2"' in asked


def test_a_dead_browser_is_replaced_and_the_dialogue_still_prepares(monkeypatch):
    monkeypatch.setattr("arena.commentary.tab.Chrome", FakeChrome)
    with PlanTab("http://127.0.0.1:8000", binary="/chrome") as tab:
        tab.prepare({"run_id": "a", "turns": []})
        tab._tab.alive = False
        assert tab.prepare({"run_id": "b", "turns": []}) == PLAN
    assert FakeChrome.made == 2


def test_a_second_failure_in_a_row_is_raised(monkeypatch):
    class AlwaysDead(FakeChrome):
        def tab(self, width, height):
            made = super().tab(width, height)
            made.alive = False
            return made

    monkeypatch.setattr("arena.commentary.tab.Chrome", AlwaysDead)
    with PlanTab("http://127.0.0.1:8000", binary="/chrome") as tab, pytest.raises(ConnectionError):
        tab.prepare({"run_id": "a", "turns": []})


def test_closing_closes_the_browser(monkeypatch):
    monkeypatch.setattr("arena.commentary.tab.Chrome", FakeChrome)
    tab = PlanTab("http://127.0.0.1:8000", binary="/chrome")
    tab.prepare({"run_id": "a", "turns": []})
    chrome = tab._chrome
    tab.close()
    assert chrome.closed
    assert tab._chrome is None


def test_no_chrome_on_the_machine_is_told_plainly(monkeypatch):
    monkeypatch.setattr("arena.commentary.tab.find_chrome", lambda: None)
    with pytest.raises(RuntimeError, match="no Chrome"):
        PlanTab("http://127.0.0.1:8000").prepare({"run_id": "a", "turns": []})

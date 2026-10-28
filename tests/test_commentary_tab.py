import threading
import time

import pytest
from websockets.exceptions import ConnectionClosedError

from arena.commentary.tab import PlanTab

PLAN = {"duration_ms": 4000, "captions": [], "notes": [], "gestures": []}
READY = "Boolean(window.plan && window.planCall)"


class FakeTab:
    def __init__(self):
        self.asked = []
        self.closed = False
        self.alive = True
        self.ready = True

    def navigate(self, url):
        self.url = url

    def evaluate(self, expression, await_promise=False, timeout=60.0):
        if expression == READY:
            return self.ready
        if not self.alive:
            raise ConnectionClosedError(None, None)
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
    with PlanTab("http://127.0.0.1:8000", binary="/chrome") as tab, pytest.raises(ConnectionClosedError):
        tab.prepare({"run_id": "a", "turns": []})


def test_a_dialogue_the_page_cannot_time_is_not_mistaken_for_a_dead_browser(monkeypatch):
    class Untypeable(FakeTab):
        def evaluate(self, expression, await_promise=False, timeout=60.0):
            if expression == READY:
                return True
            raise RuntimeError("TypeError: turns is not iterable")

    class OneBadTab(FakeChrome):
        def tab(self, width, height):
            made = Untypeable()
            self.tabs.append(made)
            return made

    monkeypatch.setattr("arena.commentary.tab.Chrome", OneBadTab)
    with PlanTab("http://127.0.0.1:8000", binary="/chrome") as tab, \
            pytest.raises(RuntimeError, match="turns is not iterable"):
        tab.prepare({"run_id": "a", "turns": None})
    assert FakeChrome.made == 1


def test_closing_closes_the_browser(monkeypatch):
    monkeypatch.setattr("arena.commentary.tab.Chrome", FakeChrome)
    tab = PlanTab("http://127.0.0.1:8000", binary="/chrome")
    tab.prepare({"run_id": "a", "turns": []})
    chrome = tab._chrome
    tab.close()
    assert chrome.closed
    assert tab._chrome is None


def test_closing_waits_for_an_ask_in_progress(monkeypatch):
    """The reserve's thread may be asking the page when the app shuts down: the browser is not
    closed under it."""
    asking, answered = threading.Event(), threading.Event()

    class Slow(FakeTab):
        def evaluate(self, expression, await_promise=False, timeout=60.0):
            if expression == READY:
                return True
            asking.set()
            answered.wait(5)
            return PLAN

    class SlowChrome(FakeChrome):
        def tab(self, width, height):
            return Slow()

    monkeypatch.setattr("arena.commentary.tab.Chrome", SlowChrome)
    tab = PlanTab("http://127.0.0.1:8000", binary="/chrome")
    reserve = threading.Thread(target=lambda: tab.prepare({"run_id": "a", "turns": []}))
    reserve.start()
    asking.wait(5)
    chrome = tab._chrome
    closing = threading.Thread(target=tab.close)
    closing.start()
    closing.join(0.2)
    assert not chrome.closed
    answered.set()
    reserve.join(5)
    closing.join(5)
    assert chrome.closed and tab._chrome is None


def test_no_chrome_on_the_machine_is_told_plainly(monkeypatch):
    monkeypatch.setattr("arena.commentary.tab.find_chrome", lambda: None)
    with pytest.raises(RuntimeError, match="no Chrome"):
        PlanTab("http://127.0.0.1:8000").prepare({"run_id": "a", "turns": []})


def test_a_browser_that_never_hands_over_a_tab_is_closed(monkeypatch):
    """The reserve retries every five seconds and `Chrome` has no `__del__`:
    a browser half-opened and dropped is a process and a profile directory
    leaked per turn."""
    opened = []

    class NoTab(FakeChrome):
        def __init__(self, binary, nice=10):
            super().__init__(binary, nice)
            opened.append(self)

        def tab(self, width, height):
            raise RuntimeError("the browser went away before it opened a tab")

    monkeypatch.setattr("arena.commentary.tab.Chrome", NoTab)
    plan = PlanTab("http://127.0.0.1:8000", binary="/chrome")
    for _ in range(3):
        with pytest.raises(RuntimeError, match="went away"):
            plan.prepare({"run_id": "a", "turns": []})
    assert len(opened) == 3
    assert all(one.closed for one in opened)


class Hurried:
    """A minute per look at the clock, so a readiness deadline is reached
    without the test waiting a real minute for it."""

    def __init__(self):
        self.at = 0.0

    def monotonic(self):
        self.at += 30.0
        return self.at

    def sleep(self, _seconds):
        pass


def test_a_page_that_never_becomes_ready_is_recovered_from_on_a_later_turn(monkeypatch):
    """A readiness timeout used to leave the dead tab kept, so every later
    prepare asked a page that would never answer, for ever."""
    opened = []

    class Slow(FakeChrome):
        def __init__(self, binary, nice=10):
            super().__init__(binary, nice)
            opened.append(self)

        def tab(self, width, height):
            made = FakeTab()
            made.ready = len(opened) > 1  # the first browser's page never is
            self.tabs.append(made)
            return made

    monkeypatch.setattr("arena.commentary.tab.Chrome", Slow)
    monkeypatch.setattr("arena.commentary.tab.time", Hurried())
    plan = PlanTab("http://127.0.0.1:8000", binary="/chrome")
    with pytest.raises(TimeoutError):
        plan.prepare({"run_id": "a", "turns": []})
    assert opened[0].closed
    assert plan.prepare({"run_id": "a", "turns": []}) == PLAN
    assert len(opened) == 2


def test_a_call_is_planned_by_the_page(monkeypatch):
    monkeypatch.setattr("arena.commentary.tab.Chrome", FakeChrome)
    with PlanTab("http://127.0.0.1:8000", binary="/chrome") as tab:
        assert tab.prepare_call({"id": "m", "lines": [], "duration_ms": 4000}) == PLAN
        assert tab._tab.asked[0].startswith("window.planCall(")


def test_two_threads_never_ask_the_page_at_once(monkeypatch):
    inside = []
    most = []

    class Slow(FakeTab):
        def evaluate(self, expression, await_promise=False, timeout=60.0):
            if expression == READY:
                return True
            inside.append(1)
            most.append(len(inside))
            time.sleep(0.05)
            inside.pop()
            return PLAN

    class SlowChrome(FakeChrome):
        def tab(self, width, height):
            return Slow()

    monkeypatch.setattr("arena.commentary.tab.Chrome", SlowChrome)
    with PlanTab("http://127.0.0.1:8000", binary="/chrome") as tab:
        tab.prepare({"run_id": "warm", "turns": []})
        most.clear()
        reserve = threading.Thread(target=lambda: [tab.prepare({"run_id": "a", "turns": []}) for _ in range(5)])
        worker = threading.Thread(target=lambda: [tab.prepare_call({"id": "m", "lines": [], "duration_ms": 4000}) for _ in range(5)])
        reserve.start()
        worker.start()
        reserve.join()
        worker.join()
    assert max(most) == 1

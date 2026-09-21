import json

from tests.loading import load_script

collector = load_script("collect_broadcasts")
SITE = "http://arena.test"


def site(slots, now_ms=5000):
    asked = []

    def get(url):
        asked.append(url)
        if url == f"{SITE}/api/live":
            return {"now_ms": now_ms, "build": "b1", "slots": slots}
        return {"dialogue": {"turns": [], "about": url.rsplit("/", 1)[1]}, "plan": {}}

    get.asked = asked
    return get


def test_it_keeps_each_started_booth_once(tmp_path):
    slots = [{"kind": "replay", "at_ms": 1000, "run_id": "A"},
             {"kind": "booth", "at_ms": 4000, "run_id": "A", "broadcast": "B1"},
             {"kind": "booth", "at_ms": 9000, "run_id": "C", "broadcast": "B2"}]
    seen = set()
    get = site(slots)
    assert collector.collect(SITE, tmp_path, seen, get) == 1
    # B2 has not started: a future slot may still be laid again.
    assert [p.name for p in tmp_path.iterdir()] == ["4000-B1.json"]
    assert json.loads((tmp_path / "4000-B1.json").read_text()) == {
        "at_ms": 4000, "build": "b1", "run_id": "A",
        "dialogue": {"turns": [], "about": "B1"}, "plan": {}}
    assert collector.collect(SITE, tmp_path, seen, get) == 0
    assert get.asked.count(f"{SITE}/api/live/broadcast/B1") == 1


def test_a_restarted_collector_knows_what_is_on_disk(tmp_path):
    (tmp_path / "4000-B1.json").write_text("{}")
    assert collector.on_disk(tmp_path) == {"B1"}

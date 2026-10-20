from arena.cup import Cup
from arena.cupworker import all_cups, load_cup
from arena.store import LocalStore
from tests.test_cup import entrant


def test_a_cup_is_read_back_from_its_files(tmp_path):
    store = LocalStore(tmp_path)
    assert load_cup(store, "tug-of-war", 1) is None and all_cups(store) == []
    cup = Cup("tug-of-war", 1, "2026-10-30T15:00:00Z", "2026-10-30T17:00:00Z", "ab" * 16,
              tuple(entrant(i) for i in range(4)), ((0, 1, 2, 3),))
    store.put_cup_files("tug-of-war", 1, {"draw.json": cup.draw_json()})
    assert load_cup(store, "tug-of-war", 1) == cup and all_cups(store) == [cup]

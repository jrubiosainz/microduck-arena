from .cup import Cup
from .manifest import all_events
from .store import Store


def load_cup(store: Store, event_id: str, number: int) -> Cup | None:
    draw = store.cup_file(event_id, number, "draw.json")
    if draw is None:
        return None
    return Cup.from_json(draw, store.cup_file(event_id, number, "matches.json"), store.cup_file(event_id, number, "order.json"))


def all_cups(store: Store) -> list[Cup]:
    return [load_cup(store, event.id, number) for event in all_events() if event.cup for number in store.cup_numbers(event.id)]

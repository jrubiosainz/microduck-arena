"""Sock Heist's venue models, as scripts/sock_heist_venue.py exports them: the giant's nest and the
loose socks on its floor, read from each GLB's own JSON chunk."""

import json
import struct
from pathlib import Path

VENUE = Path(__file__).parent.parent / "app" / "public" / "venue"


def gltf(path: Path) -> dict:
    """The GLB's JSON chunk: after the 12-byte header, the first chunk's length and type."""
    data = path.read_bytes()
    length, kind = struct.unpack("<II", data[12:20])
    assert kind == 0x4E4F534A  # "JSON"
    return json.loads(data[20 : 20 + length])


def mesh(doc: dict, name: str) -> dict:
    return next(m for m in doc["meshes"] if m["name"] == name)


def triangles(doc: dict, name: str) -> int:
    return sum(doc["accessors"][p["indices"]]["count"] // 3 for p in mesh(doc, name)["primitives"])


def bounds(doc: dict, name: str) -> tuple[list[float], list[float]]:
    primitives = mesh(doc, name)["primitives"]
    positions = [doc["accessors"][p["attributes"]["POSITION"]] for p in primitives]
    lo = [min(a["min"][k] for a in positions) for k in range(3)]
    hi = [max(a["max"][k] for a in positions) for k in range(3)]
    return lo, hi


def test_the_nest_is_one_mesh_named_nest():
    assert [m["name"] for m in gltf(VENUE / "sock-nest.glb")["meshes"]] == ["nest"]


def test_the_nest_keeps_its_triangle_budget():
    assert triangles(gltf(VENUE / "sock-nest.glb"), "nest") <= 6000


def test_the_socks_are_three_to_five_models_within_budget():
    names = [m["name"] for m in gltf(VENUE / "socks.glb")["meshes"]]
    assert 3 <= len(names) <= 5 and names == [f"sock_{k}" for k in range(len(names))]
    assert all(triangles(gltf(VENUE / "socks.glb"), name) <= 400 for name in names)


def test_the_nest_stands_on_the_floor():
    lo, hi = bounds(gltf(VENUE / "sock-nest.glb"), "nest")
    assert abs(lo[1]) < 0.01 and hi[1] - lo[1] < hi[0] - lo[0]  # on the floor, wider than tall


def test_every_venue_model_is_vertex_coloured():
    for name in ("sock-nest.glb", "socks.glb"):
        meshes = gltf(VENUE / name)["meshes"]
        assert all("COLOR_0" in p["attributes"] for m in meshes for p in m["primitives"])

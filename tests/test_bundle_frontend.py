"""The built site goes inside the package, so a wheel carries it and `arena serve`
(or `workshop`) finds it wherever the package is installed."""

from pathlib import Path

import pytest

from tests.loading import load_script

bundle_frontend = load_script("bundle_frontend")


def _dist(tmp_path: Path) -> Path:
    dist = tmp_path / "app" / "dist"
    (dist / "robot").mkdir(parents=True)
    (dist / "index.html").write_text("<html>site</html>")
    (dist / "robot" / "microduck.glb").write_bytes(b"glb" * 100)
    return dist


def test_bundle_copies_the_whole_dist(tmp_path):
    target = tmp_path / "arena" / "frontend"
    assert bundle_frontend.bundle(_dist(tmp_path), target) == target
    assert (target / "index.html").read_text() == "<html>site</html>"
    assert (target / "robot" / "microduck.glb").stat().st_size == 300


def test_bundle_replaces_a_stale_copy(tmp_path):
    target = tmp_path / "arena" / "frontend"
    target.mkdir(parents=True)
    (target / "old-bundle.js").write_text("stale")
    bundle_frontend.bundle(_dist(tmp_path), target)
    assert not (target / "old-bundle.js").exists(), "a previous bundle must not leak into a new wheel"


def test_an_unbuilt_dist_is_refused_by_name(tmp_path, capsys):
    with pytest.raises(SystemExit) as caught:
        bundle_frontend.bundle(tmp_path / "nowhere", tmp_path / "arena" / "frontend")
    assert caught.value.code == 2
    err = capsys.readouterr().err
    assert "nowhere" in err and "npm run build" in err


def test_the_wheel_ships_the_bundle_as_an_artifact():
    """hatchling honours .gitignore; the bundle is ignored, so it must be listed as an artifact."""
    import tomllib

    root = Path(__file__).resolve().parents[1]
    hatch = tomllib.loads((root / "pyproject.toml").read_text())["tool"]["hatch"]["build"]["targets"]["wheel"]
    assert "arena/frontend/**" in hatch.get("artifacts", [])
    assert "arena/frontend/" in (root / ".gitignore").read_text()

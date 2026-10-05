"""What the deploy refuses to leave behind on the Space."""

from tests.loading import load_script

deploy = load_script("deploy_space")

ATTRIBUTES = """\
*.onnx filter=lfs diff=lfs merge=lfs -text
*.mp4 filter=lfs diff=lfs merge=lfs -text
app/public/robot/microduck.glb filter=lfs diff=lfs merge=lfs -text
README.md text
"""


def test_a_file_the_hub_keeps_in_lfs_with_no_rule_for_it_is_named():
    """The Hub decides by itself to keep a large binary in LFS; the Space's build
    only turns a pointer back into its file where .gitattributes says LFS. The
    two commentators' voices shipped as 131-byte pointers that way, the booth's
    sound never opened, and nothing anywhere said why."""
    kept_in_lfs = ["arena/assets/policy.onnx", "app/public/robot/microduck.glb",
                   "clips/intro.mp4", "app/public/sound/commentator-peter.f32",
                   "app/public/sound/microduck-victory.wav"]
    assert deploy.served_as_pointers(kept_in_lfs, ATTRIBUTES) == [
        "app/public/sound/commentator-peter.f32", "app/public/sound/microduck-victory.wav"]


def test_a_rule_that_is_not_an_lfs_rule_covers_nothing():
    assert deploy.served_as_pointers(["README.md"], ATTRIBUTES) == ["README.md"]


def test_this_repository_has_a_rule_for_the_synthesiser_the_booth_sings_with():
    attributes = (deploy.ROOT / ".gitattributes").read_text()
    assert deploy.served_as_pointers(["app/public/sound/microduck-voice.wasm"], attributes) == []


def test_the_space_upload_ignores_the_bundle():
    """The Space's Docker build bundles the site itself; a host bundle would be stale."""
    assert "arena/frontend/**" in deploy.IGNORE and "app/dist/**" in deploy.IGNORE

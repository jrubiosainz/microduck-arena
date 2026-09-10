import mujoco
import pytest

from arena.assets import ASSET_ROOT

RIGS = [
    ("legs", "robot_allcollisions.xml", 14),
    ("rollers", "robot_allcollisions_rollers.xml", 18),
]


def test_asset_root_exists():
    assert (ASSET_ROOT / "PROVENANCE.md").is_file()


@pytest.mark.parametrize("rig,xml_name,n_body_joints", RIGS)
def test_vendored_mjcf_compiles(rig, xml_name, n_body_joints):
    path = ASSET_ROOT / "robot" / rig / xml_name
    model = mujoco.MjModel.from_xml_path(str(path))
    # 14 position actuators in both rigs; the roller rig adds 4 passive wheel
    # hinges that appear in qpos but are not actuated.
    assert model.nu == 14
    assert model.body("trunk_base").id >= 0
    assert model.sensor("imu_ang_vel").adr[0] >= 0
    # njnt includes the trunk freejoint, so body joints are njnt - 1.
    assert model.njnt - 1 == n_body_joints


def test_reference_policy_present():
    assert (ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx").is_file()
